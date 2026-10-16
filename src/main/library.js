// Local library: listening history and playlists.
// Stored as JSON files in the app's data folder (AppData on Windows):
//   history.json    aggregated stats per track (kept forever, tiny) + a capped log of recent plays
//   playlists.json  playlists (name, cover file name, tracks)
//   covers/<id>.jpg playlist cover images (resized to 512x512)
import { app, dialog, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as logger from './logger.js';

const LOG_LIMIT = 5000; // chronological "recently played" entries; the per-track stats are never trimmed
const COVER_SIZE = 512;
const DAY = 24 * 60 * 60 * 1000;

const key = (track) => `${track.source}:${track.id}`;

// Only the fields we need to show and play a track again
function slim(track) {
  return {
    id: String(track.id),
    source: track.source === 'soundcloud' ? 'soundcloud' : 'youtube',
    title: String(track.title || '').slice(0, 300),
    artist: String(track.artist || '').slice(0, 300),
    album: String(track.album || '').slice(0, 300),
    durationSec: Number(track.durationSec) || 0,
    cover: typeof track.cover === 'string' ? track.cover.slice(0, 600) : '',
    url: typeof track.url === 'string' ? track.url.slice(0, 600) : '',
    hasVideo: !!track.hasVideo,
  };
}

function validTrack(track) {
  return !!track && typeof track === 'object' && track.id && (track.source === 'youtube' || track.source === 'soundcloud');
}

// ---------- A small JSON file store: debounced, atomic writes, survives a corrupt file ----------
function createStore(fileName, defaults) {
  const file = () => path.join(app.getPath('userData'), fileName);
  let data = null;
  let timer = null;

  function load() {
    if (data) return data;
    try {
      data = { ...defaults(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // keep the broken file for inspection instead of silently overwriting it
        const backup = file().replace(/\.json$/, `.corrupt-${Date.now()}.json`);
        try {
          fs.renameSync(file(), backup);
        } catch {
          /* ignore */
        }
        logger.error('library', `${fileName} could not be read, starting empty`, { error: err.message, backup });
      }
      data = defaults();
    }
    return data;
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    if (!data) return;
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      const tmp = file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file());
    } catch (err) {
      logger.error('library', `Saving ${fileName} failed`, err);
    }
  }

  function changed() {
    if (!timer) timer = setTimeout(save, 800);
  }

  return { load, save, changed };
}

const historyStore = createStore('history.json', () => ({ tracks: {}, log: [] }));
const playlistStore = createStore('playlists.json', () => ({ playlists: [] }));

export function flushLibrary() {
  historyStore.save();
  playlistStore.save();
}

// ---------- History ----------
export function recordPlay(track, seconds) {
  if (!validTrack(track)) return false;
  const h = historyStore.load();
  const k = key(track);
  const now = Date.now();
  const entry = h.tracks[k] || { track: slim(track), plays: 0, first: now, last: now, seconds: 0 };
  entry.track = slim(track); // keep the freshest metadata
  entry.plays += 1;
  entry.last = now;
  entry.seconds += Math.max(0, Math.min(Number(seconds) || 0, 6 * 60 * 60));
  h.tracks[k] = entry;
  h.log.push({ k, t: now });
  if (h.log.length > LOG_LIMIT) h.log.splice(0, h.log.length - LOG_LIMIT);
  historyStore.changed();
  logger.debug('library', `Counted a play: ${track.title}`, { plays: entry.plays });
  return true;
}

// view: 'recent' (latest unique tracks), 'top' (most played), 'forgotten' (played a lot, not for 30+ days)
export function getHistory(view = 'recent', limit = 200) {
  const h = historyStore.load();
  const out = (e, t) => ({ track: e.track, plays: e.plays, last: t ?? e.last });
  if (view === 'top') {
    return Object.values(h.tracks)
      .sort((a, b) => b.plays - a.plays || b.last - a.last)
      .slice(0, limit)
      .map((e) => out(e));
  }
  if (view === 'forgotten') {
    const cutoff = Date.now() - 30 * DAY;
    return Object.values(h.tracks)
      .filter((e) => e.plays >= 2 && e.last < cutoff)
      .sort((a, b) => b.plays - a.plays || a.last - b.last)
      .slice(0, limit)
      .map((e) => out(e));
  }
  const seen = new Set();
  const list = [];
  for (let i = h.log.length - 1; i >= 0 && list.length < limit; i--) {
    const { k, t } = h.log[i];
    if (seen.has(k) || !h.tracks[k]) continue;
    seen.add(k);
    list.push(out(h.tracks[k], t));
  }
  return list;
}

// Every track ever counted as listened (for "do not recommend what they already know")
export function heardKeys() {
  return new Set(Object.keys(historyStore.load().tracks));
}

export function getHistoryStats() {
  const h = historyStore.load();
  return { tracks: Object.keys(h.tracks).length, plays: h.log.length };
}

// Forget one track completely: its stats and its entries in the recent log
export function removeFromHistory(trackKey) {
  const h = historyStore.load();
  if (!h.tracks[trackKey]) return false;
  delete h.tracks[trackKey];
  h.log = h.log.filter((e) => e.k !== trackKey);
  historyStore.changed();
  logger.debug('library', 'Removed a track from history', { key: trackKey });
  return true;
}

export function clearHistory() {
  const h = historyStore.load();
  h.tracks = {};
  h.log = [];
  historyStore.changed();
  logger.info('library', 'History cleared');
  return true;
}

// ---------- Playlists ----------
const coversDir = () => path.join(app.getPath('userData'), 'covers');
const coverFile = (id) => path.join(coversDir(), `${id}.jpg`);
const coverCache = new Map(); // id -> { stamp, url }

function readCover(pl) {
  if (!pl.cover) return null;
  const hit = coverCache.get(pl.id);
  if (hit && hit.stamp === pl.cover) return hit.url;
  try {
    const url = 'data:image/jpeg;base64,' + fs.readFileSync(coverFile(pl.id)).toString('base64');
    coverCache.set(pl.id, { stamp: pl.cover, url });
    return url;
  } catch {
    return null;
  }
}

const summary = (pl) => ({
  id: pl.id,
  name: pl.name,
  count: pl.tracks.length,
  duration: pl.tracks.reduce((sum, t) => sum + (t.durationSec || 0), 0),
  updated: pl.updated,
  cover: readCover(pl),
  covers: pl.tracks.slice(0, 4).map((t) => t.cover).filter(Boolean), // fallback mosaic when there is no own cover
});

const full = (pl) => ({ ...summary(pl), tracks: pl.tracks });

const cleanName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);

function findPlaylist(id) {
  return playlistStore.load().playlists.find((p) => p.id === id) || null;
}

// Images the user picked but has not saved yet. The page only ever sees a token, never a path.
const picked = new Map();

export async function pickImage(parentWindow) {
  const res = await dialog.showOpenDialog(parentWindow, {
    title: 'Choose a cover image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const img = nativeImage.createFromPath(res.filePaths[0]);
  if (img.isEmpty()) {
    logger.warn('library', 'The chosen file is not a readable image', { file: path.basename(res.filePaths[0]) });
    return { error: 'notImage' };
  }
  const token = crypto.randomUUID();
  picked.set(token, img);
  if (picked.size > 8) picked.delete(picked.keys().next().value);
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  const preview = img
    .crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    .resize({ width: 160, height: 160, quality: 'good' })
    .toDataURL();
  return { token, preview };
}

function saveCover(id, token) {
  const img = picked.get(token);
  if (!img) return false;
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  const out = square.resize({ width: COVER_SIZE, height: COVER_SIZE, quality: 'best' }).toJPEG(88);
  fs.mkdirSync(coversDir(), { recursive: true });
  fs.writeFileSync(coverFile(id), out);
  coverCache.delete(id);
  picked.delete(token);
  return true;
}

function removeCoverFile(id) {
  try {
    fs.rmSync(coverFile(id), { force: true });
  } catch {
    /* ignore */
  }
  coverCache.delete(id);
}

export function listPlaylists() {
  return playlistStore.load().playlists.map(summary);
}

export function getPlaylist(id) {
  const pl = findPlaylist(id);
  return pl ? full(pl) : null;
}

export function createPlaylist({ name, coverToken } = {}) {
  const s = playlistStore.load();
  const pl = { id: crypto.randomUUID(), name: cleanName(name) || 'New playlist', cover: '', tracks: [], created: Date.now(), updated: Date.now() };
  if (coverToken && saveCover(pl.id, coverToken)) pl.cover = String(Date.now());
  s.playlists.push(pl);
  playlistStore.changed();
  logger.info('library', `Playlist created: ${pl.name}`);
  return full(pl);
}

// patch: { name?, coverToken?, removeCover? }
export function updatePlaylist(id, patch = {}) {
  const pl = findPlaylist(id);
  if (!pl) return null;
  if (patch.name !== undefined) pl.name = cleanName(patch.name) || pl.name;
  if (patch.removeCover) {
    removeCoverFile(id);
    pl.cover = '';
  } else if (patch.coverToken && saveCover(id, patch.coverToken)) {
    pl.cover = String(Date.now());
  }
  pl.updated = Date.now();
  playlistStore.changed();
  return full(pl);
}

export function deletePlaylist(id) {
  const s = playlistStore.load();
  const i = s.playlists.findIndex((p) => p.id === id);
  if (i < 0) return false;
  const [pl] = s.playlists.splice(i, 1);
  removeCoverFile(id);
  playlistStore.changed();
  logger.info('library', `Playlist deleted: ${pl.name}`);
  return true;
}

export function addToPlaylist(id, tracks) {
  const pl = findPlaylist(id);
  if (!pl) return null;
  const have = new Set(pl.tracks.map(key));
  let added = 0;
  for (const tr of Array.isArray(tracks) ? tracks : [tracks]) {
    if (!validTrack(tr) || have.has(key(tr))) continue;
    have.add(key(tr));
    pl.tracks.push(slim(tr));
    added++;
  }
  if (added) {
    pl.updated = Date.now();
    playlistStore.changed();
  }
  return { added, skipped: (Array.isArray(tracks) ? tracks.length : 1) - added, name: pl.name, count: pl.tracks.length };
}

export function removeFromPlaylist(id, trackKey) {
  const pl = findPlaylist(id);
  if (!pl) return null;
  pl.tracks = pl.tracks.filter((t) => key(t) !== trackKey);
  pl.updated = Date.now();
  playlistStore.changed();
  return full(pl);
}
