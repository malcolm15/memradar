// Market Pulse: replace the hardcoded homepage stats with live market_stats
// rows, and let the reader switch the comparison window (1M/3M/6M/1Y).
//
// The hardcoded HTML values are the loading state - if the fetch fails or a
// segment has no data, they stay as-is (never show a broken section). The
// baked HTML is the 6M state, which is also the default selection.
//
// ONE query fetches all 16 rows (4 segments x 4 periods) on load; switching
// windows is pure in-memory re-render, never a new query. Percentages are
// PRE-COMPUTED by the cron (backend/lib/marketStats.js) - the client does no
// price math, so the fairness rule (per-period matched subsets) is preserved.
(function () {
  var sb = window.memradarSupabase;
  if (!sb) return;

  var SEGMENT_LABELS = {
    ddr5: 'DDR5',
    ddr4: 'DDR4',
    nvme_ssd: 'NVMe SSD',
    sata_ssd: 'SATA SSD'
  };
  var PERIODS = [
    { key: '1m', label: '1M', detail: 'vs. 1 month ago' },
    { key: '3m', label: '3M', detail: 'vs. 3 months ago' },
    { key: '6m', label: '6M', detail: 'vs. 6 months ago' },
    { key: '1y', label: '1Y', detail: 'vs. 1 year ago' }
  ];
  var DEFAULT_PERIOD = '6m';
  // A period whose matched subset is more than this much SMALLER than the
  // default period's gets an explicit "n products" note, so a thinner sample
  // never masquerades as equally robust. ONE-DIRECTIONAL on purpose: a LARGER
  // sample is more robust, not less, and annotating it would read as a
  // warning about its own strength. (Measured 2026-08-21, the symmetric
  // version fired only on 1M for DDR5/DDR4 - both cases where the 30-day
  // window includes recently-added products with no 6-month history.)
  var COUNT_NOTE_THRESHOLD = 0.25;

  // Rising prices are bad for buyers: >=10% up is red (pulse-up), small rises
  // under 10% stay orange (pulse-neutral), falls are green (pulse-down).
  function cardClass(pct) {
    if (pct < 0) return 'pulse-down';
    if (pct < 10) return 'pulse-neutral';
    return 'pulse-up';
  }
  function formatPct(pct) {
    return (pct >= 0 ? '+' : '') + pct + '%';
  }

  var byPeriod = {};   // period -> segment -> row
  var activePeriod = DEFAULT_PERIOD;

  function segmentOf(card) {
    var categoryEl = card.querySelector('.pulse-category');
    if (!categoryEl) return null;
    var label = categoryEl.textContent.trim();
    return Object.keys(SEGMENT_LABELS).find(function (key) {
      return SEGMENT_LABELS[key] === label;
    });
  }

  function render(period) {
    var rows = byPeriod[period];
    if (!rows) return;
    var meta = PERIODS.filter(function (p) { return p.key === period; })[0];
    document.querySelectorAll('.pulse-card').forEach(function (card) {
      var changeEl = card.querySelector('.pulse-change');
      var detailEl = card.querySelector('.pulse-detail');
      var segment = segmentOf(card);
      var row = segment && rows[segment];
      if (!changeEl || !row || row.pct_change === null || row.pct_change === undefined) return;

      var pct = Number(row.pct_change);
      changeEl.textContent = formatPct(pct);
      card.classList.remove('pulse-up', 'pulse-down', 'pulse-neutral');
      card.classList.add(cardClass(pct));
      if (detailEl && meta) detailEl.textContent = meta.detail;

      // Honesty note: only when this period's sample is meaningfully smaller
      // or larger than the default period's for the SAME segment.
      var noteEl = card.querySelector('.pulse-count-note');
      var base = (byPeriod[DEFAULT_PERIOD] || {})[segment];
      var thin = base && base.product_count && row.product_count &&
        (base.product_count - row.product_count) / base.product_count > COUNT_NOTE_THRESHOLD;
      if (thin) {
        if (!noteEl) {
          noteEl = document.createElement('span');
          noteEl.className = 'pulse-count-note';
          card.appendChild(noteEl);
        }
        noteEl.textContent = row.product_count + ' products';
      } else if (noteEl) {
        noteEl.parentNode.removeChild(noteEl);
      }
    });
  }

  function buildButtons() {
    var host = document.querySelector('.pulse-windows');
    if (!host) return;
    PERIODS.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pdp-range-btn pulse-window-btn' + (p.key === activePeriod ? ' active' : '');
      btn.textContent = p.label;
      btn.setAttribute('aria-pressed', p.key === activePeriod ? 'true' : 'false');
      // A period with no rows yet (e.g. before the first new-schema cron run)
      // is disabled with an explanation rather than rendering stale or empty
      // cards.
      if (!byPeriod[p.key]) {
        btn.disabled = true;
        btn.title = 'Not available yet for this window';
      }
      btn.addEventListener('click', function () {
        if (btn.disabled || activePeriod === p.key) return;
        activePeriod = p.key;
        host.querySelectorAll('.pulse-window-btn').forEach(function (b) {
          var on = b.textContent === p.label;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render(p.key);
      });
      host.appendChild(btn);
    });
  }

  sb.from('market_stats')
    .select('segment, period, pct_change, product_count, computed_at')
    .then(function (res) {
      if (res.error || !res.data || res.data.length === 0) {
        console.log('Market Pulse: live stats unavailable, keeping defaults', res.error && res.error.message);
        return;
      }

      var newestComputedAt = null;
      res.data.forEach(function (row) {
        // Rows written before the period column existed are 6m by definition.
        var period = row.period || DEFAULT_PERIOD;
        if (!byPeriod[period]) byPeriod[period] = {};
        byPeriod[period][row.segment] = row;
        if (row.computed_at && (!newestComputedAt || row.computed_at > newestComputedAt)) {
          newestComputedAt = row.computed_at;
        }
      });

      buildButtons();
      render(activePeriod);

      if (newestComputedAt) {
        var updatedEl = document.querySelector('.pulse-updated');
        if (updatedEl) {
          var formatted = new Date(newestComputedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          updatedEl.textContent = 'Last updated: ' + formatted + ' · Prices updated twice daily';
        }
      }
    });
})();
