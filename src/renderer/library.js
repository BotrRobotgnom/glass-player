// History and playlists (the player core lives in app.js and shares its helpers through window.GP).
(() => {
  'use strict';

  const GP = window.GP;
  const api = window.api;
  const t = window.t;
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const plural = (base, n) => (n === 1 ? t(base + '.one') : t(base, { count: n }));
  const lang = () => document.documentElement.lang || 'en';

  function ago(ts) {
    const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
    const sec = Math.round((ts - Date.now()) / 1000);
    const steps = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of steps) if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
    return rtf.format(0, 'second');
  }

  // A button that needs a second click within 3 s (so a stray click can't delete anything)
  function confirmClick(btn, label, action) {
    let timer = null;
    const original = btn.innerHTML;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (timer) {
        clearTimeout(timer);
        timer = null;
        action();
        return;
      }
      btn.classList.add('confirm');
      btn.textContent = label;
      timer = setTimeout(() => {
        timer = null;
        btn.classList.remove('confirm');
        btn.innerHTML = original;
      }, 3000);
    });
  }

  // 3 min, 1 h 5 min; empty for an empty playlist
  function totalTime(sec, count) {
    if (!count) return '';
    const min = Math.round((sec || 0) / 60);
    if (min < 1) return t('time.lessThanMin');
    return min >= 60 ? t('time.hoursMin', { h: Math.floor(min / 60), m: min % 60 }) : t('time.min', { m: min });
  }

  const queueAction = (track) => ({ icon: 'i-plus', title: t('row.addToQueue'), onClick: () => GP.addToQueue(track) });

  // ---------- History ----------
  const histBox = $('#history');
  let histView = GP.store.get('historyView', 'recent');
  if (!['recent', 'top', 'forgotten'].includes(histView)) histView = 'recent';

  async function renderHistory() {
    const scroll = histBox.scrollTop;
    let items = [];
    try {
      items = await api.history.get(histView, 200);
    } catch (err) {
      GP.log('error', 'Reading history failed', { error: String(err.message || err) });
    }

    const seg = el('div', 'seg');
    for (const view of ['recent', 'top', 'forgotten']) {
      const b = el('button', view === histView ? 'on' : '', t('history.' + view));
      b.type = 'button';
      b.addEventListener('click', () => {
        histView = view;
        GP.store.set('historyView', view);
        histBox.scrollTop = 0;
        renderHistory();
      });
      seg.appendChild(b);
    }
    const clear = el('button', 'swap danger');
    clear.type = 'button';
    clear.append(GP.icon('i-trash'), el('span', '', t('history.clear')));
    confirmClick(clear, t('common.confirm'), async () => {
      await api.history.clear();
      GP.toast(t('history.cleared'));
      renderHistory();
    });
    const bar = el('div', 'toolbar');
    bar.append(seg, clear);

    const rows = items.map((it) => {
      const bits = [it.track.artist];
      if (histView === 'recent') bits.push(ago(it.last));
      else if (histView === 'top') bits.push(plural('history.plays', it.plays));
      else bits.push(plural('history.plays', it.plays), ago(it.last));
      return GP.makeRow(it.track, {
        onPlay: () => GP.playFrom(items.map((x) => x.track), it.track),
        subText: bits.filter(Boolean).join(' · '),
        actions: [queueAction(it.track), GP.playlistAction(it.track)],
        remove: {
          title: t('history.removeTrack'),
          onClick: async () => {
            await api.history.remove(it.track.source + ':' + it.track.id);
            renderHistory();
          },
        },
      });
    });

    histBox.replaceChildren(bar, ...(rows.length ? rows : [GP.emptyMessage(t('history.empty.' + histView))]));
    if (rows.length && histView === 'recent') histBox.appendChild(el('div', 'hint-line', t('history.hint')));
    GP.markCurrentRows();
    histBox.scrollTop = scroll;
  }

  // ---------- Playlists: covers ----------
  function coverNode(pl, extra = '') {
    const box = el('div', 'pl-cover ' + extra);
    if (pl.cover) {
      const img = el('img');
      img.src = pl.cover;
      img.alt = '';
      box.appendChild(img);
    } else if (pl.covers && pl.covers.length) {
      // no own image: a small mosaic of the first tracks' artwork
      if (pl.covers.length >= 4) box.classList.add('mosaic');
      for (const src of pl.covers.slice(0, pl.covers.length >= 4 ? 4 : 1)) {
        const img = el('img');
        img.src = src;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        box.appendChild(img);
      }
    } else {
      box.appendChild(GP.icon('i-list-plus'));
    }
    return box;
  }

  // ---------- Playlists: create / edit dialog ----------
  const dlg = $('#plDialog');
  const dlgName = $('#plName');
  const dlgPreview = $('#plCoverPreview');
  const dlgRemove = $('#plRemoveCover');
  const dlgPick = $('#plPick');
  let dlgState = null; // { playlist, token, previewUrl, removeCover, resolve }

  function drawDialogCover() {
    const s = dlgState;
    const shown = s.removeCover ? null : s.previewUrl || (s.playlist && s.playlist.cover) || null;
    dlgPreview.replaceChildren();
    if (shown) {
      const img = el('img');
      img.src = shown;
      img.alt = '';
      dlgPreview.appendChild(img);
    } else {
      dlgPreview.appendChild(GP.icon('i-image'));
    }
    dlgRemove.classList.toggle('hidden', !shown);
    $('span', dlgPick).textContent = t(shown ? 'playlist.changeImage' : 'playlist.chooseImage');
  }

  // Resolves with the saved playlist, or null when cancelled
  function openPlaylistDialog(playlist = null) {
    return new Promise((resolve) => {
      dlgState = { playlist, token: null, previewUrl: null, removeCover: false, resolve };
      $('#plDialogTitle').textContent = t(playlist ? 'playlist.edit' : 'playlist.new');
      dlgName.value = playlist ? playlist.name : '';
      drawDialogCover();
      dlg.showModal();
      dlgName.focus();
      dlgName.select();
    });
  }

  function closeDialog(result) {
    const s = dlgState;
    dlgState = null;
    if (dlg.open) dlg.close();
    if (s) s.resolve(result);
  }

  dlgPick.addEventListener('click', async () => {
    const res = await api.playlists.pickImage();
    if (!res || !dlgState) return;
    if (res.error) {
      GP.toast(t('playlist.notImage'));
      return;
    }
    dlgState.token = res.token;
    dlgState.previewUrl = res.preview;
    dlgState.removeCover = false;
    drawDialogCover();
  });
  dlgRemove.addEventListener('click', () => {
    if (!dlgState) return;
    dlgState.token = null;
    dlgState.previewUrl = null;
    dlgState.removeCover = true;
    drawDialogCover();
  });
  $('#plCancel').addEventListener('click', () => closeDialog(null));
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(null);
  });
  $('#plForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = dlgState;
    if (!s) return;
    const name = dlgName.value;
    let saved;
    if (s.playlist) {
      saved = await api.playlists.update(s.playlist.id, { name, coverToken: s.token, removeCover: s.removeCover && !s.token });
    } else {
      saved = await api.playlists.create({ name, coverToken: s.token });
      GP.toast(t('playlist.created'));
    }
    closeDialog(saved);
  });

  // ---------- Playlists: "add to playlist" menu ----------
  const menu = $('#plMenu');

  function closeMenu() {
    menu.classList.add('hidden');
    menu.replaceChildren();
  }

  async function addTrackTo(playlist, track) {
    const res = await api.playlists.add(playlist.id, [track]);
    if (!res) return;
    GP.toast(t(res.added ? 'playlist.added' : 'playlist.already', { name: res.name }));
    if (!$('#playlists').classList.contains('hidden')) renderPlaylists();
  }

  async function pickPlaylist(anchor, track) {
    if (!track) return;
    const lists = await api.playlists.list();
    const items = lists.map((pl) => {
      const b = el('button', 'item');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.append(coverNode(pl), el('span', 'name', pl.name), el('span', 'n', String(pl.count)));
      b.addEventListener('click', () => {
        closeMenu();
        addTrackTo(pl, track);
      });
      return b;
    });
    const create = el('button', 'item');
    create.type = 'button';
    create.append(GP.icon('i-plus'), el('span', 'name', t('playlist.newItem')));
    create.addEventListener('click', async () => {
      closeMenu();
      const pl = await openPlaylistDialog();
      if (pl) addTrackTo(pl, track);
    });
    menu.replaceChildren(...items, ...(items.length ? [document.createElement('hr')] : []), create);
    menu.classList.remove('hidden');

    // below the button, kept inside the window
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    const top = r.bottom + 6 + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 6) : r.bottom + 6;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // ---------- Playlists: list and detail views ----------
  const plBox = $('#playlists');
  const plView = { id: null };

  async function renderPlaylists() {
    if (plView.id) {
      const pl = await api.playlists.get(plView.id);
      if (pl) return renderPlaylistDetail(pl);
      plView.id = null;
    }
    renderPlaylistList();
  }

  async function renderPlaylistList() {
    const lists = await api.playlists.list();
    const add = el('button', 'swap');
    add.type = 'button';
    add.append(GP.icon('i-plus'), el('span', '', t('playlist.new')));
    add.addEventListener('click', async () => {
      const pl = await openPlaylistDialog();
      if (pl) {
        plView.id = pl.id;
        renderPlaylists();
      }
    });
    const bar = el('div', 'toolbar');
    bar.appendChild(add);

    const rows = lists.map((pl) => {
      const row = el('div', 'row pl-row');
      const meta = el('div', 'meta');
      meta.append(el('div', 'title', pl.name), el('div', 'sub', plural('playlist.tracks', pl.count)));
      // buttons appear only while the row is hovered; the total time stays at the right
      const acts = el('div', 'pl-acts');
      const act = (icon, label, onClick, primary) => {
        const b = el('button', 'swap' + (primary ? ' primary' : ''));
        b.type = 'button';
        b.append(GP.icon(icon), el('span', '', label));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
        return b;
      };
      const has = pl.count > 0;
      const playBtn = act('i-play', t('playlist.play'), async () => playPlaylist(await api.playlists.get(pl.id), false), true);
      const shuffleBtn = act('i-shuffle', t('playlist.shuffle'), async () => playPlaylist(await api.playlists.get(pl.id), true));
      playBtn.disabled = shuffleBtn.disabled = !has;
      const editBtn = act('i-edit', t('playlist.editShort'), async () => {
        const full = await api.playlists.get(pl.id);
        if (full && (await openPlaylistDialog(full))) renderPlaylists();
      });
      acts.append(playBtn, shuffleBtn, editBtn);
      row.append(coverNode(pl), meta, el('div', 'end', totalTime(pl.duration, pl.count)), acts);
      row.addEventListener('click', () => {
        plView.id = pl.id;
        renderPlaylists();
      });
      return row;
    });
    plBox.replaceChildren(bar, ...(rows.length ? rows : [GP.emptyMessage(t('playlist.empty'))]));
  }

  function playPlaylist(pl, shuffle) {
    if (!pl || !pl.tracks.length) return;
    const tracks = shuffle ? GP.shuffleArray(pl.tracks) : pl.tracks;
    GP.playFrom(tracks, tracks[0]);
  }

  function renderPlaylistDetail(pl) {
    const scroll = plBox.scrollTop;
    const back = el('button', 'back-btn');
    back.type = 'button';
    back.append(GP.icon('i-back'), el('span', '', t('playlist.back')));
    back.addEventListener('click', () => {
      plView.id = null;
      renderPlaylists();
    });

    const info = el('div', 'info');
    const btns = el('div', 'btns');
    const button = (icon, label, onClick, cls = 'swap') => {
      const b = el('button', cls);
      b.type = 'button';
      b.append(GP.icon(icon), el('span', '', label));
      if (onClick) b.addEventListener('click', onClick);
      return b;
    };
    const hasTracks = pl.tracks.length > 0;
    const playBtn = button('i-play', t('playlist.play'), () => playPlaylist(pl, false), 'swap primary');
    const shuffleBtn = button('i-shuffle', t('playlist.shuffle'), () => playPlaylist(pl, true));
    playBtn.disabled = shuffleBtn.disabled = !hasTracks;
    const editBtn = button('i-edit', t('playlist.editShort'), async () => {
      const saved = await openPlaylistDialog(pl);
      if (saved) renderPlaylists();
    });
    // deleting a playlist is only possible from inside it, and needs a second click
    const delBtn = button('i-trash', t('playlist.deleteShort'), null, 'swap');
    confirmClick(delBtn, t('common.confirm'), async () => {
      await api.playlists.remove(pl.id);
      GP.toast(t('playlist.deleted'));
      plView.id = null;
      renderPlaylists();
    });
    btns.append(playBtn, shuffleBtn, editBtn, delBtn);
    info.append(el('h3', '', pl.name), el('p', '', plural('playlist.tracks', pl.tracks.length)), btns);
    const head = el('div', 'pl-head');
    head.append(coverNode(pl, 'head'), info, el('div', 'pl-total', totalTime(pl.duration, pl.tracks.length)));

    const rows = pl.tracks.map((track) =>
      GP.makeRow(track, {
        onPlay: () => GP.playFrom(pl.tracks, track),
        actions: [queueAction(track)],
        remove: {
          icon: 'i-close',
          title: t('playlist.removeTrack'),
          onClick: async () => {
            await api.playlists.removeTrack(pl.id, track.source + ':' + track.id);
            renderPlaylists();
          },
        },
      }),
    );
    plBox.replaceChildren(back, head, ...(rows.length ? rows : [GP.emptyMessage(t('playlist.emptyTracks'))]));
    GP.markCurrentRows();
    plBox.scrollTop = scroll;
  }

  // ---------- Hooks used by app.js ----------
  GP.pickPlaylist = pickPlaylist;
  GP.onTab = (name) => {
    if (name === 'history') renderHistory();
    else if (name === 'playlists') renderPlaylists();
  };
  GP.onHistoryChanged = () => {
    if (!histBox.classList.contains('hidden') && histView === 'recent') renderHistory();
  };

  // "Add to playlist" for the track that is playing now
  const npBtn = $('#btnNpPlaylist');
  npBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pickPlaylist(npBtn, GP.currentTrack());
  });
})();
