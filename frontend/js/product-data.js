// Shared product-data loader: the three-query live-price pattern used by both
// the listing pages (product-listing.js) and the homepage "Biggest Price
// Drops" section (home-drops.js).
//
// load(sb, category?) fetches products (optionally scoped to a category), their
// latest price (12h window -> newest per product) and a 30-day-ago baseline
// (28-32d window -> closest per product), all client-reduced (no N+1). Returns
// each product with .price (number|null) and .change30 (percent|null).
//
// WINDOW SIZES TRACK THE FETCH CADENCE (every 4 hours, 6x/day). They were 48h
// and 25-35d at the old 2x cadence; at 6x those same spans would pull 3x the
// rows (the homepage baseline alone went to ~14,100 rows / 15 paginated
// requests) to derive exactly one row per product. The narrowed windows hold
// MORE sightings than the old wide ones did: 12h covers 3 runs (vs 4 in 48h at
// 2x) and 28-32d covers ~24 (vs 20 in 25-35d at 2x), so gap tolerance improved
// while cost dropped. Widen them again if the cadence ever slows.
//
// If the catalog grows past ~500 products, move the price joins to a Postgres
// RPC/view (same note as the listing pages).
window.memradarProductData = (function () {
  var PAGE = 1000;
  var DAY_MS = 86400000;
  var LATEST_WINDOW_H = 12;  // covers 3 runs at the 4-hourly cadence
  var BASELINE_MIN_D = 28;   // 30-day baseline, +/- 2 days of tolerance
  var BASELINE_MAX_D = 32;

  async function pagedSelect(build) {
    var out = [];
    for (var from = 0; ; from += PAGE) {
      var res = await build().range(from, from + PAGE - 1);
      if (res.error) throw res.error;
      out = out.concat(res.data);
      if (res.data.length < PAGE) break;
    }
    return out;
  }
  function reduceNewest(rows) {
    var m = new Map();
    rows.forEach(function (r) {
      var prev = m.get(r.product_id);
      if (!prev || r.fetched_at > prev.fetched_at) m.set(r.product_id, r);
    });
    return m;
  }
  function reduceClosest(rows, target) {
    var m = new Map();
    rows.forEach(function (r) {
      var dist = Math.abs(new Date(r.fetched_at).getTime() - target);
      var prev = m.get(r.product_id);
      if (!prev || dist < prev._dist) m.set(r.product_id, { price: r.price, _dist: dist });
    });
    return m;
  }

  async function load(sb, category) {
    var products = await pagedSelect(function () {
      var q = sb.from('products').select('id, sku, name, brand, image_url, product_url, slug, category')
        .eq('retailer', 'amazon');
      if (category) q = q.eq('category', category);
      return q;
    });
    if (!products.length) return products;
    var ids = products.map(function (p) { return p.id; });

    var now = Date.now();
    var latestRows = await pagedSelect(function () {
      return sb.from('price_history').select('product_id, price, fetched_at')
        .in('product_id', ids).gte('fetched_at', new Date(now - LATEST_WINDOW_H * 3600000).toISOString());
    });
    var baselineRows = await pagedSelect(function () {
      return sb.from('price_history').select('product_id, price, fetched_at')
        .in('product_id', ids)
        .gte('fetched_at', new Date(now - BASELINE_MAX_D * DAY_MS).toISOString())
        .lte('fetched_at', new Date(now - BASELINE_MIN_D * DAY_MS).toISOString());
    });

    var latest = reduceNewest(latestRows);
    var baseline = reduceClosest(baselineRows, now - 30 * DAY_MS);
    products.forEach(function (p) {
      var cur = latest.get(p.id);
      p.price = cur ? Number(cur.price) : null;
      var base = baseline.get(p.id);
      p.change30 = (p.price != null && base) ? ((p.price - Number(base.price)) / Number(base.price)) * 100 : null;
    });
    return products;
  }

  return { load: load };
})();
