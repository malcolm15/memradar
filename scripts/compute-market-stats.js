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
    throw new Error('no cron batch found in the last 36h — has /api/fetch-prices run?');
  }
  return cronTs[0]; // newest first
}

async function run() {
  log('Market stats computation started');
  const batchTs = await latestCronBatch();
  log(`Using cron batch: ${batchTs}`);

  const { stats, excluded, computedAt } = await computeMarketStats(supabase, batchTs, log);

  console.log('\n==================== MARKET STATS ====================');
  console.log(`Computed at: ${computedAt}`);
  console.log(`Excluded from segments: ram=${excluded.ram}, ssd=${excluded.ssd}`);
  console.log('');
  console.log('segment    | current avg | baseline avg | change  | products');
  console.log('-----------+-------------+--------------+---------+---------');
  for (const s of stats) {
    console.log(
      `${s.segment.padEnd(10)} | $${String(s.current_avg_price ?? '—').padStart(9)} | $${String(s.baseline_avg_price ?? '—').padStart(10)} | ${String(s.pct_change === null ? '—' : (s.pct_change >= 0 ? '+' : '') + s.pct_change + '%').padStart(7)} | ${s.product_count}`
    );
  }
  console.log('\nRows upserted into market_stats (conflict on segment).');
}

run().catch((err) => {
  console.error(`[${new Date().toISOString()}] ERROR Market stats failed:`, err.message);
  process.exit(1);
});
