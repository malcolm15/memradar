// X/Twitter posting runner, invoked by .github/workflows/x-posts.yml.
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

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const MODE = arg('mode') || 'daily';
const DRY = process.argv.includes('--dry-run') || !process.argv.includes('--confirm');
const LAST_SKU = arg('last-sku') || process.env.LAST_TWEETED_SKU || '';
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

  // All-time low only for the few we might actually tweet (one query each).
  for (const c of candidates.slice(0, 8)) {
    const hist = await paged(() => supabase.from('price_history').select('price').eq('product_id', c.product.id));
    c.atl = hist.length ? Math.min(...hist.map((r) => Number(r.price))) : null;
  }
  return { candidates, priceDataAgeH };
}

async function run() {
  log(`X post runner: mode=${MODE}${DRY ? ' (DRY RUN - nothing will be posted)' : ''}`);
  let result;
  if (MODE === 'weekly') {
    const { data: rows, error } = await supabase
      .from('market_stats').select('segment, period, pct_change, computed_at').eq('period', '1m');
    if (error) throw new Error(error.message);
    const computedAt = (rows || []).map((r) => r.computed_at).sort().pop();
    result = composeWeekly({ rows, period: '1m', computedAt });
  } else {
    const { candidates, priceDataAgeH } = await dailyCandidates();
    log(`Drop candidates: ${candidates.length}${candidates.length ? `, biggest ${candidates[0].dropPct.toFixed(1)}% (${candidates[0].product.sku})` : ''}; price data ${priceDataAgeH == null ? 'unknown' : priceDataAgeH.toFixed(1) + 'h'} old; dedup excludes ${LAST_SKU || '(nothing)'}`);
    result = composeDaily({ candidates, lastTweetedSku: LAST_SKU, priceDataAgeH });
  }

  (result.rejected || []).forEach((r) => log(`  rejected: ${r}`));

  if (result.skip) {
    log(`SKIP: ${result.skip}`);
    console.log('SUMMARY ' + JSON.stringify({ mode: MODE, posted: false, dry_run: DRY, skip: result.skip }));
    return;
  }

  log(`Composed (${tweetLength(result.text)}/280, branch=${result.branch}):`);
  console.log('\n----- TWEET -----\n' + result.text + '\n-----------------\n');

  if (DRY) {
    log('DRY RUN: not posting.');
    console.log('SUMMARY ' + JSON.stringify({ mode: MODE, posted: false, dry_run: true, branch: result.branch, chars: tweetLength(result.text), sku: result.sku || null, text: result.text }));
    return;
  }
  const posted = await postTweet(result.text);
  log(`Posted: id=${posted.id || '(unknown)'}`);
  console.log('SUMMARY ' + JSON.stringify({ mode: MODE, posted: true, dry_run: false, branch: result.branch, chars: tweetLength(result.text), sku: result.sku || null, tweet_id: posted.id || null }));
  // The workflow reads this line to update the dedup state variable.
  if (result.sku) console.log('TWEETED_SKU=' + result.sku);
}

run().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL: ${err.message}`);
  process.exit(1);
});
