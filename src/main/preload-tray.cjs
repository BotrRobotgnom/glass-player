const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trayApi', {
  onState: (cb) => ipcRenderer.on('tray:state', (_e, s) => cb(s)),
  ready: () => ipcRenderer.send('tray:popupReady'),
  command: (cmd) => ipcRenderer.send('tray:popupCommand', cmd),
  open: () => ipcRenderer.send('tray:popupOpen'),
  close: () => ipcRenderer.send('tray:popupClose'),
});
