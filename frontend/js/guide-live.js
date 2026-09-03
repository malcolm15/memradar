// Live elements shared by every /guides/ page: the 4x4 trend table, the
// decade chart, and the near-all-time-low product list.
//
// SHARED, not forked. CLAUDE.md's guides section said to revisit the chart
// extraction when a second guide needed one; the SSD guide is that second
// guide. Nothing in this file was ever RAM-specific - it is entirely
// DOM-driven (table cell ids, .guide-atl-row[data-sku], #guideChartData), so
// one module serves both guides and they cannot drift apart.
//
// HYDRATION PARITY (same rule as the Price Index): any figure on a guide page
// that also appears in a hydrated element must itself hydrate from the same
// source, so prose and numbers can never disagree. The table and the ATL list
// both refresh here; the editorial prose deliberately states magnitudes
// ("more than doubled", "well over double") rather than exact figures, so it
// stays true between regenerations.
(function () {
  var sb = window.memradarSupabase;

  // ---- decade chart (static: one series, no range buttons) ----
  // Deliberately NOT a fork of the PDP's interactive chart, which is coupled
  // to range switching and the hydrate config. This renders one long view and
  // reuses only the visual language (brand cobalt, dark-mode redraw).
  // Every guide gets the same renderer; the series is whatever the generator
  // baked into #guideChartData.
  var dataEl = document.getElementById('guideChartData');
  var canvas = document.getElementById('guideChart');
  if (dataEl && canvas && window.Chart) {
    var points = JSON.parse(dataEl.textContent || '[]');
    var chart = null;
    var isDark = function () { return document.documentElement.classList.contains('dark'); };
    var draw = function () {
      if (chart) chart.destroy();
      var line = isDark() ? '#5a80d7' : '#3A5BC7';
      var grid = isDark() ? 'rgba(148,163,184,0.16)' : 'rgba(107,114,128,0.14)';
      var tick = isDark() ? '#94a3b8' : '#6b7280';
      chart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: points.map(function (p) { return p[0]; }),
          datasets: [{ data: points.map(function (p) { return p[1]; }), borderColor: line,
            backgroundColor: 'rgba(58,91,199,0.08)', borderWidth: 2, pointRadius: 0, fill: true, tension: 0.15 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
          scales: {
            x: { grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 8, autoSkip: true } },
            y: { grid: { color: grid }, ticks: { color: tick, callback: function (v) { return '$' + v; } } },
          },
        },
      });
    };
    draw();
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  if (!sb) return;

  function cellClass(pct) {
    if (pct == null) return 'pi-na';
    if (pct < 0) return 'pi-down';
    if (pct < 10) return 'pi-neutral';
    return 'pi-up';
  }
  var fmtPct = function (p) { return p == null ? 'n/a' : (p >= 0 ? '+' : '') + p + '%'; };
  var money = function (v) { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); };

  // ---- trend table ----
  // DOM-gated like everything else here: a page may use only the chart (the
  // "Why is RAM so expensive" explainer does), and firing a market_stats query
  // for a table that is not on the page is a request for nothing.
  if (document.querySelector('[id^="pi-"]')) {
  sb.from('market_stats').select('segment, period, pct_change, computed_at').then(function (res) {
    if (res.error || !res.data || !res.data.length) return; // keep baked
    var newest = null;
    res.data.forEach(function (row) {
      var cell = document.getElementById('pi-' + row.segment + '-' + row.period);
      if (cell) {
        var pct = row.pct_change == null ? null : Number(row.pct_change);
        cell.textContent = fmtPct(pct);
        cell.className = 'pi-cell ' + cellClass(pct);
      }
      if (row.computed_at && (!newest || row.computed_at > newest)) newest = row.computed_at;
    });
    var note = document.getElementById('piComputedNote');
    if (newest && note) {
      note.textContent = new Date(newest).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    }
  }).catch(function (e) { console.log('[guide] hydration failed, keeping baked values:', e && e.message); });
  }

  // ---- near-ATL list: refresh the current price and restate the gap ----
  // The all-time low is baked (it moves only when a new low is set, which a
  // regeneration captures); the CURRENT price is what goes stale between
  // builds, so that is what hydrates. The gap is then recomputed from both so
  // the sentence can never contradict the price beside it.
  var rows = [].slice.call(document.querySelectorAll('.guide-atl-row'));
  if (!rows.length) return;
  var skus = rows.map(function (r) { return r.dataset.sku; }).filter(Boolean);
  sb.from('price_history')
    .select('price, fetched_at, products!inner(sku)')
    .in('products.sku', skus)
    .gte('fetched_at', new Date(Date.now() - 12 * 3600000).toISOString())
    .then(function (res) {
      if (res.error || !res.data) return;
      var latest = {};
      res.data.forEach(function (r) {
        var sku = r.products && r.products.sku;
        if (!sku) return;
        if (!latest[sku] || r.fetched_at > latest[sku].fetched_at) latest[sku] = r;
      });
      rows.forEach(function (row) {
        var hit = latest[row.dataset.sku];
        if (!hit) return;
        var cur = Number(hit.price);
        var priceEl = row.querySelector('[data-role="price"]');
        var gapEl = row.querySelector('[data-role="gap"]');
        if (!priceEl || !gapEl || isNaN(cur)) return;
        var atl = Number(gapEl.dataset.atl);
        priceEl.textContent = money(cur);
        if (!(atl > 0)) return;
        var gap = ((cur - atl) / atl) * 100;
        // Mirrors the generator's atlPhrase() exactly.
        var phrase = gap < 0.05 ? 'at its all-time low'
          : (gap < 10 ? gap.toFixed(1) : Math.round(gap)) + '% above its all-time low';
        gapEl.textContent = phrase + ' of ' + money(atl);
      });
    })
    .catch(function (e) { console.log('[guide] hydration failed, keeping baked values:', e && e.message); });
})();
