// Home: recommendations based on the local listening history (built in the main process, see main/recommend.js)
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

  function render() {
    const scroll = box.scrollTop;
    const parts = [toolbar()];
    if (loading && !data) {
      parts.push(GP.emptyMessage(t('home.loading')));
    } else if (!data || !data.sections.length) {
      parts.push(GP.emptyMessage(t(data && data.errors.length ? 'home.failed' : 'home.empty')));
    } else {
      if (!data.seeds) parts.push(el('div', 'home-hint', t('home.noHistory')));
      for (const s of data.sections) {
        parts.push(GP.groupTitle(sectionTitle(s)));
        for (const track of s.tracks) {
          parts.push(
            GP.makeRow(track, {
              onPlay: () => GP.playFrom(s.tracks, track),
              actions: [{ icon: 'i-plus', title: t('row.addToQueue'), onClick: () => GP.addToQueue(track) }, GP.playlistAction(track)],
            }),
          );
        }
      }
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
