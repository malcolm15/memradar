// Market Pulse stats computation — shared by the daily cron
// (api/fetch-prices.js) and the standalone runner (scripts/compute-market-stats.js).
//
// Segments products by name, then compares the current cron batch's prices
// against each product's price N days ago, for FOUR windows (1m/3m/6m/1y) so
// the homepage can switch time ranges without client-side math or extra
// queries. 4 segments x 4 periods = 16 upserted rows per run.
//
// FAIRNESS RULE, applied INDEPENDENTLY PER PERIOD: a period's pct_change is
// computed over the subset of products that had a baseline row in THAT
// period's window AND have a current price — both medians use that same
// subset, so new products entering the catalog can't skew the comparison.
// product_count = that period's subset size, which is why counts legitimately
// differ between periods (a 1y window can only include products we were
// already tracking a year ago).
const { checkClaimFloors, logClaimFloors } = require('./claimRegistry');

const PERIODS = [
  { key: '1m', target: 30, min: 25, max: 35 },
  { key: '3m', target: 90, min: 80, max: 100 },
  { key: '6m', target: 180, min: 165, max: 195 }, // unchanged from the original
  { key: '1y', target: 365, min: 350, max: 380 },
];
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000; // PostgREST caps responses at 1000 rows — paginate

const SEGMENTS = ['ddr5', 'ddr4', 'nvme_ssd', 'sata_ssd'];

// STABILITY TRIPWIRE. The per-period fairness rule means figures are not
// equally robust: recomputing a period over only the products present in
// EVERY period can move it by tens of points (measured: DDR4 1y +191.5% ->
// +159.3%, a 32.2pp swing, while DDR5 1y does not move at all). Medians are
// why - one product entering a window shifts which product sits at the
// median. We compute that delta per figure and STORE it, but never display
// it: annotating cells would undercut the Price Index's citability for a
// nuance no outsider can reproduce (see CLAUDE.md for the full decision and
// its stated reversal condition).
//
// The point is to catch the next DDR4 case BEFORE it goes into prose, so
// anything at or above this threshold is flagged loudly in the run summary
// rather than waiting to be looked up.
const STABILITY_FLAG_PP = 5.0;
// ...but at 5pp, 7 of 16 figures flag on live data, and a warning that fires
// on nearly half the table is one people learn to scroll past. So the output
// is TIERED: anything at or above the severe line is the "do not quote this"
// case (DDR4 1y at 32.2pp, NVMe 1y at 25.4pp), while 5-15pp is reported as
// context rather than alarm. Both are in the summary; only severe shouts.
const STABILITY_SEVERE_PP = 15.0;

// Segment derivation rules (case-insensitive on product name):
//   ram + 'DDR5' -> ddr5; ram + 'DDR4' -> ddr4
//   ssd + 'SATA' or '2.5' -> sata_ssd, else 'NVMe' or 'M.2' -> nvme_ssd
// SATA is checked FIRST: "M.2 SATA" drives are SATA-protocol despite the M.2
// form factor, and our audience knows the difference. Products matching
// neither pattern are excluded.
function classifySegment(product) {
  const n = product.name || '';
  if (product.category === 'ram') {
    if (/ddr5/i.test(n)) return 'ddr5';
    if (/ddr4/i.test(n)) return 'ddr4';
  } else if (product.category === 'ssd') {
    if (/sata|2\.5/i.test(n)) return 'sata_ssd';
    if (/nvme|m\.2/i.test(n)) return 'nvme_ssd';
  }
  return null;
}

async function selectPaged(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const round2 = (x) => Math.round(x * 100) / 100;
const round1 = (x) => Math.round(x * 10) / 10;

// Median, not mean: single $1,900 outlier drives in a 29-79 product segment
// skew a mean badly; median is the honest "typical price" and protects every
// segment from catalog-composition drift as products come and go.
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// batchTimestamp: the fetched_at of the current cron run's rows — passed
// explicitly rather than ORDER BY fetched_at DESC, because backfill day-bucket
// rows are stamped T23:59 and can sort ahead of same-day cron rows.
async function computeMarketStats(supabase, batchTimestamp, log = () => {}) {
  const products = await selectPaged(() =>
    supabase.from('products').select('id, name, category').eq('retailer', 'amazon')
  );

  const segmentByProduct = new Map();
  const excluded = { ram: 0, ssd: 0 };
  for (const p of products) {
    const seg = classifySegment(p);
    if (seg) segmentByProduct.set(p.id, seg);
    else if (excluded[p.category] !== undefined) excluded[p.category]++;
  }
  if (excluded.ram || excluded.ssd) {
    log(`Market stats: excluded from segments — ram=${excluded.ram}, ssd=${excluded.ssd}`);
  }

  // Current prices: exactly the rows of this cron batch.
  const currentRows = await selectPaged(() =>
    supabase.from('price_history').select('product_id, price').eq('fetched_at', batchTimestamp)
  );
  const currentByProduct = new Map(currentRows.map((r) => [r.product_id, Number(r.price)]));

  // Baseline rows PER PERIOD. The four windows are DISJOINT (25-35, 80-100,
  // 165-195, 350-380 days), so a single widened 25-380d query would fetch 355
  // days of history to use 90 - roughly 500k rows at the 6x cadence versus
  // 127k for four narrow queries. Four queries it is; there is nothing to
  // de-duplicate between them.
  const now = Date.now();

  // Baselines for every period first, so the stable cohort (products present
  // in ALL periods) can be derived before any figure is computed.
  const baselines = new Map(); // period key -> Map(product_id -> {price})
  for (const period of PERIODS) {
    const target = now - period.target * DAY_MS;
    const windowRows = await selectPaged(() =>
      supabase
        .from('price_history')
        .select('product_id, price, fetched_at')
        .gte('fetched_at', new Date(now - period.max * DAY_MS).toISOString())
        .lte('fetched_at', new Date(now - period.min * DAY_MS).toISOString())
    );
    const m = new Map();
    for (const r of windowRows) {
      const dist = Math.abs(new Date(r.fetched_at).getTime() - target);
      const prev = m.get(r.product_id);
      if (!prev || dist < prev.dist) m.set(r.product_id, { price: Number(r.price), dist });
    }
    baselines.set(period.key, m);
  }
  // Products priced now AND present in every period's window.
  const stableIds = new Set(
    [...currentByProduct.keys()].filter((id) => PERIODS.every((p) => baselines.get(p.key).has(id)))
  );

  const stats = [];
  for (const period of PERIODS) {
    const baselineByProduct = baselines.get(period.key);

    for (const segment of SEGMENTS) {
      const matchedCurrent = [];
      const matchedBaseline = [];
      for (const [productId, seg] of segmentByProduct) {
        if (seg !== segment) continue;
        const cur = currentByProduct.get(productId);
        const base = baselineByProduct.get(productId);
        if (cur === undefined || base === undefined) continue; // fairness: need both
        matchedCurrent.push(cur);
        matchedBaseline.push(base.price);
      }

      if (matchedCurrent.length === 0) {
        stats.push({ segment, period: period.key, current_avg_price: null, baseline_avg_price: null, pct_change: null, product_count: 0 });
        continue;
      }

      const currentAvg = median(matchedCurrent);
      const baselineAvg = median(matchedBaseline);
      const pct = ((currentAvg - baselineAvg) / baselineAvg) * 100;

      // Same figure over the stable cohort. The DELTA is the tripwire: how
      // much this number depends on which products happen to qualify.
      const stCur = [], stBase = [];
      for (const [productId, seg] of segmentByProduct) {
        if (seg !== segment || !stableIds.has(productId)) continue;
        stCur.push(currentByProduct.get(productId));
        stBase.push(baselineByProduct.get(productId).price);
      }
      // STORED SIGNED, compared with Math.abs(). It was originally stored
      // absolute, on the reasoning that a "how much does this move" warning does
      // not care about direction. That reasoning was right about the tripwire and
      // wrong about everything downstream: an unsigned distance cannot say which
      // side of a floor the stable cohort landed on, so any consumer needing the
      // stable figure had to recompute it from scratch. DDR4 is the case in
      // point - it moves 39.6pp and the stable cohort reads HIGHER, so assuming
      // the worst direction understates it by nearly 80pp.
      //
      // Signed, `pct_change - stability_delta_pp` IS the stable-cohort figure,
      // exactly, recoverable from a stored row by anything that reads the table.
      // The tripwire wraps its own comparisons in Math.abs(), where the
      // discarding of the sign belongs.
      let stabilityDelta = null;
      let stablePct = null;
      if (stCur.length) {
        const sPct = ((median(stCur) - median(stBase)) / median(stBase)) * 100;
        stablePct = round1(sPct);
        stabilityDelta = round1(pct - sPct);
      }

      stats.push({
        segment,
        period: period.key,
        current_avg_price: round2(currentAvg),
        baseline_avg_price: round2(baselineAvg),
        pct_change: round1(pct),
        product_count: matchedCurrent.length,
        stability_delta_pp: stabilityDelta,
        stable_pct_change: stablePct,
        stable_count: stCur.length,
      });
    }
  }

  const computedAt = new Date().toISOString();
  // stable_count and stable_pct_change are derived context consumed in-process
  // by the tripwire and the claim floors; neither is a stored column, so both
  // are stripped before the write. Deliberately NOT persisted: the floors are a
  // monitoring layer and adding a column would put a pending ALTER TABLE
  // between them and the run that needs them.
  const toRow = (s, withStability) => {
    const { stable_count, stable_pct_change, stability_delta_pp, ...rest } = s;
    return withStability
      ? { ...rest, stability_delta_pp, computed_at: computedAt }
      : { ...rest, computed_at: computedAt };
  };
  let tripwireDisabled = false;
  let { error: upsertErr } = await supabase
    .from('market_stats')
    .upsert(stats.map((s) => toRow(s, true)), { onConflict: 'segment,period' });
  if (upsertErr && /stability_delta_pp/.test(upsertErr.message)) {
    // Column not added yet: write everything else rather than failing the run.
    //
    // THIS MUST SHOUT. The original version logged one quiet line, and a
    // pending ALTER TABLE consequently sat unnoticed for a week while every
    // run silently discarded its deltas - so the tripwire built to stop a
    // volatile figure reaching prose was itself invisible when a guide was
    // being written against it. The flag now rides the summary JSON, where a
    // disabled safety check is as visible as a firing one.
    tripwireDisabled = true;
    log('*** STABILITY TRIPWIRE DISABLED: column missing ***');
    log('    market_stats.stability_delta_pp does not exist, so cohort-sensitivity');
    log('    deltas are computed and then DISCARDED. Figures from this run carry no');
    log('    stability evidence - do not quote them in prose until the ALTER lands:');
    log('    ALTER TABLE market_stats ADD COLUMN stability_delta_pp NUMERIC(6,1);');
    ({ error: upsertErr } = await supabase
      .from('market_stats')
      .upsert(stats.map((s) => toRow(s, false)), { onConflict: 'segment,period' }));
  }
  if (upsertErr) throw upsertErr;

  for (const s of stats) {
    log(`Market stats ${s.segment} [${s.period}]: current=$${s.current_avg_price} baseline=$${s.baseline_avg_price} change=${s.pct_change}% (n=${s.product_count}, stability ${s.stability_delta_pp == null ? 'n/a' : Math.abs(s.stability_delta_pp) + 'pp'})`);
  }

  // THE TRIPWIRE ANNOUNCES ITSELF. A figure this cohort-sensitive must not be
  // quoted to a decimal in prose, a guide or a social post; state a magnitude
  // that survives the swing instead.
  const unstable = stats
    .filter((s) => s.stability_delta_pp != null && Math.abs(s.stability_delta_pp) >= STABILITY_FLAG_PP)
    .sort((a, b) => Math.abs(b.stability_delta_pp) - Math.abs(a.stability_delta_pp));
  const severe = unstable.filter((s) => Math.abs(s.stability_delta_pp) >= STABILITY_SEVERE_PP);
  const moderate = unstable.filter((s) => Math.abs(s.stability_delta_pp) < STABILITY_SEVERE_PP);
  if (severe.length) {
    log(`⚠ STABILITY FLAG (SEVERE): ${severe.length} figure(s) move >= ${STABILITY_SEVERE_PP}pp on cohort choice - do NOT quote these to a decimal in prose, a guide or a post:`);
    severe.forEach((s) => log(`    ${s.segment} [${s.period}] ${s.pct_change}% moves ${Math.abs(s.stability_delta_pp)}pp to ${s.stable_pct_change}% on the stable cohort (n=${s.product_count}, stable n=${s.stable_count})`));
  }
  if (moderate.length) {
    log(`Stability (moderate, context only): ${moderate.map((s) => `${s.segment}/${s.period} ${Math.abs(s.stability_delta_pp)}pp`).join(', ')}`);
  }
  if (!unstable.length) log(`Stability: every figure moves < ${STABILITY_FLAG_PP}pp on cohort choice`);

  // PUBLISHED-CLAIM FLOORS. The tripwire above guards figures on their way INTO
  // prose; this checks the prose already published against the figures it rests
  // on, on both cohorts. Isolated because a registry problem must never fail a
  // stats run: the numbers are the product, the monitor is commentary on them.
  let claimFloors = null;
  try {
    claimFloors = checkClaimFloors(stats);
    logClaimFloors(claimFloors, log);
  } catch (err) {
    log(`⚠ CLAIM FLOOR CHECK FAILED: ${err.message} - published claims are UNVERIFIED for this run`);
    claimFloors = { error: err.message };
  }

  return { stats, excluded, computedAt, unstable, severe, tripwireDisabled, claimFloors };
}

// The stable-cohort figure for a STORED market_stats row. The single place
// that knows the sign convention, so no caller has to remember it.
// Returns null when the delta is absent, which callers must treat as "unknown",
// never as "equal to the full cohort".
function stablePctOf(row) {
  if (row == null || row.pct_change == null || row.stability_delta_pp == null) return null;
  return Math.round((Number(row.pct_change) - Number(row.stability_delta_pp)) * 10) / 10;
}

module.exports = { computeMarketStats, classifySegment, SEGMENTS, PERIODS, STABILITY_FLAG_PP, STABILITY_SEVERE_PP, stablePctOf };
