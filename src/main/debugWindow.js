// The separate "Debug log" window and the IPC it uses.
import { BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEntries, clearEntries, subscribe, getLogFilePath } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let debugWin = null;
let unsubscribe = null;

export function registerDebugIpc() {
  ipcMain.handle('log:getAll', () => getEntries());
  ipcMain.handle('log:clear', () => {
    clearEntries();
    return true;
  });
  ipcMain.handle('log:showFile', () => {
    const file = getLogFilePath();
    if (file) shell.showItemInFolder(file);
    return !!file;
  });
}

export function closeDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) debugWin.close();
}

export function openDebugWindow(origin) {
  if (debugWin && !debugWin.isDestroyed()) {
    if (debugWin.isMinimized()) debugWin.restore();
    debugWin.focus();
    return;
  }

  debugWin = new BrowserWindow({
    width: 980,
    height: 600,
    minWidth: 640,
    minHeight: 360,
    title: 'Glass Player: Debug log',
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-debug.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  debugWin.setMenuBarVisibility(false);

  // Links never navigate this window away from the log view
  debugWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  debugWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  unsubscribe = subscribe((event) => {
    if (debugWin && !debugWin.isDestroyed()) debugWin.webContents.send('log:event', event);
  });
  debugWin.on('closed', () => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    debugWin = null;
  });

  debugWin.loadURL(`${origin}/debug.html`);
}
