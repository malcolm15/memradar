// Shared product-data loader: the three-query live-price pattern used by both
// the listing pages (product-listing.js) and the homepage "Biggest Price
// Drops" section (home-drops.js).
//
// load(sb, category?) fetches products (optionally scoped to a category), their
// latest price (48h window -> newest per product) and a 30-day-ago baseline
// (25-35d window -> closest per product), all client-reduced (no N+1). Returns
// each product with .price (number|null) and .change30 (percent|null).
//
// If the catalog grows past ~500 products, move the price joins to a Postgres
// RPC/view (same note as the listing pages).
window.memradarProductData = (function () {
  var PAGE = 1000;
  var DAY_MS = 86400000;

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
        .in('product_id', ids).gte('fetched_at', new Date(now - 2 * DAY_MS).toISOString());
    });
    var baselineRows = await pagedSelect(function () {
      return sb.from('price_history').select('product_id, price, fetched_at')
        .in('product_id', ids)
        .gte('fetched_at', new Date(now - 35 * DAY_MS).toISOString())
        .lte('fetched_at', new Date(now - 25 * DAY_MS).toISOString());
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
