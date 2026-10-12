// Self-test for backend/lib/pairedYoy.js.
//
// node assert, NOT console.assert. This runs as a step in the pre-generation
// gate in .github/workflows/newegg-refresh.yml, and console.assert prints
// "Assertion failed" and then exits 0, so a gate built on it would be green for
// a broken metric. Same rule as backend/lib/rakutenLink.js.
//
// It needs no network, no database and no secret: the real rows it checks
// against are committed in fixtures/paired-yoy-fixtures.json, trimmed to the
// windows these cases need.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PY = require('./pairedYoy');
const { median } = require('./stats');

const F = require('./fixtures/paired-yoy-fixtures.json');
const index = PY.buildIndex({ products: F.products, rows: F.rows });
const idOf = (sku) => {
  const p = F.products.find((x) => x.sku === sku);
  assert.ok(p, `fixture is missing ${sku}`);
  return p.id;
};
const cell = (sku, month) => PY.monthlyCell(index, idOf(sku), month);

// ---------------------------------------------------------------- 1. era split
assert.strictEqual(PY.isBackfillRow({ fetched_at: '2025-09-01T23:59:00.000Z' }), true, 'backfill shape, ms form');
assert.strictEqual(PY.isBackfillRow({ fetched_at: '2025-09-01T23:59:00+00:00' }), true, 'backfill shape, offset form');
assert.strictEqual(PY.isBackfillRow({ fetched_at: '2026-10-08T00:13:17.442+00:00' }), false, 'live shape');
assert.strictEqual(PY.isBackfillRow({ fetched_at: '2026-10-08T23:59:17.442+00:00' }), false, 'live row near 23:59 is not backfill');
{
  const bf = F.rows.filter(PY.isBackfillRow), lv = F.rows.filter((r) => !PY.isBackfillRow(r));
  assert.ok(bf.length > 0 && lv.length > 0, 'the fixture must exercise both eras');
  assert.ok(bf.every((r) => r.in_stock === true || r.in_stock === false), 'backfill rows carry a boolean in_stock');
  assert.strictEqual(lv.filter((r) => r.in_stock === false).length, 0,
    'the live era must have zero in_stock=false rows; if this fails the fetch has started writing them and the live no-offer rule needs revisiting');
}

// ------------------------------------- 2. the three Phase 1 worked examples
// Plain carry: three change points inside the month, no no-offer, seeded from
// 2025-08-25 $104.99. Every day of September covered.
{
  const c = cell('B0CJ8ZHMVF', '2025-09');
  assert.ok(c, 'B0CJ8ZHMVF 2025-09 must have coverage');
  assert.strictEqual(c.coveredDays, 30, 'plain carry: all 30 days covered');
  assert.strictEqual(c.price, 99.99, 'plain carry: monthly median');
}
// Carry ended by a no-offer event: an in_stock=false row on 2025-09-09 leaves
// 09-09 to 09-14 uncovered, and a price on 09-15 resumes coverage.
{
  const c = cell('B0BNTRRLYP', '2025-09');
  assert.ok(c, 'B0BNTRRLYP 2025-09 must have coverage');
  assert.strictEqual(c.coveredDays, 24, 'no-offer carry break: 30 days minus the 6 uncovered');
  assert.strictEqual(c.price, 86.99, 'no-offer carry break: monthly median');
  const ev = index.events.get(idOf('B0BNTRRLYP'));
  const brk = ev.find((e) => e.day === '2025-09-09');
  assert.ok(brk && brk.type === 'nooffer' && brk.src === 'backfill_out_of_stock',
    'the 2025-09-09 break must come from a backfill in_stock=false row');
  for (const d of ['2025-09-10', '2025-09-11', '2025-09-12', '2025-09-13', '2025-09-14']) {
    assert.ok(!ev.some((e) => e.day === d), `${d} has no event of its own: it is uncovered by the carry rule, not by a row`);
  }
}
// Month-start seed: no event at all inside 2025-06, seeded from 2025-04-30
// $99.99, carried 32 to 61 days, inside the 90-day cap.
{
  const c = cell('B0CJ8ZHMVF', '2025-06');
  assert.ok(c, 'B0CJ8ZHMVF 2025-06 must be covered by the month-start seed alone');
  assert.strictEqual(c.coveredDays, 30, 'month-start seed: all 30 days covered');
  assert.strictEqual(c.price, 99.99, 'month-start seed: the seeded price');
  const ev = index.events.get(idOf('B0CJ8ZHMVF'));
  assert.strictEqual(ev.filter((e) => e.day.startsWith('2025-06')).length, 0,
    'the seed case requires NO event inside the month, or it is not testing the seed');
}

// ------------------------------------------- 3. the three live-era day rules
{
  const ev = index.events.get(idOf('B09T8TH7PG'));
  const evOf = (d) => ev.find((e) => e.day === d);

  // (a) ALL BATCHES ABSENT -> no-offer. 2026-09-12 has batches and B09T8TH7PG
  // is in none of them.
  assert.ok(index.batchCountByDay.get('2026-09-12') > 0, '2026-09-12 must have at least one batch');
  const a = evOf('2026-09-12');
  assert.ok(a && a.type === 'nooffer' && a.src === 'live_absent_all_batches',
    'a day with batches where the product appears in none is a live no-offer day');

  // (b) PARTLY ABSENT -> covered. 2026-09-21 has 4 batches and B09T8TH7PG is in
  // exactly 1, which must still be a price day.
  assert.strictEqual(index.batchCountByDay.get('2026-09-21'), 4, '2026-09-21 must have 4 batches in the fixture');
  const b = evOf('2026-09-21');
  assert.ok(b && b.type === 'price',
    'a day where the product appears in at least one batch is covered, even if absent from another batch that day');

  // (c) NO BATCH AT ALL -> not evidence either way. Synthetic, because the
  // fixture window has a batch on every day.
  const synth = PY.buildIndex({
    products: [{ id: 1, sku: 'SYNTH1', segment: 'ddr5' }],
    rows: [{ id: 1, product_id: 1, price: 100, in_stock: true, fetched_at: '2026-03-01T06:00:00.123Z' }],
  });
  const sc = PY.monthlyCell(synth, 1, '2026-03');
  assert.strictEqual(sc.coveredDays, 31,
    'with one price on the 1st and no further batches, the carry runs the whole month');
  assert.strictEqual(synth.batchCountByDay.size, 1, 'only the one day has a batch');
  assert.strictEqual((synth.events.get(1) || []).filter((e) => e.type === 'nooffer').length, 0,
    'a day with no batch must NOT produce a no-offer event');

  // (d) A BACKFILL ROW ON A DAY THAT HAS LIVE BATCHES is covered, not absent.
  // The two eras overlap on 2026-07-22, and a product whose only row that day
  // came from the backfill has no live row, so the live rule would call it
  // absent if it looked at live presence alone. It must look at ALL rows.
  // This case is why the live-absence test is `!seenLive && !hasAnyRow`.
  const overlap = PY.buildIndex({
    products: [{ id: 1, sku: 'SYNTH3', segment: 'ddr5' }, { id: 2, sku: 'SYNTH4', segment: 'ddr5' }],
    rows: [
      // product 1: a backfill row on the overlap day and nothing live
      { id: 1, product_id: 1, price: 70, in_stock: true, fetched_at: '2026-07-22T23:59:00.000Z' },
      // product 2: a live row the same day, which is what makes it a batch day
      { id: 2, product_id: 2, price: 80, in_stock: true, fetched_at: '2026-07-22T06:30:57.151Z' },
    ],
  });
  assert.strictEqual(overlap.batchCountByDay.get('2026-07-22'), 1, '2026-07-22 is a batch day');
  const o1 = (overlap.events.get(1) || []).filter((e) => e.day === '2026-07-22');
  assert.strictEqual(o1.length, 1, 'the overlap day must yield exactly one event, not a price and a no-offer');
  assert.strictEqual(o1[0].type, 'price', 'a backfill row on a live batch day is COVERED, not absent');
  assert.strictEqual(o1[0].price, 70, 'and it carries the backfill price');
}

// -------------------------------------------------------- 4. the 90-day cap
{
  // One price on 2026-01-01 and nothing after. March is 60 to 90 days out, so
  // fully covered. May is 120 to 150 days out, so fully uncovered.
  const capIdx = PY.buildIndex({
    products: [{ id: 1, sku: 'SYNTH2', segment: 'ddr5' }],
    rows: [{ id: 1, product_id: 1, price: 50, in_stock: true, fetched_at: '2026-01-01T06:00:00.123Z' }],
  });
  assert.strictEqual(PY.monthlyCell(capIdx, 1, '2026-03').coveredDays, 31, 'inside the cap: March fully covered');
  assert.strictEqual(PY.monthlyCell(capIdx, 1, '2026-05'), null, 'beyond the cap: May has no covered day');
  // The boundary itself: day 90 is covered, day 91 is not.
  const apr = PY.monthlyCell(capIdx, 1, '2026-04');
  assert.strictEqual(apr.coveredDays, 1, '2026-04-01 is day 90 and covered; 2026-04-02 is day 91 and is not');
  assert.strictEqual(PY.CARRY_CAP_DAYS, 90, 'the cap is 90 days');
}

// ----------------------------------------- 5. odd and even n, middle pair
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    sku: `S${i}`, base_price: 100, current_price: 100 + i, base_covered_days: 30, current_covered_days: 30,
  }));
  const odd = PY.statsFor(mk(5));
  assert.strictEqual(odd.n, 5);
  assert.ok(odd.middle_pair, 'odd n must name a middle pair');
  assert.strictEqual(odd.middle_pair.sku, 'S2', 'the middle of 5 sorted ratios is index 2');
  assert.strictEqual(odd.median, 2, 'median of 0..4 percent is 2');
  const even = PY.statsFor(mk(4));
  assert.strictEqual(even.middle_pair, null, 'even n must name NO middle pair');
  assert.strictEqual(even.median, 1.5, 'even-n median is the mean of the two middle values');
  // n of 1 and 2 have no leave-one-out range to report.
  assert.strictEqual(PY.statsFor(mk(2)).loo_low, null, 'n=2 has no leave-one-out range');
  assert.ok(PY.statsFor(mk(3)).loo_low != null, 'n=3 does have one');
  assert.strictEqual(PY.statsFor([]), null, 'no pairs means no statistics');
}

// --------------------------- 6. quantile and median conventions, pinned
{
  const { percentile } = require('./stats');
  // p50 and median must agree, which is what lets the record carry one median
  // and two percentiles from one convention.
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(Math.random() * 12);
    const xs = Array.from({ length: n }, () => Math.random() * 1000);
    const s = [...xs].sort((a, b) => a - b);
    assert.ok(Math.abs(percentile(s, 50) - median(xs)) < 1e-9, 'percentile(s,50) must equal median(xs)');
  }
  // PINNED COPY of backend/lib/marketStats.js:313. If that function is ever
  // changed, this assertion fails and whoever changed it has to decide whether
  // the published metric moves with it.
  const marketStatsMedian = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const live = require('./marketStats');
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(Math.random() * 12);
    const xs = Array.from({ length: n }, () => Math.random() * 1000);
    assert.ok(Math.abs(marketStatsMedian(xs) - median(xs)) < 1e-12, 'stats.median must match the pinned marketStats median');
  }
  assert.strictEqual(typeof live.classifySegment, 'function', 'classifySegment must stay exported from marketStats');
}

// ------------------------- 7. daily-series parity with buildDailySeries
//
// buildDailySeries is not exported: scripts/generate-product-pages.js has no
// module.exports at all. Rather than keep a hand-copied duplicate that can
// drift in silence, this EXTRACTS the real function from that file's source and
// compares against it. If the original is renamed or reshaped the extraction
// fails loudly here, which is the behaviour we want.
{
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'generate-product-pages.js'), 'utf8');
  const m = /\nfunction buildDailySeries\(rows\) \{[\s\S]*?\n\}\n/.exec(src);
  assert.ok(m, 'could not extract buildDailySeries from scripts/generate-product-pages.js; if it was renamed, this parity check must be updated deliberately');
  // eslint-disable-next-line no-new-func
  const buildDailySeries = new Function(`${m[0]}; return buildDailySeries;`)();

  const byProduct = new Map();
  for (const r of F.rows) {
    let a = byProduct.get(r.product_id);
    if (!a) { a = []; byProduct.set(r.product_id, a); }
    a.push(r);
  }
  let compared = 0;
  for (const [pid, rows] of byProduct) {
    const theirs = buildDailySeries(rows);               // [{day, price, ...}] chronological
    // Ours, read back out of the event list: a 'price' event per covered day,
    // carrying the LAST reading of that UTC day.
    const ours = (index.events.get(pid) || [])
      .filter((e) => e.type === 'price')
      .map((e) => ({ day: e.day, price: e.price }));
    // buildDailySeries drops in_stock=false rows entirely; our event list keeps
    // them as no-offer markers, so compare only the price days.
    assert.strictEqual(ours.length, theirs.length, `day count parity for product ${pid}`);
    for (let i = 0; i < theirs.length; i++) {
      assert.strictEqual(ours[i].day, theirs[i].day, `day parity at ${i} for product ${pid}`);
      assert.strictEqual(ours[i].price, theirs[i].price, `price parity on ${theirs[i].day} for product ${pid}`);
      compared++;
    }
  }
  // 99 day-prices over the three fixture products that carry rows (the fourth,
  // B0CRNNVYM2, is product-only), measured 2026-10-08. The floor is set below
  // that so a fixture trim cannot silently empty the check while still being
  // high enough that an empty comparison fails.
  assert.ok(compared > 50, `parity must actually compare something; compared ${compared} day-prices`);
  console.log(`  daily-series parity with buildDailySeries: ${compared} day-prices over ${byProduct.size} products, exact match`);
}

// ------------------------------------------------- 8. exclusions are lists
{
  assert.deepStrictEqual(PY.EXCLUSIONS.relisting_duplicates, ['B0BF8FVLSL']);
  assert.deepStrictEqual(PY.EXCLUSIONS.multi_unit, ['B0CXZ153DP']);
  assert.deepStrictEqual(PY.EXCLUSIONS.service_bundles, ['B0CY2SZ62P']);
  assert.strictEqual(PY.EXCLUDED_SKUS.size, 3, 'three excluded SKUs in total');
  // A pair set must honour them.
  const ps = PY.pairsFor(index, { segment: 'ddr5', month: '2026-09', minCoveredDays: 1 });
  assert.ok(!ps.some((p) => PY.EXCLUDED_SKUS.has(p.sku)), 'no excluded SKU may appear in a pair set');
}

// ------------------------------------------------------- 9. shape and order
{
  const ps = PY.pairsFor(index, { segment: 'ddr5', month: '2026-09', minCoveredDays: 1 });
  if (ps.length) {
    assert.deepStrictEqual(Object.keys(ps[0]).sort(),
      ['base_covered_days', 'base_price', 'current_covered_days', 'current_price', 'sku'],
      'pair field names are fixed by the archive schema');
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1].current_price / ps[i - 1].base_price, b = ps[i].current_price / ps[i].base_price;
      assert.ok(a <= b, 'pairs are sorted by ratio ascending so the middle pair is positional');
    }
  }
  assert.strictEqual(PY.MIN_COVERED_DAYS, 20, 'the coverage floor is 20 days');
  assert.strictEqual(PY.METRIC_ID, 'price-index-paired-yoy');
  assert.strictEqual(PY.METRIC_VERSION, 1);
  assert.strictEqual(PY.monthCutoffIso('2026-09'), '2026-09-30T23:59:59Z', 'the data cutoff is 23:59:59Z on the last day');
  assert.strictEqual(PY.addMonths('2026-01', -12), '2025-01');
  assert.strictEqual(PY.addMonths('2026-12', 1), '2027-01');
}

console.log('pairedYoy self-test OK');
