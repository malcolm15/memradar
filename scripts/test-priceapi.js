// Standalone READ-ONLY evaluation script for PriceAPI.com.
// Runs one keyword-search job against a given source, polls until finished, and
// prints a summary of the results so we can see what PriceAPI data looks like
// before deciding whether to integrate it. Does NOT touch Supabase or any prod
// code.
//
// Usage: node scripts/test-priceapi.js [source]
//   source defaults to "walmart". Also verified working: "amazon".
//   Note: google_shopping does NOT support keyword (term) search on our trial
//   account — it only allows product/offers topics keyed by id/gtin.
require('dotenv').config();

// Current PriceAPI base. If requests 404/401 unexpectedly, the legacy host
// `https://priceapi.metoda.com/v2` also appears in their docs — swap here.
const BASE = 'https://api.priceapi.com/v2';

const API_KEY = process.env.PRICE_API_KEY;

const SOURCE = process.argv[2] || 'walmart';
const SEARCH_TERM = 'DDR5 32GB RAM';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 12;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Try a list of likely field names and return the first defined value.
function pick(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

async function createJob() {
  const body = new URLSearchParams({
    token: API_KEY,
    source: SOURCE,
    country: 'us',
    topic: 'search_results',
    key: 'term',
    values: SEARCH_TERM,
    max_pages: '1', // keep the trial job cheap
  });

  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`create job failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }

  let job;
  try {
    job = JSON.parse(text);
  } catch (e) {
    throw new Error(`create job returned non-JSON: ${text.slice(0, 500)}`);
  }

  const jobId = pick(job, ['job_id', 'id']);
  if (!jobId) throw new Error(`no job_id in create response: ${JSON.stringify(job).slice(0, 500)}`);
  return { jobId, job };
}

async function pollJob(jobId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE}/jobs/${jobId}?token=${encodeURIComponent(API_KEY)}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`poll failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
    }

    let job;
    try {
      job = JSON.parse(text);
    } catch (e) {
      throw new Error(`poll returned non-JSON: ${text.slice(0, 300)}`);
    }

    const status = pick(job, ['status', 'state']) || 'unknown';
    log(`Poll ${attempt}/${MAX_POLL_ATTEMPTS}: status="${status}"`);

    if (status === 'finished') return job;
    if (['cancelled', 'canceled', 'error', 'failed'].includes(status)) {
      throw new Error(`job ended in terminal state "${status}": ${JSON.stringify(job).slice(0, 300)}`);
    }

    if (attempt < MAX_POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`job did not finish after ${MAX_POLL_ATTEMPTS} polls (~${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s)`);
}

async function downloadResults(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}/download?token=${encodeURIComponent(API_KEY)}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`download returned non-JSON: ${text.slice(0, 300)}`);
  }
}

function reportCredits(...objs) {
  const creditFields = {};
  for (const obj of objs) {
    if (!obj || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      if (/credit|cost/i.test(k) && (typeof v === 'number' || typeof v === 'string')) {
        creditFields[k] = v;
      }
    }
  }
  const keys = Object.keys(creditFields);
  if (keys.length === 0) {
    log('Credits: no credit/cost fields found in API response');
  } else {
    log(`Credits consumed by this job: ${keys.map((k) => `${k}=${creditFields[k]}`).join(', ')}`);
  }
}

function summarizeProducts(download) {
  // product_and_offers by term: results[] holds one entry per query term; the
  // matching products live under content (search_results/products), and each
  // product carries a nested offers[] array where price + shop live.
  const results = Array.isArray(download.results) ? download.results : [];
  const products = [];
  for (const r of results) {
    const c = r?.content || {};
    const list = c.search_results || c.products || (Array.isArray(c) ? c : []);
    if (Array.isArray(list)) products.push(...list);
  }

  log(`Products returned: ${products.length}`);
  if (products.length === 0) {
    log('No products to summarize. Raw first result object for inspection:');
    console.log(JSON.stringify(results[0] || download, null, 2).slice(0, 3000));
    return;
  }

  console.log('\n--- First 5 products ---');
  products.slice(0, 5).forEach((p, i) => {
    // Price/shop may be on the product directly or on its first offer.
    const offer = Array.isArray(p.offers) && p.offers.length ? p.offers[0] : {};
    const name = pick(p, ['name', 'title', 'product_name']) ?? '(no name)';
    const price = pick(p, ['price', 'min_price', 'sale_price', 'current_price']) ?? pick(offer, ['price', 'min_price', 'sale_price', 'price_with_shipping']) ?? '(no price)';
    const currency = pick(p, ['currency', 'currency_code']) ?? pick(offer, ['currency', 'currency_code']);
    const shop = pick(p, ['shop_name', 'shop', 'seller', 'merchant', 'merchant_name', 'store']) ?? pick(offer, ['shop_name', 'shop', 'seller', 'merchant', 'merchant_name', 'store']) ?? '(no shop)';
    const url = pick(p, ['url', 'link', 'product_url']) ?? pick(offer, ['url', 'link', 'shop_url']) ?? '(no url)';
    const offerCount = Array.isArray(p.offers) ? p.offers.length : 0;
    console.log(`\n${i + 1}. ${name}`);
    console.log(`   price:  ${price}${currency ? ` ${currency}` : ''}`);
    console.log(`   shop:   ${shop}`);
    console.log(`   url:    ${url}`);
    console.log(`   offers: ${offerCount}`);
  });

  // The docs are thin on exact google-shopping field names, so dump the raw
  // first product to reveal the true schema for whichever fields we mis-guessed.
  console.log('\n--- Raw first product (for schema inspection) ---');
  console.log(JSON.stringify(products[0], null, 2).slice(0, 2000));
}

async function run() {
  log(`PriceAPI evaluation job started (source=${SOURCE})`);

  if (!API_KEY || API_KEY === 'placeholder_value') {
    throw new Error('PRICE_API_KEY is missing or still "placeholder_value" — set the real key in .env first');
  }

  log(`Creating ${SOURCE} search_results job (term="${SEARCH_TERM}", country=us, max_pages=1)...`);
  const { jobId } = await createJob();
  log(`Job created: job_id=${jobId}`);

  log('Polling until finished (every 5s, max 12 attempts)...');
  const finishedJob = await pollJob(jobId);
  log('Job finished. Downloading results...');

  const download = await downloadResults(jobId);
  reportCredits(finishedJob, download);
  summarizeProducts(download);

  log('Evaluation job complete.');
}

run().catch((err) => {
  logError('PriceAPI evaluation failed', err);
  process.exit(1);
});
