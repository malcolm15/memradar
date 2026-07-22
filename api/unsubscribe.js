// GET /api/unsubscribe?token=... — remove an alert entirely (data
// minimization: an unsubscribed alert has no reason to exist). Idempotent and
// friendly: always lands on the unsubscribed page, so a re-clicked link never
// shows an error. This link is in every email we send (CAN-SPAM + decency).
require('dotenv').config();
const supabase = require('../backend/lib/supabase');
const { rateLimit } = require('../backend/lib/rateLimiter');

const SITE = 'https://memradar.com';
const DONE_PAGE = `${SITE}/alert-unsubscribed/`;

function redirect(res, url) { res.writeHead(302, { Location: url }); res.end(); }

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit(ip, 30, 60 * 60 * 1000)) { res.status(429).json({ error: 'Too many requests' }); return; }

  const token = (req.query && req.query.token) || '';
  // Even on a malformed token we show the unsubscribed page (idempotent, no
  // information leak) — there's simply nothing to delete.
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { redirect(res, DONE_PAGE); return; }

  try {
    const { data, error } = await supabase
      .from('alerts')
      .delete()
      .eq('unsubscribe_token', token)
      .select('id');
    if (error) console.error(`[${new Date().toISOString()}] unsubscribe: ERROR ${error.message}`);
    else console.log(`[${new Date().toISOString()}] unsubscribe: outcome=${data && data.length ? 'deleted' : 'not_found'}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] unsubscribe: ERROR ${err.message}`);
  }
  redirect(res, DONE_PAGE);
};
