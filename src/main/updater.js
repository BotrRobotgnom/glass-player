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

// Asks the GitHub API for the newest published (non-draft, non-prerelease) release.
// Returns null when there is none. electron-updater's own lookup scrapes the releases page and fails
// with a confusing "406" when nothing is published, so we ask the API first and only hand over to
// electron-updater when a newer version really exists.
async function fetchLatestRelease(cfg) {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'glass-player' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
  return res.json();
}

// Long technical errors (headers, XML) are cut down to something that fits in the UI and the log
function shortMessage(err) {
  const raw = String(err?.message || err || 'error');
  const first = raw.split('\n')[0].replace(/\s+/g, ' ').trim();
  return first.length > 220 ? first.slice(0, 217) + '...' : first;
}

// Known conditions get a code the renderer translates; anything else shows the short message
function errorState(err) {
  const raw = String(err?.message || err || '');
  if (/unsupported provider/i.test(raw)) return { status: 'error', code: 'notConfigured' };
  if (/unable to find latest version|production release exists|HttpError: (404|406)/i.test(raw)) {
    return { status: 'none', code: 'noReleases' };
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|fetch failed|timed? ?out|aborted/i.test(raw)) {
    return { status: 'error', code: 'offline' };
  }
  return { status: 'error', message: shortMessage(err) };
}

let failing = false; // electron-updater reports a failure twice (event + rejected promise): handle it once

function failWith(err, where) {
  if (failing) return;
  failing = true;
  setTimeout(() => (failing = false), 1000);
  const st = errorState(err);
  logger.log(st.code === 'noReleases' ? 'info' : 'warn', 'update', `Update check failed (${where}): ${shortMessage(err)}`, { code: st.code });
  setState(st);
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
    const rel = await fetchLatestRelease(cfg);
    if (!rel) {
      logger.info('update', 'No published release found on GitHub (drafts are not visible to the app)', cfg);
      setState({ status: 'none', code: 'noReleases' });
      return;
    }
    const latest = String(rel.tag_name).replace(/^v/, '');
    logger.info('update', `Latest published release: ${latest}, installed: ${app.getVersion()}`);
    if (!newer(latest, app.getVersion())) {
      setState({ status: 'none' });
      return;
    }
    if (canAutoUpdate) await autoUpdater.checkForUpdates();
    else setState({ status: 'manual', version: latest, manualUrl: rel.html_url });
  } catch (err) {
    failWith(err, 'check');
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
  autoUpdater.on('error', (err) => failWith(err, 'updater'));
}

// Quiet check shortly after start (built versions only), then every 6 hours
export function startAutoCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => checkForUpdates(), 8000);
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
}
