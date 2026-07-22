// Keepa API client — Amazon price history data source (launch data provider).
//
// Format rules this client absorbs so callers never see them (verified against
// Keepa's official api_backend Java library):
// - Timestamps are "Keepa minutes": minutes since 2011-01-01 UTC. Conversion:
//   unixMillis = (keepaMinute + 21564000) * 60000, and the inverse.
// - product.csv[i] is an alternating [keepaTime, value, keepaTime, value, ...]
//   array. Indices: 0 = AMAZON, 1 = NEW (marketplace new), 18 = BUY_BOX_SHIPPING
//   (note: includes shipping cost, so it's a last resort, not an equal peer).
// - Prices are integer cents on domain 1 (41999 => $419.99).
// - The value -1 means "no offer / out of stock" and is never a price.
// - The stats object (stats=N) uses the same cents + -1 conventions.
// - Every response carries tokensLeft / refillIn / refillRate; each requested
//   ASIN costs 1 token (20 tokens/min plan).
const API_KEY = process.env.KEEPA_API_KEY;
const BASE = 'https://api.keepa.com';
const DOMAIN_US = 1;
const KEEPA_START_MINUTE = 21564000;
const MAX_BATCH = 100;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_REFILL_RATE = 20; // tokens/min — our plan

const CSV = { AMAZON: 0, NEW: 1, BUY_BOX_SHIPPING: 18 };

// Outlier filter: Amazon history contains third-party garbage ($9,999 listings
// during stockouts). Drop points > OUTLIER_MULTIPLE x series median or < MIN_PRICE.
const OUTLIER_MULTIPLE = 5;
const MIN_PRICE = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function keepaMinutesToDate(keepaMinutes) {
  return new Date((keepaMinutes + KEEPA_START_MINUTE) * 60000);
}

function dateToKeepaMinutes(date) {
  return Math.floor(date.getTime() / 60000) - KEEPA_START_MINUTE;
}

function centsToDollars(cents) {
  return Math.round(cents) / 100;
}

// Token bucket state, updated from every API response.
const tokenState = {
  tokensLeft: null, // unknown until first response
  refillIn: 0, // ms until next refill tick
  refillRate: DEFAULT_REFILL_RATE,
};

function getTokenState() {
  return { ...tokenState };
}

async function waitForTokens(needed, log = () => {}) {
  if (tokenState.tokensLeft === null || tokenState.tokensLeft >= needed) return;
  const deficit = needed - tokenState.tokensLeft;
  const waitMs = tokenState.refillIn + Math.ceil(deficit / tokenState.refillRate) * 60000;
  log(`Waiting ${Math.ceil(waitMs / 1000)}s for token refill (have ${tokenState.tokensLeft}, need ${needed}, ${tokenState.refillRate}/min)`);
  await sleep(waitMs);
}

async function fetchBatch(asins, { history = 1, stats = 90 } = {}, log = () => {}) {
  if (!API_KEY) throw new Error('KEEPA_API_KEY is not set');
  if (asins.length > MAX_BATCH) throw new Error(`batch too large: ${asins.length} > ${MAX_BATCH}`);

  const url = `${BASE}/product?key=${API_KEY}&domain=${DOMAIN_US}` +
    `&asin=${encodeURIComponent(asins.join(','))}&stats=${stats}&history=${history ? 1 : 0}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error(`Keepa API timed out after ${FETCH_TIMEOUT_MS}ms`);
      throw err;
    }
    clearTimeout(timer);

    const data = await res.json();

    if (typeof data.tokensLeft === 'number') tokenState.tokensLeft = data.tokensLeft;
    if (typeof data.refillIn === 'number') tokenState.refillIn = data.refillIn;
    if (typeof data.refillRate === 'number' && data.refillRate > 0) tokenState.refillRate = data.refillRate;

    if (data.error) {
      const type = data.error.type || data.error.message || JSON.stringify(data.error);
      if (/token/i.test(type) && attempt < 3) {
        const waitMs = (tokenState.refillIn || 60000) + Math.ceil(asins.length / tokenState.refillRate) * 60000;
        log(`Keepa token shortage (${type}) — waiting ${Math.ceil(waitMs / 1000)}s then retrying (attempt ${attempt}/3)`);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Keepa API error: ${type}`);
    }
    if (!res.ok) throw new Error(`Keepa API ${res.status} ${res.statusText}`);
    if (!Array.isArray(data.products)) throw new Error('Keepa response missing products array');

    return data.products;
  }
  throw new Error('Keepa API: token shortage persisted after retries');
}

// Fetch any number of ASINs, batching at MAX_BATCH and waiting for token
// refills between batches as needed. Returns all product objects.
async function fetchProducts(asins, opts = {}, log = () => {}) {
  const products = [];
  for (let i = 0; i < asins.length; i += MAX_BATCH) {
    const chunk = asins.slice(i, i + MAX_BATCH);
    await waitForTokens(chunk.length, log);
    const batch = await fetchBatch(chunk, opts, log);
    products.push(...batch);
    log(`Keepa batch ${Math.floor(i / MAX_BATCH) + 1}: ${batch.length} products, tokensLeft=${tokenState.tokensLeft}`);
  }
  return products;
}

// Parse one csv series into [{km, cents}] pairs. cents may be -1 (gap marker).
function parsePairs(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    out.push({ km: arr[i], cents: arr[i + 1] });
  }
  return out;
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Parse a product's price history. Prefers AMAZON (csv[0]); fills AMAZON's -1
// gaps (and the no-Amazon-data case) from NEW (csv[1]). Returns chronological
// points where price=null marks an out-of-stock gap, plus filter/parse counts.
function parsePriceHistory(product) {
  const csv = product.csv || [];
  const amazon = parsePairs(csv[CSV.AMAZON]);
  const newSeries = parsePairs(csv[CSV.NEW]);

  const points = []; // {km, price(cents) | -1, source}
  const amazonValid = amazon.filter((p) => p.cents !== -1);

  if (amazonValid.length > 0) {
    points.push(...amazon.map((p) => ({ ...p, source: 'amazon' })));
    // Fill Amazon's -1 gap intervals with valid NEW readings.
    const gaps = [];
    for (let i = 0; i < amazon.length; i++) {
      if (amazon[i].cents === -1) {
        const start = amazon[i].km;
        const end = i + 1 < amazon.length ? amazon[i + 1].km : Infinity;
        gaps.push([start, end]);
      }
    }
    for (const p of newSeries) {
      if (p.cents === -1) continue;
      if (gaps.some(([s, e]) => p.km >= s && p.km < e)) {
        points.push({ ...p, source: 'new' });
      }
    }
  } else {
    points.push(...newSeries.map((p) => ({ ...p, source: 'new' })));
  }

  points.sort((a, b) => a.km - b.km);

  // Outlier filter on valid points only.
  const validDollars = points.filter((p) => p.cents !== -1).map((p) => centsToDollars(p.cents));
  const med = median(validDollars);
  let outliersDropped = 0;
  const filtered = [];
  for (const p of points) {
    if (p.cents === -1) {
      filtered.push({ km: p.km, date: keepaMinutesToDate(p.km), price: null, source: p.source });
      continue;
    }
    const dollars = centsToDollars(p.cents);
    if (dollars < MIN_PRICE || (med !== null && dollars > OUTLIER_MULTIPLE * med)) {
      outliersDropped++;
      continue;
    }
    filtered.push({ km: p.km, date: keepaMinutesToDate(p.km), price: dollars, source: p.source });
  }

  return {
    points: filtered,
    outliersDropped,
    parsedCounts: { amazon: amazon.length, new: newSeries.length },
  };
}

// A stats entry can be a plain cent value or a [keepaTime, cents] pair
// depending on the field. Normalize to dollars-or-null either way.
function statToDollars(entry) {
  const v = Array.isArray(entry) ? entry[1] : entry;
  if (typeof v !== 'number' || v < 0) return null;
  return centsToDollars(v);
}

// Current price from the stats object: AMAZON, then NEW, then BUY_BOX_SHIPPING
// (last resort — includes shipping). Null if nothing is in stock.
function currentPrice(product) {
  const current = product.stats && product.stats.current;
  if (!Array.isArray(current)) return null;
  for (const idx of [CSV.AMAZON, CSV.NEW, CSV.BUY_BOX_SHIPPING]) {
    const dollars = statToDollars(current[idx]);
    if (dollars !== null && dollars >= MIN_PRICE) return dollars;
  }
  return null;
}

// Max price in the stats window (regular_price candidate). Same fallback order.
function statsMaxPrice(product) {
  const max = product.stats && product.stats.max;
  if (!Array.isArray(max)) return null;
  for (const idx of [CSV.AMAZON, CSV.NEW]) {
    const dollars = statToDollars(max[idx]);
    if (dollars !== null) return dollars;
  }
  return null;
}

module.exports = {
  CSV,
  keepaMinutesToDate,
  dateToKeepaMinutes,
  centsToDollars,
  fetchProducts,
  parsePriceHistory,
  currentPrice,
  statsMaxPrice,
  getTokenState,
};

// Self-test: node backend/lib/keepa.js
if (require.main === module) {
  const assert = require('assert');

  // Keepa epoch: minute 0 must be exactly 2011-01-01T00:00:00Z.
  assert.strictEqual(keepaMinutesToDate(0).toISOString(), '2011-01-01T00:00:00.000Z');
  // Round-trip both directions.
  assert.strictEqual(dateToKeepaMinutes(keepaMinutesToDate(7654321)), 7654321);
  assert.strictEqual(dateToKeepaMinutes(new Date('2011-01-01T00:00:00Z')), 0);
  // Known conversion: (unixMillis / 60000) - 21564000.
  const d = new Date('2026-07-22T00:00:00Z');
  assert.strictEqual(dateToKeepaMinutes(d), d.getTime() / 60000 - 21564000);
  // Cents.
  assert.strictEqual(centsToDollars(41999), 419.99);
  assert.strictEqual(centsToDollars(4900), 49);

  // History parsing: Amazon with a -1 gap filled by NEW, plus outliers dropped.
  const fake = {
    csv: {
      [CSV.AMAZON]: [1000, 41999, 2000, -1, 3000, 43999, 4000, 999999, 5000, 100],
      [CSV.NEW]: [2500, 42500, 3500, 42000],
    },
  };
  const parsed = parsePriceHistory(fake);
  // 999999 cents = $9,999.99 (>5x median) and 100 cents = $1 (<$5) both dropped.
  assert.strictEqual(parsed.outliersDropped, 2);
  const newFills = parsed.points.filter((p) => p.source === 'new');
  assert.strictEqual(newFills.length, 1); // km 2500 falls in the -1 gap [2000, 3000)
  assert.strictEqual(newFills[0].price, 425);
  const gapMarkers = parsed.points.filter((p) => p.price === null);
  assert.strictEqual(gapMarkers.length, 1);
  assert.deepStrictEqual(
    parsed.points.map((p) => p.km),
    [1000, 2000, 2500, 3000]
  );

  // Stats helpers: both int and [time, value] shapes, -1 sentinels.
  assert.strictEqual(statToDollars(41999), 419.99);
  assert.strictEqual(statToDollars([12345, 41999]), 419.99);
  assert.strictEqual(statToDollars(-1), null);
  const fakeStats = { stats: { current: [-1, 42999, ...Array(16).fill(-1), 44999] } };
  assert.strictEqual(currentPrice(fakeStats), 429.99); // NEW fallback when AMAZON is -1

  console.log('keepa.js self-test: all assertions passed');
}
