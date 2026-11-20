import { Version } from '@xmcl/core'
import { installForgeTask, installNeoForgedTask, installLibrariesTask } from '@xmcl/installer'
import type { Task } from '@xmcl/task'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { Instance } from '../../shared/contracts'
import type { LoaderKind, LoaderVersion } from '../../shared/content'
import { validVersion, validateLoader } from '../storage/store'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'
import { LauncherError } from '../errors'

export function neoGameVersion(version: string): string | null {
  const match = /^(20|21)\.(\d+)\.\d+(?:-beta)?$/.exec(version)
  return match ? `1.${match[1]}${Number(match[2]) ? `.${Number(match[2])}` : ''}` : null
}
export function validateProfile(profile: { id: string; inheritsFrom?: string; mainClass: string; libraries: unknown[] }, gameVersion: string): void {
  if (!profile || !validVersion(profile.id) || profile.inheritsFrom !== gameVersion || typeof profile.mainClass !== 'string' || !profile.mainClass || !Array.isArray(profile.libraries)) throw new LauncherError('INTEGRITY', '加载器版本描述与游戏不兼容。')
}
export async function hashFile(path: string, algorithm = 'sha512'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export class LoaderService {
  constructor(private root: () => string, private request: typeof fetch = fetch) {}
  private async text(url: string, signal: AbortSignal): Promise<string> {
    const response = await this.request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), headers: { 'User-Agent': 'LuquoraLauncher/0.2.0' } })
    if (!response.ok) throw new LauncherError('NETWORK', `加载器服务请求失败（${response.status}）。`)
    const text = await response.text()
    if (text.length > 8 * 1024 * 1024) throw new LauncherError('INTEGRITY', '加载器元数据过大。')
    return text
  }
  async list(gameVersion: string, kind: LoaderKind, signal: AbortSignal): Promise<LoaderVersion[]> {
    if (!validVersion(gameVersion) || !['fabric', 'forge', 'neoforge', 'quilt'].includes(kind)) throw new LauncherError('INVALID_INPUT', '游戏或加载器类型无效。')
    if (kind === 'fabric' || kind === 'quilt') {
      const host = kind === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3'
      const records = JSON.parse(await this.text(`${host}/versions/loader/${gameVersion}`, signal)) as { loader: { version: string; stable?: boolean } }[]
      if (!Array.isArray(records)) throw new LauncherError('INTEGRITY', '加载器版本列表无效。')
      return records.filter(item => validVersion(item.loader?.version)).map(item => ({ version: item.loader.version, stable: item.loader.stable ?? !/beta|alpha|rc/i.test(item.loader.version) })).sort((left, right) => Number(right.stable) - Number(left.stable))
    }
    const url = kind === 'forge' ? 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml' : 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
    const versions = [...(await this.text(url, signal)).matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1])
    return versions.filter(version => kind === 'forge' ? version.startsWith(`${gameVersion}-`) : neoGameVersion(version) === gameVersion).map(version => ({ version: kind === 'forge' ? version.slice(gameVersion.length + 1) : version, stable: !/beta|alpha|rc/i.test(version) })).filter(item => validVersion(item.version)).sort((left, right) => Number(right.stable) - Number(left.stable) || right.version.localeCompare(left.version, undefined, { numeric: true }))
  }
  private async run<T>(task: Task<T>, signal: AbortSignal, changed: (stage: string, completed: number, total: number | null) => void): Promise<T> {
    signal.throwIfAborted()
    const abort = () => { void task.cancel().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try { return await task.startAndWait({ onUpdate: current => changed(current.name, Math.max(0, current.progress), current.total > 0 ? current.total : null) }) }
    finally { signal.removeEventListener('abort', abort) }
  }
  async install(instance: Instance, javaPath: string, signal: AbortSignal, changed: (stage: string, completed: number, total: number | null) => void = () => {}): Promise<string> {
    validateLoader(instance.loader)
    if (!instance.loader) return instance.versionId
    const { kind, version } = instance.loader
    if (!(await this.list(instance.versionId, kind, signal)).some(item => item.version === version)) throw new LauncherError('INVALID_INPUT', '该加载器版本不支持所选游戏。')
    const shared = join(this.root(), 'shared')
    let id: string
    if (kind === 'fabric' || kind === 'quilt') {
      const host = kind === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3'
      const profile = JSON.parse(await this.text(`${host}/versions/loader/${instance.versionId}/${version}/profile/json`, signal))
      id = `lql-${instance.versionId}-${kind}-${version}`
      profile.id = id
      validateProfile(profile, instance.versionId)
      const directory = await ensureManagedDirectory(this.root(), join(shared, 'versions', id))
      await writeFile(join(directory, `${id}.json`), JSON.stringify(profile))
    } else {
      const children = new Set<ChildProcess>()
      const waits: Promise<void>[] = []
      const options = { java: javaPath, side: 'client' as const, librariesDownloadConcurrency: 4, libraryHost: (library: { download: { url: string } }) => library.download.url?.replace(/^http:/, 'https:'), spawn: (command: string, args?: readonly string[], settings?: Parameters<typeof spawn>[2]) => {
        const child = spawn(command, args ?? [], { ...settings, shell: false, windowsHide: true, signal, timeout: 180000 })
        children.add(child)
        waits.push(new Promise<void>(resolve => { child.once('close', () => { children.delete(child); resolve() }); child.once('error', () => { if (!child.pid) { children.delete(child); resolve() } }) }))
        return child
      } }
      const full = `${instance.versionId}-${version}`
      const task = kind === 'forge' ? installForgeTask({ mcversion: instance.versionId, version, installer: { path: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar` } }, shared, options) : installNeoForgedTask('neoforge', version, shared, options)
      try { id = await this.run(task, signal, changed) }
      finally { if (signal.aborted) for (const child of children) child.kill(); await Promise.all(waits) }
    }
    if (!validVersion(id)) throw new LauncherError('INTEGRITY', '加载器生成的版本标识无效。')
    const profilePath = await assertManagedPath(this.root(), join(shared, 'versions', id, `${id}.json`))
    validateProfile(JSON.parse(await readFile(profilePath, 'utf8')), instance.versionId)
    const core = await Version.parse(shared, id)
    for (const library of core.libraries) await assertManagedPath(this.root(), join(shared, 'libraries', library.path))
    await this.run(installLibrariesTask(core, { libraryHost: library => library.download.url?.replace(/^http:/, 'https:'), librariesDownloadConcurrency: 4 }), signal, changed)
    const files: { path: string; hash: string }[] = []
    for (const path of [profilePath, ...core.libraries.map(library => join(shared, 'libraries', library.path))]) {
      signal.throwIfAborted()
      if (!(await stat(path)).isFile()) throw new LauncherError('INTEGRITY', '加载器文件缺失。')
      files.push({ path: path.slice(shared.length + 1), hash: await hashFile(path) })
    }
    await writeFile(join(shared, 'versions', id, 'lql-files.json'), JSON.stringify(files))
    return id
  }
  async verify(instance: Instance): Promise<boolean> {
    if (!instance.loader) return true
    if (!instance.launchVersionId || !validVersion(instance.launchVersionId)) return false
    try {
      const shared = join(this.root(), 'shared')
      const entries = JSON.parse(await readFile(join(shared, 'versions', instance.launchVersionId, 'lql-files.json'), 'utf8')) as { path: string; hash: string }[]
      if (!Array.isArray(entries) || !entries.length || entries.length > 10000) return false
      for (const entry of entries) if (!/^[a-f0-9]{128}$/.test(entry.hash) || await hashFile(await assertManagedPath(shared, join(shared, entry.path))) !== entry.hash) return false
      return true
    } catch { return false }
  }
}
