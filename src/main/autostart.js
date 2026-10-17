// Start with the system. Windows and macOS: Electron's login item. Linux: a .desktop file in ~/.config/autostart.
// Only for an installed / packaged app: a development run would register the wrong program.
// The app is started with --hidden so it can go straight to the tray.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as logger from './logger.js';

export const HIDDEN_ARG = '--hidden';

// The portable build unpacks itself to a temporary folder: the real file to start is the one the user ran
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
const linuxFile = () => path.join(os.homedir(), '.config', 'autostart', 'glass-player.desktop');

export const isAvailable = () => app.isPackaged && ['win32', 'darwin', 'linux'].includes(process.platform);

export function isEnabled() {
  if (!isAvailable()) return false;
  try {
    if (process.platform === 'linux') return fs.existsSync(linuxFile());
    return app.getLoginItemSettings({ path: exePath(), args: [HIDDEN_ARG] }).openAtLogin;
  } catch (err) {
    logger.warn('autostart', 'Could not read the autostart state', { error: String(err.message || err) });
    return false;
  }
}

export function setEnabled(on) {
  if (!isAvailable()) return false;
  try {
    if (process.platform === 'linux') {
      if (on) {
        fs.mkdirSync(path.dirname(linuxFile()), { recursive: true });
        fs.writeFileSync(
          linuxFile(),
          `[Desktop Entry]\nType=Application\nName=Glass Player\nExec="${exePath()}" ${HIDDEN_ARG}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`,
        );
      } else fs.rmSync(linuxFile(), { force: true });
    } else {
      app.setLoginItemSettings({ openAtLogin: !!on, path: exePath(), args: [HIDDEN_ARG] });
    }
    logger.info('autostart', `Start with the system: ${on ? 'on' : 'off'}`);
  } catch (err) {
    logger.error('autostart', 'Changing the autostart setting failed', err);
  }
  return isEnabled();
}
