// Truthful "pages_changed" for the daily regeneration summary.
//
// WHY NOT `git status --porcelain frontend/`: that counts every dirty file,
// including ones dirty ONLY because the shared ?v= stamp moved, which
// contentHash deliberately normalises away. The lastmod manifest is the
// project's definition of "content actually moved", so the summary should
// count from it rather than from the working tree.
//
// This does NOT make quiet days commit-free, and it is not meant to. Guides
// and the Price Index print their own build date, contentHash does not
// normalise it, and the printed date must stay true - so those pages change
// every day BY DESIGN. A literal no-op day is impossible while the page
// tells the reader when it was last regenerated. See CLAUDE.md.
//
// Usage: node scripts/count-content-changes.js [--verbose]
//   stdout: a single integer (the count), so the workflow can capture it
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, 'lastmod-manifest.json');
const VERBOSE = process.argv.includes('--verbose');

function previousManifest() {
  try {
    return JSON.parse(execSync('git show HEAD:scripts/lastmod-manifest.json', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    return null; // no HEAD copy (first run): treat every entry as new
  }
}

const next = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const prev = previousManifest();

const added = [], changed = [];
for (const [url, entry] of Object.entries(next)) {
  const before = prev && prev[url];
  if (!before) added.push(url);
  else if (before.hash !== entry.hash) changed.push(url);
}
const removed = prev ? Object.keys(prev).filter((u) => !next[u]) : [];

// A mass DELETION must never hide behind a healthy-looking change count. The
// 2026-08-26 incident reported "237 pages changed" while it was in fact
// removing 151 live pages, because the count came from `git status`, where a
// delete and an edit look identical. Removals are now called out separately
// and always, verbose or not.
if (removed.length) {
  console.error(`WARNING: ${removed.length} page(s) present at HEAD are absent from this build:`);
  removed.slice(0, 20).forEach((u) => console.error('   REMOVED ' + u));
  if (removed.length > 20) console.error(`   ... and ${removed.length - 20} more`);
}

if (VERBOSE) {
  const line = (label, arr) => {
    console.error(`${label}: ${arr.length}`);
    arr.slice(0, 12).forEach((u) => console.error('   ' + u));
    if (arr.length > 12) console.error(`   ... and ${arr.length - 12} more`);
  };
  line('new', added);
  line('content changed', changed);
  line('removed', removed);
}
process.stdout.write(String(added.length + changed.length));
