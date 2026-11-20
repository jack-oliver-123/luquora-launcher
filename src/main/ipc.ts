import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { AppSnapshot, LaunchSettings } from '../shared/contracts'
import { Store, validateSettings, validateLoader } from './storage/store'
import { assertManagedPath } from './storage/paths'
import { LauncherError, publicError } from './errors'
import { AccountService } from './auth/accounts'
import { MetadataService } from './game/metadata'
import { InstallService } from './game/install'
import { LaunchService } from './game/launch'
import { LogService } from './logging'
import { probeJava } from './game/java'
import type { ContentService } from './content/service'
import type { LoaderKind, SearchQuery } from '../shared/content'

export function registerIPC(window: BrowserWindow, services: { store: Store; accounts: AccountService; metadata: MetadataService; installer: InstallService; game: LaunchService; logs: LogService; content?: ContentService; snapshot: () => AppSnapshot; changed: () => void }): void {
  const { store, accounts, metadata, installer, game, logs, content, snapshot, changed } = services
  const selectedJavaPaths = new Set([store.config.defaults.javaPath, ...store.config.instances.map(instance => instance.overrides.javaPath)].filter((path): path is string => typeof path === 'string').map(path => resolve(path).toLowerCase()))
  const checkedJavaPath = (path: unknown) => { if (path !== undefined && path !== null && (typeof path !== 'string' || !selectedJavaPaths.has(resolve(path).toLowerCase()))) throw new LauncherError('INVALID_INPUT', '请通过系统文件对话框选择 Java。') }
  const string = (value: unknown): string => { if (typeof value !== 'string' || value.length > 256) throw new LauncherError('INVALID_INPUT', '请求参数无效。'); return value }
  const inactive = (id: string) => { store.getInstance(id); if (installer.isBusy(id) || game.blocksInstance(id) || content?.busy || content?.blocksInstance(id)) throw new LauncherError('BUSY', '实例正在使用，请先停止游戏或取消安装。') }
  const choosePack = async (): Promise<string | null> => { const result = await dialog.showOpenDialog(window, { title: '导入 Modrinth 整合包', properties: ['openFile'], filters: [{ name: 'Modrinth 整合包', extensions: ['mrpack', 'zip'] }] }); return result.canceled ? null : result.filePaths[0] ?? null }
  ipcMain.handle('lql:command', async (event, method: unknown, args: unknown) => {
    try {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || typeof method !== 'string' || !Array.isArray(args) || args.length > 3) throw new LauncherError('INVALID_INPUT', '不接受此操作来源。')
      const expected: Record<string, number> = { getSnapshot: 0, listVersions: 0, createInstance: 2, updateInstance: 2, removeInstance: 1, selectInstance: 1, selectAccount: 1, saveSettings: 1, chooseGameRoot: 0, chooseJavaPath: 1, openInstanceFolder: 1, addAccount: 0, addLocalProfile: 1, cancelAuth: 0, removeAccount: 1, installInstance: 1, cancelInstall: 0, launchInstance: 1, stopGame: 1, readLog: 1, exportLog: 1, openAuthPage: 0 }
      Object.assign(expected, { listLoaders: 2, searchContent: 1, getContentProject: 1, listContentVersions: 2, previewResource: 2, applyResource: 1, listInstanceContent: 1, toggleContent: 2, removeContent: 2, importContent: 2, checkContentUpdates: 1, previewPack: 1, previewPackUpdate: 2, installPack: 3, applyPackUpdate: 2, restoreContent: 1, clearContentBackups: 1, cancelContentTask: 1, openContentProject: 1 })
      if (!Object.hasOwn(expected, method) || args.length !== expected[method] && !(method === 'createInstance' && args.length === 3)) throw new LauncherError('INVALID_INPUT', '业务操作或参数数量无效。')
      let value: unknown
      if (['createInstance', 'installInstance', 'launchInstance', 'chooseGameRoot'].includes(method) && content?.busy) throw new LauncherError('BUSY', '请等待资源任务完成或取消任务。')
      switch (method) {
        case 'listLoaders': value = await installer.loaders.list(string(args[0]), string(args[1]) as LoaderKind, AbortSignal.timeout(30000)); break
        case 'searchContent': value = await content!.catalog.search(args[0] as SearchQuery, AbortSignal.timeout(30000)); break
        case 'getContentProject': value = await content!.catalog.project(string(args[0]), AbortSignal.timeout(30000)); break
        case 'listContentVersions': { const instance = args[1] === null ? null : store.getInstance(string(args[1])); const project = await content!.catalog.project(string(args[0]), AbortSignal.timeout(30000)); value = await content!.catalog.versions(project.id, instance?.versionId, project.project_type === 'mod' ? instance?.loader?.kind : undefined, AbortSignal.timeout(30000)); break }
        case 'previewResource': value = await content!.previewResource(string(args[0]), string(args[1])); break
        case 'applyResource': await content!.applyResource(string(args[0])); break
        case 'listInstanceContent': value = await content!.list(string(args[0])); break
        case 'toggleContent': await content!.toggle(string(args[0]), string(args[1])); break
        case 'removeContent': {
          const id = string(args[0]); const path = string(args[1]); inactive(id)
          const result = await dialog.showMessageBox(window, { type: 'warning', title: '移除资源', message: `将 ${path} 移入回收站？`, buttons: ['取消', '移入回收站'], defaultId: 0, cancelId: 0 })
          if (result.response === 1) { inactive(id); await content!.remove(id, path) } break
        }
        case 'importContent': {
          const id = string(args[0]); inactive(id); const kind = string(args[1])
          if (!['mod', 'resourcepack', 'shader'].includes(kind)) throw new LauncherError('INVALID_INPUT', '资源类型无效。')
          const result = await dialog.showOpenDialog(window, { title: '导入本地资源', properties: ['openFile'], filters: [{ name: '游戏资源', extensions: kind === 'mod' ? ['jar'] : ['zip'] }] })
          if (!result.canceled && result.filePaths[0]) { inactive(id); await content!.importFile(id, kind as 'mod' | 'resourcepack' | 'shader', result.filePaths[0]) } break
        }
        case 'checkContentUpdates': value = await content!.checkUpdates(string(args[0])); break
        case 'previewPack': { const source = args[0] === null ? await choosePack() : string(args[0]); value = source ? await content!.previewPack(source, args[0] !== null) : null; break }
        case 'previewPackUpdate': { const id = string(args[0]); inactive(id); const source = args[1] === null ? await choosePack() : string(args[1]); value = source ? await content!.previewPack(source, args[1] !== null, id) : null; break }
        case 'installPack': await content!.installPack(string(args[0]), string(args[1]), args[2]); break
        case 'applyPackUpdate': await content!.updatePack(string(args[0]), args[1]); break
        case 'restoreContent': {
          const id = string(args[0]); inactive(id)
          const result = await dialog.showMessageBox(window, { type: 'warning', title: '恢复最近一次变更', message: '恢复备份中的资源与配置？存档不会被修改。', detail: '检测到更新后的用户修改时会停止恢复。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 })
          if (result.response === 1) { inactive(id); await content!.restore(id) } break
        }
        case 'clearContentBackups': {
          const id = string(args[0]); inactive(id)
          const result = await dialog.showMessageBox(window, { type: 'warning', title: '清理备份', message: '永久删除此实例的更新备份？清理后无法恢复此前的资源变更。', buttons: ['取消', '清理备份'], defaultId: 0, cancelId: 0 })
          if (result.response === 1) { inactive(id); await content!.clearBackups(id) } break
        }
        case 'cancelContentTask': await content!.cancel(string(args[0])); break
        case 'openContentProject': { const id = string(args[0]); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new LauncherError('INVALID_INPUT', '项目标识无效。'); await shell.openExternal(`https://modrinth.com/project/${id}`); break }
        case 'getSnapshot': value = snapshot(); break
        case 'listVersions': value = await metadata.list(AbortSignal.timeout(30000)); break
        case 'createInstance': validateLoader(args[2]); value = await store.createInstance(string(args[0]), string(args[1]), args[2]); break
        case 'updateInstance': { const id = string(args[0]); inactive(id); checkedJavaPath(args[1]?.overrides?.javaPath); value = await store.updateInstance(id, args[1]); break }
        case 'removeInstance': {
          const id = string(args[0]); inactive(id)
          const answer = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '移入回收站'], defaultId: 0, cancelId: 0, title: '删除实例', message: `删除“${store.getInstance(id).name}”？`, detail: `存档、配置和截图将移入回收站。\n${store.instancePath(id)}` })
          if (answer.response === 1) { inactive(id); await store.removeInstance(id, target => shell.trashItem(target)) }
          break
        }
        case 'selectInstance': { const id = args[0] === null ? null : string(args[0]); if (id) store.getInstance(id); store.config.selectedInstanceId = id; await store.commit(); break }
        case 'selectAccount': { const id = args[0] === null ? null : string(args[0]); if (id && ![...accounts.list(), ...store.config.localProfiles].some(account => account.id === id)) throw new LauncherError('INVALID_INPUT', '账号或角色不存在。'); store.config.selectedAccountId = id; await store.commit(); break }
        case 'saveSettings': { validateSettings(args[0] as LaunchSettings); checkedJavaPath((args[0] as LaunchSettings).javaPath); if ((args[0] as LaunchSettings).javaPath) await probeJava((args[0] as LaunchSettings).javaPath!, AbortSignal.timeout(6000)); await store.saveSettings(args[0] as LaunchSettings); break }
        case 'chooseGameRoot': {
          if (store.config.instances.length || installer.isBusy() || game.busy) throw new LauncherError('BUSY', '创建实例后首版不支持迁移游戏根目录。')
          const answer = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择游戏数据根目录' })
          if (!answer.canceled && answer.filePaths[0]) { if (store.config.instances.length) throw new LauncherError('BUSY', '实例已创建，请保留当前目录。'); const root = resolve(answer.filePaths[0], 'LuquoraGameData'); await mkdir(root, { recursive: true }); await assertManagedPath(root, join(root, 'instances')); await access(root, constants.W_OK); store.config.gameRoot = root; await store.commit(); await logs.initialize() }
          break
        }
        case 'chooseJavaPath': {
          const id = args[0] === null ? null : string(args[0]); if (id) inactive(id)
          const answer = await dialog.showOpenDialog(window, { properties: ['openFile'], title: '选择 java.exe', filters: [{ name: 'Java', extensions: ['exe'] }] })
          value = null
          if (!answer.canceled && answer.filePaths[0]) { const runtime = await probeJava(answer.filePaths[0], AbortSignal.timeout(6000)); if (id) inactive(id); selectedJavaPaths.add(resolve(runtime.executable).toLowerCase()); value = runtime.executable }
          break
        }
        case 'openInstanceFolder': { const directory = await assertManagedPath(store.config.gameRoot, join(store.instancePath(string(args[0])), 'game')); const error = await shell.openPath(directory); if (error) throw new LauncherError('SERVICE', '无法打开实例目录。'); break }
        case 'addAccount': await accounts.beginAdd(); break
        case 'addLocalProfile': value = await store.addLocalProfile(string(args[0])); break
        case 'cancelAuth': await accounts.cancel(); break
        case 'removeAccount': { if (game.busy) throw new LauncherError('BUSY', '请先停止游戏。'); const id = string(args[0]); if (id.startsWith('local:')) await store.removeLocalProfile(id, accounts.list()[0]?.id ?? null); else { await accounts.remove(id); if (store.config.selectedAccountId === id) { store.config.selectedAccountId = accounts.list()[0]?.id ?? store.config.localProfiles[0]?.id ?? null; await store.commit() } }; break }
        case 'openAuthPage': await accounts.openAuthPage(); break
        case 'installInstance': { const id = string(args[0]); inactive(id); await installer.start(id); break }
        case 'cancelInstall': await installer.cancel(); break
        case 'launchInstance': { const id = string(args[0]); inactive(id); if (!store.config.selectedAccountId) throw new LauncherError('AUTH_REQUIRED', '请先添加并选择本地角色或微软账号。'); await game.start(id, store.config.selectedAccountId); break }
        case 'stopGame': {
          if (typeof args[0] !== 'boolean') throw new LauncherError('INVALID_INPUT', '停止参数无效。')
          const answer = await dialog.showMessageBox(window, { type: 'warning', title: '停止游戏', message: args[0] ? '强制结束游戏？未保存的进度可能丢失。' : '结束当前游戏？请先保存游戏进度。', buttons: ['取消', args[0] ? '强制结束' : '结束游戏'], cancelId: 0, defaultId: 0 })
          if (answer.response === 1) await game.stop(args[0]); break
        }
        case 'readLog': value = await logs.read(string(args[0])); break
        case 'exportLog': {
          const id = string(args[0]); await logs.read(id)
          const answer = await dialog.showSaveDialog(window, { title: '导出日志（可能包含本地路径和游戏内容）', defaultPath: `LQL-${id}.log`, filters: [{ name: '日志文件', extensions: ['log'] }] })
          value = null
          if (!answer.canceled && answer.filePath) { await logs.export(id, answer.filePath); value = answer.filePath }
          break
        }
      }
      changed()
      return { ok: true, value }
    } catch (error) { return { ok: false, error: publicError(error) } }
  })
}
