import { app, BrowserWindow, dialog, safeStorage } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppError, AppEvent, AppSnapshot } from '../shared/contracts'
import { Store } from './storage/store'
import { EncryptedCache } from './auth/cache'
import { AccountService } from './auth/accounts'
import { MetadataService } from './game/metadata'
import { InstallService } from './game/install'
import { LaunchService } from './game/launch'
import { LogService } from './logging'
import { registerIPC } from './ipc'
import { publicError } from './errors'
import { ContentService } from './content/service'

const directory = fileURLToPath(new URL('.', import.meta.url))
app.setName('LuquoraLauncher')
if (process.env.LQL_USER_DATA) app.setPath('userData', process.env.LQL_USER_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  let window: BrowserWindow | null = null
  const startupErrors: AppError[] = []
  const emit = (event: AppEvent) => { if (window && !window.isDestroyed()) window.webContents.send('lql:event', event); else if (event.type === 'error') startupErrors.push(event.data) }
  const report = (error: AppError) => emit({ type: 'error', data: error })
  const store = await Store.open(app.getPath('userData'))
  const cache = new EncryptedCache(store.userData, { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value) })
  const changed = () => emit({ type: 'snapshot', data: snapshot() })
  const accounts = new AccountService(cache, process.env.LQL_MS_CLIENT_ID || process.env.LQL_BUILD_MS_CLIENT_ID || '', emit, changed)
  const metadata = new MetadataService(() => store.config.gameRoot)
  const logs = new LogService(() => store.config.gameRoot, emit)
  let game: LaunchService
  const installer = new InstallService(store, metadata, changed, report, id => game?.blocksInstance(id) ?? false)
  game = new LaunchService(store, accounts, metadata, installer, logs, changed, report)
  const { shell } = await import('electron')
  const content = new ContentService(store, installer, changed, id => game.blocksInstance(id), path => shell.trashItem(path))
  const snapshot = (): AppSnapshot => {
    const config = structuredClone(store.config)
    config.instances = config.instances.filter(instance => !instance.staging)
    if (!config.instances.some(instance => instance.id === config.selectedInstanceId)) config.selectedInstanceId = config.instances[0]?.id ?? null
    return { config, accounts: [...accounts.list(), ...structuredClone(store.config.localProfiles)], installation: installer.progress, game: game.status(), logs: logs.summaries, authPending: accounts.pending, persistentAuth: cache.persistent, clientConfigured: !!accounts.clientId, contentTasks: structuredClone(content.tasks) }
  }
  await accounts.initialize().catch(error => report(publicError(error, 'auth')))
  await logs.initialize()
  await game.recover()
  await content.initialize().catch(error => report(publicError(error, 'content:recovery')))
  window = new BrowserWindow({ title: 'Luquora Launcher', icon: join(directory, '../../build/icon.png'), width: 1280, height: 820, minWidth: 960, minHeight: 640, backgroundColor: '#f5f5f7', show: process.env.LQL_HIDDEN !== '1', webPreferences: { preload: join(directory, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  registerIPC(window, { store, accounts, metadata, installer, game, logs, content, snapshot, changed })
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  let exiting = false
  let confirming = false
  window.on('close', event => {
    if (exiting || !installer.isBusy() && !content.busy && !game.busy && !accounts.pending) return
    event.preventDefault()
    if (confirming) return
    confirming = true
    void (async () => {
      const answer = await dialog.showMessageBox(window!, { type: 'warning', title: '退出 Luquora Launcher', message: game.busy ? '结束游戏并退出？请先保存游戏进度。' : '取消当前任务并退出？已校验文件会保留。', buttons: ['取消', '结束任务并退出'], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return
      await accounts.cancel(); await content.cancel(); await installer.cancel()
      if (game.busy) await game.stop(false)
      if (game.busy) return
      exiting = true; window?.close()
    })().catch(error => report(publicError(error, 'shutdown'))).finally(() => { confirming = false })
  })
  app.on('before-quit', event => { if (!exiting && (installer.isBusy() || content.busy || game.busy || accounts.pending)) { event.preventDefault(); window?.close() } })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(directory, '../renderer/index.html'))
  for (const error of startupErrors) report(error)
}).catch(error => {
  const failure = publicError(error, 'startup')
  if (process.env.LQL_HIDDEN !== '1') dialog.showErrorBox('LQL 无法启动', `${failure.message}\n${failure.nextAction}\n数据目录：${app.getPath('userData')}`)
  app.exit(1)
})
app.on('window-all-closed', () => app.quit())
