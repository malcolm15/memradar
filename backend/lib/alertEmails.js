// Alert email templates + sender (Resend REST API, no SDK dependency).
//
// SECURITY RULE: user-controlled input appears NOWHERE in email content. The
// recipient address is the ONLY place the user's input is used. Everything
// rendered in the body - product name, prices, URLs - comes from OUR database.
// Product names originate from Amazon (not the user) but are still HTML-escaped
// because they contain & and " characters.
const { parseMpn } = require('./productParsers');

const FROM = 'MemRadar <hello@memradar.com>';
const API_BASE = 'https://memradar-three.vercel.app'; // Vercel serves the API; GitHub Pages can't
const SITE = 'https://memradar.com';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(v) {
  return v == null ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// DISPLAY NAME: THE PDP'S OWN h1, NEVER THE RAW AMAZON TITLE. `products.name`
// is the merchant's marketing title (median 150 chars), which R1 demoted out
// of every heading on the site and the P1 pass deleted from the pages
// entirely. Emails were still sending it, so a 137-character name wrapped to
// four lines on a phone and the price-drop subject ran to 160 characters,
// truncating before the figure.
//
// IT IS READ, NOT RECOMPUTED, AND THAT IS THE WHOLE POINT. `_titleName` is
// built in the generator from shortName() plus filler stripping, the
// mandatory-token append, title overrides and sibling disambiguation.
// Recomputing it here was measured against all 235 built pages and matched
// only 49: the other 186 lost their speed token or their disambiguator, so a
// second computation is a second public name for the same product. The
// generator writes it to search-index.json as `short_name`, and reading that
// field means an email and the page it links cannot disagree.
//
// search-index.json is keyed on healthyProducts, NOT on `indexable`,
// deliberately: the pending noindex flip would cut an indexable-keyed file
// from 232 names to 67 and silently return 165 products to raw titles.
//
// FALLBACK IS THE RAW TITLE AND IT ANNOUNCES ITSELF. An absent field, an
// unknown sku or an unreadable file degrades to exactly the behaviour shipped
// before this change, never to a blank name, and logs which sku did it.
const SHORT_BY_SKU = Object.create(null);
try {
  for (const e of require('../../frontend/search-index.json')) {
    if (e && e.sku && e.short_name) SHORT_BY_SKU[e.sku] = e.short_name;
  }
} catch (err) {
  console.error(`[alertEmails] search index unreadable (${err.message}); every email falls back to the raw listing title`);
}
function displayName(sku, rawName) {
  const short = sku && SHORT_BY_SKU[sku];
  if (!short) console.log(`[alertEmails] no short_name for sku=${sku || '?'}; using the raw listing title`);
  return short || rawName;
}

// Model number, faint, under the content and above the unsubscribe line. From
// the SAME parseMpn() that prints the PDP's "Part number" row, so the two
// cannot disagree. It parses on 158 of 235 products; the rest render no line
// at all rather than a guess. Never the ASIN: that is an Amazon identifier,
// not this product's part number.
function modelLineHtml(rawName) {
  const mpn = parseMpn(rawName);
  return mpn
    ? `<tr><td class="px" style="padding:0 28px 8px;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Model ${esc(mpn)}</p></td></tr>`
    : '';
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
function confirmationEmail({ productName, productSku, targetPrice, confirmToken, unsubscribeToken }) {
  const disp = displayName(productSku, productName);
  const name = esc(disp);
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
        ${modelLineHtml(productName)}
        ${unsubLineHtml(unsubUrl)}`);

  const text = `Confirm your MemRadar price alert

Product: ${disp}
Target price: ${price}

Confirm your alert (link expires in 48 hours):
${confirmUrl}

If you didn't request this, ignore this email. No alert will be set.

Unsubscribe: ${unsubUrl}`;

  return { subject: 'Confirm your MemRadar price alert', html, text };
}

// ---- Alert email (sent from the daily cron when target is hit) ----
function priceDropEmail({ productName, productSku, currentPrice, targetPrice, allTimeLow, productUrl, category, slug, unsubscribeToken }) {
  const disp = displayName(productSku, productName);
  const name = esc(disp);
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
        ${modelLineHtml(productName)}
        ${unsubLineHtml(unsubUrl)}`);

  const text = `Price drop: ${cur} for ${disp}

Now at or below your target of ${target}.${allTimeLow != null ? `\nAll-time low we've tracked: ${money(allTimeLow)}` : ''}

View on Amazon: ${amazonUrl}
Full price history: ${pdpUrl}

Unsubscribe: ${unsubUrl}`;

  return { subject: `Price drop: ${cur} for ${disp}`, html, text };
}

module.exports = { sendEmail, confirmationEmail, priceDropEmail };
