// PDP price hydration. PDPs bake current price + "Last updated" at generation
// time, but prices now update twice daily WITHOUT regeneration - so on load we
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
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Matches the generator's perGb() exactly.
  function perGb(v) {
    return '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(3)) + '/GB';
  }

  var GOOD_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // Recompute the good-time-to-buy verdict against the hydrated price, using the
  // baked 90-day average and the thresholds from #pdpHydrateConfig (same values
  // the generator used). The 90-day average itself stays baked.
  function recomputeBuyIndicator(current, cfg) {
    var ind = document.getElementById('pdpBuyIndicator');
    if (!ind || cfg.avg90 == null) return;
    var avg = cfg.avg90;
    var pct = Math.round(Math.abs(((current - avg) / avg) * 100));
    if (current <= avg * cfg.goodMaxRatio) {
      var phrase = pct <= 1 ? 'in line with the ' + cfg.avgLabel : pct + '% below the ' + cfg.avgLabel;
      ind.className = 'pdp-buy-indicator pdp-buy-indicator--good';
      ind.innerHTML = '<div class="pdp-buy-indicator-icon" aria-hidden="true">' + GOOD_ICON + '</div>' +
        '<div class="pdp-buy-indicator-body"><strong>Good time to buy</strong>' +
        '<span>Current price is ' + esc(phrase) + '.</span></div>';
    } else {
      ind.className = 'pdp-buy-indicator pdp-buy-indicator--caution';
      ind.innerHTML = '<div class="pdp-buy-indicator-icon" aria-hidden="true">⚠</div>' +
        '<div class="pdp-buy-indicator-body"><strong>Price is elevated</strong>' +
        '<span>Current price is ' + pct + '% above the ' + esc(cfg.avgLabel) + '. Consider waiting.</span></div>';
    }
  }

  // Recompute the price-per-GB line (just division) when capacity was parseable.
  function recomputeValueMetric(current, cfg) {
    if (cfg.capGb == null || cfg.segMedian == null) return;
    var mine = current / cfg.capGb;
    var rel = mine / cfg.segMedian;
    var wording = rel < cfg.valueLowRatio ? 'below the segment median, good value'
      : rel > cfg.valueHighRatio ? 'above the segment median' : 'near the segment median';
    var perGbEl = document.querySelector('#pdpValueMetric .pdp-value-per-gb');
    var wordEl = document.querySelector('#pdpValueMetric .pdp-value-wording');
    if (perGbEl) perGbEl.textContent = 'Price per GB: ' + perGb(mine);
    if (wordEl) wordEl.textContent = '· ' + wording + ' for ' + cfg.segLabel;
  }
  // Next price-fetch boundary (06:00 / 18:00 UTC cron) - same computation as
  // the generator's nextFetchIso(), so the JSON-LD validity window is always
  // the next scheduled fetch regardless of when the page was baked.
  function nextFetchIso() {
    var d = new Date();
    var h = d.getUTCHours();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h < 6 ? 6 : h < 18 ? 18 : 30, 0, 0)).toISOString();
  }

  // Keep the Product JSON-LD coherent with the hydrated price: update
  // offers.price and roll priceValidUntil forward. Rendering crawlers see the
  // same numbers the visible page shows.
  function updateJsonLd(price) {
    var el = document.querySelector('script[type="application/ld+json"]');
    if (!el) return;
    try {
      var data = JSON.parse(el.textContent);
      var graph = data['@graph'] || [];
      for (var i = 0; i < graph.length; i++) {
        if (graph[i]['@type'] === 'Product' && graph[i].offers) {
          graph[i].offers.price = price;
          graph[i].offers.priceValidUntil = nextFetchIso();
        }
      }
      el.textContent = JSON.stringify(data).replace(/<\//g, '<\\/');
    } catch (e) { /* leave the baked JSON-LD on any parse issue */ }
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
        // Keep price-derived UI coherent with the hydrated price.
        var cfgEl = document.getElementById('pdpHydrateConfig');
        if (cfgEl) {
          try {
            var cfg = JSON.parse(cfgEl.textContent);
            recomputeBuyIndicator(price, cfg);
            recomputeValueMetric(price, cfg);
          } catch (e) { /* leave baked verdict on bad config */ }
        }
        updateJsonLd(price);
      }
      updatedEl.textContent = 'Updated ' + relativeTime(row.fetched_at);
    })
    .catch(function (err) {
      console.log('[pdp-hydrate] fetch failed, keeping baked values:', err.message);
    });
})();
