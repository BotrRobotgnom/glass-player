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
import { scanFolder, isAudioFile } from './local.js';

const LOG_LIMIT = 5000; // chronological "recently played" entries; the per-track stats are never trimmed
const COVER_SIZE = 512;
const DAY = 24 * 60 * 60 * 1000;

const key = (track) => `${track.source}:${track.id}`;

// Only the fields we need to show and play a track again
function slim(track) {
  return {
    id: String(track.id),
    source: track.source === 'soundcloud' ? 'soundcloud' : track.source === 'local' ? 'local' : 'youtube',
    title: String(track.title || '').slice(0, 300),
    artist: String(track.artist || '').slice(0, 300),
    artistId: String(track.artistId || '').slice(0, 60),
    albumId: String(track.albumId || '').slice(0, 60),
    genre: String(track.genre || '').slice(0, 40),
    tags: Array.isArray(track.tags) ? track.tags.slice(0, 8).map((x) => String(x).slice(0, 32)) : [],
    album: String(track.album || '').slice(0, 300),
    durationSec: Number(track.durationSec) || 0,
    cover: typeof track.cover === 'string' ? track.cover.slice(0, 600) : '',
    url: typeof track.url === 'string' ? track.url.slice(0, 600) : '',
    hasVideo: !!track.hasVideo,
    // a file on this computer: where it is, and the playlist (linked folder) it came from
    ...(track.source === 'local' ? { path: String(track.path || '').slice(0, 1000), playlistId: String(track.playlistId || '').slice(0, 60) } : {}),
  };
}

function validTrack(track) {
  return !!track && typeof track === 'object' && track.id && (track.source === 'youtube' || track.source === 'soundcloud' || track.source === 'local');
}

// ---------- A small JSON file store: debounced, atomic writes, survives a corrupt file ----------
function createStore(fileName, defaults) {
  const file = () => path.join(app.getPath('userData'), fileName);
  let data = null;
  let timer = null;

  const readJson = (f) => {
    const text = fs.readFileSync(f, 'utf8');
    if (!text.trim()) throw new Error('file is empty');
    return JSON.parse(text);
  };

  function load() {
    if (data) return data;
    try {
      data = { ...defaults(), ...readJson(file()) };
    } catch (err) {
      data = null;
      if (err.code !== 'ENOENT') {
        // keep the broken file for inspection instead of silently overwriting it
        const backup = file().replace(/\.json$/, `.corrupt-${Date.now()}.json`);
        try {
          fs.renameSync(file(), backup);
        } catch {
          /* ignore */
        }
        logger.error('library', `${fileName} could not be read`, { error: err.message, backup });
      }
      // the previous good copy is kept next to the file: use it before starting empty
      try {
        data = { ...defaults(), ...readJson(file() + '.bak') };
        logger.warn('library', `${fileName} restored from the backup copy`);
      } catch {
        data = defaults();
      }
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
      // write and flush to disk before the rename, so an interrupted save cannot leave an empty file
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, JSON.stringify(data));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      // keep the previous good version as a backup
      try {
        if (fs.statSync(file()).size > 2) fs.copyFileSync(file(), file() + '.bak');
      } catch {
        /* no previous file yet */
      }
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
const reactionStore = createStore('reactions.json', () => ({ items: {} }));
const blockedStore = createStore('blocked.json', () => ({ ids: {}, ok: {} }));

export function flushLibrary() {
  historyStore.save();
  playlistStore.save();
  reactionStore.save();
  blockedStore.save();
}

// ---------- Likes and dislikes ----------
// value: 1 = like, -1 = dislike, 0 = remove the mark
export function setReaction(track, value, pair = '') {
  if (!validTrack(track)) return 0;
  const r = reactionStore.load();
  const k = key(track);
  const v = value > 0 ? 1 : value < 0 ? -1 : 0;
  const group = String(pair || '').slice(0, 200);
  if (v === 0) {
    delete r.items[k];
    // the same song on the other service is cleared together with it
    if (group) for (const [kk, e] of Object.entries(r.items)) if (e.pair === group) delete r.items[kk];
  } else r.items[k] = { track: slim(track), v, at: Date.now(), pair: group };
  reactionStore.changed();
  logger.info('library', `${v > 0 ? 'Liked' : v < 0 ? 'Disliked' : 'Cleared the mark on'} "${track.title}"`);
  return v;
}

// kind: 'liked' | 'disliked'; newest first, one entry per song (its versions on both services share a pair id)
export function getReactions(kind = 'liked', limit = 500) {
  const want = kind === 'disliked' ? -1 : 1;
  const seen = new Set();
  const out = [];
  for (const e of Object.values(reactionStore.load().items).filter((x) => x.v === want).sort((a, b) => b.at - a.at)) {
    if (e.pair) {
      if (seen.has(e.pair)) continue;
      seen.add(e.pair);
    }
    out.push({ track: e.track, at: e.at, pair: e.pair || '' });
    if (out.length >= limit) break;
  }
  return out;
}

// { "youtube:id": 1 | -1 } for marking rows in the interface
export function reactionMap() {
  const out = {};
  for (const [k, e] of Object.entries(reactionStore.load().items)) out[k] = e.v;
  return out;
}

export function dislikedKeys() {
  return new Set(Object.entries(reactionStore.load().items).filter(([, e]) => e.v < 0).map(([k]) => k));
}

// ---------- Videos the player refused to embed (learned while playing) ----------
export function markBlocked(videoId) {
  const b = blockedStore.load();
  if (!videoId || b.ids[videoId]) return;
  b.ids[videoId] = Date.now();
  delete b.ok[videoId];
  blockedStore.changed();
}
// videos checked and found embeddable are remembered for a while, so Home and search don't re-check them
const OK_TTL = 30 * 24 * 60 * 60 * 1000;
export function markEmbeddableOk(videoId) {
  const b = blockedStore.load();
  if (!videoId || b.ids[videoId]) return;
  b.ok[videoId] = Date.now();
  const keys = Object.keys(b.ok);
  if (keys.length > 4000) {
    for (const k of keys.sort((x, y) => b.ok[x] - b.ok[y]).slice(0, 2000)) delete b.ok[k];
  }
  blockedStore.changed();
}
export const isKnownEmbeddable = (videoId) => {
  const at = blockedStore.load().ok[videoId];
  return !!at && Date.now() - at < OK_TTL;
};
export const isKnownBlocked = (videoId) => !!blockedStore.load().ids[videoId];

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
  folder: pl.folder || '',
  covers: pl.tracks.slice(0, 4).map((t) => t.cover).filter(Boolean), // fallback mosaic when there is no own cover
});

const full = (pl) => ({ ...summary(pl), tracks: pl.tracks, folderName: pl.folder ? path.basename(pl.folder) || pl.folder : '' });

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

export async function createPlaylist({ name, coverToken, folder } = {}) {
  const s = playlistStore.load();
  const pl = { id: crypto.randomUUID(), name: cleanName(name) || 'New playlist', cover: '', tracks: [], created: Date.now(), updated: Date.now() };
  if (coverToken && saveCover(pl.id, coverToken)) pl.cover = String(Date.now());
  s.playlists.push(pl);
  if (folder) await linkFolder(pl, folder);
  playlistStore.changed();
  logger.info('library', `Playlist created: ${pl.name}`);
  return full(pl);
}

// ---------- Playlists linked to a folder of audio files ----------
// The playlist mirrors the folder: files that appear are added, files that vanish are dropped. A track the user removed by hand
// stays out (`hidden`). Tracks from YouTube / SoundCloud added to the same playlist are left alone.
async function syncFolder(pl) {
  if (!pl.folder) return { missing: false };
  try {
    await fs.promises.access(pl.folder);
  } catch {
    logger.warn('library', `Linked folder not found: ${pl.folder}`);
    return { missing: true };
  }
  const hidden = new Set(pl.hidden || []);
  const scanned = (await scanFolder(pl.folder)).filter((t) => !hidden.has(key(t))).map((t) => slim({ ...t, playlistId: pl.id }));
  const others = pl.tracks.filter((t) => t.source !== 'local');
  pl.tracks = [...scanned, ...others];
  pl.updated = Date.now();
  for (const t of scanned) localPaths.set(t.id, t.path);
  playlistStore.changed();
  return { missing: false };
}

async function linkFolder(pl, folder) {
  pl.folder = path.resolve(String(folder));
  pl.hidden = [];
  await syncFolder(pl);
}

export async function rescanPlaylist(id) {
  const pl = findPlaylist(id);
  if (!pl) return null;
  const { missing } = await syncFolder(pl);
  return { ...full(pl), folderMissing: missing };
}

export async function pickFolder(parentWindow) {
  const res = await dialog.showOpenDialog(parentWindow, { title: 'Choose a folder with music', properties: ['openDirectory'] });
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

// Where a local track's file is. Only files that belong to the library are ever served.
const localPaths = new Map();
export function findLocalPath(id) {
  const known = localPaths.get(id);
  if (known) return known;
  const consider = (t) => {
    if (t && t.source === 'local' && t.path) localPaths.set(String(t.id), t.path);
  };
  for (const pl of playlistStore.load().playlists) pl.tracks.forEach(consider);
  Object.values(historyStore.load().tracks).forEach((e) => consider(e.track));
  Object.values(reactionStore.load().items).forEach((e) => consider(e.track));
  const found = localPaths.get(id);
  return found && isAudioFile(found) ? found : null;
}

// patch: { name?, coverToken?, removeCover? }
export async function updatePlaylist(id, patch = {}) {
  const pl = findPlaylist(id);
  if (!pl) return null;
  if (patch.name !== undefined) pl.name = cleanName(patch.name) || pl.name;
  if (patch.removeCover) {
    removeCoverFile(id);
    pl.cover = '';
  } else if (patch.coverToken && saveCover(id, patch.coverToken)) {
    pl.cover = String(Date.now());
  }
  // patch.folder: a path links (and scans) that folder, null unlinks it (the tracks stay)
  if (patch.folder) await linkFolder(pl, patch.folder);
  else if (patch.folder === null && pl.folder) {
    delete pl.folder;
    delete pl.hidden;
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
  // a file of the linked folder removed by hand must not come back with the next scan
  if (pl.folder && String(trackKey).startsWith('local:')) pl.hidden = [...new Set([...(pl.hidden || []), trackKey])];
  pl.tracks = pl.tracks.filter((t) => key(t) !== trackKey);
  pl.updated = Date.now();
  playlistStore.changed();
  return full(pl);
}
