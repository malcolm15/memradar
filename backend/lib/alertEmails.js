// Alert email templates + sender (Resend REST API, no SDK dependency).
//
// SECURITY RULE: user-controlled input appears NOWHERE in email content. The
// recipient address is the ONLY place the user's input is used. Everything
// rendered in the body - product name, prices, URLs - comes from OUR database.
// Product names originate from Amazon (not the user) but are still HTML-escaped
// because they contain & and " characters.
const FROM = 'MemRadar <hello@memradar.com>';
const API_BASE = 'https://memradar-three.vercel.app'; // Vercel serves the API; GitHub Pages can't
const SITE = 'https://memradar.com';
const AFFILIATE_TAG = 'memradar-20';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(v) {
  return v == null ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Low-level send. Returns { ok, id } or { ok:false, error }. Never throws so
// callers can log and continue.
async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${data.message || 'unknown'}` };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function shell(innerHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="padding:24px 28px 8px;">
          <span style="font-size:20px;font-weight:800;color:#111827;">Mem<span style="color:#2563eb;">Radar</span></span>
        </td></tr>
        ${innerHtml}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">${label}</a>`;
}

function unsubLineHtml(unsubUrl) {
  return `<tr><td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
      You're receiving this because someone entered this email at MemRadar.
      <a href="${unsubUrl}" style="color:#6b7280;">Unsubscribe</a> at any time.
    </p></td></tr>`;
}

// ---- Confirmation email (sent from POST /api/alerts) ----
function confirmationEmail({ productName, targetPrice, confirmToken, unsubscribeToken }) {
  const name = esc(productName);
  const confirmUrl = `${API_BASE}/api/confirm?token=${confirmToken}`;
  const unsubUrl = `${API_BASE}/api/unsubscribe?token=${unsubscribeToken}`;
  const price = money(targetPrice);

  const html = shell(`
        <tr><td style="padding:8px 28px 0;">
          <h1 style="margin:0 0 12px;font-size:19px;color:#111827;">Confirm your price alert</h1>
          <p style="margin:0 0 8px;font-size:14px;color:#374151;line-height:1.6;">You asked to be alerted when this product drops to your target:</p>
          <p style="margin:0 0 4px;font-size:15px;color:#111827;font-weight:600;line-height:1.4;">${name}</p>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;">Target price: <strong>${price}</strong></p>
          <p style="margin:0 0 20px;">${button(confirmUrl, 'Confirm my alert')}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.6;">This link expires in 48 hours. If you didn't request this, you can ignore this email. No alert will be set.</p>
        </td></tr>
        ${unsubLineHtml(unsubUrl)}`);

  const text = `Confirm your MemRadar price alert

Product: ${productName}
Target price: ${price}

Confirm your alert (link expires in 48 hours):
${confirmUrl}

If you didn't request this, ignore this email. No alert will be set.

Unsubscribe: ${unsubUrl}`;

  return { subject: 'Confirm your MemRadar price alert', html, text };
}

// ---- Alert email (sent from the daily cron when target is hit) ----
function priceDropEmail({ productName, currentPrice, targetPrice, allTimeLow, productUrl, category, slug, unsubscribeToken }) {
  const name = esc(productName);
  const cur = money(currentPrice);
  const target = money(targetPrice);
  const affiliate = productUrl + (productUrl.includes('?') ? '&' : '?') + 'tag=' + AFFILIATE_TAG;
  const pdpUrl = `${SITE}/${category}/${slug}/`;
  const unsubUrl = `${API_BASE}/api/unsubscribe?token=${unsubscribeToken}`;
  const atlLine = allTimeLow != null
    ? `<p style="margin:0 0 20px;font-size:13px;color:#6b7280;">All-time low we've tracked: <strong>${money(allTimeLow)}</strong></p>`
    : '';

  const html = shell(`
        <tr><td style="padding:8px 28px 0;">
          <h1 style="margin:0 0 12px;font-size:19px;color:#16a34a;">📉 Price drop!</h1>
          <p style="margin:0 0 4px;font-size:15px;color:#111827;font-weight:600;line-height:1.4;">${name}</p>
          <p style="margin:0 0 4px;font-size:22px;color:#111827;font-weight:800;">${cur}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Now at or below your target of ${target}.</p>
          ${atlLine}
          <p style="margin:0 0 12px;">${button(affiliate, 'View on Amazon →')}</p>
          <p style="margin:0 0 16px;font-size:13px;"><a href="${pdpUrl}" style="color:#2563eb;">See full price history on MemRadar</a></p>
        </td></tr>
        ${unsubLineHtml(unsubUrl)}`);

  const text = `Price drop: ${productName} is now ${cur}

Now at or below your target of ${target}.${allTimeLow != null ? `\nAll-time low we've tracked: ${money(allTimeLow)}` : ''}

View on Amazon: ${affiliate}
Full price history: ${pdpUrl}

Unsubscribe: ${unsubUrl}`;

  return { subject: `Price drop: ${productName} is now ${cur}`, html, text };
}

module.exports = { sendEmail, confirmationEmail, priceDropEmail };
