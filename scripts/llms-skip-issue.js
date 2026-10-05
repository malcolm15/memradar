// Did llms.txt actually rebuild? The rung below this one asks whether the regen
// ran; this asks whether one of its outputs was silently left behind.
//
// WHY IT EXISTS. On 2026-10-04 the llms.txt build began throwing, its try/catch
// logged a warning, the generator exited 0, and the file sat a day stale through
// two consecutive regens with every check green. The warning was the only trace
// and it lives in a log that expires with the 90-day Actions retention.
//
// N = 2, DELIBERATELY NOT 1. One skip is self-healing: the next regen rebuilds
// the file, and meanwhile llms.txt is stale but still attributable to the build
// that wrote it, which is the residual the try/catch was written to accept. Two
// consecutive means it is not healing. The expected rate is zero, not the stats
// gate's one-in-eighteen, so N=2 is not noisy, and N=1 would fire on a transient
// such as a sitemap read racing the write. The counter-argument is real: with an
// expected rate of zero, any skip is a fault. It matters less than it looks,
// because the cross-location claim check now compares the computed date and
// surfaces a frozen llms.txt as a breach on the next compute. This is the belt
// to that braces, and it names the actual cause where the breach can only say
// the two locations disagree.
//
// DEDUP IS PER STREAK, NOT PER DATE. A multi-day freeze is one fault and gets
// one issue; recovery closes it, which is why the streak resets in the same run
// that succeeds.
//
// EXITS 0 ON EVERY PATH, and WRITES A result LINE TO $GITHUB_OUTPUT ON EVERY
// PATH, so the llms object always reaches the job SUMMARY. A summary field that
// is present only on the interesting paths is a field you cannot trust when it
// is absent, which is the whole lesson of this incident.
const fs = require('fs');
const { execFileSync } = require('child_process');

const CONFIRM = process.argv.includes('--confirm');
const LABEL = 'llms-freshness';
const THRESHOLD = 2;
const TITLE_PREFIX = '[llms] llms.txt has not rebuilt';
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input }).trim();
const titleFor = (streak) => `${TITLE_PREFIX} for ${streak} consecutive regens`;

// ONE valid single-line JSON object, always, then exit 0.
function emit(result) {
  const line = JSON.stringify(result);
  console.log(`LLMS_CHECK ${line}`);
  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${line}\n`);
    } catch (e) {
      log(`could not write to GITHUB_OUTPUT (${e.message})`);
    }
  }
  process.exit(0);
}

function readLlmsSource() {
  if (process.env.LLMS_SOURCE_JSON) {
    try {
      return { src: JSON.parse(process.env.LLMS_SOURCE_JSON), from: 'LLMS_SOURCE_JSON' };
    } catch (e) {
      return { src: undefined, from: 'LLMS_SOURCE_JSON', parseError: e.message };
    }
  }
  const p = process.env.REGEN_LOG;
  if (!p || !fs.existsSync(p)) return { src: undefined, from: p || '(unset)' };
  const line = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.startsWith('LLMS_SOURCE ')).pop();
  if (!line) return { src: undefined, from: p };
  try {
    return { src: JSON.parse(line.slice('LLMS_SOURCE '.length)), from: p };
  } catch (e) {
    return { src: undefined, from: p, parseError: e.message };
  }
}

function openIssues() {
  try {
    return JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', LABEL,
      '--json', 'number,title', '--limit', '50']));
  } catch (e) {
    log(`could not list issues (${e.message})`);
    return null;
  }
}

const { src, from, parseError } = readLlmsSource();

// AN ABSENT LINE SAYS NOTHING, which is not the same as saying it is fine. The
// generator prints LLMS_SOURCE on every --confirm run, so its absence means the
// run never reached that block: the job is already red, and a second notice
// about a visibly failed run is noise. Same reasoning as an absent STATS_SOURCE.
if (!src) {
  log(`no LLMS_SOURCE line in ${from}${parseError ? ` (${parseError})` : ''}. The run did not reach the llms.txt block, so the job is already failing. Nothing to do.`);
  emit({ written: null, streak: null, issue: null, skipped: 'no LLMS_SOURCE line' });
}

const streak = src.consecutive_skips;

if (src.written) {
  log('llms.txt rebuilt this run.');
  const open = openIssues();
  const closed = [];
  if (open && open.length) {
    for (const i of open) {
      if (!CONFIRM) { log(`WOULD CLOSE #${i.number}: ${i.title}`); closed.push(i.number); continue; }
      try {
        gh(['issue', 'close', String(i.number), '--comment',
          'llms.txt rebuilt successfully, so the streak is reset. Closed automatically.']);
        log(`closed #${i.number}`);
        closed.push(i.number);
      } catch (e) { log(`could not close #${i.number} (${e.message})`); }
    }
  }
  emit({ written: true, streak: 0, issue: null, closed: closed.length ? closed : null });
}

log(`llms.txt NOT rebuilt: ${src.reason || '(no reason recorded)'}  consecutive skips: ${streak}`);

// A null streak means the bot_state read or write failed. Unknown, not 1:
// guessing low would suppress a real second skip.
if (streak == null) {
  log('the skip streak could not be read, so whether this is the first or the second is unknown. Not opening an issue; the warning is in the log.');
  emit({ written: false, streak: null, issue: null, skipped: 'streak unknown' });
}
if (streak < THRESHOLD) {
  log(`first skip of a streak (threshold ${THRESHOLD}). Recorded here and in the job SUMMARY, no issue. The next regen rebuilds it, or this becomes an issue.`);
  emit({ written: false, streak, issue: null, skipped: `below threshold ${THRESHOLD}` });
}

const title = titleFor(streak);
const body = [
  `\`llms.txt\` has failed to rebuild on **${streak} consecutive regens**. The last good copy is still being served, so its dated findings remain attributable to that build, but current prices, counts and computed dates may be stale.`,
  '',
  `**Reason reported by the generator:** \`${src.reason || '(none)'}\``,
  '',
  'The build is wrapped so an llms.txt failure cannot take a day of prices with it, which is correct and is why this is an issue rather than a red run.',
  '',
  'What to check, in order:',
  '- the two pinned example SKUs in `LLMS_EXAMPLE_SKUS` are still in the catalog, indexable and in the sitemap',
  '- `exampleFromProduct()` has the fields it needs on the build object',
  '- the `/data/` findings and the monthly CSV bounds both built this run',
  '',
  'Closes itself on the first regen that rebuilds the file.',
].join('\n');

const open = openIssues();
if (open === null) emit({ written: false, streak, issue: null, skipped: 'could not list issues' });
// PER STREAK: an issue already open for this streak is the same fault.
if (open.some((i) => i.title.startsWith(TITLE_PREFIX))) {
  log('an issue is already open for this streak. Not opening another.');
  emit({ written: false, streak, issue: 'already open', skipped: 'deduped per streak' });
}
if (!CONFIRM) {
  console.log(`\n----- WOULD CREATE\nTITLE: ${title}\nLABEL: ${LABEL}\n\n${body}\n----- end`);
  emit({ written: false, streak, issue: 'would create', skipped: 'dry run' });
}
let created = null;
try {
  created = gh(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], body);
  log(`opened ${created}`);
} catch (e) {
  log(`could not open the issue (${e.message}); the warning is in the log`);
}
emit({ written: false, streak, issue: created || 'create failed' });
