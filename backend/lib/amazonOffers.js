// Amazon current-state offers in `retailer_offers` (retailer='amazon').
//
// DATA MODEL RULE: `price_history` is an OBSERVATION LOG (one row per real
// price sighting, append-only, never edited); `retailer_offers` is CURRENT
// PER-RETAILER STATE (exactly one row per product+retailer, upserted). Stock
// availability is current state, so it lives here - never inferred from the
// newest log row, which cannot express "we looked and there was no offer".
//
// Why this exists: keepa.currentPrice() returns null when every series
// (AMAZON, NEW, BUY_BOX_SHIPPING) reports -1, i.e. nothing is purchasable.
// The fetch cron used to just skip those products, so the last in-stock log
// row survived forever and PDPs claimed "In Stock" indefinitely.
//
// STOCK SEMANTICS: in_stock reflects availability of THE OFFER WHOSE PRICE WE
// DISPLAY, not Amazon-first-party availability. Measured Aug 2026: 159 of 235
// catalog products are priced from the NEW (marketplace) series, so defining
// stock as "Amazon sells it directly" would mark 68% of the catalog
// unavailable while it is plainly buyable. in_stock = (currentPrice() !== null).
//
// OOS rows KEEP the last known price so the UI can show "last seen $X"
// (struck through); the row is never deleted and never carries a null price.
const RETAILER = 'amazon';
const MATCH_METHOD = 'direct'; // not a matched offer: it IS the tracked product

// entries: [{ product_id, sku, product_url, price, inStock }]
// price must already be the value to store (live price when in stock, last
// known price when out of stock).
async function upsertAmazonOffers(supabase, entries, log = () => {}) {
  let writes = 0, failures = 0;
  const now = new Date().toISOString();
  for (const e of entries) {
    if (e.price == null) continue; // never write a null price (schema + honesty)
    const { error } = await supabase.from('retailer_offers').upsert({
      product_id: e.product_id,
      retailer: RETAILER,
      retailer_sku: e.sku,
      match_method: MATCH_METHOD,
      product_url: e.product_url,
      price: e.price,
      in_stock: e.inStock,
      fetched_at: now,
    }, { onConflict: 'product_id,retailer' });
    if (error) { log(`amazon offer upsert failed [${e.sku}]: ${error.message}`); failures++; continue; }
    writes++;
  }
  return { writes, failures };
}

// Last known price for products going out of stock: prefer the existing
// offer row, fall back to the newest price_history observation.
async function lastKnownPrices(supabase, productIds) {
  const out = new Map();
  if (!productIds.length) return out;
  const { data: offers } = await supabase
    .from('retailer_offers').select('product_id, price')
    .eq('retailer', RETAILER).in('product_id', productIds);
  (offers || []).forEach((o) => { if (o.price != null) out.set(o.product_id, Number(o.price)); });
  const missing = productIds.filter((id) => !out.has(id));
  for (const id of missing) {
    const { data } = await supabase
      .from('price_history').select('price, fetched_at')
      .eq('product_id', id).order('fetched_at', { ascending: false }).limit(1);
    if (data && data.length) out.set(id, Number(data[0].price));
  }
  return out;
}

module.exports = { RETAILER, MATCH_METHOD, upsertAmazonOffers, lastKnownPrices };
