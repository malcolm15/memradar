// Alert-check step: shared by the daily cron (api/fetch-prices.js) and the
// standalone runner (scripts/run-alert-check.js). Sends price-drop emails for
// confirmed alerts whose target has been hit, and cleans up expired pending
// alerts. All DB access is via parameterized Supabase client methods.
const { sendEmail, priceDropEmail } = require('./alertEmails');

const HOUR_MS = 3600000;

// priceByProductId: Map<products.id, currentPrice>. logError(msg, errLike) is
// expected to read .message.
async function checkAlerts(supabase, priceByProductId, log, logError) {
  const stats = { checked: 0, matched: 0, sent: 0, failed: 0, expired_cleaned: 0 };

  // 1. Data minimization: delete unconfirmed alerts older than 48h. This is
  // the expiry that makes the per-email pending cap self-healing.
  const { data: expired, error: expErr } = await supabase
    .from('alerts')
    .delete()
    .eq('confirmed', false)
    .lt('created_at', new Date(Date.now() - 48 * HOUR_MS).toISOString())
    .select('id');
  if (expErr) logError('alert expiry cleanup', expErr);
  else stats.expired_cleaned = expired.length;

  // 2. Confirmed, not-yet-triggered alerts, with their product joined.
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, email, target_price, unsubscribe_token, product_id, products(name, product_url, category, slug)')
    .eq('confirmed', true)
    .eq('triggered', false);
  if (error) { logError('alert query', error); return stats; }
  stats.checked = alerts.length;

  // Sequential loop is fine at current scale. Resend has a batch API
  // (POST /emails/batch) if alert volume grows.
  for (const a of alerts) {
    const current = priceByProductId.get(a.product_id);
    if (current == null || current > Number(a.target_price)) continue; // not hit / out of catalog
    stats.matched++;

    const prod = a.products;
    if (!prod) { logError('alert product missing', { message: `alert ${a.id} product_id ${a.product_id}` }); continue; }

    // All-time low for context (cheap single-row lookup).
    let atl = null;
    const { data: low } = await supabase
      .from('price_history')
      .select('price')
      .eq('product_id', a.product_id)
      .order('price', { ascending: true })
      .limit(1);
    if (low && low.length) atl = Number(low[0].price);

    const tmpl = priceDropEmail({
      productName: prod.name,
      currentPrice: current,
      targetPrice: Number(a.target_price),
      allTimeLow: atl,
      productUrl: prod.product_url,
      category: prod.category,
      slug: prod.slug,
      unsubscribeToken: a.unsubscribe_token,
    });

    // Send-then-mark: if the send fails, leave triggered=false so tomorrow's
    // run retries — better a duplicate risk than a silently dropped alert.
    const sendRes = await sendEmail({ to: a.email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
    if (!sendRes.ok) { stats.failed++; logError(`alert send (alert ${a.id})`, { message: sendRes.error }); continue; }

    await supabase.from('email_send_log').insert({ email: a.email, send_type: 'alert' });
    const { error: upErr } = await supabase.from('alerts').update({ triggered: true }).eq('id', a.id);
    if (upErr) logError(`mark triggered (alert ${a.id})`, upErr);
    stats.sent++;
  }

  return stats;
}

module.exports = { checkAlerts };
