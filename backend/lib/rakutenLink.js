// Rakuten Advertising deep-link wrapper for Newegg affiliate links.
//
// The DB stores CLEAN product URLs; wrapping happens at render time only.
// Amazon used the same convention until 2026-09-30, when its Associates tag
// was dropped; Amazon links are now emitted exactly as stored. Format per Rakuten's publisher
// docs ("Create Deep Links Outside the Dashboard"):
//
//   https://click.linksynergy.com/deeplink?id={AFFILIATE_ID}&mid={MID}&murl={encoded destination}
//
// - id  = the publisher's 11-character case-sensitive "encrypted"/tracking ID.
//         NOTE: this is NOT the Publisher SID (4705448) - it comes from the
//         Rakuten dashboard. Set RAKUTEN_AFFILIATE_ID in .env / the generator
//         environment. It is PUBLIC once rendered into pages (like the Amazon
//         tag), but sourcing it from env keeps it in one place.
// - mid = advertiser id; Newegg via our approval is 44583.
// - murl = URL-encoded clean destination.
//
// An optional u1 sub-id parameter exists for click attribution; unused for now.

const NEWEGG_MID = '44583';
const BASE = 'https://click.linksynergy.com/deeplink';

// Returns the tracked deep link, or throws when the affiliate id is missing -
// we NEVER emit an untracked or half-built affiliate link (same rule as the
// Amazon tag). Callers should only invoke this when a Newegg offer exists.
function neweggDeepLink(cleanUrl, affiliateId = process.env.RAKUTEN_AFFILIATE_ID) {
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('neweggDeepLink: cleanUrl must be an absolute http(s) URL, got: ' + cleanUrl);
  }
  if (!affiliateId) {
    throw new Error('neweggDeepLink: RAKUTEN_AFFILIATE_ID is not set (the 11-char encrypted id from the Rakuten dashboard, not the SID)');
  }
  // The id is emitted RAW, exactly as Rakuten's own Deep Links tool does -
  // real ids contain '/' and '*' (e.g. xc/Oes*5*PA), which are legal unencoded
  // in a query value; percent-encoding them would deviate from Rakuten's
  // canonical link form.
  return `${BASE}?id=${affiliateId}&mid=${NEWEGG_MID}&murl=${encodeURIComponent(cleanUrl)}`;
}

module.exports = { neweggDeepLink, NEWEGG_MID };

// Self-test: node backend/lib/rakutenLink.js
if (require.main === module) {
  // node assert, NOT console.assert. This self-test is a step in the
  // pre-generation gate in .github/workflows/newegg-refresh.yml, and
  // console.assert prints "Assertion failed" and then exits 0, so a gate built
  // on it would be green for a broken link builder.
  const assert = require('assert');
  const link = neweggDeepLink('https://www.newegg.com/p/N82E16820331558?cm_sp=x', 'EXAMPLE11ID');
  console.log(link);
  const u = new URL(link);
  assert.strictEqual(u.hostname, 'click.linksynergy.com', 'host');
  assert.strictEqual(u.searchParams.get('mid'), NEWEGG_MID, 'mid');
  assert.strictEqual(u.searchParams.get('murl'), 'https://www.newegg.com/p/N82E16820331558?cm_sp=x', 'murl roundtrip');
  let threw = false;
  try { neweggDeepLink('https://x.com', ''); } catch (e) { threw = true; }
  assert.ok(threw, 'missing-id must throw');
  console.log('rakutenLink self-test OK');
}
