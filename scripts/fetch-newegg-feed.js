// Fetch the Newegg product feed from Rakuten's SFTP (Phase 1: manual pull for
// the Gate-1 matching run; Phase 2 will reuse this from the cron).
//
// Rakuten connection facts (from their support docs):
// - Host aftp.linksynergy.com; SFTP recommended over plain FTP (we use SFTP).
// - Feed files are gzipped and must move in BINARY mode. SFTP is inherently
//   binary (ASCII translation is an FTP-protocol concept), and
//   ssh2-sftp-client's fastGet is byte-exact, so this is satisfied by design.
// - Never open more than 5 concurrent connections: this script opens exactly
//   ONE and runs every operation sequentially over it.
// - Expected names for MID 44583 (Newegg) / SID 4705448:
//     complete:  44583_4705448_mp.txt.gz
//     categories: 44583/44583_category_list.txt
//     per-category: 44583/44583_4705448_{categoryID}_cmp.txt.gz
//     delta:     44583_4705448_mp_delta.txt.gz
//
// Behavior: ALWAYS lists the server directory first and reports it (so we see
// what actually exists rather than assuming), then downloads the complete
// product file + the category list, decompresses, and reports sizes, line
// count, and the first 3 lines for column-layout confirmation.
// If an expected file is absent, it reports near-miss names and SKIPS that
// download rather than guessing.
//
// Usage:
//   node scripts/fetch-newegg-feed.js               # list + download + report
//   node scripts/fetch-newegg-feed.js --list-only   # directory listing only
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SftpClient = require('ssh2-sftp-client');

const LIST_ONLY = process.argv.includes('--list-only');
const OUT_DIR = path.join(__dirname, 'output');
const MID = '44583';
const SID = '4705448';
const COMPLETE_FILE = `${MID}_${SID}_mp.txt.gz`;
const CATEGORY_LIST = `${MID}/${MID}_category_list.txt`;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const fmtBytes = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

async function run() {
  const { RAKUTEN_SFTP_HOST, RAKUTEN_SFTP_USER, RAKUTEN_SFTP_PASS } = process.env;
  if (!RAKUTEN_SFTP_HOST || !RAKUTEN_SFTP_USER || !RAKUTEN_SFTP_PASS) {
    throw new Error('RAKUTEN_SFTP_HOST/USER/PASS must be set in .env');
  }
  if (RAKUTEN_SFTP_PASS === 'placeholder_value') {
    throw new Error('RAKUTEN_SFTP_PASS is still the placeholder - paste the real password into .env first');
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sftp = new SftpClient();
  log(`Connecting to ${RAKUTEN_SFTP_HOST} as ${RAKUTEN_SFTP_USER} (single connection, sequential ops)...`);
  await sftp.connect({
    host: RAKUTEN_SFTP_HOST,
    username: RAKUTEN_SFTP_USER,
    password: RAKUTEN_SFTP_PASS,
    readyTimeout: 30000,
    retries: 0, // never hammer a failing login
  });

  try {
    // ---- 1. directory listing FIRST, always reported ----
    const rootList = await sftp.list('/');
    log(`Server root: ${rootList.length} entries`);
    console.log('\n════════ SFTP DIRECTORY LISTING (/) ════════');
    for (const e of [...rootList].sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${e.type === 'd' ? 'DIR ' : 'file'}  ${String(e.size).padStart(12)}  ${new Date(e.modifyTime).toISOString().slice(0, 16)}  ${e.name}`);
    }
    const midDirExists = rootList.some((e) => e.type === 'd' && e.name === MID);
    if (midDirExists) {
      const subList = await sftp.list(`/${MID}`);
      console.log(`\n════════ LISTING (/${MID}) - ${subList.length} entries, first 25 ════════`);
      for (const e of [...subList].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25)) {
        console.log(`  ${e.type === 'd' ? 'DIR ' : 'file'}  ${String(e.size).padStart(12)}  ${new Date(e.modifyTime).toISOString().slice(0, 16)}  ${e.name}`);
      }
      if (subList.length > 25) console.log(`  ... and ${subList.length - 25} more`);
    }
    if (LIST_ONLY) { log('--list-only: stopping after listing.'); return; }

    // ---- 2. complete product file ----
    const completeEntry = rootList.find((e) => e.name === COMPLETE_FILE);
    if (!completeEntry) {
      const near = rootList.filter((e) => /mp.*\.gz$|\.txt\.gz$/i.test(e.name)).map((e) => e.name);
      log(`⚠ ${COMPLETE_FILE} not found on server. Near-miss candidates: ${near.join(', ') || '(none)'} - NOT downloading a guess.`);
    } else {
      const gzPath = path.join(OUT_DIR, COMPLETE_FILE);
      const txtPath = gzPath.replace(/\.gz$/, '');
      log(`Downloading ${COMPLETE_FILE} (${fmtBytes(completeEntry.size)})...`);
      await sftp.fastGet(`/${COMPLETE_FILE}`, gzPath);
      log('Decompressing...');
      fs.writeFileSync(txtPath, zlib.gunzipSync(fs.readFileSync(gzPath)));
      const stat = fs.statSync(txtPath);
      const text = fs.readFileSync(txtPath, 'utf8');
      const lines = text.split('\n').filter((l) => l.length);
      console.log('\n════════ COMPLETE PRODUCT FILE ════════');
      console.log(`  compressed:   ${fmtBytes(completeEntry.size)}  (${gzPath})`);
      console.log(`  uncompressed: ${fmtBytes(stat.size)}  (${txtPath})`);
      console.log(`  lines: ${lines.length}`);
      console.log('  first 3 lines (header + 2 rows):');
      lines.slice(0, 3).forEach((l, i) => console.log(`    [${i}] ${l.slice(0, 400)}`));
    }

    // ---- 3. category list ----
    const catExists = midDirExists && (await sftp.exists(`/${CATEGORY_LIST}`));
    if (!catExists) {
      log(`⚠ /${CATEGORY_LIST} not found - skipping (see /${MID} listing above for what exists).`);
    } else {
      const catPath = path.join(OUT_DIR, `${MID}_category_list.txt`);
      await sftp.fastGet(`/${CATEGORY_LIST}`, catPath);
      const catText = fs.readFileSync(catPath, 'utf8');
      const catLines = catText.split('\n').filter((l) => l.trim().length);
      console.log('\n════════ CATEGORY LIST ════════');
      console.log(`  ${catLines.length} lines (${catPath})`);
      catLines.slice(0, 30).forEach((l) => console.log(`    ${l.slice(0, 120)}`));
      if (catLines.length > 30) console.log(`    ... and ${catLines.length - 30} more`);
    }
  } finally {
    await sftp.end();
    log('Connection closed.');
  }
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
