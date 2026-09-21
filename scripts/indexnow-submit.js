// Submit the day's materially-changed URLs to IndexNow (Bing, Yandex, Seznam,
// Naver; Google does not consume it).
//
// DRY RUN BY DEFAULT, like every other script here: --confirm posts.
//
// THE KEY IS READ FROM THE PUBLISHED KEY FILE, never from an env var or a
// literal. IndexNow authenticates by fetching https://memradar.com/<key>.txt
// and comparing its contents to the key in the payload, so deriving both from
// the same file makes the two impossible to desynchronise: rotate by dropping
// in a new file and deleting the old one, and this follows. If no key file
// exists, nothing is submitted and the run says so.
//
// NEVER EXITS NONZERO. It runs inside the daily regen, whose other steps have
// already committed and deployed; a Bing outage must not fail that job, and
// must not read as "the regen did not run" to the supervisor. Every outcome is
// reported on stdout as one JSON line for the workflow summary instead.
const fs = require('fs');
const path = require('path');

const CONFIRM = process.argv.includes('--confirm');
const ENDPOINT = 'https://api.indexnow.org/indexnow'; // shared: forwards to all participating engines
const HOST = 'memradar.com';
const FRONTEND = path.join(__dirname, '..', 'frontend');
const URLS_PATH = path.join(__dirname, 'output', 'indexnow-urls.json');
const MAX_URLS = 10000; // protocol limit per request
const KEY_RE = /^[a-f0-9]{32}\.txt$/;

function out(o) { console.log('INDEXNOW ' + JSON.stringify(o)); }

function findKey() {
  const files = fs.readdirSync(FRONTEND).filter((f) => KEY_RE.test(f));
  if (files.length !== 1) return { error: `expected exactly 1 key file in frontend/, found ${files.length}` };
  const key = files[0].replace(/\.txt$/, '');
  const body = fs.readFileSync(path.join(FRONTEND, files[0]), 'utf8').trim();
  // The file must contain the key and nothing else, or IndexNow answers 403.
  if (body !== key) return { error: `key file ${files[0]} does not contain its own key` };
  return { key, keyLocation: `https://${HOST}/${files[0]}` };
}

(async () => {
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(URLS_PATH, 'utf8'));
  } catch (e) {
    out({ submitted: 0, status: null, skipped: `no URL list (${e.code || e.message})` });
    return;
  }
  // A day with nothing material submits NOTHING, rather than an empty request.
  if (!items.length) { out({ submitted: 0, status: null, skipped: 'no material changes' }); return; }

  const k = findKey();
  if (k.error) { out({ submitted: 0, status: null, skipped: k.error }); return; }

  const urlList = items.map((i) => i.url).slice(0, MAX_URLS);
  if (items.length > MAX_URLS) console.log(`INDEXNOW truncated ${items.length} to ${MAX_URLS} (protocol limit)`);
  const payload = { host: HOST, key: k.key, keyLocation: k.keyLocation, urlList };

  if (!CONFIRM) {
    console.log(`DRY RUN (pass --confirm to submit). Would POST ${urlList.length} URLs to ${ENDPOINT}`);
    items.slice(0, 20).forEach((i) => console.log(`   ${i.url} (${i.reasons.join('; ')})`));
    if (items.length > 20) console.log(`   ... and ${items.length - 20} more`);
    out({ submitted: 0, status: null, skipped: 'dry run', would_submit: urlList.length });
    return;
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    // 200 accepted, 202 accepted pending key validation, 403 key not found,
    // 422 URL not on this host, 429 submitting too much.
    if (res.status === 429) {
      console.log('*** INDEXNOW 429: TOO MANY REQUESTS (potential spam). We are submitting more than IndexNow will take;');
      console.log('*** tighten the materiality definition in generate-product-pages.js (indexNowMaterial) before the next run.');
    } else if (res.status >= 400) {
      console.log(`*** INDEXNOW ${res.status}: submission rejected. 403 = key file not reachable or mismatched, 422 = URL not on ${HOST}.`);
    }
    out({ submitted: urlList.length, status: res.status, skipped: null });
  } catch (e) {
    // Network failure is not a regen failure.
    out({ submitted: 0, status: null, skipped: `request failed: ${e.message}` });
  }
})();
