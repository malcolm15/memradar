require('dotenv').config();

const supabase = require('../backend/lib/supabase');
const { fetchRAM, fetchSSDs, normalizeProduct, normalizePrice } = require('../backend/lib/bestbuy');

async function processProducts(rawProducts, category) {
  let saved = 0;
  let errors = 0;

  for (const item of rawProducts) {
    try {
      const product = normalizeProduct(item, category);

      // Upsert product (insert or update if SKU already exists)
      const { data: upserted, error: upsertError } = await supabase
        .from('products')
        .upsert(product, { onConflict: 'sku' })
        .select('id')
        .single();

      if (upsertError) throw upsertError;

      // Insert price snapshot
      const priceData = { product_id: upserted.id, ...normalizePrice(item) };
      const { error: priceError } = await supabase
        .from('price_history')
        .insert(priceData);

      if (priceError) throw priceError;

      saved++;
    } catch (err) {
      console.error(`Error saving SKU ${item.sku}:`, err.message);
      errors++;
    }
  }

  return { saved, errors };
}

async function run() {
  console.log(`[${new Date().toISOString()}] Starting price fetch...`);

  const [ramProducts, ssdProducts] = await Promise.all([
    fetchRAM(),
    fetchSSDs(),
  ]);

  console.log(`Fetched ${ramProducts.length} RAM products, ${ssdProducts.length} SSD products`);

  const [ramResult, ssdResult] = await Promise.all([
    processProducts(ramProducts, 'ram'),
    processProducts(ssdProducts, 'ssd'),
  ]);

  console.log(`RAM: ${ramResult.saved} saved, ${ramResult.errors} errors`);
  console.log(`SSD: ${ssdResult.saved} saved, ${ssdResult.errors} errors`);
  console.log('Done.');
}

// Vercel cron handler
module.exports = async (req, res) => {
  // Protect the endpoint so only Vercel's cron can trigger it
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await run();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Fatal error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Allow running directly from command line for testing
if (require.main === module) run();
