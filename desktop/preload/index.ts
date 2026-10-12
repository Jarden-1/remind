import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopState } from '../../shared/desktop'

const bridge: DesktopBridge = {
  state: () => ipcRenderer.invoke('remind:state'),
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state)
    ipcRenderer.on('remind:changed', receive)
    return () => { ipcRenderer.removeListener('remind:changed', receive) }
  },
  command: command => ipcRenderer.invoke('remind:command', command),
  settings: settings => ipcRenderer.invoke('remind:settings', settings),
  update: action => ipcRenderer.invoke('remind:update', action),
  panel: settingsOpen => ipcRenderer.invoke('remind:panel', settingsOpen),
  ready: () => ipcRenderer.invoke('remind:ready'),
  minimize: () => ipcRenderer.invoke('remind:window', 'minimize'),
  quit: () => ipcRenderer.invoke('remind:window', 'quit'),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('remind:launch-at-login', enabled),
}
contextBridge.exposeInMainWorld('remind', bridge)
