import { open, type Entry, type ZipFile } from 'yauzl'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform, Writable, type Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import type { LoaderSpec } from '../../shared/content'
import { LauncherError } from '../errors'
import { validFilename } from './catalog'
import { checkDownloadUrl, CONTENT_HOSTS } from '../game/download'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'
import { validVersion } from '../storage/store'

const MAX_FILE = 2 * 1024 ** 3
const MAX_TOTAL = 20 * 1024 ** 3
export function safePackPath(path: string, protectUserFiles = true): string {
  if (typeof path !== 'string' || path.length > 240 || path.includes('\\') || path.split('/').some(part => !validFilename(part))) throw new LauncherError('INTEGRITY', `整合包路径无效：${String(path).slice(0, 180)}`)
  if (protectUserFiles && /^(saves|screenshots|logs|crash-reports)(\/|$)/i.test(path)) throw new LauncherError('INTEGRITY', '整合包不能覆盖存档、截图或日志。')
  return path
}
export type PackFile = { path: string; hashes: { sha1?: string; sha512?: string }; downloads: string[]; fileSize: number; env?: { client?: 'required' | 'optional' | 'unsupported'; server?: string } }
export type PackArchive = { source: string; hash: string; name: string; version: string; gameVersion: string; loader?: LoaderSpec; files: PackFile[]; overrides: { entry: string; path: string; size: number }[] }

async function streamEntry(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)))
}
async function scan(path: string, signal: AbortSignal, consume: (zip: ZipFile, entry: Entry) => Promise<void>): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => open(path, { lazyEntries: true, autoClose: false, strictFileNames: true }, (error, zip) => {
    if (error) { reject(error); return }
    let count = 0
    let total = 0
    let ended = false
    const names = new Set<string>()
    const finish = (failure?: unknown) => { if (ended) return; ended = true; signal.removeEventListener('abort', abort); zip.close(); failure ? reject(failure) : resolve() }
    const abort = () => finish(signal.reason ?? new Error('cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    zip.on('error', finish)
    zip.on('end', () => finish())
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        signal.throwIfAborted()
        const name = entry.fileName.replace(/\/$/, '')
        safePackPath(name, false)
        if (names.has(name.toLowerCase())) throw new LauncherError('INTEGRITY', 'ZIP 包含重复或大小写冲突的条目。')
        names.add(name.toLowerCase())
        total += entry.uncompressedSize
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000
        if (++count > 100000 || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > MAX_FILE || total > MAX_TOTAL || mode === 0xa000 || entry.isEncrypted()) throw new LauncherError('INTEGRITY', 'ZIP 包含链接、加密内容或超过展开限制。')
        if (!entry.fileName.endsWith('/')) await consume(zip, entry)
        if (!ended) zip.readEntry()
      })().catch(finish)
    })
    zip.readEntry()
  }))
}
function checkedStream(entry: Entry): Transform {
  let count = 0
  let checksum = 0
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    count += chunk.length; checksum = crc32(chunk, checksum)
    callback(count > entry.uncompressedSize ? new LauncherError('INTEGRITY', 'ZIP 展开尺寸不符。') : null, chunk)
  }, flush(callback) { callback(count !== entry.uncompressedSize || checksum !== entry.crc32 ? new LauncherError('INTEGRITY', 'ZIP 文件 CRC 校验失败。') : undefined) } })
}
export async function readPack(path: string, signal: AbortSignal): Promise<PackArchive> {
  const { hashFile } = await import('../game/loaders')
  const hash = await hashFile(path)
  let raw: unknown
  const overrides = new Map<string, { entry: string; path: string; size: number }>()
  await scan(path, signal, async (zip, entry) => {
    if (entry.fileName === 'modrinth.index.json') {
      if (entry.uncompressedSize > 16 * 1024 * 1024) throw new LauncherError('INTEGRITY', '整合包清单过大。')
      const chunks: Buffer[] = []
      await pipeline(await streamEntry(zip, entry), checkedStream(entry), new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } }), { signal })
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    const prefix = entry.fileName.startsWith('client-overrides/') ? 'client-overrides/' : entry.fileName.startsWith('overrides/') ? 'overrides/' : null
    if (prefix) {
      const target = safePackPath(entry.fileName.slice(prefix.length))
      const previous = overrides.get(target.toLowerCase())
      if (!previous || prefix === 'client-overrides/') overrides.set(target.toLowerCase(), { entry: entry.fileName, path: target, size: entry.uncompressedSize })
    }
  })
  const index = raw as { formatVersion: number; game: string; name: string; versionId: string; files: PackFile[]; dependencies: Record<string, string> }
  if (!index || index.formatVersion !== 1 || index.game !== 'minecraft' || typeof index.name !== 'string' || !index.name.trim() || index.name.length > 200 || typeof index.versionId !== 'string' || index.versionId.length > 200 || !Array.isArray(index.files) || index.files.length > 100000 || !index.dependencies || !validVersion(index.dependencies.minecraft)) throw new LauncherError('INTEGRITY', '不是受支持的 Modrinth 整合包清单。')
  const loaders: Record<string, LoaderSpec['kind']> = { 'fabric-loader': 'fabric', forge: 'forge', neoforge: 'neoforge', 'quilt-loader': 'quilt' }
  let loader: LoaderSpec | undefined
  for (const [dependency, version] of Object.entries(index.dependencies)) {
    if (dependency === 'minecraft') continue
    if (!loaders[dependency] || loader || !validVersion(version)) throw new LauncherError('INVALID_INPUT', '整合包要求未知或多种加载器。')
    loader = { kind: loaders[dependency], version }
  }
  const seen = new Set<string>()
  let total = 0
  for (const file of index.files) {
    safePackPath(file.path)
    const key = file.path.toLowerCase()
    if (seen.has(key)) throw new LauncherError('INTEGRITY', '整合包包含重复文件。')
    seen.add(key)
    total += file.fileSize
    if (!Number.isSafeInteger(file.fileSize) || file.fileSize < 0 || file.fileSize > MAX_FILE || total > MAX_TOTAL || !Array.isArray(file.downloads) || !file.downloads.length || file.downloads.length > 8 || !(file.hashes?.sha512 && /^[a-f0-9]{128}$/i.test(file.hashes.sha512) || file.hashes?.sha1 && /^[a-f0-9]{40}$/i.test(file.hashes.sha1)) || file.env?.client && !['required', 'optional', 'unsupported'].includes(file.env.client)) throw new LauncherError('INTEGRITY', '整合包文件元数据无效。')
    for (const url of file.downloads) checkDownloadUrl(url, CONTENT_HOSTS)
  }
  return { source: path, hash, name: index.name, version: index.versionId, gameVersion: index.dependencies.minecraft, loader, files: index.files, overrides: [...overrides.values()] }
}
export async function extractOverrides(pack: PackArchive, target: string, signal: AbortSignal): Promise<void> {
  const { hashFile } = await import('../game/loaders')
  if (await hashFile(pack.source) !== pack.hash) throw new LauncherError('INTEGRITY', '整合包在预览后已改变，请重新导入。')
  await mkdir(target, { recursive: true })
  const wanted = new Map(pack.overrides.map(item => [item.entry, item.path]))
  await scan(pack.source, signal, async (zip, entry) => {
    const relative = wanted.get(entry.fileName)
    if (!relative) return
    const destination = await assertManagedPath(target, join(target, safePackPath(relative)))
    if (dirname(destination) !== target) await ensureManagedDirectory(target, dirname(destination))
    await pipeline(await streamEntry(zip, entry), checkedStream(entry), createWriteStream(destination), { signal })
  })
}
