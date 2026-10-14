// "What's new": release notes in our own layout (newer versions on top, the installed one marked,
// older ones folded). Opens by itself when an update is found, or from Settings > Changelog.
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

  const root = $('#changelog');
  const body = $('#clBody');
  const sub = $('#clSub');
  const note = $('#clNote');
  const btnUpdate = $('#clUpdate');
  const btnSkip = $('#clSkip');

  let open = false;
  let data = null;
  let reason = 'browse';

  const cmp = (a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };

  // ---------- Safe HTML ----------
  // The notes come from GitHub (already sanitised there), but we only keep a small set of harmless tags anyway.
  const ALLOWED = new Set(
    'a b blockquote br code del details div em h1 h2 h3 h4 h5 h6 hr i img kbd li ol p picture pre s source span strong sub summary sup table tbody td th thead tr ul video'.split(' '),
  );
  const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'svg', 'math', 'base']);
  const ATTRS = {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    video: ['src', 'controls', 'poster', 'muted', 'loop', 'width', 'height'],
    source: ['src', 'type'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  };

  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      const tag = child.tagName.toLowerCase();
      if (DROP.has(tag)) {
        child.remove();
        continue;
      }
      if (!ALLOWED.has(tag)) {
        clean(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        if (!(ATTRS[tag] || []).includes(name)) child.removeAttribute(attr.name);
        else if (['href', 'src', 'poster'].includes(name) && !/^https:\/\//i.test(attr.value.trim())) child.removeAttribute(attr.name);
      }
      if (tag === 'a') {
        if (!child.getAttribute('href')) {
          clean(child);
          child.replaceWith(...child.childNodes); // GitHub's "#anchor" links
          continue;
        }
        child.setAttribute('rel', 'noreferrer noopener');
        child.setAttribute('target', '_blank');
      }
      if (tag === 'img') {
        child.setAttribute('referrerpolicy', 'no-referrer');
        child.setAttribute('loading', 'lazy');
      }
      if (tag === 'video') child.setAttribute('preload', 'metadata');
      clean(child);
    }
  }

  function safeHtml(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    clean(doc.body);
    return doc.body.innerHTML;
  }

  // ---------- Rendering ----------
  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { dateStyle: 'medium' }).format(new Date(iso));
    } catch {
      return '';
    }
  }

  function releaseCard(rel, state) {
    const card = el('details', 'cl-rel' + (state === 'new' ? ' is-new' : ''));
    card.open = state === 'new' || state === 'open';
    const head = el('summary', 'cl-rel-head');
    head.appendChild(el('span', 'cl-ver', 'v' + rel.version));
    if (state === 'new') head.appendChild(el('span', 'cl-badge new', t('changelog.new')));
    if (state === 'current' || state === 'open') head.appendChild(el('span', 'cl-badge', t('changelog.installed')));
    head.appendChild(el('span', 'cl-date', formatDate(rel.date)));
    card.appendChild(head);
    const notes = el('div', 'cl-notes');
    notes.innerHTML = safeHtml(rel.html) || '';
    if (!notes.textContent.trim() && !notes.querySelector('img, video')) notes.textContent = t('changelog.noNotes');
    card.appendChild(notes);
    return card;
  }

  function render() {
    body.replaceChildren();
    if (!data || !data.releases.length) {
      body.appendChild(GP.emptyMessage(t(data ? 'changelog.empty' : 'changelog.loading')));
      return;
    }
    const installed = data.installed;
    const newer = data.releases.filter((r) => cmp(r.version, installed) > 0);
    const rest = data.releases.filter((r) => cmp(r.version, installed) <= 0);
    const latest = data.releases[0].version;

    sub.textContent = newer.length
      ? t('changelog.subUpdate', { latest, installed })
      : data.source === 'github'
        ? t('changelog.upToDate', { version: installed })
        : t('changelog.subAll');
    note.textContent = data.source === 'bundled' ? t('changelog.offline') : '';

    for (const rel of newer) body.appendChild(releaseCard(rel, 'new'));
    if (newer.length) body.appendChild(el('div', 'cl-divider', t('changelog.divider', { version: installed })));
    // with nothing new the installed version is shown open; older ones stay folded
    rest.forEach((rel, i) => {
      const isInstalled = cmp(rel.version, installed) === 0;
      body.appendChild(releaseCard(rel, isInstalled ? (newer.length ? 'current' : 'open') : 'old'));
    });
    if (!rest.some((r) => cmp(r.version, installed) === 0) && !newer.length) sub.textContent = t('changelog.subAll');
  }

  // Buttons follow the update state: Update is only offered when there really is something newer
  function renderButtons() {
    const s = GP.updateState ? GP.updateState() : { status: 'idle' };
    const has = ['downloading', 'downloaded', 'manual'].includes(s.status) && s.version;
    btnUpdate.classList.toggle('hidden', !has);
    btnSkip.classList.toggle('hidden', !has || reason !== 'update');
    if (!has) return;
    btnUpdate.disabled = s.status === 'downloading';
    btnUpdate.textContent =
      s.status === 'downloading'
        ? t('changelog.downloading', { percent: s.percent || 0 })
        : s.status === 'downloaded'
          ? t('update.restart')
          : s.isPortable
            ? t('update.openPage')
            : t('changelog.update');
  }

  async function openChangelog(opts = {}) {
    reason = opts.reason || 'browse';
    open = true;
    data = null;
    root.classList.remove('hidden');
    render();
    renderButtons();
    try {
      data = await api.update.changelog(reason === 'update');
    } catch (err) {
      GP.log('warn', 'Loading the changelog failed', { error: String(err.message || err) });
      data = { source: 'none', installed: '0.0.0', releases: [] };
    }
    if (!open) return;
    render();
    renderButtons();
    body.scrollTop = 0;
  }

  function closeChangelog() {
    open = false;
    root.classList.add('hidden');
  }

  btnUpdate.addEventListener('click', () => {
    GP.installUpdate();
    const s = GP.updateState();
    if (s.status === 'manual') closeChangelog();
  });
  btnSkip.addEventListener('click', () => {
    const s = GP.updateState();
    if (s && s.version) {
      GP.store.set('skipVersion', s.version);
      GP.toast(t('changelog.skipped', { version: s.version }));
    }
    closeChangelog();
  });
  $('#clClose').addEventListener('click', closeChangelog);
  $('#clX').addEventListener('click', closeChangelog);
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) closeChangelog();
  });
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') closeChangelog();
  });

  GP.openChangelog = openChangelog;
  GP.onUpdate = () => {
    if (open) renderButtons();
  };
})();
