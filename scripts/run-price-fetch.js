// Scheduled runner for the Amazon price fetch, invoked by
// .github/workflows/price-fetch.yml every 4 hours (00/04/08/12/16/20 UTC).
// Mirrors scripts/run-alert-check.js: thin wrapper, all logic in
// backend/lib/priceFetch.js.
//
// Market stats recompute on the 08:00 UTC slot only (see priceFetch.js);
// --market-stats / --no-market-stats force it either way for manual runs, and
// scripts/compute-market-stats.js remains available on demand at any hour.
//
// Exits nonzero on failure so the Action shows a red run and GitHub emails.
// A failed run writes nothing further; the next run is at most 4 hours away.
require('dotenv').config();
const { runPriceFetch, MARKET_STATS_HOUR_UTC } = require('../backend/lib/priceFetch');

const CONFIRM = process.argv.includes('--confirm');
const FORCE_STATS = process.argv.includes('--market-stats');
const SKIP_STATS = process.argv.includes('--no-market-stats');
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function main() {
  if (!CONFIRM) {
    console.log('Refusing to run without --confirm (this fetch spends Keepa tokens, writes price_history, and can send alert emails).');
    console.log(`Usage: node scripts/run-price-fetch.js --confirm [--market-stats|--no-market-stats]`);
    process.exit(2);
  }
  const hour = new Date().getUTCHours();
  const withMarketStats = FORCE_STATS ? true : SKIP_STATS ? false : hour === MARKET_STATS_HOUR_UTC;
  log(`Price fetch starting (UTC hour ${hour}, market stats ${withMarketStats ? 'ON' : 'off'})`);

  const summary = await runPriceFetch({ withMarketStats });
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (summary.errors && summary.errors.length) {
    throw new Error(`${summary.errors.length} per-product error(s) during the fetch`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL:`, err.message);
  process.exit(1);
});
