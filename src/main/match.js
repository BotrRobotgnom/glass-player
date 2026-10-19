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
  const ranked = items.sort((a, b) => b.rel - a.rel).map(({ track, alt }) => (alt ? { ...track, alt } : { ...track }));
  return clusterResults(ranked);
}

// ---------- Other versions of a track: remixes, slowed, live, other uploads ----------
const VERSION_MARKERS = [
  ['Remix', /\b(remix|rmx|bootleg|flip|rework|edit|vip)\b/i],
  ['Slowed', /\b(slowed|slow(ed)?\s*(\+|and|&)?\s*reverb|reverb|slow)\b/i],
  ['Sped up', /\b(sped\s*up|speed\s*up|nightcore|fast)\b/i],
  ['Live', /\b(live|concert|session)\b/i],
  ['Acoustic', /\b(acoustic|unplugged|piano)\b/i],
  ['Instrumental', /\b(instrumental|karaoke|off vocal)\b/i],
  ['Cover', /\bcover\b/i],
  ['Version', /\b(version|ver\.?|mix|remaster(ed)?|extended|radio|tour)\b/i],
];
const MARKER_WORDS = /\b(remix|rmx|bootleg|flip|rework|edit|vip|slowed|slow|reverb|sped|speed|up|nightcore|fast|live|concert|session|acoustic|unplugged|piano|instrumental|karaoke|off|vocal|cover|version|ver|mix|remaster|remastered|extended|radio|tour|and|x|feat|ft)\b/gi;

// 'Remix', 'Slowed', ... or null for a plain upload
export function versionLabel(title = '') {
  for (const [label, re] of VERSION_MARKERS) if (re.test(title)) return label;
  return null;
}

// the words that identify the song itself (artist prefix, brackets and version words removed)
function coreOf(track, drop = new Set()) {
  // the whole title: "Artist - Song" and "Song - Artist" both occur, the artist's words are dropped below anyway
  const bare = String(track.title).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(MARKER_WORDS, ' ');
  return new Set([...tokens(bare)].filter((w) => !drop.has(w)));
}

const sameSet = (a, b) => a.size === b.size && [...a].every((w) => b.has(w));

// How different may the lengths be? A slowed or extended copy is longer or shorter, but a 4:29 song is not a 1:40 one.
const MAX_RATIO = { Remix: 2.4, Version: 2.4, Live: 2.4, Cover: 2.0 };
function lengthsFit(base, c, label) {
  const a = base.durationSec || 0;
  const b = c.durationSec || 0;
  if (!a || !b) return true;
  return Math.max(a, b) / Math.min(a, b) <= (MAX_RATIO[label] || 1.8);
}

// Is `c` another version of the song `base`? The words that name the song must be the same (version words, bracketed
// parts and the artist's own name are ignored). A remix may add the remixer's name ("... Mylancore remix"), up to a few words.
// The base artist must be mentioned and the lengths must be comparable.
export function isVersionOf(base, c) {
  const { artist } = splitArtistTitle(base);
  const artistTokens = tokens(artist || base.artist);
  const core = coreOf(base, artistTokens);
  if (!core.size) return false;
  const label = versionLabel(c.title) || 'Other upload';
  const other = coreOf(c, artistTokens);
  const same = sameSet(core, other);
  const withRemixer = label === 'Remix' && other.size > core.size && other.size - core.size <= 4 && [...core].every((w) => other.has(w));
  if (!same && !withRemixer) return false;
  if (!lengthsFit(base, c, label)) return false;
  const rawHay = new Set(normalize(`${c.title} ${c.artist}`).split(' '));
  // the base artist must be named (in the title or as the uploader): the same title by another artist is another song
  return !artistTokens.size || [...artistTokens].some((w) => rawHay.has(w));
}

const labelOf = (t) => versionLabel(t.title) || 'Other upload';
const LABEL_ORDER = ['Remix', 'Slowed', 'Sped up', 'Live', 'Acoustic', 'Instrumental', 'Cover', 'Version', 'Other upload'];

// The very same recording: same ISRC, or the same title, artist and length on the same service
export function sameRecording(a, b) {
  if (a.isrc && b.isrc) return a.isrc === b.isrc;
  return (
    a.source === b.source &&
    normalize(a.title) === normalize(b.title) &&
    normalize(a.artist) === normalize(b.artist) &&
    Math.abs((a.durationSec || 0) - (b.durationSec || 0)) <= 1
  );
}

// Sorts versions, folds exact duplicates away and joins the YouTube and SoundCloud copies of one version into one item
export function tidyVersions(list) {
  const out = [];
  for (const v of list) {
    if (out.some((o) => sameRecording(o, v) || (o.alt && sameRecording(o.alt, v)))) continue; // an exact copy
    const mate = out.find((o) => !o.alt && o.source !== v.source && o.label === v.label && scoreCandidate(o.source === 'soundcloud' ? o : v, o.source === 'soundcloud' ? v : o) >= 0.72);
    if (mate) mate.alt = v;
    else out.push({ ...v });
  }
  return out.sort((a, b) => LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label));
}

// Candidates that are versions of `base`, labelled ('Remix', 'Slowed', ..., 'Other upload'). `base` itself and `skip` are left out.
export function findVersions(base, candidates, skip = new Set()) {
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const k = `${c.source}:${c.id}`;
    if (seen.has(k) || skip.has(k)) continue;
    seen.add(k);
    if (isVersionOf(base, c)) out.push({ ...c, label: labelOf(c) });
  }
  return tidyVersions(out);
}

// Search results: songs that are versions of each other are folded under one main result.
// The main one is a plain (unmarked) upload, the best ranked; the rest go to `versions`, in the order of kind.
export function clusterResults(items) {
  // No chains: a result joins a group only when it is a version of the group's MAIN track itself, so the same title
  // by different artists makes separate groups. Plain uploads are mains first; marked ones (remix, slowed...) join one of them.
  const mains = [];
  const group = new Map(); // main index -> member indexes
  const place = (i) => {
    const m = mains.find((k) => isVersionOf(items[k], items[i]));
    if (m === undefined) {
      mains.push(i);
      group.set(i, []);
    } else group.get(m).push(i);
  };
  items.forEach((it, i) => !versionLabel(it.title) && place(i));
  items.forEach((it, i) => versionLabel(it.title) && place(i));
  const result = mains.map((m) => {
    const rest = group.get(m).sort((a, b) => a - b).map((i) => ({ ...items[i], label: labelOf(items[i]) }));
    const versions = tidyVersions(rest.filter((v) => !sameRecording(v, items[m]) && !(items[m].alt && sameRecording(v, items[m].alt))));
    const at = Math.min(m, ...group.get(m));
    return { at, item: versions.length ? { ...items[m], versions } : items[m] };
  });
  return result.sort((a, b) => a.at - b.at).map((r) => r.item);
}
