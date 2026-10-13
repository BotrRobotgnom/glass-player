// Builds the text of a GitHub release from CHANGELOG.md.
//
//   node scripts/release-notes.mjs v0.1.0 [--published "v0.0.1,v0.0.3"] [--changelog CHANGELOG.md]
//
// The notes contain the section of the released version. If earlier versions were never published
// (--published lists the tags that were), their sections are added below, so a user who jumps from
// 0.0.1 straight to 0.1.0 still reads everything that changed. With no published release at all
// (the very first release) every section up to this version is included.
import fs from 'node:fs';

const args = process.argv.slice(2);
const tag = args.find((a) => !a.startsWith('--'));
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!tag) {
  console.error('Usage: node scripts/release-notes.mjs <tag> [--published "v0.0.1,v0.0.2"] [--changelog file]');
  process.exit(2);
}

const parse = (v) => String(v).trim().replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
const cmp = (a, b) => {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// ## 1.2.3 headings split the file into sections
function readSections(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*$/);
    if (m) {
      current = { version: m[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((s) => ({ version: s.version, body: s.lines.join('\n').trim() }));
}

const demote = (md, levels) => md.replace(/^(#{1,5})\s/gm, (_, h) => '#'.repeat(Math.min(6, h.length + levels)) + ' ');

const version = tag.replace(/^v/i, '');
const sections = readSections(opt('changelog') || 'CHANGELOG.md');
const own = sections.find((s) => s.version === version);

if (!own || !own.body) {
  console.error(`::warning::CHANGELOG.md has no entry for ${version}`);
  console.log('No changelog entry for this version.');
  process.exit(0);
}

// Latest published version below this one (none for the first release)
const published = (opt('published') || '')
  .split(/[\s,]+/)
  .filter((t) => /^v?\d+\.\d+\.\d+$/.test(t))
  .filter((t) => cmp(t, version) < 0)
  .sort(cmp);
const previous = published.length ? published[published.length - 1] : null;

const skipped = sections
  .filter((s) => cmp(s.version, version) < 0 && (!previous || cmp(s.version, previous) > 0) && s.body)
  .sort((a, b) => cmp(b.version, a.version));

let out = own.body;
if (skipped.length) {
  out += '\n\n---\n\n## ' + (previous ? `Also included since ${previous.replace(/^v?/, 'v')}` : 'Earlier versions') + '\n';
  out += previous
    ? '\nThese versions were not published separately.\n'
    : '\nThe first public release also contains everything below.\n';
  for (const s of skipped) out += `\n### ${s.version}\n\n${demote(s.body, 2)}\n`;
}

console.log(out.trim());
