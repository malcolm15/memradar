// The Price Index monthly archive: schema, record construction, and the
// integrity rules that guard a frozen figure.
//
// WHY AN ARCHIVE AT ALL. A published monthly figure must not move afterwards,
// and a RULE for recomputing it is not enough to guarantee that, because every
// input can be destroyed or rewritten. scripts/backfill-keepa.js:137 deletes a
// product's whole history before reinserting it; products.id has ON DELETE
// CASCADE at backend/schema.sql:22, so removing one product row destroys its
// price history; re-running scripts/upsert-catalog.js --confirm overwrites all
// 235 names, which is what classifySegment reads. So each record stores its own
// PAIRS, and every published statistic is a function of those pairs alone. A
// reader with the file and the two formulas can reproduce the figure with no
// database at all.
//
// THIS MODULE READS NO CLOCK. `at` is passed in by the caller, once per write.
// A frozen record must not depend on when it was computed, and a determinism
// proof that normalised timestamps away would not be proving anything.
const fs = require('fs');
const path = require('path');
const PY = require('./pairedYoy');
const gitState = require('./gitState');

const ARCHIVE_PATH = path.join(__dirname, '..', '..', 'scripts', 'price-index-monthly-archive.json');
const SCHEMA_VERSION = 1;

const recordKey = (segment, month) => `${segment}|${month}`;

// The published definition, one sentence, as it appears on /methodology/.
const DEFINITION = 'For each product with at least 20 days of price coverage in both months, '
  + 'we take its median daily price in the month and compare it with its own median daily price '
  + 'in the same month a year earlier; the figure is the median of those per-product changes.';

// VERBATIM, and it must stay verbatim: it is the operational definition a
// reader needs in order to reproduce a record, and it names the two different
// mechanisms that mean "no offer" in the two eras.
//
// THE TWO LINE REFERENCES ARE TRUE AT THE COMMIT THAT WRITES THE RECORD, which
// is what generated_commit names. They moved when A6 added the missing-ASIN
// log above the write loop: the no-row-on-no-offer block is :190-205 and the
// fetchedAt stamp is :178. Only the references changed; every other word is
// the agreed wording and the builder asserts it.
const NO_OFFER_LIVE = 'From 2026-07-22, a successful fetch writes one price_history row per in-stock product '
  + 'and no row at all when the product has no offer (backend/lib/priceFetch.js:190-205), so there are zero '
  + 'in_stock=false rows in the live era. A fetch batch is therefore identified by a distinct '
  + 'price_history.fetched_at value, which the fetch stamps once per run and shares across every row it writes '
  + '(backend/lib/priceFetch.js:178). A UTC day on which at least one batch exists and on which the product '
  + 'appears in NONE of that day\'s batches is treated as an observed no-offer day. A day on which the product '
  + 'appears in at least one batch is covered, even if it is absent from another batch the same day. A day with '
  + 'no batch at all is not evidence either way and leaves the carry running. This rule is evaluated from '
  + 'price_history alone and uses no current-state table.';

const NO_OFFER_BACKFILL = 'Before 2026-07-22 the history is a one-time Keepa load whose csv is a change-point '
  + 'series, so a price_history row with in_stock=false marks the START of a no-offer interval that ends at the '
  + 'next in-stock row, not a single bad day (scripts/backfill-keepa.js:45-61).';

// COVERED DAYS, defined here because the number is published and the words
// matter: calendar days that contribute to the carried-forward monthly series
// after no-offer boundaries and the 90-day carry cap have been applied. NOT a
// count of stored observations. Before 2026-07-22 the rows are change points,
// so a month with four rows is a month whose price moved four times.
const COVERED_DAYS_MEANING = 'Calendar days that contribute to the carried-forward monthly series after '
  + 'no-offer boundaries and the 90-day carry cap are applied. Not a count of stored observations: before '
  + '2026-07-22 the stored history is Keepa change points, so a month with four stored rows is a month whose '
  + 'price moved four times, not a month observed four times.';

function ruleBlock() {
  return {
    monthly_price: 'carried_forward_daily_median',
    day_price: 'last reading of the UTC day, the semantics of buildDailySeries at scripts/generate-product-pages.js:819-830',
    carry_cap_days: PY.CARRY_CAP_DAYS,
    min_covered_days: PY.MIN_COVERED_DAYS,
    covered_days_meaning: COVERED_DAYS_MEANING,
    month_boundary: 'UTC',
    cohort_universe: 'all products with history, regardless of present-day page or index state',
    pair_identity: 'the same Amazon ASIN in both months',
    no_offer_backfill: NO_OFFER_BACKFILL,
    no_offer_live: NO_OFFER_LIVE,
    quantile_helper: 'percentile(sorted, p) in backend/lib/stats.js, linear interpolation on (n-1)*p/100',
    median_helper: 'median(xs) in backend/lib/stats.js, even n is the mean of the two middle values',
  };
}

// One record. `at` is the explicit timestamp; `reconstructed` is true when the
// record is created after its month had already ended, which is every record
// written by the one-time launch builder.
function buildRecord({ index, segment, month, at, reconstructed, commit }) {
  const pairs = PY.pairsFor(index, { segment, month });
  const s = PY.statsFor(pairs);
  const baseMonth = PY.addMonths(month, -12);
  return {
    month,
    base_month: baseMonth,
    segment,
    metric_id: PY.METRIC_ID,
    metric_version: PY.METRIC_VERSION,
    data_cutoff: PY.monthCutoffIso(month),
    reconstructed: !!reconstructed,
    frozen_at: at,
    generated_commit: commit,
    rule: ruleBlock(),
    exclusions: {
      relisting_duplicates: [...PY.EXCLUSIONS.relisting_duplicates],
      multi_unit: [...PY.EXCLUSIONS.multi_unit],
      service_bundles: [...PY.EXCLUSIONS.service_bundles],
    },
    n: s ? s.n : 0,
    median: s ? s.median : null,
    p25: s ? s.p25 : null,
    p75: s ? s.p75 : null,
    rose_share: s ? s.rose_share : null,
    loo_low: s ? s.loo_low : null,
    loo_high: s ? s.loo_high : null,
    middle_pair: s ? s.middle_pair : null,
    pairs,
  };
}

// ----------------------------------------------------------- the file itself
//
// `missingAsinLoggedOn` IS A COMMIT DATE REPORTED BY GIT, NEVER A LITERAL. It
// names the UTC day the change that added missingFromKeepa to
// backend/lib/priceFetch.js was committed (the A6 change). The builder finds
// that commit with `git log --reverse -S missingFromKeepa -- backend/lib/priceFetch.js`
// and reads its committer timestamp converted to UTC, matching every other
// date in this file. Null means that change is not committed yet: the caveat
// then says so in words, and writeArchive refuses to write it, so a launch
// archive cannot carry a guessed or pre-commit date.
//
// THE CAVEAT CLAIMS ONLY WHAT THE COMMIT PROVES: when the logging code entered
// the source tree. It does not say when logging first observed a response,
// which happens at the first scheduled price fetch after the push and is not
// something this file can know.
const UNCOMMITTED_SENTINEL = 'not yet known';

function emptyArchive({ at, commit, missingAsinLoggedOn = null }) {
  const a6 = missingAsinLoggedOn;
  if (a6 != null && !/^\d{4}-\d{2}-\d{2}$/.test(a6)) {
    throw new Error(`missingAsinLoggedOn must be a YYYY-MM-DD commit date from git, got ${a6}`);
  }
  const a6Words = a6 || `a date ${UNCOMMITTED_SENTINEL}, because that change is not committed`;
  return {
    schema_version: SCHEMA_VERSION,
    metric_id: PY.METRIC_ID,
    metric_version: PY.METRIC_VERSION,
    definition: DEFINITION,
    generated: at,
    generated_commit: commit,
    note: 'Frozen monthly records for the MemRadar Memory Price Index. APPEND ONLY. A record is '
      + 'written once and never recomputed; a later correction appends to corrections[] and carries its own '
      + 'complete replacement record inline, pairs included. Version 1 supports inline replacement records '
      + 'only. Written by scripts/build-price-index-archive.js (the one-time launch backfill) and by the '
      + 'monthly freeze in scripts/generate-product-pages.js. Do not hand-edit.',
    caveats: [
      'SURVIVORSHIP. The tracked catalogue was assembled on 2026-07-22, so every historical record describes '
        + 'products still sold in July 2026. Products discontinued before then are absent and always will be.',
      'CHANGE POINTS, NOT DAILY READINGS. Before 2026-07-22 the stored history is a one-time Keepa load of '
        + 'price change points. The carried-forward monthly price reconstructs the full month from them; it is a '
        + 'reconstruction, and figures here will not reconcile exactly with the raw-readings monthly CSV.',
      'MISSING-ASIN AMBIGUITY. Before the missing-ASIN logging code was committed to '
        + `backend/lib/priceFetch.js on ${a6Words}, Keepa omitting an ASIN from a response cannot be told apart `
        + 'from a null price in stored data, because both produce an absence in a run that concluded success. '
        + 'Records whose months fall before that date carry that ambiguity. Its measured '
        + 'bound: 203 of 235 products were never absent, 99.3% of absence sat in runs of two or more consecutive '
        + 'batches, and for the one batch where a direct cross-check was possible the absent set and the '
        + 'retailer_offers out-of-stock set matched exactly, 16 of 16.',
    ],
    corrections: [],
    records: {},
  };
}

function readArchive() {
  if (!fs.existsSync(ARCHIVE_PATH)) return null;
  return JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'));
}

// Stable key order so two writes of the same content are byte-identical.
function serialise(archive) {
  const ordered = { ...archive, records: {} };
  for (const k of Object.keys(archive.records).sort()) ordered.records[k] = archive.records[k];
  return JSON.stringify(ordered, null, 1) + '\n';
}

// EVERY WRITE VALIDATES FIRST. The freeze validates on read as well, so this is
// the second line of defence, and the one that catches the builder and any
// future writer.
function writeArchive(archive) {
  assertWritable(archive);
  fs.writeFileSync(ARCHIVE_PATH, serialise(archive));
}

// ------------------------------------------------------- completeness check
//
// THREE STATES, AND THE THIRD IS AN ALARM RATHER THAN A REPAIR. A month is
// eligible to freeze only at 0 of 4. At exactly 4 with consistent metadata it
// is already frozen and skipped. Anything else (1 to 3 records, a duplicate
// key, metadata that disagrees between segments) means something wrote a
// partial month, and the only safe response is to touch nothing and say so: a
// repair would be guessing which of two disagreeing records is the published
// one.
function monthState(archive, month) {
  const present = PY.SEGMENTS.map((seg) => archive.records[recordKey(seg, month)]).filter(Boolean);
  if (present.length === 0) return { state: 'eligible', present: 0 };
  if (present.length !== PY.SEGMENTS.length) {
    return { state: 'alarm', present: present.length, why: `${present.length} of ${PY.SEGMENTS.length} segment records exist for ${month}` };
  }
  const segs = new Set(present.map((r) => r.segment));
  if (segs.size !== PY.SEGMENTS.length) {
    return { state: 'alarm', present: present.length, why: `duplicate segment keys for ${month}: ${[...segs].join(', ')}` };
  }
  const fields = ['metric_id', 'metric_version', 'month', 'base_month'];
  for (const f of fields) {
    const vals = new Set(present.map((r) => String(r[f])));
    if (vals.size !== 1) return { state: 'alarm', present: present.length, why: `${month} records disagree on ${f}: ${[...vals].join(' vs ')}` };
  }
  const ruleHashes = new Set(present.map((r) => JSON.stringify(r.rule)));
  if (ruleHashes.size !== 1) return { state: 'alarm', present: present.length, why: `${month} records disagree on the rule block` };
  return { state: 'frozen', present: present.length };
}

// ------------------------------------------------------------- the invariants
//
// One record's shape, applied to published records and to replacement records
// alike, so a correction cannot carry a record that would fail as a published
// one. `label` names the record in the error.
const PAIR_FIELDS = ['base_covered_days', 'base_price', 'current_covered_days', 'current_price', 'sku'];

function validateRecordShape(r, label) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`${label} is not a record object`);
  if (!PY.SEGMENTS.includes(r.segment)) throw new Error(`${label} has segment ${r.segment}`);
  if (!/^\d{4}-\d{2}$/.test(r.month)) throw new Error(`${label} has month ${r.month}`);
  if (r.metric_id !== PY.METRIC_ID) throw new Error(`${label} has metric_id ${r.metric_id}`);
  if (r.metric_version !== PY.METRIC_VERSION) throw new Error(`${label} has metric_version ${r.metric_version}`);
  if (r.base_month !== PY.addMonths(r.month, -12)) throw new Error(`${label} base_month ${r.base_month} is not 12 months before ${r.month}`);
  if (!Array.isArray(r.pairs)) throw new Error(`${label} has no pairs array`);
  if (r.n !== r.pairs.length) throw new Error(`${label} says n=${r.n} but carries ${r.pairs.length} pairs`);
  if (!r.frozen_at) throw new Error(`${label} has no frozen_at`);
  for (const p of r.pairs) {
    const got = Object.keys(p).sort();
    if (got.join(',') !== PAIR_FIELDS.join(',')) throw new Error(`${label} pair ${p.sku} has fields ${got.join(',')}`);
    if (p.base_covered_days < PY.MIN_COVERED_DAYS || p.current_covered_days < PY.MIN_COVERED_DAYS) {
      throw new Error(`${label} pair ${p.sku} is under the coverage floor`);
    }
  }
}

// ------------------------------------------------------------- corrections
//
// VERSION 1 SUPPORTS INLINE REPLACEMENT RECORDS ONLY. The design once allowed
// "or a path to a committed correction artifact" in place of the record, and
// that option is gone on purpose: a file existing and parsing proves nothing
// about whether it is committed, and a correction whose evidence can go
// missing is not a correction. Every entry carries the complete replacement
// record, pairs included, so the archive stays self-contained.
//
// The original record is never rewritten, which is what makes `original`
// checkable: it must equal the value still stored under records[]. `revised`
// must equal the same field on the replacement. Both are asserted, so an entry
// cannot misdescribe what it changed.
const CORRECTION_FIELDS = ['date', 'segment', 'month', 'field', 'original', 'revised', 'reason', 'commit', 'replacement'];

function validateCorrections(archive) {
  const cs = archive.corrections;
  if (!Array.isArray(cs)) throw new Error('corrections must be an array');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  cs.forEach((c, i) => {
    const at = `corrections[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${at} is not an object`);
    const got = Object.keys(c).sort(), want = [...CORRECTION_FIELDS].sort();
    if (got.join(',') !== want.join(',')) throw new Error(`${at} has fields [${got.join(',')}]; expected exactly [${want.join(',')}]`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) throw new Error(`${at} date must be YYYY-MM-DD, got ${c.date}`);
    if (!PY.SEGMENTS.includes(c.segment)) throw new Error(`${at} has segment ${c.segment}`);
    if (!/^\d{4}-\d{2}$/.test(c.month)) throw new Error(`${at} month must be YYYY-MM, got ${c.month}`);
    const key = recordKey(c.segment, c.month);
    const stored = archive.records[key];
    if (!stored) throw new Error(`${at} corrects ${key}, which is not in records`);
    if (typeof c.field !== 'string' || !(c.field in stored)) throw new Error(`${at} field ${c.field} is not a field of ${key}`);
    if (typeof c.reason !== 'string' || !c.reason.trim()) throw new Error(`${at} has no reason`);
    if (typeof c.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(c.commit)) throw new Error(`${at} commit must be a git sha, got ${c.commit}`);
    if (!same(c.original, stored[c.field])) {
      throw new Error(`${at} original ${JSON.stringify(c.original)} is not the published ${key}.${c.field} ${JSON.stringify(stored[c.field])}`);
    }
    validateRecordShape(c.replacement, `${at}.replacement`);
    if (c.replacement.segment !== c.segment || c.replacement.month !== c.month) {
      throw new Error(`${at}.replacement is for ${c.replacement.segment}|${c.replacement.month}, not ${key}`);
    }
    if (!same(c.replacement[c.field], c.revised)) {
      throw new Error(`${at} revised ${JSON.stringify(c.revised)} is not replacement.${c.field} ${JSON.stringify(c.replacement[c.field])}`);
    }
  });
  return cs.length;
}

// What a WRITE requires over and above a valid structure: no metadata that
// admits it describes an uncommitted change.
function assertWritable(archive) {
  for (const s of [archive.note, ...(archive.caveats || [])]) {
    if (typeof s === 'string' && s.includes(UNCOMMITTED_SENTINEL)) {
      throw new Error(`refusing to write: archive metadata still reads "${UNCOMMITTED_SENTINEL}", so the change it describes is not committed`);
    }
  }
  validateCorrections(archive);
}

function assertArchive(archive, { expectRecords } = {}) {
  const keys = Object.keys(archive.records);
  if (expectRecords != null && keys.length !== expectRecords) {
    throw new Error(`archive holds ${keys.length} records, expected ${expectRecords}`);
  }
  const seen = new Set();
  for (const k of keys) {
    if (seen.has(k)) throw new Error(`duplicate record key ${k}`);
    seen.add(k);
    const r = archive.records[k];
    if (recordKey(r.segment, r.month) !== k) throw new Error(`record key ${k} does not match its own segment and month`);
    validateRecordShape(r, k);
  }
  // every month must carry all four segments with identical metadata
  const months = [...new Set(keys.map((k) => k.split('|')[1]))].sort();
  for (const m of months) {
    const st = monthState(archive, m);
    if (st.state !== 'frozen') throw new Error(`month ${m} is not complete and consistent: ${st.why || st.state}`);
  }
  const corrections = validateCorrections(archive);
  return { records: keys.length, months: months.length, corrections };
}

// ----------------------------------------------------------------- the freeze
//
// Called once per regeneration, for the last complete UTC month. It is
// APPEND ONLY: it reads the committed file, adds four keys, writes. It never
// rewrites a key that exists, and it never throws, because a regen that cannot
// freeze a month must still publish the day's prices.
//
// `at` and `lastComplete` are arguments. Nothing in here reads a clock.
const DAY_MS = 86400000;

/** The last complete UTC month relative to an ISO instant. */
const lastCompleteMonth = (at) => PY.addMonths(at.slice(0, 7), -1);

/**
 * rows must already be the FULL row set; this applies the month cutoff itself,
 * so the record cannot depend on when the regen happened to run.
 */
function freezeMonth({ archive, products, rows, month, at, commit, write = true, log = () => {} }) {
  // THE READ PATH VALIDATES corrections[] TOO. A malformed entry on disk is an
  // alarm like every other, and this returns rather than throws, the same as
  // the other three paths below: the day's prices still publish.
  try { validateCorrections(archive); } catch (err) {
    log(`PRICE_INDEX_FREEZE ALARM: corrections[] invalid, nothing written (${err.message})`);
    log(`PRICE_INDEX_ALARM_JSON ${JSON.stringify({ kind: 'corrections_invalid', month, why: err.message })}`);
    return { action: 'alarm', month, why: err.message };
  }
  const st = monthState(archive, month);

  if (st.state === 'frozen') {
    log(`PRICE_INDEX_FREEZE skipped: ${month} complete (4 of 4)`);
    return { action: 'skipped_complete', month };
  }
  if (st.state === 'alarm') {
    // PRESERVE THE FILE UNTOUCHED. A partial month means something wrote half a
    // month, and repairing it would mean guessing which of two disagreeing
    // records is the published one.
    log(`PRICE_INDEX_FREEZE ALARM: ${month} incomplete or inconsistent`);
    log(`PRICE_INDEX_ALARM_JSON ${JSON.stringify({ kind: 'incomplete', month, why: st.why, present: st.present })}`);
    return { action: 'alarm', month, why: st.why };
  }

  // A POST-BOUNDARY FETCH IS THE EVIDENCE THAT THE MONTH IS OVER IN THE DATA,
  // not just on the clock. market_stats.computed_at would be the wrong signal:
  // the stats recompute is gated to the 08:00 UTC slot and can lag, while a
  // price_history row stamped past the boundary is direct proof that a fetch
  // ran and wrote after the month ended.
  const boundary = `${PY.addMonths(month, 1)}-01T00:00:00Z`;
  const maxFetched = rows.reduce((a, r) => (r.fetched_at > a ? r.fetched_at : a), '');
  if (!(maxFetched >= boundary)) {
    log(`PRICE_INDEX_FREEZE skipped: no post-boundary fetch (newest row ${maxFetched || 'none'}, boundary ${boundary})`);
    return { action: 'skipped_no_post_boundary_fetch', month, maxFetched, boundary };
  }

  const cutoff = PY.monthCutoffIso(month);
  const index = PY.buildIndex({ products, rows: rows.filter((r) => r.fetched_at <= cutoff) });
  const added = [];
  for (const segment of PY.SEGMENTS) {
    added.push(buildRecord({ index, segment, month, at, reconstructed: false, commit }));
  }
  // Build into a COPY first and validate it, so a bad month cannot half-land.
  const next = { ...archive, records: { ...archive.records } };
  for (const r of added) next.records[recordKey(r.segment, r.month)] = r;
  const check = monthState(next, month);
  if (check.state !== 'frozen') {
    log(`PRICE_INDEX_FREEZE ALARM: ${month} incomplete or inconsistent`);
    log(`PRICE_INDEX_ALARM_JSON ${JSON.stringify({ kind: 'build_failed', month, why: check.why || check.state })}`);
    return { action: 'alarm', month, why: check.why || 'the freshly built month did not validate' };
  }
  next.generated = at;
  next.generated_commit = commit;
  const figures = added.map((r) => `${r.segment} n=${r.n} ${r.median}%`).join(', ');
  // THE WRITE IS THE LAST THING AND IT IS FLAGGED. A dry run computes and
  // reports exactly what a real run would freeze and writes nothing, so the
  // integration can be exercised without publishing.
  if (!write) {
    log(`PRICE_INDEX_FREEZE would freeze ${month} (${figures}) - DRY RUN, nothing written`);
    return { action: 'would_freeze', month, records: added.length, archive: next };
  }
  writeArchive(next);
  log(`PRICE_INDEX_FREEZE froze ${month} (${figures})`);
  return { action: 'froze', month, records: added.length, archive: next };
}

/**
 * DRIFT. Recompute every complete frozen month and compare. A difference is
 * NEVER repaired and never throws: the stored record is what was published, so
 * it stays, and the difference is reported. The causes are all input
 * destruction or rewriting (a backfill re-run, a deleted product, an edited
 * name or capacity), which is exactly the class the stored pairs exist to
 * survive.
 *
 * `months` lets a caller narrow the scan; the default is every frozen month.
 */
function driftCheck({ archive, products, rows, months = null, log = () => {} }) {
  // freezeMonth has already raised the alarm for this run; here it only has
  // to not reason over a file whose corrections are malformed.
  try { validateCorrections(archive); } catch (err) {
    log(`PRICE_INDEX_DRIFT skipped: corrections[] invalid (${err.message})`);
    return [];
  }
  const keys = Object.keys(archive.records);
  const allMonths = [...new Set(keys.map((k) => k.split('|')[1]))].sort();
  const scan = months || allMonths;
  const drifted = [];
  for (const month of scan) {
    if (monthState(archive, month).state !== 'frozen') continue;
    const cutoff = PY.monthCutoffIso(month);
    const index = PY.buildIndex({ products, rows: rows.filter((r) => r.fetched_at <= cutoff) });
    for (const segment of PY.SEGMENTS) {
      const stored = archive.records[recordKey(segment, month)];
      const pairs = PY.pairsFor(index, { segment, month });
      const s = PY.statsFor(pairs);
      const now = { n: s ? s.n : 0, median: s ? s.median : null, p25: s ? s.p25 : null, p75: s ? s.p75 : null };
      const diffs = [];
      for (const f of ['n', 'median', 'p25', 'p75']) {
        if (stored[f] !== now[f]) diffs.push({ field: f, stored: stored[f], recomputed: now[f] });
      }
      if (diffs.length) drifted.push({ segment, month, diffs });
    }
  }
  if (drifted.length) {
    log(`PRICE_INDEX_DRIFT ${drifted.length} frozen record(s) now recompute differently. The STORED records stand; nothing was changed.`);
    for (const d of drifted) {
      log(`  ${d.segment} ${d.month}: ${d.diffs.map((x) => `${x.field} ${x.stored} -> ${x.recomputed}`).join(', ')}`);
    }
    log(`PRICE_INDEX_ALARM_JSON ${JSON.stringify({ kind: 'drift', count: drifted.length, drifted: drifted.slice(0, 12) })}`);
  } else {
    log(`PRICE_INDEX_DRIFT none: all ${scan.filter((m) => monthState(archive, m).state === 'frozen').length} frozen month(s) recompute identically`);
  }
  return drifted;
}

module.exports = {
  ARCHIVE_PATH, SCHEMA_VERSION, DEFINITION, NO_OFFER_LIVE, NO_OFFER_BACKFILL, COVERED_DAYS_MEANING,
  CORRECTION_FIELDS, PAIR_FIELDS, UNCOMMITTED_SENTINEL,
  recordKey, ruleBlock, buildRecord, emptyArchive, readArchive, writeArchive, serialise,
  monthState, validateRecordShape, validateCorrections, assertWritable, assertArchive,
  lastCompleteMonth, freezeMonth, driftCheck,
  commitLabel: () => gitState.head(),
};
