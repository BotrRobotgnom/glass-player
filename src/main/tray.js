// System tray: an icon with a menu (track info, previous / play-pause / next, show, quit) and a tooltip
// that follows the current track. Also decides whether closing the window hides it to the tray or quits.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;
let getWindow = () => null;
let sendCommand = () => {};
let closeToTray = false;
let quitting = false;
let now = { hasTrack: false, title: '', artist: '', cur: 0, dur: 0, playing: false, cover: '', theme: 'silver' };
let getOrigin = () => '';
let popup = null;
let popupHiddenAt = 0;
let labels = {
  show: 'Show Glass Player',
  hide: 'Hide window',
  quit: 'Quit',
  prev: 'Previous',
  next: 'Next',
  play: 'Play',
  pause: 'Pause',
  nothing: 'Nothing playing',
};
let menuKey = '';

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export const isTrayAvailable = () => !!tray;
export const isQuitting = () => quitting;

export function destroyPopup() {
  if (popup && !popup.isDestroyed()) popup.destroy();
  popup = null;
}

export function markQuitting() {
  quitting = true;
  destroyPopup();
}

// Whether the window's close button should hide the window instead of closing it
export function shouldHideOnClose() {
  return closeToTray && !!tray && !quitting;
}

export function setCloseToTray(on) {
  closeToTray = !!on;
  logger.info('tray', `Closing the window ${closeToTray ? 'hides it to the tray' : 'quits the app'}`);
}

export function showWindow() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  rebuildMenu(true);
}

// ---------- The small player popup ----------
const POPUP_W = 340;
const POPUP_H = 178;

function popupState() {
  return { ...now, labels };
}

function pushPopupState() {
  if (popup && !popup.isDestroyed() && popup.isVisible()) popup.webContents.send('tray:state', popupState());
}

function createPopup() {
  popup = new BrowserWindow({
    width: POPUP_W,
    height: POPUP_H,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Glass Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload-tray.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  popup.setMenuBarVisibility(false);
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popup.webContents.on('will-navigate', (e) => e.preventDefault());
  popup.on('blur', () => hidePopup());
  popup.on('closed', () => {
    popup = null;
  });
  popup.loadURL(`${getOrigin()}/tray.html`).catch((err) => logger.warn('tray', 'Popup failed to load', { error: String(err.message || err) }));
}

function hidePopup() {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide();
    popupHiddenAt = Date.now();
  }
}

// Next to the tray icon; where the system gives no icon position (some Linux desktops), at the mouse
function placePopup(bounds) {
  const hasBounds = bounds && bounds.width > 0 && bounds.height > 0;
  const anchor = hasBounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).workArea;
  let x = Math.round(anchor.x - POPUP_W / 2);
  const below = anchor.y < area.y + area.height / 2; // the tray is at the top: open downwards
  let y = below ? Math.round((hasBounds ? bounds.y + bounds.height : anchor.y) + 8) : Math.round((hasBounds ? bounds.y : anchor.y) - POPUP_H - 8);
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - POPUP_W - 8);
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - POPUP_H - 8);
  popup.setPosition(x, y, false);
}

export function togglePopup(bounds) {
  // clicking the icon while the popup is open first blurs (hides) it: do not open it again right away
  if (Date.now() - popupHiddenAt < 300) return;
  if (!popup || popup.isDestroyed()) createPopup();
  if (popup.isVisible()) return hidePopup();
  placePopup(bounds);
  popup.webContents.send('tray:state', popupState());
  popup.show();
  popup.focus();
}

ipcMain.on('tray:popupReady', () => pushPopupState());
ipcMain.on('tray:popupCommand', (_e, cmd) => {
  if (cmd === 'prev' || cmd === 'next' || cmd === 'toggle') sendCommand(cmd);
  else if (cmd && cmd.type === 'seek' && Number.isFinite(cmd.fraction)) sendCommand({ type: 'seek', fraction: Math.min(1, Math.max(0, cmd.fraction)) });
});
ipcMain.on('tray:popupOpen', () => {
  hidePopup();
  showWindow();
});
ipcMain.on('tray:popupClose', () => hidePopup());
if (process.env.GP_TEST) ipcMain.on('tray:test', (_e, bounds) => togglePopup(bounds)); // lets automated tests open the popup

function tooltip() {
  if (!now.hasTrack) return 'Glass Player';
  const head = [now.title, now.artist].filter(Boolean).join(' — ');
  const time = now.dur ? `${fmt(now.cur)} / ${fmt(now.dur)}` : fmt(now.cur);
  // Windows cuts tooltips at 127 characters
  return `${head}\n${now.playing ? '▶' : '❚❚'} ${time}`.slice(0, 127);
}

function rebuildMenu(force = false) {
  if (!tray) return;
  const win = getWindow();
  const visible = !!win && !win.isDestroyed() && win.isVisible();
  const key = JSON.stringify([now.hasTrack, now.title, now.artist, now.dur, now.playing, visible, labels]);
  if (!force && key === menuKey) return;
  menuKey = key;
  const head = now.hasTrack ? [now.title, now.artist].filter(Boolean).join(' — ') : labels.nothing;
  const items = [
    { label: head.slice(0, 80), enabled: false },
    ...(now.hasTrack && now.dur ? [{ label: fmt(now.dur), enabled: false }] : []),
    { type: 'separator' },
    { label: labels.prev, enabled: now.hasTrack, click: () => sendCommand('prev') },
    { label: now.playing ? labels.pause : labels.play, enabled: now.hasTrack, click: () => sendCommand('toggle') },
    { label: labels.next, enabled: now.hasTrack, click: () => sendCommand('next') },
    { type: 'separator' },
    { label: visible ? labels.hide : labels.show, click: () => (visible ? win.hide() : showWindow()) },
    { label: labels.quit, click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// The page reports the current track about once a second
export function setNowPlaying(info) {
  if (!info || typeof info !== 'object') return;
  now = {
    hasTrack: !!info.hasTrack,
    title: String(info.title || '').slice(0, 200),
    artist: String(info.artist || '').slice(0, 200),
    cur: Number(info.cur) || 0,
    dur: Number(info.dur) || 0,
    playing: !!info.playing,
    cover: typeof info.cover === 'string' && /^https:\/\//.test(info.cover) ? info.cover.slice(0, 600) : '',
    theme: info.theme === 'graphite' ? 'graphite' : 'silver',
  };
  if (!tray) return;
  tray.setToolTip(tooltip());
  rebuildMenu();
  pushPopupState();
}

export const refresh = () => rebuildMenu(true);

export function setLabels(next) {
  if (!next || typeof next !== 'object') return;
  for (const k of Object.keys(labels)) if (typeof next[k] === 'string') labels[k] = next[k].slice(0, 60);
  rebuildMenu(true);
}

export function createTray({ window, onCommand, origin }) {
  getWindow = window;
  getOrigin = origin;
  sendCommand = onCommand;
  try {
    const file = path.join(__dirname, '..', '..', 'build', 'icon.png');
    const size = process.platform === 'win32' ? 16 : 22;
    const icon = nativeImage.createFromPath(file).resize({ width: size, height: size, quality: 'best' });
    if (icon.isEmpty()) throw new Error('the tray icon file is missing');
    tray = new Tray(icon);
    tray.setToolTip('Glass Player');
    tray.on('click', (_e, bounds) => togglePopup(bounds)); // Windows and some Linux desktops; the menu covers the rest
    tray.on('double-click', showWindow);
    rebuildMenu(true);
    logger.info('tray', 'Tray icon created');
  } catch (err) {
    tray = null;
    logger.warn('tray', 'The tray icon could not be created (the closing option will quit the app)', { error: String(err.message || err) });
  }
  return tray;
}
