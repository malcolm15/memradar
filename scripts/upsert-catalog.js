// Upserts the reviewed product catalog (scripts/output/catalog-preview.json)
// into the Supabase `products` table. Conflict on `sku` (same upsert pattern as
// api/fetch-prices.js). Does NOT touch `price_history` — the prices in the
// preview are point-in-time search snapshots, not history; history comes from
// Keepa in a later step.
//
// SAFETY: dry-run by default. It reads the preview and prints exactly what it
// WOULD write, but writes nothing unless you pass --confirm.
//
// Usage:
//   node scripts/upsert-catalog.js            # dry run (no DB writes)
//   node scripts/upsert-catalog.js --confirm  # actually upsert
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../backend/lib/supabase');

const PREVIEW_PATH = path.join(__dirname, 'output', 'catalog-preview.json');
const CONFIRM = process.argv.includes('--confirm');
const CHUNK = 200;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);
}

// Map a preview product to a `products` row — DB columns only. Drops the
// reviewer-only `_price_seen` field; leaves `model` and timestamps to defaults.
function toRow(p) {
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    brand: p.brand || null,
    image_url: p.image_url || null,
    product_url: p.product_url,
    retailer: p.retailer || 'amazon',
  };
}

function tally(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] || '(null)';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function printTally(label, rows) {
  console.log(`\n-- ${label}: ${rows.length} total --`);
  console.log('  by category:');
  Object.entries(tally(rows, 'category')).sort().forEach(([k, v]) => console.log(`    ${k.padEnd(8)} ${v}`));
  console.log('  by brand:');
  Object.entries(tally(rows, 'brand')).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${String(k).padEnd(16)} ${v}`));
}

async function run() {
  log(`Catalog upsert started${CONFIRM ? '' : ' (DRY RUN — no DB writes; pass --confirm to write)'}`);

  if (!fs.existsSync(PREVIEW_PATH)) throw new Error(`preview not found: ${PREVIEW_PATH} — run build-catalog.js first`);
  const payload = JSON.parse(fs.readFileSync(PREVIEW_PATH, 'utf8'));
  const products = Array.isArray(payload.products) ? payload.products : [];
  if (products.length === 0) throw new Error('no products in preview');

  const rows = products.map(toRow);

  // Guard: required NOT NULL columns must be present.
  const bad = rows.filter((r) => !r.sku || !r.name || !r.category || !r.product_url);
  if (bad.length) {
    throw new Error(`${bad.length} rows missing required fields (sku/name/category/product_url) — aborting`);
  }

  // Guard: duplicate SKUs within the file would make the upsert nondeterministic.
  const seen = new Set();
  const dupes = [];
  for (const r of rows) {
    if (seen.has(r.sku)) dupes.push(r.sku);
    seen.add(r.sku);
  }
  if (dupes.length) throw new Error(`duplicate SKUs in preview: ${dupes.slice(0, 5).join(', ')}${dupes.length > 5 ? '…' : ''}`);

  log(`Loaded ${rows.length} products from ${PREVIEW_PATH}`);
  printTally('To upsert (from preview)', rows);

  if (!CONFIRM) {
    console.log('');
    log('DRY RUN complete — nothing was written. Re-run with --confirm to upsert into Supabase.');
    return;
  }

  // Upsert in chunks, conflict on sku (additive: inserts new, updates existing).
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('products')
      .upsert(chunk, { onConflict: 'sku' })
      .select('id');
    if (error) throw error;
    upserted += data ? data.length : chunk.length;
    log(`Upserted chunk ${Math.floor(i / CHUNK) + 1}: ${chunk.length} rows`);
  }
  log(`Upsert complete: ${upserted} rows upserted (conflict on sku). price_history untouched.`);

  // Verify against the live table (includes any pre-existing seed rows).
  const { data: dbRows, error: qErr } = await supabase.from('products').select('sku, category, brand');
  if (qErr) throw qErr;
  printTally('Products table now (live query)', dbRows);
}

run().catch((err) => {
  logError('Catalog upsert failed', err);
  process.exit(1);
});
