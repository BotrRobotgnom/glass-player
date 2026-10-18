// Recommendations for the Home tab, built from what the user has listened to on this computer.
// Seeds = the most played and the latest tracks. For a YouTube seed we ask YouTube Music what plays next,
// for a SoundCloud seed we ask SoundCloud for related tracks. Results are merged (a track suggested by
// several seeds ranks higher), and anything already heard is left out. Nothing is stored beyond a short cache.
import * as library from './library.js';
import * as logger from './logger.js';
import { getRelatedYouTube, getHomeYouTube, markEmbeddable } from './youtube.js';
import { relatedSoundCloud, trendingSoundCloud, searchSoundCloud } from './soundcloud.js';

const TTL = 30 * 60 * 1000;
const MAX_SEEDS = 8;
const key = (t) => `${t.source}:${t.id}`;

let cache = null; // { sig, at, data }
let inflight = null;

function pickSeeds() {
  const top = library.getHistory('top', 40);
  const recent = library.getHistory('recent', 20);
  const seeds = [];
  const seen = new Set();
  const add = (e, weight) => {
    const k = key(e.track);
    if (seen.has(k) || seeds.length >= MAX_SEEDS) return;
    seen.add(k);
    seeds.push({ track: e.track, weight });
  };
  // liked tracks are the strongest hint of taste
  library.getReactions('liked', 3).forEach((e) => add(e, 2.5));
  top.slice(0, 5).forEach((e) => add(e, 1 + Math.log2(1 + e.plays)));
  recent.forEach((e) => add(e, 1));
  return seeds;
}

// Merge the lists suggested for several seeds: earlier in a list and more seeds agreeing = higher score
function merge(lists, exclude) {
  const map = new Map();
  for (const { seed, tracks } of lists) {
    tracks.forEach((track, i) => {
      const k = key(track);
      if (exclude.has(k)) return;
      const hit = map.get(k) || { track, score: 0 };
      hit.score += seed.weight / Math.sqrt(i + 1);
      map.set(k, hit);
    });
  }
  return [...map.values()].sort((a, b) => b.score - a.score).map((h) => h.track);
}

// YouTube refuses to play some videos inside other apps: do not recommend those
async function playable(tracks, limit) {
  const head = tracks.slice(0, limit + 6);
  await markEmbeddable(head.filter((t) => t.source === 'youtube'));
  return head.filter((t) => t.embeddable !== false).slice(0, limit);
}

async function build(seeds) {
  const heard = library.heardKeys();
  const errors = [];
  const settled = await Promise.allSettled(
    seeds.map(async (seed) => ({
      seed,
      tracks: seed.track.source === 'youtube' ? await getRelatedYouTube(seed.track.id) : await relatedSoundCloud(seed.track.id),
    })),
  );
  const ok = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push(r.value);
    else {
      errors.push(seeds[i].track.source);
      logger.warn('recommend', `No suggestions for "${seeds[i].track.title}"`, { error: String(r.reason?.message || r.reason) });
    }
  });
  const exclude = new Set([...heard, ...library.dislikedKeys(), ...seeds.map((s) => key(s.track))]);
  const sections = [];

  const yt = merge(ok.filter((l) => l.seed.track.source === 'youtube'), exclude);
  if (yt.length) sections.push({ id: 'mix-youtube', kind: 'mix', source: 'youtube', tracks: await playable(yt, 20) });
  const sc = merge(ok.filter((l) => l.seed.track.source === 'soundcloud'), exclude);
  if (sc.length) sections.push({ id: 'mix-soundcloud', kind: 'mix', source: 'soundcloud', tracks: sc.slice(0, 20) });

  // "Because you listened to ..." for the two most played tracks
  for (const l of ok.filter((x) => x.seed.weight > 1).slice(0, 2)) {
    const tracks = await playable(merge([l], exclude), 10);
    if (tracks.length >= 3) {
      sections.push({ id: 'because-' + key(l.seed.track), kind: 'because', seed: { title: l.seed.track.title, artist: l.seed.track.artist }, tracks });
    }
  }

  // YouTube Music's own shelves (home and Explore: popular, new releases, ...). Not filtered by history:
  // popular music is meant to be shown, even if it was heard before.
  try {
    const shelves = await getHomeYouTube(6);
    const checked = await Promise.all(shelves.map((s) => playable(s.tracks, 14)));
    shelves.forEach((shelf, i) => {
      if (checked[i].length >= 3) sections.push({ id: 'ythome-' + shelf.title, kind: 'shelf', title: shelf.title, tracks: checked[i] });
    });
  } catch (err) {
    errors.push('youtube');
    logger.warn('recommend', 'YouTube Music home feed failed', { error: String(err.message || err) });
  }

  // SoundCloud trending: always available, no history needed
  try {
    const tracks = (await trendingSoundCloud(30)).slice(0, 20);
    if (tracks.length >= 3) sections.push({ id: 'trending-soundcloud', kind: 'trending', source: 'soundcloud', tracks });
  } catch (err) {
    errors.push('soundcloud');
    logger.warn('recommend', 'SoundCloud trending failed', { error: String(err.message || err) });
  }

  logger.info('recommend', `Home built from ${seeds.length} seed(s)`, { sections: sections.map((s) => `${s.id}:${s.tracks.length}`), errors: errors.length });
  return { seeds: seeds.length, sections, errors: [...new Set(errors)] };
}

// a like or dislike changes what should be offered: forget the cached Home
export function resetCache() {
  cache = null;
}

export async function getHome(force = false) {
  const seeds = pickSeeds();
  const sig = seeds.map((s) => key(s.track)).join('|');
  if (!force && cache && cache.sig === sig && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = build(seeds)
    .then((data) => {
      // do not cache a result made only of failures
      if (data.sections.length) cache = { sig, at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Endless playback: tracks similar to the one that just ended, without anything already in the queue
export async function getSimilar(track, exclude = []) {
  if (!track || !track.id || (track.source !== 'youtube' && track.source !== 'soundcloud')) return [];
  const skip = new Set([...exclude].map(String).slice(-500));
  skip.add(key(track));
  for (const k of library.dislikedKeys()) skip.add(k);
  let list = [];
  try {
    list = track.source === 'youtube' ? await getRelatedYouTube(track.id, 30) : await relatedSoundCloud(track.id, 30);
  } catch (err) {
    logger.warn('recommend', `Related tracks unavailable for "${track.title}", falling back to the artist`, err);
  }
  // "related" is missing for some tracks (private, restricted): fall back to other tracks by the same artist
  if (!list.length && track.artist) {
    try {
      list = track.source === 'youtube' ? await getRelatedYouTube(track.id, 30).catch(() => []) : await searchSoundCloud(track.artist, 30);
    } catch (err) {
      logger.warn('recommend', 'Artist fallback failed', err);
    }
  }
  const fresh = list.filter((t) => !skip.has(key(t)));
  const tracks = await playable(fresh, 15);
  logger.info('recommend', `Similar to "${track.title}": ${tracks.length} track(s)`, { candidates: list.length });
  return tracks;
}
