const API_KEY = process.env.BBY_API_KEY;
const BASE = 'https://api.bestbuy.com/v1';

const FIELDS = 'sku,name,manufacturer,salePrice,regularPrice,url,images.href,inStoreAvailability,onlineAvailability';

async function fetchProducts(categoryId) {
  const url = `${BASE}/products(categoryPath.id=${categoryId}&onlineAvailability=true)?` +
    `format=json&show=${FIELDS}&pageSize=100&sort=bestSellingRank.asc&apiKey=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Best Buy API error: ${res.status}`);
  const data = await res.json();
  return data.products || [];
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
