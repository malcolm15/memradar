// THE ONE PLACE THAT DECIDES WHICH STABLE-COHORT FIGURE A CHECK USES.
//
// There are two of them, computed every run, and they are not interchangeable:
//   stable_paired_pct   median of per-product current/baseline ratios.
//   stable_pct_change   ratio of the cohort's two medians, the same statistic
//                       the full cohort publishes.
//
// Everything that asks "is a published sentence still true" wants the PAIRED
// figure. The published number divides two independently sorted medians, so a
// membership change moves each median on its own and the result can walk across
// a gap in the price list. On 2026-09-22, three products aging out of the 6m
// window took ddr4 1y from +98.7% to +162.1% in 48 hours with no price move
// behind it, withdrawing a /data/ finding and breaching three live sentences.
// The paired median moved 145.1 to 146.9 across the same change.
//
// THE STABILITY TRIPWIRE DELIBERATELY DOES NOT USE THIS. Its question is how
// much a figure depends on who qualifies, which needs the statistic held fixed
// while the population varies, so it compares pct_change with
// stable_pct_change directly and never comes through here.
//
// WHY ITS OWN MODULE: marketStats.js requires claimRegistry.js, so claimRegistry
// cannot require marketStats back. This rule was briefly duplicated in both to
// dodge that cycle, which is exactly how two copies drift apart. One file,
// imported by both, no cycle.

/**
 * The stable-cohort figure to check a claim against.
 *
 * @param {object} row          a market_stats row, stored or in-memory
 * @param {function} [onFallback] called with the row when the pre-migration
 *        reconstruction is used, so the fallback can report itself instead of
 *        passing silently. It is the measure that caused the incident above.
 * @returns {number|null} percent change, or null when neither figure exists
 */
function stableFigureOf(row, onFallback) {
  if (row == null || row.pct_change == null) return null;
  if (row.stable_paired_pct != null) return Number(row.stable_paired_pct);

  // Pre-migration rows, and rows from a run that wrote before the ALTER landed.
  // In-memory rows carry stable_pct_change; stored rows do not, and reconstruct
  // it from the signed delta. Both are the ratio of medians.
  const reconstructed = row.stable_pct_change != null
    ? Number(row.stable_pct_change)
    : (row.stability_delta_pp != null
      ? Math.round((Number(row.pct_change) - Number(row.stability_delta_pp)) * 10) / 10
      : null);
  if (reconstructed == null) return null;
  if (typeof onFallback === 'function') onFallback(row);
  return reconstructed;
}

/**
 * Which measure stableFigureOf() would return for this row, as text for a log
 * or an issue body. Lives here so the CONDITION exists once: a label computed
 * elsewhere is a second copy of the rule waiting to disagree with it.
 */
function stableMeasureOf(row) {
  if (row == null || row.pct_change == null) return 'none';
  return row.stable_paired_pct != null ? 'paired median' : 'ratio of medians (fallback)';
}

module.exports = { stableFigureOf, stableMeasureOf };
