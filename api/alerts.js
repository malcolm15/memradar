// POST /api/alerts — create a (pending) price alert.
//
// PII endpoint (email addresses). Fails closed at every step and returns ONE
// neutral response for every outcome except validation errors, so a prober
// can't distinguish inserted / deduped / honeypotted / rate-limited / capped /
// breakered. All DB access uses the Supabase client's parameterized methods —
// no SQL is ever built from user input (see the parameterization audit).
require('dotenv').config();
const crypto = require('crypto');
const supabase = require('../backend/lib/supabase');
const { validateAlert } = require('../backend/lib/validateAlert');
const { verifyTurnstile } = require('../backend/lib/turnstile');
const { rateLimit } = require('../backend/lib/rateLimiter');
const { sendEmail, confirmationEmail } = require('../backend/lib/alertEmails');

const ALLOWED_ORIGIN = 'https://memradar.com';
const MAX_BODY_BYTES = 2048;
const NEUTRAL = { success: true, message: 'Check your email to confirm your alert.' };

// Caps
const PENDING_CAP = 3;     // unconfirmed alerts per email / 48h
const ACTIVE_CAP = 10;     // confirmed active alerts per email
const BREAKER_CAP = 200;   // confirmation sends across all users / 24h

function log(outcome, email) {
  console.log(`[${new Date().toISOString()}] alerts: outcome=${outcome} email=${maskEmail(email)}`);
}
function logError(msg, detail) {
  console.error(`[${new Date().toISOString()}] alerts: ERROR ${msg}: ${detail}`);
}
// Logs are a leak surface — never log the full address.
function maskEmail(e) {
  if (!e || typeof e !== 'string' || e.indexOf('@') < 0) return '(none)';
  const parts = e.split('@');
  return parts[0].slice(0, 2) + '***@' + parts[1];
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function neutral(res, outcome, email) {
  log(outcome, email);
  res.status(200).json(NEUTRAL);
}

// Read the JSON body with a hard 2KB cap. Prefer Vercel's parsed req.body;
// fall back to reading the raw stream (also capped) if unparsed.
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  setCors(res);

  // Preflight
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  // 1. Method
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  // 2. Size guard — before parsing
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) { res.status(413).json({ error: 'Request too large' }); return; }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (/too large/.test(err.message)) { res.status(413).json({ error: 'Request too large' }); return; }
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  try {
    // 3. Honeypot FIRST — before any expensive work.
    if (body.website) { neutral(res, 'honeypot_tripped', body.email); return; }

    // 4. Turnstile — failure looks like success to bots.
    const turnstileOk = await verifyTurnstile(body.turnstileToken);
    if (!turnstileOk) { neutral(res, 'turnstile_failed', body.email); return; }

    // 5. Per-IP rate limit (in-memory; x-forwarded-for first entry).
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (!rateLimit(ip)) { neutral(res, 'rate_limited', body.email); return; }

    // 6. Validate + sanitize. The ONE branch allowed a real error response —
    // validation errors reveal nothing about the database.
    const v = validateAlert({ email: body.email, targetPrice: body.targetPrice, productId: body.productId });
    if (!v.valid) { res.status(400).json({ success: false, errors: v.errors }); return; }
    const { email, targetPrice, productId } = v.sanitized;

    // 7. Product must exist (productId is the sku/ASIN). Don't confirm which
    // products exist to a prober.
    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id, name')
      .eq('sku', productId)
      .maybeSingle();
    if (prodErr) { logError('product lookup', prodErr.message); neutral(res, 'internal_error', email); return; }
    if (!product) { neutral(res, 'product_not_found', email); return; }

    const now = Date.now();

    // 8a. Unconfirmed alerts for this email in the last 48h.
    const { count: pendingCount, error: e8a } = await supabase
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .eq('confirmed', false)
      .gte('created_at', new Date(now - 48 * 3600e3).toISOString());
    if (e8a) { logError('pending count', e8a.message); neutral(res, 'internal_error', email); return; }
    if ((pendingCount || 0) >= PENDING_CAP) { neutral(res, 'email_pending_cap', email); return; }

    // 8b. Confirmed active (not triggered) alerts for this email.
    const { count: activeCount, error: e8b } = await supabase
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .eq('confirmed', true)
      .eq('triggered', false);
    if (e8b) { logError('active count', e8b.message); neutral(res, 'internal_error', email); return; }
    if ((activeCount || 0) >= ACTIVE_CAP) { neutral(res, 'email_active_cap', email); return; }

    // 8c. Circuit breaker — total confirmation sends across all users / 24h.
    const { count: sendCount, error: e8c } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('send_type', 'confirmation')
      .gte('sent_at', new Date(now - 24 * 3600e3).toISOString());
    if (e8c) { logError('breaker count', e8c.message); neutral(res, 'internal_error', email); return; }
    const breakerTripped = (sendCount || 0) >= BREAKER_CAP;
    if (breakerTripped) logError('breaker_tripped', `confirmation sends in 24h = ${sendCount} (>= ${BREAKER_CAP})`);

    // 9. Insert. Upsert on (email, product_id) — on conflict, do nothing. Both
    // tokens are cryptographically random (never Math.random).
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');
    const { data: inserted, error: insErr } = await supabase
      .from('alerts')
      .upsert([{
        product_id: product.id,
        email,
        target_price: targetPrice,
        confirmed: false,
        confirm_token: confirmToken,
        unsubscribe_token: unsubscribeToken,
      }], { onConflict: 'email,product_id', ignoreDuplicates: true })
      .select('id');
    if (insErr) { logError('insert', insErr.message); neutral(res, 'internal_error', email); return; }
    const newlyInserted = Array.isArray(inserted) && inserted.length > 0;

    // 10. Confirmation email — only for a genuinely new row, and only when the
    // breaker is closed (breaker: row inserted, email deferred).
    if (newlyInserted && !breakerTripped) {
      const tmpl = confirmationEmail({
        productName: product.name,
        targetPrice,
        confirmToken,
        unsubscribeToken,
      });
      const sendRes = await sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
      if (sendRes.ok) {
        await supabase.from('email_send_log').insert({ email, send_type: 'confirmation' });
        neutral(res, 'created_sent', email);
      } else {
        logError('confirmation send', sendRes.error);
        neutral(res, 'created_send_failed', email);
      }
      return;
    }

    // 11. Neutral for dedupe / breaker-deferred.
    neutral(res, newlyInserted ? 'created_breaker_deferred' : 'deduped', email);
  } catch (err) {
    logError('unhandled', err.message);
    // Still neutral — never leak an internal failure as a distinct outcome.
    res.status(200).json(NEUTRAL);
  }
};
