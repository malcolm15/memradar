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
const PERIODS = [
  { key: '1m', target: 30, min: 25, max: 35 },
  { key: '3m', target: 90, min: 80, max: 100 },
  { key: '6m', target: 180, min: 165, max: 195 }, // unchanged from the original
  { key: '1y', target: 365, min: 350, max: 380 },
];
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000; // PostgREST caps responses at 1000 rows — paginate

const SEGMENTS = ['ddr5', 'ddr4', 'nvme_ssd', 'sata_ssd'];

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

  const stats = [];
  for (const period of PERIODS) {
    // Closest row to this period's target, within its own window.
    const target = now - period.target * DAY_MS;
    const windowRows = await selectPaged(() =>
      supabase
        .from('price_history')
        .select('product_id, price, fetched_at')
        .gte('fetched_at', new Date(now - period.max * DAY_MS).toISOString())
        .lte('fetched_at', new Date(now - period.min * DAY_MS).toISOString())
    );
    const baselineByProduct = new Map(); // product_id -> {price, dist}
    for (const r of windowRows) {
      const dist = Math.abs(new Date(r.fetched_at).getTime() - target);
      const prev = baselineByProduct.get(r.product_id);
      if (!prev || dist < prev.dist) baselineByProduct.set(r.product_id, { price: Number(r.price), dist });
    }

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
      stats.push({
        segment,
        period: period.key,
        current_avg_price: round2(currentAvg),
        baseline_avg_price: round2(baselineAvg),
        pct_change: round1(((currentAvg - baselineAvg) / baselineAvg) * 100),
        product_count: matchedCurrent.length,
      });
    }
  }

  const computedAt = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from('market_stats')
    .upsert(stats.map((s) => ({ ...s, computed_at: computedAt })), { onConflict: 'segment,period' });
  if (upsertErr) throw upsertErr;

  for (const s of stats) {
    log(`Market stats ${s.segment} [${s.period}]: current=$${s.current_avg_price} baseline=$${s.baseline_avg_price} change=${s.pct_change}% (n=${s.product_count})`);
  }

  return { stats, excluded, computedAt };
}

module.exports = { computeMarketStats, classifySegment, SEGMENTS, PERIODS };
