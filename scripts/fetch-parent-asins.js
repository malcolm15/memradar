// Fetch Amazon parent ASINs for the whole catalog via Keepa (tier-1 family
// grouping). Keepa product objects expose `parentAsin`, the ASIN Amazon itself
// uses to group variant listings (capacities/colors/styles) - verified against
// Keepa's api_backend Product struct. `variations` (dimension attributes) is
// only populated on parent ASINs, so for our child ASINs we capture it
// opportunistically when present but never depend on it.
//
// Token budget: 1 token/ASIN, batched 100/call by the client => ~235 tokens.
// The keepa.js client handles tokensLeft/refill waits (same as the backfill).
//
// Dry-run by default (fetches from Keepa, writes nothing to Supabase).
// --confirm additionally writes products.parent_asin (requires the Phase-A DDL).
// Both modes write scripts/output/parent-asins.json so build-families.js can
// dry-run its clustering before the DDL/confirm step.
//
// Usage:
//   node scripts/fetch-parent-asins.js            # dry run + report
//   node scripts/fetch-parent-asins.js --confirm  # also persist parent_asin
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../backend/lib/supabase');
const keepa = require('../backend/lib/keepa');

const CONFIRM = process.argv.includes('--confirm');
const OUT_DIR = path.join(__dirname, 'output');
const OUT_PATH = path.join(OUT_DIR, 'parent-asins.json');

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function run() {
  log(`Parent-ASIN fetch started${CONFIRM ? '' : ' (DRY RUN - no Supabase writes; pass --confirm to persist)'}`);

  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, name, category')
    .eq('retailer', 'amazon')
    .order('id');
  if (error) throw new Error('products query: ' + error.message);
  log(`Catalog: ${products.length} products`);

  // history=0, stats=0: smallest payload; parentAsin is a base product field.
  const keepaProducts = await keepa.fetchProducts(
    products.map((p) => p.sku), { history: 0, stats: 0 }, log
  );
  const byAsin = new Map(keepaProducts.map((kp) => [kp.asin, kp]));

  const results = [];
  let withParent = 0, withVariations = 0;
  for (const p of products) {
    const kp = byAsin.get(p.sku);
    const parentAsin = kp && typeof kp.parentAsin === 'string' && kp.parentAsin.length ? kp.parentAsin : null;
    if (parentAsin) withParent++;
    if (kp && Array.isArray(kp.variations) && kp.variations.length) withVariations++;
    results.push({
      sku: p.sku,
      name: p.name,
      category: p.category,
      parentAsin,
      // validation-only capture; null for child ASINs per Keepa's docs
      variations: kp && Array.isArray(kp.variations) ? kp.variations : null,
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 1));
  log(`Wrote ${OUT_PATH} (${results.length} entries)`);

  // ---- report ----
  const parentGroups = new Map();
  for (const r of results) {
    if (!r.parentAsin) continue;
    (parentGroups.get(r.parentAsin) || parentGroups.set(r.parentAsin, []).get(r.parentAsin)).push(r);
  }
  const shared = [...parentGroups.entries()].filter(([, m]) => m.length >= 2);

  console.log('\n==================== PARENT-ASIN REPORT ====================');
  console.log(`Products with a parent ASIN:        ${withParent}/${products.length}`);
  console.log(`Products with variations captured:  ${withVariations} (expected 0 for child ASINs)`);
  console.log(`Distinct parents overall:           ${parentGroups.size}`);
  console.log(`Parents shared by 2+ catalog SKUs:  ${shared.length}  (= tier-1 families found)`);
  for (const [parent, members] of shared.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  parent ${parent} (${members.length} members):`);
    for (const m of members.sort((a, b) => a.sku.localeCompare(b.sku))) {
      console.log(`    - [${m.sku}] ${m.name.slice(0, 90)}`);
    }
  }

  if (CONFIRM) {
    let writes = 0, failures = 0;
    for (const p of products) {
      const r = results.find((x) => x.sku === p.sku);
      const { error: upErr } = await supabase
        .from('products')
        .update({ parent_asin: r.parentAsin })
        .eq('id', p.id);
      if (upErr) { console.error(`  write failed [${p.sku}]: ${upErr.message}`); failures++; continue; }
      writes++;
    }
    log(`parent_asin persisted: ${writes} writes, ${failures} failures`);
  } else {
    log('Dry run complete - nothing written to Supabase. Re-run with --confirm to persist.');
  }
  const t = keepa.getTokenState();
  log(`Keepa tokens left: ${t.tokensLeft}`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
