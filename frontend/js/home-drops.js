// Homepage "Biggest Price Drops" - the 4 products with the largest 30-day
// price DECREASE right now, populated from live data (shared three-query
// loader in product-data.js). If fewer than 4 have a negative 30-day change,
// remaining slots are filled with products CLOSEST to their all-time low
// (all_time_low from the generated search index). Degrades by omission: on any
// fetch failure the whole section is hidden.
(function () {
  var section = document.getElementById('biggestDropsSection');
  var grid = document.getElementById('biggestDropsGrid');
  if (!section || !grid) return;
  var sb = window.memradarSupabase;
  var AFFILIATE_TAG = 'memradar-20';
  var SLOTS = 4;
  var chosenBySku = {}; // sku -> product, for the Track Price buttons

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    return v == null ? 'N/A' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  function affiliateUrl(url, sku) {
    var u = url || ('https://www.amazon.com/dp/' + sku + '/');
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'tag=' + AFFILIATE_TAG;
  }

  function hideSection() { section.hidden = true; }

  function skeleton() {
    var one = '<div class="listing-card listing-card--skeleton" aria-hidden="true">' +
      '<div class="listing-card-img skeleton-box"></div>' +
      '<div class="listing-card-body"><div class="skeleton-line skeleton-line--sm"></div>' +
      '<div class="skeleton-line"></div><div class="skeleton-line skeleton-line--price"></div></div>' +
      '<div class="listing-card-actions"><div class="skeleton-btn"></div></div></div>';
    grid.innerHTML = new Array(SLOTS + 1).join(one);
  }

  function cardHtml(p) {
    var pdp = '/' + p.category + '/' + p.slug + '/';
    var brand = p.brand ? '<span class="listing-card-brand">' + esc(p.brand) + '</span>' : '';
    var img = p.image_url
      ? '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" loading="lazy" class="listing-card-img-el">'
      : '';
    // Only real 30-day drops show the green indicator; ATL-fallback cards don't
    // (their change30 may be null or non-negative - never show a wrong badge).
    var change = '';
    if (p.change30 != null && p.change30 < 0) {
      change = '<span class="listing-card-change listing-card-change--down">▼ ' + Math.abs(Math.round(p.change30)) + '%</span>';
    }
    return '<div class="listing-card listing-card--linked" data-sku="' + esc(p.sku) + '" data-href="' + esc(pdp) + '">' +
      '<div class="listing-card-img">' + img + '</div>' +
      '<div class="listing-card-body">' +
        brand +
        '<h3 class="listing-card-name"><a href="' + esc(pdp) + '" class="listing-card-name-link">' + esc(p.name) + '</a></h3>' +
        '<div class="listing-card-pricing"><span class="listing-card-price">' + money(p.price) + '</span>' + change + '</div>' +
        '<span class="listing-card-retailer">Amazon</span>' +
      '</div>' +
      '<div class="listing-card-actions">' +
        '<a href="' + esc(affiliateUrl(p.product_url, p.sku)) + '" class="listing-card-deal-btn" target="_blank" rel="nofollow sponsored noopener noreferrer">View on Amazon</a>' +
        '<button class="listing-card-alert-btn" type="button" data-sku="' + esc(p.sku) + '">Track Price</button>' +
      '</div>' +
    '</div>';
  }

  function attachHandlers() {
    grid.querySelectorAll('.listing-card-img-el').forEach(function (img) {
      img.addEventListener('error', function () { img.style.display = 'none'; });
    });
    grid.querySelectorAll('.listing-card[data-href]').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('a') || e.target.closest('.listing-card-alert-btn')) return;
        window.location.href = card.getAttribute('data-href');
      });
    });
    grid.querySelectorAll('.listing-card-deal-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    // "Track Price" opens the alert modal pre-filled with this product (the
    // modal's own .btn-alert handler only binds to elements present at init;
    // these are added later, so wire explicitly to openForProduct).
    grid.querySelectorAll('.listing-card-alert-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = chosenBySku[btn.dataset.sku];
        if (p && window.memradarAlertModal) {
          window.memradarAlertModal.openForProduct({ sku: p.sku, name: p.name, category: p.category, current_price: p.price });
        }
      });
    });
  }

  // Fetch all_time_low map from the generated search index (only when the
  // fallback is actually needed - the common case has >=4 real drops).
  function fetchAtlMap() {
    var ver = (function () {
      var s = document.querySelector('script[src*="home-drops.js"]');
      var m = s && /v=(\d+)/.exec(s.src);
      return m ? '?v=' + m[1] : '';
    })();
    return fetch('/search-index.json' + ver).then(function (r) { return r.json(); }).then(function (data) {
      var m = new Map();
      data.forEach(function (e) { if (e.all_time_low != null) m.set(e.sku, Number(e.all_time_low)); });
      return m;
    });
  }

  async function run() {
    if (!sb || !window.memradarProductData) { hideSection(); return; }
    skeleton();
    try {
      var products = await window.memradarProductData.load(sb);
      var priced = products.filter(function (p) { return p.price != null; });

      var drops = priced.filter(function (p) { return p.change30 != null && p.change30 < 0; })
        .sort(function (a, b) { return a.change30 - b.change30; }); // most negative first

      var chosen = drops.slice(0, SLOTS);
      var modes = chosen.map(function () { return 'drop'; });

      if (chosen.length < SLOTS) {
        // Fallback: closest to all-time low among the non-drop products.
        var atl = await fetchAtlMap();
        var chosenSkus = {};
        chosen.forEach(function (p) { chosenSkus[p.sku] = true; });
        var candidates = priced.filter(function (p) {
          return !chosenSkus[p.sku] && atl.has(p.sku) && atl.get(p.sku) > 0;
        }).map(function (p) {
          return { p: p, ratio: p.price / atl.get(p.sku) }; // 1.0 == at the all-time low
        }).sort(function (a, b) { return a.ratio - b.ratio; });

        for (var i = 0; i < candidates.length && chosen.length < SLOTS; i++) {
          chosen.push(candidates[i].p);
          modes.push('atl(' + candidates[i].ratio.toFixed(2) + 'x)');
        }
      }

      if (!chosen.length) { hideSection(); return; }

      chosenBySku = {};
      chosen.forEach(function (p) { chosenBySku[p.sku] = p; });

      console.log('[home-drops] slots filled: ' + chosen.map(function (p, i) {
        return (modes[i] + ' ' + p.sku);
      }).join(', '));

      grid.innerHTML = chosen.map(cardHtml).join('');
      attachHandlers();
    } catch (err) {
      console.error('[home-drops] failed, hiding section:', err.message);
      hideSection();
    }
  }

  run();
})();
