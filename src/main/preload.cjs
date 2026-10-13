const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  search: (query, sources) => ipcRenderer.invoke('search', { query, sources }),
  suggest: (query) => ipcRenderer.invoke('suggest', query),
  findOfficial: (track) => ipcRenderer.invoke('findOfficial', track),
  version: () => ipcRenderer.invoke('app:version'),
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  },
  log: {
    write: (level, source, message, data) => ipcRenderer.send('log:write', level, source, message, data),
    setVerbose: (on) => ipcRenderer.send('log:setVerbose', !!on),
  },
  debug: {
    open: () => ipcRenderer.invoke('debug:open'),
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    alwaysOnTop: (on) => ipcRenderer.invoke('win:alwaysOnTop', on),
    getInfo: () => ipcRenderer.invoke('win:getInfo'),
    setEffect: (effect) => ipcRenderer.invoke('win:setEffect', effect),
    onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
  },
});
