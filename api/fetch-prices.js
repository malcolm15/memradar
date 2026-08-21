// Daily price fetch — Keepa is the price data source (Best Buy access never
// came through; backend/lib/bestbuy.js is kept dormant pending approval).
//
// Flow: load the Amazon catalog from Supabase, fetch current stats from Keepa
// (batched, 1 token per ASIN), append ONE price_history row per in-stock
// product with fetched_at = now. History granularity stays daily: the backfill
// (scripts/backfill-keepa.js) loaded the past; this cron appends the present.
require('dotenv').config();

const supabase = require('../backend/lib/supabase');
const keepa = require('../backend/lib/keepa');
const { computeMarketStats } = require('../backend/lib/marketStats');
const { checkAlerts } = require('../backend/lib/alertCheck');
const { upsertAmazonOffers, lastKnownPrices } = require('../backend/lib/amazonOffers');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);
}

async function run() {
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
  try {
    const res = await computeMarketStats(supabase, fetchedAt, log);
    marketStats = res.stats;
  } catch (err) {
    statsError = err.message;
    logError('computeMarketStats FAILED (non-fatal, price inserts unaffected)', err);
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
    ...(statsError ? { market_stats_error: statsError } : {}),
    alerts: alertStats,
    errors,
    tokens_left: tokens.tokensLeft,
    duration_ms,
  };
}

module.exports = async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const summary = await run();
    res.status(200).json(summary);
  } catch (err) {
    logError('Unhandled exception in run()', err);
    res.status(500).json({ error: err.message });
  }
};

if (require.main === module) {
  run().then(summary => console.log('\nSummary:', JSON.stringify(summary, null, 2)));
}
