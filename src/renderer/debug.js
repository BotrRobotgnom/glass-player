(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const t = window.t;
  const MAX_ROWS = 5000;

  // The log window shares its origin with the player, so it can read the player's theme.
  try {
    const theme = JSON.parse(localStorage.getItem('gp.theme'));
    if (theme === 'silver' || theme === 'graphite') document.documentElement.dataset.theme = theme;
  } catch {
    /* default theme */
  }

  const els = {
    log: $('#log'), search: $('#search'), levels: $('#levels'), source: $('#source'),
    autoscroll: $('#autoscroll'), wrap: $('#wrap'), count: $('#count'), note: $('#note'),
    copy: $('#btnCopy'), clear: $('#btnClear'), file: $('#btnFile'),
  };

  let all = [];
  let lastId = 0;
  const enabledLevels = new Set(['debug', 'info', 'warn', 'error']);
  const sources = new Set();
  let query = [];
  let sourceFilter = '';

  // ---------- Formatting ----------
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function clock(ms) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }
  function prettyData(data) {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  function toLine(e) {
    return `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.source}: ${e.message}${e.data ? ' ' + e.data : ''}`;
  }

  // ---------- Filtering ----------
  function matches(e) {
    if (!enabledLevels.has(e.level)) return false;
    if (sourceFilter && e.source !== sourceFilter) return false;
    if (query.length) {
      const hay = (e.source + ' ' + e.level + ' ' + e.message + ' ' + (e.data || '')).toLowerCase();
      for (const word of query) if (!hay.includes(word)) return false;
    }
    return true;
  }

  // ---------- Rendering ----------
  function makeRow(e) {
    const row = document.createElement('div');
    row.className = 'row lv-' + e.level;
    row.dataset.id = String(e.id);

    const time = document.createElement('span');
    time.className = 't';
    time.textContent = clock(e.t);
    const lv = document.createElement('span');
    lv.className = 'lv';
    lv.textContent = e.level.toUpperCase();
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = e.source;
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = e.message;
    row.append(time, lv, src, msg);

    if (e.data) {
      row.classList.add('has-data');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = '{…}';
      msg.append(' ', mark);
      const pre = document.createElement('pre');
      pre.className = 'data';
      pre.textContent = prettyData(e.data);
      row.appendChild(pre);
      row.addEventListener('click', (ev) => {
        // do not toggle while the user is selecting text
        if (String(window.getSelection()).length) return;
        row.classList.toggle('open');
        ev.stopPropagation();
      });
    }
    return row;
  }

  function updateCount() {
    const shown = els.log.childElementCount;
    els.count.textContent = t('debug.count', { shown, total: all.length });
  }

  function scrollToEnd() {
    if (els.autoscroll.checked) els.log.scrollTop = els.log.scrollHeight;
  }

  function renderAll() {
    const frag = document.createDocumentFragment();
    for (const e of all) if (matches(e)) frag.appendChild(makeRow(e));
    els.log.replaceChildren(frag);
    if (!els.log.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = all.length ? t('debug.noMatch') : t('debug.empty');
      els.log.appendChild(empty);
      els.count.textContent = t('debug.count', { shown: 0, total: all.length });
      return;
    }
    updateCount();
    scrollToEnd();
  }

  function refreshSources(source) {
    if (sources.has(source)) return;
    sources.add(source);
    const opt = document.createElement('option');
    opt.value = source;
    opt.textContent = source;
    els.source.appendChild(opt);
  }

  function addEntry(e) {
    if (e.id <= lastId) return; // already loaded through getAll()
    lastId = e.id;
    all.push(e);
    refreshSources(e.source);
    if (all.length > MAX_ROWS) all.splice(0, all.length - MAX_ROWS);
    if (!matches(e)) {
      updateCount();
      return;
    }
    const empty = els.log.querySelector('.empty');
    if (empty) empty.remove();
    els.log.appendChild(makeRow(e));
    while (els.log.childElementCount > MAX_ROWS) els.log.firstElementChild.remove();
    updateCount();
    scrollToEnd();
  }

  // ---------- Actions ----------
  let noteTimer = null;
  function note(text) {
    els.note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (els.note.textContent = ''), 2500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  els.copy.addEventListener('click', async () => {
    const lines = all.filter(matches).map(toLine);
    if (!lines.length) return;
    const ok = await copyText(lines.join('\n'));
    note(ok ? t('debug.copied', { count: lines.length }) : t('debug.copyFailed'));
  });

  els.clear.addEventListener('click', async () => {
    await window.debugApi.clear();
    all = [];
    renderAll();
    note(t('debug.cleared'));
  });

  els.file.addEventListener('click', () => window.debugApi.showFile());

  els.search.addEventListener('input', () => {
    query = els.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    renderAll();
  });

  els.levels.querySelectorAll('.lvl').forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = btn.dataset.level;
      if (enabledLevels.has(level)) enabledLevels.delete(level);
      else enabledLevels.add(level);
      btn.classList.toggle('on', enabledLevels.has(level));
      renderAll();
    });
  });

  els.source.addEventListener('change', () => {
    sourceFilter = els.source.value;
    renderAll();
  });

  els.wrap.addEventListener('change', () => els.log.classList.toggle('wrap', els.wrap.checked));
  els.autoscroll.addEventListener('change', scrollToEnd);

  // Stop auto-scroll when the user scrolls up; turn it back on with the checkbox
  els.log.addEventListener('wheel', (e) => {
    if (e.deltaY < 0 && els.autoscroll.checked) els.autoscroll.checked = false;
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
      e.preventDefault();
      els.search.focus();
      els.search.select();
    }
  });

  // ---------- Start ----------
  window.debugApi.onEvent((event) => {
    if (event.type === 'entry') addEntry(event.entry);
    else if (event.type === 'clear') {
      all = [];
      renderAll();
    }
  });

  window.i18n.apply();
  window.debugApi
    .getAll()
    .then((list) => {
      for (const e of list) {
        lastId = Math.max(lastId, e.id);
        all.push(e);
        refreshSources(e.source);
      }
      renderAll();
    })
    .catch(() => renderAll());
})();
