const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('debugApi', {
  getAll: () => ipcRenderer.invoke('log:getAll'),
  clear: () => ipcRenderer.invoke('log:clear'),
  showFile: () => ipcRenderer.invoke('log:showFile'),
  onEvent: (cb) => ipcRenderer.on('log:event', (_e, event) => cb(event)),
});
