// Memory Price Index hydration. The live-reading table is baked at generation time
// (so the page is correct with JS off and for crawlers) and refreshed here
// from the same market_stats rows the homepage Market Pulse reads, in ONE
// query. Between regenerations this keeps the page no staler than the last
// cron run.
//
// Degrades by omission: on any error the baked values stay. Thresholds match
// the generator's piCellClass() and market-pulse.js exactly - rising prices
// are bad for buyers, so >=10% up is red, a smaller rise orange, a fall green.
(function () {
  // Copy citation: progressive enhancement over the plain-text citation. The
  // button ships hidden and is shown only where the clipboard API exists, so
  // without JS (or without the API) the text is still there to select.
  var copyBtn = document.getElementById('pimCopy');
  var citation = document.getElementById('pimCitation');
  if (copyBtn && citation && navigator.clipboard && navigator.clipboard.writeText) {
    copyBtn.hidden = false;
    copyBtn.addEventListener('click', function () {
      var status = document.getElementById('pimCopyStatus');
      navigator.clipboard.writeText(citation.textContent.trim()).then(function () {
        if (status) status.textContent = 'Copied';
      }, function () {
        if (status) status.textContent = 'Select the text above to copy it';
      });
    });
  }

  var sb = window.memradarSupabase;
  var table = document.getElementById('piTable');
  if (!sb || !table) return;

  var SEGMENT_LABELS = {
    ddr5: 'DDR5',
    ddr4: 'DDR4',
    nvme_ssd: 'NVMe SSD',
    sata_ssd: 'SATA SSD'
  };

  // The same rule as the generator's piLivePct/piLiveClass: one decimal, and a
  // value under 0.05% in absolute terms reads 0.0% in the neutral grey with no
  // sign. The two must stay in step or the hydrated cell disagrees with the
  // baked one.
  function flat(pct) { return pct != null && Math.abs(pct) < 0.05; }
  function cellClass(pct) {
    if (pct == null) return 'pi-na';
    if (flat(pct)) return 'pim-flat';
    if (pct < 0) return 'pi-down';
    if (pct < 10) return 'pi-neutral';
    return 'pi-up';
  }
  function fmt(pct) {
    return pct == null ? 'n/a' : flat(pct) ? '0.0%' : (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
  }

  sb.from('market_stats')
    .select('segment, period, pct_change, product_count, computed_at')
    .then(function (res) {
      if (res.error || !res.data || !res.data.length) return; // keep baked
      var newest = null;
      var topSeg = null; // steepest 1y move, recomputed from the same fetch
      res.data.forEach(function (row) {
        // SEGMENT_LABELS is the allow-list, not just a lookup. market_stats is
        // keyed on (segment, period) and carries rows this page does not
        // tabulate - the build-cost baskets are stored there as pseudo-segments
        // so the claim-floor machinery can read them unchanged. Without this
        // guard such a row could win the steepest-1y race and the hydrated
        // sentence would disagree with the baked one. The generator applies the
        // same filter; the two must stay in step.
        var known = Object.prototype.hasOwnProperty.call(SEGMENT_LABELS, row.segment);
        if (known && row.period === '1y' && row.pct_change != null &&
            (!topSeg || Number(row.pct_change) > Number(topSeg.pct_change))) {
          topSeg = row;
        }
        var cell = document.getElementById('pi-' + row.segment + '-' + row.period);
        if (cell) {
          var pct = row.pct_change == null ? null : Number(row.pct_change);
          cell.textContent = fmt(pct);
          cell.className = 'pi-cell ' + cellClass(pct);
        }
        // n rides the same row as the figure, so the two cannot disagree.
        var nEl = document.getElementById('pi-' + row.segment + '-' + row.period + '-n');
        if (nEl) nEl.textContent = row.product_count == null ? '' : 'n ' + row.product_count;
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
        var when = new Date(newest);
        var d = when.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        var hh = String(when.getUTCHours()); if (hh.length < 2) hh = '0' + hh;
        var mm = String(when.getUTCMinutes()); if (mm.length < 2) mm = '0' + mm;
        var asOf = document.getElementById('piAsOf');
        if (asOf) asOf.textContent = 'Last computed ' + d + ' ' + hh + ':' + mm + ' UTC';
      }
    })
    .catch(function (e) { console.log('[price-index] hydration failed, keeping baked values:', e && e.message); });
})();
