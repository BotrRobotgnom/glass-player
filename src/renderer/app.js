(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const t = window.t;

  // Everything worth knowing goes to the log (shown in the Debug log window)
  const log = (level, message, data) => {
    try {
      window.api.log.write(level, 'app', message, data);
    } catch {
      /* logging must never break the player */
    }
  };
  window.addEventListener('error', (e) => log('error', 'Uncaught error: ' + e.message, { at: `${e.filename}:${e.lineno}:${e.colno}` }));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    log('error', 'Unhandled promise rejection: ' + (r && r.message ? r.message : String(r)), r && r.stack ? { stack: r.stack } : undefined);
  });

  // https://developers.google.com/youtube/iframe_api_reference#onError
  const YT_ERRORS = {
    2: 'invalid video id',
    5: 'HTML5 player error',
    100: 'video not found or private',
    101: 'embedding disabled by the owner',
    150: 'embedding disabled by the owner',
    153: 'embedder origin missing (referrer policy)',
  };

  // ---------- Settings (localStorage; the server port is fixed, so the origin is stable) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('gp.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('gp.' + key, JSON.stringify(value));
      } catch {
        /* storage unavailable: ignore */
      }
    },
  };

  const state = {
    results: { youtube: [], soundcloud: [] },
    queue: [],
    index: -1,
    now: null, // { shown, yt, sc }
    playing: false,
    repeat: 'off', // off | all | one
    shuffle: false,
    sources: store.get('sources', { youtube: true, soundcloud: true }),
    priorityYT: store.get('priorityYT', true),
    volume: store.get('volume', 80),
    muted: false,
    cur: 0,
    dur: 0,
    seeking: false,
    token: 0,
    errorStreak: 0,
    active: null, // 'youtube' | 'soundcloud'
  };

  const els = {
    form: $('#searchForm'), q: $('#q'), results: $('#results'), queue: $('#queue'), queueCount: $('#queueCount'),
    stage: $('#stage'), cover: $('#cover'), npTitle: $('#npTitle'), npArtist: $('#npArtist'),
    npSource: $('#npSource'), npOfficial: $('#npOfficial'), npStatus: $('#npStatus'), btnSwap: $('#btnSwap'),
    btnPlay: $('#btnPlay'), btnPrev: $('#btnPrev'), btnNext: $('#btnNext'), btnShuffle: $('#btnShuffle'),
    btnRepeat: $('#btnRepeat'), btnMute: $('#btnMute'), seek: $('#seek'), volume: $('#volume'),
    btnVideo: $('#btnVideo'), tCur: $('#tCur'), tDur: $('#tDur'), toast: $('#toast'), settings: $('#settings'),
  };

  // ---------- Helpers ----------
  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };
  const setFill = (input) => input.style.setProperty('--fill', (input.value / input.max) * 100 + '%');
  const icon = (id) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  };
  const sameTrack = (a, b) => a && b && a.source === b.source && a.id === b.id;
  const isCurrent = (track) => !!state.now && [state.now.shown, state.now.yt, state.now.sc].some((x) => sameTrack(x, track));
  const sourceLabel = (s) => t(s === 'youtube' ? 'group.youtube' : 'group.soundcloud');

  let toastTimer = null;
  function toast(msg) {
    log('info', 'Toast: ' + msg);
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 4000);
  }

  function setStatus(msg) {
    els.npStatus.textContent = msg || '';
  }

  // ---------- Engines ----------
  function handlersFor(name) {
    return {
      onState(s) {
        if (state.active !== name) return;
        log('debug', `${name} player state: ${s}`);
        if (s === 'playing') {
          state.playing = true;
          state.errorStreak = 0;
          state.revert = null; // the new version is playing, nothing to go back to
          setStatus('');
        } else if (s === 'paused') {
          state.playing = false;
        } else if (s === 'ended') {
          state.playing = false;
          onEnded();
        }
        updatePlayButton();
      },
      onTime(cur, dur) {
        if (state.active !== name) return;
        trackListening();
        state.cur = cur;
        if (dur) state.dur = dur;
        updateProgress();
      },
      onError(code) {
        if (state.active !== name) return;
        log('warn', `${name} player error`, { code, meaning: YT_ERRORS[code] });
        onPlayError(code);
      },
    };
  }

  const ytEngine = new window.Engines.YouTubeEngine('ytMount', handlersFor('youtube'));
  const scEngine = new window.Engines.SoundCloudEngine('scFrame', handlersFor('soundcloud'));
  const engineOf = (name) => (name === 'youtube' ? ytEngine : scEngine);

  // ---------- Lists ----------
  // actions: [{ icon, title, onClick(button) }] appear on hover left of the duration;
  // remove: { title, onClick, icon? } is a red button that takes the place of the duration on hover;
  // subText overrides the grey line under the title
  function makeRow(track, { onPlay, actions = [], remove, subText }) {
    const row = document.createElement('div');
    row.dataset.key = track.source + ':' + track.id;
    row.className = 'row' + (isCurrent(track) ? ' current' : '') + (track.embeddable === false ? ' blocked' : '');
    if (track.embeddable === false) row.title = t('row.blocked');

    if (track.cover) {
      const img = document.createElement('img');
      img.src = track.cover;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      row.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'thumb-ph';
      row.appendChild(ph);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = track.title;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = subText ?? [track.artist, track.album].filter(Boolean).join(' · ');
    meta.append(title, sub);
    row.appendChild(meta);

    const acts = document.createElement('div');
    acts.className = 'acts';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'act';
      btn.type = 'button';
      btn.title = a.title;
      btn.appendChild(icon(a.icon));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        a.onClick(btn);
      });
      acts.appendChild(btn);
    }
    row.appendChild(acts);

    // the duration sits at the far right; the remove button replaces it while the row is hovered
    const end = document.createElement('div');
    end.className = 'end' + (remove ? ' has-del' : '');
    const dur = document.createElement('div');
    dur.className = 'dur';
    dur.textContent = track.durationSec ? fmt(track.durationSec) : '';
    end.appendChild(dur);
    if (remove) {
      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.title = remove.title;
      del.appendChild(icon(remove.icon || 'i-trash'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        remove.onClick();
      });
      end.appendChild(del);
    }
    row.appendChild(end);

    row.addEventListener('click', onPlay);
    return row;
  }

  function groupTitle(text) {
    const h = document.createElement('div');
    h.className = 'group-title';
    h.textContent = text;
    return h;
  }

  function emptyMessage(text) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = text;
    return empty;
  }

  // only results from the enabled sources are shown
  const shownResults = (src) => (state.sources[src] ? state.results[src] : []);
  function flatResults() {
    return [...shownResults('youtube'), ...shownResults('soundcloud')];
  }

  function renderResults() {
    const box = els.results;
    box.replaceChildren();
    if (!flatResults().length) {
      box.appendChild(emptyMessage(t('results.empty')));
      return;
    }
    const groups = [
      [t('group.youtube'), shownResults('youtube')],
      [t('group.soundcloud'), shownResults('soundcloud')],
    ];
    for (const [label, tracks] of groups) {
      if (!tracks.length) continue;
      box.appendChild(groupTitle(label));
      for (const track of tracks) {
        box.appendChild(
          makeRow(track, {
            onPlay: () => playFromResults(track),
            actions: [
              { icon: 'i-plus', title: t('row.addToQueue'), onClick: () => addToQueue(track) },
              playlistAction(track),
            ],
          }),
        );
      }
    }
  }

  function renderQueue() {
    const box = els.queue;
    box.replaceChildren();
    els.queueCount.textContent = state.queue.length ? `(${state.queue.length})` : '';
    if (!state.queue.length) {
      box.appendChild(emptyMessage(t('queue.empty')));
      return;
    }
    state.queue.forEach((track, i) => {
      const row = makeRow(track, {
        onPlay: () => playIndex(i),
        actions: [playlistAction(track)],
        remove: { icon: 'i-close', title: t('row.removeFromQueue'), onClick: () => removeFromQueue(i) },
      });
      if (i === state.index) row.classList.add('current');
      box.appendChild(row);
    });
  }

  // 'Add to playlist' button; the menu itself lives in library.js
  const playlistAction = (track) => ({
    icon: 'i-list-plus',
    title: t('row.addToPlaylist'),
    onClick: (btn) => window.GP.pickPlaylist(btn, track),
  });

  // highlight the playing track in every list (history and playlists are drawn by library.js)
  function markCurrentRows() {
    const n = state.now;
    const keys = new Set(n ? [n.shown, n.yt, n.sc].filter(Boolean).map((x) => x.source + ':' + x.id) : []);
    $$('.row[data-key], .tcard[data-key]').forEach((row) => row.classList.toggle('current', keys.has(row.dataset.key)));
  }

  function renderLists() {
    renderResults();
    renderQueue();
    markCurrentRows();
  }

  // ---------- Queue ----------
  function addToQueue(track) {
    state.queue.push(track);
    renderQueue();
    toast(t('toast.added'));
  }

  function removeFromQueue(i) {
    const wasPlaying = i === state.index;
    state.queue.splice(i, 1);
    if (i < state.index) state.index--;
    renderQueue();
    if (!wasPlaying) return;
    // The track that is playing was removed: stop it and move on to the one that took its place
    log('info', 'The playing track was removed from the queue');
    if (i < state.queue.length) playIndex(i);
    else if (state.repeat === 'all' && state.queue.length) playIndex(0);
    else {
      ytEngine.pause();
      scEngine.pause();
      state.index = -1;
      state.playing = false;
      updatePlayButton();
    }
  }

  // Play `track` and make `tracks` the queue (used by results, history and playlists)
  function playFrom(tracks, track) {
    state.queue = [...tracks];
    state.index = Math.max(0, state.queue.findIndex((x) => sameTrack(x, track)));
    renderQueue();
    playTrack(track);
  }
  const playFromResults = (track) => playFrom(flatResults(), track);

  function playIndex(i) {
    if (i < 0 || i >= state.queue.length) return;
    state.index = i;
    playTrack(state.queue[i]);
  }

  // ---------- Listening history ----------
  // A play counts once the track has really been listened to for 30 s (or half of a short track),
  // measured with the clock so seeking and pausing don't count.
  const listen = { key: '', sec: 0, counted: false, last: 0 };
  function resetListening() {
    listen.key = '';
    listen.sec = 0;
    listen.counted = false;
    listen.last = performance.now();
  }
  function trackListening() {
    const now = performance.now();
    const dt = (now - listen.last) / 1000;
    listen.last = now;
    const shown = state.now && state.now.shown;
    if (!shown || !state.playing || listen.counted) return;
    const k = shown.source + ':' + shown.id;
    if (listen.key !== k) {
      listen.key = k;
      listen.sec = 0;
    }
    if (dt > 0 && dt < 2) listen.sec += dt;
    const need = shown.durationSec || state.dur ? Math.min(30, (shown.durationSec || state.dur) / 2) : 30;
    if (listen.sec >= need) {
      listen.counted = true;
      window.api.history.record(shown, listen.sec).then(() => window.GP.onHistoryChanged && window.GP.onHistoryChanged()).catch(() => {});
    }
  }

  // ---------- Playback ----------
  const timeout = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

  async function playTrack(track) {
    const token = ++state.token;
    resetListening();
    log('info', `Play: ${track.artist} - ${track.title}`, { source: track.source, id: track.id });
    let yt = track.source === 'youtube' ? track : null;
    const sc = track.source === 'soundcloud' ? track : null;
    let shown = track;

    // YouTube priority: for a SoundCloud track, look for the official version on YouTube Music
    if (sc && state.priorityYT) {
      setStatus(t('np.looking'));
      renderNow({ shown: sc, yt: null, sc });
      const found = await Promise.race([window.api.findOfficial(sc), timeout(4000, null)]);
      if (token !== state.token) return; // the user already picked another track
      log('info', found && found.track ? 'Using the official YouTube Music version' : 'No official version, playing from SoundCloud');
      if (found && found.track) {
        yt = found.track;
        shown = yt;
      }
    }

    state.now = { shown, yt, sc };
    startEngine(shown);
    renderNow(state.now);
    renderLists();
  }

  function startEngine(track, startAt = 0) {
    const name = track.source;
    const other = engineOf(name === 'youtube' ? 'soundcloud' : 'youtube');
    state.active = name;
    other.pause();
    state.cur = startAt;
    state.dur = track.durationSec || 0;
    state.playing = true;
    updateProgress();
    updatePlayButton();
    setStatus('');
    engineOf(name)
      .load(track, startAt)
      .catch((err) => {
        log('error', `${name} engine failed to load`, { error: err.message });
        toast(err.message || t('play.engineFailed'));
        state.playing = false;
        updatePlayButton();
      });
  }

  function switchVersion() {
    const n = state.now;
    if (!n) return;
    const target = n.shown.source === 'youtube' ? n.sc : n.yt;
    if (!target || els.btnSwap.disabled) return;
    // remember where we were: if the other version cannot be played, go back to the same moment
    state.revert = { now: n, at: state.cur };
    state.now = { ...n, shown: target };
    state.token++;
    log('info', `Switching version to ${target.source}`, { at: Math.round(state.cur) });
    startEngine(target, state.cur);
    renderNow(state.now);
  }

  function onPlayError(code) {
    const n = state.now;
    // A manual version switch failed: return to the previous version at the same position
    if (state.revert) {
      const r = state.revert;
      state.revert = null;
      // the YouTube version just failed to play: remember it so the switch button can say so
      state.now = r.now.shown.source === 'soundcloud' && r.now.yt ? { ...r.now, ytBlocked: true } : r.now;
      state.token++;
      log('warn', 'Version switch failed, restoring the previous version', { at: Math.round(r.at) });
      toast(t('np.switchFailed'));
      startEngine(state.now.shown, r.at);
      renderNow(state.now);
      return;
    }
    // Some videos forbid embedding: then try the SoundCloud version, if there is one
    if (n && n.shown.source === 'youtube' && n.sc) {
      toast(t('play.embedBlocked'));
      state.now = { ...n, shown: n.sc, ytBlocked: true };
      state.token++;
      startEngine(n.sc);
      renderNow(state.now);
      return;
    }
    state.errorStreak++;
    toast(t('play.failed', { code: code ? ` (code ${code})` : '' }));
    if (state.errorStreak <= Math.max(3, state.queue.length)) setTimeout(() => next(true), 900);
  }

  function onEnded() {
    next(true);
  }

  function next(auto = false) {
    const q = state.queue;
    if (!q.length) return;
    if (auto && state.repeat === 'one' && state.now) {
      resetListening(); // a repeated track counts as a new play
      engineOf(state.active).seek(0);
      engineOf(state.active).play();
      return;
    }
    let i;
    if (state.shuffle && q.length > 1) {
      do {
        i = Math.floor(Math.random() * q.length);
      } while (i === state.index);
    } else {
      i = state.index + 1;
      if (i >= q.length) {
        if (state.repeat === 'all' || !auto) i = 0;
        else {
          state.playing = false;
          updatePlayButton();
          return;
        }
      }
    }
    playIndex(i);
  }

  function prev() {
    if (state.cur > 3 && state.active) {
      engineOf(state.active).seek(0);
      return;
    }
    const q = state.queue;
    if (!q.length) return;
    playIndex(state.index <= 0 ? q.length - 1 : state.index - 1);
  }

  function togglePlay() {
    if (!state.active || !state.now) return;
    const engine = engineOf(state.active);
    if (state.playing) engine.pause();
    else engine.play();
  }

  // ---------- UI updates ----------
  // The big cover asks for a larger picture than the list thumbnails; if that size does not exist, use the original
  function hiresCover(url) {
    if (!url) return '';
    // YouTube Music art (googleusercontent): ...=w60-h60-l90-rj  ->  ...=w720-h720-l90-rj
    if (/^https:\/\/(lh3\.googleusercontent\.com|yt3\.(ggpht|googleusercontent)\.com)\//.test(url)) {
      return url.replace(/=(?:[ws]\d+)[^?]*$/, '=w720-h720-l90-rj');
    }
    // SoundCloud: ...-large.jpg (100px) -> -t500x500.jpg
    if (/sndcdn\.com\//.test(url)) return url.replace(/-(large|t\d+x\d+|crop|small)\./, '-t500x500.');
    return url;
  }
  function setCover(url) {
    const big = hiresCover(url);
    els.cover.onerror = big !== url ? () => { els.cover.onerror = null; els.cover.src = url; } : null;
    els.cover.src = big;
  }

  function renderNow(n) {
    const track = n.shown;
    els.npTitle.textContent = track.title || t('np.untitled');
    els.npArtist.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
    els.stage.dataset.source = track.source;
    setCover(track.cover);

    // Video stays hidden unless the user asks for it (or the setting says to show it) and the track has one
    const key = track.source + ':' + track.id;
    if (key !== shownKey) {
      shownKey = key;
      videoOn = autoVideo.checked && track.source === 'youtube' && !!track.hasVideo;
    }
    const canVideo = track.source === 'youtube' && !!track.hasVideo;
    els.btnVideo.classList.toggle('hidden', !canVideo);
    updateVideo();

    els.npSource.textContent = sourceLabel(track.source);
    els.npSource.className = 'badge ' + (track.source === 'youtube' ? 'yt' : 'sc');
    els.npSource.classList.remove('hidden');

    // The official version is the YouTube Music match found for a SoundCloud track
    const official = track.source === 'youtube' && !!n.sc;
    els.npOfficial.classList.toggle('hidden', !official);
    $('#btnNpPlaylist').classList.remove('hidden');

    const other = track.source === 'youtube' ? n.sc : n.yt;
    if (other) {
      els.btnSwap.classList.remove('hidden');
      // a YouTube version that cannot be embedded is known to fail: show it as unavailable instead of offering it
      const blocked = other.source === 'youtube' && (n.ytBlocked || other.embeddable === false);
      els.btnSwap.disabled = blocked;
      $('span', els.btnSwap).textContent = t(blocked ? 'np.ytUnavailable' : other.source === 'youtube' ? 'np.swapToYouTube' : 'np.swapToSoundCloud');
    } else {
      els.btnSwap.classList.add('hidden');
    }

    document.title = `${track.title} — Glass Player`;
    updateMediaSession(track);
  }

  let shownKey = '';
  let videoOn = false;
  function updateVideo() {
    const on = videoOn && !els.btnVideo.classList.contains('hidden');
    els.stage.dataset.video = on ? 'on' : 'off';
    els.btnVideo.title = t(on ? 'video.hide' : 'video.show');
    $('use', els.btnVideo).setAttribute('href', on ? '#i-close' : '#i-play');
  }

  function updatePlayButton() {
    const use = $('use', els.btnPlay);
    use.setAttribute('href', state.playing ? '#i-pause' : '#i-play');
  }

  function updateProgress() {
    if (!state.seeking) {
      els.seek.value = state.dur ? Math.min(1000, (state.cur / state.dur) * 1000) : 0;
      setFill(els.seek);
      els.tCur.textContent = fmt(state.cur);
    }
    els.tDur.textContent = fmt(state.dur);
  }

  function updateVolumeUI() {
    els.volume.value = state.muted ? 0 : state.volume;
    setFill(els.volume);
    $('use', els.btnMute).setAttribute('href', state.muted || state.volume === 0 ? '#i-mute' : '#i-volume');
  }

  function applyVolume() {
    const v = state.muted ? 0 : state.volume;
    ytEngine.setVolume(v);
    scEngine.setVolume(v);
    updateVolumeUI();
  }

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      artwork: track.cover ? [{ src: track.cover }] : [],
    });
  }

  // ---------- Search ----------
  let searchId = 0;
  let lastQuery = '';
  async function runSearch(query) {
    const id = ++searchId;
    lastQuery = query;
    log('info', `Search: "${query}"`);
    const sources = Object.entries(state.sources)
      .filter(([, on]) => on)
      .map(([name]) => name);
    showTab('results');
    els.results.replaceChildren(emptyMessage(t('results.loading')));

    try {
      const res = await window.api.search(query, sources);
      if (id !== searchId) return; // a newer search has started: drop this answer
      state.results = { youtube: res.youtube || [], soundcloud: res.soundcloud || [] };
      renderResults();
      for (const [src, msg] of Object.entries(res.errors || {})) {
        toast(`${sourceLabel(src)}: ${msg}`);
      }
      if (!flatResults().length && !Object.keys(res.errors || {}).length) {
        els.results.replaceChildren(emptyMessage(t('results.none')));
      }
    } catch (err) {
      if (id !== searchId) return;
      renderResults();
      log('error', 'Search failed', { error: String(err.message || err) });
      toast(t('toast.searchError', { message: err.message || err }));
    }
  }

  function showTab(name) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    for (const panel of ['home', 'results', 'queue', 'history', 'playlists']) $('#' + panel).classList.toggle('hidden', name !== panel);
    if (window.GP && window.GP.onTab) window.GP.onTab(name);
  }

  // What library.js (history and playlists) needs from the player
  window.GP = {
    makeRow, groupTitle, emptyMessage, icon, toast, log, store, showTab, addToQueue, playFrom, sameTrack,
    playlistAction, markCurrentRows,
    currentTrack: () => (state.now ? state.now.shown : null),
    shuffleArray: (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(([, x]) => x),
  };

  // ---------- Events ----------
  // ----- search as you type, with suggestions -----
  const suggestBox = $('#suggest');
  let suggestItems = [];
  let suggestIndex = -1;
  let suggestId = 0;
  let liveTimer = null;
  let suggestTimer = null;

  function closeSuggest() {
    suggestItems = [];
    suggestIndex = -1;
    suggestBox.classList.add('hidden');
    suggestBox.replaceChildren();
  }

  function highlightSuggest() {
    [...suggestBox.children].forEach((el, i) => el.classList.toggle('active', i === suggestIndex));
  }

  function showSuggest(items) {
    suggestItems = items;
    suggestIndex = -1;
    suggestBox.replaceChildren(
      ...items.map((text, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'suggest-item';
        b.setAttribute('role', 'option');
        b.append(icon('i-search'), Object.assign(document.createElement('span'), { textContent: text }));
        // mousedown, so it fires before the input loses focus
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pickSuggestion(i);
        });
        return b;
      }),
    );
    suggestBox.classList.toggle('hidden', !items.length);
  }

  function pickSuggestion(i) {
    const text = suggestItems[i];
    if (!text) return;
    els.q.value = text;
    syncClear();
    closeSuggest();
    clearTimeout(liveTimer);
    runSearch(text);
  }

  async function fetchSuggestions(q) {
    const id = ++suggestId;
    let list = [];
    try {
      list = await window.api.suggest(q);
    } catch {
      /* no suggestions */
    }
    if (id !== suggestId || document.activeElement !== els.q) return;
    showSuggest(list.filter((s) => s.toLowerCase() !== q.toLowerCase()));
  }

  const syncClear = () => $('#qClear').classList.toggle('hidden', !els.q.value);
  $('#qClear').addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the field
  $('#qClear').addEventListener('click', () => {
    els.q.value = '';
    els.q.dispatchEvent(new Event('input'));
    // the results belonged to the text that was just erased
    searchId++;
    lastQuery = '';
    state.results = { youtube: [], soundcloud: [] };
    renderResults();
    els.q.focus();
  });
  els.q.addEventListener('input', syncClear);
  els.q.addEventListener('input', () => {
    const q = els.q.value.trim();
    clearTimeout(liveTimer);
    clearTimeout(suggestTimer);
    suggestId++;
    if (q.length < 2) {
      closeSuggest();
      return;
    }
    const isLink = /^https?:\/\//i.test(q);
    if (!isLink) suggestTimer = setTimeout(() => fetchSuggestions(q), 150);
    // results follow the text after a short pause (links wait for Enter)
    if (!isLink) liveTimer = setTimeout(() => runSearch(q), 500);
  });

  els.q.addEventListener('keydown', (e) => {
    if (!suggestItems.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = suggestItems.length;
      const pos = (suggestIndex + 1 + (e.key === 'ArrowDown' ? 1 : -1) + n + 1) % (n + 1);
      suggestIndex = pos - 1; // -1 = back to the typed text
      highlightSuggest();
      if (suggestIndex >= 0) els.q.value = suggestItems[suggestIndex];
      syncClear();
    } else if (e.key === 'Escape') {
      closeSuggest();
    }
  });
  els.q.addEventListener('blur', () => setTimeout(closeSuggest, 100));

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(liveTimer);
    clearTimeout(suggestTimer);
    suggestId++;
    closeSuggest();
    const q = els.q.value.trim();
    if (q) runSearch(q);
  });

  $$('.chip').forEach((chip) => {
    const name = chip.dataset.source;
    chip.classList.toggle('on', !!state.sources[name]);
    chip.addEventListener('click', () => {
      state.sources[name] = !state.sources[name];
      // at least one source must stay enabled
      if (!state.sources.youtube && !state.sources.soundcloud) state.sources[name] = true;
      $$('.chip').forEach((c) => c.classList.toggle('on', !!state.sources[c.dataset.source]));
      store.set('sources', state.sources);
      log('info', 'Sources changed', state.sources);
      // hide results of a disabled source at once; refresh so a re-enabled source is searched again
      renderResults();
      if (lastQuery) runSearch(lastQuery);
    });
  });

  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  els.btnPlay.addEventListener('click', togglePlay);
  els.btnNext.addEventListener('click', () => next(false));
  els.btnPrev.addEventListener('click', prev);
  els.btnSwap.addEventListener('click', switchVersion);

  els.btnShuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    els.btnShuffle.classList.toggle('on', state.shuffle);
  });
  els.btnRepeat.addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    els.btnRepeat.classList.toggle('on', state.repeat !== 'off');
    els.btnRepeat.dataset.mode = state.repeat;
    els.btnRepeat.title = t('transport.repeat.' + state.repeat);
  });

  els.seek.addEventListener('pointerdown', () => (state.seeking = true));
  els.seek.addEventListener('input', () => {
    setFill(els.seek);
    els.tCur.textContent = fmt((els.seek.value / 1000) * state.dur);
  });
  els.seek.addEventListener('change', () => {
    if (state.active && state.dur) engineOf(state.active).seek((els.seek.value / 1000) * state.dur);
    state.seeking = false;
  });

  els.volume.addEventListener('input', () => {
    state.volume = Number(els.volume.value);
    state.muted = false;
    store.set('volume', state.volume);
    applyVolume();
  });
  els.btnMute.addEventListener('click', () => {
    state.muted = !state.muted;
    applyVolume();
  });

  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName);
    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'KeyF' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      els.q.focus();
      els.q.select();
    }
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', togglePlay);
      ms.setActionHandler('pause', togglePlay);
      ms.setActionHandler('previoustrack', prev);
      ms.setActionHandler('nexttrack', () => next(false));
    } catch {
      /* the browser may not support some actions */
    }
  }

  // ---------- Window ----------
  $('#btnMin').addEventListener('click', () => window.api.win.minimize());
  $('#btnMax').addEventListener('click', () => window.api.win.toggleMaximize());
  $('#btnClose').addEventListener('click', () => window.api.win.close());
  let pinned = false;
  $('#btnPin').addEventListener('click', (e) => {
    pinned = !pinned;
    window.api.win.alwaysOnTop(pinned);
    e.currentTarget.classList.toggle('active', pinned);
  });

  // ---------- Appearance settings ----------
  // Two independent things:
  //  * Window effect: the system draws a blurred copy of what is behind the window (acrylic / mica / vibrancy).
  //  * Transparency: how much of that blurred backdrop shows through our tint. The tint covers the whole
  //    window, so fill = 1 - transparency. Without an effect the window is opaque (fill = 1).
  const slider = $('#transparency');
  const sliderVal = $('#transparencyVal');
  const effectSel = $('#effect');
  const effectHint = $('#effectHint');
  const theme = $('#theme');
  const priority = $('#priorityYT');
  const root = document.documentElement;

  let effect = 'none';
  let windowInfo = { effects: ['none'], hint: null, platform: '' };

  // The hint under the effect picker depends on the platform and on the chosen effect
  function updateEffectHint() {
    const info = windowInfo;
    let key = null;
    if (info.hint) key = 'effect.hint.' + info.hint;
    else if (info.effects.length === 1) key = 'effect.hint.none';
    else if (effect === 'mica') key = 'effect.hint.mica';
    else if (info.platform === 'win32' && effect !== 'none') key = info.transparencyEnabled === false ? 'effect.hint.noTransparency' : 'effect.hint.inactive';
    effectHint.textContent = key ? t(key) : '';
    effectHint.classList.toggle('hidden', !key);
  }

  function applyAppearance() {
    const transparency = Number(slider.value);
    const blurred = effect !== 'none';
    root.dataset.effect = effect;
    root.style.setProperty('--tint', String(blurred ? 1 - transparency / 100 : 1));
    sliderVal.textContent = transparency + '%';
    slider.disabled = !blurred;
    $('#rowTransparency').classList.toggle('disabled', !blurred);
    setFill(slider);
  }

  async function chooseEffect(next, persist) {
    effect = next;
    effectSel.value = next;
    try {
      await window.api.win.setEffect(next);
    } catch {
      /* the main process keeps the previous effect */
    }
    if (persist) store.set('effect', next);
    log('info', `Window effect: ${next}`);
    applyAppearance();
    updateEffectHint();
  }

  async function initWindowEffect() {
    let info = { effects: ['none'], defaultEffect: 'none', hint: null };
    try {
      info = await window.api.win.getInfo();
    } catch {
      /* use the opaque defaults */
    }
    effectSel.replaceChildren(
      ...info.effects.map((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = t('effect.' + name);
        return opt;
      }),
    );
    windowInfo = info;
    $('#rowTray').classList.toggle('hidden', info.trayAvailable === false);
    const saved = store.get('effect', info.defaultEffect);
    await chooseEffect(info.effects.includes(saved) ? saved : info.defaultEffect, false);
  }

  slider.value = store.get('transparency', 30);
  slider.addEventListener('input', () => {
    store.set('transparency', Number(slider.value));
    applyAppearance();
  });
  effectSel.addEventListener('change', () => chooseEffect(effectSel.value, true));

  theme.value = store.get('theme', 'silver');
  root.dataset.theme = theme.value;
  theme.addEventListener('change', () => {
    root.dataset.theme = theme.value;
    store.set('theme', theme.value);
  });

  // Tray: what closing the window does, the labels of the tray menu, and the track info it shows
  const closeToTray = $('#closeToTray');
  closeToTray.checked = store.get('closeToTray', false);
  window.api.tray.setCloseToTray(closeToTray.checked);
  closeToTray.addEventListener('change', () => {
    store.set('closeToTray', closeToTray.checked);
    window.api.tray.setCloseToTray(closeToTray.checked);
  });
  window.api.tray.setLabels(Object.fromEntries(['show', 'hide', 'quit', 'prev', 'next', 'play', 'pause', 'nothing'].map((k) => [k, t('tray.' + k)])));
  window.api.player.onCommand((cmd) => {
    if (cmd === 'prev') prev();
    else if (cmd === 'next') next(false);
    else if (cmd === 'toggle') togglePlay();
  });
  const reportToTray = () => {
    const n = state.now;
    window.api.player.report({
      hasTrack: !!n,
      title: n ? n.shown.title : '',
      artist: n ? n.shown.artist : '',
      cur: state.cur,
      dur: state.dur,
      playing: state.playing,
    });
  };
  setInterval(reportToTray, 1000);
  reportToTray();

  // Start with the system (the real state lives in the system, so ask it instead of remembering)
  const autostart = $('#autostart');
  window.api.autostart.get().then((s) => {
    $('#rowAutostart').classList.toggle('hidden', !s.available);
    autostart.checked = s.enabled;
  });
  autostart.addEventListener('change', async () => {
    const s = await window.api.autostart.set(autostart.checked);
    autostart.checked = s.enabled; // show what really happened
  });

  const autoVideo = $('#autoVideo');
  autoVideo.checked = store.get('autoVideo', false);
  autoVideo.addEventListener('change', () => store.set('autoVideo', autoVideo.checked));
  els.btnVideo.addEventListener('click', () => {
    videoOn = !videoOn;
    updateVideo();
    log('info', `Video ${videoOn ? 'shown' : 'hidden'}`);
  });

  priority.checked = state.priorityYT;
  priority.addEventListener('change', () => {
    state.priorityYT = priority.checked;
    store.set('priorityYT', state.priorityYT);
  });

  // The settings window: sections on the left, the chosen one on the right
  const openSettings = (page) => {
    if (page) showSettingsPage(page);
    els.settings.classList.remove('hidden');
  };
  const closeSettings = () => els.settings.classList.add('hidden');
  function showSettingsPage(page) {
    $$('.st-nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
    $$('.st-page').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== page));
  }
  $$('.st-nav button').forEach((b) => b.addEventListener('click', () => showSettingsPage(b.dataset.page)));
  $('#btnSettings').addEventListener('click', () => (els.settings.classList.contains('hidden') ? openSettings() : closeSettings()));
  $('#stX').addEventListener('click', closeSettings);
  $('#stClose').addEventListener('click', closeSettings);
  els.settings.addEventListener('mousedown', (e) => {
    if (e.target === els.settings) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.settings.classList.contains('hidden') && $('#changelog').classList.contains('hidden')) closeSettings();
  });

  // ---------- Developer mode ----------
  const devMode = $('#devMode');
  const devOptions = $('#devOptions');
  const devDebugButton = $('#devDebugButton');
  const devVerbose = $('#devVerbose');
  const btnDebug = $('#btnDebug');

  function applyDevMode() {
    const on = devMode.checked;
    devOptions.classList.toggle('hidden', !on);
    btnDebug.classList.toggle('hidden', !(on && devDebugButton.checked));
    window.api.log.setVerbose(on && devVerbose.checked);
  }
  devMode.checked = store.get('devMode', false);
  devDebugButton.checked = store.get('devDebugButton', true);
  devVerbose.checked = store.get('devVerbose', false);
  for (const [el, key] of [[devMode, 'devMode'], [devDebugButton, 'devDebugButton'], [devVerbose, 'devVerbose']]) {
    el.addEventListener('change', () => {
      store.set(key, el.checked);
      applyDevMode();
    });
  }
  btnDebug.addEventListener('click', () => window.api.debug.open());
  applyDevMode();

  window.api.version().then((v) => {
    $('#appVersion').textContent = 'Glass Player v' + v;
  }).catch(() => {});

  // ---------- Updates ----------
  const updText = $('#updateText');
  const updBtn = $('#btnUpdate');
  let updStatus = 'idle';
  const pageReady =
    document.readyState === 'loading'
      ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
      : Promise.resolve();
  let announced = '';
  let manualChecking = false;
  let lastUpdate = { status: 'idle' };

  function renderUpdate(s) {
    updStatus = s.status;
    updBtn.disabled = false;
    updBtn.textContent = t('update.check');
    if (s.status === 'checking') {
      updText.textContent = t('update.checking');
      updBtn.disabled = true;
    } else if (s.status === 'downloading') {
      updText.textContent = t('update.downloading', { version: s.version || '', percent: s.percent || 0 });
      updBtn.disabled = true;
    } else if (s.status === 'downloaded') {
      updText.textContent = t('update.downloaded', { version: s.version });
      updBtn.textContent = t('update.restart');
    } else if (s.status === 'manual') {
      updText.textContent = t(s.isPortable ? 'update.availablePortable' : 'update.available', { version: s.version });
      updBtn.textContent = t('update.openPage');
    } else if (s.status === 'none') {
      updText.textContent = s.code ? t('update.code.' + s.code) : t('update.upToDate');
    } else if (s.status === 'error') {
      updText.textContent = s.code ? t('update.code.' + s.code) : t('update.failed', { message: s.message || 'error' });
    } else {
      updText.textContent = t('update.idle');
    }
    // A newly found version opens the "What's new" window once per run (unless the user skipped that version,
    // and a manual check always shows it)
    const available = ['downloading', 'downloaded', 'manual'].includes(s.status) && s.version;
    const manual = manualChecking;
    if (s.status !== 'checking') manualChecking = false;
    lastUpdate = s;
    // the changelog script loads after this one, so wait until every script has run
    pageReady.then(() => {
      if (available && announced !== s.version) {
        announced = s.version;
        if ((manual || store.get('skipVersion', '') !== s.version) && window.GP.openChangelog) {
          window.GP.openChangelog({ reason: 'update' });
        }
      }
      if (window.GP.onUpdate) window.GP.onUpdate(s);
    });
  }

  updBtn.addEventListener('click', () => {
    if (updStatus === 'downloaded' || updStatus === 'manual') window.api.update.install();
    else {
      manualChecking = true;
      window.api.update.check();
    }
  });
  $('#btnChangelog').addEventListener('click', () => {
    els.settings.classList.add('hidden');
    window.GP.openChangelog({ reason: 'browse' });
  });

  // Automatic checks can be switched off (the manual Check button always works)
  const autoUpdate = $('#autoUpdate');
  autoUpdate.checked = store.get('autoUpdate', true);
  window.api.update.setAuto(autoUpdate.checked);
  autoUpdate.addEventListener('change', () => {
    store.set('autoUpdate', autoUpdate.checked);
    window.api.update.setAuto(autoUpdate.checked);
    if (autoUpdate.checked) window.api.update.check();
  });
  Object.assign(window.GP, {
    updateState: () => lastUpdate,
    installUpdate: () => window.api.update.install(),
  });
  window.api.update.onState(renderUpdate);
  window.api.update.get().then(renderUpdate).catch(() => {});

  // ---------- Start ----------
  window.i18n.apply();
  applyAppearance();
  initWindowEffect();
  applyVolume();
  updatePlayButton();
  updateProgress();
  renderLists();
  showTab('results');
  els.q.focus();
})();
