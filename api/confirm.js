// GET /api/confirm?token=... — confirm a pending alert (double opt-in).
// Single-use: on success the confirm_token is nulled, so a re-clicked link
// lands on the invalid page (acceptable; tokens are 32 bytes, single-use).
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { rateLimit } = require('../backend/lib/rateLimiter');

const SITE = 'https://memradar.com';
const OK_PAGE = `${SITE}/alert-confirmed/`;
const BAD_PAGE = `${SITE}/alert-invalid/`;

function redirect(res, url) { res.writeHead(302, { Location: url }); res.end(); }

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Generous rate limit — token brute force is infeasible at 32 bytes, but
  // there's no reason to permit scanning.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit(ip, 30, 60 * 60 * 1000)) { res.status(429).json({ error: 'Too many requests' }); return; }

  const token = (req.query && req.query.token) || '';
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { redirect(res, BAD_PAGE); return; }

  try {
    // Atomic confirm by token (parameterized). Matches only unconfirmed rows
    // holding this exact token.
    const { data, error } = await supabase
      .from('alerts')
      .update({ confirmed: true, confirmed_at: new Date().toISOString(), confirm_token: null })
      .eq('confirm_token', token)
      .select('id');
    if (error) { console.error(`[${new Date().toISOString()}] confirm: ERROR ${error.message}`); redirect(res, BAD_PAGE); return; }

    const confirmed = Array.isArray(data) && data.length > 0;
    console.log(`[${new Date().toISOString()}] confirm: outcome=${confirmed ? 'confirmed' : 'invalid_or_used'}`);
    redirect(res, confirmed ? OK_PAGE : BAD_PAGE);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] confirm: ERROR ${err.message}`);
    redirect(res, BAD_PAGE);
  }
};
