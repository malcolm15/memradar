// Amazon price fetch (Keepa) - the core job, shared by the scheduled runner
// (scripts/run-price-fetch.js, invoked by .github/workflows/price-fetch.yml).
//
// Flow: load the Amazon catalog, fetch current stats from Keepa (batched, 1
// token per ASIN), append ONE price_history row per in-stock product with
// fetched_at = now, upsert Amazon current state into retailer_offers, then
// (conditionally) recompute market stats and run the alert check.
//
// CADENCE: every 4 hours at 00/04/08/12/16/20 UTC (6x/day, ~1,410 Keepa
// tokens/day against a ~28,800 budget). Moved off Vercel cron in Aug 2026:
// Vercel crons bind to the production deployment and an invocation during a
// deploy handover is dropped (forensically proven - two missed runs, each
// coinciding with pushes inside the window). Six entries would have meant six
// daily collision windows.
//
// MARKET STATS ARE DAILY, NOT PER-RUN. Segment medians are a daily statistic;
// recomputing them six times a day tells nobody anything new and costs ~127
// paginated round-trips each time. The runner passes withMarketStats=true only
// on the 08:00 UTC slot. scripts/compute-market-stats.js still recomputes on
// demand at any hour, independently of this flag.
require('dotenv').config();

const supabase = require('./supabase');
const keepa = require('./keepa');
const { computeMarketStats } = require('./marketStats');
const { checkAlerts } = require('./alertCheck');
const { upsertAmazonOffers, lastKnownPrices } = require('./amazonOffers');

const defaultLog = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const defaultLogError = (msg, err) => console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);

// The UTC hour whose run also recomputes market stats (one slot per day).
const MARKET_STATS_HOUR_UTC = 8;

// A recompute is ALSO due when the stored figures are older than this,
// whatever the hour. MEASURED 2026-09-22: the hour test alone missed 4 of the
// 12 complete days to 09-21 (09-14, 09-15, 09-17, 09-21). GitHub delivers
// scheduled runs late and sometimes drops a slot outright, so the 08:00 run
// arrived inside hour 9 and the entire stats step went with it: no market_stats
// update, no stability tripwire, and no published-claim check, on a third of
// the days, with nothing anywhere saying so. Three DDR4 claim breaches sat
// unread for two days because of it.
//
// 20 HOURS, NOT 24, AND THE 4-HOUR GRID IS THE REASON. After a compute at T,
// the slots at T+4h through T+16h all sit inside 20h and skip; the first one
// past it is T+20h or T+24h. So exactly one slot a day qualifies and never two.
const STATS_MAX_AGE_HOURS = 20;

// HOUR-OR-AGE. The hour is kept as the PREFERRED slot rather than replaced,
// because the 09:00 UTC regen reads these rows: a pure age rule would let the
// stats slot drift past 09:00 and leave the regen arguing from yesterday's
// figures, which is a different bug wearing the same clothes.
async function shouldComputeStats(log) {
  const hour = new Date().getUTCHours();
  const slot = `${String(MARKET_STATS_HOUR_UTC).padStart(2, '0')}:00 UTC`;
  if (hour === MARKET_STATS_HOUR_UTC) return { run: true, why: `this is the ${slot} slot` };

  const { data, error } = await supabase
    .from('market_stats')
    .select('computed_at')
    .order('computed_at', { ascending: false })
    .limit(1);

  if (error) {
    // NEVER SKIP SILENTLY. Falling back to the hour test means falling back to
    // a test we have already failed, so stats are off this run - and saying so
    // out loud is the whole point, because unannounced silence is the failure
    // this change exists to end.
    log(`⚠ market_stats age unreadable (${error.message}) - falling back to the hour test alone, which this run does not match, so stats are OFF and the published-claim check will NOT run`);
    return { run: false, why: `age query failed (${error.message}) and the hour is not ${slot}` };
  }

  const last = data && data[0] && data[0].computed_at;
  if (!last) return { run: true, why: 'no market_stats rows exist yet' };
  const ageHours = (Date.now() - new Date(last).getTime()) / 3600000;
  if (ageHours > STATS_MAX_AGE_HOURS) {
    return { run: true, why: `the last compute was ${ageHours.toFixed(1)}h ago, past the ${STATS_MAX_AGE_HOURS}h ceiling` };
  }
  return { run: false, why: `the last compute was ${ageHours.toFixed(1)}h ago, inside the ${STATS_MAX_AGE_HOURS}h ceiling` };
}

async function runPriceFetch(opts = {}) {
  const log = opts.log || defaultLog;
  const logError = opts.logError || defaultLogError;
  // Default: hour-or-age, decided here rather than by the caller, because the
  // age half needs the database client that lives in this module.
  let withMarketStats;
  let statsReason;
  if (opts.withMarketStats !== undefined) {
    withMarketStats = opts.withMarketStats;
    statsReason = `forced ${withMarketStats ? 'ON' : 'off'} by the caller`;
  } else {
    const decision = await shouldComputeStats(log);
    withMarketStats = decision.run;
    statsReason = decision.why;
  }
  const startTime = Date.now();
  log('Job started (source=keepa)');

  const errors = [];
  const counts = { ram: { catalog: 0, saved: 0 }, ssd: { catalog: 0, saved: 0 } };
  let outOfStock = 0;

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, category, product_url')
    .eq('retailer', 'amazon');
  if (prodErr) throw prodErr;
  for (const p of products) {
    if (counts[p.category]) counts[p.category].catalog++;
  }
  log(`Loaded ${products.length} amazon products from Supabase`);

  const byAsin = new Map(products.map((p) => [p.sku, p]));

  // history=0: we only need the stats block for current prices — same token
  // cost, much smaller payload.
  const keepaProducts = await keepa.fetchProducts(
    products.map((p) => p.sku),
    { history: 0, stats: 90 },
    log
  );
  log(`Fetched ${keepaProducts.length} products from Keepa`);

  const fetchedAt = new Date().toISOString();
  const currentPriceByProductId = new Map(); // for the alert-check step
  // Amazon current state for retailer_offers (see backend/lib/amazonOffers.js):
  // price_history stays an observation log, so "we looked and there was no
  // offer" is recorded here instead of vanishing.
  const offerEntries = [];   // in-stock products
  const oosProducts = [];    // {product_id, sku, product_url} with no offer
  for (const kp of keepaProducts) {
    const product = byAsin.get(kp.asin);
    if (!product) continue;
    try {
      const price = keepa.currentPrice(kp);
      if (price === null) {
        // No offer on ANY series: genuinely not purchasable. Record the state
        // (below) but write NO price_history row - nothing was observed - and
        // never feed it to the alert check, so we cannot alert on an
        // unbuyable item.
        outOfStock++;
        oosProducts.push({ product_id: product.id, sku: product.sku, product_url: product.product_url });
        continue;
      }
      const { error: insErr } = await supabase.from('price_history').insert({
        product_id: product.id,
        price,
        regular_price: keepa.statsMaxPrice(kp),
        in_stock: true,
        fetched_at: fetchedAt,
      });
      if (insErr) throw insErr;
      currentPriceByProductId.set(product.id, price);
      offerEntries.push({ product_id: product.id, sku: product.sku, product_url: product.product_url, price, inStock: true });
      if (counts[product.category]) counts[product.category].saved++;
    } catch (err) {
      errors.push({ sku: product.sku, error: err.message });
      logError(`SKU ${product.sku}`, err);
    }
  }

  // Amazon current state -> retailer_offers, BOTH directions: in-stock rows
  // carry the live price, out-of-stock rows keep the LAST KNOWN price so the
  // UI can show "last seen $X". Best effort: a failure here must never fail
  // the price fetch, which is the critical path.
  let amazonOffers = null;
  try {
    const lastKnown = await lastKnownPrices(supabase, oosProducts.map((p) => p.product_id));
    const oosEntries = oosProducts.map((p) => ({ ...p, price: lastKnown.get(p.product_id) ?? null, inStock: false }));
    const skippedNoPrice = oosEntries.filter((e) => e.price == null).length;
    amazonOffers = await upsertAmazonOffers(supabase, offerEntries.concat(oosEntries), log);
    amazonOffers.inStock = offerEntries.length;
    amazonOffers.outOfStock = oosEntries.length - skippedNoPrice;
    if (skippedNoPrice) amazonOffers.skippedNoKnownPrice = skippedNoPrice;
    log(`Amazon offers upserted: ${amazonOffers.writes} (${amazonOffers.inStock} in stock, ${amazonOffers.outOfStock} out of stock), failures: ${amazonOffers.failures}`);
  } catch (err) {
    logError('Amazon retailer_offers upsert FAILED (non-fatal, price inserts unaffected)', err);
  }

  // Market Pulse stats — best effort: price inserts are the critical path, a
  // stats failure must log loudly but never fail the cron response.
  let marketStats = null;
  let marketStatsComputedAt = null;
  let statsError = null;
  let marketStatsSkipped = false;
  let unstableFigures = null;
  let claimFloors = null;
  if (!withMarketStats) {
    marketStatsSkipped = true;
    log(`Market stats skipped: ${statsReason}`);
  } else {
    log(`Market stats ON: ${statsReason}`);
    try {
      const res = await computeMarketStats(supabase, fetchedAt, log);
      marketStats = res.stats;
      // The returned rows do NOT carry computed_at (it is added on the way to
      // the table, not to the in-memory objects), so it is surfaced separately
      // rather than dug out of a row that does not have it. Consumers of the
      // summary need it to date a claim-floor verdict.
      marketStatsComputedAt = res.computedAt;
      // Tripwire result rides the summary JSON so a cohort-sensitive figure
      // announces itself in the run that produced it, rather than waiting to
      // be looked up before someone quotes it.
      // moves_pp stays UNSIGNED in the summary: it is the tripwire's "how far does
      // this move" reading and readers of the JSON compare it against the 5/15pp
      // lines. The signed figure it came from is reported as stable_pct, which is
      // the more useful number anyway.
      const shape = (u) => ({ segment: u.segment, period: u.period, pct_change: u.pct_change, moves_pp: Math.abs(u.stability_delta_pp), stable_pct: u.stable_pct_change });
      unstableFigures = {
        // A DISABLED tripwire is reported as loudly as a firing one: absent
        // this field, "severe: []" is indistinguishable from "we never looked".
        disabled: res.tripwireDisabled === true,
        severe: (res.severe || []).map(shape),
        moderate: (res.unstable || []).filter((u) => !(res.severe || []).includes(u)).map(shape),
      };
      if (res.tripwireDisabled) log('SUMMARY WILL REPORT: unstable_figures.disabled=true (tripwire column missing)');

      // PUBLISHED-CLAIM FLOORS ride the summary as their OWN field, not folded
      // into unstable_figures. The two answer different questions - "is this
      // figure safe to quote" versus "is a sentence we already published still
      // true" - and a breach demands a specific action (reword that sentence)
      // that a stability flag does not. Merging them would bury the actionable
      // one inside a field people have learned reads as advisory.
      const c = res.claimFloors || {};
      claimFloors = {
        breached: c.breached || [],
        unresolved: c.unresolved || [],
        // Withdrawn findings ride the summary too: "no breaches" must not be
        // indistinguishable from "a finding quietly stopped being published".
        withdrawn: c.withdrawn || [],
        // PASSING entries ride it as well, trimmed. Without them a consumer can
        // see that a claim is broken but never that it has recovered, so an
        // issue opened on a breach could be opened and never closed. Trimmed
        // rather than whole because `where` and the sentence are already on the
        // issue and the margins are what a resolution comment states.
        ok: (c.ok || []).map((o) => ({
          id: o.id,
          page: o.page,
          sentence: o.sentence,
          floor_pct: o.floor_pct,
          floor_source: o.floor_source,
          min_margin_pp: o.min_margin_pp,
          figures: o.figures,
        })),
        checked: c.checked ?? 0,
        registered: c.registered ?? 0,
        ...(c.error ? { error: c.error } : {}),
      };
      if (claimFloors.breached.length) {
        log(`SUMMARY WILL REPORT: claim_floors.breached=${claimFloors.breached.length} (published sentences need rewording)`);
      }

      // PERSISTED, INCLUDING CLEAN RUNS. Nothing else survives a run:
      // market_stats is overwritten, and the summary lives only in the job log.
      // On 2026-09-22 that made "when did this breach start?" unanswerable
      // about a breach that was already two days old. Writing OK runs too is
      // what makes the ABSENCE of a row for a day a signal in itself.
      // Best effort inside the existing try: a failed insert must never cost
      // the price inserts, and the result is still in this log and the summary.
      const cfStatus = claimFloors.error ? 'error'
        : claimFloors.breached.length ? 'breached'
        : claimFloors.unresolved.length ? 'unresolved'
        : 'ok';
      // Withdrawals are NOT a status: a run whose only note is a withdrawal is
      // a clean run, exactly as the registry's own logging reads it. The
      // withdrawn array carries the detail.
      const okRows = (c.ok || []).slice().sort((a, b) => a.min_margin_pp - b.min_margin_pp);
      const { error: cfErr } = await supabase.from('claim_floor_runs').insert({
        ran_at: new Date().toISOString(),
        computed_at: res.computedAt,
        status: cfStatus,
        checked: claimFloors.checked,
        ok_count: okRows.length,
        // The tightest margin, not all 12 passing entries: it is the only part
        // of a clean result anyone acts on, and it is how a claim creeping
        // toward its floor becomes visible before it goes through.
        tightest: okRows[0] ? { id: okRows[0].id, min_margin_pp: okRows[0].min_margin_pp, floor_pct: okRows[0].floor_pct } : null,
        breached: claimFloors.breached,
        unresolved: claimFloors.unresolved,
        withdrawn: claimFloors.withdrawn,
      });
      if (cfErr) {
        log(`⚠ claim_floor_runs insert failed (${cfErr.message}) - the check DID run and its result is in this log and in the summary, but there is no persisted record of this run`);
      } else {
        log(`claim_floor_runs: recorded status=${cfStatus} checked=${claimFloors.checked} breached=${claimFloors.breached.length} withdrawn=${claimFloors.withdrawn.length}`);
      }
    } catch (err) {
      statsError = err.message;
      logError('computeMarketStats FAILED (non-fatal, price inserts unaffected)', err);
    }
  }

  // Alert check — best effort: isolated so an alert failure never fails the
  // cron (price inserts are the critical path).
  let alertStats = null;
  try {
    alertStats = await checkAlerts(supabase, currentPriceByProductId, log, logError);
    log(`Alerts: checked=${alertStats.checked} matched=${alertStats.matched} sent=${alertStats.sent} failed=${alertStats.failed} expired_cleaned=${alertStats.expired_cleaned} deleted_after_send=${alertStats.deleted_after_send} stale_cleaned=${alertStats.stale_cleaned} triggered_swept=${alertStats.triggered_swept}`);
  } catch (err) {
    logError('checkAlerts FAILED (non-fatal, price inserts unaffected)', err);
  }

  const duration_ms = Date.now() - startTime;
  const tokens = keepa.getTokenState();

  log(`RAM: ${counts.ram.catalog} in catalog, ${counts.ram.saved} saved`);
  log(`SSD: ${counts.ssd.catalog} in catalog, ${counts.ssd.saved} saved`);
  log(`Out of stock (no row written): ${outOfStock}`);
  if (errors.length > 0) log(`Errors: ${errors.length}`);
  log(`Job completed in ${duration_ms}ms (tokensLeft=${tokens.tokensLeft})`);

  return {
    success: true,
    source: 'keepa',
    ram: counts.ram,
    ssd: counts.ssd,
    out_of_stock: outOfStock,
    amazon_offers: amazonOffers,
    market_stats: marketStats,
    market_stats_computed_at: marketStatsComputedAt,
    market_stats_skipped: marketStatsSkipped,
    unstable_figures: unstableFigures,
    claim_floors: claimFloors,
    ...(statsError ? { market_stats_error: statsError } : {}),
    alerts: alertStats,
    errors,
    tokens_left: tokens.tokensLeft,
    duration_ms,
  };
}

module.exports = { runPriceFetch, MARKET_STATS_HOUR_UTC };
