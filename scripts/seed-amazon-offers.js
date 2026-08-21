// One-time seed of Amazon current state into retailer_offers (retailer='amazon').
//
// The fetch-prices cron maintains this going forward; this script fills in the
// initial state so PDPs are correct on the very next regeneration instead of
// waiting for a fetch cycle. Safe to re-run: it upserts on (product_id, retailer).
//
// It does a live Keepa read and writes ONLY retailer_offers - never
// price_history, which is the cron's observation log (see CLAUDE.md's data
// model rule and backend/lib/amazonOffers.js).
//
// Usage:
//   node scripts/seed-amazon-offers.js             # dry run: report only
//   node scripts/seed-amazon-offers.js --confirm   # write
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const keepa = require('../backend/lib/keepa');
const { upsertAmazonOffers, lastKnownPrices } = require('../backend/lib/amazonOffers');

const CONFIRM = process.argv.includes('--confirm');
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function run() {
  log(`Amazon offer seed${CONFIRM ? '' : ' (DRY RUN - nothing written)'}`);
  const { data: products, error } = await supabase
    .from('products').select('id, sku, name, product_url').eq('retailer', 'amazon').order('id');
  if (error) throw new Error(error.message);
  log(`Products: ${products.length}`);

  const kps = await keepa.fetchProducts(products.map((p) => p.sku), { history: 0, stats: 90 }, log);
  const byAsin = new Map(kps.map((k) => [k.asin, k]));

  const inStock = [], oos = [];
  for (const p of products) {
    const kp = byAsin.get(p.sku);
    const price = kp ? keepa.currentPrice(kp) : null;
    if (price === null) oos.push({ product_id: p.id, sku: p.sku, product_url: p.product_url, name: p.name });
    else inStock.push({ product_id: p.id, sku: p.sku, product_url: p.product_url, price, inStock: true });
  }
  const lastKnown = await lastKnownPrices(supabase, oos.map((p) => p.product_id));
  const oosEntries = oos.map((p) => ({ ...p, price: lastKnown.get(p.product_id) ?? null, inStock: false }));

  log(`In stock: ${inStock.length} | Out of stock: ${oosEntries.length}`);
  oosEntries.forEach((e) => console.log(`   OOS ${e.sku}  last known ${e.price == null ? '(none - will skip)' : '$' + e.price}  ${(e.name || '').slice(0, 50)}`));

  if (!CONFIRM) { log('Dry run complete - re-run with --confirm to write.'); return; }
  const res = await upsertAmazonOffers(supabase, inStock.concat(oosEntries), log);
  log(`retailer_offers amazon rows written: ${res.writes}, failures: ${res.failures}`);
  if (res.failures) throw new Error(`${res.failures} upserts failed`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
