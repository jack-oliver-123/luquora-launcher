import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import type { Instance } from '../../shared/contracts'
import type { ContentKind, ContentListing, ContentTask, ManagedContent, PackPreview, ResourcePlan } from '../../shared/content'
import { Store, validVersion, validateLoader } from '../storage/store'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'
import { InstallService } from '../game/install'
import { hashFile } from '../game/loaders'
import { CONTENT_HOSTS, downloadFile, inParallel } from '../game/download'
import { LauncherError } from '../errors'
import { CatalogService, chooseFile, contentFolder, validFilename } from './catalog'
import { readPack, extractOverrides, safePackPath, type PackArchive } from './archive'
import { FileTransactions, maybeHash, mergePackFiles, type FileChange } from './transactions'

type Manifest = { schemaVersion: 1; files: ManagedContent[]; pack?: { name: string; version: string; projectId?: string; versionId?: string; files: Record<string, string> } }
type PackRecord = { preview: PackPreview; pack: PackArchive; projectId?: string; versionId?: string; target?: string; expires: number }
type InstanceState = Pick<Instance, 'versionId' | 'loader' | 'launchVersionId' | 'installation'>
const planFiles = (plan: ResourcePlan) => JSON.stringify(plan.files.map(item => ({ project: item.project.id, version: item.version.id, file: { filename: item.file.filename, url: item.file.url, size: item.file.size, sha1: item.file.hashes.sha1, sha512: item.file.hashes.sha512 }, path: item.path, replaces: item.replaces })))

export class ContentService {
  readonly tasks: ContentTask[] = []
  private controllers = new Map<string, AbortController>()
  private tail: Promise<unknown> = Promise.resolve()
  private previews = new Map<string, { plan: ResourcePlan; versionId: string; baseline: string; expires: number }>()
  private packs = new Map<string, PackRecord>()
  private blocked = new Set<string>()
  constructor(private store: Store, private installer: InstallService, private changed: () => void, private gameBlocks: (id: string) => boolean, private trash: (path: string) => Promise<void>, readonly catalog = new CatalogService()) {}
  get busy(): boolean { return this.controllers.size > 0 }
  blocksInstance(id: string): boolean { return this.blocked.has(id) || this.tasks.some(task => task.instanceId === id && ['queued', 'running'].includes(task.phase)) }
  assertIdle(id?: string): void {
    if (id && this.store.getInstance(id).staging) throw new LauncherError('BUSY', '整合包实例尚未完成安装。')
    if (this.installer.isBusy() || id && (this.gameBlocks(id) || this.blocked.has(id))) throw new LauncherError('BUSY', '实例正在使用或等待恢复，请先结束当前任务。')
  }
  private async manifest(id: string): Promise<Manifest> {
    const path = await assertManagedPath(this.store.config.gameRoot, join(this.store.instancePath(id), 'content.json'))
    try {
      const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw new Error('manifest')
      for (const file of manifest.files) if (!/^[a-f0-9]{128}$/.test(file.sha512) || !contentFolder(file.kind) || !file.path.startsWith(`${contentFolder(file.kind)}/`)) throw new Error('entry')
      for (const file of manifest.files) safePackPath(file.path)
      if (manifest.pack) for (const [path, hash] of Object.entries(manifest.pack.files)) { safePackPath(path); if (!/^[a-f0-9]{128}$/.test(hash)) throw new Error('pack hash') }
      return manifest
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, files: [] }; throw new LauncherError('CONFIG_CORRUPT', '实例资源清单损坏，原文件已保留。') }
  }
  private async syncInstance(id: string): Promise<void> {
    const path = await assertManagedPath(this.store.config.gameRoot, join(this.store.instancePath(id), 'instance-state.json'))
    let state: InstanceState
    try { state = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    validateLoader(state.loader)
    if (!validVersion(state.versionId) || state.launchVersionId && !validVersion(state.launchVersionId) || !['ready', 'incomplete'].includes(state.installation)) throw new LauncherError('CONFIG_CORRUPT', '实例恢复版本信息无效。')
    const instance = this.store.getInstance(id)
    instance.versionId = state.versionId; instance.installation = state.installation
    if (state.loader) instance.loader = state.loader; else delete instance.loader
    if (state.launchVersionId) instance.launchVersionId = state.launchVersionId; else delete instance.launchVersionId
    await this.store.commit()
  }
  async initialize(): Promise<void> {
    const failed: string[] = []
    for (const instance of this.store.config.instances) {
      try { await new FileTransactions(this.store.instancePath(instance.id)).recover(); await this.syncInstance(instance.id) }
      catch { this.blocked.add(instance.id); failed.push(instance.name) }
    }
    if (failed.length) throw new LauncherError('CONFIG_CORRUPT', `以下实例需要恢复后才能使用：${failed.join('、')}。`)
  }
  async run<T>(title: string, instanceId: string | undefined, operation: (signal: AbortSignal, task: ContentTask) => Promise<T>): Promise<T> {
    this.assertIdle(instanceId)
    const controller = new AbortController()
    const task: ContentTask = { id: randomUUID(), title, instanceId, phase: 'queued', stage: '等待执行', completed: 0, total: null, startedAt: new Date().toISOString() }
    this.tasks.push(task); this.controllers.set(task.id, controller)
    if (this.tasks.length > 100) { const index = this.tasks.findIndex(item => !['queued', 'running'].includes(item.phase)); if (index >= 0) this.tasks.splice(index, 1) }
    this.changed()
    const operationPromise = this.tail.catch(() => {}).then(async () => {
      try {
        controller.signal.throwIfAborted(); this.assertIdle(instanceId)
        task.phase = 'running'; task.stage = '准备文件'; this.changed()
        const result = await operation(controller.signal, task)
        task.phase = 'complete'; task.stage = '已完成'; this.changed()
        return result
      } catch (error) {
        task.phase = controller.signal.aborted ? 'cancelled' : 'failed'
        task.error = controller.signal.aborted ? undefined : error instanceof LauncherError ? error.message : '操作失败，请检查网络或目录权限后重试。'
        task.stage = controller.signal.aborted ? '已取消' : '未完成'; this.changed()
        throw error
      } finally { this.controllers.delete(task.id); this.changed() }
    })
    this.tail = operationPromise.catch(() => {})
    return operationPromise
  }
  async cancel(id?: string): Promise<void> {
    if (id) this.controllers.get(id)?.abort(); else for (const controller of this.controllers.values()) controller.abort()
    await this.tail
  }
  async list(id: string): Promise<ContentListing> {
    const manifest = await this.manifest(id)
    const files: ContentListing['files'] = []
    for (const kind of ['mod', 'resourcepack', 'shader'] as const) {
      const folder = contentFolder(kind)!
      const directory = await assertManagedPath(this.store.config.gameRoot, join(this.store.instancePath(id), 'game', folder))
      const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new LauncherError('INTEGRITY', '资源目录包含链接，不能修改。')
        if (!entry.isFile() || !/\.(jar|zip)(\.disabled)?$/i.test(entry.name)) continue
        const path = safePackPath(`${folder}/${entry.name}`)
        const actual = await hashFile(await assertManagedPath(this.store.config.gameRoot, join(directory, entry.name)))
        const known = manifest.files.find(item => item.path === path)
        files.push({ ...(known ?? { path, name: entry.name.replace(/\.disabled$/, ''), kind, sha512: actual }), sha512: actual, disabled: entry.name.endsWith('.disabled'), modified: !!known && known.sha512 !== actual })
      }
    }
    const transactions = new FileTransactions(this.store.instancePath(id))
    return { files, pack: manifest.pack ? { name: manifest.pack.name, version: manifest.pack.version, projectId: manifest.pack.projectId, versionId: manifest.pack.versionId } : undefined, canRestore: await transactions.canRestore(), backupsBytes: await transactions.backupSize() }
  }
  private async temporary(): Promise<string> { return ensureManagedDirectory(this.store.config.gameRoot, join(this.store.config.gameRoot, 'content-cache', randomUUID())) }
  private async commitFiles(id: string, manifest: Manifest, changes: FileChange[], directory: string, signal: AbortSignal, state?: InstanceState): Promise<void> {
    const root = this.store.instancePath(id)
    const source = join(directory, 'content-manifest.json'); await writeFile(source, JSON.stringify(manifest))
    changes.push({ path: 'content.json', source, expected: await maybeHash(join(root, 'content.json')) })
    if (state) {
      const statePath = join(directory, 'instance-state.json'); await writeFile(statePath, JSON.stringify(state))
      changes.push({ path: 'instance-state.json', source: statePath, expected: await maybeHash(join(root, 'instance-state.json')) })
    }
    await new FileTransactions(root).apply(changes, signal)
    if (state) await this.syncInstance(id)
  }
  async previewResource(id: string, versionId: string): Promise<ResourcePlan> {
    this.assertIdle(id)
    const listing = await this.list(id)
    if (listing.files.some(file => file.modified)) throw new LauncherError('INVALID_INPUT', '存在已修改的受管资源，请先备份并处理后再更新。')
    const plan = await this.catalog.plan(versionId, this.store.getInstance(id), listing.files, AbortSignal.timeout(120000))
    this.previews.set(plan.id, { plan, versionId, baseline: JSON.stringify(listing.files), expires: Date.now() + 15 * 60000 })
    return plan
  }
  async applyResource(previewId: string): Promise<void> {
    const record = this.previews.get(previewId)
    if (!record || record.expires < Date.now()) throw new LauncherError('INVALID_INPUT', '资源预览已过期，请重新选择版本。')
    const id = record.plan.instanceId
    await this.run(`安装 ${record.plan.title}`, id, async (signal, task) => {
      const listing = await this.list(id)
      if (JSON.stringify(listing.files) !== record.baseline) throw new LauncherError('INVALID_INPUT', '实例内容在预览后已改变，请重新预览。')
      const plan = await this.catalog.plan(record.versionId, this.store.getInstance(id), listing.files, signal)
      if (planFiles(plan) !== planFiles(record.plan)) throw new LauncherError('INTEGRITY', '平台版本在预览后改变，请重新预览。')
      const manifest = await this.manifest(id)
      const directory = await this.temporary()
      const changes = new Map<string, FileChange>()
      try {
        task.total = plan.files.reduce((total, item) => total + item.file.size, 0); task.stage = '下载并校验资源'; this.changed()
        await inParallel(plan.files, async item => {
          const source = join(directory, `${item.version.id}-${item.file.filename}`)
          await downloadFile(this.store.config.gameRoot, { url: item.file.url, path: source, size: item.file.size, ...item.file.hashes }, signal, bytes => { task.completed += bytes; this.changed() }, { allowedHosts: CONTENT_HOSTS })
          const existing = listing.files.find(file => file.projectId === item.project.id)
          const target = listing.files.find(file => file.path.toLowerCase() === item.path.toLowerCase())
          if (target && target !== existing) throw new LauncherError('INVALID_INPUT', `文件冲突：${item.path} 已由其他资源占用。`)
          if (existing && existing.path !== item.path) changes.set(existing.path, { path: `game/${existing.path}`, source: null, expected: existing.sha512 })
          changes.set(item.path, { path: `game/${item.path}`, source, expected: target?.sha512 ?? null })
          manifest.files = manifest.files.filter(file => file.projectId !== item.project.id && file.path !== item.path)
          manifest.files.push({ path: item.path, name: item.project.title, kind: item.project.project_type as ManagedContent['kind'], sha512: await hashFile(source), projectId: item.project.id, versionId: item.version.id, versionName: item.version.version_number, disabled: item.path.endsWith('.disabled') })
        }, signal)
        task.stage = '备份与安装'; this.changed()
        await this.commitFiles(id, manifest, [...changes.values()], directory, signal)
        this.previews.delete(previewId)
      } finally { await rm(await assertManagedPath(this.store.config.gameRoot, directory), { recursive: true, force: true }) }
    })
  }
  async toggle(id: string, path: string): Promise<void> {
    this.assertIdle(id)
    await this.run('切换模组状态', id, async signal => {
      const listing = await this.list(id)
      const file = listing.files.find(file => file.path === path)
      if (!file || file.kind !== 'mod') throw new LauncherError('INVALID_INPUT', '请选择实例中的模组。')
      const next = file.disabled ? path.slice(0, -9) : `${path}.disabled`
      if (listing.files.some(file => file.path.toLowerCase() === next.toLowerCase())) throw new LauncherError('INVALID_INPUT', '目标文件已存在。')
      const manifest = await this.manifest(id)
      manifest.files = manifest.files.filter(item => item.path !== path)
      manifest.files.push({ ...file, path: next, disabled: !file.disabled })
      const directory = await this.temporary()
      try {
        const source = join(directory, 'toggle-resource'); await copyFile(join(this.store.instancePath(id), 'game', path), source)
        await this.commitFiles(id, manifest, [{ path: `game/${path}`, source: null, expected: file.sha512 }, { path: `game/${next}`, source, expected: null }], directory, signal)
      }
      finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
  async remove(id: string, path: string): Promise<void> {
    await this.run('移除资源', id, async () => {
      const listing = await this.list(id)
      if (!listing.files.some(file => file.path === path)) throw new LauncherError('INVALID_INPUT', '资源不存在。')
      const target = await assertManagedPath(this.store.config.gameRoot, join(this.store.instancePath(id), 'game', safePackPath(path)))
      await this.trash(target)
      const manifest = await this.manifest(id); manifest.files = manifest.files.filter(file => file.path !== path)
      await writeFile(join(this.store.instancePath(id), 'content.json'), JSON.stringify(manifest))
    })
  }
  async importFile(id: string, kind: Exclude<ContentKind, 'modpack'>, source: string): Promise<void> {
    await this.run('导入本地资源', id, async signal => {
      const folder = contentFolder(kind); const filename = basename(source)
      if (!folder || !validFilename(filename) || !(kind === 'mod' ? filename.endsWith('.jar') : filename.endsWith('.zip')) || !(await stat(source)).isFile()) throw new LauncherError('INVALID_INPUT', '请选择匹配类型的 JAR 或 ZIP 文件。')
      const manifest = await this.manifest(id); const path = `${folder}/${filename}`
      const directory = await this.temporary()
      try {
        const staged = join(directory, filename); await copyFile(source, staged)
        const sha512 = await hashFile(staged)
        let identified: ManagedContent | undefined
        try {
          const version = await this.catalog.identify(sha512, AbortSignal.any([signal, AbortSignal.timeout(10000)]))
          if (version?.files.some(file => file.hashes.sha512?.toLowerCase() === sha512)) {
            const project = await this.catalog.project(version.project_id, signal)
            const instance = this.store.getInstance(id)
            if (project.project_type === kind && version.game_versions.includes(instance.versionId) && (kind !== 'mod' || !!instance.loader && version.loaders.includes(instance.loader.kind)) && project.client_side !== 'unsupported') identified = { path, name: project.title, kind, sha512, projectId: project.id, versionId: version.id, versionName: version.version_number }
          }
        } catch { signal.throwIfAborted() }
        manifest.files.push(identified ?? { path, name: filename, kind, sha512 })
        await this.commitFiles(id, manifest, [{ path: `game/${path}`, source: staged, expected: null }], directory, signal)
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
  async checkUpdates(id: string): Promise<{ projectId: string; title: string; version: string; versionId: string }[]> {
    const instance = this.store.getInstance(id)
    const listing = await this.list(id)
    const updates: { projectId: string; title: string; version: string; versionId: string }[] = []
    for (const file of listing.files) if (file.projectId) {
      const latest = (await this.catalog.versions(file.projectId, instance.versionId, file.kind === 'mod' ? instance.loader?.kind : undefined, AbortSignal.timeout(30000))).find(version => version.version_type === 'release')
      if (latest && latest.id !== file.versionId) updates.push({ projectId: file.projectId, title: file.name, version: latest.version_number, versionId: latest.id })
    }
    return updates
  }
  async previewPack(source: string, online: boolean, target?: string): Promise<PackPreview> {
    this.assertIdle(target)
    const signal = AbortSignal.timeout(180000)
    let projectId: string | undefined; let versionId: string | undefined
    if (online) {
      const version = await this.catalog.version(source, signal)
      const project = await this.catalog.project(version.project_id, signal)
      if (project.project_type !== 'modpack') throw new LauncherError('INVALID_INPUT', '请选择整合包版本。')
      if (target) { const manifest = await this.manifest(target); if (manifest.pack?.projectId !== project.id) throw new LauncherError('INVALID_INPUT', '只能更新为同一项目的整合包。') }
      const file = chooseFile(version)
      if (!file.filename.endsWith('.mrpack')) throw new LauncherError('INVALID_INPUT', '该版本没有 Modrinth 整合包文件。')
      const cache = await ensureManagedDirectory(this.store.config.gameRoot, join(this.store.config.gameRoot, 'content-cache', 'packs'))
      source = join(cache, `${version.id}.mrpack`)
      await downloadFile(this.store.config.gameRoot, { url: file.url, path: source, size: file.size, ...file.hashes }, signal, () => {}, { allowedHosts: CONTENT_HOSTS })
      projectId = project.id; versionId = version.id
    } else {
      const cache = await ensureManagedDirectory(this.store.config.gameRoot, join(this.store.config.gameRoot, 'content-cache', 'packs'))
      const destination = join(cache, `${randomUUID()}.mrpack`)
      await copyFile(source, destination); source = destination
    }
    const pack = await readPack(source, signal)
    let changes: string[] | undefined
    if (target) {
      const previous = await this.manifest(target)
      if (!previous.pack) throw new LauncherError('INVALID_INPUT', '该实例没有整合包来源。')
      const directory = await this.temporary()
      try {
        const game = join(directory, 'game'); await extractOverrides(pack, game, signal)
        const next: Record<string, string | undefined> = {}
        for (const file of pack.files.filter(file => file.env?.client !== 'unsupported' && file.env?.client !== 'optional')) next[file.path] = file.hashes.sha512?.toLowerCase()
        for (const file of pack.overrides) next[file.path] = await hashFile(join(game, file.path))
        changes = []
        for (const path of new Set([...Object.keys(previous.pack.files), ...Object.keys(next)])) {
          if (Object.hasOwn(next, path) && next[path] === previous.pack.files[path]) continue
          changes.push(`${!Object.hasOwn(next, path) ? '移除' : !Object.hasOwn(previous.pack.files, path) ? '新增' : next[path] ? '替换' : '重新校验'} · ${path}`)
        }
      } finally { await rm(directory, { recursive: true, force: true }) }
    }
    const preview: PackPreview = { id: randomUUID(), name: pack.name, version: pack.version, gameVersion: pack.gameVersion, loader: pack.loader, required: pack.files.filter(file => !file.env?.client || file.env.client === 'required').length, optional: pack.files.filter(file => file.env?.client === 'optional').map(file => file.path), changes }
    this.packs.set(preview.id, { preview, pack, projectId, versionId, target, expires: Date.now() + 30 * 60000 })
    return preview
  }
  private async preparePack(record: PackRecord, optional: string[], directory: string, signal: AbortSignal, task: ContentTask): Promise<Record<string, string>> {
    if (!Array.isArray(optional) || optional.length > 100000 || optional.some(path => !record.preview.optional.includes(path))) throw new LauncherError('INVALID_INPUT', '可选文件选择无效。')
    const files = record.pack.files.filter(file => file.env?.client !== 'unsupported' && (file.env?.client !== 'optional' || optional.includes(file.path)))
    const game = join(directory, 'game'); await mkdir(game, { recursive: true })
    task.total = files.reduce((total, file) => total + file.fileSize, 0); task.stage = '下载整合包文件'; this.changed()
    await inParallel(files, async file => {
      const path = join(game, safePackPath(file.path))
      await downloadFile(this.store.config.gameRoot, { url: file.downloads[0], path, size: file.fileSize, ...file.hashes }, signal, bytes => { task.completed += bytes; this.changed() }, { allowedHosts: CONTENT_HOSTS })
    }, signal)
    task.stage = '提取客户端配置'; this.changed()
    await extractOverrides(record.pack, game, signal)
    const hashes: Record<string, string> = {}
    for (const path of new Set([...files.map(file => file.path), ...record.pack.overrides.map(file => file.path)])) hashes[path] = await hashFile(await assertManagedPath(this.store.config.gameRoot, join(game, path)))
    return hashes
  }
  private async installGame(instance: Instance, signal: AbortSignal): Promise<void> {
    const abort = () => { void this.installer.cancel() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted(); await this.installer.start(instance.id); await this.installer.wait(); signal.throwIfAborted()
      if (instance.installation !== 'ready') throw new LauncherError('SERVICE', '游戏或加载器安装未完成，请查看错误信息并重试。')
    } finally { signal.removeEventListener('abort', abort) }
  }
  async installPack(previewId: string, name: string, optional: string[]): Promise<void> {
    const record = this.packs.get(previewId)
    if (!record || record.expires < Date.now() || record.target) throw new LauncherError('INVALID_INPUT', '整合包预览已过期，请重新选择。')
    await this.run(`安装整合包 ${record.pack.name}`, undefined, async (signal, task) => {
      const instance = this.store.config.instances.find(item => item.staging && item.name === name && item.versionId === record.pack.gameVersion && JSON.stringify(item.loader) === JSON.stringify(record.pack.loader)) ?? await this.store.createInstance(name, record.pack.gameVersion, record.pack.loader, true)
      task.instanceId = instance.id; this.changed()
      const directory = await this.temporary()
      try {
        const hashes = await this.preparePack(record, optional, directory, signal, task)
        task.stage = '安装游戏与加载器'; this.changed()
        await this.installGame(instance, signal)
        const manifest: Manifest = { schemaVersion: 1, files: [], pack: { name: record.pack.name, version: record.pack.version, projectId: record.projectId, versionId: record.versionId, files: hashes } }
        const changes = await Promise.all(Object.keys(hashes).map(async path => ({ path: `game/${path}`, source: join(directory, 'game', path), expected: await maybeHash(await assertManagedPath(this.store.config.gameRoot, join(this.store.instancePath(instance.id), 'game', path))) })))
        await this.commitFiles(instance.id, manifest, changes, directory, signal, { versionId: instance.versionId, loader: instance.loader, launchVersionId: instance.launchVersionId, installation: 'ready' })
        delete instance.staging; this.store.config.selectedInstanceId = instance.id; await this.store.commit(); this.packs.delete(previewId)
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
  async updatePack(previewId: string, optional: string[]): Promise<void> {
    const record = this.packs.get(previewId)
    if (!record || record.expires < Date.now() || !record.target) throw new LauncherError('INVALID_INPUT', '更新预览已过期，请重新选择。')
    const id = record.target
    await this.run(`更新整合包 ${record.pack.name}`, id, async (signal, task) => {
      const previous = await this.manifest(id)
      if (!previous.pack) throw new LauncherError('INVALID_INPUT', '该实例没有整合包来源。')
      const directory = await this.temporary()
      try {
        const hashes = await this.preparePack(record, optional, directory, signal, task)
        const current: Record<string, string> = {}
        for (const path of new Set([...Object.keys(previous.pack.files), ...Object.keys(hashes)])) {
          const hash = await maybeHash(await assertManagedPath(this.store.config.gameRoot, join(this.store.instancePath(id), 'game', safePackPath(path))))
          if (hash) current[path] = hash
        }
        const paths = mergePackFiles(previous.pack.files, current, hashes)
        task.stage = '准备游戏与加载器'; this.changed()
        const candidate = await this.store.createInstance(`更新准备 ${record.pack.name}`.slice(0, 80), record.pack.gameVersion, record.pack.loader, true)
        let nextState: InstanceState
        try { await this.installGame(candidate, signal); nextState = { versionId: candidate.versionId, loader: candidate.loader, launchVersionId: candidate.launchVersionId, installation: candidate.installation } }
        finally {
          const candidateRoot = await assertManagedPath(this.store.config.gameRoot, this.store.instancePath(candidate.id))
          this.store.config.instances = this.store.config.instances.filter(instance => instance.id !== candidate.id); await this.store.commit()
          await rm(candidateRoot, { recursive: true, force: true })
        }
        previous.pack = { name: record.pack.name, version: record.pack.version, projectId: record.projectId, versionId: record.versionId, files: hashes }
        previous.files = previous.files.filter(file => !paths.includes(file.path))
        task.stage = '备份与更新'; this.changed()
        await this.commitFiles(id, previous, paths.map(path => ({ path: `game/${path}`, source: hashes[path] ? join(directory, 'game', path) : null, expected: current[path] ?? null })), directory, signal, nextState!)
        this.packs.delete(previewId)
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
  async restore(id: string): Promise<void> {
    await this.run('恢复最近一次变更', id, async () => { await new FileTransactions(this.store.instancePath(id)).restore(); await this.syncInstance(id) })
  }
  async clearBackups(id: string): Promise<void> {
    await this.run('清理更新备份', id, async () => {
      const root = this.store.instancePath(id)
      await new FileTransactions(root).recover()
      const directory = await assertManagedPath(this.store.config.gameRoot, join(root, '.updates'))
      await rm(directory, { recursive: true, force: true })
    })
  }
}
