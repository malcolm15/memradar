// Market Pulse: replace the hardcoded homepage stats with live market_stats
// rows. The hardcoded HTML values are the loading state - if the fetch fails
// or a segment has no data, they stay as-is (never show a broken section).
(function () {
  var sb = window.memradarSupabase;
  if (!sb) return;

  var SEGMENT_LABELS = {
    ddr5: 'DDR5',
    ddr4: 'DDR4',
    nvme_ssd: 'NVMe SSD',
    sata_ssd: 'SATA SSD'
  };

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

  sb.from('market_stats')
    .select('segment, pct_change, computed_at')
    .then(function (res) {
      if (res.error || !res.data || res.data.length === 0) {
        console.log('Market Pulse: live stats unavailable, keeping defaults', res.error && res.error.message);
        return;
      }

      var bySegment = {};
      var newestComputedAt = null;
      res.data.forEach(function (row) {
        bySegment[row.segment] = row;
        if (row.computed_at && (!newestComputedAt || row.computed_at > newestComputedAt)) {
          newestComputedAt = row.computed_at;
        }
      });

      document.querySelectorAll('.pulse-card').forEach(function (card) {
        var categoryEl = card.querySelector('.pulse-category');
        var changeEl = card.querySelector('.pulse-change');
        if (!categoryEl || !changeEl) return;
        var label = categoryEl.textContent.trim();
        var segment = Object.keys(SEGMENT_LABELS).find(function (key) {
          return SEGMENT_LABELS[key] === label;
        });
        var row = segment && bySegment[segment];
        if (!row || row.pct_change === null || row.pct_change === undefined) return;

        var pct = Number(row.pct_change);
        changeEl.textContent = formatPct(pct);
        card.classList.remove('pulse-up', 'pulse-down', 'pulse-neutral');
        card.classList.add(cardClass(pct));
      });

      if (newestComputedAt) {
        var updatedEl = document.querySelector('.pulse-updated');
        if (updatedEl) {
          var formatted = new Date(newestComputedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          updatedEl.textContent = 'Last updated: ' + formatted + ' · Prices update daily';
        }
      }
    });
})();
