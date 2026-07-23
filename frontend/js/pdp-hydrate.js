// PDP price hydration. PDPs bake current price + "Last updated" at generation
// time, but prices now update twice daily WITHOUT regeneration — so on load we
// fetch the latest price_history row for this product and replace the baked
// current-price displays and the "Last updated" line with a relative time.
// Fails gracefully: on any error the baked values remain (never a broken UI).
(function () {
  var sb = window.memradarSupabase;
  var form = document.getElementById('pdpAlertForm');
  var sku = form && form.dataset.sku;
  var priceEls = [document.getElementById('pdpCurrentPrice'), document.getElementById('pdpBuyPrice')];
  var updatedEl = document.getElementById('pdpLastUpdated');
  if (!sb || !sku || !updatedEl) return;

  function money(v) {
    return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  function relativeTime(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) diff = 0; // guard against clock/timezone edge
    var mins = Math.round(diff / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' minutes ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  // Latest price for THIS product. Filter fetched_at <= now to skip any
  // backfill day-bucket rows stamped at T23:59 (future-dated for the current
  // day) so the relative timestamp reflects a real fetch. One embedded query.
  sb.from('price_history')
    .select('price, fetched_at, products!inner(sku)')
    .eq('products.sku', sku)
    .lte('fetched_at', new Date().toISOString())
    .order('fetched_at', { ascending: false })
    .limit(1)
    .then(function (res) {
      if (res.error || !res.data || !res.data.length) {
        console.log('[pdp-hydrate] keeping baked values', res.error && res.error.message);
        return;
      }
      var row = res.data[0];
      var price = Number(row.price);
      if (!isNaN(price)) {
        priceEls.forEach(function (el) { if (el) el.textContent = money(price); });
      }
      updatedEl.textContent = 'Updated ' + relativeTime(row.fetched_at);
    })
    .catch(function (err) {
      console.log('[pdp-hydrate] fetch failed, keeping baked values:', err.message);
    });
})();
