import { Version, type ResolvedVersion as CoreVersion } from '@xmcl/core'
import { resolveLibraryDownloadUrls } from '@xmcl/installer'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Store, validVersion } from '../storage/store'
import { assertManagedPath } from '../storage/paths'
import { LauncherError, publicError } from '../errors'
import type { AppError, InstallProgress } from '../../shared/contracts'
import { MetadataService, type ResolvedVersion } from './metadata'
import { downloadFile, fileValid, inParallel, type DownloadFile } from './download'
import { resolveJava } from './java'
import { LoaderService } from './loaders'

export class InstallService {
  readonly loaders: LoaderService
  progress: InstallProgress | null = null
  private controller: AbortController | null = null
  private completion: Promise<void> = Promise.resolve()
  constructor(private store: Store, private metadata: Pick<MetadataService, 'resolve'>, private changed: () => void, private report: (error: AppError) => void, private running: (id: string) => boolean) { this.loaders = new LoaderService(() => store.config.gameRoot) }
  isBusy(id?: string): boolean { return !!this.controller && (!id || this.progress?.instanceId === id) }
  private update(stage: InstallProgress['stage'], completed = 0, total: number | null = null, unit: 'bytes' | 'files' = 'files'): void {
    if (!this.progress) return
    this.progress = { ...this.progress, stage, completed, total, unit }; this.changed()
  }
  async plan(version: ResolvedVersion, signal: AbortSignal): Promise<{ core: CoreVersion; files: DownloadFile[] }> {
    const root = this.store.config.gameRoot
    const shared = join(root, 'shared')
    const core = await Version.parse(shared, version.id, { name: 'windows', arch: 'x64', version: '' })
    const files: DownloadFile[] = [{ ...version.raw.downloads.client, path: join(shared, 'versions', version.id, `${version.id}.jar`) }]
    for (const library of core.libraries) {
      const download = library.download
      const urls = resolveLibraryDownloadUrls(library, {})
      const libraryPath = await assertManagedPath(join(shared, 'libraries'), join(shared, 'libraries', download.path))
      files.push({ url: download.url || urls[0], path: libraryPath, sha1: download.sha1, size: download.size })
    }
    const index = version.raw.assetIndex
    if (!validVersion(index.id)) throw new LauncherError('INTEGRITY', '资源索引标识无效。')
    const indexPath = join(shared, 'assets', 'indexes', `${index.id}.json`)
    await downloadFile(root, { ...index, path: indexPath }, signal, () => {})
    const assets = JSON.parse(await readFile(indexPath, 'utf8')) as { objects: Record<string, { hash: string; size: number }> }
    if (!assets.objects || typeof assets.objects !== 'object') throw new LauncherError('INTEGRITY', '资源索引格式无效。')
    const seen = new Set<string>()
    for (const asset of Object.values(assets.objects)) {
      if (!/^[a-f0-9]{40}$/.test(asset.hash)) throw new LauncherError('INTEGRITY', '资源摘要无效。')
      if (seen.has(asset.hash)) continue
      seen.add(asset.hash)
      files.push({ url: `https://resources.download.minecraft.net/${asset.hash.slice(0, 2)}/${asset.hash}`, path: join(shared, 'assets', 'objects', asset.hash.slice(0, 2), asset.hash), sha1: asset.hash, size: asset.size })
    }
    for (const file of files) await assertManagedPath(root, file.path)
    return { core, files }
  }
  async start(id: string): Promise<void> {
    if (this.isBusy() || this.running(id)) throw new LauncherError('BUSY', '请先停止游戏或等待当前安装完成。')
    const instance = this.store.getInstance(id)
    const controller = new AbortController()
    this.controller = controller
    this.progress = { instanceId: id, stage: 'metadata', completed: 0, total: null, unit: 'files' }
    this.changed()
    this.completion = (async () => {
      try {
        instance.installation = 'incomplete'; await this.store.commit()
        controller.signal.throwIfAborted()
        const version = await this.metadata.resolve(instance.versionId, controller.signal)
        this.update('java')
        const java = await resolveJava(this.store.config.gameRoot, version, this.store.settings(id).javaPath, controller.signal, (completed, total) => this.update('java', completed, total))
        const { files } = await this.plan(version, controller.signal)
        let completed = 0
        const total = files.reduce((sum, file) => sum + file.size, 0)
        this.update('files', completed, total, 'bytes')
        await inParallel(files, async file => { await downloadFile(this.store.config.gameRoot, file, controller.signal, bytes => { completed += bytes; this.update('files', completed, total, 'bytes') }) }, controller.signal)
        if (instance.loader) {
          this.update('loader')
          instance.launchVersionId = await this.loaders.install(instance, java.executable, controller.signal, (_stage, completed, total) => this.update('loader', completed, total, 'bytes'))
        }
        this.update('verify')
        controller.signal.throwIfAborted()
        instance.installation = 'ready'; await this.store.commit()
        this.update('complete', files.length, files.length)
      } catch (error) {
        instance.installation = 'incomplete'
        await this.store.commit().catch(() => {})
        if (!controller.signal.aborted) this.report(publicError(error, 'install'))
      } finally { this.controller = null; this.progress = null; this.changed() }
    })()
  }
  async cancel(): Promise<void> { this.controller?.abort(); await this.completion }
  async wait(): Promise<void> { await this.completion }
  async verifyInstance(id: string, signal: AbortSignal): Promise<boolean> {
    const instance = this.store.getInstance(id)
    if (instance.installation !== 'ready') return false
    const version = await this.metadata.resolve(instance.versionId, signal)
    const { files } = await this.plan(version, signal)
    let valid = true
    await inParallel(files, async file => { await assertManagedPath(this.store.config.gameRoot, file.path); if (!await fileValid(file)) valid = false }, signal)
    if (!await this.loaders.verify(instance)) valid = false
    if (!valid) { instance.installation = 'incomplete'; await this.store.commit(); this.changed() }
    return valid
  }
}
