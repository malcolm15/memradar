// Turns a price-fetch run summary's claim_floors field into GitHub issues.
//
// WHY THIS EXISTS. The published-claim monitor has always worked. What did not
// work was the route from its verdict to a person: the result rode the run
// summary into the Actions log and stopped there. On 2026-09-20 it reported
// three breached DDR4 sentences, and the site went on serving them for two
// days because nobody reads a green run's log.
//
// WHY THE ACTIONS JOB AND NOT THE SUPERVISOR. The supervisor Worker already
// opens and closes issues, but it has no database credential and no Supabase
// client, and giving it one would put a fifth secret in a fifth place to read
// a value this job already holds in memory. The absence case the supervisor
// would have covered ("stats never ran") is covered instead by the hour-or-age
// gate plus the freshness alarm it already has on price-fetch.yml.
//
// DRY RUN BY DEFAULT. --confirm creates, comments and closes. Anything else
// prints what it would do and touches nothing, which is how the titles and
// bodies get reviewed before they are ever posted.
//
// THIS SCRIPT MUST NEVER FAIL THE JOB. Every path exits 0. A claim-floor
// breach is a copy problem; failing the price fetch over it would trade a
// wrong sentence for a missing day of prices.
const fs = require('fs');
const { execFileSync } = require('child_process');

const CONFIRM = process.argv.includes('--confirm');
const LABEL = 'claim-floor';
const SUMMARY_PATH = process.env.PRICE_FETCH_SUMMARY_PATH;
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

const titleFor = (state, id) => `[${LABEL}] ${state}: ${id}`;

const gh = (args, input) => execFileSync('gh', args, {
  encoding: 'utf8',
  input,
  env: { ...process.env, GH_PROMPT_DISABLED: '1' },
}).trim();

// ---------------------------------------------------------------------------
// Bodies. Written to be read by someone who has not opened the repo: the
// sentence first, because the sentence is the thing that has to change.
// ---------------------------------------------------------------------------
function figureLines(figures) {
  return (figures || []).map((f) => {
    const cols = [
      `- \`${f.segment}\` [${f.period}]`,
      `full **${f.full_pct}%** (margin ${f.full_margin_pp >= 0 ? '+' : ''}${f.full_margin_pp}pp, n=${f.n})`,
      `stable **${f.stable_pct}%** (margin ${f.stable_margin_pp >= 0 ? '+' : ''}${f.stable_margin_pp}pp, n=${f.stable_n})`,
    ];
    return cols.join(', ');
  });
}

function breachedBody(b, computedAt) {
  return [
    `**This published sentence is no longer supported by the data.**`,
    '',
    `> ${b.sentence}`,
    '',
    `- **Page:** ${b.page}${b.where ? ` (${b.where})` : ''}`,
    `- **Entry id:** \`${b.id}\``,
    `- **Floor:** ${b.floor_pct}%, from ${b.floor_source}`,
    `- **Breached on:** ${(b.breached_on || []).join('; ')}`,
    '',
    '**Figures, both cohorts:**',
    ...figureLines(b.figures),
    '',
    `Market stats computed at \`${computedAt || 'unknown'}\`. Checked on every stats run; see \`claim_floor_runs\` for the history.`,
    '',
    'The fix is to reword the sentence and refloor its registry entry in the same commit, per the registry rule in CLAUDE.md. A claim may also become directional with no magnitude, which needs no floor.',
  ].join('\n');
}

function withdrawnBody(w, computedAt) {
  return [
    `**A generated finding has been withdrawn. Nothing on the site is wrong; a sentence has stopped being published.**`,
    '',
    `> ${w.sentence}`,
    '',
    `- **Page:** ${w.page}${w.where ? ` (${w.where})` : ''}`,
    `- **Entry id:** \`${w.id}\``,
    `- **Why:** ${w.means || w.reason}`,
    '',
    'No cohort figures are listed because the floor could not be resolved: the floor is read off the emitted sentence, and the generator did not emit it.',
    '',
    `Market stats computed at \`${computedAt || 'unknown'}\`.`,
    '',
    'This resolves itself if the data recovers and the finding returns. It is worth an issue once because a claim quietly leaving the site is a change to what MemRadar says, and no other signal reports it.',
  ].join('\n');
}

function resolvedComment(o, computedAt) {
  return [
    'Resolved. This claim now holds on both cohorts.',
    '',
    `- **Entry id:** \`${o.id}\``,
    `- **Floor:** ${o.floor_pct}%${o.floor_source ? `, from ${o.floor_source}` : ''}`,
    `- **Tightest margin:** ${o.min_margin_pp}pp`,
    ...figureLines(o.figures),
    '',
    `Market stats computed at \`${computedAt || 'unknown'}\`. Closing automatically.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
function main() {
  if (!SUMMARY_PATH) return log('PRICE_FETCH_SUMMARY_PATH is not set, so there is no summary to read. Nothing to do.');
  if (!fs.existsSync(SUMMARY_PATH)) return log(`No summary at ${SUMMARY_PATH} (the fetch may have failed before writing it). Nothing to do.`);

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  } catch (err) {
    return log(`⚠ could not parse the summary (${err.message}). Nothing to do.`);
  }

  const cf = summary.claim_floors;
  if (!cf) return log('This run did not reach the published-claim check (market stats were skipped). Nothing to do.');
  if (cf.error) return log(`⚠ the claim-floor check itself failed this run (${cf.error}), so there is no verdict to route. Nothing to do.`);

  // From the summary's own field: the market_stats ROWS do not carry
  // computed_at, so reading it off a row would silently yield undefined.
  const computedAt = summary.market_stats_computed_at || null;
  const breached = cf.breached || [];
  const withdrawn = cf.withdrawn || [];
  const ok = cf.ok || [];
  log(`claim_floors: breached=${breached.length} withdrawn=${withdrawn.length} unresolved=${(cf.unresolved || []).length} ok=${ok.length}`);

  // One list, both states, so dedup needs a single API call. An issue is
  // matched on its EXACT title, which is what makes the entry id the dedup key.
  let existing = [];
  try {
    existing = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '200', '--json', 'number,title,state']));
  } catch (err) {
    return log(`⚠ could not list existing issues (${err.message}). Doing nothing rather than risking duplicates.`);
  }
  const openByTitle = new Map(existing.filter((i) => i.state === 'OPEN').map((i) => [i.title, i]));
  const anyByTitle = new Map(existing.map((i) => [i.title, i]));

  if (CONFIRM && (breached.length || withdrawn.length)) {
    // Idempotent, and `|| true` in spirit: a label that already exists is not
    // an error worth stopping for.
    try { gh(['label', 'create', LABEL, '--color', 'B60205', '--description', 'A published magnitude claim is unsupported or withdrawn', '--force']); }
    catch (err) { log(`label create skipped (${err.message.split('\n')[0]})`); }
  }

  const planned = [];

  // BREACHED: open issues only. A closed issue means someone judged it dealt
  // with; if the breach is still here on the next run, that judgement was
  // wrong and it deserves a fresh issue rather than a comment on a closed one.
  for (const b of breached) {
    const title = titleFor('BREACHED', b.id);
    if (openByTitle.has(title)) { planned.push(`already open  #${openByTitle.get(title).number}  ${title}`); continue; }
    planned.push(`CREATE        ${title}`);
    if (CONFIRM) {
      try {
        const out = gh(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], breachedBody(b, computedAt));
        log(`opened: ${out.split('\n').pop()}`);
      } catch (err) { log(`⚠ could not open an issue for ${b.id} (${err.message.split('\n')[0]})`); }
    } else {
      console.log(`\n----- TITLE: ${title}\n${breachedBody(b, computedAt)}\n----- end`);
    }
  }

  // WITHDRAWN: open OR closed. This one is informational, so once it has been
  // reported and read it must not come back every day the data stays where it
  // is. DDR4 sitting at 98.7% for a month is one issue, not thirty.
  for (const w of withdrawn) {
    const title = titleFor('WITHDRAWN', w.id);
    const seen = anyByTitle.get(title);
    if (seen) { planned.push(`already ${seen.state.toLowerCase().padEnd(6)} #${seen.number}  ${title}`); continue; }
    planned.push(`CREATE        ${title}`);
    if (CONFIRM) {
      try {
        const out = gh(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], withdrawnBody(w, computedAt));
        log(`opened: ${out.split('\n').pop()}`);
      } catch (err) { log(`⚠ could not open an issue for ${w.id} (${err.message.split('\n')[0]})`); }
    } else {
      console.log(`\n----- TITLE: ${title}\n${withdrawnBody(w, computedAt)}\n----- end`);
    }
  }

  // RESOLUTION. Only OPEN issues are ever touched. A claim back in `ok` closes
  // either of its titles, which is how a withdrawn finding that returns closes
  // its own notice.
  for (const o of ok) {
    for (const state of ['BREACHED', 'WITHDRAWN']) {
      const title = titleFor(state, o.id);
      const open = openByTitle.get(title);
      if (!open) continue;
      planned.push(`RESOLVE       #${open.number}  ${title}`);
      if (CONFIRM) {
        try {
          gh(['issue', 'comment', String(open.number), '--body-file', '-'], resolvedComment(o, computedAt));
          gh(['issue', 'close', String(open.number), '--reason', 'completed']);
          log(`closed #${open.number}`);
        } catch (err) { log(`⚠ could not close #${open.number} (${err.message.split('\n')[0]})`); }
      }
    }
  }

  if (!planned.length) log('Nothing to open and nothing to close.');
  else planned.forEach((p) => log(`  ${p}`));
  log(CONFIRM ? 'Done.' : 'DRY RUN - nothing was created, commented or closed. Re-run with --confirm.');
  console.log(`CLAIM_FLOOR_ISSUES ${JSON.stringify({
    confirm: CONFIRM,
    would_create: planned.filter((p) => p.startsWith('CREATE')).length,
    would_resolve: planned.filter((p) => p.startsWith('RESOLVE')).length,
    already_present: planned.filter((p) => p.startsWith('already')).length,
  })}`);
}

// Belt and braces on top of the per-call try/catch: this step is never allowed
// to redden a price-fetch run.
try { main(); } catch (err) {
  console.error(`[${new Date().toISOString()}] claim-floor issue routing failed, deliberately non-fatal: ${err.message}`);
}
process.exit(0);
