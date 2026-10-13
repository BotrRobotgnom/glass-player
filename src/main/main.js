import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import os from 'node:os';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';
import { searchYouTube, suggestYouTube, extractVideoId, getYouTubeTrack, markEmbeddable } from './youtube.js';
import { searchSoundCloud, resolveSoundCloud, isSoundCloudUrl } from './soundcloud.js';
import { pickBest, splitArtistTitle } from './match.js';
import { initUpdater, startAutoCheck, checkForUpdates, installUpdate, getUpdateState } from './updater.js';
import * as logger from './logger.js';
import { registerDebugIpc, openDebugWindow, closeDebugWindow } from './debugWindow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(__dirname, '..', 'renderer');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Errors that would otherwise vanish: keep them in the log (and tell the user about fatal ones)
process.on('unhandledRejection', (reason) => {
  logger.error('main', 'Unhandled promise rejection', reason instanceof Error ? reason : { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('main', 'Uncaught exception', err);
  if (app.isReady()) dialog.showErrorBox('Glass Player: unexpected error', String(err?.stack || err));
});

// ---------- Window effects (blur behind the window) ----------
// Windows 11 22H2 (build 22621) is the first build where Electron's backgroundMaterial works.
// macOS uses vibrancy. Everywhere else the window is opaque.
function windowsBuild() {
  return Number.parseInt(os.release().split('.')[2] || '0', 10);
}

function detectEffects() {
  if (isWin) {
    if (windowsBuild() >= 22621) return { effects: ['acrylic', 'mica', 'none'], defaultEffect: 'acrylic', hint: null };
    return { effects: ['none'], defaultEffect: 'none', hint: 'winOld' };
  }
  if (isMac) return { effects: ['vibrancy', 'none'], defaultEffect: 'vibrancy', hint: null };
  return { effects: ['none'], defaultEffect: 'none', hint: 'linux' };
}

const effectInfo = detectEffects();

// Windows draws acrylic/mica as a flat colour when "Transparency effects" is turned off
// (Settings > Personalization > Colors), so read that switch from the registry to tell the user.
function readTransparencyEnabled() {
  return new Promise((resolve) => {
    if (!isWin) return resolve(true);
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(true); // key missing: Windows default is on
        const m = String(stdout).match(/EnableTransparency\s+REG_DWORD\s+0x([0-9a-f]+)/i);
        resolve(m ? Number.parseInt(m[1], 16) !== 0 : true);
      },
    );
  });
}

let win = null;
let origin = '';
let currentEffect = effectInfo.defaultEffect;

function rendererLevel(level) {
  // Electron >= 35 sends 'verbose' | 'info' | 'warning' | 'error'; older versions send 0..3
  if (level === 'error' || level === 3) return 'error';
  if (level === 'warning' || level === 2) return 'warn';
  if (level === 'verbose' || level === 0) return 'debug';
  return 'info';
}

async function createWindow() {
  logger.initFileLogging();
  logger.info('app', `Glass Player v${app.getVersion()} starting`, {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    os: os.release(),
    packaged: app.isPackaged,
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    userData: app.getPath('userData'),
  });
  logger.info('window', 'Effects available', { ...effectInfo, windowsBuild: isWin ? windowsBuild() : undefined });
  if (isWin) logger.info('window', 'Windows "Transparency effects" enabled', { enabled: await readTransparencyEnabled() });

  const { port } = await startServer(rendererDir);
  origin = `http://127.0.0.1:${port}`;
  logger.info('app', 'Local server started', { origin });

  const blurred = effectInfo.defaultEffect !== 'none';

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    frame: false,
    show: false,
    title: 'Glass Player',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    // A fully transparent background lets the system material (acrylic / vibrancy) show through.
    // Without a material the window is opaque, and the page paints its own solid background.
    backgroundColor: blurred ? '#00000000' : '#1f222a',
    ...(isWin && blurred ? { backgroundMaterial: effectInfo.defaultEffect } : {}),
    ...(isMac ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false, // keep player timers running while the window is minimized
    },
  });

  // Open external links in the browser instead of inside the player
  win.webContents.setWindowOpenHandler(({ url }) => {
    logger.debug('window', 'Opening external link', { url });
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Page console output and failures go to the log too
  win.webContents.on('console-message', (event) => {
    const isMain = !event.frame || event.frame === win.webContents.mainFrame;
    const level = isMain ? rendererLevel(event.level) : 'debug'; // embedded players are noisy
    logger.log(level, isMain ? 'renderer' : 'frame', event.message, event.sourceId ? { at: `${event.sourceId}:${event.lineNumber}` } : undefined);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => logger.error('renderer', 'Page failed to load', { code, desc, url }));
  win.webContents.on('render-process-gone', (_e, details) => logger.error('renderer', 'Render process gone', details));
  win.on('unresponsive', () => logger.warn('window', 'Window is not responding'));

  win.once('ready-to-show', () => {
    logger.info('window', 'Window ready');
    win.show();
  });
  win.on('maximize', () => {
    logger.debug('window', 'Maximized');
    win.webContents.send('win:maximized', true);
  });
  win.on('unmaximize', () => {
    logger.debug('window', 'Restored');
    win.webContents.send('win:maximized', false);
  });
  win.on('focus', () => logger.debug('window', 'Focus gained'));
  win.on('blur', () => logger.debug('window', 'Focus lost'));
  win.on('close', () => closeDebugWindow());

  await win.loadURL(origin);

  initUpdater((channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  });
  startAutoCheck();
}

// ---------- IPC ----------

registerDebugIpc();

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:get', () => getUpdateState());
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:install', () => installUpdate());

// Logging from the page (fire and forget)
ipcMain.on('log:write', (_e, level, source, message, data) => {
  const lv = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
  logger.log(lv, typeof source === 'string' ? source : 'renderer', message, data);
});
ipcMain.on('log:setVerbose', (_e, on) => logger.setVerbose(!!on));
ipcMain.handle('debug:open', () => openDebugWindow(origin));

ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:toggleMaximize', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('win:close', () => win?.close());
ipcMain.handle('win:alwaysOnTop', (_e, on) => win?.setAlwaysOnTop(!!on));
ipcMain.handle('win:getInfo', async () => ({
  ...effectInfo,
  platform: process.platform,
  transparencyEnabled: await readTransparencyEnabled(),
}));
ipcMain.handle('win:setEffect', (_e, effect) => {
  if (!win || !effectInfo.effects.includes(effect)) {
    logger.warn('window', 'Rejected window effect', { effect });
    return false;
  }
  try {
    if (isWin) win.setBackgroundMaterial(effect); // 'acrylic' | 'mica' | 'none'
    else if (isMac) win.setVibrancy(effect === 'vibrancy' ? 'under-window' : null);
    currentEffect = effect;
    logger.info('window', `Window effect set to ${effect}`, { focused: win.isFocused() });
    return true;
  } catch (err) {
    logger.error('window', `Setting window effect "${effect}" failed`, err);
    return false;
  }
});

ipcMain.handle('suggest', async (_e, query) => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  try {
    return await suggestYouTube(q);
  } catch (err) {
    logger.debug('search', 'Suggestions failed', err);
    return [];
  }
});

// Universal search: YouTube Music first (priority), then SoundCloud.
// A pasted link is opened directly.
ipcMain.handle('search', async (_e, { query, sources }) => {
  const q = String(query || '').trim();
  if (!q) return { youtube: [], soundcloud: [], errors: {} };
  const want = new Set(sources || ['youtube', 'soundcloud']);
  const out = { youtube: [], soundcloud: [], errors: {} };
  const started = Date.now();
  logger.debug('search', `Search: "${q}"`, { sources: [...want] });

  const done = async () => {
    await markEmbeddable(out.youtube);
    const ms = Date.now() - started;
    const failed = Object.keys(out.errors);
    const blocked = out.youtube.filter((x) => x.embeddable === false).length;
    if (blocked) logger.info('search', `${blocked} YouTube result(s) cannot be embedded`);
    logger.log(failed.length ? 'warn' : 'info', 'search', `Search finished in ${ms} ms: ${out.youtube.length} YouTube, ${out.soundcloud.length} SoundCloud`, failed.length ? { errors: out.errors } : undefined);
    return out;
  };

  const videoId = extractVideoId(q);
  if (videoId && /youtu|^[\w-]{11}$/.test(q)) {
    try {
      out.youtube = [await getYouTubeTrack(videoId)];
    } catch (err) {
      out.errors.youtube = err.message;
    }
    return await done();
  }
  if (isSoundCloudUrl(q)) {
    try {
      out.soundcloud = await resolveSoundCloud(q);
    } catch (err) {
      out.errors.soundcloud = err.message;
    }
    return await done();
  }

  await Promise.all([
    want.has('youtube')
      ? searchYouTube(q).then((r) => (out.youtube = r)).catch((err) => (out.errors.youtube = err.message))
      : null,
    want.has('soundcloud')
      ? searchSoundCloud(q).then((r) => (out.soundcloud = r)).catch((err) => (out.errors.soundcloud = err.message))
      : null,
  ]);
  return await done();
});

// For a SoundCloud track, look for the official version on YouTube Music.
ipcMain.handle('findOfficial', async (_e, track) => {
  try {
    const { artist, title } = splitArtistTitle(track);
    const query = [artist, title].filter(Boolean).join(' ');
    const all = await searchYouTube(query, { type: 'song', limit: 8 });
    await markEmbeddable(all);
    // an official version that the player refuses to embed is useless: keep only playable candidates
    const candidates = all.filter((c) => c.embeddable !== false);
    if (candidates.length < all.length) logger.info('match', `Skipped ${all.length - candidates.length} non-embeddable candidate(s)`);
    const best = pickBest(track, candidates);
    if (best) {
      logger.info('match', `Official version found for "${track.title}"`, {
        match: `${best.track.artist} - ${best.track.title}`,
        score: Number(best.score.toFixed(2)),
        candidates: candidates.length,
      });
    } else {
      logger.info('match', `No official version found for "${track.title}"`, { query, candidates: candidates.length });
    }
    return best ? { track: best.track, score: best.score } : null;
  } catch (err) {
    logger.warn('match', 'Official version lookup failed', err);
    return null;
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
