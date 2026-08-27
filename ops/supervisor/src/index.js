/**
 * MemRadar scheduled-workflow supervisor. STAGE 1: READ-ONLY ALERTING.
 *
 * WHY THIS EXISTS
 * On 2026-08-27 five scheduled slots across two workflows were never created by
 * GitHub at all: no run record, nothing queued, nothing cancelled, no published
 * incident covering the window. The repo is public so Actions minutes cannot
 * gate it, and no concurrency group covers any scheduled workflow. The failure
 * is upstream of run creation, which means the only way to notice it is to ask
 * from outside GitHub whether the work actually happened.
 *
 * WHAT IT DOES NOT DO
 * No dispatch. No self-healing. No workflow triggering of any kind. The token
 * is provisioned Actions:read, so stage 1 cannot start a workflow even if a
 * future edit tried to. Do not add a dispatch call here without re-scoping the
 * token deliberately and separately.
 *
 * KEYING: (workflow file, job id), NEVER workflow file alone.
 * newegg-refresh.yml carries two crons gating two different jobs, and a run
 * where one job succeeds and its sibling is `skipped` reports run-level
 * conclusion `success`. On 2026-08-27 the 06:00 job succeeded while the 09:00
 * regen was never created, and workflow-level freshness would have called that
 * file healthy. Verified empirically before this was written: the Actions API
 * reports job `name` equal to the YAML job id for all four watched jobs (no
 * job sets a `name:` override), so the config strings below are exact.
 *
 * DEPLOY BY HAND: cd ops/supervisor && npx wrangler deploy
 * Never from GitHub Actions. See README.md.
 */

const OWNER = 'malcolm15';
const REPO = 'memradar';
const ALERT_LABEL = 'supervisor-alert';
const UA = 'memradar-supervisor';

// Belt-and-braces ceiling on jobs-endpoint calls per watched pair. The real
// bound is the max_age horizon in findLastSuccess(); this only catches a
// pathological config (e.g. someone sets a per-minute cron) and is not
// expected to bind. If it ever does, the verdict says so rather than
// silently reporting a shorter scan.
const HARD_RUN_CAP = 40;

// ---------------------------------------------------------------------------
// CONFIG: the single source of truth for what is watched.
//
// max_age_hours = interval_hours + (p95_minutes / 60) + margin_hours
//
// That arithmetic is ASSERTED at tick time by assertConfigArithmetic(). The
// assertion exists so a future session cannot retune a threshold by taste: to
// change max_age_hours you must change one of the three inputs and say why.
//
// The p95 figures come from the healthy period only, meaning every scheduled
// slot whose nominal time is strictly before 2026-08-26 20:00 UTC, which is
// when this repo's scheduling degraded. Delays are nominal-slot to actual
// run creation, in minutes.
//
// The MARGIN differs per pair on purpose. A uniform margin was measured
// against the real 2026-08-26/27 degradation and rejected: at one full
// interval the daily jobs need ~48h to alert, so the missed 09:00 regen would
// not have surfaced until ~25h after the miss, which is slower than noticing
// by hand and makes the supervisor decorative for the failure it was built
// for. Margin is therefore sized by how much staleness each job can absorb
// before the site says something untrue.
// ---------------------------------------------------------------------------
const WATCH = [
  {
    workflow_file: 'price-fetch.yml',
    job_id: 'fetch-prices',
    cron: '0 */4 * * *',
    interval_hours: 4,
    p95_minutes: 58.6, // n=28
    margin_hours: 4, // 1.00x interval
    max_age_hours: 8.98, // 4 + 0.977 + 4 = 8.977
    // MARGIN 1.00x: one missed 4h slot is genuinely fine, the next is 4h away
    // and the PDP hydration layer shows a relative timestamp. Two consecutive
    // misses is the ~9h-stale state cleared by hand on 2026-08-27, which is
    // worth an issue. 8.98h tolerates exactly one miss and catches two.
  },
  {
    workflow_file: 'newegg-refresh.yml',
    job_id: 'refresh-offers',
    cron: '0 6 * * *',
    interval_hours: 24,
    p95_minutes: 34.8, // n=6
    margin_hours: 12, // 0.50x interval
    max_age_hours: 36.58, // 24 + 0.580 + 12 = 36.58
    // MARGIN 0.50x: Newegg offers move slowly and refresh-newegg-offers.js
    // already carries a 9-day staleness net, so this is the least urgent of
    // the three data jobs. But that net is an in-app fallback, not an alert,
    // and 48h would be two full days of no refresh with no signal. 12h still
    // tolerates one clean miss.
  },
  {
    workflow_file: 'newegg-refresh.yml',
    job_id: 'regenerate-pages',
    cron: '0 9 * * *',
    interval_hours: 24,
    p95_minutes: 49.0, // n=1 -- see REVISIT note below
    margin_hours: 6, // 0.25x interval
    max_age_hours: 30.82, // 24 + 0.817 + 6 = 30.817
    // MARGIN 0.25x, the tightest on the board and deliberately so. Per
    // CLAUDE.md the guides and Price Index ARGUE from baked values, rank
    // products, print their own build date and tell the reader they update
    // automatically. A stale build is therefore a page making a false claim
    // about itself, which makes a single miss already a correctness problem
    // rather than a latency problem. 30.82h alerts the same day it happens.
  },
  {
    workflow_file: 'bluesky-posts.yml',
    job_id: 'post',
    cron: '0 17 * * *',
    interval_hours: 24,
    p95_minutes: 112.0, // n=1 -- see REVISIT note below
    margin_hours: 24, // 1.00x interval
    max_age_hours: 49.87, // 24 + 1.867 + 24 = 49.867
    // MARGIN 1.00x, the most tolerant entry. A missed Bluesky post is
    // invisible and harmless; the bot's whole design principle is that
    // silence beats a wrong post. The wide margin also absorbs the fact that
    // this p95 is a single observation.
    //
    // KNOWN AND ACCEPTED COVERAGE HOLE -- do not "fix" this with a cleverer
    // scan. bluesky-posts.yml has ONE job (`post`) on TWO crons, and the
    // daily/weekly split is made inside a step ("Resolve mode and dry-run"),
    // not by a job gate. So freshness on `post` observes the DAILY cron only.
    // The Sunday pulse ('0 18 * * 0') could stop firing indefinitely without
    // producing any signal here, because a daily-drop success satisfies the
    // same (file, job) key. Accepted because this is the least consequential
    // job on the board. If the weekly ever carries real weight, the fix is a
    // distinct marker written by the weekly path (a separate job id, or a
    // bot_state key the supervisor reads), NOT a smarter run scan -- no scan
    // can separate two crons that land on one job id.
  },
];

// REVISIT 2026-09-10 (two weeks out): the p95 for `regenerate-pages` and for
// `post` each rest on n=1, because both were created on 2026-08-26 and had
// exactly one healthy-period occurrence before scheduling degraded. Those two
// numbers are single observations wearing a percentile label. By that date
// there should be a real distribution to fit; recompute all four p95 values
// from the healthy history then and update margin reasoning if the shape
// disagrees with the assumptions above.

// ---------------------------------------------------------------------------

function assertConfigArithmetic() {
  const problems = [];
  for (const e of WATCH) {
    const derived = e.interval_hours + e.p95_minutes / 60 + e.margin_hours;
    // Tolerance covers max_age_hours being written rounded to 2dp.
    if (Math.abs(derived - e.max_age_hours) > 0.01) {
      problems.push(
        `${e.workflow_file}/${e.job_id}: max_age_hours=${e.max_age_hours} but ` +
          `interval(${e.interval_hours}) + p95(${e.p95_minutes}m=${(e.p95_minutes / 60).toFixed(3)}h) + ` +
          `margin(${e.margin_hours}) = ${derived.toFixed(3)}`
      );
    }
  }
  if (problems.length) {
    throw new Error(
      'supervisor config arithmetic does not hold. A threshold was retuned ' +
        'without changing its inputs:\n  ' + problems.join('\n  ')
    );
  }
}

// ---------------------------------------------------------------------------
// GitHub client
// ---------------------------------------------------------------------------

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA,
  };
}

// Best-effort ETag cache. Conditional requests that return 304 do not count
// against the rate limit. This lives in module scope, so it survives only as
// long as the isolate does -- a cold start simply does full fetches.
// CORRECTNESS DOES NOT DEPEND ON IT: 304 means the cached body is still
// current by definition, and a cache miss is just a normal request.
const etagCache = new Map();

async function ghRequest(token, path, { method = 'GET', body = null, conditional = false } = {}) {
  const url = `https://api.github.com${path}`;
  const headers = ghHeaders(token);
  const cached = conditional && method === 'GET' ? etagCache.get(url) : null;
  if (cached) headers['If-None-Match'] = cached.etag;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // Do not let the Workers runtime interpose its own cache. The API sends
    // `cache-control: private, max-age=60`; we want every tick to ask.
    cache: 'no-store',
  });

  if (res.status === 304 && cached) return cached.body;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} ${method} ${path}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;

  const parsed = await res.json();
  const etag = res.headers.get('etag');
  if (conditional && method === 'GET' && etag) etagCache.set(url, { etag, body: parsed });
  return parsed;
}

// ---------------------------------------------------------------------------
// Freshness: most recent SUCCESSFUL run of one job id, bounded.
// ---------------------------------------------------------------------------

// Size the page to the window rather than fetching 100 rows to use three.
// x2 because a file's sibling jobs produce runs in the same list (newegg-refresh
// has two crons), +6 slack for manual dispatches.
function runsPerPage(entry) {
  const inWindow = Math.ceil(entry.max_age_hours / entry.interval_hours);
  return Math.min(HARD_RUN_CAP, inWindow * 2 + 6);
}

async function findLastSuccess(token, entry, nowMs) {
  const horizonMs = nowMs - entry.max_age_hours * 3600 * 1000;
  const perPage = runsPerPage(entry);

  // The runs endpoint accepts the workflow FILE NAME directly, so config needs
  // no numeric workflow id to drift out of sync.
  //
  // Deliberately NOT using ?status=success: that filters on RUN conclusion,
  // which is the wrong granularity. A newegg-refresh run where refresh-offers
  // succeeded and regenerate-pages was skipped reports run-level `success`,
  // and a run where the job we care about succeeded alongside a failing
  // sibling would be hidden by the filter.
  const list = await ghRequest(
    token,
    `/repos/${OWNER}/${REPO}/actions/workflows/${entry.workflow_file}/runs?per_page=${perPage}`,
    { conditional: true }
  );

  const runs = list?.workflow_runs || [];
  let examined = 0;
  let hitHorizon = false;

  for (const run of runs) {
    if (examined >= HARD_RUN_CAP) break;

    // THE BOUND. Stop as soon as a run predates the freshness window. The
    // question is not "when did this job last succeed" but "did it succeed
    // inside the window", and not-found and found-too-old are the same
    // verdict. Without this, a job that has never succeeded (or whose id was
    // renamed in config) walks the entire run history every tick, forever,
    // getting slower exactly as the incident gets worse.
    if (Date.parse(run.created_at) < horizonMs) {
      hitHorizon = true;
      break;
    }

    examined++;
    const jobsRes = await ghRequest(token, `/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=50`);
    const job = (jobsRes?.jobs || []).find((j) => j.name === entry.job_id);

    // Only `success` counts. `cancelled` is explicitly NOT a success:
    // deploy-frontend.yml uses `concurrency: group: pages` with
    // cancel-in-progress: true, so a cancelled run is silent today, and
    // treating it as fresh would hide exactly that.
    if (job && job.conclusion === 'success') {
      return {
        found: true,
        examined,
        page_exhausted: false,
        run_id: run.id,
        created_at: run.created_at,
        // Triggering event is recorded so cron-death is distinguishable from
        // job-failure when reading the alert months later. A manual recovery
        // legitimately clears the alert (freshness measures whether the work
        // happened), but we want to SEE that it was manual.
        event: run.event,
        html_url: run.html_url,
        job_conclusion: job.conclusion,
      };
    }
  }

  // If the page ran out before the horizon did, the scan was cut short by page
  // size rather than by the window. Report it instead of silently returning a
  // shorter answer -- a check that degrades quietly is worse than no check.
  const pageExhausted = !hitHorizon && runs.length >= perPage && examined >= runs.length;

  return { found: false, examined, page_exhausted: pageExhausted };
}

async function evaluateFreshness(token, nowMs) {
  const results = [];
  for (const entry of WATCH) {
    const key = `${entry.workflow_file} / ${entry.job_id}`;
    const last = await findLastSuccess(token, entry, nowMs);
    const ageHours = last.found ? (nowMs - Date.parse(last.created_at)) / 3600000 : null;
    results.push({
      key,
      workflow_file: entry.workflow_file,
      job_id: entry.job_id,
      cron: entry.cron,
      max_age_hours: entry.max_age_hours,
      stale: !last.found,
      age_hours: ageHours === null ? null : Number(ageHours.toFixed(2)),
      last_success: last.found
        ? {
            run_id: last.run_id,
            created_at: last.created_at,
            event: last.event,
            html_url: last.html_url,
          }
        : null,
      runs_examined: last.examined,
      page_exhausted: last.page_exhausted,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Config self-audit: does the hand-assembled WATCH array still cover reality?
//
// Direction matters. The workflows are the source of truth and the array is
// the thing under suspicion, because a workflow change ships through git and
// registers instantly while a config change needs a manual `wrangler deploy`.
// The two can never be atomic, so the DEFAULT outcome of adding a cron is that
// it is unwatched, silently, forever.
//
// LIMIT, stated plainly: this proves COVERAGE, not CORRECTNESS. It cannot tell
// you a max_age_hours is wrong, and it cannot see the bluesky weekly hole
// documented above, because '0 18 * * 0' does map to a job that IS in the
// array. It answers exactly one question: is there an active cron whose jobs
// nobody is watching.
// ---------------------------------------------------------------------------

function b64utf8(s) {
  const bin = atob(String(s).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Narrow line-based parse. A real YAML parser would be a dependency in a Worker
// whose value is being dependency-free and auditable. Both patterns are anchored
// on indentation that GitHub Actions itself requires, and the parser is only
// ever used to raise a question for a human, never to suppress an alert.
function parseWorkflow(text) {
  const lines = text.split('\n');
  const activeCrons = [];
  const jobIds = [];
  let inJobs = false;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();

    // Active cron: a `- cron:` line that is not commented out.
    if (!trimmed.startsWith('#')) {
      const m = line.match(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/);
      if (m) activeCrons.push(m[1]);
    }

    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs) {
      // A non-indented, non-blank, non-comment line ends the jobs block.
      if (/^\S/.test(line) && trimmed !== '') inJobs = false;
      else {
        const jm = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
        if (jm) jobIds.push(jm[1]);
      }
    }
  }
  return { activeCrons, jobIds };
}

async function auditConfigCoverage(token) {
  const dir = await ghRequest(token, `/repos/${OWNER}/${REPO}/contents/.github/workflows`, {
    conditional: true,
  });
  const files = (dir || []).filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name));

  const seenPairs = new Set();
  const unwatched = [];

  for (const f of files) {
    const meta = await ghRequest(token, `/repos/${OWNER}/${REPO}/contents/.github/workflows/${f.name}`, {
      conditional: true,
    });
    const { activeCrons, jobIds } = parseWorkflow(b64utf8(meta.content));
    for (const j of jobIds) seenPairs.add(`${f.name}::${j}`);

    // Only scheduled workflows are in scope. A workflow with no active cron
    // has nothing for a freshness supervisor to watch.
    if (activeCrons.length === 0) continue;

    for (const job of jobIds) {
      const watched = WATCH.some((w) => w.workflow_file === f.name && w.job_id === job);
      if (!watched) {
        unwatched.push({ workflow_file: f.name, job_id: job, active_crons: activeCrons });
      }
    }
  }

  // The mirror case: a config entry pointing at a job that no longer exists.
  // Left alone this is worse than useless -- it can never match, so it reports
  // permanently stale while also triggering the unbounded-scan pathology the
  // horizon bound above exists to prevent.
  const orphans = WATCH.filter((w) => !seenPairs.has(`${w.workflow_file}::${w.job_id}`)).map((w) => ({
    workflow_file: w.workflow_file,
    job_id: w.job_id,
  }));

  return { unwatched, orphans, files_checked: files.length };
}

// ---------------------------------------------------------------------------
// SIGNAL 2: published-SHA drift. DEFERRED, NOT IMPLEMENTED, NOT WIRED IN.
//
// This seam is intentionally empty. It is deferred, not blocked.
//
// What it will assert when built:
//   Compare the commit SHA reported by https://memradar.com/build.json against
//   the SHA of the newest SUCCESSFUL github-pages deployment, and alert only on
//   drift that PERSISTS ACROSS TWO CONSECUTIVE TICKS. The two-tick rule is not
//   caution for its own sake: a deploy in flight is legitimately mid-drift, and
//   GitHub Pages' own Fastly layer serves HTML and JSON with max-age=600, so a
//   single-tick read can be stale through no fault of the deploy.
//
// Two things must land before this can be written, both out of scope here:
//   1. build.json does not exist. deploy-frontend.yml has NO step between
//      `actions/checkout@v5` and `actions/upload-pages-artifact@v5` that writes
//      into ./frontend (only setup-node and configure-pages sit there, and the
//      only `run:` block in the file executes after the artifact is sealed), so
//      the seam to emit it does not exist yet either.
//   2. The cache question. Measured 2026-08-27: a query string does NOT bust
//      GitHub's Fastly layer -- probes with distinct random query values
//      returned `x-cache: HIT` on URLs never requested before, because the
//      object is keyed without the query string. Cloudflare itself is not the
//      problem (root-level .json returns cf-cache-status: DYNAMIC and is not
//      edge-cached), and GitHub Pages does not allow per-file response headers,
//      so defeating the 600s window needs a Cloudflare-side rule or a different
//      assertion shape.
//
// The DEPLOYMENT half of the comparison is already solved and is cheap: see
// newestPagesDeployment() below, which is written, correct, and reported in
// every tick's JSON so the drift signal can be eyeballed by hand today.
// ---------------------------------------------------------------------------
async function checkPublishedSha(_env, _deployment) {
  return null; // deferred
}

// The deployment half of signal 2. Reported for visibility, not yet alerted on.
async function newestPagesDeployment(token) {
  const deps = await ghRequest(
    token,
    `/repos/${OWNER}/${REPO}/deployments?environment=github-pages&per_page=1`,
    { conditional: true }
  );
  const dep = (deps || [])[0];
  if (!dep) return null;

  // THE SECOND CALL IS MANDATORY -- do not optimize it away. A deployment row
  // exists from the moment it is QUEUED, so the presence of a row proves
  // nothing about whether anything was published. Only an explicit
  // state === "success" status does. (Also note: `pages/builds/latest` is not
  // an alternative here; it 404s because this repo is build_type=workflow.)
  const statuses = await ghRequest(token, `/repos/${OWNER}/${REPO}/deployments/${dep.id}/statuses?per_page=1`);
  const st = (statuses || [])[0];
  return {
    deployment_id: dep.id,
    sha: dep.sha,
    created_at: dep.created_at,
    state: st ? st.state : null,
    successful: !!st && st.state === 'success',
  };
}

// ---------------------------------------------------------------------------
// Issue reconciliation
// ---------------------------------------------------------------------------

const titleForStale = (e) => `[supervisor] STALE: ${e.workflow_file} / ${e.job_id}`;
const TITLE_CONFIG_DRIFT = '[supervisor] CONFIG DRIFT: unwatched scheduled job';
const TITLE_TICK_FAILURE = '[supervisor] TICK FAILURE';

async function openAlertIssues(token) {
  // Labeled list, NOT repo.open_issues_count -- that field counts pull
  // requests too and would be wrong the moment a PR is opened.
  const issues = await ghRequest(
    token,
    `/repos/${OWNER}/${REPO}/issues?state=open&labels=${encodeURIComponent(ALERT_LABEL)}&per_page=100`
  );
  // The issues endpoint returns PRs as well; filter them out explicitly.
  return (issues || []).filter((i) => !i.pull_request);
}

async function ensureIssue(token, open, title, body) {
  const existing = open.find((i) => i.title === title);
  if (existing) return { action: 'already_open', number: existing.number };
  const created = await ghRequest(token, `/repos/${OWNER}/${REPO}/issues`, {
    method: 'POST',
    body: { title, body, labels: [ALERT_LABEL] },
  });
  return { action: 'opened', number: created.number };
}

async function resolveIssue(token, open, title, comment) {
  const existing = open.find((i) => i.title === title);
  if (!existing) return { action: 'noop' };
  await ghRequest(token, `/repos/${OWNER}/${REPO}/issues/${existing.number}/comments`, {
    method: 'POST',
    body: { body: comment },
  });
  await ghRequest(token, `/repos/${OWNER}/${REPO}/issues/${existing.number}`, {
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' },
  });
  return { action: 'closed', number: existing.number };
}

function staleBody(e, nowIso) {
  const age = e.age_hours === null ? 'no success found inside the freshness window' : `${e.age_hours}h`;
  return [
    `**${e.workflow_file} / ${e.job_id}** has not completed successfully inside its freshness window.`,
    '',
    `| | |`,
    `|---|---|`,
    `| cron | \`${e.cron}\` |`,
    `| max_age_hours | ${e.max_age_hours} |`,
    `| age of last success | ${age} |`,
    `| last success | ${e.last_success ? `[run ${e.last_success.run_id}](${e.last_success.html_url}) at ${e.last_success.created_at}` : 'none inside window'} |`,
    `| triggering event of last success | ${e.last_success ? `\`${e.last_success.event}\`` : 'n/a'} |`,
    `| runs examined this tick | ${e.runs_examined}${e.page_exhausted ? ' (PAGE EXHAUSTED before horizon)' : ''} |`,
    `| detected at | ${nowIso} |`,
    '',
    'Read the triggering event above before diagnosing. `schedule` means the cron fired and the job',
    'failed or was skipped. `workflow_dispatch` means the last success was a manual run, so the cron',
    'itself may have been dead for longer than this alert implies.',
    '',
    'Freshness deliberately counts manual runs, so re-running the job by hand will close this issue',
    'on the next tick. That is intended: the alert asks whether the work happened, not how.',
    '',
    '_Opened by the MemRadar supervisor (stage 1, read-only). It cannot dispatch a workflow._',
  ].join('\n');
}

async function reconcile(token, verdict) {
  const nowIso = verdict.checked_at;
  const open = await openAlertIssues(token);
  const actions = [];

  for (const e of verdict.freshness) {
    const title = titleForStale(e);
    if (e.stale) {
      actions.push({ title, ...(await ensureIssue(token, open, title, staleBody(e, nowIso))) });
    } else {
      const delay = e.age_hours === null ? 'unknown' : `${e.age_hours}h`;
      actions.push({
        title,
        ...(await resolveIssue(
          token,
          open,
          title,
          `Recovered at ${nowIso}. Last success ${e.last_success.created_at} ` +
            `(event \`${e.last_success.event}\`, run ${e.last_success.run_id}), age ${delay} ` +
            `against a ${e.max_age_hours}h threshold.`
        )),
      });
    }
  }

  const drift = verdict.config_audit;
  const hasDrift = drift.unwatched.length > 0 || drift.orphans.length > 0;
  if (hasDrift) {
    const body = [
      'The supervisor config array has fallen out of sync with the workflows it watches.',
      '',
      drift.unwatched.length
        ? '**Active scheduled jobs that nothing is watching:**\n' +
          drift.unwatched
            .map((u) => `- \`${u.workflow_file}\` / \`${u.job_id}\` (crons: ${u.active_crons.map((c) => `\`${c}\``).join(', ')})`)
            .join('\n')
        : '',
      drift.orphans.length
        ? '\n**Config entries pointing at jobs that no longer exist:**\n' +
          drift.orphans.map((o) => `- \`${o.workflow_file}\` / \`${o.job_id}\``).join('\n')
        : '',
      '',
      'A workflow change ships through git and registers instantly; a config change needs a manual',
      '`wrangler deploy`. The two can never be atomic, so the default outcome of adding a cron is',
      'that it is unwatched. Fix by editing `WATCH` in `ops/supervisor/src/index.js` and redeploying',
      'by hand.',
      '',
      `_Checked ${drift.files_checked} workflow files at ${nowIso}._`,
    ]
      .filter(Boolean)
      .join('\n');
    actions.push({ title: TITLE_CONFIG_DRIFT, ...(await ensureIssue(token, open, TITLE_CONFIG_DRIFT, body)) });
  } else {
    actions.push({
      title: TITLE_CONFIG_DRIFT,
      ...(await resolveIssue(token, open, TITLE_CONFIG_DRIFT, `Config coverage restored at ${nowIso}.`)),
    });
  }

  // A tick that reaches here succeeded, so clear any standing failure issue.
  actions.push({
    title: TITLE_TICK_FAILURE,
    ...(await resolveIssue(token, open, TITLE_TICK_FAILURE, `Supervisor tick completed normally at ${nowIso}.`)),
  });

  return actions;
}

// ---------------------------------------------------------------------------
// The tick. The cron path and the QA fetch path call THIS function, not copies.
// ---------------------------------------------------------------------------

async function runTick(env, source) {
  assertConfigArithmetic();

  const token = env.SUPERVISOR_GITHUB_TOKEN;
  if (!token) throw new Error('SUPERVISOR_GITHUB_TOKEN is not set');

  const nowMs = Date.now();
  const verdict = {
    source,
    checked_at: new Date(nowMs).toISOString(),
    freshness: await evaluateFreshness(token, nowMs),
    config_audit: await auditConfigCoverage(token),
    pages_deployment: await newestPagesDeployment(token),
    signal_2_published_sha: await checkPublishedSha(env, null), // deferred, returns null
  };
  verdict.stale_count = verdict.freshness.filter((f) => f.stale).length;
  verdict.issue_actions = await reconcile(token, verdict);

  // One structured line per tick. Includes the triggering event of each last
  // success so cron-death and job-failure stay distinguishable in the log.
  console.log(
    JSON.stringify({
      tick: verdict.checked_at,
      source,
      stale: verdict.stale_count,
      jobs: verdict.freshness.map((f) => ({
        k: f.key,
        stale: f.stale,
        age_h: f.age_hours,
        max_h: f.max_age_hours,
        ev: f.last_success ? f.last_success.event : null,
        examined: f.runs_examined,
      })),
      drift: verdict.config_audit.unwatched.length + verdict.config_audit.orphans.length,
      pages_sha: verdict.pages_deployment ? verdict.pages_deployment.sha.slice(0, 8) : null,
      pages_ok: verdict.pages_deployment ? verdict.pages_deployment.successful : null,
    })
  );

  // LAST, and only on a tick that got this far. The dead-man switch means
  // "silence is the alarm", so the ping must be unreachable by any path that
  // did not fully succeed. Do not move this earlier, and do not wrap the tick
  // in a try/catch that pings anyway: that would convert the one check that
  // catches "nothing ran" into a check that always says everything is fine.
  verdict.heartbeat = await pingHeartbeat(env, 'ok');

  return verdict;
}

// ---------------------------------------------------------------------------
// FAILING LOUDLY. A supervisor that dies quietly is the exact thing this was
// built to prevent, and the failure modes split in two:
//
//   (a) the tick RAN and threw    -> self-reportable, if the channel still works
//   (b) the tick NEVER RAN at all -> structurally unreportable from in here
//
// (b) is the faithful analogue of the 2026-08-27 incident, where the failure
// was not "a job errored" but "nothing ran and nothing said so". No amount of
// error handling inside this Worker catches it, because nothing executes. Only
// an outside observer noticing SILENCE can.
//
// HEARTBEAT (layer 0, covers both (a) and (b)):
// healthchecks.io, pinged at the end of every SUCCESSFUL tick. Chosen because
// the independence IS the feature and it was verified rather than assumed:
// hc-ping.com resolves to Hetzner (176.9/159.69/188.40, `server: nginx`) with
// no Cloudflare in front, so it shares no infrastructure with GitHub Actions
// or with the Cloudflare edge this Worker runs on. Better Stack was rejected
// for exactly this reason: `server: cloudflare`, same blast radius as us.
// A Supabase heartbeat was rejected earlier as circular, since nothing
// independent would be reading it.
//
// The failure path also pings `/fail`, which alerts in SECONDS rather than
// waiting out the grace period, on a path independent of GitHub AND of Resend.
// Ordering matters below: heartbeat first, because it is the only channel that
// works when GitHub is the thing that is broken.
// ---------------------------------------------------------------------------

// Best-effort, always. A heartbeat that could fail the tick would turn the
// alerting layer into a new source of outages.
async function pingHeartbeat(env, kind /* 'ok' | 'fail' */) {
  const base = env.SUPERVISOR_HEARTBEAT_URL;
  if (!base) {
    console.warn('SUPERVISOR_HEARTBEAT_URL not set: dead-man switch is DISABLED');
    return { ok: false, reason: 'not_configured' };
  }
  const url = kind === 'fail' ? `${base.replace(/\/+$/, '')}/fail` : base;
  try {
    const res = await fetch(url, { method: 'POST', cache: 'no-store' });
    if (!res.ok) throw new Error(`heartbeat ${res.status}`);
    return { ok: true, kind };
  } catch (e) {
    // Loud, because a silently dead heartbeat is a silently dead dead-man
    // switch, which is the same silent-degradation shape this repo keeps
    // getting bitten by.
    console.error(`SUPERVISOR heartbeat ping (${kind}) FAILED: ${e}`);
    return { ok: false, kind, error: String(e) };
  }
}

// Layer 2 of (a). Reuses the existing Resend account and the verified
// hello@memradar.com sender, so this path shares nothing with GitHub. Sent
// ONLY when the GitHub issue path itself failed, which is precisely when the
// issue-based channel is useless. Recipient is the project's own public
// mailbox rather than a personal address, so no personal address is committed
// to a public repo; change ALERT_TO if you want it elsewhere.
const ALERT_TO = 'hello@memradar.com';

async function emailTickFailure(env, err, source, stamp, ghError) {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn('RESEND_API_KEY not set: email fallback DISABLED');
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MemRadar Supervisor <hello@memradar.com>',
        to: [ALERT_TO],
        subject: `[supervisor] tick failed, and GitHub could not be told (${source})`,
        text: [
          'The MemRadar scheduled-workflow supervisor threw, AND could not open a GitHub issue',
          'about it. That second failure usually means GitHub itself, or the token, is the problem.',
          '',
          'While this is unresolved, NO freshness result is trustworthy: a tick that dies before',
          'evaluating cannot tell you whether a job is stale.',
          '',
          `source:     ${source}`,
          `failed at:  ${stamp}`,
          '',
          'tick error:',
          String(err && err.stack ? err.stack : err).slice(0, 1200),
          '',
          'github reporting error:',
          String(ghError).slice(0, 600),
          '',
          'Check: npx wrangler tail memradar-supervisor',
        ].join('\n'),
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { ok: true };
  } catch (e) {
    console.error(`SUPERVISOR could not send failure email either: ${e}`);
    return { ok: false, error: String(e) };
  }
}

async function reportTickFailure(env, err, source) {
  const stamp = new Date().toISOString();

  // Layer 1: captured by Workers observability, streamed by `wrangler tail`.
  console.error(`SUPERVISOR TICK FAILED [${source}] ${stamp}: ${err && err.stack ? err.stack : err}`);

  // Layer 0 FIRST: the only channel that survives a GitHub outage.
  await pingHeartbeat(env, 'fail');

  // Layer 2: same channel as every other alert, when it is reachable.
  try {
    const token = env.SUPERVISOR_GITHUB_TOKEN;
    if (!token) throw new Error('SUPERVISOR_GITHUB_TOKEN is not set');
    const open = await openAlertIssues(token);
    await ensureIssue(
      token,
      open,
      TITLE_TICK_FAILURE,
      [
        'The supervisor tick threw. **While this is open, no freshness result is trustworthy** -- a',
        'tick that dies before evaluating cannot tell you a job is stale.',
        '',
        '```',
        String(err && err.stack ? err.stack : err).slice(0, 1500),
        '```',
        '',
        `| | |`,
        `|---|---|`,
        `| source | \`${source}\` |`,
        `| failed at | ${stamp} |`,
        '',
        'This issue closes automatically on the next tick that completes.',
      ].join('\n')
    );
  } catch (e2) {
    console.error(`SUPERVISOR could not report its own failure to GitHub: ${e2}`);
    // Layer 3: only now, because GitHub being unreachable is the case the
    // email exists for. Sending on every tick failure would train it to be
    // ignored.
    await emailTickFailure(env, err, source, stamp, e2);
  }
}

function constantTimeEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env, 'cron').catch((err) => reportTickFailure(env, err, 'cron')));
  },

  // Live QA. Runs the IDENTICAL check the cron path runs, by calling the same
  // runTick() -- not a read-only copy, because a copy would drift and the
  // thing you most want to QA is the real behaviour. Consequence to be aware
  // of: a QA call has the same side effects as a tick (it can open or close
  // issues). That is safe by design, since reconciliation is idempotent and
  // will not duplicate an already-open issue.
  async fetch(req, env) {
    const provided = req.headers.get('x-supervisor-secret');
    // 404 rather than 401: an unauthenticated caller learns nothing about
    // whether this endpoint exists.
    if (!env.SUPERVISOR_QA_SECRET || !provided || !constantTimeEqual(provided, env.SUPERVISOR_QA_SECRET)) {
      return new Response('Not found\n', { status: 404 });
    }
    try {
      const verdict = await runTick(env, 'fetch');
      return Response.json(verdict, { headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      await reportTickFailure(env, err, 'fetch');
      return Response.json(
        { error: String(err && err.message ? err.message : err) },
        { status: 500, headers: { 'cache-control': 'no-store' } }
      );
    }
  },
};
