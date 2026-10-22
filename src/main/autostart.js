// Start with the system. Windows and macOS: Electron's login item. Linux: a .desktop file in ~/.config/autostart.
// Only for an installed / packaged app: a development run would register the wrong program.
// The app is started with --hidden so it can go straight to the tray.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import * as logger from './logger.js';

export const HIDDEN_ARG = '--hidden';

// The portable build unpacks itself to a temporary folder: the real file to start is the one the user ran
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
const linuxFile = () => path.join(os.homedir(), '.config', 'autostart', 'silverpane.desktop');
const legacyLinuxFile = () => path.join(os.homedir(), '.config', 'autostart', 'glass-player.desktop');

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
          `[Desktop Entry]\nType=Application\nName=Silverpane\nExec="${exePath()}" ${HIDDEN_ARG}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`,
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

// The app used to be called "Glass Player": a start-with-the-system entry made by an old version points to the old program.
// If there was one, remove it and register the new one, so the setting survives the rename.
export function migrateLegacy() {
  if (!isAvailable()) return;
  try {
    if (process.platform === 'linux') {
      if (fs.existsSync(legacyLinuxFile())) {
        fs.rmSync(legacyLinuxFile(), { force: true });
        setEnabled(true);
        logger.info('autostart', 'Moved the old start-with-the-system entry to the new name');
      }
    } else if (process.platform === 'win32') {
      // the old entry runs "...\\Glass Player.exe": find it among the Run values whatever its name is
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      execFile('reg', ['query', key], { windowsHide: true }, (err, out) => {
        if (err) return;
        const names = String(out)
          .split(/\r?\n/)
          .map((line) => line.match(/^\s+(.+?)\s+REG_\w+\s+(.*)$/))
          .filter((m) => m && /Glass Player\.exe/i.test(m[2]))
          .map((m) => m[1]);
        if (!names.length) return;
        let left = names.length;
        for (const name of names) {
          execFile('reg', ['delete', key, '/v', name, '/f'], { windowsHide: true }, () => {
            if (--left === 0) {
              setEnabled(true);
              logger.info('autostart', 'Moved the old start-with-the-system entry to the new name');
            }
          });
        }
      });
    }
  } catch (err) {
    logger.warn('autostart', 'Could not move the old start-with-the-system entry', { error: String(err.message || err) });
  }
}
