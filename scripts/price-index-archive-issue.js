// Routes price-index archive alarms from the regen log to a GitHub issue.
//
// WHY A SEPARATE SCRIPT RATHER THAN gh FROM THE GENERATOR. The generator has no
// GitHub token and no business having one, and this is the shape the repo
// already uses: scripts/stats-freshness-issue.js reads the generator's own log
// line rather than asking the database the same question again. A check that
// reports something other than what the build did is a check that passes for
// the wrong reason.
//
// IT READS PRICE_INDEX_ALARM_JSON lines, which the freeze and the drift check
// emit. Four kinds:
//   incomplete     a month holds 1 to 3 records, duplicate keys, or metadata
//                  that disagrees between segments. The file was left untouched.
//   build_failed   a freshly built month did not validate, so nothing landed.
//   drift          a complete frozen month now recomputes differently. The
//                  stored records stand; nothing was changed.
//   corrections_invalid
//                  corrections[] on disk fails validation (a malformed or
//                  inconsistent entry). Nothing was frozen and nothing changed.
//   missing_archive / threw
//
// EXITS 0 ON EVERY PATH. An archive alarm must not redden a regen: the day's
// prices are published either way, and a frozen record that needs a human is
// not a reason to withhold them.
const fs = require('fs');
const { execFileSync } = require('child_process');

const CONFIRM = process.argv.includes('--confirm');
const LABEL = 'price-index-archive';
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input }).trim();

function readAlarms() {
  if (process.env.PRICE_INDEX_ALARMS_JSON) {
    return [JSON.parse(process.env.PRICE_INDEX_ALARMS_JSON)];
  }
  const from = process.env.REGEN_LOG;
  if (!from || !fs.existsSync(from)) {
    log(`no regen log at ${from || '(REGEN_LOG unset)'} - nothing to read.`);
    return null;
  }
  const out = [];
  for (const line of fs.readFileSync(from, 'utf8').split('\n')) {
    const i = line.indexOf('PRICE_INDEX_ALARM_JSON ');
    if (i < 0) continue;
    try { out.push(JSON.parse(line.slice(i + 'PRICE_INDEX_ALARM_JSON '.length))); }
    catch (err) { log(`⚠ could not parse an alarm line: ${err.message}`); }
  }
  return out;
}

// ONE TITLE PER (kind, month), so a condition that persists across regens gets
// exactly one issue for all time. Drift has no single month, so it is keyed on
// the sorted list of affected records: a new record joining the drift opens a
// new issue, which is the behaviour worth having.
function titleFor(a) {
  if (a.kind === 'drift') {
    const which = (a.drifted || []).map((d) => `${d.segment} ${d.month}`).sort().join(', ');
    return `[price-index] frozen record drift: ${which || a.count + ' record(s)'}`;
  }
  if (a.kind === 'missing_archive') return '[price-index] archive file missing';
  return `[price-index] ${a.kind} for ${a.month}`;
}

function bodyFor(a) {
  const lines = [];
  if (a.kind === 'drift') {
    lines.push('A **complete frozen month now recomputes differently**. The stored records were left exactly as published and nothing was changed.');
    lines.push('');
    lines.push('| segment | month | field | stored | recomputed |');
    lines.push('|---|---|---|---|---|');
    for (const d of a.drifted || []) {
      for (const x of d.diffs) lines.push(`| ${d.segment} | ${d.month} | ${x.field} | ${x.stored} | ${x.recomputed} |`);
    }
    if (a.count > (a.drifted || []).length) lines.push('', `(${a.count} records drifted in total; the first ${(a.drifted || []).length} are listed.)`);
    lines.push('');
    lines.push('**What causes this.** Every cause is an input being destroyed or rewritten, not the metric changing:');
    lines.push('');
    lines.push('- a re-run of `scripts/backfill-keepa.js --confirm`, which deletes a product\'s whole history before reinserting it (`scripts/backfill-keepa.js:137`);');
    lines.push('- a deleted `products` row, which cascades to its price history (`backend/schema.sql:22`);');
    lines.push('- an edited product name or capacity, which is what `classifySegment` reads;');
    lines.push('- a change to the metric rule itself, which would need a new `metric_version`.');
    lines.push('');
    lines.push('**What to do.** Decide whether the published figure was wrong. If it was, append a correction with its complete replacement record; the original stays as published. If the recomputation is the wrong one, the stored record already stands and this issue can be closed.');
  } else if (a.kind === 'incomplete' || a.kind === 'build_failed') {
    lines.push(`The monthly freeze found **${a.month} in an inconsistent state** and wrote nothing. The archive file was left untouched.`);
    lines.push('');
    lines.push(`> ${a.why}`);
    lines.push('');
    lines.push('A month is eligible to freeze only at 0 of 4 segment records, and is skipped at exactly 4 with consistent metadata. Anything in between means something wrote a partial month.');
    lines.push('');
    lines.push('**This is deliberately not self-repairing.** Rebuilding the month would mean guessing which of two disagreeing records is the one that was published.');
  } else if (a.kind === 'corrections_invalid') {
    lines.push('The archive\'s **corrections[] failed validation**, so the freeze wrote nothing and the drift check was skipped. The file was left untouched.');
    lines.push('');
    lines.push(`> ${a.why}`);
    lines.push('');
    lines.push('Every entry must carry exactly: date, segment, month, field, original, revised, reason, commit, and a complete inline replacement record including its pairs. `original` must equal the published value still stored under records[], and `revised` must equal the same field on the replacement. Version 1 accepts inline replacement records only.');
  } else if (a.kind === 'missing_archive') {
    lines.push(`\`${a.path}\` does not exist, so no month can be frozen.`);
    lines.push('');
    lines.push('Run the one-time launch backfill once: `node scripts/build-price-index-archive.js --at=<iso> --write`.');
  } else {
    lines.push(`The freeze or drift check threw, which it is written not to do. The regen continued and published the day's prices.`);
    lines.push('');
    lines.push(`> ${a.why || '(no message)'}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('Opened by `scripts/price-index-archive-issue.js` from the regen log. Deduped on the title, open or closed.');
  return lines.join('\n');
}

function main() {
  const alarms = readAlarms();
  if (alarms == null) return;
  if (!alarms.length) return log('no price-index archive alarms in this run. Nothing to do.');
  log(`${alarms.length} alarm(s) found: ${alarms.map((a) => a.kind).join(', ')}`);

  let existing = [];
  try {
    existing = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '100', '--json', 'number,title,state']));
  } catch (err) {
    return log(`⚠ could not list existing issues (${err.message.split('\n')[0]}). Doing nothing rather than risking a duplicate.`);
  }

  if (CONFIRM) {
    try {
      const labels = JSON.parse(gh(['label', 'list', '--search', LABEL, '--json', 'name']));
      if (!labels.some((l) => l.name === LABEL)) {
        gh(['label', 'create', LABEL, '--color', 'B60205', '--description', 'A frozen Price Index record is incomplete, inconsistent or has drifted']);
      }
    } catch (err) {
      log(`label check skipped (${err.message.split('\n')[0]})`);
    }
  }

  for (const a of alarms) {
    const title = titleFor(a);
    // OPEN AND CLOSED BOTH SUPPRESS, the same rule as stats-freshness-issue.js:
    // closing one by hand is a decision, and a later regen must not undo it.
    const seen = existing.find((i) => i.title === title);
    if (seen) { log(`already reported: #${seen.number} [${seen.state}] ${title}`); continue; }
    const text = bodyFor(a);
    if (!CONFIRM) {
      console.log(`\n----- WOULD CREATE\nTITLE: ${title}\nLABEL: ${LABEL}\n\n${text}\n----- end`);
      continue;
    }
    try {
      const out = gh(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], text);
      log(`opened: ${out.split('\n').pop()}`);
    } catch (err) {
      log(`⚠ could not open the issue (${err.message.split('\n')[0]})`);
    }
  }
  if (!CONFIRM) log('DRY RUN - nothing created. Re-run with --confirm.');
}

try { main(); } catch (err) {
  console.error(`[${new Date().toISOString()}] price-index archive check failed, deliberately non-fatal: ${err.message}`);
}
process.exit(0);
