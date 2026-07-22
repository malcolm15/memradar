// Market Pulse stats computation — shared by the daily cron
// (api/fetch-prices.js) and the standalone runner (scripts/compute-market-stats.js).
//
// Segments products by name, then compares the current cron batch's prices
// against each product's price ~180 days ago (window 165-195d, closest to the
// 180d mark). FAIRNESS RULE: pct_change is computed over the subset of
// products that existed 180 days ago (had a row in the window) AND have a
// current price — both averages use that same subset, so new products entering
// the catalog can't skew the comparison. product_count = subset size.
const BASELINE_WINDOW_MIN_DAYS = 165;
const BASELINE_WINDOW_MAX_DAYS = 195;
const BASELINE_TARGET_DAYS = 180;
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

  // Baseline: each product's row closest to the 180-day mark within 165-195d.
  const now = Date.now();
  const winFrom = new Date(now - BASELINE_WINDOW_MAX_DAYS * DAY_MS).toISOString();
  const winTo = new Date(now - BASELINE_WINDOW_MIN_DAYS * DAY_MS).toISOString();
  const target = now - BASELINE_TARGET_DAYS * DAY_MS;
  const windowRows = await selectPaged(() =>
    supabase
      .from('price_history')
      .select('product_id, price, fetched_at')
      .gte('fetched_at', winFrom)
      .lte('fetched_at', winTo)
  );
  const baselineByProduct = new Map(); // product_id -> {price, dist}
  for (const r of windowRows) {
    const dist = Math.abs(new Date(r.fetched_at).getTime() - target);
    const prev = baselineByProduct.get(r.product_id);
    if (!prev || dist < prev.dist) baselineByProduct.set(r.product_id, { price: Number(r.price), dist });
  }

  const stats = [];
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
      stats.push({ segment, current_avg_price: null, baseline_avg_price: null, pct_change: null, product_count: 0 });
      continue;
    }

    const currentAvg = median(matchedCurrent);
    const baselineAvg = median(matchedBaseline);
    stats.push({
      segment,
      current_avg_price: round2(currentAvg),
      baseline_avg_price: round2(baselineAvg),
      pct_change: round1(((currentAvg - baselineAvg) / baselineAvg) * 100),
      product_count: matchedCurrent.length,
    });
  }

  const computedAt = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from('market_stats')
    .upsert(stats.map((s) => ({ ...s, computed_at: computedAt })), { onConflict: 'segment' });
  if (upsertErr) throw upsertErr;

  for (const s of stats) {
    log(`Market stats ${s.segment}: current=$${s.current_avg_price} baseline=$${s.baseline_avg_price} change=${s.pct_change}% (n=${s.product_count})`);
  }

  return { stats, excluded, computedAt };
}

module.exports = { computeMarketStats, classifySegment, SEGMENTS };
