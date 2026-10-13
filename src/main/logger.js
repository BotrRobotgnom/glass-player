// App-wide logger: an in-memory ring buffer (what the Debug log window shows)
// plus a log file in the user's logs folder (survives restarts, handy for bug reports).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_ENTRIES = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

let entries = [];
let seq = 0;
let minLevel = 'info'; // 'debug' while verbose logging is on
const listeners = new Set();
let stream = null;
let filePath = null;

function serializeData(data) {
  if (data === undefined) return undefined;
  try {
    const s = JSON.stringify(data, (_k, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof v === 'bigint') return String(v);
      return v;
    });
    if (s === undefined) return undefined;
    return s.length > 8000 ? s.slice(0, 8000) + '…(truncated)' : s;
  } catch {
    return String(data);
  }
}

function formatLine(e) {
  const data = e.data ? ' ' + e.data : '';
  return `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.source}: ${e.message}${data}`;
}

// Call once after the app is ready: opens the log file and flushes what was logged before that.
export function initFileLogging() {
  if (stream) return;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, 'glass-player.log');
    try {
      if (fs.statSync(filePath).size > MAX_FILE_BYTES) {
        fs.renameSync(filePath, path.join(dir, 'glass-player.old.log'));
      }
    } catch {
      /* no file yet */
    }
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
    stream.write(`\n--- session started ${new Date().toISOString()} ---\n`);
    for (const e of entries) stream.write(formatLine(e) + '\n');
  } catch {
    stream = null;
  }
}

export function getLogFilePath() {
  return filePath;
}

export function log(level, source, message, data) {
  if (!LEVELS[level]) level = 'info';
  if (LEVELS[level] < LEVELS[minLevel]) return null;
  const entry = {
    id: ++seq,
    t: Date.now(),
    level,
    source: String(source || 'app').slice(0, 24),
    message: String(message ?? '').slice(0, 4000),
    data: serializeData(data),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (stream) stream.write(formatLine(entry) + '\n');
  for (const fn of listeners) {
    try {
      fn({ type: 'entry', entry });
    } catch {
      /* a broken listener must not break logging */
    }
  }
  return entry;
}

export const debug = (source, message, data) => log('debug', source, message, data);
export const info = (source, message, data) => log('info', source, message, data);
export const warn = (source, message, data) => log('warn', source, message, data);
export const error = (source, message, data) => log('error', source, message, data);

export function setVerbose(on) {
  const next = on ? 'debug' : 'info';
  if (next === minLevel) return;
  // log the switch at a level that is always kept
  minLevel = 'info';
  info('app', on ? 'Verbose logging enabled' : 'Verbose logging disabled');
  minLevel = next;
}

export function getEntries() {
  return entries;
}

export function clearEntries() {
  entries = [];
  for (const fn of listeners) {
    try {
      fn({ type: 'clear' });
    } catch {
      /* ignore */
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
