// Artist, album and playlist pages, and the rows that open them (loaded after app.js and home.js).
(() => {
  'use strict';

  const GP = window.GP;
  const api = window.api;
  const t = window.t;
  const box = document.querySelector('#entity');
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const platIcon = (source) => {
    const i = GP.icon(source === 'youtube' ? 'i-p-yt' : 'i-p-sc');
    i.classList.add(source === 'youtube' ? 'p-yt' : 'p-sc');
    return i;
  };
  const kindLabel = (kind) => t('page.kind.' + kind);
  const plural = (n) => (n === 1 ? t('page.tracks.one') : t('page.tracks', { count: n }));

  // ---------- Navigation ----------
  const nav = []; // opened pages, newest last
  let fromTab = 'home';
  let loadId = 0;

  function visible() {
    return !box.classList.contains('hidden');
  }

  function open(ref) {
    if (!ref || !ref.id) return;
    if (!visible()) {
      const active = document.querySelector('.tab.active');
      fromTab = active ? active.dataset.tab : 'home';
      nav.length = 0;
    }
    nav.push(ref);
    GP.showTab('entity');
    load(ref);
  }

  function back() {
    nav.pop();
    if (nav.length) load(nav[nav.length - 1]);
    else GP.showTab(fromTab);
  }

  function backBar() {
    const bar = el('div', 'toolbar');
    const b = el('button', 'swap');
    b.type = 'button';
    b.append(GP.icon('i-back'), el('span', '', nav.length > 1 ? t('page.back') : t('page.backTo', { tab: t('tabs.' + fromTab) })));
    b.addEventListener('click', back);
    bar.append(b);
    return bar;
  }

  async function load(ref) {
    const id = ++loadId;
    box.replaceChildren(backBar(), GP.emptyMessage(t('page.loading')));
    box.scrollTop = 0;
    let page;
    try {
      page = ref.kind === 'artist' ? await api.page.artist(ref.source, ref.id) : await api.page.playlist(ref.source, ref.id, ref.kind);
    } catch (err) {
      page = { error: String(err.message || err) };
    }
    if (id !== loadId || !visible()) return; // another page was opened meanwhile
    if (!page || page.error) {
      GP.log('warn', 'Page failed to load', { ref: `${ref.source}:${ref.kind}:${ref.id}`, error: page && page.error });
      box.replaceChildren(backBar(), GP.emptyMessage(t('page.failed')));
      return;
    }
    // search results already know a title and a cover; keep them if the page came without
    page.title = page.title || ref.title;
    page.cover = page.cover || ref.cover;
    render(page);
  }

  // ---------- Pieces ----------
  function head(page, buttons) {
    const h = el('div', 'ent-head');
    const art = el('div', 'ent-cover' + (page.kind === 'artist' ? ' round' : ''));
    if (page.cover) {
      const img = el('img');
      img.src = page.cover;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      art.append(img);
    } else art.append(page.kind === 'artist' ? el('span', 'ent-ph', '♪') : GP.icon('i-list-plus'));
    const info = el('div', 'ent-info');
    const meta = el('div', 'ent-meta');
    meta.append(platIcon(page.source), el('span', '', [kindLabel(page.kind), page.subtitle].filter(Boolean).join(' · ')));
    info.append(el('h3', '', page.title), meta);
    if (page.description) {
      const d = el('p', 'ent-desc', page.description);
      d.title = page.description;
      d.addEventListener('click', () => d.classList.toggle('open'));
      info.append(d);
    }
    const btns = el('div', 'ent-btns');
    btns.append(...buttons);
    info.append(btns);
    h.append(art, info);
    return h;
  }

  function button(iconName, label, onClick, cls = 'swap') {
    const b = el('button', cls);
    b.type = 'button';
    b.append(GP.icon(iconName), el('span', '', label));
    b.addEventListener('click', onClick);
    return b;
  }

  function playButtons(tracks) {
    const play = button('i-play', t('playlist.play'), () => GP.playFrom(tracks, tracks[0]), 'swap primary');
    const shuffle = button('i-shuffle', t('playlist.shuffle'), () => {
      const mixed = GP.shuffleArray(tracks);
      GP.playFrom(mixed, mixed[0]);
    });
    play.disabled = shuffle.disabled = !tracks.length;
    return [play, shuffle];
  }

  // Saves a loaded page as a new playlist of the user's own
  async function saveAsPlaylist(page, btn) {
    if (!page.tracks || !page.tracks.length) return;
    if (btn) btn.disabled = true;
    try {
      const pl = await api.playlists.create({ name: page.title });
      const res = await api.playlists.add(pl.id, page.tracks);
      GP.toast(t('page.saved', { name: page.title, count: page.tracks.length }));
      GP.log('info', 'Saved a playlist from a page', { name: page.title, tracks: page.tracks.length, result: res && res.added });
    } catch (err) {
      GP.log('error', 'Saving the playlist failed', { error: String(err.message || err) });
      GP.toast(t('page.saveFailed'));
    }
    if (btn) btn.disabled = false;
  }

  // A shelf (a sideways row of cards) of albums / playlists / related artists
  function refShelf(title, refs) {
    const wrap = el('section', 'shelf');
    const headEl = el('div', 'shelf-head');
    headEl.append(el('h4', 'shelf-title', title));
    const track = el('div', 'shelf-track');
    for (const r of refs) track.append(refCard(r));
    GP.enableDragScroll(track);
    wrap.append(headEl, track);
    return wrap;
  }

  function refCard(ref) {
    const c = el('div', 'tcard');
    c.title = [ref.title, ref.subtitle].filter(Boolean).join(' — ');
    const art = el('div', 'tcard-art' + (ref.kind === 'artist' ? ' round' : ''));
    if (ref.cover) {
      const img = el('img');
      img.src = ref.cover;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      art.append(img);
    } else art.append(el('span', 'tcard-ph', '♪'));
    c.append(art, el('div', 'title', ref.title), el('div', 'sub', ref.subtitle || kindLabel(ref.kind)));
    c.addEventListener('click', () => open(ref));
    return c;
  }

  const queueAction = (track) => ({ icon: 'i-plus', title: t('row.addToQueue'), onClick: () => GP.addToQueue(track) });
  // asList: an album / playlist plays on through its tracks; an artist's song list plays just the picked track
  const trackRows = (tracks, shownTracks = tracks, asList = false) =>
    shownTracks.map((track) =>
      GP.makeRow(track, { onPlay: () => (asList ? GP.playFrom(tracks, track) : GP.playOne(track)), actions: [queueAction(track), GP.playlistAction(track)] }),
    );

  // a long list shows its first rows and a button for the rest
  function longList(tracks, limit, asList = false) {
    const holder = el('div', 'ent-rows');
    const fill = (n) => {
      holder.replaceChildren(...trackRows(tracks, tracks.slice(0, n), asList));
      if (tracks.length > n) {
        const more = el('button', 'swap more', t('page.showAll', { count: tracks.length }));
        more.type = 'button';
        more.addEventListener('click', () => {
          fill(tracks.length);
          GP.markCurrentRows();
        });
        holder.append(more);
      }
    };
    fill(limit);
    return holder;
  }

  // ---------- Pages ----------
  function render(page) {
    const parts = [backBar()];
    if (page.kind === 'artist') {
      parts.push(head(page, playButtons(page.tracks || [])));
      if (page.tracks && page.tracks.length) parts.push(GP.groupTitle(t('page.songs')), longList(page.tracks, 8));
      for (const sec of page.sections || []) {
        if (sec.refs && sec.refs.length) parts.push(refShelf(sec.title, sec.refs));
        else if (sec.tracks && sec.tracks.length) parts.push(GP.groupTitle(sec.title), longList(sec.tracks, 5));
      }
      if (!(page.tracks && page.tracks.length) && !(page.sections && page.sections.length)) parts.push(GP.emptyMessage(t('page.empty')));
    } else {
      const tracks = page.tracks || [];
      const saveBtn = button('i-list-plus', t('page.save'), () => saveAsPlaylist(page, saveBtn));
      saveBtn.disabled = !tracks.length;
      parts.push(head({ ...page, subtitle: [page.subtitle, plural(tracks.length)].filter(Boolean).join(' · ') }, [...playButtons(tracks), saveBtn]));
      parts.push(...(tracks.length ? [longList(tracks, 200, true)] : [GP.emptyMessage(t('page.empty'))]));
    }
    box.replaceChildren(...parts);
    GP.markCurrentRows();
  }

  // ---------- For other scripts ----------
  GP.openEntity = open;

  // The artist behind a track: by stored id, or looked up by name on the track's own service
  GP.openArtistOf = async (track) => {
    if (!track) return;
    if (track.artistId) {
      open({ source: track.source, kind: 'artist', id: track.artistId, title: track.artist });
      return;
    }
    const name = String(track.artist || '').split(/,|&| feat\.? /i)[0].trim();
    if (!name) return;
    const ref = await api.page.findArtist(track.source, name);
    if (ref) open(ref);
    else GP.toast(t('page.noArtist'));
  };

  // The album behind a track (YouTube Music only): by stored id, or looked up by name
  GP.openAlbumOf = async (track) => {
    if (!track || track.source !== 'youtube' || !track.album) return;
    if (track.albumId) {
      open({ source: 'youtube', kind: 'album', id: track.albumId, title: track.album });
      return;
    }
    const ref = await api.page.findAlbum(track.album, track.artist);
    if (ref) open(ref);
    else GP.toast(t('page.noAlbum'));
  };

  // A row for an artist / album / playlist in search results. Playlists and albums can be saved right from the row.
  GP.entityRow = (ref) => {
    const row = el('div', 'row entity');
    const art = el(ref.cover ? 'img' : 'div', (ref.cover ? '' : 'thumb-ph ') + (ref.kind === 'artist' ? 'round' : ''));
    if (ref.cover) {
      art.src = ref.cover;
      art.loading = 'lazy';
      art.referrerPolicy = 'no-referrer';
      art.alt = '';
    }
    const meta = el('div', 'meta');
    meta.append(el('div', 'title', ref.title), el('div', 'sub', [kindLabel(ref.kind), ref.subtitle].filter(Boolean).join(' · ')));
    const acts = el('div', 'acts');
    if (ref.kind !== 'artist') {
      const b = el('button', 'act');
      b.type = 'button';
      b.title = t('page.saveRow');
      b.append(GP.icon('i-list-plus'));
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        b.disabled = true;
        const page = await api.page.playlist(ref.source, ref.id, ref.kind).catch(() => null);
        if (page && !page.error) await saveAsPlaylist({ ...page, title: page.title || ref.title });
        else GP.toast(t('page.failed'));
        b.disabled = false;
      });
      acts.append(b);
    }
    const end = el('div', 'end');
    const plats = el('span', 'plats');
    plats.append(platIcon(ref.source));
    end.append(plats);
    row.append(art, meta, acts, end);
    row.addEventListener('click', () => open(ref));
    return row;
  };

  // when the user leaves through a normal tab, forget the page stack
  const prevOnTab = GP.onTab;
  GP.onTab = (name) => {
    if (name !== 'entity') nav.length = 0;
    if (prevOnTab) prevOnTab(name);
  };
})();
