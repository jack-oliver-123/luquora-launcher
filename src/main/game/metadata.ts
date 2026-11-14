import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { LauncherError } from '../errors'
import { validVersion } from '../storage/store'
import { fetchJson } from './download'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'
import type { VersionSummary } from '../../shared/contracts'

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
export type VersionEntry = { id: string; type: string; url: string; sha1: string; releaseTime: string }
export type GameMetadata = { id: string; javaVersion?: { majorVersion: number; component: string }; downloads: { client: { url: string; sha1: string; size: number } }; assetIndex: { id: string; url: string; sha1: string; size: number }; libraries: unknown[]; mainClass: string }
export type ResolvedVersion = { id: string; metadataPath: string; javaMajor: number; javaComponent: string; raw: GameMetadata }

export function javaRequirement(metadata: { id: string; javaVersion?: { majorVersion: number; component: string } }): { major: number; component: string } {
  const java = metadata.javaVersion
  if (!java || !Number.isInteger(java.majorVersion) || java.majorVersion < 8 || !/^[a-z0-9-]+$/.test(java.component)) throw new LauncherError('JAVA_INCOMPATIBLE', `版本 ${metadata.id} 缺少受支持的 Java 元数据。`, '选择带有 Java 要求的正式版。')
  return { major: java.majorVersion, component: java.component }
}

export class MetadataService {
  private entries: VersionEntry[] = []
  constructor(private root: () => string) {}
  async list(signal: AbortSignal): Promise<VersionSummary[]> {
    const data = await fetchJson<{ versions: VersionEntry[] }>(MANIFEST_URL, signal)
    if (!Array.isArray(data.versions)) throw new LauncherError('INTEGRITY', '版本列表格式无效。')
    this.entries = data.versions.filter(entry => entry.type === 'release' && validVersion(entry.id) && /^[a-f0-9]{40}$/i.test(entry.sha1))
    return this.entries.map(entry => ({ id: entry.id, releasedAt: entry.releaseTime }))
  }
  async resolve(id: string, signal: AbortSignal): Promise<ResolvedVersion> {
    if (!validVersion(id)) throw new LauncherError('INVALID_INPUT', '游戏版本无效。')
    if (!this.entries.length) await this.list(signal)
    const entry = this.entries.find(item => item.id === id)
    if (!entry) throw new LauncherError('INVALID_INPUT', '该正式版不可用。')
    const metadataPath = join(this.root(), 'shared', 'versions', id, `${id}.json`)
    await assertManagedPath(this.root(), metadataPath)
    let text = await readFile(metadataPath, 'utf8').catch(() => '')
    if (createHash('sha1').update(text).digest('hex') !== entry.sha1) {
      if (new URL(entry.url).protocol !== 'https:') throw new LauncherError('INTEGRITY', '版本地址无效。')
      const response = await fetch(entry.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
      if (!response.ok) throw new LauncherError('NETWORK', '无法读取版本描述。')
      text = await response.text()
      if (text.length > 16 * 1024 * 1024 || createHash('sha1').update(text).digest('hex') !== entry.sha1) throw new LauncherError('INTEGRITY', '版本描述校验失败。')
      await ensureManagedDirectory(this.root(), dirname(metadataPath))
      const temporary = `${metadataPath}.${randomUUID()}.tmp`
      await writeFile(temporary, text, { flag: 'wx' })
      await assertManagedPath(this.root(), metadataPath)
      await rename(temporary, metadataPath)
    }
    const raw = JSON.parse(text) as GameMetadata
    if (raw.id !== id || !raw.mainClass || !raw.downloads?.client || !raw.assetIndex || !Array.isArray(raw.libraries)) throw new LauncherError('INTEGRITY', '版本描述不完整。')
    const java = javaRequirement(raw)
    return { id, metadataPath, raw, javaMajor: java.major, javaComponent: java.component }
  }
}
