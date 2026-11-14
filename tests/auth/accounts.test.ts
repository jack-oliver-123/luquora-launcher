import { beforeEach, expect, test, vi } from 'vitest'
import { AccountService } from '../../src/main/auth/accounts'
import { EncryptedCache } from '../../src/main/auth/cache'
import type { AppEvent } from '../../src/shared/contracts'

const boundary = vi.hoisted(() => ({ device: vi.fn(), silent: vi.fn(), xbox: vi.fn(), xsts: vi.fn(), minecraft: vi.fn(), ownership: vi.fn(), profile: vi.fn(), remove: vi.fn(), account: vi.fn(), copy: vi.fn(), open: vi.fn(), network: vi.fn(), clientOptions: null as null | { system?: { networkClient?: { sendGetRequestAsync: (url: string, options?: unknown, timeout?: number) => Promise<unknown>; sendPostRequestAsync: (url: string, options?: unknown) => Promise<unknown> } } } }))
vi.mock('electron', () => ({ clipboard: { writeText: boundary.copy }, net: { fetch: boundary.network }, shell: { openExternal: boundary.open } }))
vi.mock('@azure/msal-node', () => ({ PublicClientApplication: class {
  constructor(options: typeof boundary.clientOptions) { boundary.clientOptions = options }
  acquireTokenByDeviceCode = boundary.device
  acquireTokenSilent = boundary.silent
  getTokenCache() { return { serialize: () => 'msal-secret', deserialize: () => {}, getAccountByHomeId: boundary.account, removeAccount: boundary.remove } }
} }))
vi.mock('@xmcl/user', () => ({ MicrosoftAuthenticator: class { authenticateXboxLive = boundary.xbox; authorizeXboxLive = boundary.xsts; loginMinecraftWithXBox = boundary.minecraft }, MojangClient: class { checkGameOwnership = boundary.ownership; getProfile = boundary.profile } }))
beforeEach(() => {
  vi.resetAllMocks()
  boundary.device.mockResolvedValue({ accessToken: 'oauth-secret', account: { homeAccountId: 'home' } })
  boundary.silent.mockResolvedValue({ accessToken: 'oauth-secret' })
  boundary.account.mockResolvedValue({ homeAccountId: 'home' })
  boundary.xbox.mockResolvedValue({ Token: 'xbl-secret' })
  boundary.xsts.mockResolvedValue({ Token: 'xsts-secret', DisplayClaims: { xui: [{ uhs: 'hash', xid: 'xuid' }] } })
  boundary.minecraft.mockResolvedValue({ access_token: 'minecraft-secret' })
  boundary.ownership.mockResolvedValue({ items: [{ name: 'game_minecraft' }] })
  boundary.profile.mockResolvedValue({ id: 'a'.repeat(32), name: 'Player' })
  boundary.open.mockResolvedValue(undefined)
  boundary.copy.mockResolvedValue(undefined)
  boundary.network.mockResolvedValue({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true }) })
})
function setup() {
  const cache = new EncryptedCache('unused-memory-only', { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' })
  const events: AppEvent[] = []
  const service = new AccountService(cache, 'own-application-id', event => events.push(event), () => {})
  return { cache, events, service }
}
async function done(service: AccountService) { await vi.waitFor(() => expect(service.pending).toBe(false)) }

test('cancel ignores a late success and rejects overlapping authorization', async () => {
  const { service, events, cache } = setup()
  let late!: (value: unknown) => void
  boundary.device.mockImplementation(() => new Promise(resolve => { late = resolve }))
  await service.beginAdd()
  await expect(service.beginAdd()).rejects.toMatchObject({ code: 'BUSY' })
  await service.cancel()
  late({ accessToken: 'late-secret', account: { homeAccountId: 'late' } })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(service.list()).toEqual([])
  expect(await cache.load()).toBe('')
  expect(JSON.stringify(events)).not.toContain('late-secret')
})

test('ownership and profile are checked before persisting an identity', async () => {
  for (const missing of ['ownership', 'profile']) {
    const { service, cache, events } = setup()
    boundary.ownership.mockResolvedValue({ items: missing === 'ownership' ? [] : [{ name: 'game_minecraft' }] })
    boundary.profile.mockRejectedValue(new Error('private body minecraft-secret'))
    await service.beginAdd(); await done(service)
    expect(service.list()).toEqual([])
    expect(await cache.load()).toBe('')
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: missing === 'ownership' ? 'NO_ENTITLEMENT' : 'NO_PROFILE' }) }))
    expect(JSON.stringify(events)).not.toContain('minecraft-secret')
  }
})

test('restart refreshes silently and removal deletes only the linked MSAL account', async () => {
  const { service, cache } = setup()
  await service.beginAdd(); await done(service)
  expect(service.list()[0]).toEqual({ id: 'a'.repeat(32), uuid: 'a'.repeat(32), name: 'Player', status: 'ready', kind: 'microsoft' })
  const restored = new AccountService(cache, 'own-application-id', () => {}, () => {})
  await restored.initialize()
  expect(restored.list()[0].status).toBe('reauth-required')
  expect((await restored.getLaunchIdentity('a'.repeat(32))).accessToken).toBe('minecraft-secret')
  await restored.remove('a'.repeat(32))
  expect(boundary.remove).toHaveBeenCalledWith({ homeAccountId: 'home' })
  expect(restored.list()).toEqual([])
})

test('invalid encrypted account records are rejected rather than exposed to renderer', async () => {
  const { service, cache } = setup()
  await cache.save(JSON.stringify({ clientId: 'own-application-id', msal: '', records: [{ name: null, uuid: 42 }] }))
  await expect(service.initialize()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  expect(service.list()).toEqual([])
})

test('expired OAuth errors never expose their response body', async () => {
  const { service, events } = setup()
  boundary.device.mockRejectedValue(new Error('access_token=oauth-secret'))
  await service.beginAdd(); await done(service)
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: 'AUTH_EXPIRED', stage: 'auth:microsoft', message: '微软登录未完成。' }) }))
  expect(JSON.stringify(events)).not.toContain('oauth-secret')
})

test('Microsoft token polling separates network failures from service rejections', async () => {
  const { service, events } = setup()
  boundary.device.mockRejectedValue(Object.assign(new Error('oauth-secret detail'), { errorCode: 'network_error' }))
  await service.beginAdd(); await done(service)
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: 'NETWORK', stage: 'auth:microsoft' }) }))
  expect(JSON.stringify(events)).not.toContain('oauth-secret')
  events.length = 0
  boundary.device.mockRejectedValue(Object.assign(new Error('oauth-secret detail'), { name: 'AuthError', errorCode: 'invalid_client', httpStatus: 400 }))
  await service.beginAdd(); await done(service)
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: 'SERVICE', stage: 'auth:microsoft', message: expect.stringContaining('HTTP 400') }) }))
  expect(JSON.stringify(events)).not.toContain('oauth-secret')
})

test('Microsoft authorization uses the Electron network stack', async () => {
  setup()
  const networkClient = boundary.clientOptions?.system?.networkClient
  expect(networkClient).toBeDefined()
  await networkClient!.sendPostRequestAsync('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code' })
  expect(boundary.network).toHaveBeenCalledWith('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', expect.objectContaining({ method: 'POST', cache: 'no-store', body: expect.stringContaining('device_code') }))
})

test.each([
  ['xbox', boundary.xbox, new Error('xbox-secret Failed to authenticate with xbox live, status code: 401: {"error":"invalid_grant"}')],
  ['xsts', boundary.xsts, Object.assign(new Error('xsts-secret Failed to authorize with xbox live, status code: 401: {"XErr":21489162}'), { XErr: 21489162 })],
  ['minecraft', boundary.minecraft, Object.assign(new Error('minecraft-secret'), { name: 'MicrosoftMinecraftXboxLoginError', status: 500, body: 'minecraft-body-secret' })],
  ['entitlement', boundary.ownership, new Error('entitlement-secret')]
])('post-authorization %s failures identify the safe stage without exposing the response', async (stage, call, failure) => {
  call.mockRejectedValue(failure)
  const { service, events } = setup()
  await service.beginAdd(); await done(service)
  expect(service.list()).toEqual([])
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ code: 'SERVICE', stage: `auth:${stage}` }) }))
  expect(JSON.stringify(events)).not.toMatch(/(?:xbox|xsts|minecraft|entitlement)-(?:body-)?secret/)
  if (stage === 'minecraft') expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ message: expect.stringContaining('HTTP 500') }) }))
  if (stage === 'xsts') expect(events).toContainEqual(expect.objectContaining({ type: 'error', data: expect.objectContaining({ nextAction: expect.stringContaining('21489162') }) }))
})

test('Minecraft 403 identifies application admission instead of suggesting a transient retry', async () => {
  boundary.minecraft.mockRejectedValue(Object.assign(new Error('minecraft-secret Invalid app registration'), { name: 'MicrosoftMinecraftXboxLoginError', status: 403, body: 'minecraft-body-secret' }))
  const { service, events } = setup()
  await service.beginAdd(); await done(service)
  const error = events.find(event => event.type === 'error')
  expect(error).toMatchObject({ data: { code: 'SERVICE', stage: 'auth:minecraft', message: expect.stringContaining('HTTP 403'), nextAction: expect.stringMatching(/准入|申请/), } })
  expect(error?.data.nextAction).not.toContain('稍后重试')
  expect(JSON.stringify(events)).not.toMatch(/minecraft-(?:body-)?secret|Invalid app registration/)
})

test('a failed authorization remains visible in the dialog until dismissed', async () => {
  const { service, events } = setup()
  boundary.device.mockImplementation(request => {
    request.deviceCodeCallback({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin', expiresIn: 900 })
    return Promise.resolve({ accessToken: 'oauth-secret', account: { homeAccountId: 'home' } })
  })
  await service.beginAdd()
  await vi.waitFor(() => expect(events).toContainEqual({ type: 'auth-code', data: expect.objectContaining({ code: 'ABCD-EFGH' }) }))
  boundary.minecraft.mockRejectedValue(Object.assign(new Error('minecraft-secret'), { status: 403 }))
  await done(service)
  expect(events.at(-1)).toEqual({ type: 'auth-ended', data: { outcome: 'failed', failure: expect.objectContaining({ code: 'SERVICE', stage: 'auth:minecraft', message: expect.stringContaining('HTTP 403'), nextAction: expect.stringMatching(/准入|申请/) }) } })
  expect(JSON.stringify(events)).not.toContain('minecraft-secret')
})

function pendingCode() {
  boundary.device.mockImplementation(request => {
    request.deviceCodeCallback({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin', expiresIn: 900 })
    return new Promise(() => {})
  })
  return setup()
}

test('device authorization copies the code before opening the browser and reports both results', async () => {
  const { service, events } = pendingCode()
  await service.beginAdd()
  await vi.waitFor(() => expect(events).toContainEqual({ type: 'auth-code', data: expect.objectContaining({ code: 'ABCD-EFGH', copied: true, browserOpened: true }) }))
  expect(boundary.copy).toHaveBeenCalledWith('ABCD-EFGH')
  expect(boundary.open).toHaveBeenCalledWith('https://microsoft.com/devicelogin')
  expect(boundary.copy.mock.invocationCallOrder[0]).toBeLessThan(boundary.open.mock.invocationCallOrder[0])
  await service.cancel()
})

test('native presentation failures retain the code and allow copying and opening again', async () => {
  const { service, events } = pendingCode()
  boundary.copy.mockRejectedValueOnce(new Error('clipboard unavailable'))
  boundary.open.mockRejectedValueOnce(new Error('browser unavailable'))
  await service.beginAdd()
  await vi.waitFor(() => expect(events).toContainEqual({ type: 'auth-code', data: expect.objectContaining({ code: 'ABCD-EFGH', copied: false, browserOpened: false }) }))
  expect(service.pending).toBe(true)
  await service.openAuthPage()
  expect(events.at(-1)).toEqual({ type: 'auth-code', data: expect.objectContaining({ copied: true, browserOpened: true }) })
  await service.cancel()
  await expect(service.openAuthPage()).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
})

test('late browser completion after cancellation does not reopen the authorization modal', async () => {
  const { service, events } = pendingCode()
  let finishOpen!: () => void
  boundary.open.mockImplementation(() => new Promise<void>(resolve => { finishOpen = resolve }))
  await service.beginAdd()
  await vi.waitFor(() => expect(boundary.open).toHaveBeenCalled())
  await service.cancel()
  const count = events.length
  finishOpen()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(events).toHaveLength(count)
})

test('untrusted verification URLs never reach the clipboard or browser', async () => {
  boundary.device.mockImplementation(request => {
    request.deviceCodeCallback({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com.attacker.example/devicelogin', expiresIn: 900 })
    return Promise.resolve(null)
  })
  const { service, events } = setup()
  await service.beginAdd(); await done(service)
  expect(boundary.copy).not.toHaveBeenCalled()
  expect(boundary.open).not.toHaveBeenCalled()
  expect(events.some(event => event.type === 'auth-code')).toBe(false)
})

test('browser waits for asynchronous clipboard completion and cancellation prevents late presentation', async () => {
  const { service, events } = pendingCode()
  let finishCopy!: () => void
  boundary.copy.mockImplementation(() => new Promise<void>(resolve => { finishCopy = resolve }))
  await service.beginAdd()
  expect(boundary.open).not.toHaveBeenCalled()
  expect(events.some(event => event.type === 'auth-code')).toBe(false)
  await service.cancel()
  const count = events.length
  finishCopy()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(events).toHaveLength(count)
  expect(boundary.open).not.toHaveBeenCalled()
})

test('cancellation blocks pending browser presentation while waiting for the encrypted cache save', async () => {
  const { service, cache } = pendingCode()
  let finishCopy!: () => void
  let finishSave!: () => void
  boundary.copy.mockImplementation(() => new Promise<void>(resolve => { finishCopy = resolve }))
  const save = vi.spyOn(cache, 'save').mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve }))
  boundary.device.mockImplementation(request => {
    request.deviceCodeCallback({ userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin', expiresIn: 900 })
    return Promise.resolve({ accessToken: 'oauth-secret', account: { homeAccountId: 'home' } })
  })
  await service.beginAdd()
  await vi.waitFor(() => expect(save).toHaveBeenCalled())
  const cancellation = service.cancel()
  try {
    finishCopy()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(boundary.open).not.toHaveBeenCalled()
  } finally { finishSave(); await cancellation }
})
