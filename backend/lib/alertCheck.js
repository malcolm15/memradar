// Alert-check step: shared by the daily cron (api/fetch-prices.js) and the
// standalone runner (scripts/run-alert-check.js). Sends price-drop emails for
// confirmed alerts whose target has been hit, and deletes alert rows on the
// schedule the privacy policy promises: pending after 48h, fired once the
// email is sent, and any alert 12 months old. All DB access is via
// parameterized Supabase client methods.
const { sendEmail, priceDropEmail } = require('./alertEmails');

const HOUR_MS = 3600000;
// "Deleted ... after 12 months of inactivity" (privacy.html). An alert has no
// activity other than being created and firing, and a fired alert is deleted
// on send, so an alert still here 12 months after creation never fired.
const STALE_MS = 365 * 24 * HOUR_MS;

// priceByProductId: Map<products.id, currentPrice>. logError(msg, errLike) is
// expected to read .message.
async function checkAlerts(supabase, priceByProductId, log, logError) {
  const stats = { checked: 0, matched: 0, sent: 0, failed: 0, expired_cleaned: 0, deleted_after_send: 0, stale_cleaned: 0, triggered_swept: 0 };

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

  // 1b. Alerts 12 months old. They never fired (a fired alert is deleted on
  // send), and the policy says the address goes after 12 months regardless.
  const { data: stale, error: staleErr } = await supabase
    .from('alerts')
    .delete()
    .lt('created_at', new Date(Date.now() - STALE_MS).toISOString())
    .select('id');
  if (staleErr) logError('alert 12-month cleanup', staleErr);
  else stats.stale_cleaned = stale.length;

  // 1c. Sweep rows left at triggered=true. The email was sent and the delete
  // below failed, so the row was parked rather than risk a second send. This
  // is where it finally goes.
  const { data: swept, error: sweepErr } = await supabase
    .from('alerts')
    .delete()
    .eq('triggered', true)
    .select('id');
  if (sweepErr) logError('triggered-alert sweep', sweepErr);
  else stats.triggered_swept = swept.length;

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

    // Send-then-delete: if the send fails, the row is untouched and the next
    // run retries — better a duplicate risk than a silently dropped alert.
    // Only a CONFIRMED send (Resend returned ok) deletes the row.
    const sendRes = await sendEmail({ to: a.email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
    if (!sendRes.ok) { stats.failed++; logError(`alert send (alert ${a.id})`, { message: sendRes.error }); continue; }
    stats.sent++;

    await supabase.from('email_send_log').insert({ email: a.email, send_type: 'alert' });
    // The alert has done its job; the policy says its address goes now. The
    // price-drop email's unsubscribe link then finds nothing to delete, and
    // lands on the unsubscribed page anyway, which is the right outcome.
    const { error: delErr } = await supabase.from('alerts').delete().eq('id', a.id);
    if (!delErr) { stats.deleted_after_send++; continue; }
    // Delete failed: park it at triggered=true so it is never sent twice, and
    // let step 1c remove it next run.
    logError(`delete after send (alert ${a.id})`, delErr);
    const { error: upErr } = await supabase.from('alerts').update({ triggered: true }).eq('id', a.id);
    if (upErr) logError(`mark triggered fallback (alert ${a.id}): may be re-sent next run`, upErr);
  }

  return stats;
}

module.exports = { checkAlerts };
