// Updates through GitHub Releases (free for a public repository).
//  - Installed Windows build (NSIS) and Linux AppImage: electron-updater downloads the update itself
//    and installs it on quit or via the "Restart & update" button.
//  - Portable build, .deb, running from source: auto-update is technically impossible,
//    so we only check the latest release and offer a link to it.
// States carry a `code` (not a sentence) for known conditions; the renderer translates it.
import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import electronUpdater from 'electron-updater';
import * as logger from './logger.js';

const { autoUpdater } = electronUpdater;

const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const canAutoUpdate =
  app.isPackaged && !isPortable && (process.platform !== 'linux' || !!process.env.APPIMAGE);

let send = () => {};
let state = { status: 'idle', version: null, percent: 0, manualUrl: null, code: null, message: '', isPortable, canAutoUpdate };

function setState(patch) {
  state = { ...state, code: null, message: '', ...patch };
  const lvl = state.status === 'error' ? 'warn' : state.status === 'downloading' && patch.percent > 0 ? 'debug' : 'info';
  logger.log(lvl, 'update', `Update state: ${state.status}`, { version: state.version, percent: state.percent, code: state.code, message: state.message || undefined });
  send('update:state', state);
}

// electron-builder writes app-update.yml into the build from the `publish` settings.
// It only has provider/owner/repo when the build was made from a clone with a GitHub origin remote.
function readUpdateConfig() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const provider = yml.match(/^provider:\s*(\S+)/m)?.[1];
    const owner = yml.match(/^owner:\s*(\S+)/m)?.[1];
    const repo = yml.match(/^repo:\s*(\S+)/m)?.[1];
    return provider && owner && repo ? { provider, owner, repo } : null;
  } catch {
    return null;
  }
}

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

async function manualCheck(cfg) {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'glass-player' },
  });
  if (res.status === 404) {
    setState({ status: 'none', code: 'noReleases' });
    return;
  }
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const rel = await res.json();
  if (newer(rel.tag_name, app.getVersion())) {
    setState({ status: 'manual', version: rel.tag_name.replace(/^v/, ''), manualUrl: rel.html_url });
  } else {
    setState({ status: 'none' });
  }
}

export async function checkForUpdates() {
  try {
    if (!app.isPackaged) {
      setState({ status: 'none', code: 'devBuild' });
      return;
    }
    const cfg = readUpdateConfig();
    if (!cfg) {
      setState({ status: 'error', code: 'notConfigured' });
      return;
    }
    setState({ status: 'checking' });
    if (canAutoUpdate) await autoUpdater.checkForUpdates();
    else await manualCheck(cfg);
  } catch (err) {
    logger.warn('update', 'Update check failed', err);
    setState({ status: 'error', message: err.message || String(err) });
  }
}

export function installUpdate() {
  if (state.status === 'downloaded') autoUpdater.quitAndInstall();
  else if (state.status === 'manual' && state.manualUrl) shell.openExternal(state.manualUrl);
}

export function getUpdateState() {
  return { ...state };
}

export function initUpdater(sendToRenderer) {
  send = sendToRenderer;
  logger.info('update', 'Updater initialised', { canAutoUpdate, isPortable, packaged: app.isPackaged });
  if (!canAutoUpdate) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setState({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => {
    const msg = err.message || String(err);
    logger.warn('update', 'Updater error', err);
    if (/unsupported provider/i.test(msg)) setState({ status: 'error', code: 'notConfigured' });
    else setState({ status: 'error', message: msg });
  });
}

// Quiet check shortly after start (built versions only), then every 6 hours
export function startAutoCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => checkForUpdates(), 8000);
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
}
