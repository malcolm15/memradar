// Product listing pages (RAM + SSD) — shared. Detects category from
// data-category on the grid, loads real products + prices from Supabase, and
// wires the filter pills / sort entirely client-side over the fetched dataset.
//
// Data strategy — THREE queries total, all reduced client-side (no N+1):
//   1. products for this category
//   2. price_history in the last 48h  -> newest row per product (current price)
//   3. price_history 25-35 days back   -> row closest to 30d (baseline for %chg)
// At ~120 products/page with daily-granularity history this is a few hundred KB.
// If the catalog ever grows past ~500 products, move steps 2-3 to a Postgres
// RPC/view that returns latest + 30d-ago per product server-side.
(function () {
  var grid = document.querySelector('.listing-grid[data-category]');
  if (!grid) return;
  var category = grid.getAttribute('data-category'); // 'ram' | 'ssd'
  var sb = window.memradarSupabase;

  var AFFILIATE_TAG = 'memradar-20';

  // The empty-state block is the JS-failure fallback: detach and hold it.
  var emptyState = grid.querySelector('.listing-empty');
  if (emptyState) emptyState.remove();
  var countEl = document.querySelector('.listing-count');

  var state = { products: [], filters: {}, sort: 'name-az', query: null };

  // ?q= search handoff (from the site-wide typeahead's "View all N results").
  // Matching delegates to search.js (loaded before this file) so listing
  // results always agree with the dropdown.
  var urlQ = new URLSearchParams(window.location.search).get('q');
  if (urlQ && urlQ.trim() && window.memradarSearch) state.query = urlQ.trim();
  function clearSearch() {
    state.query = null;
    var url = new URL(window.location.href);
    url.searchParams.delete('q');
    history.replaceState(null, '', url.pathname + url.search);
    applyAndRender();
  }

  // ---------- formatting / escaping ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPrice(v) {
    return v == null ? '$—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  function affiliateUrl(url) {
    if (!url) return '#';
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'tag=' + AFFILIATE_TAG;
  }

  // ---------- name parsing (filters) ----------
  // Products whose titles lack a parseable token stay reachable via All/Type/
  // Capacity but won't match the specific filter below. As of 2026-07-22 these
  // 9 SKUs are affected — the future static-generation / PDP phase must handle
  // these nulls gracefully in spec tables:
  //   No parseable SPEED (1 RAM):
  //     B0BQWXTDWN (Trident Z5 RGB 32GB DDR5 — no MHz/MT in title)
  //   No FORM-FACTOR token (8 SSD, all M.2 drives whose titles omit "M.2"/"2.5"):
  //     B0B3RP4XCG, B0CK39YR9V, B0CK2RKPBL, B0DBBG7CG7, B0DBBJSGFQ,
  //     B0CK2R8YLY, B0CTRV9CVP, B0DZ5ZK225
  function parseSpeed(name) {
    var speeds = [], m;
    var re = /(\d{4,5})\s*(?:mhz|mt\/s)/gi;
    while ((m = re.exec(name))) speeds.push(+m[1]);
    var re2 = /ddr[45]-(\d{4,5})/gi;
    while ((m = re2.exec(name))) speeds.push(+m[1]);
    speeds = speeds.filter(function (s) { return s >= 1800 && s <= 9000; }); // excludes PC5-48000 etc.
    return speeds.length ? Math.max.apply(null, speeds) : null;
  }
  function speedBand(s) {
    if (s == null) return null;
    if (s >= 6000) return '6000MHz+';
    if (s >= 5500) return '5600MHz';
    if (s >= 5000) return '5200MHz';
    return '4800MHz & below';
  }
  function capTokensGB(str) {
    // Negative lookahead excludes non-capacity units: "400TBW" (endurance) and
    // "6 Gb/s" (interface speed) must NOT be read as capacities.
    var caps = [], m, re = /(\d+)\s*(gb|tb)(?![\w/])/gi;
    while ((m = re.exec(str))) caps.push(/tb/i.test(m[2]) ? +m[1] * 1024 : +m[1]);
    return caps;
  }
  // Total capacity: kit names read "32GB (2x16GB)" — the TOTAL appears before
  // the "(". Use the pre-paren capacity if present, else the largest token
  // (covers bracket notation "[2 x 16GB]" and single modules).
  function totalCapacityGB(name) {
    var pre = capTokensGB(name.split('(')[0]);
    if (pre.length) return Math.max.apply(null, pre);
    var all = capTokensGB(name);
    return all.length ? Math.max.apply(null, all) : null;
  }
  function capPillGB(pill) {
    var m = pill.match(/(\d+)\s*(gb|tb)/i);
    if (!m) return null;
    return /tb/i.test(m[2]) ? +m[1] * 1024 : +m[1];
  }
  // SSD type — SATA wins over NVMe/M.2 (M.2 SATA drives are SATA-protocol),
  // matching backend/lib/marketStats.js.
  function ssdType(name) {
    if (/sata|2\.5/i.test(name)) return 'SATA';
    if (/nvme|m\.2/i.test(name)) return 'NVMe';
    return null;
  }
  // Brand pill -> brand column, with WD alias (column stores "Western Digital").
  function brandMatch(brand, pill) {
    if (!brand) return false;
    var a = brand.toLowerCase(), b = pill.toLowerCase();
    var aliases = { wd: 'western digital' };
    if (aliases[b]) b = aliases[b];
    return a === b;
  }

  // ---------- filter dispatch ----------
  function passes(label, value, p) {
    switch (label) {
      case 'type':
        return category === 'ssd' ? ssdType(p.name) === value : p.name.toLowerCase().indexOf(value.toLowerCase()) >= 0;
      case 'capacity': {
        var total = totalCapacityGB(p.name);
        if (total == null) return false;
        var gb = capPillGB(value);
        return value.indexOf('+') >= 0 ? total >= gb : total === gb;
      }
      case 'speed':
        return speedBand(parseSpeed(p.name)) === value;
      case 'form factor':
        return value.indexOf('M.2') >= 0 ? /m\.2/i.test(p.name) : /2\.5/.test(p.name);
      case 'brand':
        return brandMatch(p.brand, value);
      default:
        return true;
    }
  }
  function matches(p) {
    if (state.query && !window.memradarSearch.textMatches(state.query, p.name + ' ' + (p.brand || ''))) return false;
    for (var label in state.filters) {
      var value = state.filters[label];
      if (value != null && !passes(label, value, p)) return false;
    }
    return true;
  }

  // ---------- sorting ----------
  function dropRank(p) { return p.change30 == null ? Infinity : p.change30; }
  function sortProducts(arr) {
    var a = arr.slice();
    switch (state.sort) {
      case 'price-lh': a.sort(function (x, y) { return (x.price == null ? Infinity : x.price) - (y.price == null ? Infinity : y.price); }); break;
      case 'price-hl': a.sort(function (x, y) { return (y.price == null ? -Infinity : y.price) - (x.price == null ? -Infinity : x.price); }); break;
      case 'drop': a.sort(function (x, y) { return dropRank(x) - dropRank(y); }); break; // biggest drop first, no-baseline last
      default: a.sort(function (x, y) { return x.name.localeCompare(y.name); }); // name-az
    }
    return a;
  }

  // ---------- rendering ----------
  function changeHtml(p) {
    if (p.change30 == null) return '';
    var r = Math.round(p.change30);
    if (r < 0) return '<span class="listing-card-change listing-card-change--down">▼ ' + Math.abs(r) + '%</span>';
    if (r > 0) return '<span class="listing-card-change listing-card-change--up">▲ ' + r + '%</span>';
    return '';
  }
  function cardHtml(p) {
    var brand = p.brand ? '<span class="listing-card-brand">' + esc(p.brand) + '</span>' : '';
    var img = p.image_url
      ? '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" loading="lazy" class="listing-card-img-el">'
      : '';
    // Card click navigates to the PDP (when a slug exists); the Amazon button
    // stays a direct affiliate link via stopPropagation.
    var pdpHref = p.slug ? '/' + category + '/' + p.slug + '/' : '';
    var name = pdpHref
      ? '<a href="' + esc(pdpHref) + '" class="listing-card-name-link">' + esc(p.name) + '</a>'
      : esc(p.name);
    return '<div class="listing-card' + (pdpHref ? ' listing-card--linked' : '') + '" data-sku="' + esc(p.sku) + '"' + (pdpHref ? ' data-href="' + esc(pdpHref) + '"' : '') + '>' +
      '<div class="listing-card-img">' + img + '</div>' +
      '<div class="listing-card-body">' +
        brand +
        '<h3 class="listing-card-name">' + name + '</h3>' +
        '<div class="listing-card-pricing"><span class="listing-card-price">' + fmtPrice(p.price) + '</span>' + changeHtml(p) + '</div>' +
        '<span class="listing-card-retailer">Amazon</span>' +
      '</div>' +
      '<div class="listing-card-actions">' +
        '<a href="' + esc(affiliateUrl(p.product_url)) + '" class="listing-card-deal-btn" target="_blank" rel="nofollow sponsored noopener noreferrer">View on Amazon</a>' +
      '</div>' +
    '</div>';
  }
  function attachImgFallback() {
    grid.querySelectorAll('.listing-card-img-el').forEach(function (img) {
      img.addEventListener('error', function () { img.style.display = 'none'; }); // leaves the gray placeholder box
    });
    grid.querySelectorAll('.listing-card[data-href]').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.listing-card-deal-btn') || e.target.closest('a')) return; // links handle themselves
        window.location.href = card.getAttribute('data-href');
      });
    });
    grid.querySelectorAll('.listing-card-deal-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }
  function skeletonHtml() {
    var one = '<div class="listing-card listing-card--skeleton" aria-hidden="true">' +
      '<div class="listing-card-img skeleton-box"></div>' +
      '<div class="listing-card-body">' +
        '<div class="skeleton-line skeleton-line--sm"></div>' +
        '<div class="skeleton-line"></div>' +
        '<div class="skeleton-line skeleton-line--price"></div>' +
      '</div>' +
      '<div class="listing-card-actions"><div class="skeleton-btn"></div></div>' +
    '</div>';
    return new Array(9).join(one); // 8 skeleton cards
  }
  function updateCount(n) {
    if (!countEl) return;
    if (state.query) {
      countEl.innerHTML = 'Showing ' + n + ' result' + (n === 1 ? '' : 's') + ' for “' + esc(state.query) + '” ' +
        '<button type="button" class="listing-clear-search" aria-label="Clear search">× Clear search</button>';
      var clearBtn = countEl.querySelector('.listing-clear-search');
      if (clearBtn) clearBtn.addEventListener('click', clearSearch);
    } else {
      countEl.textContent = 'Showing ' + n + ' product' + (n === 1 ? '' : 's') + ' · Prices updated twice daily';
    }
  }
  function clearFilters() {
    document.querySelectorAll('.filter-pills').forEach(function (group) {
      group.querySelectorAll('.filter-pill').forEach(function (pill, i) {
        pill.classList.toggle('active', i === 0); // first pill is "All"
      });
    });
    state.filters = {};
    applyAndRender();
  }
  function applyAndRender() {
    var filtered = state.products.filter(matches);
    var sorted = sortProducts(filtered);
    if (!sorted.length) {
      grid.innerHTML = '<div class="listing-empty listing-no-results">' +
        '<h2>No products match these filters</h2>' +
        '<p>Try removing a filter to see more results.</p>' +
        '<button type="button" class="listing-clear-filters">Clear Filters</button>' +
      '</div>';
      var btn = grid.querySelector('.listing-clear-filters');
      if (btn) btn.addEventListener('click', clearFilters);
    } else {
      grid.innerHTML = sorted.map(cardHtml).join('');
      attachImgFallback();
    }
    updateCount(filtered.length);
  }

  // ---------- states ----------
  function showSkeleton() {
    grid.innerHTML = skeletonHtml();
    if (countEl) countEl.textContent = 'Loading products…';
  }
  function showFailure(msg) {
    console.error('Product listing failed to load:', msg);
    grid.innerHTML = '';
    if (emptyState) { emptyState.hidden = false; grid.appendChild(emptyState); }
    if (countEl) countEl.textContent = '';
  }

  // ---------- data loading (shared three-query loader) ----------
  async function load() {
    showSkeleton();
    if (!sb || !window.memradarProductData) { showFailure('data layer not initialized'); return; }
    try {
      var products = await window.memradarProductData.load(sb, category);
      if (!products.length) { showFailure('no products returned'); return; }
      state.products = products;
      applyAndRender();
    } catch (err) {
      showFailure(err.message);
    }
  }

  // ---------- filter/sort wiring ----------
  function wireControls() {
    document.querySelectorAll('.filter-group').forEach(function (group) {
      var labelEl = group.querySelector('.filter-label');
      if (!labelEl) return;
      var key = labelEl.textContent.replace(':', '').trim().toLowerCase();

      var pills = group.querySelector('.filter-pills');
      if (pills) {
        pills.querySelectorAll('.filter-pill').forEach(function (pill) {
          pill.addEventListener('click', function () {
            pills.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
            pill.classList.add('active');
            var val = pill.textContent.trim();
            state.filters[key] = (val === 'All') ? null : val;
            applyAndRender();
          });
        });
      }

      var select = group.querySelector('.filter-select');
      if (select) {
        var SORT_MAP = {
          'Price: Low to High': 'price-lh',
          'Price: High to Low': 'price-hl',
          'Biggest Price Drop': 'drop',
          'Name: A-Z': 'name-az'
        };
        // Default view = Name A-Z; keep the select consistent with it.
        var nameOpt = Array.prototype.find.call(select.options, function (o) { return /name/i.test(o.textContent); });
        if (nameOpt) select.value = nameOpt.value;
        state.sort = 'name-az';
        select.addEventListener('change', function () {
          state.sort = SORT_MAP[select.value.trim()] || 'name-az';
          applyAndRender();
        });
      }
    });
  }

  wireControls();
  load();
})();
