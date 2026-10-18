// Matching a track (e.g. from SoundCloud) with its official version on YouTube Music.
// Pure logic with no network access, so it can be tested on its own.

const NOISE = [
  /\(.*?\)/g, /\[.*?\]/g, // brackets: (Official Video), [Remastered]
  /\b(official|video|audio|lyrics?|lyric video|hd|hq|remaster(ed)?|explicit|visualizer)\b/gi,
  /\b(feat\.?|ft\.?|featuring|prod\.?|by)\b.*$/gi,
];

export function normalize(str = '') {
  let s = String(str).toLowerCase();
  for (const re of NOISE) s = s.replace(re, ' ');
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(str) {
  return new Set(normalize(str).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// SoundCloud tracks are often named "Artist - Title": split them when we can.
export function splitArtistTitle(track) {
  const raw = track.title || '';
  const m = raw.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: track.artist || '', title: raw.trim() };
}

// Score 0..1: how similar a YouTube Music candidate is to the original track.
export function scoreCandidate(source, candidate) {
  const src = splitArtistTitle(source);
  const titleScore = jaccard(tokens(src.title), tokens(candidate.title));

  const candArtists = tokens(candidate.artist);
  const srcArtists = tokens(src.artist);
  // the SoundCloud artist may match any of the candidate's artists
  let artistScore = jaccard(srcArtists, candArtists);
  if (srcArtists.size && candArtists.size) {
    const hit = [...srcArtists].some((t) => candArtists.has(t));
    if (hit) artistScore = Math.max(artistScore, 0.7);
  }

  let durationScore = 0.5; // unknown: neutral
  if (source.durationSec && candidate.durationSec) {
    const diff = Math.abs(source.durationSec - candidate.durationSec);
    durationScore = diff <= 3 ? 1 : diff <= 8 ? 0.7 : diff <= 20 ? 0.3 : 0;
  }

  return titleScore * 0.55 + artistScore * 0.3 + durationScore * 0.15;
}

export function pickBest(source, candidates, threshold = 0.6) {
  let best = null;
  for (const c of candidates) {
    const score = scoreCandidate(source, c);
    if (!best || score > best.score) best = { track: c, score };
  }
  return best && best.score >= threshold ? best : null;
}

// ---------- One search list for both services ----------
// How well a result fits the query: share of the query's words found in "artist title", plus a bonus for ranking high at its own service.
function relevance(query, track, index) {
  const q = [...tokens(query)];
  const hay = tokens(`${track.artist || ''} ${track.title || ''}`);
  const covered = q.length ? q.filter((w) => hay.has(w) || [...hay].some((h) => h.startsWith(w))).length / q.length : 0;
  return covered * 0.75 + 0.25 / (1 + index * 0.5);
}

// Merges YouTube Music and SoundCloud results. The same song found on both becomes one item with `alt` = the other
// service's version. Items are sorted by closeness to the query. Playable-on-YouTube versions lead the pair.
export function mergeResults(query, youtube = [], soundcloud = []) {
  const items = [];
  const usedSc = new Set();
  youtube.forEach((yt, i) => {
    let best = null;
    soundcloud.forEach((sc, j) => {
      if (usedSc.has(j)) return;
      const score = scoreCandidate(sc, yt);
      if (score >= 0.72 && (!best || score > best.score)) best = { j, score };
    });
    let track = yt;
    let alt = null;
    let rel = relevance(query, yt, i);
    if (best) {
      usedSc.add(best.j);
      const sc = soundcloud[best.j];
      alt = sc;
      rel = Math.max(rel, relevance(query, sc, best.j)) + 0.1; // present on both: a slightly stronger result
      // an unplayable YouTube version should not lead
      if (yt.embeddable === false) {
        track = sc;
        alt = yt;
      }
    }
    items.push({ track, alt, rel });
  });
  soundcloud.forEach((sc, j) => {
    if (!usedSc.has(j)) items.push({ track: sc, alt: null, rel: relevance(query, sc, j) });
  });
  return items.sort((a, b) => b.rel - a.rel).map(({ track, alt }) => (alt ? { ...track, alt } : { ...track }));
}
