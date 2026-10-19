// What's new: release notes from GitHub (rendered HTML), with the bundled CHANGELOG.md as the offline fallback.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as logger from './logger.js';
import { fetchPublishedReleases, repoFromPackage, compareVersions } from './releases.js';
import { prereleasesAllowed } from './updater.js';

const TTL = 10 * 60 * 1000;
let cache = null; // { at, data }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

// Minimal Markdown (### headings, - lists, paragraphs) for our own CHANGELOG.md
function markdownToHtml(md) {
  const out = [];
  let list = false;
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{3,6})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<h3>${inline(h[2])}</h3>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (line.trim() === '' || line.trim() === '---') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

function bundledReleases() {
  const file = path.join(app.getAppPath(), 'CHANGELOG.md');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*$/);
    if (m) {
      cur = { version: m[1], lines: [] };
      sections.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return sections
    .map((s) => ({ version: s.version, name: `v${s.version}`, date: null, url: '', html: markdownToHtml(s.lines.join('\n')) }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

export async function getChangelog(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return { ...cache.data, allowPrerelease: prereleasesAllowed() };
  const installed = app.getVersion();
  let data;
  try {
    const cfg = repoFromPackage();
    if (!cfg) throw new Error('No GitHub repository in package.json');
    const releases = await fetchPublishedReleases(cfg, { html: true, prerelease: true });
    if (!releases.length) throw new Error('No published releases');
    data = { source: 'github', installed, releases, allowPrerelease: prereleasesAllowed() };
  } catch (err) {
    logger.info('update', `Release notes from GitHub unavailable (${err.message}), using the bundled changelog`);
    try {
      data = { source: 'bundled', installed, releases: bundledReleases() };
    } catch (e) {
      logger.warn('update', 'Bundled changelog unreadable', e);
      data = { source: 'none', installed, releases: [] };
    }
  }
  cache = { at: Date.now(), data };
  return { ...data, allowPrerelease: prereleasesAllowed() };
}
