const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

module.exports = async (req, res) => {
  // Verify cron secret to prevent unauthorized triggering
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const start = Date.now();

    // Lightweight ping — just count rows in products table
    const { count, error } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    const duration_ms = Date.now() - start;

    console.log(`[keep-alive] ${new Date().toISOString()} — Supabase ping successful. Products count: ${count ?? 0}. Duration: ${duration_ms}ms`);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      products_count: count ?? 0,
      duration_ms
    });

  } catch (err) {
    console.error(`[keep-alive] ${new Date().toISOString()} — Supabase ping failed:`, err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};
