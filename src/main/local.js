// Local audio files: scanning a folder and reading tags. Files are played through the local server
// (/local/file/<id>), which only serves files that are known to the library (see library.findLocalPath).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as logger from './logger.js';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wma', '.webm', '.mka']);
export const MIME = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma', '.webm': 'audio/webm', '.mka': 'audio/x-matroska',
};
const MAX_FILES = 5000;
const MAX_DEPTH = 8;

export const localId = (file) => crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 16);
export const isAudioFile = (file) => AUDIO_EXT.has(path.extname(file).toLowerCase());

async function walk(dir, depth, out) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.warn('local', `Cannot read folder ${dir}`, { error: err.message });
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, depth + 1, out);
    else if (e.isFile() && isAudioFile(e.name)) out.push(full);
  }
}

// The tag reader is loaded on first use: a missing package (an install that skipped `npm install`) must not stop the whole app
let reader = null;
async function parseFile(file, opts) {
  if (!reader) reader = import('music-metadata');
  return (await reader).parseFile(file, opts);
}

// Tags of one file as a track. Unreadable tags are not an error: the file name is the title then.
export async function readTrack(file) {
  const base = path.basename(file, path.extname(file));
  const track = { id: localId(file), source: 'local', path: file, title: base, artist: '', album: '', durationSec: 0, cover: '', genre: '', tags: [] };
  try {
    const meta = await parseFile(file, { duration: true });
    const c = meta.common;
    if (c.title) track.title = c.title;
    track.artist = c.artist || (c.artists && c.artists.join(', ')) || '';
    track.album = c.album || '';
    track.genre = (c.genre && c.genre[0]) || '';
    track.durationSec = Math.round(meta.format.duration || 0);
    if (c.picture && c.picture.length) track.cover = `/local/cover/${track.id}`;
  } catch (err) {
    logger.debug('local', `No tags in ${base}`, { error: err.message });
  }
  return track;
}

// Every audio file under `folder` (subfolders included), a few at a time
export async function scanFolder(folder) {
  const files = [];
  await walk(path.resolve(folder), 0, files);
  const tracks = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      tracks[i] = await readTrack(files[i]);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  logger.info('local', `Scanned ${folder}: ${tracks.length} file(s)${files.length >= MAX_FILES ? ' (limit reached)' : ''}`);
  return tracks;
}

// Embedded cover art of a file, or null
export async function readCover(file) {
  try {
    const meta = await parseFile(file, { duration: false });
    const pic = meta.common.picture && meta.common.picture[0];
    return pic ? { data: Buffer.from(pic.data), type: pic.format || 'image/jpeg' } : null;
  } catch {
    return null;
  }
}
