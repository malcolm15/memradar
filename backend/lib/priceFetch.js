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

async function runPriceFetch(opts = {}) {
  const log = opts.log || defaultLog;
  const logError = opts.logError || defaultLogError;
  // Default: recompute market stats only on the designated daily slot.
  const withMarketStats = opts.withMarketStats !== undefined
    ? opts.withMarketStats
    : new Date().getUTCHours() === MARKET_STATS_HOUR_UTC;
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
  let statsError = null;
  let marketStatsSkipped = false;
  let unstableFigures = null;
  if (!withMarketStats) {
    marketStatsSkipped = true;
    log(`Market stats skipped (recomputed once daily on the ${String(MARKET_STATS_HOUR_UTC).padStart(2, '0')}:00 UTC run)`);
  } else {
    try {
      const res = await computeMarketStats(supabase, fetchedAt, log);
      marketStats = res.stats;
      // Tripwire result rides the summary JSON so a cohort-sensitive figure
      // announces itself in the run that produced it, rather than waiting to
      // be looked up before someone quotes it.
      const shape = (u) => ({ segment: u.segment, period: u.period, pct_change: u.pct_change, moves_pp: u.stability_delta_pp });
      unstableFigures = {
        severe: (res.severe || []).map(shape),
        moderate: (res.unstable || []).filter((u) => !(res.severe || []).includes(u)).map(shape),
      };
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
    log(`Alerts: checked=${alertStats.checked} matched=${alertStats.matched} sent=${alertStats.sent} failed=${alertStats.failed} expired_cleaned=${alertStats.expired_cleaned}`);
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
    market_stats_skipped: marketStatsSkipped,
    unstable_figures: unstableFigures,
    ...(statsError ? { market_stats_error: statsError } : {}),
    alerts: alertStats,
    errors,
    tokens_left: tokens.tokensLeft,
    duration_ms,
  };
}

module.exports = { runPriceFetch, MARKET_STATS_HOUR_UTC };
