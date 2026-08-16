// Refresh retailer_offers (retailer='newegg') from the Rakuten feed - the
// Newegg Phase-2 cron body. Invoked daily by .github/workflows/newegg-refresh.yml.
//
// STRATEGY (Gate-A approved):
// - DAILY DELTA (default): stream 44583_4705448_mp_delta.txt.gz. Column 39
//   is a change marker: I/U rows matching one of our retailer_skus update
//   price + in_stock=true + clean product_url + fetched_at; D rows flip
//   in_stock=false (same-day OOS signal - the complete feed carries only
//   purchasable items). Rows for SKUs we never matched are ignored: the cron
//   NEVER re-matches automatically.
// - SUNDAY FULL (--full): stream the complete file instead and re-sync
//   authoritatively: present -> price/in_stock=true/fetched_at=now; absent
//   -> in_stock=false (fetched_at untouched). Bounds missed-delta drift at
//   7 days.
// - STALENESS NET (every run): offers still marked in_stock=true whose
//   fetched_at is older than 9 days flip to in_stock=false. Deltas only
//   express CHANGES, so unseen-in-delta is not evidence of absence; this net
//   only catches failed/missed Sunday fulls (one missed Sunday + 2-day
//   buffer).
// - FAILURE: any hard error exits nonzero (red Actions run + GitHub email)
//   and changes nothing further - stale beats wrong. Per-row write failures
//   are counted and also fail the run at the end.
//
// Usage:
//   node scripts/refresh-newegg-offers.js               # dry run (delta)
//   node scripts/refresh-newegg-offers.js --full        # dry run (complete file)
//   node scripts/refresh-newegg-offers.js --confirm     # apply (delta)
//   node scripts/refresh-newegg-offers.js --confirm --full
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const supabase = require('../backend/lib/supabase');
const feed = require('../backend/lib/neweggFeed');

const CONFIRM = process.argv.includes('--confirm');
const FULL = process.argv.includes('--full');
const LOCAL_FILE = (process.argv.find((a) => a.startsWith('--file=')) || '').replace('--file=', '');
const OUT_DIR = path.join(__dirname, 'output');
const STALE_DAYS = 9;
const DELTA_TIMEOUT_MS = 120_000; // ~1.6MB file
const FULL_TIMEOUT_MS = 900_000; // 15min ceiling for the ~158MB file

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function run() {
  const started = Date.now();
  const mode = FULL ? 'full' : 'delta';
  log(`Newegg offer refresh: mode=${mode}${CONFIRM ? '' : ' (DRY RUN - nothing written)'}`);

  // Our offers, keyed by Newegg item number. The cron only ever touches
  // rows that already exist - matching stays a human-gated concern.
  const { data: offers, error } = await supabase
    .from('retailer_offers')
    .select('id, product_id, retailer_sku, price, in_stock, fetched_at')
    .eq('retailer', 'newegg');
  if (error) throw new Error('offers load failed: ' + error.message);
  // sku -> offer[] (NOT a 1:1 map): several of our products legitimately
  // share one Newegg listing (e.g. two Amazon entries for the same 990 PRO),
  // an approved matching outcome. Keying 1:1 would refresh only one of each
  // pair and let the staleness net wrongly flip its twin out of stock.
  const bySku = new Map();
  for (const o of offers) {
    if (!bySku.has(o.retailer_sku)) bySku.set(o.retailer_sku, []);
    bySku.get(o.retailer_sku).push(o);
  }
  const shared = [...bySku.values()].filter((a) => a.length > 1).length;
  log(`Existing offers: ${offers.length} across ${bySku.size} distinct Newegg SKUs${shared ? ` (${shared} SKUs shared by multiple products)` : ''}`);

  // ---- obtain the feed ----
  // --file=<path> skips the download and applies an already-fetched feed:
  // for offline testing and for re-applying after a partial failure without
  // pulling 150MB again.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const local = LOCAL_FILE || path.join(OUT_DIR, FULL ? feed.COMPLETE_FILE : feed.DELTA_FILE);
  let dl = { bytes: 0, viaWatchdog: false };
  if (LOCAL_FILE) {
    if (!fs.existsSync(LOCAL_FILE)) throw new Error('--file not found: ' + LOCAL_FILE);
    dl.bytes = fs.statSync(LOCAL_FILE).size;
    log(`Using local feed file ${LOCAL_FILE} (${(dl.bytes / 1048576).toFixed(1)} MB) - no download`);
  } else {
    const remote = '/' + (FULL ? feed.COMPLETE_FILE : feed.DELTA_FILE);
    const sftp = await feed.connect(log);
    try {
      dl = await feed.downloadGz(sftp, remote, local, FULL ? FULL_TIMEOUT_MS : DELTA_TIMEOUT_MS, log);
    } finally {
      await feed.endConnection(sftp, log);
    }
    log(`Downloaded ${(dl.bytes / 1048576).toFixed(1)} MB${dl.viaWatchdog ? ' (completed via watchdog + gzip integrity check)' : ''}`);
  }

  // ---- collect changes ----
  const now = new Date().toISOString();
  const updates = new Map(); // offer id -> {fields, reason}
  const put = (offer, fields, reason) => {
    updates.set(offer.id, { offer, fields, reason });
  };
  const seen = new Set();
  const stats = await feed.streamRakutenFeed(local, (item) => {
    const matched = bySku.get(item.sku);
    if (!matched) return;
    seen.add(item.sku);
    for (const offer of matched) { // every product sharing this listing
      if (FULL || item.change === 'I' || item.change === 'U') {
        if (item.price == null) continue; // never store a null price
        put(offer, { price: item.price, in_stock: true, product_url: item.url, fetched_at: now },
          `${item.change || 'present'} $${offer.price} -> $${item.price}${offer.in_stock === false ? ' (back in stock)' : ''}`);
      } else if (item.change === 'D') {
        put(offer, { in_stock: false, fetched_at: now }, `D (left feed) - was $${offer.price}`);
      }
    }
  });
  log(`Feed rows: ${stats.total}; rows matching our SKUs: ${seen.size}`);

  // Full mode: absence from the complete feed is authoritative OOS.
  if (FULL) {
    for (const o of offers) {
      if (!seen.has(o.retailer_sku) && o.in_stock !== false) {
        put(o, { in_stock: false }, 'absent from complete feed'); // fetched_at untouched: absence is not a sighting
      }
    }
  }

  // Staleness net (all modes): un-refreshed for > STALE_DAYS -> not honest to
  // keep claiming In Stock. Skips offers already updated this run.
  const staleCutoff = Date.now() - STALE_DAYS * 86400000;
  let staleFlips = 0;
  for (const o of offers) {
    if (updates.has(o.id)) continue;
    if (o.in_stock === true && new Date(o.fetched_at).getTime() < staleCutoff) {
      put(o, { in_stock: false }, `stale: fetched_at ${o.fetched_at} older than ${STALE_DAYS}d`);
      staleFlips++;
    }
  }

  // ---- report + apply ----
  const priceUpdates = [...updates.values()].filter((u) => u.fields.price != null);
  const oosFlips = [...updates.values()].filter((u) => u.fields.in_stock === false);
  log(`Planned: ${updates.size} row updates (${priceUpdates.length} price refreshes, ${oosFlips.length} OOS flips of which ${staleFlips} staleness)`);
  for (const { offer, reason } of updates.values()) {
    console.log(`  ${offer.retailer_sku}: ${reason}`);
  }

  if (!CONFIRM) {
    log('Dry run complete - re-run with --confirm to apply.');
    return;
  }
  let writes = 0, failures = 0;
  for (const { offer, fields } of updates.values()) {
    const { error: upErr } = await supabase.from('retailer_offers').update(fields).eq('id', offer.id);
    if (upErr) { console.error(`  write failed [${offer.retailer_sku}]: ${upErr.message}`); failures++; continue; }
    writes++;
  }
  const summary = { mode, feedRows: stats.total, ourSkusSeen: seen.size, writes, priceUpdates: priceUpdates.length, oosFlips: oosFlips.length, staleFlips, failures, viaWatchdog: dl.viaWatchdog, durationMs: Date.now() - started };
  log('SUMMARY ' + JSON.stringify(summary));
  if (failures) throw new Error(`${failures} row writes failed`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
