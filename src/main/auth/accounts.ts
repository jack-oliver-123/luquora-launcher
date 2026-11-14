import { PublicClientApplication, type DeviceCodeRequest } from '@azure/msal-node'
import { MicrosoftAuthenticator, MojangClient } from '@xmcl/user'
import { clipboard, net, shell } from 'electron'
import type { AccountSummary, AppError, AppEvent, AuthCode } from '../../shared/contracts'
import { LauncherError, publicError } from '../errors'
import { EncryptedCache } from './cache'

export type LaunchIdentity = { uuid: string; name: string; accessToken: string; xuid: string; clientId: string }
type AccountRecord = Omit<AccountSummary, 'kind'> & { homeAccountId: string }
const scopes = ['XboxLive.signin', 'offline_access']

export class AccountService {
  private client: PublicClientApplication | null
  private records: AccountRecord[] = []
  private request: DeviceCodeRequest | null = null
  private controller: AbortController | null = null
  private serial = 0
  private saving: Promise<void> | null = null
  private authCode: AuthCode | null = null
  get pending(): boolean { return this.controller !== null }
  constructor(private cache: EncryptedCache, readonly clientId: string, private emit: (event: AppEvent) => void, private changed: () => void) {
    this.client = clientId ? this.createClient() : null
  }
  private createClient(): PublicClientApplication { return new PublicClientApplication({ auth: { clientId: this.clientId, authority: 'https://login.microsoftonline.com/consumers' }, system: { networkClient: { sendGetRequestAsync: <T>(url: string, options?: { headers?: Record<string, string> }, timeout?: number) => this.microsoftRequest<T>('GET', url, options, timeout), sendPostRequestAsync: <T>(url: string, options?: { headers?: Record<string, string>; body?: string }) => this.microsoftRequest<T>('POST', url, options) }, loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } } }) }
  private async microsoftRequest<T>(method: 'GET' | 'POST', url: string, options?: { headers?: Record<string, string>; body?: string }, timeout = 30000): Promise<{ headers: Record<string, string>; body: T; status: number }> {
    if (new URL(url).hostname !== 'login.microsoftonline.com') throw new LauncherError('SERVICE', '微软授权地址无效。', '重新发起微软登录。', 'auth:microsoft')
    try {
      const response = await net.fetch(url, { method, headers: options?.headers, body: options?.body, cache: 'no-store', signal: AbortSignal.timeout(Math.min(Math.max(timeout, 1000), 60000)) })
      return { headers: Object.fromEntries(response.headers), body: await response.json() as T, status: response.status }
    } catch {
      throw new LauncherError('NETWORK', '无法连接 Microsoft 登录服务。', '检查网络或代理后重试；阶段 auth:microsoft，未收到令牌。', 'auth:microsoft')
    }
  }
  private microsoftFailure(error: unknown): LauncherError {
    if (error instanceof LauncherError) return error
    const record = error as { errorCode?: unknown; httpStatus?: unknown }
    if (record.errorCode === 'network_error' || record.errorCode === 'endpoints_resolution_error') return new LauncherError('NETWORK', '无法连接 Microsoft 登录服务。', '检查网络或代理后重试；阶段 auth:microsoft，未收到令牌。', 'auth:microsoft')
    if (typeof record.httpStatus === 'number' && Number.isSafeInteger(record.httpStatus)) return new LauncherError('SERVICE', `Microsoft 登录服务返回 HTTP ${record.httpStatus}。`, '将阶段 auth:microsoft 和 HTTP 状态反馈给维护者；不要提交令牌或验证码。', 'auth:microsoft')
    if (record.errorCode === 'authorization_declined' || record.errorCode === 'code_expired' || record.errorCode === 'expired_token') return new LauncherError('AUTH_EXPIRED', '微软授权未完成或已过期。', '重新发起授权，并在网页中完成登录、粘贴和确认。', 'auth:microsoft')
    return new LauncherError('AUTH_EXPIRED', '微软登录未完成。', '重新发起登录；若仍失败，将阶段 auth:microsoft 和错误名称反馈给维护者。', 'auth:microsoft')
  }
  async initialize(): Promise<void> {
    const serialized = await this.cache.load()
    if (!serialized) return
    try {
      const data = JSON.parse(serialized)
      if (data.clientId !== this.clientId) return
      if (!Array.isArray(data.records) || data.records.some((record: AccountRecord) => !record || typeof record.id !== 'string' || record.id !== record.uuid || !/^[a-f0-9]{32}$/i.test(record.uuid) || typeof record.name !== 'string' || !record.name || record.name.length > 64 || typeof record.homeAccountId !== 'string' || !record.homeAccountId)) throw new Error('invalid account cache')
      if (typeof data.msal === 'string') this.client?.getTokenCache().deserialize(data.msal)
      this.records = data.records.map((record: AccountRecord) => ({ id: record.id, uuid: record.uuid, name: record.name, homeAccountId: record.homeAccountId, status: 'reauth-required' as const }))
    } catch { throw new LauncherError('AUTH_REQUIRED', '账号缓存无法读取。', '保留原 auth.bin 并重新授权，或恢复备份。') }
  }
  list(): AccountSummary[] { return this.records.map(({ id, name, uuid, status }) => ({ id, name, uuid, status, kind: 'microsoft' })) }
  async persist(): Promise<void> { await this.cache.save(JSON.stringify({ clientId: this.clientId, records: this.records, msal: this.client?.getTokenCache().serialize() ?? '' })) }
  async beginAdd(): Promise<void> {
    if (!this.client) throw new LauncherError('AUTH_REQUIRED', 'LQL 尚未配置微软应用标识。', '按开发文档配置 LQL 自有 Microsoft client ID 后重启。')
    if (this.pending) throw new LauncherError('BUSY', '已有授权正在进行。')
    const generation = ++this.serial
    const controller = new AbortController()
    const interaction = this.createClient()
    interaction.getTokenCache().deserialize(this.client.getTokenCache().serialize())
    this.controller = controller
    const request: DeviceCodeRequest = { scopes, timeout: 900, deviceCodeCallback: response => {
      if (generation !== this.serial || controller.signal.aborted) return
      const uri = new URL(response.verificationUri)
      if (uri.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(uri.hostname)) { controller.abort(); request.cancel = true; return }
      this.authCode = { code: response.userCode, verificationUri: uri.href, expiresAt: new Date(Date.now() + response.expiresIn * 1000).toISOString(), copied: false, browserOpened: null }
      void this.openAuthPage().catch(error => { if (generation === this.serial && !controller.signal.aborted) this.emit({ type: 'error', data: publicError(error, 'auth') }) })
    } }
    this.request = request
    this.changed()
    void (async () => {
      let outcome: 'success' | 'cancelled' | 'failed' = 'failed'
      let failure: AppError | undefined
      try {
        const response = await interaction.acquireTokenByDeviceCode(request).catch(error => { throw this.microsoftFailure(error) })
        controller.signal.throwIfAborted()
        if (generation !== this.serial || !response?.account) return
        const identity = await this.exchange(response.accessToken, controller.signal)
        controller.signal.throwIfAborted()
        const record: AccountRecord = { id: identity.uuid, uuid: identity.uuid, name: identity.name, status: 'ready', homeAccountId: response.account.homeAccountId }
        const records = [...this.records.filter(item => item.id !== record.id), record]
        this.saving = (async () => {
          await this.cache.save(JSON.stringify({ clientId: this.clientId, records, msal: interaction.getTokenCache().serialize() }))
          if (controller.signal.aborted) { await this.persist(); controller.signal.throwIfAborted() }
        })()
        try { await this.saving } finally { this.saving = null }
        if (generation !== this.serial) return
        this.records = records; this.client = interaction
        outcome = 'success'
      } catch (error) {
        if (controller.signal.aborted || generation !== this.serial) outcome = 'cancelled'
        else failure = error instanceof LauncherError ? publicError(error, 'auth') : { code: 'AUTH_EXPIRED', stage: 'auth:microsoft', message: '微软登录未完成。', nextAction: '重新发起登录；若仍失败，将阶段 auth:microsoft 和错误名称反馈给维护者。' }
      } finally {
        if (generation === this.serial) {
          this.controller = null; this.request = null; this.authCode = null
          if (failure) this.emit({ type: 'error', data: failure })
          this.emit({ type: 'auth-ended', data: { outcome, ...failure ? { failure } : {} } }); this.changed()
        }
      }
    })()
  }
  async cancel(): Promise<void> {
    if (this.request) this.request.cancel = true
    this.controller?.abort()
    ++this.serial
    await this.saving?.catch(() => {})
    this.controller = null; this.request = null; this.authCode = null
    this.emit({ type: 'auth-ended', data: { outcome: 'cancelled' } }); this.changed()
  }
  async openAuthPage(): Promise<void> {
    if (!this.pending || this.controller?.signal.aborted || !this.authCode || Date.parse(this.authCode.expiresAt) <= Date.now()) throw new LauncherError('AUTH_EXPIRED', '授权代码已过期。', '请取消后重新发起微软登录。', 'auth')
    const data = { ...this.authCode, copied: false, browserOpened: null as boolean | null }
    this.authCode = data
    try { await clipboard.writeText(data.code); data.copied = true } catch {}
    if (this.authCode !== data || !this.pending || this.controller?.signal.aborted) return
    this.emit({ type: 'auth-code', data: { ...data } })
    try { await shell.openExternal(data.verificationUri); data.browserOpened = true } catch { data.browserOpened = false }
    if (this.authCode === data && this.pending && !this.controller?.signal.aborted) this.emit({ type: 'auth-code', data: { ...data } })
  }
  private async exchange(oauth: string, signal: AbortSignal): Promise<LaunchIdentity> {
    const xbl = await this.authStage('xbox', 'Xbox Live 登录未完成。', () => new MicrosoftAuthenticator().authenticateXboxLive(oauth, signal))
    const xsts = await this.authStage('xsts', 'Xbox 主机授权未完成。', () => new MicrosoftAuthenticator().authorizeXboxLive(xbl.Token, 'rp://api.minecraftservices.com/', signal))
    const claim = xsts.DisplayClaims.xui[0]
    const minecraft = await this.authStage('minecraft', 'Minecraft 令牌交换未完成。', () => new MicrosoftAuthenticator().loginMinecraftWithXBox(claim.uhs, xsts.Token, signal))
    const mojang = new MojangClient()
    const ownership = await this.authStage('entitlement', '无法核对 Minecraft Java 版权益。', () => mojang.checkGameOwnership(minecraft.access_token, signal))
    if (!ownership.items.some(item => ['product_minecraft', 'game_minecraft'].includes(item.name))) throw new LauncherError('NO_ENTITLEMENT', '账号未返回 Minecraft Java 版使用权限。', '确认购买或订阅权限，以及 LQL 应用的服务接入资格。', 'auth')
    let profile
    try { profile = await mojang.getProfile(minecraft.access_token, signal) } catch { throw new LauncherError('NO_PROFILE', '无法获取 Minecraft 游戏角色。', '先在 Minecraft 官网完成角色设置后重试。', 'auth') }
    return { uuid: profile.id, name: profile.name, accessToken: minecraft.access_token, xuid: claim.xid ?? '', clientId: this.clientId }
  }
  private async authStage<T>(stage: string, message: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof LauncherError) throw error
      const publicStage = `auth:${stage}`
      const publicFailure = publicError(error, publicStage)
      if (publicFailure.message.startsWith('服务返回 HTTP ')) {
        const status = (error as { status?: unknown }).status
        const nextAction = status === 401 || status === 403
          ? stage === 'minecraft'
            ? `阶段 ${publicStage}：账号登录已成功，但 Minecraft 服务拒绝了此应用。LQL 自有 Microsoft 应用需申请 Java 版游戏服务 API 准入；不要更换为其他启动器的应用标识。`
            : `阶段 ${publicStage}：Minecraft 服务拒绝了此请求，请核查 LQL 自有应用的服务准入与账号限制。`
          : `稍后重试；若持续失败，将界面中的阶段 ${publicStage} 和 HTTP ${status} 反馈给维护者。`
        throw new LauncherError('SERVICE', `${message}（${publicFailure.message.replace(/。$/, '')}）`, nextAction, publicStage)
      }
      if (typeof (error as { XErr?: unknown })?.XErr === 'number' && Number.isSafeInteger((error as { XErr: number }).XErr)) throw new LauncherError('SERVICE', message, `Xbox 错误码 ${(error as { XErr: number }).XErr}；结合阶段 auth:${stage} 核查应用准入或账号限制。`, publicStage)
      if ((error as { httpStatus?: unknown })?.httpStatus === 400) throw new LauncherError('SERVICE', `${message}（Microsoft HTTP 400）`, '检查 Microsoft 应用准入与账号限制后重试；阶段 auth:microsoft。', 'auth:microsoft')
      throw new LauncherError('SERVICE', message, `将阶段 auth:${stage} 和错误名称反馈给维护者；不要提交令牌、验证码或 auth.bin。`, publicStage)
    }
  }
  async getLaunchIdentity(id: string): Promise<LaunchIdentity> {
    if (this.pending) throw new LauncherError('BUSY', '请先完成或取消当前授权，再启动游戏。')
    const record = this.records.find(item => item.id === id)
    if (!record || !this.client) throw new LauncherError('AUTH_REQUIRED', '请先添加并选择微软账号。')
    const account = await this.client.getTokenCache().getAccountByHomeId(record.homeAccountId)
    try {
      if (!account) throw new Error('missing account')
      const response = await this.client.acquireTokenSilent({ account, scopes })
      const identity = await this.exchange(response.accessToken, AbortSignal.timeout(90000))
      if (identity.uuid !== record.uuid) throw new Error('identity changed')
      record.name = identity.name; record.status = 'ready'; await this.persist(); this.changed()
      return identity
    } catch (error) {
      record.status = 'reauth-required'; this.changed()
      if (error instanceof LauncherError) throw error
      throw new LauncherError('AUTH_REQUIRED', '账号需要重新授权。', '重新添加此微软账号后再启动。', 'auth')
    }
  }
  async remove(id: string): Promise<void> {
    if (this.pending) throw new LauncherError('BUSY', '请先完成或取消当前授权。')
    const record = this.records.find(item => item.id === id)
    if (!record) throw new LauncherError('INVALID_INPUT', '账号不存在。')
    const account = await this.client?.getTokenCache().getAccountByHomeId(record.homeAccountId)
    if (account) await this.client!.getTokenCache().removeAccount(account)
    this.records = this.records.filter(item => item.id !== id)
    await this.persist(); this.changed()
  }
}
