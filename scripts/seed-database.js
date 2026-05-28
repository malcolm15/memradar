// ONE-TIME SEED SCRIPT — safe to run multiple times due to upsert. Remove or archive after Best Buy API is live.

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const products = [
  {
    sku: 'SEED-RAM-001',
    name: 'G.Skill Trident Z5 RGB DDR5-6000 32GB (2x16GB)',
    category: 'ram',
    brand: 'G.Skill',
    model: 'Trident Z5 RGB',
    image_url: null,
    product_url: 'https://www.bestbuy.com',
    retailer: 'bestbuy'
  },
  {
    sku: 'SEED-RAM-002',
    name: 'Corsair Vengeance DDR5-6000 32GB (2x16GB)',
    category: 'ram',
    brand: 'Corsair',
    model: 'Vengeance',
    image_url: null,
    product_url: 'https://www.bestbuy.com',
    retailer: 'bestbuy'
  },
  {
    sku: 'SEED-SSD-001',
    name: 'Samsung 990 Pro 2TB NVMe SSD',
    category: 'ssd',
    brand: 'Samsung',
    model: '990 Pro',
    image_url: null,
    product_url: 'https://www.bestbuy.com',
    retailer: 'bestbuy'
  }
];

const seedPrices = {
  'SEED-RAM-001': 289.99,
  'SEED-RAM-002': 319.99,
  'SEED-SSD-001': 259.99,
};

async function seed() {
  console.log('Seeding products...');

  const { data: upserted, error: productError } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'sku' })
    .select('id, sku');

  if (productError) {
    console.error('Failed to upsert products:', productError.message);
    process.exit(1);
  }

  console.log(`  ${upserted.length} products upserted.`);

  console.log('Seeding price history...');

  const priceRows = upserted.map(({ id, sku }) => ({
    product_id: id,
    price: seedPrices[sku],
    regular_price: seedPrices[sku],
    in_stock: true,
    fetched_at: new Date().toISOString(),
  }));

  const { error: priceError } = await supabase
    .from('price_history')
    .insert(priceRows);

  if (priceError) {
    console.error('Failed to insert price history:', priceError.message);
    process.exit(1);
  }

  console.log(`  ${priceRows.length} price history rows inserted.`);

  // Confirm row counts
  const [{ count: productCount }, { count: priceCount }, { count: alertCount }] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('price_history').select('*', { count: 'exact', head: true }),
    supabase.from('alerts').select('*', { count: 'exact', head: true }),
  ]);

  console.log('\nRow counts:');
  console.log(`  products:      ${productCount}`);
  console.log(`  price_history: ${priceCount}`);
  console.log(`  alerts:        ${alertCount}`);
  console.log('\nDone.');
}

seed();
