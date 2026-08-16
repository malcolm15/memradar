// Shared Newegg/Rakuten feed access: SFTP download with a completion
// watchdog, and the streaming positional parser for Rakuten merchandiser
// files. Used by scripts/match-newegg.js (matching) and
// scripts/refresh-newegg-offers.js (the daily refresh cron).
//
// SFTP facts (production-observed, Aug 2026):
// - Host aftp.linksynergy.com, single connection, sequential ops, and login
//   retries: 0 - NEVER hammer a failing login.
// - fastGet INTERMITTENTLY hangs after the final byte arrives (observed on
//   both the 158MB complete file and a 1.2MB delta; also observed resolving
//   cleanly). The watchdog below times the download out and then checks the
//   local bytes' gzip integrity: valid -> the download is treated as
//   complete and the connection torn down; invalid -> failure.
//
// Feed format (verified empirically against live files):
// - Pipe-delimited positional columns, NO header row; first line
//   HDR|mid|advertiser|timestamp, last line TRL|rowcount.
// - Complete file: 38 columns. Delta file: the same 38 plus column 39, a
//   change marker: I (insert), U (update), D (delete). The complete feed
//   carries ONLY in-stock items, so absence from it means not purchasable.
// - Column 24 is a zero-padded GTIN on ~99% of rows.
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const SftpClient = require('ssh2-sftp-client');

const MID = '44583';
const SID = '4705448';
const COMPLETE_FILE = `${MID}_${SID}_mp.txt.gz`;
const DELTA_FILE = `${MID}_${SID}_mp_delta.txt.gz`;

// 0-based indexes into the positional layout.
const RAKUTEN_COLS = { name: 1, sku: 2, url: 5, salePrice: 12, retailPrice: 13, brand: 16, mpn: 19, manufacturer: 20, availability: 22, upc: 23, currency: 25, deltaMarker: 38 };

// Feed URLs are pre-built linksynergy click links; we store CLEAN urls and
// wrap at render time (backend/lib/rakutenLink.js). Extract the embedded murl
// and drop its query (the ?item= param just repeats the /p/{sku} path).
function cleanFeedUrl(raw) {
  try {
    let u = new URL(raw);
    if (u.hostname === 'click.linksynergy.com') {
      const murl = u.searchParams.get('murl');
      if (murl) u = new URL(murl);
    }
    return u.origin + u.pathname;
  } catch { return raw; }
}

const parseStock = (v) => /^(y|yes|true|1|in[-\s]?stock|available)$/i.test(v) ? true
  : /^(n|no|false|0|out[-\s]?of[-\s]?stock|unavailable|backorder(ed)?|discontinued)$/i.test(v) ? false : null;

async function connect(log = () => {}) {
  const { RAKUTEN_SFTP_HOST, RAKUTEN_SFTP_USER, RAKUTEN_SFTP_PASS } = process.env;
  if (!RAKUTEN_SFTP_HOST || !RAKUTEN_SFTP_USER || !RAKUTEN_SFTP_PASS) {
    throw new Error('RAKUTEN_SFTP_HOST/USER/PASS must be set');
  }
  const sftp = new SftpClient();
  log(`Connecting to ${RAKUTEN_SFTP_HOST} as ${RAKUTEN_SFTP_USER}...`);
  await sftp.connect({
    host: RAKUTEN_SFTP_HOST,
    username: RAKUTEN_SFTP_USER,
    password: RAKUTEN_SFTP_PASS,
    readyTimeout: 30000,
    retries: 0, // never hammer a failing login
  });
  return sftp;
}

// Download remote gz to localPath. Resolves {bytes, viaWatchdog} on success.
// On watchdog timeout the local bytes are gzip-integrity-checked: valid means
// the transfer finished and only the protocol close hung (the observed
// failure mode) - treated as success; invalid means a real failure.
async function downloadGz(sftp, remotePath, localPath, timeoutMs, log = () => {}) {
  const st = await sftp.stat(remotePath); // throws if absent
  log(`Downloading ${remotePath} (${(st.size / 1048576).toFixed(1)} MB, server mtime ${new Date(st.modifyTime).toISOString()})...`);
  let timer;
  const watchdog = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        zlib.gunzipSync(fs.readFileSync(localPath));
        log(`Watchdog fired after ${timeoutMs}ms but the download is gzip-valid - treating as complete (known fastGet close-hang)`);
        resolve({ viaWatchdog: true });
      } catch {
        reject(new Error(`Download of ${remotePath} did not complete within ${timeoutMs}ms and local bytes are not a valid gzip`));
      }
    }, timeoutMs);
  });
  const fastGetP = sftp.fastGet(remotePath, localPath).then(() => ({ viaWatchdog: false }));
  fastGetP.catch(() => {}); // if the watchdog wins, a late fastGet rejection must not crash the process
  try {
    const result = await Promise.race([fastGetP, watchdog]);
    return { bytes: fs.statSync(localPath).size, viaWatchdog: result.viaWatchdog };
  } finally {
    clearTimeout(timer);
  }
}

// Force-close the connection. After a watchdog success the sftp session may
// be wedged mid-transfer, so end() gets its own short timeout before we
// abandon the socket (the process exiting cleans it up).
async function endConnection(sftp, log = () => {}) {
  await Promise.race([
    sftp.end().catch(() => {}),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  log('Connection closed (or abandoned after 5s - harmless post-download)');
}

// Stream a Rakuten merchandiser file (plain or .gz) line by line, calling
// onItem for every product row. Item fields mirror what the matcher and the
// refresh cron need; `change` is the delta marker (I/U/D) or null for the
// complete file.
async function streamRakutenFeed(feedPath, onItem) {
  let input = fs.createReadStream(feedPath);
  if (/\.gz$/.test(feedPath)) input = input.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const C = RAKUTEN_COLS;
  let total = 0, withMpn = 0;
  for await (const line of rl) {
    if (!line || line.startsWith('HDR|') || line.startsWith('TRL|')) continue;
    const f = line.split('|');
    const name = (f[C.name] || '').trim();
    const url = (f[C.url] || '').trim();
    if (!name || !url) continue;
    total++;
    const mpn = (f[C.mpn] || '').trim();
    if (mpn) withMpn++;
    const sku = (f[C.sku] || '').trim();
    onItem({
      name,
      mpn,
      sku,
      brand: (f[C.brand] || f[C.manufacturer] || '').trim(),
      price: parseFloat(f[C.salePrice]) || parseFloat(f[C.retailPrice]) || null,
      url: cleanFeedUrl(url),
      // 9S... item numbers are marketplace listings; N82E... (and other
      // non-9S) are sold by Newegg - feeds pickBest's first-party preference.
      seller: /^9S/i.test(sku) ? 'marketplace' : 'newegg',
      inStock: parseStock((f[C.availability] || '').trim()),
      upc: (f[C.upc] || '').trim(),
      change: (f[C.deltaMarker] || '').trim().replace(/\r$/, '') || null,
    });
  }
  return { total, withMpn };
}

module.exports = {
  MID,
  SID,
  COMPLETE_FILE,
  DELTA_FILE,
  RAKUTEN_COLS,
  cleanFeedUrl,
  parseStock,
  connect,
  downloadGz,
  endConnection,
  streamRakutenFeed,
};
