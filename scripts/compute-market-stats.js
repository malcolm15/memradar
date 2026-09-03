// Standalone Market Pulse stats runner — same logic as the daily cron step
// (shared via backend/lib/marketStats.js). Use to populate market_stats without
// waiting for the next cron, or to recompute manually.
//
// Finds the most recent CRON batch timestamp automatically, explicitly skipping
// backfill day-bucket rows (stamped T23:59:00) which can sort ahead of same-day
// cron rows.
//
// Usage: node scripts/compute-market-stats.js
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { computeMarketStats } = require('../backend/lib/marketStats');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function isDayBucket(ts) {
  return new Date(ts).toISOString().endsWith('T23:59:00.000Z');
}

// Newest real cron batch timestamp in the last 36h.
//
// The .limit(1000) is SAFE and deliberate - do NOT "fix" it into pagination.
// The query is ordered fetched_at DESCENDING, so the cap can only discard the
// OLDEST rows of the window, never the newest, and we take [0]. At the 6x
// cadence 36h holds ~2,100 rows, so truncation does happen; it is harmless by
// construction. Pagination here would fetch 2,100 rows to use exactly one.
async function latestCronBatch() {
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('price_history')
    .select('fetched_at')
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  const cronTs = data.map((r) => r.fetched_at).filter((ts) => !isDayBucket(ts));
  if (cronTs.length === 0) {
    throw new Error('no cron batch found in the last 36h — has the price fetch run?');
  }
  return cronTs[0]; // newest first
}

async function run() {
  log('Market stats computation started');
  const batchTs = await latestCronBatch();
  log(`Using cron batch: ${batchTs}`);

  const { stats, excluded, computedAt, claimFloors } = await computeMarketStats(supabase, batchTs, log);

  console.log('\n==================== MARKET STATS ====================');
  console.log(`Computed at: ${computedAt}`);
  console.log(`Excluded from segments: ram=${excluded.ram}, ssd=${excluded.ssd}`);
  console.log('');
  console.log('period | segment    | current med | baseline med | change  | products');
  console.log('-------+------------+-------------+--------------+---------+---------');
  let lastPeriod = null;
  for (const s of stats) {
    if (lastPeriod && s.period !== lastPeriod) console.log('-------+------------+-------------+--------------+---------+---------');
    lastPeriod = s.period;
    console.log(
      `${String(s.period).padEnd(6)} | ${s.segment.padEnd(10)} | $${String(s.current_avg_price ?? '—').padStart(9)} | $${String(s.baseline_avg_price ?? '—').padStart(10)} | ${String(s.pct_change === null ? '—' : (s.pct_change >= 0 ? '+' : '') + s.pct_change + '%').padStart(7)} | ${s.product_count}`
    );
  }
  console.log(`\n${stats.length} rows upserted into market_stats (conflict on segment,period).`);

  // Published-claim floors, printed in full here rather than only logged: this
  // runner is what a person invokes by hand before writing or reviewing copy,
  // and the headroom column is the number that matters when deciding whether a
  // sentence can stay as written.
  if (claimFloors && !claimFloors.error) {
    console.log('\n================= PUBLISHED CLAIM FLOORS =================');
    console.log('claim                              | floor | full   | stable | headroom');
    console.log('-----------------------------------+-------+--------+--------+---------');
    const row = (c, mark) => {
      const worst = c.figures.reduce((a, f) => (f.full_pct + f.stable_pct < a.full_pct + a.stable_pct ? f : a));
      const head = Math.min(...c.figures.flatMap((f) => [f.full_margin_pp, f.stable_margin_pp]));
      console.log(`${(mark + c.id).padEnd(34).slice(0, 34)} | ${(c.floor_pct + '%').padStart(5)} | ${(worst.full_pct + '%').padStart(6)} | ${(worst.stable_pct + '%').padStart(6)} | ${(head >= 0 ? '+' : '') + head}pp`);
    };
    claimFloors.breached.forEach((c) => row(c, '! '));
    claimFloors.ok.slice().sort((a, b) => a.min_margin_pp - b.min_margin_pp).forEach((c) => row(c, '  '));
    for (const u of claimFloors.unresolved) console.log(`? ${u.id}: ${u.reason}`);
    console.log(`\n${claimFloors.registered} claims registered, ${claimFloors.checked} checked, ${claimFloors.breached.length} breached, ${claimFloors.unresolved.length} unresolved.`);
    console.log('"full" and "stable" show the WORST required figure for that claim; headroom is the tightest margin across both cohorts.');
  }
}

run().catch((err) => {
  console.error(`[${new Date().toISOString()}] ERROR Market stats failed:`, err.message);
  process.exit(1);
});
