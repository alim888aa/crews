import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CrewAPI, RoomState } from '../shared/contracts.js'
const api: CrewAPI = {
  snapshot: () => ipcRenderer.invoke('room:snapshot'),
  send: (payload) => ipcRenderer.invoke('room:send', payload),
  createChannel: (payload) =>
    ipcRenderer.invoke('room:create-channel', payload),
  setChannelMembers: (payload) =>
    ipcRenderer.invoke('room:channel-members', payload),
  deleteChannel: (id) => ipcRenderer.invoke('room:delete-channel', id),
  importImage: (value) => ipcRenderer.invoke('room:image-import', value),
  pickImages: () => ipcRenderer.invoke('room:image-pick'),
  removeImage: (id) => ipcRenderer.invoke('room:image-remove', id),
  setReplyLimit: (value) => ipcRenderer.invoke('room:reply-limit', value),
  pause: (value) => ipcRenderer.invoke('room:pause', value),
  installContextHooks: () => ipcRenderer.invoke('room:context-hooks'),
  setup: () => ipcRenderer.invoke('room:setup'),
  add: (value) => ipcRenderer.invoke('room:add', value),
  edit: (value) => ipcRenderer.invoke('room:edit', value),
  pickTaskFolder: () => ipcRenderer.invoke('room:pick-folder'),
  listModels: () => ipcRenderer.invoke('room:models'),
  createTask: (value) => ipcRenderer.invoke('room:create-task', value),
  approval: (id) => ipcRenderer.invoke('room:approval', id),
  copyOpen: (value) => ipcRenderer.invoke('room:copy-open', value),
  refreshTasks: () => ipcRenderer.invoke('room:refresh'),
  openTask: (id) => ipcRenderer.invoke('room:open-task', id),
  openLink: (url) => ipcRenderer.invoke('room:open-link', url),
  openRelay: () => ipcRenderer.invoke('room:open-relay'),
  onState: (callback) => {
    const listener = (_event: IpcRendererEvent, state: RoomState) =>
      callback(state)
    ipcRenderer.on('room:state', listener)
    return () => ipcRenderer.removeListener('room:state', listener)
  },
  onError: (callback) => {
    const listener = (_event: IpcRendererEvent, error: string) =>
      callback(error)
    ipcRenderer.on('room:error', listener)
    return () => ipcRenderer.removeListener('room:error', listener)
  },
}
contextBridge.exposeInMainWorld('crew', api)
