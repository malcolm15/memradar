// The paired same-product year-over-year metric behind the Price Index.
//
//   metric_id      price-index-paired-yoy
//   metric_version 1
//
// WHAT IT ANSWERS. For each product priced in both a calendar month and the
// same month a year earlier, divide its monthly price by its year-earlier
// monthly price and take the median of those ratios across products. It holds
// the cohort fixed, which the published monthly CSV deliberately does not: that
// file compares whichever products were tracked in each month, and a change
// computed between two of its rows differed from this measure by as much as 44
// percentage points when measured in September 2026.
//
// THIS MODULE READS NO CLOCK AND TOUCHES NO DATABASE. It is a pure function of
// the two row sets handed to it. Every timestamp in the archive is passed in by
// the caller, because a figure that is meant to be frozen must not depend on
// when it was computed. The one-time launch builder and the regen freeze both
// supply their own `at`.
//
// WHY A SEPARATE DAILY-SERIES IMPLEMENTATION RATHER THAN SHARING
// buildDailySeries. That function lives at scripts/generate-product-pages.js
// :819-830 inside a 6,800-line script with NO module.exports at all, so sharing
// it means either extracting it (which moves code every page on the site
// depends on) or exporting from a script that is also an entry point. Neither
// is worth it for twelve lines. Instead the self-test below EXTRACTS
// buildDailySeries from that file's source text at test time and asserts this
// module agrees with it on real fixtures. That is stronger than a hand-copied
// duplicate: if the original changes, the test compares against the NEW one and
// fails, rather than silently drifting.
const { percentile, median } = require('./stats');
const { classifySegment } = require('./marketStats');

const METRIC_ID = 'price-index-paired-yoy';
const METRIC_VERSION = 1;

// A price holds for at most this long with no new observation. Measured on
// 2025-09: the carrying row is a median of 5 days old, p90 39 days, and 3.0% of
// covered days would be carried from a row more than 90 days old. The cap is
// what stops a single ancient observation from manufacturing a whole month.
const CARRY_CAP_DAYS = 90;

// A product qualifies for a month at this many covered days. "Covered days" are
// CALENDAR DAYS THAT CONTRIBUTE TO THE CARRIED-FORWARD SERIES after no-offer
// boundaries and the carry cap. They are NOT raw observation counts: before
// 2026-07-22 the stored history is Keepa change points, so a month with four
// stored rows is a month whose price moved four times, not a month we looked at
// four times. A floor on raw rows would select for volatility; a floor on
// covered days measures coverage.
const MIN_COVERED_DAYS = 20;

const DAY_MS = 86400000;

// Exclusions are EXPLICIT SKU LISTS, never a title pattern evaluated at compute
// time. A pattern re-decides membership every run, so a retitled listing could
// silently leave or enter a frozen cohort. Each archive record stores the lists
// it was built with.
const EXCLUSIONS = {
  // Same manufacturer part number as B0C4G6XQQL, specs identical, r=0.99. Gated
  // by a human on 2026-09-01; see RELISTINGS in generate-product-pages.js:486.
  relisting_duplicates: ['B0BF8FVLSL'],
  // Two drives in one listing, so its price is not one product's price.
  multi_unit: ['B0CXZ153DP'],
  // A drive plus a two-year third-party protection contract. Excluded on
  // DEFINITIONAL grounds, not on price: measured 2026-09 it is CHEAPER than the
  // plain 4TB sibling ($889.99 against $1,079.99), so there is no premium to
  // point at. Hardware variants (heatsinks, coolers, colours) deliberately STAY
  // IN; they are the product, not an add-on.
  service_bundles: ['B0CY2SZ62P'],
};
const EXCLUDED_SKUS = new Set(Object.values(EXCLUSIONS).flat());

// THE ONE-TIME KEEPA BACKFILL stamps every row at exactly 23:59:00 UTC
// (scripts/backfill-keepa.js:54,57). The live fetch stamps `new Date()`, which
// carries real seconds and milliseconds. Measured 2026-10-08: 58,407 rows match
// this shape and 61,082 do not, and their id ranges are DISJOINT (4..58410 and
// 58411..119492), so the shape separates the two eras cleanly.
const isBackfillRow = (r) => /T23:59:00(\.000)?(Z|\+00:00)$/.test(r.fetched_at);

const dayOf = (iso) => iso.slice(0, 10);
const monthOf = (iso) => iso.slice(0, 7);
const addMonths = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const t = (y * 12 + (mo - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthStartMs = (m) => Date.parse(`${m}-01T00:00:00Z`);
function monthEndMs(m) {
  const d = new Date(monthStartMs(m));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}
// 23:59:59Z on the last day of the month: the published data cutoff.
const monthCutoffIso = (m) => new Date(monthEndMs(m) - 1000).toISOString().replace('.000', '');

// ---------------------------------------------------------------- the index
//
// One pass over the rows produces, per product, a chronological event list of
//   { day, type: 'price', price }   an observed in-stock price for that day
//   { day, type: 'nooffer' }        an observed absence of any offer
//
// NO-OFFER HAS TWO SOURCES AND THEY ARE NOT INTERCHANGEABLE.
//
// Backfill era: a row with in_stock=false. Keepa's csv is a CHANGE-POINT
// series, so one such row marks the START of a no-offer interval that runs
// until the next in-stock row, not a single bad day. Measured: 1,355 runs of
// consecutive in_stock=false rows, 80.3% of length 1, max 16.
//
// Live era: there are ZERO in_stock=false rows, because a no-offer observation
// writes no row at all (backend/lib/priceFetch.js:190-205). A batch is a
// distinct fetched_at, stamped once per run and shared by every row that run
// writes (priceFetch.js:178). A day with at least one batch on which the
// product appears in NONE of that day's batches is a no-offer day. A day on
// which it appears in at least one batch is covered, even if absent from
// another batch the same day. A day with no batch is not evidence either way.
//
// The day-level rule was chosen over a batch-level one on measurement, not
// taste: 95.5% of the 628 no-offer product-days fall on days with two or more
// batches, where one dropped request cannot produce a no-offer, and all four
// candidate discriminators give byte-identical figures across all 96
// segment-months, so the simplest safe one wins.
function buildIndex({ products, rows }) {
  const live = rows.filter((r) => !isBackfillRow(r));

  // day -> number of distinct batches that day
  const batchCountByDay = new Map();
  for (const ts of new Set(live.map((r) => r.fetched_at))) {
    const d = dayOf(ts);
    batchCountByDay.set(d, (batchCountByDay.get(d) || 0) + 1);
  }
  const batchDays = [...batchCountByDay.keys()];

  // productId -> Set(day) it appeared in at least one live batch
  const liveDays = new Map();
  for (const r of live) {
    let s = liveDays.get(r.product_id);
    if (!s) { s = new Set(); liveDays.set(r.product_id, s); }
    s.add(dayOf(r.fetched_at));
  }

  const rowsByProduct = new Map();
  for (const r of rows) {
    let a = rowsByProduct.get(r.product_id);
    if (!a) { a = []; rowsByProduct.set(r.product_id, a); }
    a.push(r);
  }

  const events = new Map();
  const bySku = new Map();
  for (const p of products) {
    const segment = p.segment !== undefined ? p.segment : classifySegment(p);
    bySku.set(p.sku, { ...p, segment });

    const own = (rowsByProduct.get(p.id) || [])
      .slice()
      .sort((a, b) => (a.fetched_at < b.fetched_at ? -1 : a.fetched_at > b.fetched_at ? 1 : 0));

    // LAST READING OF THE UTC DAY WINS. The same semantics as buildDailySeries
    // (generate-product-pages.js:819-830), asserted against it in the self-test.
    const byDay = new Map();
    for (const r of own) byDay.set(dayOf(r.fetched_at), r);

    const ev = [];
    for (const [day, r] of byDay) {
      ev.push(r.in_stock === false
        ? { day, type: 'nooffer', src: 'backfill_out_of_stock' }
        : { day, type: 'price', price: Number(r.price) });
    }
    const seen = liveDays.get(p.id) || new Set();
    for (const d of batchDays) {
      if (!seen.has(d) && !byDay.has(d)) ev.push({ day: d, type: 'nooffer', src: 'live_absent_all_batches' });
    }
    ev.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    events.set(p.id, ev);
  }

  return { products: [...bySku.values()], events, batchCountByDay, bySku };
}

// --------------------------------------------------------- the monthly cell
//
// Walks the month day by day, carrying the last PRICE event forward. A no-offer
// event leaves every following day uncovered until the next price. The month
// may be seeded from the latest earlier event, which is what covers the start
// of a month with no change point inside it; if that earlier event is a
// no-offer the month opens uncovered, which is the correct reading.
function monthlyCell(index, productId, month, opts = {}) {
  const cap = opts.carryCapDays === undefined ? CARRY_CAP_DAYS : opts.carryCapDays;
  const ev = index.events.get(productId) || [];
  const start = monthStartMs(month), end = monthEndMs(month);

  let i = 0, state = null;
  while (i < ev.length && Date.parse(`${ev[i].day}T00:00:00Z`) < start) { state = ev[i]; i++; }

  const prices = [];
  for (let t = start; t < end; t += DAY_MS) {
    while (i < ev.length && Date.parse(`${ev[i].day}T00:00:00Z`) <= t) { state = ev[i]; i++; }
    if (!state || state.type !== 'price') continue;
    if (cap != null && (t - Date.parse(`${state.day}T00:00:00Z`)) / DAY_MS > cap) continue;
    prices.push(state.price);
  }
  if (!prices.length) return null;
  return { price: median(prices), coveredDays: prices.length };
}

// ------------------------------------------------------------------- pairs
function pairsFor(index, { segment, month, minCoveredDays = MIN_COVERED_DAYS, excluded = EXCLUDED_SKUS, carryCapDays } = {}) {
  const baseMonth = addMonths(month, -12);
  const out = [];
  for (const p of index.products) {
    if (p.segment !== segment) continue;
    if (excluded && excluded.has(p.sku)) continue;
    const cur = monthlyCell(index, p.id, month, { carryCapDays });
    const base = monthlyCell(index, p.id, baseMonth, { carryCapDays });
    if (!cur || !base) continue;
    if (cur.coveredDays < minCoveredDays || base.coveredDays < minCoveredDays) continue;
    out.push({
      sku: p.sku,
      base_price: base.price,
      current_price: cur.price,
      base_covered_days: base.coveredDays,
      current_covered_days: cur.coveredDays,
    });
  }
  // SORTED BY RATIO ASCENDING, so the middle pair is positional and the output
  // order cannot depend on the order the rows arrived in.
  out.sort((a, b) => (a.current_price / a.base_price) - (b.current_price / b.base_price));
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100;

// --------------------------------------------------------------- statistics
function statsFor(pairs) {
  if (!pairs.length) return null;
  const ratios = pairs.map((p) => p.current_price / p.base_price);
  const sorted = [...ratios].sort((a, b) => a - b);
  const pct = (v) => round2((v - 1) * 100);

  // LEAVE ONE OUT, the full range the median takes when any single product is
  // removed. Stored and published beside every figure, because product_count is
  // not a proxy for robustness: measured 2026-09, sata_ssd has n=27 and a 9.1pp
  // spread while nvme_ssd has n=66 and 1.7pp.
  let looLow = null, looHigh = null;
  if (pairs.length >= 3) {
    const vals = [];
    for (let i = 0; i < ratios.length; i++) {
      vals.push(median(ratios.filter((_, j) => j !== i)));
    }
    looLow = pct(Math.min(...vals));
    looHigh = pct(Math.max(...vals));
  }

  // The middle pair exists only for odd n. For even n the median is the mean of
  // two values and no single product sits at it, so naming one would be false.
  const middle = pairs.length % 2 === 1 ? pairs[(pairs.length - 1) / 2] : null;

  return {
    n: pairs.length,
    median: pct(median(ratios)),
    p25: pct(percentile(sorted, 25)),
    p75: pct(percentile(sorted, 75)),
    rose_share: round2(pairs.filter((p) => p.current_price > p.base_price).length / pairs.length * 100),
    loo_low: looLow,
    loo_high: looHigh,
    middle_pair: middle ? { sku: middle.sku, base_price: middle.base_price, current_price: middle.current_price } : null,
  };
}

const SEGMENTS = ['ddr5', 'ddr4', 'nvme_ssd', 'sata_ssd'];

module.exports = {
  METRIC_ID, METRIC_VERSION, CARRY_CAP_DAYS, MIN_COVERED_DAYS, SEGMENTS,
  EXCLUSIONS, EXCLUDED_SKUS, isBackfillRow, addMonths, monthCutoffIso,
  buildIndex, monthlyCell, pairsFor, statsFor,
};

// Self-test: node backend/lib/pairedYoy.js
// A step in the pre-generation gate in .github/workflows/newegg-refresh.yml.
if (require.main === module) require('./pairedYoy.selftest.js');
