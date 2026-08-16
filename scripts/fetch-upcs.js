// Fetch UPC/EAN/GTIN identifiers from Keepa for products with no Newegg
// match (no retailer_offers row) and store them in products.upc, feeding the
// tier-1.5 UPC rescue matcher in match-newegg.js.
//
// WHY: the Newegg feed sometimes puts UPC barcodes in the MPN column (proved
// by the FURY Beast case at Gate 1), and always carries a GTIN in column 24.
// A UPC join rescues legitimate products that MPN equality can't reach.
//
// Keepa identifier fields (verified empirically against a live product
// object, docs page is bot-blocked): upcList (12-digit UPC-A), eanList
// (13-digit EAN-13), gtinList (14-digit GTIN-14) - the same barcode appears
// in all three at different zero-paddings. Canonical form both here and in
// the matcher: strip leading zeros.
//
// products.upc stores the deduped normalized identifiers comma-joined
// (a product legitimately carries several: kit vs single-unit codes etc).
//
// Cost: 1 Keepa token per ASIN (~120 for the current unmatched set).
//
// Usage:
//   node scripts/fetch-upcs.js             # dry run: fetch + report, no write
//   node scripts/fetch-upcs.js --confirm   # write products.upc
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { fetchProducts } = require('../backend/lib/keepa');
const { normBarcode } = require('../backend/lib/productParsers');

const CONFIRM = process.argv.includes('--confirm');
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function run() {
  log(`UPC fetch started${CONFIRM ? '' : ' (DRY RUN - nothing written)'}`);

  const { data: products, error } = await supabase
    .from('products').select('id, sku, name').eq('retailer', 'amazon').order('id');
  if (error) throw new Error(error.message);
  const { data: offers, error: oErr } = await supabase
    .from('retailer_offers').select('product_id');
  if (oErr) throw new Error(oErr.message);
  const matched = new Set(offers.map((o) => o.product_id));
  const unmatched = products.filter((p) => !matched.has(p.id));
  log(`Products: ${products.length} total, ${matched.size} with a retailer offer, ${unmatched.length} unmatched (UPC targets)`);

  const raw = await fetchProducts(unmatched.map((p) => p.sku), { history: 0, stats: 90 }, log);
  const bySku = new Map(raw.map((r) => [r.asin, r]));

  let withUpc = 0, without = [];
  const updates = [];
  for (const p of unmatched) {
    const k = bySku.get(p.sku);
    const codes = [...new Set([
      ...(k && k.upcList || []),
      ...(k && k.eanList || []),
      ...(k && k.gtinList || []),
    ].map(normBarcode).filter((c) => c.length >= 8))];
    if (codes.length) {
      withUpc++;
      updates.push({ id: p.id, sku: p.sku, upc: codes.join(',') });
    } else {
      without.push(p.sku);
    }
  }
  log(`Coverage: ${withUpc}/${unmatched.length} unmatched products have at least one barcode identifier`);
  if (without.length) log(`No identifier: ${without.join(', ')}`);
  console.log('sample:', updates.slice(0, 5).map((u) => `${u.sku}=${u.upc}`).join('  '));

  if (!CONFIRM) { log('Dry run complete - re-run with --confirm to write products.upc'); return; }
  let writes = 0, failures = 0;
  for (const u of updates) {
    const { error: upErr } = await supabase.from('products').update({ upc: u.upc }).eq('id', u.id);
    if (upErr) { console.error(`  write failed [${u.sku}]: ${upErr.message}`); failures++; continue; }
    writes++;
  }
  log(`products.upc written: ${writes}, failures: ${failures}`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
