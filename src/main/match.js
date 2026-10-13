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
