// PDP price hydration. PDPs bake current price + "Last updated" at generation
// time, but prices now update every few hours WITHOUT regeneration - so on load we
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
      // Honest flag: mirrors the generator's buy-indicator clause exactly. Cheap
      // against the recent average, still far above the all-time low. Hydrates
      // WITH the indicator so the two can never disagree.
      var gap = (cfg.extremesOk && cfg.atl != null && current >= cfg.atl * cfg.inflationRatio)
        ? ', though still ' + Math.round(((current - cfg.atl) / cfg.atl) * 100) + '% above its all-time low of ' + money(cfg.atl) + ' (' + cfg.atlMonth + ')'
        : '';
      ind.className = 'pdp-buy-indicator pdp-buy-indicator--good';
      ind.innerHTML = '<div class="pdp-buy-indicator-icon" aria-hidden="true">' + GOOD_ICON + '</div>' +
        '<div class="pdp-buy-indicator-body"><strong>Good time to buy</strong>' +
        '<span>Current price is ' + esc(phrase + gap) + '.</span></div>';
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

  // R1: EXACT mirror of the generator's analysisSentences(). Same order, same
  // thresholds (passed in cfg, never duplicated as literals here), same
  // wording. If these two ever disagree the page contradicts itself between
  // load and hydration, which is worse than either version alone.
  //
  // Returns an array; empty is legitimate and means nothing about this price is
  // notable, in which case the whole section is hidden rather than left showing
  // a stale sentence that hydration decided not to replace.
  function analysisSentences(current, cfg) {
    if (amazonOos) return ['Last seen at ' + money(current) + ', currently unavailable at Amazon.'];
    var out = [];
    if (cfg.rangeReal) {
      if (current <= cfg.atl) {
        out.push('At ' + money(current) + ', this is the lowest price MemRadar has recorded for it.');
      } else if (current <= cfg.atl * (1 + cfg.nearAtlPct / 100)) {
        var lp = Math.max(1, Math.round(((current - cfg.atl) / cfg.atl) * 100));
        out.push('At ' + money(current) + ', it is within ' + lp + '% of its all-time low of ' + money(cfg.atl) + ', set in ' + cfg.atlMonth + '.');
      } else if (current >= cfg.ath) {
        out.push('At ' + money(current) + ', this is the highest price MemRadar has recorded for it.');
      } else if (current >= cfg.ath * (1 - cfg.nearAthPct / 100)) {
        var hp = Math.max(1, Math.round(((cfg.ath - current) / cfg.ath) * 100));
        out.push('At ' + money(current) + ', it is within ' + hp + '% of its all-time high of ' + money(cfg.ath) + ', set in ' + cfg.athMonth + '.');
      }
    }
    if (cfg.base30 != null) {
      var ch = ((current - cfg.base30) / cfg.base30) * 100;
      if (Math.abs(ch) >= cfg.change30Pct) {
        out.push('The price has ' + (ch < 0 ? 'fallen' : 'risen') + ' ' + money(Math.abs(current - cfg.base30)) +
          ' (' + Math.abs(Math.round(ch)) + '%) in the past 30 days.');
      }
    }
    if (cfg.capGb != null && cfg.segMedian != null) {
      var rel = (current / cfg.capGb) / cfg.segMedian;
      if (rel <= cfg.valueLowRatio || rel >= cfg.valueHighRatio) {
        out.push('At ' + perGb(current / cfg.capGb) + ', it runs ' + (rel <= cfg.valueLowRatio ? 'below' : 'above') +
          ' the current ' + cfg.segLabel + ' average of ' + perGb(cfg.segMedian) + '.');
      }
    }
    return out;
  }

  function recomputeAnalysis(current, cfg) {
    var el = document.getElementById('pdpAnalysisCurrent');
    if (!el) return;
    var sentences = analysisSentences(current, cfg);
    var section = document.getElementById('pdpPriceAnalysis');
    if (!sentences.length) {
      // Nothing notable at the live price. Hide the section rather than leave
      // the baked sentences standing: they were true at build time and are not
      // now, and a section that silently keeps stale text is the exact failure
      // the conditional rewrite exists to remove.
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';
    el.textContent = sentences.join(' ');
  }

  // Price-fetch schedule, UTC hours. Deliberate duplicate of the generator's
  // FETCH_HOURS_UTC (this file runs in the browser and cannot require it);
  // .github/workflows/price-fetch.yml's cron is the source of truth. Change
  // all three together.
  var FETCH_HOURS_UTC = [0, 4, 8, 12, 16, 20];
  // GitHub's scheduled runs are best-effort: observed delays of 16-60 minutes
  // over the first full day at this cadence. priceValidUntil promises the
  // price holds until the next fetch, so it must not expire before a delayed
  // run lands - pad past the worst observed delay.
  var FETCH_DELAY_PAD_MIN = 90;
  // Next price-fetch boundary plus the pad - same computation as the
  // generator's nextFetchIso(), so the JSON-LD validity window is always the
  // next scheduled fetch regardless of when the page was baked. Past the last
  // slot, roll to tomorrow's first via hour + 24 (Date.UTC normalizes, and
  // minutes > 59 roll into the hour the same way).
  function nextFetchIso() {
    var d = new Date();
    var h = d.getUTCHours();
    var hour = FETCH_HOURS_UTC[0] + 24;
    for (var i = 0; i < FETCH_HOURS_UTC.length; i++) {
      if (h < FETCH_HOURS_UTC[i]) { hour = FETCH_HOURS_UTC[i]; break; }
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, FETCH_DELAY_PAD_MIN, 0)).toISOString();
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

  // R2 PEER TABLE. One .in() query for the peer prices, exactly the shape the
  // capacity-family chips already use. The peer SET never changes here: it is
  // chosen deterministically from specs at build time so the table's membership
  // (and the internal links it carries) is stable day to day. Only the numbers
  // move, and the "vs this" delta is recomputed against the just-hydrated price
  // of THIS product so the column cannot contradict the price shown above it.
  //
  // Graceful: on any failure every baked value stands.
  function recomputePeers(cfg, currentPrice) {
    var table = document.querySelector('.pdp-peer-table');
    if (!table || !cfg.peers || !cfg.peers.length) return;
    var myPerGb = (cfg.capGb > 0 && currentPrice != null) ? currentPrice / cfg.capGb : null;
    var skus = cfg.peers.map(function (x) { return x.sku; });
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
        cfg.peers.forEach(function (pr) {
          var tr = table.querySelector('tr[data-peer-sku="' + pr.sku + '"]');
          if (!tr) return;
          var price = isNaN(live[pr.sku]) ? pr.price : live[pr.sku];
          if (price == null) return;
          var pEl = tr.querySelector('.pdp-peer-price');
          var gEl = tr.querySelector('.pdp-peer-pergb');
          var dEl = tr.querySelector('.pdp-peer-delta');
          if (pEl) pEl.textContent = money(price);
          var pg = (pr.cap > 0) ? price / pr.cap : null;
          if (gEl) gEl.textContent = pg == null ? 'n/a' : perGb(pg);
          if (dEl) {
            if (pg == null || myPerGb == null) { dEl.textContent = 'n/a'; dEl.className = 'pdp-peer-delta'; return; }
            var d = ((pg - myPerGb) / myPerGb) * 100;
            var r2 = Math.round(d);
            dEl.textContent = Math.abs(r2) < 1 ? 'same' : (d > 0 ? '+' : '') + r2 + '%';
            dEl.className = 'pdp-peer-delta' + (Math.abs(r2) < 1 ? '' : d > 0 ? ' pdp-peer-up' : ' pdp-peer-down');
          }
        });
      })
      .catch(function () { /* baked values stand */ });
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
      .catch(function (e) { console.log('[pdp-hydrate] retailer offers failed, keeping baked values:', e && e.message); });
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
        recomputePeers(hydrateCfg, price);
        updateJsonLd('Amazon', price, row.fetched_at, null);
      }
      updatedEl.textContent = 'Updated ' + relativeTime(row.fetched_at);
    })
    .catch(function (err) {
      console.log('[pdp-hydrate] fetch failed, keeping baked values:', err.message);
    });
})();
