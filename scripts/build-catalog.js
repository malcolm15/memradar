// Product-catalog harvester — Step 1 of the data-pipeline pivot (see CLAUDE.md
// "Data Source Evaluation Findings"). Runs a batch of Amazon keyword searches
// via PriceAPI, dedupes by ASIN, derives a product catalog, applies sanity
// filters, and writes a REVIEW PREVIEW to scripts/output/catalog-preview.json.
//
// READ-ONLY: does NOT write to Supabase. A later, separately-approved step will
// upsert the reviewed catalog into the products table.
//
// Usage: node scripts/build-catalog.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.priceapi.com/v2';
const API_KEY = process.env.PRICE_API_KEY;

const COUNTRY = 'us';
const SOURCE = 'amazon';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 12;
const BETWEEN_JOBS_MS = 2000;
const MIN_PRICE = 15;

const OUTPUT_PATH = path.join(__dirname, 'output', 'catalog-preview.json');

// Ordered so RAM queries run first — first occurrence of an ASIN wins its
// category (per spec: prefer the group it appeared in first).
const QUERIES = [
  { term: 'DDR5 32GB RAM kit', category: 'ram' },
  { term: 'DDR5 64GB RAM kit', category: 'ram' },
  { term: 'DDR5 16GB RAM', category: 'ram' },
  { term: 'DDR5 6000MHz RAM', category: 'ram' },
  { term: 'DDR4 32GB RAM kit', category: 'ram' },
  { term: 'DDR4 16GB RAM', category: 'ram' },
  { term: 'Corsair Vengeance DDR5', category: 'ram' },
  { term: 'G.Skill Trident Z5', category: 'ram' },
  { term: 'Crucial DDR5 RAM', category: 'ram' },
  { term: 'Kingston Fury DDR5', category: 'ram' },
  { term: '1TB NVMe SSD', category: 'ssd' },
  { term: '2TB NVMe SSD', category: 'ssd' },
  { term: '4TB NVMe SSD', category: 'ssd' },
  { term: 'Samsung 990 Pro SSD', category: 'ssd' },
  { term: 'WD Black SN850X', category: 'ssd' },
  { term: 'Crucial T500 SSD', category: 'ssd' },
  { term: '2TB SATA SSD', category: 'ssd' },
  { term: 'Samsung 870 EVO', category: 'ssd' },
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pick(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

async function createJob(term) {
  const body = new URLSearchParams({
    token: API_KEY,
    source: SOURCE,
    country: COUNTRY,
    topic: 'search_results',
    key: 'term',
    values: term,
    max_pages: '1',
  });
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create job failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  const job = JSON.parse(text);
  const jobId = pick(job, ['job_id', 'id']);
  if (!jobId) throw new Error(`no job_id in create response: ${JSON.stringify(job).slice(0, 300)}`);
  return jobId;
}

async function pollJob(jobId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE}/jobs/${jobId}?token=${encodeURIComponent(API_KEY)}`);
    const text = await res.text();
    if (!res.ok) throw new Error(`poll failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    const job = JSON.parse(text);
    const status = pick(job, ['status', 'state']) || 'unknown';
    if (status === 'finished') return job;
    if (['cancelled', 'canceled', 'error', 'failed'].includes(status)) {
      throw new Error(`job ended in terminal state "${status}"`);
    }
    if (attempt < MAX_POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`job did not finish after ${MAX_POLL_ATTEMPTS} polls`);
}

async function downloadResults(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}/download?token=${encodeURIComponent(API_KEY)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Returns { free, paid } as numbers from whichever object carries the fields.
function extractCredits(...objs) {
  let free = 0;
  let paid = 0;
  for (const obj of objs) {
    if (!obj || typeof obj !== 'object') continue;
    if (obj.free_credits !== undefined && !isNaN(Number(obj.free_credits))) free = Number(obj.free_credits);
    if (obj.paid_credits !== undefined && !isNaN(Number(obj.paid_credits))) paid = Number(obj.paid_credits);
  }
  return { free, paid };
}

function extractProducts(download) {
  const results = Array.isArray(download.results) ? download.results : [];
  const products = [];
  for (const r of results) {
    const c = r?.content || {};
    const list = c.search_results || c.products || (Array.isArray(c) ? c : []);
    if (Array.isArray(list)) products.push(...list);
  }
  return products;
}

// Run one search job end-to-end. Returns { products, credits } or throws.
async function runQueryJob(query) {
  log(`Job: "${query.term}" (${query.category}) — creating...`);
  const jobId = await createJob(query.term);
  const finishedJob = await pollJob(jobId);
  const download = await downloadResults(jobId);
  const credits = extractCredits(finishedJob, download);
  const products = extractProducts(download);
  log(`  finished job_id=${jobId}: ${products.length} raw products, credits free=${credits.free} paid=${credits.paid}`);
  return { products, credits };
}

// Canonical known-brands resolver. brand_name is null on search_results, so we
// match maker names / product lines / model prefixes anywhere in the product
// name (case-insensitive) and normalize to a canonical form. Ordered: specific
// product-line & model rules first, then plain canonical maker names. Anything
// unmatched returns null (we prefer null over a garbage guess).
const BRAND_RULES = [
  // Western Digital + variants
  [/western\s+digital/i, 'Western Digital'],
  [/\bwd[\s_]?black\b/i, 'Western Digital'],
  [/\bwd[\s_]/i, 'Western Digital'],
  [/\bwd_?black\b/i, 'Western Digital'],
  // Kingston (FURY / Fury Beast)
  [/\bfury\b/i, 'Kingston'],
  // G.Skill (Trident / Ripjaws)
  [/\btrident\b/i, 'G.Skill'],
  [/\bripjaws\b/i, 'G.Skill'],
  // Corsair (Vengeance / Dominator)
  [/\bvengeance\b/i, 'Corsair'],
  [/\bdominator\b/i, 'Corsair'],
  // Samsung (product lines + MZ- model prefix)
  [/990\s*pro/i, 'Samsung'],
  [/980\s*pro/i, 'Samsung'],
  [/870\s*evo/i, 'Samsung'],
  [/960\s*evo/i, 'Samsung'],
  [/870\s*qvo/i, 'Samsung'],
  [/9100\s*pro/i, 'Samsung'],
  [/\bt7\b/i, 'Samsung'],
  [/^\s*mz-/i, 'Samsung'],
  // Crucial (model families). \bct\d catches CT#### model codes anywhere in the
  // title (e.g. CT2K48G56C46S5) — recovers Crucial kits whose name drops "Crucial".
  [/\bt500\b/i, 'Crucial'],
  [/\bt705\b/i, 'Crucial'],
  [/\bp310\b/i, 'Crucial'],
  [/\bp510\b/i, 'Crucial'],
  [/\bp3\b/i, 'Crucial'],
  [/\bbx500\b/i, 'Crucial'],
  [/\bmx500\b/i, 'Crucial'],
  [/\bct\d/i, 'Crucial'],
  // SanDisk (product lines whose title omits the maker name)
  [/ssd\s*plus/i, 'SanDisk'],
  [/sandisk\s*ultra/i, 'SanDisk'],
  // Plain canonical maker names (matched anywhere)
  [/corsair/i, 'Corsair'],
  [/g\.?\s?skill/i, 'G.Skill'],
  [/crucial/i, 'Crucial'],
  [/kingston/i, 'Kingston'],
  [/samsung/i, 'Samsung'],
  [/teamgroup/i, 'TEAMGROUP'],
  [/sandisk/i, 'SanDisk'],
  [/lexar/i, 'Lexar'],
  [/patriot/i, 'Patriot'],
  [/adata/i, 'ADATA'],
  [/\bpny\b/i, 'PNY'],
  [/silicon\s+power/i, 'Silicon Power'],
  [/seagate/i, 'Seagate'],
  [/mushkin/i, 'Mushkin'],
  [/timetec/i, 'Timetec'],
  [/netac/i, 'Netac'],
  [/kingspec/i, 'KingSpec'],
  [/sabrent/i, 'Sabrent'],
  [/solidigm/i, 'Solidigm'],
];

function resolveBrand(name) {
  const n = String(name || '');
  for (const [re, brand] of BRAND_RULES) {
    if (re.test(n)) return brand;
  }
  return null;
}

// External/portable drives are the wrong category for us (we track internal).
function isExternalDrive(name) {
  return /\b(portable|external|usb)\b/i.test(String(name || ''));
}

function priceOf(raw) {
  const p = pick(raw, ['min_price', 'price', 'max_price']);
  const n = parseFloat(p);
  return isNaN(n) ? null : n;
}

// Category-aware name sanity check: RAM must look like memory, SSD like storage.
function passesNameFilter(name, category) {
  const n = String(name || '').toLowerCase();
  if (category === 'ram') return n.includes('ddr');
  if (category === 'ssd') return n.includes('ssd') || n.includes('nvme');
  return false;
}

async function run() {
  log(`Catalog build started: ${QUERIES.length} Amazon search jobs (${SOURCE}/search_results, country=${COUNTRY})`);

  if (!API_KEY || API_KEY === 'placeholder_value') {
    throw new Error('PRICE_API_KEY is missing or still "placeholder_value" — set the real key in .env first');
  }

  const collected = []; // { raw, category } in job order
  let totalFree = 0;
  let totalPaid = 0;
  let jobsOk = 0;
  const jobsFailed = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    try {
      const { products, credits } = await runQueryJob(query);
      totalFree += credits.free;
      totalPaid += credits.paid;
      jobsOk++;
      for (const raw of products) collected.push({ raw, category: query.category });
    } catch (err) {
      logError(`query "${query.term}"`, err);
      jobsFailed.push(query.term);
    }
    if (i < QUERIES.length - 1) await sleep(BETWEEN_JOBS_MS);
  }

  log(`All jobs done: ${jobsOk} ok, ${jobsFailed.length} failed. Credits total: free=${totalFree}, paid=${totalPaid}`);
  if (jobsFailed.length) log(`Failed queries: ${jobsFailed.join(' | ')}`);

  // Dedupe by ASIN — first occurrence wins (and sets category).
  const byAsin = new Map();
  let rawCount = 0;
  for (const { raw, category } of collected) {
    rawCount++;
    const asin = pick(raw, ['id', 'asin']);
    if (!asin || byAsin.has(asin)) continue;
    byAsin.set(asin, { raw, category });
  }
  log(`Collected ${rawCount} rows across jobs → ${byAsin.size} unique ASINs`);

  // Derive catalog + apply sanity filters.
  const catalog = [];
  const dropped = { noPrice: 0, cheap: 0, nameFilter: 0, external: 0 };
  let brandMatched = 0;
  let brandNull = 0;
  for (const [asin, { raw, category }] of byAsin) {
    const name = pick(raw, ['name', 'title']) || '';
    const price = priceOf(raw);

    if (price === null) { dropped.noPrice++; continue; }
    if (price < MIN_PRICE) { dropped.cheap++; continue; }
    if (isExternalDrive(name)) { dropped.external++; continue; }
    if (!passesNameFilter(name, category)) { dropped.nameFilter++; continue; }

    const brand = resolveBrand(name);
    if (brand) brandMatched++; else brandNull++;

    catalog.push({
      sku: asin,
      name,
      category,
      brand, // canonical known-brand or null (never a garbage guess)
      image_url: pick(raw, ['image_url', 'image']) || null,
      product_url: `https://www.amazon.com/dp/${asin}/`, // clean, no affiliate tag
      retailer: 'amazon',
      _price_seen: price, // for reviewer context only; not a DB column
    });
  }
  log(`Brand resolution: ${brandMatched} matched a known brand, ${brandNull} set to null`);

  // Write preview file.
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    country: COUNTRY,
    jobs: { total: QUERIES.length, ok: jobsOk, failed: jobsFailed },
    credits: { free: totalFree, paid: totalPaid, total: totalFree + totalPaid },
    counts: {
      unique_asins: byAsin.size,
      after_filters: catalog.length,
      dropped,
      brand: { matched: brandMatched, null: brandNull },
    },
    products: catalog,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  log(`Preview written: ${OUTPUT_PATH}`);

  printSummary(payload);
}

function printSummary(payload) {
  const { products } = payload;
  const byCategory = {};
  const byBrand = {};
  for (const p of products) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    const b = p.brand || '(null)';
    byBrand[b] = (byBrand[b] || 0) + 1;
  }

  console.log('\n==================== CATALOG PREVIEW SUMMARY ====================');
  console.log(`Jobs: ${payload.jobs.ok}/${payload.jobs.total} ok` + (payload.jobs.failed.length ? `, failed: ${payload.jobs.failed.join(', ')}` : ''));
  console.log(`Credits consumed: free=${payload.credits.free}, paid=${payload.credits.paid}, total=${payload.credits.total}`);
  console.log(`Unique ASINs: ${payload.counts.unique_asins}  →  after filters: ${payload.counts.after_filters}`);
  console.log(`Dropped: no-price=${payload.counts.dropped.noPrice}, under-$${MIN_PRICE}=${payload.counts.dropped.cheap}, external=${payload.counts.dropped.external}, name-filter=${payload.counts.dropped.nameFilter}`);
  console.log(`Brand: ${payload.counts.brand.matched} matched, ${payload.counts.brand.null} null`);

  console.log('\n-- Count per category --');
  Object.entries(byCategory).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(6)} ${v}`));

  console.log('\n-- Count per brand --');
  Object.entries(byBrand).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(k).padEnd(16)} ${v}`));

  console.log('\n-- Full product list (name — price) --');
  ['ram', 'ssd'].forEach((cat) => {
    const rows = products.filter((p) => p.category === cat);
    if (!rows.length) return;
    console.log(`\n  [${cat.toUpperCase()}] ${rows.length} products`);
    rows.forEach((p, i) => {
      console.log(`   ${String(i + 1).padStart(2)}. $${String(p._price_seen).padStart(8)}  ${(p.brand || '(null)').padEnd(14)}  ${p.name.slice(0, 90)}`);
    });
  });
  console.log('\n================================================================');
  console.log('Review scripts/output/catalog-preview.json. Nothing has been written to Supabase.');
}

// Offline re-derivation: re-run brand resolution + external filter against the
// existing preview's product names, no API calls / no credits. Use after
// changing brand rules or filters so we don't waste trial credits re-fetching
// (and don't drift as Amazon's live listings change).
function reprocessFromPreview() {
  log('Reprocess mode: re-deriving brand + external filter from existing preview (no API calls)');
  const prev = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const inputProducts = Array.isArray(prev.products) ? prev.products : [];

  const catalog = [];
  let externalDropped = 0;
  let brandMatched = 0;
  let brandNull = 0;
  for (const p of inputProducts) {
    const name = p.name || '';
    if (isExternalDrive(name)) { externalDropped++; continue; }
    const brand = resolveBrand(name);
    if (brand) brandMatched++; else brandNull++;
    catalog.push({ ...p, brand });
  }
  log(`Brand resolution: ${brandMatched} matched a known brand, ${brandNull} set to null`);

  const payload = {
    ...prev,
    reprocessed_at: new Date().toISOString(),
    counts: {
      ...prev.counts,
      after_filters: catalog.length,
      dropped: { ...(prev.counts && prev.counts.dropped), external: externalDropped },
      brand: { matched: brandMatched, null: brandNull },
    },
    products: catalog,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  log(`Preview regenerated: ${OUTPUT_PATH}`);
  printSummary(payload);
}

const REPROCESS = process.argv.includes('--reprocess');
(REPROCESS ? Promise.resolve().then(reprocessFromPreview) : run()).catch((err) => {
  logError(REPROCESS ? 'Catalog reprocess failed' : 'Catalog build failed', err);
  process.exit(1);
});
