import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, LauncherAPI } from '../shared/contracts'

const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke('lql:command', method, args)
  if (!result.ok) throw new Error(`${result.error.message} ${result.error.nextAction}`)
  return result.value
}
const api: LauncherAPI = {
  getSnapshot: () => invoke('getSnapshot'), listVersions: () => invoke('listVersions'),
  createInstance: (name, version) => invoke('createInstance', name, version), updateInstance: (id, patch) => invoke('updateInstance', id, patch), removeInstance: id => invoke('removeInstance', id),
  selectInstance: id => invoke('selectInstance', id), selectAccount: id => invoke('selectAccount', id), saveSettings: settings => invoke('saveSettings', settings),
  chooseGameRoot: () => invoke('chooseGameRoot'), chooseJavaPath: id => invoke('chooseJavaPath', id), openInstanceFolder: id => invoke('openInstanceFolder', id),
  addAccount: () => invoke('addAccount'), addLocalProfile: name => invoke('addLocalProfile', name), cancelAuth: () => invoke('cancelAuth'), removeAccount: id => invoke('removeAccount', id), openAuthPage: () => invoke('openAuthPage'),
  installInstance: id => invoke('installInstance', id), cancelInstall: () => invoke('cancelInstall'), launchInstance: id => invoke('launchInstance', id), stopGame: force => invoke('stopGame', force),
  readLog: id => invoke('readLog', id), exportLog: id => invoke('exportLog', id),
  onEvent: listener => { const callback = (_event: Electron.IpcRendererEvent, data: AppEvent) => listener(data); ipcRenderer.on('lql:event', callback); return () => ipcRenderer.removeListener('lql:event', callback) },
}
contextBridge.exposeInMainWorld('lql', api)
