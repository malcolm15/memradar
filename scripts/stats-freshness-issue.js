// Did the consumer get today's figures?
//
// The regen bakes market_stats into /price-index/, /data/, /llms.txt, both
// guides and /methodology/. Those pages print the date their figures were
// computed, so a stale build is never FALSE - it is older than the cadence copy
// implies, which is a different and quieter problem. Nothing reported it.
//
// THE FAILURE THIS EXISTS FOR, 2026-09-23: the stats gate had drifted to the
// afternoon, the regen ran at 14:09, and /data/ went live reading "Computed
// September 22" under a page stamped "last regenerated September 23". Every
// existing check was green: the job ran, it produced output, and the
// claim-floor verdict inside it reached a human. None of them asks whether the
// data the build consumed was current.
//
// IT READS THE GENERATOR'S OWN STATS_SOURCE LINE, not a fresh query. A separate
// query would answer a question the generator answers again seconds later, and
// it is the generator's read that gets baked into the pages. A check that
// passes while the build used something else is a check that passes for the
// wrong reason.
//
// THE BUILD IS NEVER BLOCKED. Stale-but-dated pages are the accepted residual;
// refusing to publish a day's prices over them would trade a small, disclosed
// staleness for a large, undisclosed one. This opens an issue and gets out of
// the way.
//
// EXITS 0 ON EVERY PATH. A freshness notice must not redden a regen.
const fs = require('fs');
const { execFileSync } = require('child_process');

const CONFIRM = process.argv.includes('--confirm');
const LABEL = 'stats-freshness';
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input }).trim();
const titleFor = (date) => `[stats] no compute on ${date}`;

// Parsed from a log file, or from STATS_SOURCE_JSON for a dry run against a
// fabricated line. The generator prints exactly one such line per --confirm run.
function readStatsSource() {
  if (process.env.STATS_SOURCE_JSON) {
    return { src: JSON.parse(process.env.STATS_SOURCE_JSON), from: 'STATS_SOURCE_JSON' };
  }
  const path = process.env.REGEN_LOG;
  if (!path || !fs.existsSync(path)) return { src: undefined, from: path || '(unset)' };
  const line = fs.readFileSync(path, 'utf8').split('\n').filter((l) => l.startsWith('STATS_SOURCE ')).pop();
  if (!line) return { src: undefined, from: path };
  try {
    return { src: JSON.parse(line.slice('STATS_SOURCE '.length)), from: path };
  } catch (err) {
    return { src: undefined, from: `${path} (unparsable: ${err.message})` };
  }
}

function body(src, today) {
  const stale = src.computed_at
    ? `The most recent \`market_stats\` row this build could see was computed **${src.computed_at}**, ${((Date.now() - new Date(src.computed_at).getTime()) / 3600000).toFixed(1)} hours before the build read it.`
    : `**\`market_stats\` was unreadable or empty when this build read it**${src.error ? ` (\`${src.error}\`)` : ''}, so the Price Index was not regenerated at all and every page below kept its previous figures. This is worse than stale figures and worth looking at first.`;
  return [
    src.computed_at
      ? `**The regen on ${today} (UTC) built from figures that were not computed today.**`
      : `**The regen on ${today} (UTC) could not read market_stats at all.**`,
    '',
    stale,
    '',
    'Pages built from those figures:',
    '- `/price-index/`',
    '- `/data/` and `/llms.txt` (the findings, including their "Computed" dates)',
    '- `/guides/should-i-buy-ram-now/` and `/guides/should-i-buy-an-ssd-now/`',
    '- `/methodology/`',
    '',
    '**Nothing on those pages is false.** Each prints the date its figures were computed, so a reader sees the real date. What is wrong is that the cadence copy says daily and this day was not.',
    '',
    `Rows the build saw: ${src.rows}. Run: ${process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '(not an Actions run)'}`,
    '',
    'Expected rate is roughly one day in eighteen, from the 08:00 slot being dropped entirely. **A materially higher rate is evidence against the stats-gate simulation**, not just bad luck, and should be treated as such.',
    '',
    'Closed by hand. This issue is never reopened and a later run on the same date will not open a second one.',
  ].join('\n');
}

function main() {
  const { src, from } = readStatsSource();
  const today = new Date().toISOString().slice(0, 10);

  if (src === undefined) {
    // No line at all means the generator never reached its market_stats read,
    // which means the build failed earlier and the job is already red. Saying
    // nothing here is right: a second notice about a run that visibly failed
    // is noise.
    return log(`no STATS_SOURCE line found in ${from} - the build did not reach its market_stats read, so the run has already failed loudly. Nothing to do.`);
  }
  log(`STATS_SOURCE: computed_date=${src.computed_date} rows=${src.rows}${src.error ? ` error=${src.error}` : ''} | today=${today}`);

  if (src.computed_date === today) {
    return log(`the build read figures computed today (${today}). Nothing to do.`);
  }

  const title = titleFor(today);
  let existing = [];
  try {
    existing = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '100', '--json', 'number,title,state']));
  } catch (err) {
    return log(`⚠ could not list existing issues (${err.message.split('\n')[0]}). Doing nothing rather than risking a duplicate.`);
  }
  // OPEN AND CLOSED BOTH SUPPRESS. The title carries the date, so one missed
  // day gets exactly one issue for all time: re-running the regen for that day
  // cannot produce a second, and closing it by hand is final.
  const seen = existing.find((i) => i.title === title);
  if (seen) {
    return log(`already reported: #${seen.number} [${seen.state}] ${title}. Nothing to do.`);
  }

  const text = body(src, today);
  if (!CONFIRM) {
    console.log(`\n----- WOULD CREATE\nTITLE: ${title}\nLABEL: ${LABEL}\n\n${text}\n----- end`);
    return log('DRY RUN - nothing created. Re-run with --confirm.');
  }
  try {
    // The label may not exist yet on a fresh repo; create it only when absent,
    // for the same reason price-fetch.yml does (an error-shaped line in a
    // healthy log teaches people to skim past error-shaped lines).
    const labels = JSON.parse(gh(['label', 'list', '--search', LABEL, '--json', 'name']));
    if (!labels.some((l) => l.name === LABEL)) {
      gh(['label', 'create', LABEL, '--color', 'FBCA04', '--description', 'A regen built from figures not computed that day']);
    }
  } catch (err) {
    log(`label check skipped (${err.message.split('\n')[0]})`);
  }
  try {
    const out = gh(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], text);
    log(`opened: ${out.split('\n').pop()}`);
  } catch (err) {
    log(`⚠ could not open the issue (${err.message.split('\n')[0]})`);
  }
}

try { main(); } catch (err) {
  console.error(`[${new Date().toISOString()}] stats-freshness check failed, deliberately non-fatal: ${err.message}`);
}
process.exit(0);
