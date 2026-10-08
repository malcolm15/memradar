# MemRadar scheduled-workflow supervisor

Cloudflare Worker. Stage 1: **read-only alerting**. Watches whether this repo's
scheduled Actions jobs actually ran, and opens a GitHub Issue when one goes
stale. No dispatch, no self-healing.

## Why it exists

On 2026-08-27 five scheduled slots across two workflows were **never created by
GitHub at all**: no run record, nothing queued, nothing cancelled, no published
incident covering the window, and no concurrency group that could have
suppressed them. The repo is public so Actions minutes cannot gate it. The
failure is upstream of run creation, which means nothing inside GitHub reports
it. The only way to notice is to ask, from outside, whether the work happened.

It keys on **(workflow file, job id)**, never workflow file alone.
`newegg-refresh.yml` carries two crons gating two different jobs, and a run
where one job succeeds while its sibling is `skipped` still reports run-level
conclusion `success`. On 2026-08-27 the 06:00 job succeeded while the 09:00
regen was never created; workflow-level freshness would have called that file
healthy.

## Deploy

**By hand, always:**

```
cd ops/supervisor
npx wrangler deploy
```

**There is deliberately no GitHub Actions workflow that deploys this Worker,
and one must never be added.** A supervisor deployed by the system it
supervises cannot be updated while that system is degraded, which is exactly
when you need to change it. The manual step is the point, not an omission.

`wrangler` is not installed globally in this repo; `npx wrangler` resolves it.
You will need `wrangler login` in an interactive terminal first (the stored
Cloudflare token was expired as of 2026-08-27).

## Deploy runbook (2026-10-07)

**What this deploy changes for you:** when the supervisor opens an alert issue, it will also email you at hello@memradar.com, and it will keep retrying that email until one gets through, because the issues it opens do not notify you. **The two labels it needs are already created**, so there is nothing to set up first.

Nothing is live until you run these steps. Follow them in order; each says what you should see.

1. **Open Terminal** (press Command and Space, type `Terminal`, press Return). Then type this and press Return:

   ```
   cd /Users/mkonner/Projects/memradar/ops/supervisor
   ```

   You should see no message. If you see `No such file or directory`, the repo is somewhere else on this machine.

2. **Make sure your local copy is current:**

   ```
   git pull
   ```

   Up to date looks like `Already up to date.` If instead it lists files and says something like `Fast-forward`, that is fine too, it just means it downloaded newer work.

3. **Deploy:**

   ```
   npx wrangler deploy
   ```

   Success looks like several lines ending with `Deployed memradar-supervisor` and a line reading `Current Version ID:` followed by a long id.

4. **If a browser window opens asking you to log in to Cloudflare, that is expected.** The stored login for this project expired on 2026-08-27. Click `Allow` on the Cloudflare page, come back to Terminal, and run `npx wrangler deploy` again. Do not create or paste an API token.

5. **Find the Worker's address.** In the deploy output from step 3, look for a line beginning `https://memradar-supervisor.` and ending `.workers.dev`. **Copy that whole address**, you need it in step 7.

6. **Only if you do not have the QA secret.** It is a password you chose; it is not written down in this repo on purpose. If you no longer have it, set a new one:

   ```
   npx wrangler secret put SUPERVISOR_QA_SECRET
   ```

   **This command is safe to use as written.** It prints `Enter a secret value:` and waits, and what you type is not shown on screen and is not written to your command history. Type any long random string, press Return, and keep a copy in your password manager. You should then see `Success! Uploaded secret SUPERVISOR_QA_SECRET`. **Nothing else uses this secret**, so changing it breaks nothing.

   **Do not put the value on the command line**, and do not pipe it in with `echo`. Both of those write the secret into your shell history file in plain text, where it stays. Let the command prompt you.

   **If you have already typed a secret into a command by mistake**, just set a new one with the same command above, because nothing else uses this secret.

7. **Send yourself a test email.** This is done in three short commands so that **the secret is never part of a command you type**, and so never lands in your shell history.

   First, let the shell ask you for the secret. Type this line and press Return:

   ```
   read -rs "QA_SECRET?Paste the QA secret, then press Return: "
   ```

   (That is the zsh form. zsh is the default shell on macOS and is what this
   machine reports, though the repo does not state it anywhere. If your terminal
   ever answers `bad option: -s`, you are in bash; use
   `read -rs -p "Paste the QA secret, then press Return: " QA_SECRET` instead.)

   It will print the question and wait. Paste the secret and press Return. **Nothing appears on screen as you paste**, which is correct and means it is hidden.

   Then run the test, replacing only the bracketed address with the one from step 5. **The address is not a secret**, so it is fine to type it:

   ```
   curl -s -H "x-supervisor-secret: $QA_SECRET" "[YOUR-WORKER-ADDRESS-HERE]/?action=test-email"
   ```

   Finally, clear the secret out of this terminal session:

   ```
   unset QA_SECRET
   ```

   That last step matters because until you run it, anything else you start from this same terminal window can read the secret out of the environment.

   - **Good:** `{"test_email":{"ok":true}}`. An email with the subject **`[supervisor] test email`** should arrive at **hello@memradar.com** within about two minutes. Check spam if it has not arrived in five.
   - `Not found` means the secret is wrong. Redo step 6.
   - `{"test_email":{"ok":false,"reason":"not_configured"}}` means the Resend key is missing on the Worker; set it with `npx wrangler secret put RESEND_API_KEY`.
   - `{"test_email":{"ok":false,...}}` with anything else means the email service rejected it; the message says why.

8. **Watch one live check** (optional):

   ```
   npx wrangler tail memradar-supervisor
   ```

   Within 15 minutes a line of text appears starting `{"tick":`. That is one check running. Press Control and C together to stop watching.

9. **If you want to undo the deploy:**

   ```
   npx wrangler rollback
   ```

   It asks which version to go back to and asks you to confirm. **It undoes the code only.** It does not delete the two labels, does not reopen or close any issue, and does not unsend an email. Nothing is lost by rolling back, because the supervisor stores no data of its own.

## Secrets

Four, all set out of band. None ever appears in a file, in `wrangler.jsonc`, or
in a log line.

```
npx wrangler secret put SUPERVISOR_GITHUB_TOKEN    # fine-grained PAT, scopes below
npx wrangler secret put SUPERVISOR_QA_SECRET       # random string, gates the fetch handler
npx wrangler secret put SUPERVISOR_HEARTBEAT_URL   # healthchecks.io ping URL
npx wrangler secret put RESEND_API_KEY             # the existing MemRadar Resend key
```

`SUPERVISOR_HEARTBEAT_URL` is a secret rather than a plain var because the ping
URL's UUID **is** the credential: anyone holding it can forge a healthy ping and
silence the dead-man switch.

For local runs, put them in `ops/supervisor/.dev.vars`, which is gitignored
(`.dev.vars` and `.dev.vars.*`, verified with `git check-ignore` at every depth
before this directory was created).

### Token scopes

A fine-grained PAT scoped to `malcolm15/memradar` only:

| Permission | Level | Why |
|---|---|---|
| Actions | **Read** | list workflow runs and jobs |
| Contents | **Read** | read `.github/workflows/*` for the config self-audit |
| Issues | **Read and write** | open, comment on, and close alert issues |

**Actions must stay Read.** Stage 1 is designed so that it cannot trigger a
workflow even by mistake, and the token scope is the enforcement, not the code.
If a future stage wants dispatch, re-scope the token deliberately and
separately, as its own decision.

## Prerequisite

The `supervisor-alert` label must exist before the Worker runs. Create it
explicitly rather than letting the Issues API auto-create it with a random
colour:

```
gh label create supervisor-alert \
  --color B60205 \
  --description "Automated alert from the scheduled-workflow supervisor"
```

## Live QA

The `fetch` handler runs the **identical** check the cron path runs, by calling
the same `runTick()`. It is gated on a shared secret header and returns 404,
not 401, to an unauthenticated caller.

**Read the secret with hidden input rather than typing it into the command**, so it
never reaches your shell history file. zsh form (the macOS default):

```
read -rs "QA_SECRET?Paste the QA secret, then press Return: "
curl -sS -H "x-supervisor-secret: $QA_SECRET" \
  https://memradar-supervisor.<subdomain>.workers.dev/ | jq
unset QA_SECRET
```

In bash the first line is `read -rs -p "Paste the QA secret, then press Return: " QA_SECRET`
instead. `unset` matters because anything started from the same shell can
otherwise read the value out of the environment.

Be aware: because it is the same function, **a QA call has the same side
effects as a tick** and can open or close issues. That is intended (it is a
real check, not a simulation) and is safe, because reconciliation is idempotent
and will not duplicate an already-open issue.

## Thresholds

`max_age_hours = interval_hours + (p95_minutes / 60) + margin_hours`, asserted
at tick time by `assertConfigArithmetic()`. The assertion exists so a threshold
cannot be retuned by taste: to change the number you must change one of the
three inputs and say why in the comment beside it.

| pair | interval | p95 | margin | max_age |
|---|---|---|---|---|
| `price-fetch.yml` / `fetch-prices` | 4h | 58.6m (n=28) | 4h (1.00x) | 8.98h |
| `newegg-refresh.yml` / `refresh-offers` | 24h | 34.8m (n=6) | 12h (0.50x) | 36.58h |
| `newegg-refresh.yml` / `regenerate-pages` | 24h | 49.0m (**n=1**) | 6h (0.25x) | 30.82h |
| `bluesky-posts.yml` / `post` | 24h | 112.0m (**n=1**) | 24h (1.00x) | 49.87h |

p95 comes from the healthy period only: slots whose nominal time is strictly
before 2026-08-26 20:00 UTC. Margins differ per pair by consequence, not by
convention; the reasoning for each lives next to its value in `src/index.js`.

**REVISIT 2026-09-10.** Two of those p95 figures rest on `n=1`, because
`regenerate-pages` and `post` were both created on 2026-08-26 and each had
exactly one healthy-period occurrence. Recompute all four once there is a real
distribution.

## Known coverage hole: the Bluesky weekly pulse

`bluesky-posts.yml` has **one** job (`post`) on **two** crons, and the
daily/weekly split happens inside a step, not in a job gate. So freshness on
`post` observes the **daily** cron only. The Sunday pulse (`0 18 * * 0`) could
stop firing indefinitely without producing any signal, because a daily-drop
success satisfies the same `(file, job)` key.

Accepted, not worked around: this is the least consequential job on the board,
since a missed post is invisible and harmless by design. **If the weekly ever
carries real weight, the fix is a distinct marker written by the weekly path**
(a separate job id, or a `bot_state` key the supervisor reads), not a cleverer
run scan. No scan can separate two crons that land on one job id.

The config self-audit **cannot see this hole**, because `0 18 * * 0` does map to
a job that is in the array.

## Config self-audit

Each tick reads `.github/workflows/*` and checks that every job in every
workflow with an active cron appears in the `WATCH` array, plus the mirror case
(a config entry pointing at a job that no longer exists). Drift raises an issue
on the same channel as a staleness breach.

The direction is deliberate: the workflows are the source of truth and the
hand-assembled array is the thing under suspicion. A workflow change ships
through git and registers instantly; a config change needs a manual
`wrangler deploy`. The two can never be atomic, so **the default outcome of
adding a cron is that it is unwatched, silently.**

**Its limit, stated plainly: it proves coverage, not correctness.** It cannot
tell you a `max_age_hours` is wrong, and it cannot see the Bluesky weekly hole
above.

## Scan bound

`findLastSuccess()` stops walking runs as soon as one predates
`now - max_age_hours`. Not-found and found-too-old are the same verdict, so
there is no reason to keep looking. Without this bound, a job that has never
succeeded, or whose id was renamed in config, walks the entire run history every
tick forever, getting slower exactly as the incident gets worse.

Cost measured against real data: **7 API calls per tick in steady state, 28 per
hour, about 0.56% of the 5000/hour ceiling.** Worst case with the bound is ~13
per tick and stays there permanently regardless of how long a job has been
broken. `?status=success` is deliberately **not** used: it filters on run
conclusion, which is the wrong granularity.

`cancelled` is explicitly not a success. `deploy-frontend.yml` uses
`concurrency: group: pages` with `cancel-in-progress: true`, so a cancelled run
is silent today.

## Failing loudly

**A supervisor that dies quietly is the exact thing this was built to prevent.**
The failure modes split in two, and only one of them can be self-reported.

**(a) The tick ran and threw** (bad token, GitHub 5xx, config parse failure).
Two layers are built:

1. `console.error` with the stack. Captured by Workers observability (enabled in
   `wrangler.jsonc`) and streamed live by `npx wrangler tail`.
2. A GitHub Issue titled `[supervisor] TICK FAILURE`, which closes itself on the
   next tick that completes. Its body says plainly that **while it is open, no
   freshness result is trustworthy**, because a tick that dies before evaluating
   cannot tell you a job is stale.

Layer 2 has an obvious hole: it cannot work when the failure *is* the GitHub
token or the GitHub API, which is the most likely failure.

**(b) The tick never ran at all** (Worker not deployed, cron trigger removed,
Cloudflare incident, account issue). **This is structurally unreportable from
inside the Worker** and no amount of error handling fixes it. Only an outside
observer noticing *silence* can catch it. This is the faithful analogue of the
2026-08-27 incident, where the failure was not "a job errored" but "nothing ran
and nothing said so."

### The dead-man switch (layer 0, covers both)

**healthchecks.io**, pinged at the end of every **successful** tick. Grace
period **45 minutes** (three missed ticks), so one delayed or dropped tick does
not page you but a dead Worker does.

The independence is the entire feature, so it was **verified rather than
assumed**:

```
hc-ping.com     -> 176.9.71.146 (HETZNER-fsn1-dc6), 159.69.66.229, server: nginx   [no Cloudflare]
healthchecks.io -> 188.40.122.95, 176.9.71.146,                    server: nginx   [no Cloudflare]
cronitor.link   -> 54.68.179.145 (AWS),                            server: nginx   [no Cloudflare]
uptime.betterstack.com -> 172.66.40.94, server: cloudflare, cf-ray: ...   [REJECTED]
```

Better Stack was rejected on that evidence alone: it sits behind Cloudflare, so
a Cloudflare incident would take out the Worker and its alarm together. A
Supabase heartbeat was rejected earlier as circular, since nothing independent
would be reading it.

Two properties worth not breaking:

- **The success ping is the LAST statement in `runTick()`.** Silence is the
  alarm, so the ping must be unreachable by any path that did not fully
  succeed. Never wrap the tick in a `try/catch` that pings anyway; that
  converts the one check that catches "nothing ran" into a check that always
  says everything is fine.
- **The failure path pings `/fail`**, which alerts in seconds instead of
  waiting out the grace period, on a channel independent of both GitHub and
  Resend.

### Layer 2 and 3 of (a)

2. A GitHub Issue titled `[supervisor] TICK FAILURE`, which closes itself on the
   next tick that completes. Its body says plainly that **while it is open, no
   freshness result is trustworthy**, because a tick that dies before
   evaluating cannot tell you a job is stale.
3. **A Resend email, sent only when layer 2 itself failed.** That is precisely
   the case the email exists for: GitHub being unreachable is exactly when the
   issue-based channel is useless. Sending on *every* tick failure would train
   it to be ignored. Reuses the existing key and the verified
   `hello@memradar.com` sender, so the path shares nothing with GitHub.
   Recipient is the project's own public mailbox rather than a personal
   address, so no personal address is committed to a public repo; change
   `ALERT_TO` in `src/index.js` to redirect it.

Ordering in `reportTickFailure()` is deliberate: `console.error`, then the
heartbeat `/fail`, then GitHub, then email on GitHub's failure. The heartbeat
goes early because it is the only channel that survives a GitHub outage.

## Signal 2: published-SHA drift

Deferred, not blocked. `checkPublishedSha()` is a named empty seam in
`src/index.js` with the full assertion spec in its comment. It will compare
`https://memradar.com/build.json` against the newest **successful**
`github-pages` deployment SHA, alerting only on drift persisting across two
consecutive ticks.

Two things must land first, both out of scope here: `build.json` does not exist
and `deploy-frontend.yml` has no step between checkout and
`upload-pages-artifact` that could write it; and a query string does **not**
bust GitHub's Fastly layer (measured 2026-08-27: distinct random query values
returned `x-cache: HIT` on URLs never requested before), so the 600s cache
window needs a different answer.

The deployment half is already implemented in `newestPagesDeployment()` and
reported in every tick's JSON, so drift can be eyeballed by hand today. Note the
mandatory second call for deployment **status**: a deployment row exists from the
moment it is queued, so a row alone proves nothing was published.
