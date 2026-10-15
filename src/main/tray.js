// System tray: an icon with a menu (track info, previous / play-pause / next, show, quit) and a tooltip
// that follows the current track. Also decides whether closing the window hides it to the tray or quits.
import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;
let getWindow = () => null;
let sendCommand = () => {};
let closeToTray = false;
let quitting = false;
let now = { hasTrack: false, title: '', artist: '', cur: 0, dur: 0, playing: false };
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

export function markQuitting() {
  quitting = true;
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

function toggleWindow() {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
    win.hide();
    rebuildMenu(true);
  } else showWindow();
}

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
  };
  if (!tray) return;
  tray.setToolTip(tooltip());
  rebuildMenu();
}

export const refresh = () => rebuildMenu(true);

export function setLabels(next) {
  if (!next || typeof next !== 'object') return;
  for (const k of Object.keys(labels)) if (typeof next[k] === 'string') labels[k] = next[k].slice(0, 60);
  rebuildMenu(true);
}

export function createTray({ window, onCommand }) {
  getWindow = window;
  sendCommand = onCommand;
  try {
    const file = path.join(__dirname, '..', '..', 'build', 'icon.png');
    const size = process.platform === 'win32' ? 16 : 22;
    const icon = nativeImage.createFromPath(file).resize({ width: size, height: size, quality: 'best' });
    if (icon.isEmpty()) throw new Error('the tray icon file is missing');
    tray = new Tray(icon);
    tray.setToolTip('Glass Player');
    tray.on('click', toggleWindow); // Windows and some Linux desktops; the menu covers the rest
    tray.on('double-click', showWindow);
    rebuildMenu(true);
    logger.info('tray', 'Tray icon created');
  } catch (err) {
    tray = null;
    logger.warn('tray', 'The tray icon could not be created (the closing option will quit the app)', { error: String(err.message || err) });
  }
  return tray;
}
