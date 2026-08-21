// PDP price hydration. PDPs bake current price + "Last updated" at generation
// time, but prices now update twice daily WITHOUT regeneration - so on load we
// fetch the latest price_history row for this product and replace the baked
// current-price displays and the "Last updated" line with a relative time.
// Fails gracefully: on any error the baked values remain (never a broken UI).
(function () {
  var sb = window.memradarSupabase;
  var form = document.getElementById('pdpAlertForm');
  var sku = form && form.dataset.sku;
  // Amazon price surfaces: hero stat, Buy Now row, and the header strip
  // button (all three are baked from the same value, so they hydrate together).
  var priceEls = [document.getElementById('pdpCurrentPrice'), document.getElementById('pdpBuyPrice'), document.getElementById('pdpStripAmazonPrice')];
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

  // Current Amazon availability. Seeded from the baked config (cfg.amzOos is
  // present ONLY on out-of-stock pages, so in-stock configs stay byte-identical)
  // and refreshed by the retailer-offers query below, so a restock un-mutes on
  // the next page load. Every price-derived recompute consults this, which is
  // what keeps the baked and hydrated states from disagreeing mid-session.
  var amazonOos = false;
  var lastPrice = null;
  var hydrateCfg = {};
  try {
    var cfgNode = document.getElementById('pdpHydrateConfig');
    if (cfgNode) hydrateCfg = JSON.parse(cfgNode.textContent) || {};
  } catch (e) { hydrateCfg = {}; }
  // cfg.amzOos is baked ONLY on out-of-stock pages, so in-stock configs stay
  // byte-identical to before this feature.
  amazonOos = hydrateCfg.amzOos === true;

  var GOOD_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  // Hero stat label follows availability: "Current Price" is wrong for a dead
  // listing, where the figure is a last sighting. Reached via the value's
  // previous sibling rather than an id, so in-stock pages keep byte-identical
  // markup. Text-only swap: same element, same styling, same box - no CLS.
  function applyPriceLabel() {
    var valueEl = document.getElementById('pdpCurrentPrice');
    var labelEl = valueEl && valueEl.previousElementSibling;
    if (!labelEl || labelEl.className.indexOf('pdp-stat-label') === -1) return;
    labelEl.textContent = amazonOos ? 'Last Seen Price' : 'Current Price';
  }

  // SINGLE predicate behind both the buy-indicator and the Price-Analysis verdict,
  // so they can never disagree. Mirrors the generator's buyState() exactly.
  // Returns 'good' | 'typical' | 'elevated' | null.
  function buyState(current, cfg) {
    if (cfg.avg90 == null) return null;
    var pct = Math.round(Math.abs(((current - cfg.avg90) / cfg.avg90) * 100));
    if (current <= cfg.avg90 * cfg.goodMaxRatio) return pct <= 1 ? 'typical' : 'good';
    return 'elevated';
  }

  // Recompute the good-time-to-buy verdict against the hydrated price, using the
  // baked 90-day average and the thresholds from #pdpHydrateConfig (same values
  // the generator used). The 90-day average itself stays baked.
  function recomputeBuyIndicator(current, cfg) {
    var ind = document.getElementById('pdpBuyIndicator');
    if (!ind) return;
    if (amazonOos) { // mirrors the generator's out-of-stock indicator exactly
      ind.className = 'pdp-buy-indicator pdp-buy-indicator--neutral';
      ind.innerHTML = '<div class="pdp-buy-indicator-icon" aria-hidden="true">○</div>' +
        '<div class="pdp-buy-indicator-body"><strong>Currently unavailable</strong>' +
        '<span>Amazon has no offer right now. Last seen at ' + money(current) + '.</span></div>';
      return;
    }
    if (cfg.avg90 == null) return;
    var pct = Math.round(Math.abs(((current - cfg.avg90) / cfg.avg90) * 100));
    if (buyState(current, cfg) !== 'elevated') {
      var phrase = buyState(current, cfg) === 'typical' ? 'in line with the ' + cfg.avgLabel : pct + '% below the ' + cfg.avgLabel;
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

  // Price-Analysis verdict sentence (S4). Mirrors the generator's
  // verdictSentence() exactly, and uses buyState() so it can never disagree
  // with the buy-indicator above it.
  function verdictText(current, cfg) {
    var state = buyState(current, cfg);
    if (state == null) return '';
    var segNoun = (cfg.segWord ? cfg.segWord + ' ' : '') + cfg.noun;
    if (state !== 'elevated' && cfg.atl != null && current >= cfg.atl * cfg.inflationRatio) {
      return "It's near its recent low, though still well above where it traded a year or two ago, a reflection of the broader " + cfg.market + ' market.';
    }
    if (state === 'good') return 'For a ' + segNoun + ', this is a strong price relative to its own history, a reasonable time to buy.';
    if (state === 'elevated') return 'Historically this sits on the expensive side, so if you can wait, it may be worth watching for a drop.';
    return 'This is a fairly typical price for this ' + cfg.noun + ' based on its recent history.';
  }

  // Rebuild the current-assessment span of the Price Analysis paragraph from the
  // live price (position vs low/high, $/GB, verdict). Mirrors the generator's
  // currentAssessment(). textContent throughout, so nothing needs escaping. The
  // historical span (.pdp-analysis-history) is baked and left untouched.
  function recomputeAnalysis(current, cfg) {
    var el = document.getElementById('pdpAnalysisCurrent');
    if (!el) return;
    if (amazonOos) { // mirrors the generator's currentAssessment() OOS branch
      el.textContent = 'Last seen at ' + money(current) + ', currently unavailable at Amazon.';
      return;
    }
    var parts = [];
    if (cfg.atl != null) {
      if (current <= cfg.atl) {
        parts.push('Currently at ' + money(current) + ", this is the lowest price we've recorded.");
      } else if (current <= cfg.atl * 1.02) {
        parts.push('Currently at ' + money(current) + ", it's within " + money(current - cfg.atl) + ' of its all-time low.');
      } else {
        var sent = 'Currently at ' + money(current) + ', it sits ' + Math.round(((current - cfg.atl) / cfg.atl) * 100) + '% above that low';
        if (cfg.ath != null && cfg.ath > current) {
          sent += ' and ' + Math.round(((cfg.ath - current) / cfg.ath) * 100) + '% below that high';
        }
        parts.push(sent + '.');
      }
    }
    if (cfg.capGb != null && cfg.segMedian != null) {
      var mine = current / cfg.capGb;
      var rel = mine / cfg.segMedian;
      var word = rel < cfg.valueLowRatio ? 'below' : rel > cfg.valueHighRatio ? 'above' : 'in line with';
      parts.push('At ' + perGb(mine) + ', it runs ' + word + ' the current ' + cfg.segLabel + ' average of ' + perGb(cfg.segMedian) + '.');
    }
    var v = verdictText(current, cfg);
    if (v) parts.push(v);
    el.textContent = parts.join(' ');
  }
  // Price-fetch schedule, UTC hours. Deliberate duplicate of the generator's
  // FETCH_HOURS_UTC (this file runs in the browser and cannot require it);
  // vercel.json's crons are the source of truth. Change all three together.
  var FETCH_HOURS_UTC = [8, 20];
  // Next price-fetch boundary - same computation as the generator's
  // nextFetchIso(), so the JSON-LD validity window is always the next
  // scheduled fetch regardless of when the page was baked. Past the last
  // slot, roll to tomorrow's first via hour + 24 (Date.UTC normalizes).
  function nextFetchIso() {
    var d = new Date();
    var h = d.getUTCHours();
    var hour = FETCH_HOURS_UTC[0] + 24;
    for (var i = 0; i < FETCH_HOURS_UTC.length; i++) {
      if (h < FETCH_HOURS_UTC[i]) { hour = FETCH_HOURS_UTC[i]; break; }
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0)).toISOString();
  }

  // Keep the Product JSON-LD coherent with the hydrated prices. Rendering
  // crawlers see the same numbers the visible page shows. Two shapes:
  // - single Offer (Amazon-only pages): update price + validity window.
  // - AggregateOffer (two-retailer pages): update the named seller's nested
  //   offer, then re-derive lowPrice/highPrice from the nested prices so the
  //   aggregate NEVER advertises a bound no nested offer actually carries -
  //   whichever order the Amazon and Newegg refreshes land in.
  function updateJsonLd(seller, price, fetchedAt, inStock) {
    var el = document.querySelector('script[type="application/ld+json"]');
    if (!el) return;
    try {
      var data = JSON.parse(el.textContent);
      var graph = data['@graph'] || [];
      for (var i = 0; i < graph.length; i++) {
        if (graph[i]['@type'] !== 'Product' || !graph[i].offers) continue;
        var offers = graph[i].offers;
        if (offers['@type'] === 'AggregateOffer') {
          var list = offers.offers || [];
          var prices = [];
          for (var j = 0; j < list.length; j++) {
            if (list[j].seller && list[j].seller.name === seller) {
              list[j].price = price;
              // validFrom = when this price was actually fetched;
              // priceValidUntil = the next scheduled fetch (generator clock).
              if (fetchedAt) list[j].validFrom = new Date(fetchedAt).toISOString();
              list[j].priceValidUntil = nextFetchIso();
              if (inStock === true) list[j].availability = 'https://schema.org/InStock';
              if (inStock === false) list[j].availability = 'https://schema.org/OutOfStock';
            }
            if (typeof list[j].price === 'number') prices.push(list[j].price);
          }
          if (prices.length) {
            offers.lowPrice = Math.min.apply(null, prices);
            offers.highPrice = Math.max.apply(null, prices);
          }
        } else if (seller === 'Amazon') {
          offers.price = price;
          if (fetchedAt) offers.validFrom = new Date(fetchedAt).toISOString();
          offers.priceValidUntil = nextFetchIso();
        }
      }
      el.textContent = JSON.stringify(data).replace(/<\//g, '<\\/');
    } catch (e) { /* leave the baked JSON-LD on any parse issue */ }
  }

  // Capacity-family chips: refresh sibling prices (one .in() query) and move the
  // best-$/GB tag. `currentPrice` is the just-hydrated price for the viewing
  // chip. Graceful: on any failure the baked chip prices + tag remain.
  function recomputeCapacityFamily(cfg, currentPrice) {
    var row = document.getElementById('pdpCapacityFamily');
    if (!row || !cfg.famChips || cfg.famChips.length < 2) return;
    var siblings = cfg.famChips.filter(function (c) { return !c.viewing && c.sku; });
    var skus = siblings.map(function (c) { return c.sku; });
    if (!skus.length) { applyBest(row, cfg, currentPrice, {}); return; }
    var since = new Date(Date.now() - 3 * 86400000).toISOString();
    sb.from('price_history')
      .select('price, fetched_at, products!inner(sku)')
      .in('products.sku', skus)
      .gte('fetched_at', since)
      .lte('fetched_at', new Date().toISOString())
      .order('fetched_at', { ascending: false })
      .then(function (res) {
        var live = {};
        if (!res.error && res.data) {
          res.data.forEach(function (r) {
            var sku = r.products && r.products.sku;
            if (sku && !(sku in live)) live[sku] = Number(r.price); // first = latest
          });
        }
        siblings.forEach(function (c) {
          if (isNaN(live[c.sku])) return;
          var chip = row.querySelector('.pdp-cap-chip[data-sku="' + c.sku + '"] .pdp-cap-price');
          if (chip) chip.textContent = money(live[c.sku]);
        });
        applyBest(row, cfg, currentPrice, live);
      })
      .catch(function () { applyBest(row, cfg, currentPrice, {}); });
  }
  // Recompute which capacity has the lowest live $/GB and move the --best class.
  function applyBest(row, cfg, currentPrice, live) {
    var bestCap = null, bestPerGb = Infinity;
    cfg.famChips.forEach(function (c) {
      var price = c.viewing ? currentPrice : (isNaN(live[c.sku]) ? c.price : live[c.sku]);
      if (price == null || !(c.cap > 0)) return;
      var pg = price / c.cap;
      if (pg < bestPerGb) { bestPerGb = pg; bestCap = c.cap; }
    });
    if (bestCap == null) return;
    row.querySelectorAll('.pdp-cap-chip').forEach(function (chip) {
      chip.classList.toggle('pdp-cap-chip--best', String(bestCap) === chip.getAttribute('data-cap'));
    });
  }

  // Newegg comparison row (present when cfg.newegg): refresh price + stock
  // from retailer_offers. One query; graceful fallback to baked values. The
  // row ORDER stays as baked (no DOM re-sorting on hydration).
  // Apply one retailer's current state to BOTH surfaces (header strip button
  // and Buy Now row) so they can never disagree. Mirrors the generator's
  // rendering exactly: out of stock keeps the link clickable (users can check
  // for themselves, and restocks happen), mutes the button, strikes the price
  // as a last sighting, and labels it in words - never colour alone.
  var SURFACES = {
    amazon: { strip: 'pdpStripAmazonPrice', rowPrice: 'pdpBuyPrice', rowStock: 'pdpAmazonStock' },
    newegg: { strip: 'pdpStripNeweggPrice', rowPrice: 'pdpNeweggPrice', rowStock: 'pdpNeweggStock' }
  };
  function applyRetailerState(key, price, inStock) {
    var ids = SURFACES[key];
    if (!ids) return;
    var stripEl = document.getElementById(ids.strip);
    var rowPriceEl = document.getElementById(ids.rowPrice);
    var rowStockEl = document.getElementById(ids.rowStock);
    if (!isNaN(price)) {
      if (stripEl) stripEl.textContent = money(price);
      if (rowPriceEl) rowPriceEl.textContent = money(price);
    }
    if (inStock == null) return; // unknown: make no claim either way
    if (rowStockEl) {
      rowStockEl.className = 'pdp-stock ' + (inStock ? 'pdp-stock--in' : 'pdp-stock--out');
      rowStockEl.textContent = inStock ? 'In Stock' : 'Out of Stock';
    }
    var btn = stripEl && stripEl.closest ? stripEl.closest('.pdp-rstrip-btn') : null;
    if (!btn) return;
    var label = btn.querySelector('.pdp-rstrip-oos');
    if (inStock) {
      btn.classList.remove('pdp-rstrip-btn--oos');
      if (label) label.parentNode.removeChild(label);
    } else {
      btn.classList.add('pdp-rstrip-btn--oos');
      if (!label) {
        label = document.createElement('span');
        label.className = 'pdp-rstrip-oos';
        label.textContent = 'Out of stock';
        btn.appendChild(label);
      }
    }
  }

  // One query covering BOTH retailers: Amazon's current state lives in
  // retailer_offers alongside Newegg's (price_history is an observation log
  // and cannot express "we looked and there was no offer"). A restock
  // therefore un-mutes on the next page load.
  function recomputeRetailerOffers(cfg) {
    sb.from('retailer_offers')
      .select('retailer, price, in_stock, fetched_at, products!inner(sku)')
      .eq('products.sku', sku)
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) return; // keep baked
        res.data.forEach(function (o) {
          var p = Number(o.price);
          applyRetailerState(o.retailer, p, o.in_stock);
          if (!isNaN(p)) {
            updateJsonLd(o.retailer === 'amazon' ? 'Amazon' : 'Newegg', p, o.fetched_at, o.in_stock);
          }
          if (o.retailer === 'amazon') {
            var wasOos = amazonOos;
            amazonOos = o.in_stock === false;
            // Availability drives the verdict and the analysis sentence, so a
            // change discovered here must re-run them against the live price.
            if (wasOos !== amazonOos) {
              applyPriceLabel(); // both directions: restock restores "Current Price"
              if (lastPrice != null) {
                recomputeBuyIndicator(lastPrice, cfg);
                recomputeAnalysis(lastPrice, cfg);
              }
            }
          }
        });
      })
      .catch(function () { /* keep baked values */ });
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
  // Availability first and independently: an out-of-stock product's newest
  // price_history row is an old sighting, so stock must not ride on it.
  recomputeRetailerOffers(hydrateCfg);

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
        lastPrice = price;
        priceEls.forEach(function (el) { if (el) el.textContent = money(price); });
        // Keep price-derived UI coherent with the hydrated price. All of these
        // consult amazonOos, so an out-of-stock page never regains a
        // "good time to buy" verdict from a price refresh.
        recomputeBuyIndicator(price, hydrateCfg);
        recomputeValueMetric(price, hydrateCfg);
        recomputeAnalysis(price, hydrateCfg);
        recomputeCapacityFamily(hydrateCfg, price);
        updateJsonLd('Amazon', price, row.fetched_at, null);
      }
      updatedEl.textContent = 'Updated ' + relativeTime(row.fetched_at);
    })
    .catch(function (err) {
      console.log('[pdp-hydrate] fetch failed, keeping baked values:', err.message);
    });
})();
