import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, LauncherAPI } from '../shared/contracts'

const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke('lql:command', method, args)
  if (!result.ok) throw new Error(`${result.error.message} ${result.error.nextAction}`)
  return result.value
}
const api: LauncherAPI = {
  listLoaders: (gameVersion, kind) => invoke('listLoaders', gameVersion, kind),
  searchContent: query => invoke('searchContent', query), getContentProject: id => invoke('getContentProject', id), listContentVersions: (projectId, instanceId) => invoke('listContentVersions', projectId, instanceId),
  previewResource: (instanceId, versionId) => invoke('previewResource', instanceId, versionId), applyResource: id => invoke('applyResource', id), listInstanceContent: id => invoke('listInstanceContent', id),
  toggleContent: (id, path) => invoke('toggleContent', id, path), removeContent: (id, path) => invoke('removeContent', id, path), importContent: (id, kind) => invoke('importContent', id, kind), checkContentUpdates: id => invoke('checkContentUpdates', id),
  previewPack: versionId => invoke('previewPack', versionId), previewPackUpdate: (id, versionId) => invoke('previewPackUpdate', id, versionId), installPack: (id, name, optional) => invoke('installPack', id, name, optional), applyPackUpdate: (id, optional) => invoke('applyPackUpdate', id, optional),
  restoreContent: id => invoke('restoreContent', id), clearContentBackups: id => invoke('clearContentBackups', id), cancelContentTask: id => invoke('cancelContentTask', id), openContentProject: id => invoke('openContentProject', id),
  getSnapshot: () => invoke('getSnapshot'), listVersions: () => invoke('listVersions'),
  createInstance: (name, version, loader) => loader ? invoke('createInstance', name, version, loader) : invoke('createInstance', name, version), updateInstance: (id, patch) => invoke('updateInstance', id, patch), removeInstance: id => invoke('removeInstance', id),
  selectInstance: id => invoke('selectInstance', id), selectAccount: id => invoke('selectAccount', id), saveSettings: settings => invoke('saveSettings', settings),
  chooseGameRoot: () => invoke('chooseGameRoot'), chooseJavaPath: id => invoke('chooseJavaPath', id), openInstanceFolder: id => invoke('openInstanceFolder', id),
  addAccount: () => invoke('addAccount'), addLocalProfile: name => invoke('addLocalProfile', name), cancelAuth: () => invoke('cancelAuth'), removeAccount: id => invoke('removeAccount', id), openAuthPage: () => invoke('openAuthPage'),
  installInstance: id => invoke('installInstance', id), cancelInstall: () => invoke('cancelInstall'), launchInstance: id => invoke('launchInstance', id), stopGame: force => invoke('stopGame', force),
  readLog: id => invoke('readLog', id), exportLog: id => invoke('exportLog', id),
  onEvent: listener => { const callback = (_event: Electron.IpcRendererEvent, data: AppEvent) => listener(data); ipcRenderer.on('lql:event', callback); return () => ipcRenderer.removeListener('lql:event', callback) },
}
contextBridge.exposeInMainWorld('lql', api)
