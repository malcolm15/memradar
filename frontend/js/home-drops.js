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
  var SLOTS = 4;
  var chosenBySku = {}; // sku -> product, for the Track Price buttons
  var indexMap = null;  // sku -> { short, atl }, from search-index.json

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    return v == null ? 'N/A' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  // Amazon links are PLAIN product links since 2026-09-30: no tag is appended.
  function productUrl(url, sku) {
    return url || ('https://www.amazon.com/dp/' + sku + '/');
  }

  // The grid is BAKED by the generator now, so "hide the section" is only the
  // right answer when there is nothing baked to fall back to. Hiding a section
  // that already holds four real, correct-at-last-regeneration products would
  // destroy working content to report a transient fetch failure.
  var bakedCount = grid.querySelectorAll('.listing-card[data-sku]').length;
  function degrade(why) {
    if (bakedCount) {
      console.log('[home-drops] ' + why + '; keeping the ' + bakedCount + ' baked cards from the last regeneration.');
      return;
    }
    section.hidden = true;
  }

  function skeleton() {
    if (bakedCount) return; // baked cards beat skeletons
    var one = '<div class="listing-card listing-card--skeleton" aria-hidden="true">' +
      '<div class="listing-card-img skeleton-box"></div>' +
      '<div class="listing-card-body"><div class="skeleton-line skeleton-line--sm"></div>' +
      '<div class="skeleton-line"></div><div class="skeleton-line skeleton-line--price"></div></div>' +
      '<div class="listing-card-actions"><div class="skeleton-btn"></div></div></div>';
    grid.innerHTML = new Array(SLOTS + 1).join(one);
  }

  // The PDP's own h1, from search-index.json. NEVER p.name, which is the raw
  // Amazon title the Supabase feed carries.
  function displayName(p) {
    var e = indexMap && indexMap.get(p.sku);
    return (e && e.short) || p.name;
  }

  function cardHtml(p) {
    var pdp = '/' + p.category + '/' + p.slug + '/';
    var brand = p.brand ? '<span class="listing-card-brand">' + esc(p.brand) + '</span>' : '';
    var img = p.image_url
      ? '<img src="' + esc(p.image_url) + '" alt="' + esc(displayName(p)) + '" loading="lazy" class="listing-card-img-el">'
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
        '<h3 class="listing-card-name"><a href="' + esc(pdp) + '" class="listing-card-name-link">' + esc(displayName(p)) + '</a></h3>' +
        '<div class="listing-card-pricing"><span class="listing-card-price">' + money(p.price) + '</span>' + change + '</div>' +
        '<span class="listing-card-retailer">Amazon</span>' +
      '</div>' +
      '<div class="listing-card-actions">' +
        '<a href="' + esc(productUrl(p.product_url, p.sku)) + '" class="listing-card-deal-btn" target="_blank" rel="nofollow noopener noreferrer">View on Amazon</a>' +
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
          window.memradarAlertModal.openForProduct({ sku: p.sku, name: displayName(p), category: p.category, current_price: p.price });
        }
      });
    });
  }

  // ONE fetch, two consumers: the display name for every card and the all-time
  // low the fallback slots rank on. It used to fetch only in the fallback branch
  // and only for the low, so the cards had no source for the PDP's own name and
  // rendered the raw Amazon title. Resolves to an empty map on failure, which
  // falls the names back to the feed rather than dropping the section.
  function fetchIndexMap() {
    var ver = (function () {
      var s = document.querySelector('script[src*="home-drops.js"]');
      var m = s && /v=(\d+)/.exec(s.src);
      return m ? '?v=' + m[1] : '';
    })();
    return fetch('/search-index.json' + ver).then(function (r) { return r.json(); }).then(function (data) {
      var m = new Map();
      data.forEach(function (e) {
        m.set(e.sku, {
          short: e.short_name || '',
          atl: e.all_time_low == null ? null : Number(e.all_time_low)
        });
      });
      return m;
    }).catch(function (err) {
      console.log('Homepage drops: search index failed to load (' + err.message + '); names fall back to the product feed.');
      return new Map();
    });
  }

  async function run() {
    if (!sb || !window.memradarProductData) { degrade('data layer not initialized'); return; }
    skeleton();
    try {
      // In parallel: the prices decide WHICH products show, the index decides
      // what they are CALLED, and neither waits on the other.
      var loaded = await Promise.all([window.memradarProductData.load(sb), fetchIndexMap()]);
      var products = loaded[0];
      indexMap = loaded[1];
      // MEMBERSHIP IS THE INDEX, FOR BOTH SLOT TYPES. The ATL fallback below has
      // always been index-filtered, because it reads all_time_low out of the same
      // map, but the drops path ranked the whole priced feed and so could pick a
      // product the generator left off this surface. It would then have no PDP h1
      // to show and would fall back to the raw Amazon title, linking to a page we
      // tell crawlers to ignore. Measured 2026-10-03: 1 of 224 priced products is
      // absent from the index (the relisting B0BF8FVLSL) and it held no 30-day
      // drop, so the homepage was correct by the shape of the data rather than by
      // design. An empty map (index fetch failed) yields no candidates on either
      // path, which falls through to degrade() and keeps the baked four.
      var priced = products.filter(function (p) { return p.price != null && indexMap.has(p.sku); });

      var drops = priced.filter(function (p) { return p.change30 != null && p.change30 < 0; })
        .sort(function (a, b) { return a.change30 - b.change30; }); // most negative first

      var chosen = drops.slice(0, SLOTS);
      var modes = chosen.map(function () { return 'drop'; });

      if (chosen.length < SLOTS) {
        // Fallback: closest to all-time low among the non-drop products.
        var atlOf = function (sku) {
          var e = indexMap.get(sku);
          return e && e.atl != null ? e.atl : null;
        };
        var chosenSkus = {};
        chosen.forEach(function (p) { chosenSkus[p.sku] = true; });
        var candidates = priced.filter(function (p) {
          return !chosenSkus[p.sku] && atlOf(p.sku) > 0;
        }).map(function (p) {
          return { p: p, ratio: p.price / atlOf(p.sku) }; // 1.0 == at the all-time low
        }).sort(function (a, b) { return a.ratio - b.ratio; });

        for (var i = 0; i < candidates.length && chosen.length < SLOTS; i++) {
          chosen.push(candidates[i].p);
          modes.push('atl(' + candidates[i].ratio.toFixed(2) + 'x)');
        }
      }

      // NAME THE REAL CAUSE. Membership now comes from the index, so an empty map
      // produces zero candidates on both paths and would otherwise be reported as
      // "no products qualified", which describes the data when the fault is the
      // fetch. A fallback that misdescribes why it fired is the same hazard as one
      // that fires silently.
      if (!chosen.length) {
        degrade(indexMap.size ? 'no products qualified' : 'search index unavailable, so no product could be named');
        return;
      }

      chosenBySku = {};
      chosen.forEach(function (p) { chosenBySku[p.sku] = p; });

      console.log('[home-drops] slots filled: ' + chosen.map(function (p, i) {
        return (modes[i] + ' ' + p.sku);
      }).join(', '));

      grid.innerHTML = chosen.map(cardHtml).join('');
      attachHandlers();
    } catch (err) {
      console.error('[home-drops] failed:', err.message);
      degrade('fetch failed');
    }
  }

  run();
})();
