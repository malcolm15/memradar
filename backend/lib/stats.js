// Shared numeric helpers for figures the site publishes.
//
// WHY THIS FILE EXISTS. `percentile` had exactly one home, inside
// scripts/jaccard.js, and that file's own header explains why the method
// matters more than the number: "A number whose method is not recorded is not
// a baseline, it is an anecdote." The paired year-over-year metric needs p25
// and p75 and must use that same convention rather than a second one, so the
// function moves here and jaccard.js imports it. Nothing about its behaviour
// changes.
//
// THE FOUR EXISTING `median` COPIES ARE DELIBERATELY NOT TOUCHED (line numbers
// as of the commit that adds this file; the generator's two moved down by one
// when it gained a require on 2026-10-08):
//   backend/lib/marketStats.js:313
//   backend/lib/keepa.js:131
//   scripts/generate-product-pages.js:297
//   scripts/generate-product-pages.js:4344
// Every one of them feeds a published figure, and consolidating them is a
// refactor whose blast radius is the whole site. The copy below is the
// canonical one FOR NEW CALLERS only. It is behaviourally identical to
// marketStats.js:313, and backend/lib/pairedYoy.js asserts that against a
// pinned copy of each on random arrays in its self-test, so a future
// divergence fails the pre-generation gate rather than shipping.

// Linear interpolation on (n-1)*p/100. Moved verbatim from
// scripts/jaccard.js:78, where it was the repo's only array-quantile helper.
// Expects an ALREADY SORTED ascending array, which is the caller's job and is
// why the parameter is named `sorted`.
function percentile(sorted, p) {
  const k = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(k), hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

// Sorts a copy, so the caller's array is left alone. Even n is the MEAN OF THE
// TWO MIDDLE VALUES, which is what every existing copy in this repo does and
// what percentile(s, 50) returns, so the two agree at p50 by construction.
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Convenience for unsorted input. Kept separate from `percentile` rather than
// making that function sort: jaccard.js sorts once and then asks for several
// quantiles, and a sorting `percentile` would quietly make that O(n log n) per
// call.
const quantileOf = (xs, p) => percentile([...xs].sort((a, b) => a - b), p);

module.exports = { percentile, median, quantileOf };
