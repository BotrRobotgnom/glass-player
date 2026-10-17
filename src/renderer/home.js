// Home: recommendations based on the local listening history (built in the main process, see main/recommend.js)
// plus YouTube Music's popular shelves and the SoundCloud trending chart. Every list is a horizontal row of cards.
(() => {
  'use strict';

  const GP = window.GP;
  const api = window.api;
  const t = window.t;
  const box = document.querySelector('#home');
  let loading = false;
  let loadedOnce = false;
  let data = null;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function sectionTitle(s) {
    if (s.kind === 'mix') return t(s.source === 'youtube' ? 'home.mixYouTube' : 'home.mixSoundCloud');
    if (s.kind === 'because') return t('home.because', { title: s.seed.title });
    if (s.kind === 'trending') return t('home.trending');
    return s.title || '';
  }

  function toolbar() {
    const bar = el('div', 'toolbar');
    const btn = el('button', 'swap');
    btn.type = 'button';
    btn.disabled = loading;
    btn.append(GP.icon('i-refresh'), el('span', '', t('home.refresh')));
    btn.addEventListener('click', () => load(true));
    bar.append(btn);
    return bar;
  }

  // One track: cover, title, artist. Hovering the cover offers "add to queue" and "add to playlist"
  function card(track, list) {
    const c = el('div', 'tcard');
    c.dataset.key = track.source + ':' + track.id;
    c.title = [track.title, track.artist].filter(Boolean).join(' — ');
    const art = el('div', 'tcard-art');
    if (track.cover) {
      const img = el('img');
      img.src = track.cover;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      art.append(img);
    } else art.append(el('span', 'tcard-ph', '♪'));
    const acts = el('div', 'tcard-acts');
    for (const a of [{ icon: 'i-plus', title: t('row.addToQueue'), onClick: () => GP.addToQueue(track) }, GP.playlistAction(track)]) {
      const b = el('button', 'act');
      b.type = 'button';
      b.title = a.title;
      b.append(GP.icon(a.icon));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        a.onClick(b);
      });
      acts.append(b);
    }
    art.append(acts);
    c.append(art, el('div', 'title', track.title), el('div', 'sub', track.artist));
    c.addEventListener('click', () => GP.playFrom(list, track));
    return c;
  }

  // A titled row of cards with arrows (a mouse wheel scrolls the page, not the row)
  function shelf(s) {
    const wrap = el('section', 'shelf');
    const head = el('div', 'shelf-head');
    const arrow = (dir) => {
      const b = el('button', 'shelf-arrow' + (dir > 0 ? ' next' : ''));
      b.type = 'button';
      b.title = t(dir > 0 ? 'home.next' : 'home.previous');
      b.append(GP.icon('i-back'));
      b.addEventListener('click', () => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' }));
      return b;
    };
    const track = el('div', 'shelf-track');
    for (const tr of s.tracks) track.append(card(tr, s.tracks));
    const arrows = el('div', 'shelf-arrows');
    arrows.append(arrow(-1), arrow(1));
    head.append(el('h4', 'shelf-title', sectionTitle(s)), arrows);
    wrap.append(head, track);
    return wrap;
  }

  function render() {
    const scroll = box.scrollTop;
    const parts = [toolbar()];
    if (loading && !data) {
      parts.push(GP.emptyMessage(t('home.loading')));
    } else if (!data || !data.sections.length) {
      parts.push(GP.emptyMessage(t(data && data.errors.length ? 'home.failed' : 'home.empty')));
    } else {
      if (!data.seeds) parts.push(el('div', 'home-hint', t('home.noHistory')));
      for (const s of data.sections) parts.push(shelf(s));
    }
    box.replaceChildren(...parts);
    GP.markCurrentRows();
    box.scrollTop = scroll;
  }

  async function load(force = false) {
    if (loading) return;
    loading = true;
    render();
    try {
      data = await api.recommend.get(force);
      loadedOnce = true;
    } catch (err) {
      GP.log('warn', 'Loading recommendations failed', { error: String(err.message || err) });
      data = { seeds: 0, sections: [], errors: ['unknown'] };
    }
    loading = false;
    render();
  }

  const previous = GP.onTab;
  GP.onTab = (name) => {
    if (previous) previous(name);
    if (name === 'home') {
      if (!loadedOnce) load();
      else render();
    }
  };
  // new listening changes the picture: the next visit to Home asks again (the main process caches for a while)
  const prevHistory = GP.onHistoryChanged;
  GP.onHistoryChanged = () => {
    if (prevHistory) prevHistory();
    loadedOnce = false;
  };

  GP.showTab('home'); // Home is the first page
})();
