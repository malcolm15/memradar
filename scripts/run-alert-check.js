// Standalone alert-check runner — same logic as the daily cron's alert step
// (backend/lib/alertCheck.js), for manual testing without a Keepa fetch.
//
// Builds the current-price map from the newest price_history row of each
// product that has an active confirmed alert, then runs checkAlerts (sends
// price-drop emails for hits, cleans up expired pending alerts).
//
// Usage: node scripts/run-alert-check.js
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { checkAlerts } = require('../backend/lib/alertCheck');

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const logError = (m, e) => console.error(`[${new Date().toISOString()}] ERROR ${m}: ${e && e.message}`);

(async () => {
  log('Manual alert check started');

  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('product_id')
    .eq('confirmed', true)
    .eq('triggered', false);
  if (error) throw error;

  const ids = [...new Set(alerts.map((a) => a.product_id))];
  const priceByProductId = new Map();
  for (const id of ids) {
    const { data } = await supabase
      .from('price_history')
      .select('price')
      .eq('product_id', id)
      .order('fetched_at', { ascending: false })
      .limit(1);
    if (data && data.length) priceByProductId.set(id, Number(data[0].price));
  }
  log(`Built current-price map for ${priceByProductId.size} product(s) with active alerts`);

  const stats = await checkAlerts(supabase, priceByProductId, log, logError);
  console.log('\nAlert check result:', JSON.stringify(stats, null, 2));
})().catch((err) => {
  logError('alert check failed', err);
  process.exit(1);
});
