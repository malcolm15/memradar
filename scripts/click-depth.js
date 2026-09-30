// Shortest click depth from the homepage to any page, FOOTER EXCLUDED.
//
// WHAT IT MEASURES. A breadth-first walk of the built site starting at
// frontend/index.html, following only links that appear BEFORE `<footer`.
// Footer links are cut deliberately: they are duplicated boilerplate on every
// page, a crawler discounts them, and counting them makes every page look one
// click from everywhere. What is left is the path a reader or a crawler
// actually has to follow through the content.
//
// WHY IT EXISTS. On 2026-09-30 Search Console reported /guides/should-i-buy-
// ram-now/, /guides/should-i-buy-an-ssd-now/ and /glossary/ as "Discovered,
// not crawled". This measurement found the reason in one run: both guides sat
// at depth 2, and /glossary/ and /guides/ were UNREACHABLE, their only links
// being 262 copies of the same footer anchor. Nothing else on the site would
// have reported that, because every one of those pages was linked, just not
// from anywhere that counts.
//
// RUN IT AFTER ANY NAV, FOOTER OR HOMEPAGE CHANGE, and after adding a page:
//
//   node scripts/click-depth.js                  # the four pages that have bitten us
//   node scripts/click-depth.js /some/path/      # any paths you name
//   node scripts/click-depth.js --all            # every page in the sitemap, deepest first
//
// Read-only: it touches nothing but the built HTML under frontend/.
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const MAX_DEPTH = 8;
// The four this was written for. A regression on any of them is the signal.
const WATCHED = ['/guides/should-i-buy-ram-now/', '/guides/should-i-buy-an-ssd-now/', '/glossary/', '/guides/'];

function fileFor(url) {
  if (!url.startsWith('/')) return null;
  const clean = url.split('#')[0].split('?')[0];
  const p = clean.endsWith('/') ? path.join(FRONTEND, clean, 'index.html') : path.join(FRONTEND, clean);
  return p.endsWith('.html') && fs.existsSync(p) ? p : null;
}

function linksFrom(url) {
  const file = fileFor(url);
  if (!file) return [];
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  // THE WHOLE POINT: everything from <footer onward is discarded.
  const footer = html.indexOf('<footer');
  if (footer > 0) html = html.slice(0, footer);
  const out = new Set();
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const u = m[1];
    if (u.endsWith('/') || u.endsWith('.html')) out.add(u);
  }
  return [...out];
}

function depths() {
  const seen = new Map([['/', 0]]);
  const queue = ['/'];
  while (queue.length) {
    const url = queue.shift();
    const d = seen.get(url);
    if (d >= MAX_DEPTH) continue;
    for (const next of linksFrom(url)) {
      if (seen.has(next)) continue;
      seen.set(next, d + 1);
      queue.push(next);
    }
  }
  return seen;
}

const args = process.argv.slice(2);
const seen = depths();
console.log('\nClick depth from the homepage, body and nav links only, footer excluded.\n');

if (args.includes('--all')) {
  const sitemap = fs.readFileSync(path.join(FRONTEND, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>https:\/\/memradar\.com([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
  const rows = urls.map((u) => [u, seen.has(u) ? seen.get(u) : Infinity]);
  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const unreachable = rows.filter((r) => r[1] === Infinity);
  for (const [u, d] of rows.slice(0, 40)) console.log(`  ${String(d === Infinity ? 'UNREACHABLE' : d).padStart(11)}  ${u}`);
  if (rows.length > 40) console.log(`  ... ${rows.length - 40} more`);
  console.log(`\n  ${rows.length} sitemap URLs, ${unreachable.length} unreachable without the footer.\n`);
  process.exit(unreachable.length ? 1 : 0);
}

const targets = args.length ? args : WATCHED;
let bad = 0;
for (const t of targets) {
  const d = seen.has(t) ? seen.get(t) : null;
  if (d === null) bad++;
  console.log(`  ${String(d === null ? 'UNREACHABLE' : d).padStart(11)}  ${t}`);
}
console.log('');
// Nonzero when something is unreachable, so this can gate a check later.
process.exit(bad ? 1 : 0);
