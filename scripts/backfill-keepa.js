// One-time historical backfill: pull full Keepa price history for the Amazon
// catalog and load it into price_history at daily granularity.
//
// - Reads all products where retailer='amazon' (sku = ASIN)
// - Fetches Keepa history in batches of 100 ASINs (1 token each; the client
//   waits for refill on our 20 tokens/min plan when the bucket runs low)
// - Downsamples to at most one point per product per calendar day (UTC, last
//   reading of the day) — charts are daily-granularity, storing every
//   fluctuation bloats the table for no display value
// - Gap days (-1 in the series) carry the last known price with in_stock=false
//   (price is NOT NULL in the schema); leading gaps with no prior price are skipped
// - regular_price = max stored price in the trailing 90 days (or null)
// - Idempotent: with --confirm, each product's existing price_history rows are
//   deleted before its new rows are inserted (full replace semantics)
//
// SAFETY: dry-run by default — fetches from Keepa (consumes tokens) but writes
// NOTHING to Supabase. Pass --confirm to write.
//
// Usage:
//   node scripts/backfill-keepa.js            # dry run
//   node scripts/backfill-keepa.js --confirm  # delete + insert for real
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const keepa = require('../backend/lib/keepa');

const CONFIRM = process.argv.includes('--confirm');
const BATCH = 100;
const INSERT_CHUNK = 500;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

// Downsample parsed points to daily rows for one product. Points are
// chronological; last reading of each UTC day wins. Gap days carry the last
// known price with in_stock=false.
function toDailyRows(productId, points) {
  const byDay = new Map(); // dayKey -> last point of that day
  for (const p of points) byDay.set(dayKey(p.date), p);

  const rows = [];
  let lastKnownPrice = null;
  for (const [day, p] of byDay) {
    if (p.price === null) {
      if (lastKnownPrice === null) continue; // leading gap — nothing to carry
      rows.push({ product_id: productId, price: lastKnownPrice, in_stock: false, fetched_at: `${day}T23:59:00.000Z` });
    } else {
      lastKnownPrice = p.price;
      rows.push({ product_id: productId, price: p.price, in_stock: true, fetched_at: `${day}T23:59:00.000Z` });
    }
  }

  // regular_price: max stored price in the trailing 90 days, applied per row set.
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const recent = rows.filter((r) => new Date(r.fetched_at).getTime() >= cutoff && r.in_stock);
  const regularPrice = recent.length ? Math.max(...recent.map((r) => r.price)) : null;
  for (const r of rows) r.regular_price = regularPrice;

  return rows;
}

function printSample(product, rows) {
  console.log(`\n-- Sample: ${product.sku} — ${product.name.slice(0, 70)} --`);
  const show = (r) => `   ${r.fetched_at.slice(0, 10)}  $${String(r.price).padStart(8)}  in_stock=${r.in_stock}  regular=$${r.regular_price}`;
  const head = rows.slice(0, 5);
  const tail = rows.length > 10 ? rows.slice(-5) : rows.slice(head.length);
  head.forEach((r) => console.log(show(r)));
  if (rows.length > 10) console.log(`   ... (${rows.length - 10} rows omitted) ...`);
  tail.forEach((r) => console.log(show(r)));
}

async function flushInsert(buffer) {
  let inserted = 0;
  for (let i = 0; i < buffer.length; i += INSERT_CHUNK) {
    const chunk = buffer.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from('price_history').insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
}

async function run() {
  const startTime = Date.now();
  log(`Keepa backfill started${CONFIRM ? '' : ' (DRY RUN — no DB writes; pass --confirm to write)'}`);

  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, name')
    .eq('retailer', 'amazon')
    .order('id');
  if (error) throw error;
  log(`Loaded ${products.length} amazon products from Supabase`);

  const byAsin = new Map(products.map((p) => [p.sku, p]));
  const asins = products.map((p) => p.sku);

  const startTokens = keepa.getTokenState().tokensLeft;
  const keepaProducts = await keepa.fetchProducts(asins, { history: 1, stats: 90 }, log);
  log(`Fetched ${keepaProducts.length} products from Keepa`);

  const returnedAsins = new Set(keepaProducts.map((kp) => kp.asin));
  const missing = asins.filter((a) => !returnedAsins.has(a));
  if (missing.length) log(`Keepa returned no data for ${missing.length} ASINs: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);

  let processed = 0;
  let totalRows = 0;
  let totalOutliers = 0;
  const failures = [];
  let sampled = false;

  for (const kp of keepaProducts) {
    const product = byAsin.get(kp.asin);
    if (!product) continue;
    try {
      const parsed = keepa.parsePriceHistory(kp);
      const rows = toDailyRows(product.id, parsed.points);
      totalOutliers += parsed.outliersDropped;

      log(`${product.sku}: ${parsed.points.length} points parsed, ${parsed.outliersDropped} outliers dropped, ${rows.length} days stored`);

      if (!sampled && rows.length >= 10) {
        printSample(product, rows);
        sampled = true;
      }

      if (CONFIRM && rows.length > 0) {
        const { error: delErr } = await supabase.from('price_history').delete().eq('product_id', product.id);
        if (delErr) throw delErr;
        totalRows += await flushInsert(rows);
      } else {
        totalRows += rows.length;
      }
      processed++;
    } catch (err) {
      failures.push({ sku: product.sku, error: err.message });
      logError(`${product.sku}`, err);
    }
  }

  const tokens = keepa.getTokenState();
  const duration_ms = Date.now() - startTime;

  console.log('\n==================== BACKFILL SUMMARY ====================');
  console.log(`Mode:               ${CONFIRM ? 'CONFIRMED (rows written)' : 'DRY RUN (no writes)'}`);
  console.log(`Products processed: ${processed}/${products.length}`);
  console.log(`Rows ${CONFIRM ? 'inserted' : 'that would be inserted'}: ${totalRows}`);
  console.log(`Outliers dropped:   ${totalOutliers}`);
  console.log(`Keepa no-data ASINs: ${missing.length}`);
  console.log(`Tokens consumed:    ~${asins.length} (started ${startTokens === null ? 'unknown' : startTokens}, now ${tokens.tokensLeft})`);
  console.log(`Failures:           ${failures.length}`);
  failures.forEach((f) => console.log(`   - ${f.sku}: ${f.error}`));
  console.log(`Duration:           ${Math.round(duration_ms / 1000)}s`);
  if (!CONFIRM) console.log('\nDry run complete — nothing was written. Re-run with --confirm to load.');
}

run().catch((err) => {
  logError('Backfill failed', err);
  process.exit(1);
});
