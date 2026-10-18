// SoundCloud without an official API key: we take the public client_id from the site's scripts,
// the same way SoundCloud's own web player does. If SoundCloud changes its site, this is what breaks.
import * as logger from './logger.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

let cachedClientId = null;
let cachedAt = 0;
const CLIENT_ID_TTL = 6 * 60 * 60 * 1000;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function getClientId(force = false) {
  if (!force && cachedClientId && Date.now() - cachedAt < CLIENT_ID_TTL) return cachedClientId;
  const html = await fetchText('https://soundcloud.com');
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(
    (m) => m[1],
  );
  // the client_id is usually in one of the last bundles
  for (const src of scripts.reverse()) {
    try {
      const js = await fetchText(src);
      const m = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (m) {
        cachedClientId = m[1];
        logger.info('soundcloud', 'Got a SoundCloud client_id', { force, bundle: src.split('/').pop() });
        cachedAt = Date.now();
        return cachedClientId;
      }
    } catch (err) {
      logger.debug('soundcloud', 'Bundle skipped while looking for client_id', { src, error: err.message });
    }
  }
  logger.error('soundcloud', 'Could not get a SoundCloud client_id', { bundles: scripts.length });
  throw new Error('Could not get a SoundCloud client_id');
}

async function api(path, params = {}, retry = true) {
  const clientId = await getClientId();
  const url = new URL(`https://api-v2.soundcloud.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('client_id', clientId);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if ((res.status === 401 || res.status === 403) && retry) {
    logger.warn('soundcloud', `API answered ${res.status}, refreshing client_id`, { path });
    await getClientId(true);
    return api(path, params, false);
  }
  if (!res.ok) {
    logger.warn('soundcloud', `API request failed: HTTP ${res.status}`, { path });
    throw new Error(`SoundCloud HTTP ${res.status}`);
  }
  return res.json();
}

function toTrack(t) {
  if (!t || !t.permalink_url) return null;
  return {
    id: String(t.id),
    source: 'soundcloud',
    title: t.title || '',
    artist: t.user?.username || '',
    artistId: t.user?.id ? String(t.user.id) : '',
    album: '',
    durationSec: Math.round((t.full_duration || t.duration || 0) / 1000),
    cover: (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500'),
    url: t.permalink_url,
  };
}

export async function searchSoundCloud(query, limit = 20) {
  const data = await api('/search/tracks', { q: query, limit: String(limit) });
  return (data.collection || []).map(toTrack).filter(Boolean);
}

// Tracks SoundCloud itself lists as similar to one track
export async function relatedSoundCloud(trackId, limit = 25) {
  const data = await api(`/tracks/${encodeURIComponent(trackId)}/related`, { limit: String(limit) });
  return (data.collection || []).map(toTrack).filter(Boolean);
}

// SoundCloud's trending chart: the closest thing to a home page that works without signing in
export async function trendingSoundCloud(limit = 20) {
  const data = await api('/charts', { kind: 'trending', genre: 'soundcloud:genres:all-music', limit: String(limit) });
  return (data.collection || []).map((c) => toTrack(c.track || c)).filter(Boolean);
}

export function isSoundCloudUrl(input) {
  try {
    const u = new URL(String(input).trim());
    return /(^|\.)soundcloud\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

// Link to a track, playlist or artist page -> list of tracks
export async function resolveSoundCloud(url) {
  const data = await api('/resolve', { url: url.trim() });
  if (data.kind === 'track') return [toTrack(data)].filter(Boolean);
  if (data.kind === 'playlist') {
    return fillTracks(data.tracks || []);
  }
  if (data.kind === 'user') {
    const res = await api(`/users/${data.id}/tracks`, { limit: '30' });
    return (res.collection || []).map(toTrack).filter(Boolean);
  }
  return [];
}

// Some playlist entries come without metadata: fetch them in one batch
async function fillTracks(tracks) {
  const missing = tracks.filter((t) => !t.title).map((t) => t.id);
  let filled = new Map();
  if (missing.length) {
    const full = await api('/tracks', { ids: missing.slice(0, 50).join(',') });
    filled = new Map(full.map((t) => [t.id, t]));
  }
  return tracks.map((t) => toTrack(t.title ? t : filled.get(t.id))).filter(Boolean);
}

// ---------- Artists and playlists ----------
const bigAvatar = (url) => String(url || '').replace('-large', '-t500x500');

function userRef(u) {
  if (!u?.id) return null;
  const followers = Number(u.followers_count) || 0;
  return {
    source: 'soundcloud',
    kind: 'artist',
    id: String(u.id),
    title: u.username || '',
    subtitle: followers ? `${followers.toLocaleString('en-US')} followers` : u.city || '',
    cover: bigAvatar(u.avatar_url),
  };
}

function playlistRef(p) {
  if (!p?.id) return null;
  return {
    source: 'soundcloud',
    kind: 'playlist',
    id: String(p.id),
    title: p.title || '',
    subtitle: [p.user?.username, p.track_count ? `${p.track_count} tracks` : ''].filter(Boolean).join(' · '),
    cover: bigAvatar(p.artwork_url || p.user?.avatar_url),
  };
}

export async function searchSoundCloudCollections(query, limit = 5) {
  const [users, lists] = await Promise.allSettled([
    api('/search/users', { q: query, limit: String(limit) }),
    api('/search/playlists_without_albums', { q: query, limit: String(limit) }),
  ]);
  const col = (r) => (r.status === 'fulfilled' ? r.value.collection || [] : []);
  return { artists: col(users).map(userRef).filter(Boolean), playlists: col(lists).map(playlistRef).filter(Boolean) };
}

export async function getSoundCloudArtist(userId) {
  const [user, tracks, lists] = await Promise.all([
    api(`/users/${encodeURIComponent(userId)}`),
    api(`/users/${encodeURIComponent(userId)}/tracks`, { limit: '50' }).catch(() => ({ collection: [] })),
    api(`/users/${encodeURIComponent(userId)}/playlists_without_albums`, { limit: '20' }).catch(() => ({ collection: [] })),
  ]);
  const sections = [];
  const refs = (lists.collection || []).map(playlistRef).filter(Boolean);
  if (refs.length) sections.push({ title: 'Playlists', refs });
  return {
    source: 'soundcloud',
    kind: 'artist',
    id: String(userId),
    title: user.username || '',
    description: user.description || '',
    subtitle: userRef(user)?.subtitle || '',
    cover: bigAvatar(user.avatar_url),
    tracks: (tracks.collection || []).map(toTrack).filter(Boolean),
    sections,
  };
}

export async function getSoundCloudPlaylist(id) {
  const p = await api(`/playlists/${encodeURIComponent(id)}`);
  return {
    source: 'soundcloud',
    kind: 'playlist',
    id: String(id),
    title: p.title || '',
    subtitle: p.user?.username || '',
    description: p.description || '',
    cover: bigAvatar(p.artwork_url || p.user?.avatar_url),
    tracks: await fillTracks(p.tracks || []),
  };
}

export async function findSoundCloudArtist(name) {
  const r = await searchSoundCloudCollections(name, 1);
  return r.artists[0] || null;
}
