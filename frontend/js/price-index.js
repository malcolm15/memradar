// Memory Price Index hydration. The 16-cell table is baked at generation time
// (so the page is correct with JS off and for crawlers) and refreshed here
// from the same market_stats rows the homepage Market Pulse reads, in ONE
// query. Between regenerations this keeps the page no staler than the last
// cron run.
//
// Degrades by omission: on any error the baked values stay. Thresholds match
// the generator's piCellClass() and market-pulse.js exactly - rising prices
// are bad for buyers, so >=10% up is red, a smaller rise orange, a fall green.
(function () {
  var sb = window.memradarSupabase;
  var table = document.getElementById('piTable');
  if (!sb || !table) return;

  var SEGMENT_LABELS = {
    ddr5: 'DDR5',
    ddr4: 'DDR4',
    nvme_ssd: 'NVMe SSD',
    sata_ssd: 'SATA SSD'
  };

  function cellClass(pct) {
    if (pct == null) return 'pi-na';
    if (pct < 0) return 'pi-down';
    if (pct < 10) return 'pi-neutral';
    return 'pi-up';
  }
  function fmt(pct) {
    return pct == null ? 'n/a' : (pct >= 0 ? '+' : '') + pct + '%';
  }

  sb.from('market_stats')
    .select('segment, period, pct_change, computed_at')
    .then(function (res) {
      if (res.error || !res.data || !res.data.length) return; // keep baked
      var newest = null;
      var topSeg = null; // steepest 1y move, recomputed from the same fetch
      res.data.forEach(function (row) {
        if (row.period === '1y' && row.pct_change != null &&
            (!topSeg || Number(row.pct_change) > Number(topSeg.pct_change))) {
          topSeg = row;
        }
        var cell = document.getElementById('pi-' + row.segment + '-' + row.period);
        if (cell) {
          var pct = row.pct_change == null ? null : Number(row.pct_change);
          cell.textContent = fmt(pct);
          cell.className = 'pi-cell ' + cellClass(pct);
        }
        if (row.computed_at && (!newest || row.computed_at > newest)) newest = row.computed_at;
      });
      // Notable number #1 names the steepest segment AND its figure, both of
      // which sit beside the hydrated table. Update both from the same rows so
      // the sentence and the table can never disagree. (#2's floor is rounded
      // down to the nearest 10 and absorbs drift by design; #3 and #4 are
      // derived from data nothing on this page displays live, so they cannot
      // visibly contradict anything - see CLAUDE.md.)
      if (topSeg) {
        var segEl = document.getElementById('piTopSeg');
        var pctEl = document.getElementById('piTopPct');
        if (segEl) segEl.textContent = SEGMENT_LABELS[topSeg.segment] || topSeg.segment;
        if (pctEl) pctEl.textContent = fmt(Number(topSeg.pct_change));
      }
      if (newest) {
        var d = new Date(newest).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        var asOf = document.getElementById('piAsOf');
        var note = document.getElementById('piComputedNote');
        if (asOf) asOf.textContent = 'Last computed ' + d;
        if (note) note.textContent = d;
      }
    })
    .catch(function (e) { console.log('[price-index] hydration failed, keeping baked values:', e && e.message); });
})();
