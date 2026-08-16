// Match our Amazon catalog against a Newegg affiliate feed file (Rakuten),
// producing retailer_offers candidates for the Buy Now comparison row.
//
// SCOPE: current-price comparison ONLY. Price history/charts/analysis/alerts
// stay Amazon/Keepa. A wrong match is worse than a missing row.
//
// TIERS:
//   TIER 1 (auto-accepted, still listed for review): normalized-MPN equality.
//     Our MPN comes from parseMpn(name) (backend/lib/productParsers.js - the
//     same extraction the PDP structured data uses). Normalization both sides:
//     uppercase, strip every non-alphanumeric.
//   TIER 1.5 (NEVER auto-accepted): UPC/EAN/GTIN join. Our side comes from
//     products.upc (Keepa upcList/eanList/gtinList via scripts/fetch-upcs.js,
//     comma-joined, leading zeros stripped). Feed side: the column-24 GTIN
//     plus barcode-looking values in the MPN column (Newegg pollutes it).
//     Bundles/multipacks can share a barcode, so proposals go through the
//     same human gate as tier 2 (method 'upc' in the review file).
//   TIER 2 (NEVER auto-accepted): brand + capacity + line-signature containment
//     (reuses build-families' lineSignature - no third parser). Written to the
//     review file as proposals with both names side by side. To accept one,
//     edit scripts/output/newegg-matches.json: set "accepted": true on the
//     entry, then re-run with --confirm.
//   Ambiguity (multiple feed rows for one product): prefer exact-case raw MPN
//   match, then sold-by-Newegg over marketplace (when the feed distinguishes),
//   then in-stock over not, then lowest price. Competing rows are logged.
//
// FEED: path passed as the first positional argument. Format-tolerant:
//   - Rakuten merchandiser complete feed (real Newegg feed): pipe-delimited,
//     38 positional columns, NO header row - first line HDR|mid|advertiser|ts,
//     last line TRL|rowcount. Detected by the HDR| prefix and STREAMED line by
//     line (the full file is ~1.4 GB, beyond Node's max string length).
//     Products are loaded first so streaming keeps only rows we can use:
//     rows whose MPN is one of ours, plus tier-2 candidates (brand + capacity
//     prefilter - the same first two conditions the tier-2 filter applies).
//     Seller is derived from the item number: 9S... = marketplace,
//     anything else (N82E...) = sold by Newegg.
//   - CSV/TSV/pipe with a header line (delimiter sniffed, RFC4180 quoting)
//   - XML (any <product>/<item> record tag; child tags read as fields)
//   Header/field names are looked up case/space-insensitively against a
//   synonym table; if required fields can't be mapped the script fails LOUDLY
//   listing every header it saw, so adapting to a new feed is a one-line
//   synonym addition.
//
// OUTPUT: scripts/output/newegg-matches.json (machine) + newegg-review.txt
// (human, "OUR: ... <-> NEWEGG: ..." grouped by method) + the same report on
// stdout. GATE: nothing writes to retailer_offers without --confirm, and
// --confirm writes tier-1 (mpn) rows plus ONLY tier-2 rows explicitly marked
// "accepted": true (recorded with match_method 'name'; hand-added rows may use
// 'manual'). Clean URLs stored - affiliate wrapping happens at render time
// (backend/lib/rakutenLink.js).
//
// Usage:
//   node scripts/match-newegg.js <feed-file>             # dry run + review report
//   node scripts/match-newegg.js <feed-file> --confirm   # write accepted matches
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../backend/lib/supabase');
const { parseMpn, totalCapacityGB, parseKitConfig, normBarcode, looksLikeBarcode } = require('../backend/lib/productParsers');
const { tokenize, lineSignature, invariants } = require('./build-families');

const CONFIRM = process.argv.includes('--confirm');
const FEED_PATH = process.argv.slice(2).find((a) => !a.startsWith('--'));
const OUT_DIR = path.join(__dirname, 'output');
const JSON_OUT = path.join(OUT_DIR, 'newegg-matches.json');
const REVIEW_OUT = path.join(OUT_DIR, 'newegg-review.txt');

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// ------------------------------------------------------------ feed parsing
const FIELD_SYNONYMS = {
  name: ['name', 'productname', 'product name', 'title', 'itemname', 'description', 'product_name'],
  mpn: ['mpn', 'manufacturerpartnumber', 'manufacturer part number', 'mfgpart', 'mfg part', 'partnumber', 'part number', 'mfr part number', 'manufacturer_part_number'],
  sku: ['sku', 'itemnumber', 'item number', 'item#', 'neweggitemnumber', 'productid', 'product id', 'id', 'item_number'],
  brand: ['brand', 'manufacturer', 'mfg', 'brandname', 'manufacturer name'],
  price: ['price', 'saleprice', 'sale price', 'currentprice', 'current price', 'finalprice', 'price_current', 'retailprice'],
  url: ['url', 'producturl', 'product url', 'link', 'linkurl', 'buyurl', 'buy url', 'clickurl', 'product_url', 'deeplink'],
  inStock: ['instock', 'in stock', 'availability', 'available', 'stock', 'stockavailability', 'availabilitystatus'],
  seller: ['seller', 'soldby', 'sold by', 'shipper', 'fulfilledby', 'marketplace'],
};
const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9#]/g, '');

function mapHeaders(headers) {
  const normed = headers.map(normHeader);
  const map = {};
  for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
    const idx = normed.findIndex((h) => syns.map(normHeader).includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

// Minimal RFC4180 CSV parser (quoted fields, embedded delimiters/newlines).
function parseDelimited(text) {
  const headerLine = text.slice(0, text.indexOf('\n'));
  const delim = [',', '\t', '|', ';'].map((d) => [d, headerLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  const headers = rows.shift() || [];
  return { headers, rows, format: `delimited("${delim === '\t' ? '\\t' : delim}")` };
}

// Tolerant XML: find the repeating record tag, read child <tag>value</tag> pairs.
function parseXml(text) {
  const recordTag = ['product', 'item', 'offer', 'entry', 'record']
    .find((t) => new RegExp(`<${t}[\\s>]`, 'i').test(text));
  if (!recordTag) throw new Error('XML feed: no <product>/<item>/<offer>/<entry>/<record> elements found');
  const recs = [...text.matchAll(new RegExp(`<${recordTag}[\\s>][\\s\\S]*?<\\/${recordTag}>`, 'gi'))].map((m) => m[0]);
  const headerSet = new Set();
  const objs = recs.map((r) => {
    const o = {};
    for (const m of r.matchAll(/<([A-Za-z_][\w:.-]*)[^>]*>([\s\S]*?)<\/\1>/g)) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
      if (val && !(key in o)) { o[key] = val; headerSet.add(key); }
    }
    return o;
  });
  const headers = [...headerSet];
  const rows = objs.map((o) => headers.map((h) => o[h] ?? ''));
  return { headers, rows, format: `xml(<${recordTag}>)` };
}

// ---- Rakuten merchandiser complete feed (positional, streamed) ----
// 0-based indexes into the 38-column layout, verified against the live Newegg
// feed (col 20 1-based = MPN, col 13 = sale price, col 14 = retail, col 23 =
// availability, col 26 = currency; every row in the complete feed is in-stock).
const RAKUTEN_COLS = { name: 1, sku: 2, url: 5, salePrice: 12, retailPrice: 13, brand: 16, mpn: 19, manufacturer: 20, availability: 22, upc: 23, currency: 25 };

// Feed URLs are pre-built linksynergy click links; we store CLEAN urls and
// wrap at render time (backend/lib/rakutenLink.js). Extract the embedded murl
// and drop its query (the ?item= param just repeats the /p/{sku} path).
function cleanFeedUrl(raw) {
  try {
    let u = new URL(raw);
    if (u.hostname === 'click.linksynergy.com') {
      const murl = u.searchParams.get('murl');
      if (murl) u = new URL(murl);
    }
    return u.origin + u.pathname;
  } catch { return raw; }
}

const parseStock = (v) => /^(y|yes|true|1|in[-\s]?stock|available)$/i.test(v) ? true
  : /^(n|no|false|0|out[-\s]?of[-\s]?stock|unavailable|backorder(ed)?|discontinued)$/i.test(v) ? false : null;

function isRakutenFeed(feedPath) {
  const buf = Buffer.alloc(4);
  const fd = fs.openSync(feedPath, 'r');
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return buf.toString('utf8') === 'HDR|';
}

async function streamRakutenFeed(feedPath, onItem) {
  const rl = require('readline').createInterface({
    input: fs.createReadStream(feedPath), crlfDelay: Infinity,
  });
  const C = RAKUTEN_COLS;
  let total = 0, withMpn = 0;
  for await (const line of rl) {
    if (!line || line.startsWith('HDR|') || line.startsWith('TRL|')) continue;
    const f = line.split('|');
    const name = (f[C.name] || '').trim();
    const url = (f[C.url] || '').trim();
    if (!name || !url) continue;
    total++;
    const mpn = (f[C.mpn] || '').trim();
    if (mpn) withMpn++;
    const sku = (f[C.sku] || '').trim();
    onItem({
      name,
      mpn,
      sku,
      brand: (f[C.brand] || f[C.manufacturer] || '').trim(),
      price: parseFloat(f[C.salePrice]) || parseFloat(f[C.retailPrice]) || null,
      url: cleanFeedUrl(url),
      // 9S... item numbers are marketplace listings; N82E... (and other
      // non-9S) are sold by Newegg - feeds pickBest's first-party preference.
      seller: /^9S/i.test(sku) ? 'marketplace' : 'newegg',
      inStock: parseStock((f[C.availability] || '').trim()),
      // Column 24 carries a zero-padded GTIN on ~99% of rows (verified
      // against the live delta). Kept raw here; normalized at match time.
      upc: (f[C.upc] || '').trim(),
    });
  }
  return { total, withMpn };
}

function loadFeed(feedPath) {
  const text = fs.readFileSync(feedPath, 'utf8').replace(/^﻿/, '');
  const parsed = text.trimStart().startsWith('<') ? parseXml(text) : parseDelimited(text);
  const map = mapHeaders(parsed.headers);
  const missing = ['name', 'price', 'url'].filter((f) => !(f in map));
  if (missing.length) {
    throw new Error(`Feed field mapping failed - missing ${missing.join(', ')}.\nHeaders seen: ${parsed.headers.join(' | ')}\nAdd the real header names to FIELD_SYNONYMS.`);
  }
  const get = (row, f) => (f in map ? String(row[map[f]] ?? '').trim() : '');
  const items = parsed.rows.map((r) => ({
    name: get(r, 'name'),
    mpn: get(r, 'mpn'),
    sku: get(r, 'sku'),
    brand: get(r, 'brand'),
    price: parseFloat(String(get(r, 'price')).replace(/[$,]/g, '')) || null,
    url: get(r, 'url'),
    seller: get(r, 'seller'),
    inStock: /^(y|yes|true|1|in ?stock|available)$/i.test(get(r, 'inStock')) ? true
      : /^(n|no|false|0|out ?of ?stock|unavailable)$/i.test(get(r, 'inStock')) ? false : null,
  })).filter((i) => i.name && i.url);
  log(`Feed parsed: ${parsed.format}, ${items.length} usable rows; mapped fields: ${Object.keys(map).join(', ')}`);
  return items;
}

// ------------------------------------------------------------ matching
const normMpn = (m) => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function pickBest(cands, ourMpnRaw) {
  // deterministic preference: exact raw MPN > sold-by-Newegg > in-stock > lowest price > sku
  const score = (c) => [
    c.mpn && ourMpnRaw && c.mpn === ourMpnRaw ? 0 : 1,
    /newegg/i.test(c.seller || '') ? 0 : 1,
    c.inStock === true ? 0 : 1,
    c.price == null ? Infinity : c.price,
    c.sku || c.url,
  ];
  return [...cands].sort((a, b) => {
    const sa = score(a), sb = score(b);
    for (let i = 0; i < sa.length; i++) { if (sa[i] < sb[i]) return -1; if (sa[i] > sb[i]) return 1; }
    return 0;
  })[0];
}

async function run() {
  if (!FEED_PATH) throw new Error('Usage: node scripts/match-newegg.js <feed-file> [--confirm]');
  if (!fs.existsSync(FEED_PATH)) throw new Error('Feed file not found: ' + FEED_PATH);
  log(`Newegg matching started${CONFIRM ? '' : ' (DRY RUN - review report only)'}`);

  // upc is probe-guarded (same convention as the retailer_offers probe): if
  // the column doesn't exist yet the matcher runs without tier 1.5 rather
  // than failing.
  let { data: products, error } = await supabase
    .from('products').select('id, sku, name, brand, category, upc').eq('retailer', 'amazon').order('id');
  if (error && /upc/.test(error.message)) {
    log('products.upc column missing - tier 1.5 disabled this run');
    ({ data: products, error } = await supabase
      .from('products').select('id, sku, name, brand, category').eq('retailer', 'amazon').order('id'));
  }
  if (error) throw new Error(error.message);
  log(`Products loaded: ${products.length} (${products.filter((p) => p.upc).length} with stored UPCs)`);

  const byMpn = new Map();
  const byUpc = new Map(); // normalized barcode -> feed rows (tier 1.5)
  let tier2Pool;
  if (isRakutenFeed(FEED_PATH)) {
    // Stream the ~1M-row feed keeping only rows we can use: our-MPN hits for
    // tier 1, our-barcode hits for tier 1.5, and brand+capacity prefiltered
    // rows for tier 2 (the same first two conditions the tier-2 filter
    // applies, so no candidate is lost).
    const ourMpnSet = new Set(products.map((p) => normMpn(parseMpn(p.name))).filter(Boolean));
    const ourUpcSet = new Set(products.flatMap((p) => (p.upc || '').split(',').filter(Boolean)));
    const ourCapSet = new Set(products.map((p) => totalCapacityGB(p.name)).filter((v) => v != null));
    const brandWords = [...new Set(products.map((p) => (p.brand || '').toLowerCase().split(' ')[0]).filter(Boolean))];
    const everyProductHasBrand = products.every((p) => p.brand);
    tier2Pool = [];
    const stats = await streamRakutenFeed(FEED_PATH, (item) => {
      const k = normMpn(item.mpn);
      if (k && ourMpnSet.has(k)) (byMpn.get(k) || byMpn.set(k, []).get(k)).push(item);
      // Tier 1.5 candidates: the dedicated GTIN column, plus the MPN column
      // when Newegg polluted it with a barcode (the FURY Beast case).
      if (ourUpcSet.size) {
        const codes = [normBarcode(item.upc)];
        if (looksLikeBarcode(item.mpn)) codes.push(normBarcode(item.mpn));
        for (const c of codes) {
          if (c && ourUpcSet.has(c)) { (byUpc.get(c) || byUpc.set(c, []).get(c)).push(item); break; }
        }
      }
      const hay = (item.brand + ' ' + item.name).toLowerCase();
      if (!everyProductHasBrand || brandWords.some((w) => hay.includes(w))) {
        if (ourCapSet.has(totalCapacityGB(item.name))) tier2Pool.push(item);
      }
    });
    log(`Rakuten feed streamed: ${stats.total} rows (${stats.withMpn} with MPN); rows matching our MPNs: ${[...byMpn.values()].reduce((n, a) => n + a.length, 0)} across ${byMpn.size} MPNs; barcode hits: ${[...byUpc.values()].reduce((n, a) => n + a.length, 0)} across ${byUpc.size} barcodes; tier-2 candidate pool: ${tier2Pool.length}`);
  } else {
    const feed = loadFeed(FEED_PATH);
    for (const f of feed) {
      const k = normMpn(f.mpn);
      if (!k) continue;
      (byMpn.get(k) || byMpn.set(k, []).get(k)).push(f);
    }
    tier2Pool = feed;
    log(`Feed rows with an MPN: ${feed.filter((f) => f.mpn).length} (${byMpn.size} distinct)`);
  }

  const matches = [];
  const unmatched = [];
  for (const p of products) {
    const ourMpn = parseMpn(p.name);
    const ourCap = totalCapacityGB(p.name);
    // TIER 1: MPN
    if (ourMpn && byMpn.has(normMpn(ourMpn))) {
      const cands = byMpn.get(normMpn(ourMpn));
      const best = pickBest(cands, ourMpn);
      matches.push({
        sku: p.sku, product_id: p.id, method: 'mpn', accepted: true,
        ourName: p.name, ourMpn,
        neweggSku: best.sku || null, neweggName: best.name, price: best.price,
        inStock: best.inStock, url: best.url,
        competing: cands.length > 1 ? cands.filter((c) => c !== best).map((c) => `${c.sku || '?'} $${c.price} ${c.seller || ''}`.trim()) : [],
      });
      continue;
    }
    // TIER 1.5: UPC/EAN/GTIN join (proposal only, NEVER auto-accepted).
    // Rescues products whose MPN the feed lacks or polluted with a barcode.
    // Bundles/multipacks can share a barcode, so every pair goes through the
    // same human gate as tier 2.
    if (p.upc) {
      const cands = [];
      const seen = new Set();
      let matchedBarcode = null;
      for (const code of p.upc.split(',').filter(Boolean)) {
        for (const f of byUpc.get(code) || []) {
          if (!seen.has(f)) { seen.add(f); cands.push(f); }
        }
        if (!matchedBarcode && byUpc.has(code)) matchedBarcode = code;
      }
      if (cands.length) {
        const best = pickBest(cands, ourMpn);
        matches.push({
          sku: p.sku, product_id: p.id, method: 'upc', accepted: false, // NEVER auto-accepted
          ourName: p.name, ourMpn: ourMpn || null, barcode: matchedBarcode,
          neweggSku: best.sku || null, neweggName: best.name, price: best.price,
          inStock: best.inStock, url: best.url,
          competing: cands.length > 1 ? cands.filter((c) => c !== best).map((c) => `${c.sku || '?'} $${c.price} ${(c.name || '').slice(0, 60)}`) : [],
        });
        continue;
      }
    }
    // TIER 2: brand + capacity + line-signature containment (proposal only)
    if (ourCap == null) { unmatched.push({ sku: p.sku, reason: 'no capacity axis' }); continue; }
    const sig = lineSignature(p);
    if (!sig.length) { unmatched.push({ sku: p.sku, reason: 'empty line signature' }); continue; }
    const ourBrand = (p.brand || '').toLowerCase();
    // Kit configuration (2x8 vs 1x16) is a tier-2 MATCHING invariant only -
    // it is deliberately NOT added to build-families' invariants(), which
    // would reshuffle shipped family ids. Unknown-vs-known mismatches
    // (conservative, same as the CL 'nocl' rule).
    const ourInv = invariants(p).join('|') + '|' + (parseKitConfig(p.name) || 'nokit');
    const cands = tier2Pool.filter((f) => {
      if (ourBrand && !(f.brand || f.name).toLowerCase().includes(ourBrand.split(' ')[0])) return false;
      if (totalCapacityGB(f.name) !== ourCap) return false;
      // hard invariants must match too (RAM speed/CL/gen/form + kit config;
      // SSD proto/form/gen/heatsink) - brand+capacity+signature alone would
      // propose a 6000 CL30 kit against a 5200 CL40 feed row, or a 1x16
      // module against a 2x8 kit. Unknown-vs-unknown still only pairs with
      // unknown (build-families semantics).
      const fInv = invariants({ name: f.name, category: p.category }).join('|') + '|' + (parseKitConfig(f.name) || 'nokit');
      if (fInv !== ourInv) return false;
      const feedToks = new Set(tokenize(f.name).map((t) => t.toLowerCase()));
      return sig.every((t) => feedToks.has(t));
    });
    if (!cands.length) { unmatched.push({ sku: p.sku, reason: ourMpn ? 'mpn not in feed; no name candidate' : 'no mpn; no name candidate' }); continue; }
    const best = pickBest(cands, ourMpn);
    matches.push({
      sku: p.sku, product_id: p.id, method: 'name', accepted: false, // NEVER auto-accepted
      ourName: p.name, ourMpn: ourMpn || null,
      neweggSku: best.sku || null, neweggName: best.name, price: best.price,
      inStock: best.inStock, url: best.url,
      competing: cands.length > 1 ? cands.filter((c) => c !== best).map((c) => `${c.sku || '?'} $${c.price} ${(c.name || '').slice(0, 60)}`) : [],
    });
  }

  // Carry over explicit accepts from the prior review file - the documented
  // tier-2 flow is: review, set "accepted": true in newegg-matches.json,
  // re-run with --confirm. Keyed on our sku AND the Newegg sku so an accept
  // never transfers to a different feed row than the one reviewed.
  if (fs.existsSync(JSON_OUT)) {
    try {
      const prior = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
      const ok = new Set(prior.filter((m) => m.method !== 'mpn' && m.accepted === true).map((m) => `${m.sku}::${m.neweggSku}`));
      let carried = 0;
      for (const m of matches) {
        if (m.method !== 'mpn' && ok.has(`${m.sku}::${m.neweggSku}`)) { m.accepted = true; carried++; }
      }
      if (carried) log(`Carried over ${carried} accepted tier-2 rulings from prior newegg-matches.json`);
    } catch { /* unreadable prior file: proposals stay unaccepted */ }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(matches, null, 1));

  // ---------------- review report ----------------
  const lines = [];
  const P = (l) => { lines.push(l); };
  P('════════════════ NEWEGG MATCH REVIEW (Gate 1) ════════════════');
  const HEADERS = {
    mpn: (n) => `TIER 1 - MPN matches (auto-accept on --confirm): ${n}`,
    upc: (n) => `TIER 1.5 - UPC/barcode proposals (accept by setting "accepted": true in newegg-matches.json): ${n}`,
    name: (n) => `TIER 2 - name proposals (accept by setting "accepted": true in newegg-matches.json): ${n}`,
  };
  for (const method of ['mpn', 'upc', 'name']) {
    const group = matches.filter((m) => m.method === method);
    if (method === 'upc' && !group.length) continue;
    P(`\n── ${HEADERS[method](group.length)}`);
    for (const m of group) {
      P(`  OUR:    [${m.sku}] ${m.ourName.slice(0, 95)}`);
      P(`  NEWEGG: [${m.neweggSku || '?'}] ${m.neweggName.slice(0, 95)}`);
      P(`          ($${m.price ?? '?'}, ${m.inStock === false ? 'OOS' : m.inStock ? 'in stock' : 'stock?'}, method=${m.method}${m.ourMpn ? ', mpn=' + m.ourMpn : ''}${m.barcode ? ', barcode=' + m.barcode : ''})`);
      if (m.competing.length) P(`          competing: ${m.competing.join(' | ')}`);
      P('');
    }
  }
  P(`── unmatched products: ${unmatched.length}`);
  const byReason = {};
  unmatched.forEach((u) => { byReason[u.reason] = (byReason[u.reason] || 0) + 1; });
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => P(`   ${String(n).padStart(3)}  ${r}`));
  const report = lines.join('\n');
  fs.writeFileSync(REVIEW_OUT, report + '\n');
  console.log(report);
  log(`Wrote ${JSON_OUT} and ${REVIEW_OUT}`);

  // ---------------- confirm ----------------
  if (CONFIRM) {
    const toWrite = matches.filter((m) => m.accepted === true);
    let writes = 0, failures = 0;
    for (const m of toWrite) {
      const { error: upErr } = await supabase.from('retailer_offers').upsert({
        product_id: m.product_id,
        retailer: 'newegg',
        retailer_sku: m.neweggSku || 'unknown',
        match_method: m.method,
        product_url: m.url,           // CLEAN url; wrapping happens at render
        price: m.price,
        in_stock: m.inStock,
        fetched_at: new Date().toISOString(),
      }, { onConflict: 'product_id,retailer' });
      if (upErr) { console.error(`  write failed [${m.sku}]: ${upErr.message}`); failures++; continue; }
      writes++;
    }
    log(`retailer_offers written: ${writes} (accepted only), failures: ${failures}, skipped (unaccepted proposals): ${matches.length - toWrite.length}`);
  } else {
    log('Dry run complete - nothing written. After review: --confirm writes tier-1 + explicitly accepted tier-2 rows.');
  }
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
