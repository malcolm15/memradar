// Social posting runner. PLATFORM-AGNOSTIC: composition and every guardrail
// live in backend/lib/tweetCompose.js and are shared by all targets; a
// platform client is only a publish call receiving the finished string.
//
//   --platform bluesky   (default) app-password auth, no tiers
//   --platform x         DORMANT: X requires the Basic tier at $200/month for
//                        write access (the free tier's 402 'credits depleted'
//                        was telling us exactly that). Code and proven OAuth
//                        1.0a signing are kept for a future where the spend is
//                        justified; see CLAUDE.md.
//   --mode daily    biggest 24h Amazon price drop (17:00 UTC)
//   --mode weekly   market_stats summary (Sunday 18:00 UTC)
//   --dry-run       compose and LOG, never post (workflow_dispatch default)
//   --confirm       actually post (the scheduled path passes this)
//
// SILENCE OVER WRONGNESS: every guardrail returns a skip reason and exits 0
// with nothing posted. Only genuine failures (DB unreachable, X API error)
// exit nonzero, which surfaces as a red run plus GitHub's failure email.
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { composeDaily, composeWeekly } = require('../backend/lib/tweetCompose');
const { postTweet, tweetLength } = require('../backend/lib/xClient');
const bluesky = require('../backend/lib/blueskyClient');
const { getState, setState } = require('../backend/lib/botState');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const MODE = arg('mode') || 'daily';
const PLATFORM = (arg('platform') || 'bluesky').toLowerCase();
const DRY = process.argv.includes('--dry-run') || !process.argv.includes('--confirm');
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const paged = async (build) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

// 24h drop per product: newest price vs the row closest to 24h ago inside an
// 18-30h band. Same reduce-newest / reduce-closest shape as the site's price
// loaders; the window is 24h because "biggest drop today" must mean today.
async function dailyCandidates() {
  const now = Date.now();
  const rows = await paged(() => supabase.from('price_history')
    .select('product_id, price, fetched_at')
    .gte('fetched_at', new Date(now - 30 * 3600000).toISOString()));
  const newest = new Map(), base = new Map();
  const target = now - 24 * 3600000;
  for (const r of rows) {
    const t = new Date(r.fetched_at).getTime();
    const n = newest.get(r.product_id);
    if (!n || r.fetched_at > n.fetched_at) newest.set(r.product_id, r);
    if (t <= now - 18 * 3600000) {
      const d = Math.abs(t - target), prev = base.get(r.product_id);
      if (!prev || d < prev._d) base.set(r.product_id, { price: Number(r.price), _d: d });
    }
  }
  const newestStamp = rows.reduce((a, r) => (r.fetched_at > a ? r.fetched_at : a), '');
  const priceDataAgeH = newestStamp ? (now - new Date(newestStamp).getTime()) / 3600000 : null;

  const { data: products, error } = await supabase
    .from('products').select('id, sku, name, brand, category, slug').eq('retailer', 'amazon');
  if (error) throw new Error(error.message);
  const { data: offers } = await supabase
    .from('retailer_offers').select('product_id, in_stock').eq('retailer', 'amazon');
  const stock = new Map((offers || []).map((o) => [o.product_id, o.in_stock]));

  const candidates = [];
  for (const p of products) {
    const n = newest.get(p.id), b = base.get(p.id);
    if (!n || !b) continue;
    const current = Number(n.price);
    const dropPct = ((current - b.price) / b.price) * 100;
    if (dropPct >= 0) continue;
    candidates.push({ product: p, current, previous: b.price, dropPct, atl: null, inStock: stock.get(p.id) });
  }
  candidates.sort((a, b) => a.dropPct - b.dropPct);

  // All-time low AND 90-day average, only for the few we might actually
  // tweet (one query each). The average backs the non-doom context clause.
  const since90 = new Date(now - 90 * 86400000).toISOString();
  for (const c of candidates.slice(0, 8)) {
    const hist = await paged(() => supabase.from('price_history')
      .select('price, fetched_at').eq('product_id', c.product.id));
    const prices = hist.map((r) => Number(r.price));
    c.atl = prices.length ? Math.min(...prices) : null;
    const win = hist.filter((r) => r.fetched_at >= since90).map((r) => Number(r.price));
    c.avg90 = win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  }
  return { candidates, priceDataAgeH };
}

// Per-platform dedup key: if X is ever revived alongside Bluesky, one
// platform's post must not suppress the other's. bot_state was empty when
// this was renamed, so there was nothing to migrate.
const STATE_KEY = `${PLATFORM}_daily_last_post`;

async function run() {
  log(`Social post runner: platform=${PLATFORM} mode=${MODE}${DRY ? ' (DRY RUN - nothing will be posted)' : ''}`);
  if (!['bluesky', 'x'].includes(PLATFORM)) throw new Error(`unknown platform: ${PLATFORM}`);
  // Dedup state in Supabase (backend/lib/botState.js). A read error THROWS,
  // so a broken state store fails the run loudly rather than silently
  // disabling dedup and letting the bot repeat itself.
  let lastSku = '';
  if (MODE === 'daily') {
    const st = await getState(STATE_KEY, null);
    lastSku = (st && st.sku) || '';
    log(`Dedup state: ${lastSku ? `last tweeted ${lastSku} on ${st.date || 'unknown date'}` : '(none yet)'}`);
  }
  let result;
  if (MODE === 'weekly') {
    const { data: rows, error } = await supabase
      .from('market_stats').select('segment, period, pct_change, computed_at').eq('period', '1m');
    if (error) throw new Error(error.message);
    const computedAt = (rows || []).map((r) => r.computed_at).sort().pop();
    result = composeWeekly({ rows, period: '1m', computedAt });
  } else {
    const { candidates, priceDataAgeH } = await dailyCandidates();
    log(`Drop candidates: ${candidates.length}${candidates.length ? `, biggest ${candidates[0].dropPct.toFixed(1)}% (${candidates[0].product.sku})` : ''}; price data ${priceDataAgeH == null ? 'unknown' : priceDataAgeH.toFixed(1) + 'h'} old; dedup excludes ${lastSku || '(nothing)'}`);
    result = composeDaily({ candidates, lastTweetedSku: lastSku, priceDataAgeH });
  }

  (result.rejected || []).forEach((r) => log(`  rejected: ${r}`));

  if (result.skip) {
    log(`SKIP: ${result.skip}`);
    console.log('SUMMARY ' + JSON.stringify({ mode: MODE, posted: false, dry_run: DRY, skip: result.skip }));
    return;
  }

  const size = PLATFORM === 'bluesky'
    ? `${bluesky.graphemeCount(result.text)}/${bluesky.POST_MAX_GRAPHEMES} graphemes`
    : `${tweetLength(result.text)}/280 chars`;
  log(`Composed (${size}, branch=${result.branch}):`);
  console.log('\n----- POST -----\n' + result.text + '\n----------------\n');

  // Bluesky does not auto-link URLs: the record carries richtext facets whose
  // offsets are UTF-8 BYTE offsets, not JS string indices. Our posts open with
  // an emoji, so those two disagree - print the computed ranges and prove the
  // sliced bytes decode back to the URL before anything is published.
  let facets = null;
  if (PLATFORM === 'bluesky') {
    facets = bluesky.describeFacets(result.text, bluesky.linkFacets(result.text));
    facets.forEach((f) => log(`  facet: bytes [${f.byteStart}, ${f.byteEnd}) -> "${f.slicedBytesDecodeTo}" | matches URL: ${f.matches}`));
    if (facets.some((f) => !f.matches)) throw new Error('facet byte range does not span its URL - refusing to post');
    if (!facets.length) log('  facet: none (no URL in text)');
  }

  if (DRY) {
    log('DRY RUN: not posting.');
    console.log('SUMMARY ' + JSON.stringify({ platform: PLATFORM, mode: MODE, posted: false, dry_run: true, branch: result.branch, size, facets, sku: result.sku || null, text: result.text }));
    return;
  }

  let posted, postUri = null, postUrl = null;
  if (PLATFORM === 'bluesky') {
    posted = await bluesky.postSkeet(result.text);
    postUri = posted.uri; postUrl = posted.url;
    log(`Posted to Bluesky: ${posted.url || posted.uri}`);
  } else {
    posted = await postTweet(result.text);
    postUri = posted.id || null;
    log(`Posted to X: id=${posted.id || '(unknown)'}`);
  }
  console.log('SUMMARY ' + JSON.stringify({ platform: PLATFORM, mode: MODE, posted: true, dry_run: false, branch: result.branch, size, sku: result.sku || null, uri: postUri, url: postUrl }));
  // Record what we posted so tomorrow's run can exclude it.
  if (result.sku) {
    await setState(STATE_KEY, { sku: result.sku, date: new Date().toISOString().slice(0, 10), uri: postUri });
    log(`Dedup state updated: ${result.sku}`);
  }
}

run().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.message}`);
  process.exit(1);
});
