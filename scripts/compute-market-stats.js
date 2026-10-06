// Standalone Market Pulse stats runner: same logic as the daily cron step
// (shared via backend/lib/marketStats.js). Use to populate market_stats without
// waiting for the next cron, or to recompute manually.
//
// Finds the most recent CRON batch timestamp automatically, explicitly skipping
// backfill day-bucket rows (stamped T23:59:00) which can sort ahead of same-day
// cron rows.
//
// Usage: node scripts/compute-market-stats.js            computes and WRITES
//        node scripts/compute-market-stats.js --dry-run  computes and writes nothing
//
// --dry-run computes exactly as a normal run and prints the same two tables.
// WITH NO ARGUMENT THE BEHAVIOUR IS WHAT IT HAS ALWAYS BEEN: it upserts.
//
// THE FLAG IS IMPLEMENTED HERE, IN THE RUNNER, AND backend/lib/marketStats.js
// IS NOT TOUCHED. That module is shared with the SCHEDULED path
// (price-fetch.yml -> run-price-fetch.js -> priceFetch.js -> computeMarketStats
// on the 08:00 UTC slot), and a flag threaded through shared code is a flag
// that can one day be passed wrong there. Nothing in production calls this
// file. The write-intercepting-client shape is the one already proven in
// scripts/output/test-tripwire-flag.js.

// ---------------------------------------------------------------- arguments
// ARGUMENT VALIDATION IS THE FIRST EXECUTABLE THING IN THIS FILE: before
// dotenv, and before backend/lib/supabase, which calls createClient AT IMPORT
// TIME (supabase.js:3). So "a typo can never write" is true by construction. A
// mistyped --dryrun exits while no client object exists at all, rather than
// relying on execution happening not to reach the upsert.
const ARGV = process.argv.slice(2);
const ALLOWED = [[], ['--dry-run']];
if (!ALLOWED.some((a) => a.length === ARGV.length && a.every((v, i) => v === ARGV[i]))) {
  console.error(`compute-market-stats: unrecognised arguments: ${ARGV.join(' ') || '(none)'}`);
  console.error('Usage: node scripts/compute-market-stats.js [--dry-run]');
  console.error('  (no argument)  compute and upsert 24 market_stats rows');
  console.error('  --dry-run      compute, print the same tables, write nothing');
  process.exit(2);
}
const DRY_RUN = ARGV.length === 1;

require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { computeMarketStats } = require('../backend/lib/marketStats');

// One stamp for both banner lines. It is the RUNNER'S wall clock, and it is NOT
// an input to the calculation: there is no asOf abstraction in marketStats.js,
// which reads the clock independently at :148 (last complete month), :349
// (baseline window) and :495 (computed_at), as does latestCronBatch() below.
const AS_OF = new Date().toISOString();

// ------------------------------------------------------------- write guard
// RECURSIVE, by Proxy. Every builder the client returns is wrapped, and so is
// every builder a chain method returns, so a mutation is blocked at ANY depth
// of a read chain: from('x').select('*').update({}) and
// from('x').eq('a', 1).delete() both throw, not just a first-level call.
//
// Reads, ordinary chain methods and the builder's thenable behaviour pass
// through untouched. Property access uses the real builder as the receiver, so
// methods and getters that depend on `this` keep working, and a `then` result
// is returned as the Promise it is rather than being wrapped again.
//
// market_stats.upsert is INTERCEPTED AND RECORDED rather than thrown, because
// it is the write this flag exists to suppress and the run must continue past
// it to print the rest of the table. Every other mutation throws, because it
// would be a side effect the audit behind this flag never saw.
const MUTATIONS = ['insert', 'upsert', 'update', 'delete', 'rpc'];
const intercepted = [];

function dryRunClient(real) {
  const deny = (where, verb) => () => {
    throw new Error(`--dry-run blocked ${verb}() on ${where}. The audited call graph contains no such write; re-audit before trusting this flag.`);
  };

  const wrap = (builder, table) => new Proxy(builder, {
    get(target, prop) {
      if (prop === 'upsert' && table === 'market_stats') {
        return (rows) => {
          intercepted.push(`${table} x${Array.isArray(rows) ? rows.length : 1}`);
          return Promise.resolve({ data: null, error: null, status: 200, statusText: 'OK (dry run, nothing sent)' });
        };
      }
      if (typeof prop === 'string' && MUTATIONS.includes(prop)) return deny(`table "${table}"`, prop);
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const out = value.apply(target, args);
        if (out && typeof out === 'object' && !(out instanceof Promise)) return wrap(out, table);
        return out;
      };
    },
  });

  return {
    from: (table) => wrap(real.from(table), table),
    rpc: deny('the client', 'rpc'),
  };
}

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
    throw new Error('no cron batch found in the last 36h. Has the price fetch run?');
  }
  return cronTs[0]; // newest first
}

async function run() {
  if (DRY_RUN) console.log(`DRY RUN AS_OF=${AS_OF} NOTHING WRITTEN`);
  log(`Market stats computation started${DRY_RUN ? ' (dry run)' : ''}`);
  const batchTs = await latestCronBatch();
  log(`Using cron batch: ${batchTs}`);

  const client = DRY_RUN ? dryRunClient(supabase) : supabase;
  const { stats, excluded, computedAt, claimFloors } = await computeMarketStats(client, batchTs, log);

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
      `${String(s.period).padEnd(6)} | ${s.segment.padEnd(10)} | $${String(s.current_avg_price ?? 'n/a').padStart(9)} | $${String(s.baseline_avg_price ?? 'n/a').padStart(10)} | ${String(s.pct_change === null ? 'n/a' : (s.pct_change >= 0 ? '+' : '') + s.pct_change + '%').padStart(7)} | ${s.product_count}`
    );
  }
  console.log(DRY_RUN
    ? `\n${stats.length} rows WOULD have been upserted into market_stats (conflict on segment,period). Nothing was written.`
    : `\n${stats.length} rows upserted into market_stats (conflict on segment,period).`);

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

  if (DRY_RUN) {
    console.log(`\nWrites intercepted: ${intercepted.join(', ') || 'none'}`);
    console.log(`This run would have stamped computed_at=${new Date(computedAt).toISOString()}.`);
    console.log('The baseline window is built from Date.now(), so a dry run at a different hour can');
    console.log('produce different figures from the scheduled run. That difference is the clock, not a bug.');
    console.log(`DRY RUN AS_OF=${AS_OF} NOTHING WRITTEN`);
  }
}

// Exported so the write guard and the argument handling can be exercised
// against a fake client, with nothing touched. The require.main guard keeps
// that from running the computation, the same convention build-families.js
// uses; direct invocation behaves exactly as before.
module.exports = { dryRunClient, interceptedWrites: () => intercepted.slice() };

if (require.main === module) {
  run().catch((err) => {
    console.error(`[${new Date().toISOString()}] ERROR Market stats failed:`, err.message);
    process.exit(1);
  });
}
