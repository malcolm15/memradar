// ONE-TIME LAUNCH BACKFILL of scripts/price-index-monthly-archive.json.
//
// Builds all 96 records (24 closed months from 2024-10 to 2026-09, four
// segments) and marks every one `reconstructed: true`, because none of them was
// written while its month was current. From the next month onward the freeze in
// scripts/generate-product-pages.js appends one month at a time with
// `reconstructed: false`.
//
// SAFETY: dry run by default. It reads price_history and products, prints the
// records it would write and every assertion, and writes nothing unless you
// pass --write. It writes ONLY the archive file; it touches no database.
//
// THE TIMESTAMP IS AN ARGUMENT, NOT A CLOCK READ. --at is required, so a
// determinism proof can pass the same value twice and compare byte for byte
// rather than normalising timestamps away. For the real write, pass the real
// time once.
//
// generated_commit MUST CONTAIN THE CODE THAT PRODUCED THE RECORDS, and this
// script enforces that rather than trusting the operator to check. Before a
// --write it walks its own local require graph (every module it executes,
// directly or transitively) and refuses if any file is untracked or modified:
// a record stamped with a commit that lacks the metric module is a record
// nobody can reproduce from that commit. The first launch archive was written
// with exactly that defect, generated_commit f2a7d7d02 naming a commit from
// before any of this code existed, which is why the guard is here.
//
// THE A6 CAVEAT DATE COMES FROM GIT, NOT FROM A LITERAL. The archive's
// missing-ASIN caveat names the UTC day the missing-ASIN logging code was
// committed to backend/lib/priceFetch.js. The commit is found with
// `git log -S missingFromKeepa` and its committer timestamp is converted to UTC
// (TZ=UTC with --date=format-local), not taken from %cs, which is the
// committer's local zone and would disagree with every other date in the file
// for a commit made in the Pacific evening. It cannot be a guessed or
// pre-commit date; with that change uncommitted the dry run says so and
// --write refuses.
//
// Usage:
//   node scripts/build-price-index-archive.js --at=2026-10-08T12:00:00Z
//   node scripts/build-price-index-archive.js --at=<iso> --write
//   node scripts/build-price-index-archive.js --at=<iso> --csv=/tmp/series.csv
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const supabase = require('../backend/lib/supabase');
const PY = require('../backend/lib/pairedYoy');
const A = require('../backend/lib/priceIndexArchive');

const REPO = path.join(__dirname, '..');
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, TZ: 'UTC' },
    }).trim();
  } catch { return null; }
}

// The FIRST commit whose diff introduced `needle` into `file`: --reverse puts
// the oldest match first. For missingFromKeepa in priceFetch.js that is the A6
// commit, and nothing else has ever added that identifier to that file. Its
// date is the committer timestamp rendered in UTC: format-local renders in the
// TZ of the git process, which git() pins to UTC.
function commitOfChange(needle, file) {
  const out = git('log', '--reverse', '--format=%H', '-S', needle, '--', file);
  return out ? out.split('\n')[0] : null;
}
function utcCommitDate(sha) {
  return sha ? git('log', '-1', '--format=%cd', '--date=format-local:%Y-%m-%d', sha) : null;
}

// Every local module this script executes, found by walking require() calls
// whose path starts with a dot. External packages are not local inputs; the
// lockfile pins those.
function localRequireGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let src;
    try { src = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/require\((["'])(\.[^"']+)\1\)/g)) {
      let p = path.normalize(path.join(path.dirname(f), m[2]));
      if (!/\.(js|json)$/.test(p)) p += '.js';
      queue.push(p);
    }
  }
  return [...seen].sort();
}

// A file is a clean input when git tracks it AND reports no change to it.
function inputState(file) {
  const tracked = git('ls-files', '--error-unmatch', '--', file) != null;
  const status = git('status', '--porcelain', '--', file);
  if (!tracked) return 'UNTRACKED';
  if (status) return `MODIFIED (${status.slice(0, 2).trim()})`;
  return 'clean';
}

const ARGV = process.argv.slice(2);
const arg = (name) => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const WRITE = ARGV.includes('--write');
const AT = arg('at');
const CSV_OUT = arg('csv');

const FIRST_MONTH = '2024-10';
const LAST_MONTH = '2026-09';

const log = (m) => console.log(`[archive] ${m}`);

if (!AT || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(AT)) {
  console.error('build-price-index-archive: --at=<ISO instant, e.g. 2026-10-08T12:00:00Z> is required.');
  console.error('It is an argument rather than a clock read so two runs can be compared byte for byte.');
  process.exit(2);
}
const unknown = ARGV.filter((a) => !/^--(write|at=|csv=)/.test(a));
if (unknown.length) {
  console.error(`build-price-index-archive: unrecognised arguments: ${unknown.join(' ')}`);
  process.exit(2);
}

async function selectPaged(build, label) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  log(`${label}: ${rows.length} rows`);
  return rows;
}

function monthsBetween(a, b) {
  const out = [];
  for (let m = a; m <= b; m = PY.addMonths(m, 1)) out.push(m);
  return out;
}

async function run() {
  log(`started${WRITE ? ' (WRITE)' : ' (DRY RUN: nothing written, pass --write)'} at=${AT}`);
  const commit = A.commitLabel();
  log(`generated_commit = ${commit} (the checked-out HEAD, which is the code and rules that produced these records)`);
  if (!commit) throw new Error('git could not report HEAD, so generated_commit would be unknown; refusing');

  // ---------------------------------------------- are the inputs committed?
  const inputs = localRequireGraph(path.relative(REPO, __filename));
  const states = inputs.map((f) => [f, inputState(f)]);
  log(`builder inputs (${inputs.length} local files in the require graph):`);
  for (const [f, st] of states) log(`  ${st === 'clean' ? 'ok ' : '!! '} ${f.padEnd(46)} ${st}`);
  const dirty = states.filter(([, st]) => st !== 'clean');
  if (dirty.length) {
    const msg = `${dirty.length} builder input(s) are not committed at ${commit}, so generated_commit would be untrue`;
    if (WRITE) throw new Error(`${msg}; refusing to write. Commit them first.`);
    log(`⚠ ${msg}. A dry run continues; --write would refuse.`);
  } else {
    log(`ASSERT every builder input is committed and clean at ${commit}: pass`);
  }

  // ------------------------------------------------ the A6 caveat's date
  const a6Sha = commitOfChange('missingFromKeepa', 'backend/lib/priceFetch.js');
  const a6Date = utcCommitDate(a6Sha);
  if (a6Date) {
    log(`missing-ASIN logging code committed in ${a6Sha.slice(0, 9)} on ${a6Date} (committer timestamp, UTC)`);
  } else if (WRITE) {
    throw new Error('the missing-ASIN log is not committed to backend/lib/priceFetch.js, so the caveat has no commit date; refusing to write');
  } else {
    log('⚠ the missing-ASIN log is not committed yet; the caveat will read "not yet known" and --write would refuse');
  }

  const products = await selectPaged(() =>
    supabase.from('products').select('id, sku, name, category').eq('retailer', 'amazon').order('id'), 'products');
  const rows = await selectPaged(() =>
    supabase.from('price_history').select('id, product_id, price, in_stock, fetched_at').order('id'), 'price_history');

  // THE CUTOFF IS APPLIED HERE, not inside the metric: a record for month M may
  // only see rows at or before 23:59:59Z on M's last day. For the launch
  // backfill every month is long closed, so this changes nothing today; it is
  // what makes the record independent of when it was built.
  const lastCutoff = PY.monthCutoffIso(LAST_MONTH);
  const inScope = rows.filter((r) => r.fetched_at <= lastCutoff);
  log(`rows at or before the ${LAST_MONTH} cutoff (${lastCutoff}): ${inScope.length} of ${rows.length}`);

  const index = PY.buildIndex({ products, rows: inScope });
  const months = monthsBetween(FIRST_MONTH, LAST_MONTH);
  log(`building ${months.length} months x ${PY.SEGMENTS.length} segments = ${months.length * PY.SEGMENTS.length} records`);

  const archive = A.emptyArchive({ at: AT, commit, missingAsinLoggedOn: a6Date });
  for (const month of months) {
    for (const segment of PY.SEGMENTS) {
      const rec = A.buildRecord({ index, segment, month, at: AT, reconstructed: true, commit });
      archive.records[A.recordKey(segment, month)] = rec;
    }
  }

  // ------------------------------------------------------------- assertions
  const want = months.length * PY.SEGMENTS.length;
  const summary = A.assertArchive(archive, { expectRecords: want });
  log(`ASSERT exactly ${want} records: ${summary.records} present`);
  log(`ASSERT (month, segment) keys unique: pass (${summary.records} distinct keys)`);
  log(`ASSERT every month carries all four segments with identical metadata: pass (${summary.months} months)`);
  log(`ASSERT corrections[] valid: pass (${summary.corrections} entries; version 1 accepts inline replacement records only)`);
  const allReconstructed = Object.values(archive.records).every((r) => r.reconstructed === true);
  if (!allReconstructed) throw new Error('every launch record must be reconstructed: true');
  log('ASSERT reconstructed: true on every launch record: pass');
  const allFrozenAt = new Set(Object.values(archive.records).map((r) => r.frozen_at));
  if (allFrozenAt.size !== 1 || !allFrozenAt.has(AT)) throw new Error('frozen_at must be the single passed timestamp');
  log(`ASSERT frozen_at == --at on every record: pass (${AT})`);
  if (archive.records['ddr5|2026-09'].rule.no_offer_live !== A.NO_OFFER_LIVE) throw new Error('no_offer_live text drifted');
  log(`ASSERT no_offer_live text is the agreed wording: pass (${A.NO_OFFER_LIVE.length} chars)`);

  // -------------------------------------------------------------- the table
  console.log('\n2026-09 records (the figures Phase 1 settled):');
  console.log('segment   |  n | median    |   p25     |   p75     | rose  | LOO low   | LOO high  | middle pair');
  for (const seg of PY.SEGMENTS) {
    const r = archive.records[A.recordKey(seg, LAST_MONTH)];
    const f = (v) => (v == null ? '  n/a' : (v >= 0 ? '+' : '') + v.toFixed(2));
    const mp = r.middle_pair ? `${r.middle_pair.sku} $${r.middle_pair.base_price.toFixed(2)} -> $${r.middle_pair.current_price.toFixed(2)}` : 'none (even n)';
    console.log(`${seg.padEnd(9)} | ${String(r.n).padStart(2)} | ${f(r.median).padStart(9)}% | ${f(r.p25).padStart(9)}% | ${f(r.p75).padStart(9)}% | ${String(r.rose_share.toFixed(0)).padStart(4)}% | ${f(r.loo_low).padStart(9)}% | ${f(r.loo_high).padStart(9)}% | ${mp}`);
  }

  console.log('\nall 96 records, n and median:');
  console.log('month   | ' + PY.SEGMENTS.map((s) => s.padEnd(17)).join('| '));
  for (const month of months) {
    const cells = PY.SEGMENTS.map((seg) => {
      const r = archive.records[A.recordKey(seg, month)];
      const med = r.median == null ? 'n/a' : (r.median >= 0 ? '+' : '') + r.median.toFixed(2) + '%';
      return `${String(r.n).padStart(3)}  ${med.padStart(10)}`.padEnd(17);
    });
    console.log(`${month} | ${cells.join('| ')}`);
  }

  const pairTotal = Object.values(archive.records).reduce((a, r) => a + r.pairs.length, 0);
  const bytes = Buffer.byteLength(A.serialise(archive));
  console.log(`\npairs across all records: ${pairTotal}`);
  console.log(`serialised size: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);

  if (CSV_OUT) {
    const lines = ['segment,month,base_month,n,median_pct,p25_pct,p75_pct,rose_share_pct,loo_low_pct,loo_high_pct,middle_pair_sku'];
    for (const seg of PY.SEGMENTS) {
      for (const month of months) {
        const r = archive.records[A.recordKey(seg, month)];
        const two = (v) => (v == null ? '' : v.toFixed(2));
        lines.push([seg, month, r.base_month, r.n, two(r.median), two(r.p25), two(r.p75), two(r.rose_share), two(r.loo_low), two(r.loo_high), r.middle_pair ? r.middle_pair.sku : ''].join(','));
      }
    }
    fs.writeFileSync(CSV_OUT, lines.join('\n') + '\n');
    log(`wrote ${CSV_OUT} (${lines.length - 1} data rows) for comparison against the Phase 1 series`);
  }

  if (!WRITE) {
    log('DRY RUN complete. Nothing was written. Re-run with --write to create the archive.');
    return;
  }
  const existing = A.readArchive();
  if (existing) {
    throw new Error(`${A.ARCHIVE_PATH} already exists. This is the ONE-TIME launch backfill and it will not overwrite `
      + 'a file that may already hold frozen records; the monthly freeze in the generator is the only other writer.');
  }
  A.writeArchive(archive);
  log(`WROTE ${A.ARCHIVE_PATH} (${bytes} bytes, ${summary.records} records)`);
}

run().catch((err) => {
  console.error(`[archive] FAILED: ${err.message}`);
  process.exit(1);
});
