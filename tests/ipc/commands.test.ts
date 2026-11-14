import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/main/storage/store'
import { registerIPC } from '../../src/main/ipc'

const bridge = vi.hoisted(() => ({ handler: null as unknown as (event: unknown, method: unknown, args: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>, dialog: vi.fn(), probe: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: (_channel: string, handler: typeof bridge.handler) => { bridge.handler = handler } }, dialog: { showOpenDialog: bridge.dialog }, shell: {} }))
vi.mock('../../src/main/game/java', () => ({ probeJava: bridge.probe }))
const directories: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'lql-ipc-')); directories.push(directory)
  const store = await Store.open(directory)
  bridge.probe.mockImplementation(async (executable: string) => ({ executable, major: 17, arch: 'x64' }))
  const webContents = { mainFrame: {} }
  registerIPC({ webContents } as never, { store, accounts: { list: () => [] }, metadata: {}, installer: { isBusy: () => false }, game: { blocksInstance: () => false }, logs: {}, snapshot: () => ({ config: store.config }), changed: () => {} } as never)
  return { store, event: { sender: webContents, senderFrame: webContents.mainFrame } }
}

test('IPC rejects foreign windows, child frames, unknown operations and malformed payloads', async () => {
  const { event, store } = await setup()
  for (const [source, method, args] of [
    [{ ...event, sender: {} }, 'getSnapshot', []],
    [{ ...event, senderFrame: {} }, 'getSnapshot', []],
    [event, 'arbitraryFileWrite', []],
    [event, 'getSnapshot', ['extra']],
    [event, 'saveSettings', [{ ...store.config.defaults, memoryMiB: -1 }]],
  ]) expect(await bridge.handler(source, method, args)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  expect((await bridge.handler(event, 'getSnapshot', [])).ok).toBe(true)
})

test('Java picker returns a verified draft and cancellation never saves settings', async () => {
  const { event, store } = await setup()
  bridge.dialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\Java\\bin\\java.exe'] })
  expect(await bridge.handler(event, 'chooseJavaPath', [null])).toEqual({ ok: true, value: 'C:\\Java\\bin\\java.exe' })
  expect(store.config.defaults.javaPath).toBeNull()
  bridge.dialog.mockResolvedValue({ canceled: true, filePaths: [] })
  expect(await bridge.handler(event, 'chooseJavaPath', [null])).toEqual({ ok: true, value: null })
  expect(store.config.defaults.javaPath).toBeNull()
})

test('renderer cannot probe or save an executable that was not selected through the native picker', async () => {
  const { event, store } = await setup()
  const instance = await store.createInstance('world', '1.20.1')
  for (const [method, args] of [
    ['saveSettings', [{ ...store.config.defaults, javaPath: 'C:\\Windows\\System32\\calc.exe' }]],
    ['updateInstance', [instance.id, { overrides: { javaPath: 'C:\\Windows\\System32\\calc.exe' } }]],
  ]) expect(await bridge.handler(event, method, args)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  expect(bridge.probe).not.toHaveBeenCalled()
})

test('local profile IPC validates names and supports selection and removal without Microsoft setup', async () => {
  const { event, store } = await setup()
  expect(await bridge.handler(event, 'addLocalProfile', ['bad name'])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  const result = await bridge.handler(event, 'addLocalProfile', ['Player_01'])
  expect(result.ok).toBe(true)
  const profile = store.config.localProfiles[0]
  expect(result.value).toEqual(profile)
  expect(await bridge.handler(event, 'selectAccount', [profile.id])).toMatchObject({ ok: true })
  expect(store.config.selectedAccountId).toBe(profile.id)
  expect(await bridge.handler(event, 'removeAccount', [profile.id])).toMatchObject({ ok: true })
  expect(store.config.selectedAccountId).toBeNull()
  expect(await bridge.handler(event, 'selectAccount', [profile.id])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
})
