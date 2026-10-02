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

// THE <head> IS LOAD-BEARING AND THERE DID NOT USED TO BE ONE. Without a
// viewport meta, iOS Mail lays the message out on a ~980px canvas and then
// zooms the whole thing down to fit the screen, which shrank every size
// proportionally and left the card narrower than the phone. The old card also
// carried a fixed width="480" ATTRIBUTE, which pinned it at 480px inside that
// canvas; width:100% with max-width:480px keeps the same desktop width while
// letting the card fill a phone. Do not reintroduce the attribute.
//
// The media query only narrows the side padding on small screens. It is a
// progressive enhancement: a client that ignores it still gets a readable
// message at 28px padding, which is why no size depends on it.
function shell(innerHtml) {
  return `<!doctype html><html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @media only screen and (max-width:480px) {
      .px { padding-left:16px !important; padding-right:16px !important; }
    }
  </style>
</head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#374151;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td class="px" style="padding:24px 28px 8px;">
          <span style="font-size:20px;font-weight:800;line-height:1.2;color:#111827;">Mem<span style="color:#3A5BC7;">Radar</span></span>
        </td></tr>
        ${innerHtml}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#3A5BC7;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;line-height:1.2;padding:12px 24px;border-radius:8px;">${label}</a>`;
}

function unsubLineHtml(unsubUrl) {
  return `<tr><td class="px" style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
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
        <tr><td class="px" style="padding:8px 28px 0;">
          <h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:#111827;">Confirm your price alert</h1>
          <p style="margin:0 0 8px;font-size:16px;color:#374151;line-height:1.5;">You asked to be alerted when this product drops to your target:</p>
          <p style="margin:0 0 12px;font-size:17px;color:#111827;font-weight:700;line-height:1.4;">${name}</p>
          <p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.5;">Target price: <strong>${price}</strong></p>
          <p style="margin:0 0 20px;line-height:1.2;">${button(confirmUrl, 'Confirm my alert')}</p>
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
  // Plain product link since 2026-09-30: no Associates tag is appended.
  const amazonUrl = productUrl;
  const pdpUrl = `${SITE}/${category}/${slug}/`;
  const unsubUrl = `${API_BASE}/api/unsubscribe?token=${unsubscribeToken}`;
  const atlLine = allTimeLow != null
    ? `<p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.5;">All-time low we've tracked: <strong>${money(allTimeLow)}</strong></p>`
    : '';

  const html = shell(`
        <tr><td class="px" style="padding:8px 28px 0;">
          <h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:#16a34a;">📉 Price drop!</h1>
          <p style="margin:0 0 12px;font-size:17px;color:#111827;font-weight:700;line-height:1.4;">${name}</p>
          <p style="margin:0 0 4px;font-size:22px;color:#111827;font-weight:800;line-height:1.2;">${cur}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.5;">Now at or below your target of ${target}.</p>
          ${atlLine}
          <p style="margin:0 0 12px;line-height:1.2;">${button(amazonUrl, 'View on Amazon →')}</p>
          <p style="margin:0 0 16px;font-size:13px;line-height:1.5;"><a href="${pdpUrl}" style="color:#3A5BC7;">See full price history on MemRadar</a></p>
        </td></tr>
        ${unsubLineHtml(unsubUrl)}`);

  const text = `Price drop: ${cur} for ${productName}

Now at or below your target of ${target}.${allTimeLow != null ? `\nAll-time low we've tracked: ${money(allTimeLow)}` : ''}

View on Amazon: ${amazonUrl}
Full price history: ${pdpUrl}

Unsubscribe: ${unsubUrl}`;

  return { subject: `Price drop: ${cur} for ${productName}`, html, text };
}

module.exports = { sendEmail, confirmationEmail, priceDropEmail };
