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
      res.data.forEach(function (row) {
        var cell = document.getElementById('pi-' + row.segment + '-' + row.period);
        if (cell) {
          var pct = row.pct_change == null ? null : Number(row.pct_change);
          cell.textContent = fmt(pct);
          cell.className = 'pi-cell ' + cellClass(pct);
        }
        if (row.computed_at && (!newest || row.computed_at > newest)) newest = row.computed_at;
      });
      if (newest) {
        var d = new Date(newest).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
        var asOf = document.getElementById('piAsOf');
        var note = document.getElementById('piComputedNote');
        if (asOf) asOf.textContent = 'Last computed ' + d;
        if (note) note.textContent = d;
      }
    })
    .catch(function () { /* keep baked values */ });
})();
