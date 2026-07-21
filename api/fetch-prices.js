require('dotenv').config();

const supabase = require('../backend/lib/supabase');
const { fetchRAM, fetchSSDs, normalizeProduct, normalizePrice } = require('../backend/lib/bestbuy');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR ${msg}:`, err.message);
}

async function processProducts(rawProducts, category, errors) {
  let saved = 0;

  for (const item of rawProducts) {
    if (!item.sku || item.salePrice == null) {
      errors.push({ category, sku: item.sku || '(unknown)', error: 'Missing required fields (sku or salePrice)' });
      continue;
    }

    try {
      const product = normalizeProduct(item, category);

      const { data: upserted, error: upsertError } = await supabase
        .from('products')
        .upsert(product, { onConflict: 'sku' })
        .select('id')
        .single();

      if (upsertError) throw upsertError;

      const priceData = { product_id: upserted.id, ...normalizePrice(item) };
      const { error: priceError } = await supabase
        .from('price_history')
        .insert(priceData);

      if (priceError) throw priceError;

      saved++;
    } catch (err) {
      errors.push({ category, sku: String(item.sku), error: err.message });
      logError(`SKU ${item.sku} (${category})`, err);
    }
  }

  return saved;
}

async function run() {
  const startTime = Date.now();
  log('Job started');

  const errors = [];

  let ramProducts = [];
  let ssdProducts = [];

  try {
    ramProducts = await fetchRAM();
    log(`Fetched ${ramProducts.length} RAM products`);
  } catch (err) {
    logError('fetchRAM failed', err);
    errors.push({ category: 'ram', sku: null, error: err.message });
  }

  try {
    ssdProducts = await fetchSSDs();
    log(`Fetched ${ssdProducts.length} SSD products`);
  } catch (err) {
    logError('fetchSSDs failed', err);
    errors.push({ category: 'ssd', sku: null, error: err.message });
  }

  const [ramSaved, ssdSaved] = await Promise.all([
    processProducts(ramProducts, 'ram', errors),
    processProducts(ssdProducts, 'ssd', errors),
  ]);

  const duration_ms = Date.now() - startTime;

  log(`RAM: ${ramProducts.length} fetched, ${ramSaved} saved`);
  log(`SSD: ${ssdProducts.length} fetched, ${ssdSaved} saved`);
  if (errors.length > 0) log(`Errors: ${errors.length}`);
  log(`Job completed in ${duration_ms}ms`);

  return {
    success: true,
    ram: { fetched: ramProducts.length, saved: ramSaved },
    ssd: { fetched: ssdProducts.length, saved: ssdSaved },
    errors,
    duration_ms,
  };
}

module.exports = async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const summary = await run();
    res.status(200).json(summary);
  } catch (err) {
    logError('Unhandled exception in run()', err);
    res.status(500).json({ error: err.message });
  }
};

if (require.main === module) {
  run().then(summary => console.log('\nSummary:', JSON.stringify(summary, null, 2)));
}
