import { contextBridge, ipcRenderer } from 'electron'
import type { RendererApi } from '@shared/api'
import type { ChatEvent } from '@shared/types'

const api: RendererApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    listCredentials: () => ipcRenderer.invoke('settings:listCredentials'),
    addCredential: (input) => ipcRenderer.invoke('settings:addCredential', input),
    removeCredential: (id) => ipcRenderer.invoke('settings:removeCredential', id),
    testCredential: (input) => ipcRenderer.invoke('settings:testCredential', input),
    encryptionAvailable: () => ipcRenderer.invoke('settings:encryptionAvailable')
  },
  providers: {
    listModels: (credentialId) => ipcRenderer.invoke('providers:listModels', credentialId),
    listAllModels: () => ipcRenderer.invoke('providers:listAllModels')
  },
  chat: {
    start: (req) => ipcRenderer.invoke('chat:start', req),
    cancel: (streamId) => ipcRenderer.invoke('chat:cancel', streamId),
    approve: (streamId, callId, approved) => ipcRenderer.invoke('chat:approve', streamId, callId, approved),
    onEvent: (cb) => {
      const listener = (_e: unknown, ev: ChatEvent): void => cb(ev)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
    summarize: (req) => ipcRenderer.invoke('chat:summarize', req),
    title: (req) => ipcRenderer.invoke('chat:title', req)
  },
  fs: {
    selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
    selectFile: () => ipcRenderer.invoke('fs:selectFile'),
    listDir: (dir) => ipcRenderer.invoke('fs:listDir', dir),
    readFile: (file) => ipcRenderer.invoke('fs:readFile', file),
    readFileBase64: (file) => ipcRenderer.invoke('fs:readFileBase64', file),
    writeFile: (file, content) => ipcRenderer.invoke('fs:writeFile', file, content),
    homeDir: () => ipcRenderer.invoke('fs:homeDir')
  },
  ssh: {
    saveAndConnect: (input) => ipcRenderer.invoke('ssh:saveAndConnect', input),
    connectHost: (id) => ipcRenderer.invoke('ssh:connectHost', id),
    listHosts: () => ipcRenderer.invoke('ssh:listHosts'),
    removeHost: (id) => ipcRenderer.invoke('ssh:removeHost', id),
    exec: (sessionId, command) => ipcRenderer.invoke('ssh:exec', sessionId, command),
    list: () => ipcRenderer.invoke('ssh:list'),
    disconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId)
  },
  conversations: {
    list: () => ipcRenderer.invoke('conv:list'),
    upsert: (conv) => ipcRenderer.invoke('conv:upsert', conv),
    remove: (id) => ipcRenderer.invoke('conv:remove', id)
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    clear: () => ipcRenderer.invoke('tasks:clear'),
    onUpdate: (cb) => {
      const listener = (_e: unknown, list: Parameters<typeof cb>[0]): void => cb(list)
      ipcRenderer.on('tasks:update', listener)
      return () => ipcRenderer.removeListener('tasks:update', listener)
    }
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    showPath: (path) => ipcRenderer.invoke('app:showPath', path),
    copyText: (text) => ipcRenderer.invoke('app:copyText', text),
    gitBranch: (dir) => ipcRenderer.invoke('app:gitBranch', dir),
    gitDiff: (dir) => ipcRenderer.invoke('app:gitDiff', dir),
    getLoginItem: () => ipcRenderer.invoke('app:getLoginItem'),
    setLoginItem: (enabled) => ipcRenderer.invoke('app:setLoginItem', enabled)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (cb) => {
      const listener = (_e: unknown, max: boolean): void => cb(max)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
