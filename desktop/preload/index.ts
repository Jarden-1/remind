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
}
contextBridge.exposeInMainWorld('remind', bridge)
