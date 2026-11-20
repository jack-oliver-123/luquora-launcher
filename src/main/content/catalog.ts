import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ContentFile, ContentProject, ContentVersion, ManagedContent, ResourcePlan, SearchQuery, SearchResult } from '../../shared/content'
import type { Instance } from '../../shared/contracts'
import { LauncherError } from '../errors'
import { checkDownloadUrl, CONTENT_HOSTS } from '../game/download'
import { validVersion } from '../storage/store'

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
export const contentFolder = (kind: string) => kind === 'mod' ? 'mods' : kind === 'resourcepack' ? 'resourcepacks' : kind === 'shader' ? 'shaderpacks' : null
export function validFilename(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 180 && !/[\\/:\x00-\x1f<>"|?*]/.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) && name !== '.' && name !== '..'
}
export function chooseFile(version: ContentVersion): ContentFile {
  if (!Array.isArray(version.files)) throw new LauncherError('INTEGRITY', '资源缺少文件列表。')
  const primary = version.files.filter(file => file.primary)
  const file = primary.length === 1 ? primary[0] : version.files.length === 1 ? version.files[0] : null
  if (!file) throw new LauncherError('INVALID_INPUT', '该版本含多个构建且没有唯一主文件，请在平台确认所需构建。')
  if (!validFilename(file.filename) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 2 * 1024 ** 3 || !(file.hashes?.sha512 && /^[a-f0-9]{128}$/i.test(file.hashes.sha512) || file.hashes?.sha1 && /^[a-f0-9]{40}$/i.test(file.hashes.sha1))) throw new LauncherError('INTEGRITY', '资源文件元数据无效。')
  checkDownloadUrl(file.url, CONTENT_HOSTS)
  return file
}
export class CatalogService {
  constructor(private request: typeof fetch = fetch) {}
  private async get<T>(path: string, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.getOnce<T>(path, signal) }
      catch (error) {
        signal.throwIfAborted()
        const retry = error instanceof TypeError || error instanceof LauncherError && error.code === 'NETWORK' && /5\d\d/.test(error.message)
        if (!retry || attempt >= 2) throw error instanceof TypeError ? new LauncherError('NETWORK', '无法连接 Modrinth，请检查网络后重试。') : error
        await delay(500 * (attempt + 1), undefined, { signal })
      }
    }
  }
  private async getOnce<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await this.request(`https://api.modrinth.com/v2/${path}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), headers: { 'User-Agent': 'LuquoraLauncher/0.2.0' } })
    if (!response.ok) throw new LauncherError('NETWORK', response.status === 429 ? 'Modrinth 请求过于频繁，请稍后重试。' : `Modrinth 请求失败（${response.status}）。`)
    const reader = response.body?.getReader()
    if (!reader) throw new LauncherError('INTEGRITY', '资源响应为空。')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 16 * 1024 * 1024) throw new LauncherError('INTEGRITY', '资源响应过大。')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  }
  async search(query: SearchQuery, signal: AbortSignal): Promise<SearchResult> {
    if (!query || typeof query.query !== 'string' || query.query.length > 200 || !['mod', 'modpack', 'resourcepack', 'shader'].includes(query.kind) || query.gameVersion && !validVersion(query.gameVersion) || query.loader && !['fabric', 'forge', 'neoforge', 'quilt'].includes(query.loader) || !Number.isSafeInteger(query.offset ?? 0) || (query.offset ?? 0) < 0 || (query.offset ?? 0) > 10000) throw new LauncherError('INVALID_INPUT', '资源搜索条件无效。')
    const facets = [[`project_type:${query.kind}`]]
    if (query.gameVersion) facets.push([`versions:${query.gameVersion}`])
    if (query.loader) facets.push([`categories:${query.loader}`])
    const params = new URLSearchParams({ query: query.query, facets: JSON.stringify(facets), offset: String(query.offset ?? 0), limit: '20', index: 'relevance' })
    const result = await this.get<SearchResult>(`search?${params}`, signal)
    if (!Array.isArray(result.hits) || !Number.isSafeInteger(result.total_hits)) throw new LauncherError('INTEGRITY', '搜索响应无效。')
    return result
  }
  async project(id: string, signal: AbortSignal): Promise<ContentProject> {
    if (!validId(id)) throw new LauncherError('INVALID_INPUT', '项目标识无效。')
    const project = await this.get<ContentProject>(`project/${id}`, signal)
    if (!validId(project.id) || typeof project.title !== 'string' || !['mod', 'modpack', 'resourcepack', 'shader'].includes(project.project_type)) throw new LauncherError('INTEGRITY', '项目描述无效。')
    return project
  }
  async version(id: string, signal: AbortSignal): Promise<ContentVersion> {
    if (!validId(id)) throw new LauncherError('INVALID_INPUT', '资源版本标识无效。')
    const version = await this.get<ContentVersion>(`version/${id}`, signal)
    if (version.id !== id || !validId(version.project_id) || !Array.isArray(version.game_versions) || !Array.isArray(version.loaders) || !Array.isArray(version.dependencies)) throw new LauncherError('INTEGRITY', '资源版本响应无效。')
    return version
  }
  async versions(id: string, gameVersion: string | undefined, loader: string | undefined, signal: AbortSignal): Promise<ContentVersion[]> {
    if (!validId(id) || gameVersion && !validVersion(gameVersion) || loader && !['fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) throw new LauncherError('INVALID_INPUT', '版本筛选无效。')
    const params = new URLSearchParams()
    if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
    if (loader) params.set('loaders', JSON.stringify([loader]))
    const versions = await this.get<ContentVersion[]>(`project/${id}/version?${params}`, signal)
    if (!Array.isArray(versions) || versions.length > 10000) throw new LauncherError('INTEGRITY', '版本列表无效。')
    return versions.sort((left, right) => Number(right.version_type === 'release') - Number(left.version_type === 'release'))
  }
  async identify(sha512: string, signal: AbortSignal): Promise<ContentVersion | null> {
    if (!/^[a-f0-9]{128}$/.test(sha512)) throw new LauncherError('INVALID_INPUT', '文件摘要无效。')
    try { return await this.get<ContentVersion>(`version_file/${sha512}?algorithm=sha512`, signal) }
    catch (error) { if (error instanceof LauncherError && error.message.includes('404')) return null; throw error }
  }
  async plan(versionId: string, instance: Pick<Instance, 'id' | 'versionId' | 'loader'>, installed: ManagedContent[], signal: AbortSignal): Promise<ResourcePlan> {
    const plan: ResourcePlan = { id: randomUUID(), instanceId: instance.id, title: '', files: [] }
    const visited = new Map<string, string>()
    const visiting = new Set<string>()
    const incompatible = new Set<string>()
    const visit = async (id: string) => {
      signal.throwIfAborted()
      if (visiting.has(id)) throw new LauncherError('INTEGRITY', '资源存在循环依赖。')
      if (plan.files.length + visiting.size >= 200) throw new LauncherError('INTEGRITY', '必要依赖数量超过上限。')
      const version = await this.version(id, signal)
      const previous = visited.get(version.project_id)
      if (previous) { if (previous !== id) throw new LauncherError('INVALID_INPUT', '依赖要求同一项目的不同版本。'); return }
      const project = await this.project(version.project_id, signal)
      const folder = contentFolder(project.project_type)
      if (!folder || project.client_side === 'unsupported') throw new LauncherError('INVALID_INPUT', '该资源不能安装到客户端。')
      if (!version.game_versions.includes(instance.versionId) || project.project_type === 'mod' && (!instance.loader || !version.loaders.includes(instance.loader.kind))) throw new LauncherError('INVALID_INPUT', `${project.title} 与目标游戏或加载器不兼容。`)
      visiting.add(id)
      for (const dependency of version.dependencies) {
        if (dependency.dependency_type === 'incompatible') {
          const target = dependency.project_id ?? (dependency.version_id ? (await this.version(dependency.version_id, signal)).project_id : null)
          if (target) incompatible.add(target)
        }
        if (dependency.dependency_type !== 'required') continue
        let next = dependency.version_id
        if (!next && dependency.project_id) next = (await this.versions(dependency.project_id, instance.versionId, instance.loader?.kind, signal))[0]?.id ?? null
        if (!next) throw new LauncherError('INVALID_INPUT', `${project.title} 缺少兼容的必要依赖。`)
        await visit(next)
      }
      visiting.delete(id)
      visited.set(version.project_id, id)
      const file = chooseFile(version)
      if (project.project_type === 'mod' && !file.filename.endsWith('.jar') || project.project_type !== 'mod' && !file.filename.endsWith('.zip')) throw new LauncherError('INVALID_INPUT', '资源文件类型不符合客户端要求。')
      const existing = installed.find(item => item.projectId === project.id)
      const disabled = existing?.disabled ? '.disabled' : ''
      plan.files.push({ project, version, file, path: `${folder}/${file.filename}${disabled}`, ...(existing ? { replaces: existing.path } : {}) })
      if (id === versionId) plan.title = project.title
    }
    await visit(versionId)
    if ([...visited.keys(), ...installed.map(item => item.projectId)].some(id => id && incompatible.has(id))) throw new LauncherError('INVALID_INPUT', '所选资源与已安装项目存在不兼容依赖。')
    if (new Set(plan.files.map(item => item.path.toLowerCase())).size !== plan.files.length) throw new LauncherError('INTEGRITY', '资源依赖包含同名文件。')
    return plan
  }
}
