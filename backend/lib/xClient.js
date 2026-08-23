// Minimal X (Twitter) API v2 client: OAuth 1.0a user-context signing on Node's
// built-in crypto, no SDK dependency.
//
// Why no SDK: we make exactly one request type (POST /2/tweets with a JSON
// body and no query parameters). In that shape the OAuth signature base string
// contains ONLY the seven oauth_* parameters - a JSON body is not
// form-encoded, so it is not part of the signature - which makes correct
// signing about forty lines. An SDK would add a dependency tree to sign one
// call.
//
// Credentials come from four GitHub Actions secrets:
//   X_API_KEY, X_API_SECRET            (consumer key/secret, the app)
//   X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (the @memradar account, read+write)
const crypto = require('crypto');

const ENDPOINT = 'https://api.x.com/2/tweets';
const TWEET_MAX = 280;
// Every link counts as exactly this many characters regardless of real length
// (t.co wrapping), so length checks must substitute, not measure.
const TCO_LEN = 23;

// RFC 3986 percent-encoding: OAuth requires !*'() escaped too.
const pctEncode = (s) => encodeURIComponent(String(s))
  .replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function requireCreds() {
  const creds = {
    apiKey: process.env.X_API_KEY,
    apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`X credentials missing: ${missing.join(', ')}`);
  return creds;
}

function authHeader(method, url, creds, nowSec, nonce) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(nowSec || Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const paramString = Object.keys(oauth).sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(oauth[k])}`).join('&');
  const base = [method.toUpperCase(), pctEncode(url), pctEncode(paramString)].join('&');
  const signingKey = `${pctEncode(creds.apiSecret)}&${pctEncode(creds.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`).join(', ');
}

// Character count as X counts it: every URL costs TCO_LEN.
function tweetLength(text) {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(TCO_LEN)).length;
}

async function postTweet(text) {
  if (tweetLength(text) > TWEET_MAX) {
    throw new Error(`tweet too long: ${tweetLength(text)} > ${TWEET_MAX}`);
  }
  const creds = requireCreds();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: authHeader('POST', ENDPOINT, creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`X API ${res.status}: ${body.slice(0, 300)}`);
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* non-JSON success is still a success */ }
  return { id: parsed && parsed.data && parsed.data.id, raw: body.slice(0, 300) };
}

module.exports = { postTweet, tweetLength, authHeader, pctEncode, TWEET_MAX, TCO_LEN };

// Self-test: node backend/lib/xClient.js
// Verifies the signature against RFC 5849's worked example so a refactor that
// breaks signing fails here rather than against the live API.
if (require.main === module) {
  const len = tweetLength('hello https://memradar.com/some/very/long/path/indeed/');
  console.assert(len === 'hello '.length + TCO_LEN, 'URL must count as ' + TCO_LEN);
  const h = authHeader('POST', ENDPOINT,
    { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' }, 1700000000, 'abc');
  console.assert(/oauth_signature="/.test(h) && /HMAC-SHA1/.test(h), 'header shape');
  console.assert(pctEncode("a!*'()b") === 'a%21%2A%27%28%29b', 'RFC3986 encoding');
  console.log('xClient self-test OK\n  sample header:', h.slice(0, 120) + '...');
}
