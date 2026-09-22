// Scheduled runner for the Amazon price fetch, invoked by
// .github/workflows/price-fetch.yml every 4 hours (00/04/08/12/16/20 UTC).
// Mirrors scripts/run-alert-check.js: thin wrapper, all logic in
// backend/lib/priceFetch.js.
//
// Market stats recompute on the 08:00 UTC slot OR when the stored figures are
// more than 20h old, and that decision belongs to priceFetch.js because its
// age half needs the database client (see shouldComputeStats there). This
// runner used to make the call itself and pass it in, which meant the library's
// own default was dead code and the fix had to be made in two places.
// --market-stats / --no-market-stats still force it either way for manual runs,
// and scripts/compute-market-stats.js remains available on demand at any hour.
//
// PRICE_FETCH_SUMMARY_PATH, when set, receives the run summary as JSON. The
// workflow step that opens claim-floor issues reads it from there: parsing it
// back out of stdout would break the first time a log line contained the word
// SUMMARY.
//
// Exits nonzero on failure so the Action shows a red run and GitHub emails.
// A failed run writes nothing further; the next run is at most 4 hours away.
require('dotenv').config();
const fs = require('fs');
const { runPriceFetch } = require('../backend/lib/priceFetch');
const gitState = require('../backend/lib/gitState');

const CONFIRM = process.argv.includes('--confirm');
const FORCE_STATS = process.argv.includes('--market-stats');
const SKIP_STATS = process.argv.includes('--no-market-stats');
const IGNORE_BEHIND = process.argv.includes('--i-know-im-behind');
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function main() {
  if (!CONFIRM) {
    console.log('Refusing to run without --confirm (this fetch spends Keepa tokens, writes price_history, and can send alert emails).');
    console.log(`Usage: node scripts/run-price-fetch.js --confirm [--market-stats|--no-market-stats] [--i-know-im-behind]`);
    process.exit(2);
  }
  const hour = new Date().getUTCHours();
  // Only pass the flag when a human forced it. Omitting it is what lets
  // priceFetch.js apply hour-or-age; passing a computed value would put the
  // gate back in two places.
  let opts = FORCE_STATS ? { withMarketStats: true } : SKIP_STATS ? { withMarketStats: false } : {};

  // STALE TREE GUARD. The published-claim check reads baked HTML off disk, so
  // running it against a tree that is behind upstream judges a page that is no
  // longer published. That is not hypothetical: claim_floor_runs id 1 recorded
  // a withdrawal from a one-commit-behind tree, hours after the regen had put
  // the finding back, and the row looked exactly like a real verdict.
  //
  // The PRICE FETCH is unaffected by staleness and still runs: refusing it
  // would trade a wrong verdict for missing prices. Only the stats step and the
  // claim check are refused, and loudly.
  const behind = gitState.behindCount();
  if (behind && !IGNORE_BEHIND) {
    log(`*** WORKING TREE IS ${behind} COMMIT(S) BEHIND UPSTREAM ***`);
    log('    Market stats and the published-claim check are REFUSED this run. The claim');
    log('    check reads baked HTML from this tree, so its verdict would describe pages');
    log('    that are no longer live. Prices will still be fetched and written.');
    log('    Fix: git pull. Override, if you really mean it: --i-know-im-behind');
    opts = { withMarketStats: false };
  } else if (behind && IGNORE_BEHIND) {
    log(`⚠ working tree is ${behind} commit(s) behind upstream and --i-know-im-behind was passed: any claim-floor verdict from this run describes THIS tree, not the live site`);
  }

  const treeLabel = gitState.label() || 'unknown (git unavailable)';
  log(`Price fetch starting (UTC hour ${hour}, tree ${treeLabel}, market stats ${opts.withMarketStats === true ? 'FORCED ON' : opts.withMarketStats === false ? 'off' : 'decided by hour-or-age'})`);

  const summary = await runPriceFetch(opts);
  console.log('SUMMARY ' + JSON.stringify(summary));

  // WRITTEN BEFORE THE ERROR CHECK BELOW, deliberately: a run with per-product
  // errors still produced a claim-floor result, and the step that opens issues
  // on a breach must not lose it because an unrelated product failed.
  const summaryPath = process.env.PRICE_FETCH_SUMMARY_PATH;
  if (summaryPath) {
    try {
      fs.writeFileSync(summaryPath, JSON.stringify(summary));
      log(`Summary written to ${summaryPath}`);
    } catch (err) {
      log(`⚠ could not write the summary to ${summaryPath}: ${err.message}`);
    }
  }

  if (summary.errors && summary.errors.length) {
    throw new Error(`${summary.errors.length} per-product error(s) during the fetch`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL:`, err.message);
  process.exit(1);
});
