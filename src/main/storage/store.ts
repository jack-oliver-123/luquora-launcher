import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { totalmem } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AppConfig, Instance, LaunchSettings, LocalProfile } from '../../shared/contracts'
import { createLocalProfile } from '../auth/local'
import { LauncherError } from '../errors'
import { assertManagedPath, ensureManagedDirectory } from './paths'

export const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
export const validVersion = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value) && !value.includes('..')

export function validateSettings(settings: LaunchSettings): void {
  if (!settings || Object.keys(settings).some(key => !['memoryMiB', 'width', 'height', 'fullscreen', 'javaPath'].includes(key)) || !Number.isInteger(settings.memoryMiB) || settings.memoryMiB < 256 || settings.memoryMiB > Math.floor(totalmem() / 1048576 * 0.8) || !Number.isInteger(settings.width) || !Number.isInteger(settings.height) || settings.width < 320 || settings.width > 16384 || settings.height < 320 || settings.height > 16384 || typeof settings.fullscreen !== 'boolean' || !(settings.javaPath === null || typeof settings.javaPath === 'string' && isAbsolute(settings.javaPath))) throw new LauncherError('INVALID_INPUT', '启动设置无效。', '检查内存、窗口大小和 Java 路径。')
}

function validateConfig(config: AppConfig): void {
  if (!config || config.schemaVersion !== 1 || !isAbsolute(config.gameRoot) || !Array.isArray(config.instances) || !(config.selectedInstanceId === null || validId(config.selectedInstanceId)) || !(config.selectedAccountId === null || typeof config.selectedAccountId === 'string') || new Set(config.instances.map(instance => instance.id)).size !== config.instances.length) throw new Error('invalid config')
  validateSettings(config.defaults)
  if (!Array.isArray(config.localProfiles) || new Set(config.localProfiles.map(profile => profile.name?.toLowerCase())).size !== config.localProfiles.length) throw new Error('invalid local profiles')
  for (const profile of config.localProfiles) {
    const expected = createLocalProfile(profile.name)
    if (profile.name !== expected.name || profile.uuid !== expected.uuid || profile.id !== expected.id || profile.kind !== 'local' || profile.status !== 'ready') throw new Error('invalid local profile')
  }
  for (const instance of config.instances) {
    if (!validId(instance.id) || !validVersion(instance.versionId) || typeof instance.name !== 'string' || !instance.name.trim() || instance.name.length > 80 || !['incomplete', 'ready'].includes(instance.installation) || !Number.isFinite(Date.parse(instance.createdAt)) || !instance.overrides || Array.isArray(instance.overrides)) throw new Error('invalid instance')
    validateSettings({ ...config.defaults, ...instance.overrides })
  }
}

export class Store {
  private queue: Promise<unknown> = Promise.resolve()
  private persisted: string
  private constructor(public userData: string, public config: AppConfig) { this.persisted = JSON.stringify(config, null, 2) }
  static async open(userData: string): Promise<Store> {
    await mkdir(userData, { recursive: true })
    let config: AppConfig
    try { config = JSON.parse(await readFile(join(userData, 'config.json'), 'utf8')); if (config && !Object.hasOwn(config, 'localProfiles')) config.localProfiles = []; validateConfig(config) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new LauncherError('CONFIG_CORRUPT', '配置无法读取，原文件已保留。', '备份 config.json 后修复内容，或将其改名以重新初始化。')
      const memoryMiB = Math.min(4096, Math.max(1024, Math.floor(totalmem() / 1048576 / 4 / 256) * 256))
      config = { schemaVersion: 1, gameRoot: join(userData, 'game-data'), defaults: { memoryMiB, width: 1280, height: 720, fullscreen: false, javaPath: null }, selectedAccountId: null, selectedInstanceId: null, instances: [], localProfiles: [] }
    }
    const store = new Store(userData, config)
    await mkdir(config.gameRoot, { recursive: true })
    await store.commit()
    return store
  }
  async commit(): Promise<void> {
    validateConfig(this.config)
    const snapshot = JSON.stringify(this.config, null, 2)
    const operation = this.queue.catch(() => undefined).then(async () => {
      const destination = join(this.userData, 'config.json')
      const temporary = `${destination}.${randomUUID()}.tmp`
      try { await writeFile(temporary, snapshot, { flag: 'wx' }); await rename(temporary, destination); this.persisted = snapshot }
      catch (error) { if (JSON.stringify(this.config, null, 2) === snapshot) Object.assign(this.config, JSON.parse(this.persisted)); throw error }
      finally { await rm(temporary, { force: true }) }
    })
    this.queue = operation
    await operation
  }
  getInstance(id: string): Instance {
    const instance = this.config.instances.find(item => item.id === id)
    if (!instance || !validId(id)) throw new LauncherError('INVALID_INPUT', '实例不存在。')
    return instance
  }
  instancePath(id: string): string { this.getInstance(id); return join(this.config.gameRoot, 'instances', id) }
  settings(id: string): LaunchSettings { return { ...this.config.defaults, ...this.getInstance(id).overrides } }
  async addLocalProfile(name: string): Promise<LocalProfile> {
    const profile = createLocalProfile(name)
    if (this.config.localProfiles.some(item => item.name.toLowerCase() === profile.name.toLowerCase())) throw new LauncherError('INVALID_INPUT', '已有同名本地角色，请直接选择使用。')
    this.config.localProfiles.push(profile)
    this.config.selectedAccountId = profile.id
    await this.commit()
    return profile
  }
  async removeLocalProfile(id: string, fallbackId: string | null = null): Promise<void> {
    if (!this.config.localProfiles.some(profile => profile.id === id)) throw new LauncherError('INVALID_INPUT', '本地角色不存在。')
    this.config.localProfiles = this.config.localProfiles.filter(profile => profile.id !== id)
    if (this.config.selectedAccountId === id) this.config.selectedAccountId = this.config.localProfiles[0]?.id ?? fallbackId
    await this.commit()
  }
  async createInstance(name: string, versionId: string): Promise<Instance> {
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || !validVersion(versionId)) throw new LauncherError('INVALID_INPUT', '请输入有效名称和游戏版本。')
    const instance: Instance = { id: randomUUID(), name: name.trim(), versionId, createdAt: new Date().toISOString(), installation: 'incomplete', overrides: {} }
    await ensureManagedDirectory(this.config.gameRoot, join(this.config.gameRoot, 'instances', instance.id, 'game'))
    this.config.instances.push(instance)
    this.config.selectedInstanceId = instance.id
    await this.commit()
    return instance
  }
  async updateInstance(id: string, patch: { name?: string; overrides?: Partial<LaunchSettings> }): Promise<Instance> {
    const instance = this.getInstance(id)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['name', 'overrides'].includes(key)) || (Object.hasOwn(patch, 'overrides') && (!patch.overrides || typeof patch.overrides !== 'object' || Array.isArray(patch.overrides))) || (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 80))) throw new LauncherError('INVALID_INPUT', '实例设置无效。')
    const updated = { ...instance, ...patch, name: patch.name?.trim() ?? instance.name, overrides: patch.overrides ?? instance.overrides }
    validateSettings({ ...this.config.defaults, ...updated.overrides })
    Object.assign(instance, updated)
    await this.commit()
    return instance
  }
  async saveSettings(settings: LaunchSettings): Promise<void> { validateSettings(settings); this.config.defaults = { ...settings }; await this.commit() }
  async removeInstance(id: string, trash: (path: string) => Promise<void>): Promise<void> {
    const directory = await assertManagedPath(this.config.gameRoot, this.instancePath(id))
    await trash(directory)
    this.config.instances = this.config.instances.filter(instance => instance.id !== id)
    if (this.config.selectedInstanceId === id) this.config.selectedInstanceId = this.config.instances[0]?.id ?? null
    await this.commit()
  }
}
