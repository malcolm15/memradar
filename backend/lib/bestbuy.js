// DORMANT: Best Buy API access was never approved; Keepa is the live price
// source (backend/lib/keepa.js). Kept intact in case approval ever comes.
const API_KEY = process.env.BBY_API_KEY;
const BASE = 'https://api.bestbuy.com/v1';
const FETCH_TIMEOUT_MS = 10_000;

const FIELDS = 'sku,name,manufacturer,salePrice,regularPrice,url,images.href,inStoreAvailability,onlineAvailability';

async function fetchProducts(categoryId) {
  const url = `${BASE}/products(categoryPath.id=${categoryId}&onlineAvailability=true)?` +
    `format=json&show=${FIELDS}&pageSize=100&sort=bestSellingRank.asc&apiKey=${API_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Best Buy API timed out after ${FETCH_TIMEOUT_MS}ms (category ${categoryId})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Best Buy API ${res.status} ${res.statusText} (category ${categoryId})`);
  }

  const data = await res.json();

  if (!Array.isArray(data.products)) {
    throw new Error(`Best Buy API response missing products array (category ${categoryId})`);
  }

  return data.products;
}

// Best Buy category IDs
async function fetchRAM()  { return fetchProducts('4606');  }  // Computer Memory
async function fetchSSDs() { return fetchProducts('3582'); }   // Solid State Drives

function normalizeProduct(item, category) {
  return {
    sku:         String(item.sku),
    name:        item.name,
    category,
    brand:       item.manufacturer || null,
    image_url:   item.images?.[0]?.href || null,
    product_url: item.url || null,
    retailer:    'bestbuy',
  };
}

function normalizePrice(item) {
  return {
    price:         item.salePrice,
    regular_price: item.regularPrice || null,
    in_stock:      item.onlineAvailability === true,
  };
}

module.exports = { fetchRAM, fetchSSDs, normalizeProduct, normalizePrice };
