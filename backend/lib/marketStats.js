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
const { stableFigureOf } = require('./stableFigure');

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

      // THREE FIGURES PER SEGMENT-PERIOD, and they answer three questions.
      //   pct_change          ratio of medians, FULL cohort. What we publish.
      //   stable_pct_change   the SAME statistic on the stable cohort, which is
      //                       what makes stability_delta_pp a clean measure of
      //                       cohort dependence: statistic fixed, population
      //                       varied. Do not change this one.
      //   stable_paired_pct   median of per-product ratios on the stable
      //                       cohort. A like-for-like measure that the claim
      //                       floors use, because it does not move when the
      //                       median walks across a gap in the price list.
      //
      // Pairs, not two independent arrays. That is the whole point: the
      // published figure divides two separately sorted lists, so losing members
      // from one side of a gap moves each median on its own. Measured
      // 2026-09-22 on ddr4 1y, three products aging out of the 6m window took
      // the ratio of medians from +98.7% to +162.1% while the paired median
      // moved 145.1 to 146.9. See CLAUDE.md, Market Pulse Stats.
      const stPairs = [];
      for (const [productId, seg] of segmentByProduct) {
        if (seg !== segment || !stableIds.has(productId)) continue;
        stPairs.push({ cur: currentByProduct.get(productId), base: baselineByProduct.get(productId).price });
      }
      const stCur = stPairs.map((p) => p.cur), stBase = stPairs.map((p) => p.base);
      const stablePaired = stPairs.length
        ? round1((median(stPairs.map((p) => p.cur / p.base)) - 1) * 100)
        : null;

      // JACKKNIFE of the FULL cohort's published figure: recompute it n times
      // with one product removed and report the range. STORED, NOT ACTED ON.
      // It exists because product_count is not a proxy for robustness and the
      // measurement says so: on 2026-09-22 the n=14 ddr4 1y stable cohort had a
      // 3.6pp spread while the n=49 nvme 1y cohort had 22.0pp, one product
      // moving it 18.3pp. Nothing reads this yet; it is here to accumulate
      // history before anyone sets a threshold on it.
      let jackknife = null;
      if (matchedCurrent.length >= 3) {
        const spreads = [];
        for (let k = 0; k < matchedCurrent.length; k++) {
          const c = matchedCurrent.filter((_, i) => i !== k);
          const b = matchedBaseline.filter((_, i) => i !== k);
          spreads.push(((median(c) - median(b)) / median(b)) * 100);
        }
        jackknife = round1(Math.max(...spreads) - Math.min(...spreads));
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
        stable_paired_pct: stablePaired,
        jackknife_spread_pp: jackknife,
        stable_count: stCur.length,
      });
    }
  }

  const computedAt = new Date().toISOString();
  // stable_count and stable_pct_change stay IN-PROCESS ONLY. stable_pct_change
  // is recoverable from a stored row as `pct_change - stability_delta_pp`, and
  // stable_count is reportable in the summary; neither needs a column.
  //
  // stable_paired_pct and jackknife_spread_pp ARE persisted, because unlike the
  // other two they cannot be reconstructed from anything stored: the paired
  // median needs per-product pairs and the jackknife needs the whole cohort.
  // Before 2026-09-22 the only record of a past run's cohort statistics was the
  // Actions log line, which expires at 90 days.
  const toRow = (s, withStability, withNew) => {
    const { stable_count, stable_pct_change, stability_delta_pp, stable_paired_pct, jackknife_spread_pp, ...rest } = s;
    const row = { ...rest, computed_at: computedAt };
    if (withStability) row.stability_delta_pp = stability_delta_pp;
    if (withNew) { row.stable_paired_pct = stable_paired_pct; row.jackknife_spread_pp = jackknife_spread_pp; }
    return row;
  };
  let tripwireDisabled = false;
  let pairedColumnsMissing = false;
  let { error: upsertErr } = await supabase
    .from('market_stats')
    .upsert(stats.map((s) => toRow(s, true, true)), { onConflict: 'segment,period' });
  // Same degrade-loudly pattern the tripwire column uses. A pending ALTER must
  // never fail the run and must never be quiet about it: the claim floors read
  // stable_paired_pct, so while these columns are missing they fall back to the
  // old reconstruction and that has to be visible in the log and the summary.
  if (upsertErr && /stable_paired_pct|jackknife_spread_pp/.test(upsertErr.message)) {
    pairedColumnsMissing = true;
    log('*** PAIRED-COHORT COLUMNS MISSING ***');
    log('    market_stats.stable_paired_pct / jackknife_spread_pp do not exist, so both');
    log('    are computed and then DISCARDED. The claim floors fall back to the ratio-of-');
    log('    medians stable figure, which is the measure that moved 63pp on a membership');
    log('    change on 2026-09-22. Land the ALTER:');
    log('    ALTER TABLE market_stats ADD COLUMN stable_paired_pct NUMERIC(7,1);');
    log('    ALTER TABLE market_stats ADD COLUMN jackknife_spread_pp NUMERIC(7,1);');
    ({ error: upsertErr } = await supabase
      .from('market_stats')
      .upsert(stats.map((s) => toRow(s, true, false)), { onConflict: 'segment,period' }));
  }
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
      .upsert(stats.map((s) => toRow(s, false, !pairedColumnsMissing)), { onConflict: 'segment,period' }));
  }
  if (upsertErr) throw upsertErr;

  // One line per segment-period carrying all three figures and the spread, so a
  // run's full cohort picture is readable without opening the summary JSON.
  for (const s of stats) {
    const st = s.stable_pct_change == null ? 'n/a' : `${s.stable_pct_change}%`;
    const pr = s.stable_paired_pct == null ? 'n/a' : `${s.stable_paired_pct}%`;
    const jk = s.jackknife_spread_pp == null ? 'n/a' : `${s.jackknife_spread_pp}pp`;
    log(`Market stats ${s.segment} [${s.period}]: full=${s.pct_change}% (n=${s.product_count}) stable=${st} paired=${pr} (stable n=${s.stable_count}) delta=${s.stability_delta_pp == null ? 'n/a' : Math.abs(s.stability_delta_pp) + 'pp'} jackknife=${jk} | current=$${s.current_avg_price} baseline=$${s.baseline_avg_price}`);
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

  return { stats, excluded, computedAt, unstable, severe, tripwireDisabled, pairedColumnsMissing, claimFloors };
}

// The stable-cohort figure for a STORED market_stats row. The single place
// that knows the sign convention, so no caller has to remember it.
// Returns null when the delta is absent, which callers must treat as "unknown",
// never as "equal to the full cohort".
// Thin wrapper over the single selection rule in ./stableFigure, kept as an
// export because three generator call sites already import this name. The rule
// itself lives in exactly one file; see the comment there for why the tripwire
// does not come through it.
function stablePctOf(row, onFallback) {
  return stableFigureOf(row, onFallback);
}

module.exports = { computeMarketStats, classifySegment, SEGMENTS, PERIODS, STABILITY_FLAG_PP, STABILITY_SEVERE_PP, stablePctOf };
