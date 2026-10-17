import { Innertube } from 'youtubei.js';
import * as logger from './logger.js';

let ytPromise = null;

function getYT() {
  if (!ytPromise) {
    // retrieve_player: false, because we never decrypt streams: the official iframe player does the playback
    logger.debug('youtube', 'Creating Innertube session');
    ytPromise = Innertube.create({ retrieve_player: false, generate_session_locally: true })
      .then((yt) => {
        logger.info('youtube', 'Innertube session ready');
        return yt;
      })
      .catch((e) => {
        logger.error('youtube', 'Innertube session failed', e);
        ytPromise = null;
        throw e;
      });
  }
  return ytPromise;
}

function bestThumb(thumbs = []) {
  if (!thumbs.length) return '';
  const sorted = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0].url || '';
}

function toTrack(item) {
  if (!item?.id) return null;
  return {
    id: item.id,
    source: 'youtube',
    title: item.title || '',
    artist: (item.artists || item.authors || []).map((a) => a.name).filter(Boolean).join(', '),
    album: item.album?.name || '',
    durationSec: item.duration?.seconds || 0,
    cover: bestThumb(item.thumbnails),
    url: `https://music.youtube.com/watch?v=${item.id}`,
    // 'song' = audio-only art track (static cover); 'video' = a real clip
    hasVideo: item.item_type === 'video',
  };
}

function shelfItems(result) {
  const shelf = result.songs ?? result.contents?.find((c) => c?.contents);
  return shelf?.contents ?? [];
}

// type: 'song' = official audio tracks (art tracks), 'video' = clips / remixes / live versions
export async function searchYouTube(query, { type = 'song', limit = 20 } = {}) {
  const yt = await getYT();
  const res = await yt.music.search(query, { type });
  const items = type === 'video' && res.videos ? res.videos.contents : shelfItems(res);
  return [...items]
    .filter((i) => i.item_type === 'song' || i.item_type === 'video')
    .map(toTrack)
    .filter(Boolean)
    .slice(0, limit);
}

// Search-as-you-type suggestions from YouTube Music
export async function suggestYouTube(query) {
  const yt = await getYT();
  const sections = await yt.music.getSearchSuggestions(query);
  const out = [];
  for (const section of sections || []) {
    for (const item of section.contents || []) {
      const text = item?.suggestion?.toString?.().trim();
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out.slice(0, 8);
}

// A track from an "up next" panel (a different node type than search results)
function panelTrack(item) {
  const v = item?.primary ?? item; // wrappers hold the song as `primary`
  const id = v?.video_id;
  if (!id) return null;
  const artists = (v.artists || []).map((a) => a.name).filter(Boolean).join(', ');
  return {
    id,
    source: 'youtube',
    title: v.title?.toString?.() || '',
    artist: artists || String(v.author || '').replace(/ - Topic$/, ''),
    album: v.album?.name || '',
    durationSec: v.duration?.seconds || 0,
    cover: bestThumb(v.thumbnail),
    url: `https://music.youtube.com/watch?v=${id}`,
    hasVideo: !v.album?.name, // art tracks (songs) belong to an album; clips usually do not
  };
}

// YouTube Music's own "what plays next" list for a track: our source of similar tracks
export async function getRelatedYouTube(videoId, limit = 25) {
  const yt = await getYT();
  const panel = await yt.music.getUpNext(videoId);
  return [...(panel?.contents || [])]
    .map(panelTrack)
    .filter((t) => t && t.id !== videoId)
    .slice(0, limit);
}

// A track from a home / explore shelf. Shelves mix two node types (list items and "two row" cards)
function shelfTrack(item) {
  if (!item || (item.item_type !== 'song' && item.item_type !== 'video') || !item.id) return null;
  const thumbs = item.thumbnails || item.thumbnail;
  const list = Array.isArray(thumbs) ? thumbs : thumbs?.contents || [];
  const names = (item.artists || item.authors || (item.author ? [item.author] : [])).map((x) => x.name).filter(Boolean);
  return {
    id: item.id,
    source: 'youtube',
    title: String(item.title?.toString?.() ?? item.title ?? ''),
    artist: names.join(', ') || String(item.subtitle?.toString?.() || '').split('•')[1]?.trim() || '',
    album: item.album?.name || '',
    durationSec: item.duration?.seconds || 0,
    cover: bestThumb(list),
    url: `https://music.youtube.com/watch?v=${item.id}`,
    hasVideo: item.item_type === 'video',
  };
}

function shelvesOf(sections, max) {
  const out = [];
  for (const shelf of sections || []) {
    const title = shelf?.header?.title?.toString?.() || '';
    const tracks = [...(shelf?.contents || [])].map(shelfTrack).filter(Boolean);
    if (title && tracks.length >= 3) out.push({ title, tracks: tracks.slice(0, 20) });
    if (out.length >= max) break;
  }
  return out;
}

// YouTube Music's home page (not personalised: we are not signed in) and its Explore page
// (new releases, trending, top videos): shelves of songs
export async function getHomeYouTube(maxShelves = 6) {
  const yt = await getYT();
  const out = [];
  const take = (shelves) => {
    for (const s of shelves) if (out.length < maxShelves && !out.some((o) => o.title === s.title)) out.push(s);
  };
  const [home, explore] = await Promise.allSettled([yt.music.getHomeFeed(), yt.music.getExplore()]);
  if (home.status === 'fulfilled') take(shelvesOf(home.value?.sections, 4));
  else logger.warn('youtube', 'Home feed failed', { error: String(home.reason?.message || home.reason) });
  if (explore.status === 'fulfilled') take(shelvesOf(explore.value?.sections, 3));
  else logger.warn('youtube', 'Explore feed failed', { error: String(explore.reason?.message || explore.reason) });
  if (!out.length && home.status === 'rejected' && explore.status === 'rejected') throw home.reason;
  return out;
}

export function extractVideoId(input) {
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(shorts|embed)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export async function getYouTubeTrack(videoId) {
  const yt = await getYT();
  const info = await yt.getBasicInfo(videoId);
  const b = info.basic_info;
  return {
    id: videoId,
    source: 'youtube',
    title: b.title || '',
    artist: (b.author || '').replace(/ - Topic$/, ''),
    album: '',
    durationSec: b.duration || 0,
    cover: bestThumb(b.thumbnail),
    url: `https://music.youtube.com/watch?v=${videoId}`,
    hasVideo: !/ - Topic$/.test(b.author || ''),
  };
}

// The IFrame player refuses videos whose owner disabled embedding (error 150/101).
// The oEmbed endpoint answers 401 for exactly those, so we can know before trying to play.
// Unknown (network trouble etc.) counts as embeddable: the player's own error handling still applies.
const embedCache = new Map();

export async function isEmbeddable(videoId) {
  if (embedCache.has(videoId)) return embedCache.get(videoId);
  let ok = true;
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      ok = false;
      logger.debug('youtube', `Not embeddable: ${videoId}`, { status: res.status });
    }
    embedCache.set(videoId, ok);
  } catch (err) {
    logger.debug('youtube', `Embed check failed for ${videoId}`, { error: err.message });
  }
  return ok;
}

export async function markEmbeddable(tracks) {
  await Promise.all(tracks.map(async (tr) => (tr.embeddable = await isEmbeddable(tr.id))));
  return tracks;
}
