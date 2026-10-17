// The small player shown when the tray icon is clicked: track, a progress line and horizontal controls
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.trayApi;
  const fmt = (s) => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  let dur = 0;

  api.onState((s) => {
    document.documentElement.dataset.theme = s.theme === 'graphite' ? 'graphite' : 'silver';
    const L = s.labels || {};
    $('title').textContent = s.hasTrack ? s.title : L.nothing || 'Nothing playing';
    $('artist').textContent = s.hasTrack ? s.artist : '';
    $('cover').style.backgroundImage = s.cover ? `url("${String(s.cover).replace(/"/g, '%22')}")` : '';
    dur = s.dur || 0;
    $('fill').style.width = dur ? Math.min(100, (s.cur / dur) * 100) + '%' : '0';
    $('cur').textContent = fmt(s.cur);
    $('dur').textContent = dur ? fmt(dur) : '';
    $('iPlay').classList.toggle('hidden', !!s.playing);
    $('iPause').classList.toggle('hidden', !s.playing);
    for (const id of ['prev', 'toggle', 'next']) $(id).disabled = !s.hasTrack;
    $('prev').title = L.prev || '';
    $('next').title = L.next || '';
    $('toggle').title = (s.playing ? L.pause : L.play) || '';
    $('open').title = L.show || '';
  });

  $('prev').addEventListener('click', () => api.command('prev'));
  $('next').addEventListener('click', () => api.command('next'));
  $('toggle').addEventListener('click', () => api.command('toggle'));
  $('open').addEventListener('click', () => api.open());
  $('bar').addEventListener('click', (e) => {
    if (!dur) return;
    const r = $('bar').getBoundingClientRect();
    api.command({ type: 'seek', fraction: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
  });
  api.ready();
})();
