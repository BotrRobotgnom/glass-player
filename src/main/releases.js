// Published GitHub releases (drafts are invisible to the app on purpose; pre-releases only when asked for).
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export const isSemver = (tag) => /^v?\d+\.\d+\.\d+$/.test(String(tag || ''));
const parts = (v) => String(v).replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);

// > 0 when a is newer than b
export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// owner/repo from package.json ("repository": ".../OWNER/REPO.git"), so it also works when running from source
export function repoFromPackage() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const m = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.#]+)/i);
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch {
    return null;
  }
}

// Newest first. `html: true` asks GitHub for the notes already rendered (body_html).
export async function fetchPublishedReleases(cfg, { html = false, limit = 30, prerelease = false } = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/releases?per_page=${limit}`, {
    headers: {
      Accept: html ? 'application/vnd.github.full+json' : 'application/vnd.github+json',
      'User-Agent': 'glass-player',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
  const list = await res.json();
  return list
    .filter((r) => !r.draft && (prerelease || !r.prerelease) && isSemver(r.tag_name)) // also skips stray "untagged-…" releases
    .map((r) => ({
      version: String(r.tag_name).replace(/^v/i, ''),
      name: r.name || r.tag_name,
      date: r.published_at || r.created_at || null,
      url: r.html_url,
      prerelease: !!r.prerelease,
      html: html ? r.body_html || '' : '',
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
}
