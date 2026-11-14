import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve, delimiter } from 'node:path'
import { DEFAULT_RUNTIME_ALL_URL, type JavaRuntimes, type JavaRuntimeManifest } from '@xmcl/installer'
import { LauncherError } from '../errors'
import { downloadFile, fetchJson, inParallel } from './download'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'
import type { ResolvedVersion } from './metadata'

const execute = promisify(execFile)
export type JavaRuntime = { executable: string; major: number; arch: 'x64'; managed: boolean }
export function parseJavaProperties(output: string): { major: number; arch: 'x64' } {
  const version = output.match(/java\.version\s*=\s*(\S+)/)?.[1]
  const arch = output.match(/os\.arch\s*=\s*(\S+)/)?.[1]
  const major = version?.startsWith('1.') ? Number(version.split('.')[1]) : Number(version?.match(/^\d+/)?.[0])
  if (!major || !['amd64', 'x86_64'].includes(arch ?? '')) throw new LauncherError('JAVA_INCOMPATIBLE', '需要兼容的 x64 Java。', '选择与游戏要求匹配的 64 位 Java。')
  return { major, arch: 'x64' }
}
export async function probeJava(executable: string, signal: AbortSignal): Promise<JavaRuntime> {
  try {
    const result = await execute(executable, ['-XshowSettings:properties', '-version'], { windowsHide: true, timeout: 5000, signal, maxBuffer: 256 * 1024 })
    return { executable, ...parseJavaProperties(`${result.stdout}\n${result.stderr}`), managed: false }
  } catch (error) { signal.throwIfAborted(); if (error instanceof LauncherError) throw error; throw new LauncherError('JAVA_MISSING', 'Java 不存在、无法执行或探测超时。', '重新选择 Java，或使用自动配置。') }
}
async function javaCandidates(): Promise<string[]> {
  const candidates = new Set<string>()
  if (process.env.JAVA_HOME) candidates.add(join(process.env.JAVA_HOME, 'bin', 'java.exe'))
  for (const directory of (process.env.PATH ?? '').split(delimiter)) if (directory) candidates.add(join(directory.replace(/^"|"$/g, ''), 'java.exe'))
  for (const base of ['C:\\Develop\\JDK', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Java'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Eclipse Adoptium'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft')]) {
    candidates.add(join(base, 'bin', 'java.exe'))
    const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.slice(0, 50)) if (entry.isDirectory() && !entry.isSymbolicLink()) candidates.add(join(base, entry.name, 'bin', 'java.exe'))
  }
  const registry = await execute('reg.exe', ['query', 'HKLM\\SOFTWARE\\JavaSoft', '/s'], { windowsHide: true, timeout: 5000, maxBuffer: 512 * 1024 }).catch(() => ({ stdout: '' }))
  for (const match of registry.stdout.matchAll(/JavaHome\s+REG_SZ\s+(.+)/g)) candidates.add(join(match[1].trim(), 'bin', 'java.exe'))
  return [...candidates]
}
export async function resolveJava(root: string, version: ResolvedVersion, explicitPath: string | null, signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<JavaRuntime> {
  if (explicitPath) {
    const runtime = await probeJava(explicitPath, signal)
    if (runtime.major !== version.javaMajor) throw new LauncherError('JAVA_INCOMPATIBLE', `此版本需要 Java ${version.javaMajor}，所选为 Java ${runtime.major}。`, '更换 Java 路径，或恢复自动配置。')
    return runtime
  }
  const destination = join(root, 'runtimes', version.javaComponent)
  const managedExecutable = join(destination, 'bin', 'java.exe')
  await assertManagedPath(root, managedExecutable)
  for (const candidate of [managedExecutable, ...await javaCandidates()]) {
    signal.throwIfAborted()
    try { const runtime = await probeJava(candidate, signal); if (runtime.major === version.javaMajor) return { ...runtime, managed: candidate === managedExecutable } } catch (error) { signal.throwIfAborted() }
  }
  return installJavaRuntime(root, version, signal, progress)
}
export async function installJavaRuntime(root: string, version: ResolvedVersion, signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<JavaRuntime> {
  const destination = join(root, 'runtimes', version.javaComponent)
  const managedExecutable = join(destination, 'bin', 'java.exe')
  const index = await fetchJson<JavaRuntimes>(DEFAULT_RUNTIME_ALL_URL, signal)
  const target = index['windows-x64']?.[version.javaComponent]?.[0]
  if (!target) throw new LauncherError('JAVA_MISSING', `官方暂未提供 ${version.javaComponent} 的 Windows x64 运行时。`, '选择兼容的本地 Java 路径后重试。')
  const manifestPath = join(root, 'runtimes', `${version.javaComponent}.json`)
  await downloadFile(root, { ...target.manifest, path: manifestPath }, signal, () => {})
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as JavaRuntimeManifest
  if (!manifest.files || typeof manifest.files !== 'object') throw new LauncherError('INTEGRITY', 'Java 清单格式无效。')
  const entries = Object.entries(manifest.files)
  for (const [name, entry] of entries) {
    const targetPath = await assertManagedPath(destination, resolve(destination, name))
    if (entry.type === 'directory') await ensureManagedDirectory(root, targetPath)
    else if (!['file', 'link'].includes(entry.type)) throw new LauncherError('INTEGRITY', 'Java 清单包含未知类型。')
  }
  let completed = 0
  const files = entries.filter(([, entry]) => entry.type === 'file')
  await inParallel(files, async ([name, entry]) => {
    if (entry.type !== 'file') return
    await downloadFile(root, { ...entry.downloads.raw, path: join(destination, name) }, signal, () => {})
    progress(++completed, files.length)
  }, signal)
  for (const [name, entry] of entries) if (entry.type === 'link') {
    const targetPath = await assertManagedPath(destination, resolve(destination, name))
    const sourcePath = await assertManagedPath(destination, resolve(dirname(targetPath), entry.target))
    await ensureManagedDirectory(root, dirname(targetPath))
    await copyFile(sourcePath, targetPath)
  }
  const runtime = await probeJava(managedExecutable, signal)
  if (runtime.major !== version.javaMajor) throw new LauncherError('JAVA_INCOMPATIBLE', '下载的 Java 与游戏要求不符。')
  return { ...runtime, managed: true }
}
