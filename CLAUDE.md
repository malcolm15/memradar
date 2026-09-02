# MemRadar — Claude Code Context

RAM & SSD price tracker for PC builders. Goal: ship a real product at **memradar.com**.

---

## Project Overview

MemRadar tracks Amazon prices on RAM and SSDs via the Keepa API (licensed price-history data), stores historical price data, and alerts users when prices drop to their target. Targeted at PC builders who know exactly what they want and are waiting for the right price.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS / HTML / CSS — static, no framework |
| Hosting | GitHub Pages + Cloudflare (frontend) |
| Backend | Node.js serverless functions on Vercel |
| Database | Supabase (Postgres) |
| Data source | Keepa API — Amazon price history (launch). Best Buy client dormant (never approved) |
| Cron | GitHub Actions — **every 4 hours**: 00/04/08/12/16/20 UTC (`.github/workflows/price-fetch.yml`) |

## Directory Structure

```
memradar/
├── api/
│   └── fetch-prices.js      # Vercel serverless function + cron handler
├── backend/
│   ├── lib/
│   │   ├── keepa.js         # Keepa API client — price history source (self-test: node backend/lib/keepa.js)
│   │   ├── marketStats.js   # Market Pulse stats computation (shared by cron + standalone script)
│   │   ├── bestbuy.js       # Best Buy API client — DORMANT (access never approved)
│   │   ├── supabase.js      # Supabase client (uses service role key)
│   │   ├── productParsers.js # Single-source name parsers (capacity/speed/type/CL/MPN); required by the generator + build-families + match-newegg
│   │   ├── rakutenLink.js   # Rakuten deep-link wrapper for Newegg affiliate URLs (render-time; self-test: node backend/lib/rakutenLink.js)
│   │   └── neweggFeed.js    # Shared Rakuten SFTP access (fastGet watchdog + gzip-integrity-on-timeout) + streaming positional feed parser
│   ├── package.json
│   └── schema.sql           # Full DB schema — run in Supabase SQL Editor
├── frontend/
│   ├── index.html                   # Landing page
│   ├── about.html                   # About page
│   ├── contact.html                 # Contact page (hello@memradar.com)
│   ├── privacy.html                 # Privacy Policy
│   ├── terms.html                   # Terms of Service
│   ├── affiliate.html               # Affiliate Disclosure
│   ├── sitemap.xml                  # XML sitemap for search engines
│   ├── robots.txt                   # Allows all crawlers, points to sitemap
│   ├── site.webmanifest             # PWA manifest (theme color, icons)
│   ├── CNAME                        # Sets custom domain for GitHub Pages
│   ├── favicon.ico                  # 16×16 + 32×32 embedded
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   ├── apple-touch-icon.png         # 180×180
│   ├── android-chrome-192x192.png
│   ├── android-chrome-512x512.png
│   ├── favicon-source.svg           # Editable favicon source — re-run generate-favicons.js after changes
│   ├── og-image.png                 # Social share image (1200×630)
│   ├── og-image.svg                 # Editable OG image source
│   ├── brand/                       # Brand assets: og-image.png, og-image.svg (verified 2026-08-27)
│   ├── css/style.css                # All styles — no CSS framework
│   ├── js/main.js                   # Homepage hero search (navigates to top result) + submit rate limiter
│   ├── js/theme.js                  # Dark mode toggle + localStorage persistence
│   ├── js/supabase-client.js        # Public anon-key Supabase client (RLS read-only)
│   ├── js/market-pulse.js           # Homepage Market Pulse live stats
│   ├── js/product-listing.js        # RAM/SSD listing pages: live data, filters, sorts
│   ├── js/mobile-nav.js             # Mobile hamburger nav (all shared-header pages)
│   └── js/filters.js                # UNUSED stub (superseded by product-listing.js)
├── .github/
│   └── workflows/
│       └── deploy-frontend.yml  # GitHub Actions — deploys frontend/ to GitHub Pages on push to main
├── scripts/
│   ├── generate-product-pages.js  # Static PDP generator — see "Product Detail Pages" section
│   ├── test-api.js              # Manual Best Buy API sanity check (dormant)
│   ├── test-priceapi.js         # PriceAPI schema evaluation (kept for reference)
│   ├── build-catalog.js         # Amazon catalog harvest via PriceAPI (--reprocess for offline re-derive)
│   ├── upsert-catalog.js        # Catalog preview -> products table (--confirm to write)
│   ├── backfill-keepa.js        # One-time Keepa history backfill (--confirm to write)
│   ├── compute-market-stats.js  # Manual Market Pulse stats recompute
│   ├── generate-favicons.js     # Regenerates all favicon PNGs + ICO from favicon-source.svg
│   ├── fetch-parent-asins.js    # Keepa parentAsin -> products.parent_asin (tier-1 family source)
│   ├── build-families.js        # Two-tier capacity-family clustering -> products.family_id/capacity_gb (also exports the normalization for match-newegg)
│   ├── match-newegg.js          # Newegg feed matcher -> retailer_offers (tier-1 MPN auto + tier-1.5 UPC + tier-2 name proposals, Gate-reviewed)
│   ├── fetch-upcs.js            # Keepa UPC/EAN/GTIN -> products.upc for tier-1.5 (dry-run default)
│   ├── refresh-newegg-offers.js # Phase-2 cron body: delta I/U/D apply, Sunday full reconciliation, 9-day staleness net
│   └── fetch-newegg-feed.js     # Rakuten SFTP feed pull (lists dir first; single connection; binary-safe SFTP)
├── ops/
│   └── supervisor/          # Cloudflare Worker: scheduled-workflow supervisor (stage 1, read-only).
│                            # DEPLOY BY HAND (npx wrangler deploy), NEVER from Actions.
├── vercel.json              # Vercel cron config
├── package.json
└── .env                     # Local secrets — NEVER commit this file
```

## Database Schema (Supabase / Postgres)

Four tables:

**COHORT SENSITIVITY: figures are not equally robust, and the difference is large.** The per-period fairness rule compares each window over its own matched subset (products with both a current price and a baseline in THAT window). A consequence, measured 2026-08-26: **the same table can hold a figure that is rock solid and one that moves 30 points depending on cohort choice.** Recomputing each period over only the products present in EVERY period gives:

| Figure | Full cohort | Stable cohort | Swing |
|---|---|---|---|
| DDR5 1Y | +360.9% | +360.9% | **0.0pp** |
| DDR5 3M | +9.1% | +9.2% | 0.1pp |
| SATA 1Y | +190.6% | +190.6% | **0.0pp** |
| DDR4 1Y | +191.5% | +159.3% | **32.2pp** |
| NVMe 1Y | +138.6% | +164.0% | **25.4pp** |
| NVMe 3M | +14.5% | +10.4% | 4.1pp |

The mechanism is medians, not averages: **one product entering a window can shift which product sits at the median and move the whole figure.** NVMe 3M was traced to exactly one product (the SanDisk Optimus 5100 falling $176.63 to $99.99) dragging the baseline median from $307 to $296. Sample size is a WEAK proxy for this - SATA 1Y has n=26 and swings 0.0pp while DDR4 1Y has n=26 and swings 32.2pp - so do not assume small n means unstable or large n means safe.

This is **not a bug**: the fairness rule is doing exactly what it should, and the alternative (comparing different product sets on each side) would be worse. It is a statement about how precisely any single figure deserves to be quoted.

**DECISION: the Price Index does NOT annotate volatile cells, and this has a stated reversal condition.** Options considered were a per-cell stability marker, showing the stable-cohort figure alongside, or a methodology paragraph. Annotation was rejected because only 2 of 16 cells are severely volatile, so marking them makes the other 14 read as "the ones without warnings" and invites "so which of these do you actually stand behind?" - worse than a clean table plus honest methodology, and it costs the screenshot-ability the page was built for. The scenario annotation would defend against (an outsider recomputing our medians over a different cohort) is also near-impossible, since reproducing it needs our exact catalog and full history. The realistic exposure is our OWN figure moving between snapshots, which annotation does not fix and the prose-versus-table rule does. What shipped instead: one methodology sentence on the page ("Figures over longer windows rest on smaller, older product sets...") plus the internal tripwire below.

**REVERSAL CONDITION (verbatim, recorded because a decision with a stated reversal condition is worth more than one without):** *if a published figure is ever publicly disputed, per-cell transparency becomes defensive value rather than self-inflicted doubt, and this decision gets revisited.*

**THE TRIPWIRE (`stability_delta_pp` in `market_stats`, computed every stats run, never displayed).** Each figure is recomputed over the stable cohort and the absolute difference stored. **Tiered on purpose:** at the 5pp flag line, 7 of 16 figures flag on live data, and a warning firing on nearly half the table is one people learn to scroll past, so >= 15pp is reported as SEVERE ("do not quote this to a decimal") while 5-15pp is logged as context. Both ride the price-fetch summary JSON under `unstable_figures`, so a cohort-sensitive figure announces itself in the run that produced it instead of waiting to be looked up. **Before quoting any figure in prose, a guide or a social post, check it.** Query:

```sql
SELECT segment, period, pct_change, stability_delta_pp, product_count
FROM market_stats WHERE stability_delta_pp >= 15 ORDER BY stability_delta_pp DESC;
```

Or run `node scripts/compute-market-stats.js`, which prints the same tiers. The write is probe-guarded: if the column does not exist the run logs and writes everything else rather than failing.

**IT SHIPPED DISABLED AND NOBODY NOTICED FOR A WEEK.** The tripwire landed in `dced4b94` probe-guarded so runs would succeed "before the ALTER TABLE lands", and the ALTER did not land until 2026-08-27. Every stats run in between computed the deltas and then silently discarded them, so `unstable_figures` never appeared in a summary and the query above returned an error. It surfaced only because the SSD guide build needed the deltas to check its own copy against them. **The generalisable lesson: a safety check that fails quiet is worse than no safety check, because it also manufactures confidence.** The guard now emits `*** STABILITY TRIPWIRE DISABLED: column missing ***` with the exact ALTER statement, and the cron summary carries `unstable_figures.disabled: true`, so `severe: []` can never again be mistaken for "we looked and found nothing". Verified by simulating the absent column against a fake client.

**THE RULE THIS GENERATED: prose makes claims that survive cohort choice; tables show the current computed figure.** A table cell is explicitly a snapshot, dated and methodology-linked, so it can carry a decimal. A sentence in a guide or a social post is quoted, screenshotted and re-read months later, so it must state a magnitude that stays true ("over 300%", "well over 150%") rather than a decimal that may not. See the guides section and the Price Index's tens-floor for the same principle applied.

**Market Pulse windows (`market_stats`).** One row per (segment, `period`) where period is `'1m'|'3m'|'6m'|'1y'` — 16 rows per cron run, all four windows pre-computed so the homepage switcher needs no client-side math and no per-click queries (one fetch of all 16 on load). Baselines: 1M targets 30d (window 25-35), 3M 90d (80-100), 6M 180d (165-195, the original), 1Y 365d (350-380). NOTE: `period` is spelled that way because **`window` is a reserved keyword in PostgreSQL** and would need quoting forever.

- **Current medians legitimately DIFFER between periods — this is not a bug.** The fairness rule applies independently per window: each period's figures are computed over its own matched subset (products with a baseline row in THAT window AND a current price), so a segment can show a different "current" median at 1M than at 6M (e.g. DDR4 $157.26 at 1M/3M vs $144.99 at 6M on 2026-08-21). Both medians within a row always come from the same subset, which is what makes the percentage honest. The UI shows **only `pct_change`** by design, so this never surfaces to readers — but anyone reading the table raw should not file it as an inconsistency.
- **Sample-size note is ONE-DIRECTIONAL:** the "n products" card note fires only when a period's `product_count` is >25% SMALLER than the same segment's 6M count. A larger sample is more robust, not less; the symmetric version fired only on 1M for DDR5/DDR4, annotating strength as weakness.
- **Snapshots:** `docs/market-snapshots/` holds dated captures of the full 16-row table (first: `2026-08-21.md`). These are evidence for the planned "Should I Buy RAM Now" guide; `scripts/output/` is gitignored, so snapshots must live in `docs/` to survive.

**DATA MODEL RULE (load vs state — do not blur these):** `price_history` is an **observation log**: one append-only row per real price sighting, never edited, never carrying synthetic values. `retailer_offers` is **current per-retailer state**: exactly one row per (product, retailer), upserted in place. Availability is state, so it lives in `retailer_offers` for BOTH retailers — never inferred from the newest log row, which structurally cannot express "we looked and there was no offer" (that bug shipped Amazon PDPs claiming In Stock for up to a month; see the Amazon stock section). Corollary: never write state into the log (no carried-forward prices to mark a gap — that would distort ATL/ATH/averages, which do not filter `in_stock`), and never treat the state table as history.

- **`products`** — one row per tracked product. Unique key: `sku`. Fields: `sku`, `name`, `category` (ram/ssd), `brand`, `model`, `image_url`, `product_url` (affiliate link), `retailer`, `parent_asin` (Amazon variation parent, from Keepa), `family_id` (capacity-family id: tier-1 `p:{parent}` / tier-2 `k:{key}`), `capacity_gb` (parsed total capacity), `upc` (comma-joined leading-zero-stripped barcode identifiers from Keepa, for tier-1.5 Newegg matching). Index on `family_id` (partial, `WHERE family_id IS NOT NULL`).
- **`price_history`** — one price snapshot per product per cron run. Fields: `product_id` (FK), `price`, `regular_price`, `in_stock`, `fetched_at`.
- **`alerts`** — user email + target price per product. Fields: `product_id` (FK), `email`, `target_price`, `triggered`.
- **`market_stats`** — one row per Market Pulse segment (`ddr5`/`ddr4`/`nvme_ssd`/`sata_ssd`), recomputed daily by the cron. Fields: `segment` (unique), `current_avg_price`, `baseline_avg_price`, `pct_change`, `product_count`, `computed_at`. Despite the column names, the values are **medians** (see Market Pulse Stats section).

Row Level Security is enabled on all tables. `products`, `price_history`, and `market_stats` are public read. `alerts` is service-role only (contains user emails).

## Environment Variables

Required in `.env` (local) and Vercel project settings (production):

| Variable | Purpose |
|---|---|
| `BBY_API_KEY` | Best Buy Open API key — dormant (access never approved; the Best Buy client is unused) |
| `PRICE_API_KEY` | PriceAPI.com key — evaluated July 2026 and ruled out (see Data Source Evaluation); used by the one-time catalog build, kept for reference |
| `KEEPA_API_KEY` | Keepa API key for Amazon price history (20 tokens/min plan) — **now a GitHub Actions secret**; no longer set in Vercel |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service role key (not the anon key) |
| `CRON_SECRET` | Random secret — Vercel sends as Bearer token to protect `/api/fetch-prices` |
| `RESEND_API_KEY` | Resend email sending API key — production key from resend.com |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key — from dash.cloudflare.com. Site key (public, already in frontend): `0x4AAAAAADTmp79GaQVF5cAu` |
| `RAKUTEN_AFFILIATE_ID` | Rakuten Advertising encrypted publisher id (11 chars, case-sensitive) for Newegg deep links — NOT the Publisher SID. Public once rendered; required by the generator whenever a Newegg offer exists |
| `RAKUTEN_SFTP_HOST` | Rakuten product-catalog SFTP host (`aftp.linksynergy.com`) for the Newegg feed |
| `RAKUTEN_SFTP_USER` | Rakuten SFTP username (`rkp_4705448`) |
| `RAKUTEN_SFTP_PASS` | Rakuten SFTP password — secret, from the Rakuten dashboard |

**Security notes:**
- `.env` must never be committed — it is (and must stay) in `.gitignore`
- `SUPABASE_SECRET_KEY` is the service role key — it bypasses RLS. Only used server-side.
- The cron endpoint checks `Authorization: Bearer <CRON_SECRET>` and returns 401 otherwise.
- The frontend only ever uses public/anon Supabase access (when that's wired up).

## How the Price Fetch Works (Keepa)

1. Vercel cron hits `/api/fetch-prices` **twice daily** at 08:00 and 20:00 UTC (two `vercel.json` cron entries pointing at the same path — Vercel Hobby runs each cron at most once/day, so two entries = twice/day; catches US-daytime repricing)
2. Handler verifies `Authorization: Bearer <CRON_SECRET>`
3. Loads the Amazon catalog from `products` (retailer=`amazon`, `sku` = ASIN)
4. Fetches current stats from Keepa in batches of ≤100 ASINs (`history=0&stats=90` — stats only, smaller payload, same token cost of 1/ASIN)
5. For each product with a current price, appends ONE `price_history` row (`fetched_at` = now, `regular_price` = 90-day stats max). Out-of-stock products (no valid current price anywhere) get no row and are counted in the summary. Per-product errors are isolated — one failure never kills the run.
6. Returns a JSON summary: `{success, source:'keepa', ram/ssd counts, out_of_stock, errors, tokens_left, duration_ms}`

The script can also run directly via `node api/fetch-prices.js` for manual testing.

**6x/day is safe for every `price_history` consumer** (each run appends one snapshot per in-stock product — six rows/product/day, ~1,410 Keepa tokens/day against a ~28,800 budget). Audited Aug 2026 against the PostgREST 1000-row response cap: `product-data.js` (listing + homepage) paginates both price queries, so nothing truncates; its windows were narrowed to match the cadence (latest 48h→12h, baseline 25-35d→28-32d — the narrow windows hold MORE sightings than the old wide ones did at 2x, so gap tolerance improved while row cost dropped ~3x). `marketStats` paginates and queries its four DISJOINT windows separately (one widened 25-380d query fetched 355 days of history to use 90); it recomputes on the **08:00 slot only**, since segment medians are a daily statistic. `latestCronBatch`'s `.limit(1000)` is safe by ordering (DESC, we take `[0]`) — see its comment, do not "fix" it into pagination. The chart downsampler keeps the last reading per UTC day, so six rows collapse to one point. The alert check's send-then-mark prevents double-emails; running 6x cuts delivery latency from 12h to 4h.
- **GitHub's scheduled runs are best-effort**: observed delays of 16, 16, 22, 27, 28, 31 and 60 minutes over the first full day (on-the-hour slots are the most contended). Nothing depends on exact timing, but `priceValidUntil` is padded by `FETCH_DELAY_PAD_MIN = 90` minutes past the next slot so the validity promise cannot expire before a delayed run lands. **Do not remove the pad** without re-checking observed delays.
- **TODO (not built): intraday downsampling.** At 6x the table grows ~515K rows/year (vs ~172K at 2x). Nothing is strained today (~73.5K rows), but the eventual mitigation is collapsing rows older than ~90 days to last-of-day, which restores the pre-migration growth rate while preserving every rendered chart point (the downsampler already shows last-of-day beyond a year).

**Best Buy client is DORMANT:** `backend/lib/bestbuy.js` is kept intact but unused (access never approved). If approval ever comes it can be revived as a second retailer source.

## Market Pulse Stats (`market_stats`)

Computed daily by the cron after price inserts (best-effort: a stats failure logs loudly but never fails the cron), shared logic in `backend/lib/marketStats.js`. Manual/immediate recompute: `node scripts/compute-market-stats.js` (auto-finds the latest cron batch, skipping backfill `T23:59` day-bucket timestamps).

- **Segments** (case-insensitive on product name): ram + `DDR5` → `ddr5`; ram + `DDR4` → `ddr4`; ssd + `SATA` or `2.5` → `sata_ssd`, **else** `NVMe` or `M.2` → `nvme_ssd`. SATA is checked FIRST — "M.2 SATA" drives are SATA-protocol despite the M.2 form factor. Non-matching products are excluded (count logged).
- **Median, not mean** — `current_avg_price`/`baseline_avg_price` hold MEDIANS of the segment. Single $1,900 outlier drives skew a mean at n=29–79; median is the honest "typical price" and resists catalog-composition drift.
- **Baseline** = each product's price closest to 180 days ago (window 165–195d).
- **Fairness rule**: `pct_change` compares medians over the SAME product subset — products that existed 180 days ago (row in the window) AND have a current price. New catalog entrants can't skew the comparison. `product_count` = subset size.
- **Current prices** are pinned to the cron batch's exact `fetched_at` timestamp — never `ORDER BY fetched_at DESC`, which the backfill `T23:59` day-buckets can win incorrectly.

## Frontend Data Access (anon key)

`frontend/js/supabase-client.js` initializes supabase-js v2 (jsdelivr CDN, UMD) with the **publishable (anon) key — public by design and safe to ship in frontend code**. RLS restricts it to SELECT on public tables. Do NOT "fix" this by hiding the key; NEVER put the service role key (`sb_secret_...`) in frontend/. `frontend/js/market-pulse.js` renders live `market_stats` on the homepage: hardcoded HTML values are the loading/fallback state (on fetch failure they stay — never a broken section); color rule: <0% green (`pulse-down`), 0–10% orange (`pulse-neutral`), ≥10% red (`pulse-up`) — rising prices are bad for buyers.

## Keepa Client (`backend/lib/keepa.js`)

Format rules the client absorbs (verified against Keepa's official `api_backend` library — callers never touch raw Keepa data):

- **Keepa minutes:** timestamps are minutes since 2011-01-01 UTC: `unixMillis = (keepaMinute + 21564000) * 60000`. Helpers `keepaMinutesToDate()` / `dateToKeepaMinutes()` are covered by self-test assertions (`node backend/lib/keepa.js`).
- **csv arrays:** `product.csv[i]` alternates `[keepaTime, value, ...]`. Index 0 = AMAZON, 1 = NEW (marketplace), 18 = BUY_BOX_SHIPPING (includes shipping — last resort only).
- **Prices are integer cents** (41999 = $419.99); the `stats` object uses the same convention.
- **-1 means no offer / out of stock** — never stored as a price. In parsed history it becomes a `price: null` gap marker.
- **Series preference:** AMAZON first; AMAZON's `-1` gap intervals are filled from NEW; if AMAZON has no data at all, NEW is used outright.
- **Outlier filter:** points > 5× the series median or < $5 are dropped (third-party garbage listings, e.g. $9,999 during stockouts). Dropped counts are logged per product.
- **Tokens:** every response updates `tokensLeft`/`refillIn`/`refillRate`; 1 token per requested ASIN (20 tokens/min plan). The client waits for refill automatically between batches and retries on token-shortage errors.

## Amazon Stock State (`backend/lib/amazonOffers.js`)

Amazon availability is current state in `retailer_offers` (`retailer='amazon'`, `retailer_sku`=ASIN, `match_method='direct'`), upserted every `fetch-prices` run and seeded once by `scripts/seed-amazon-offers.js` (live Keepa read, writes ONLY `retailer_offers`).

- **Stock semantics:** `in_stock` reflects availability of **the offer whose price we display**, i.e. `in_stock = (keepa.currentPrice(kp) !== null)`. It is NOT "Amazon sells it first-party". Measured Aug 2026: of 235 products, **69 priced from the AMAZON series and 159 from NEW (marketplace)** — defining stock as first-party availability would have marked 68% of a plainly buyable catalog unavailable.
- **Both directions:** going out of stock upserts `in_stock=false` **keeping the last known price** (so the UI can show "last seen $X" struck through); a reappearing offer upserts the new price with `in_stock=true`. Rows are never deleted and never carry a null price.
- **Why it exists:** `api/fetch-prices.js` previously did `if (price === null) { outOfStock++; continue; }` — it derived the out-of-stock fact correctly and then discarded it, writing no row. The last in-stock `price_history` row survived indefinitely and the generator baked `In Stock` from it. Seven products were affected, one stale for nearly a month.
- **Alerts are unaffected and already correct:** out-of-stock products never enter `currentPriceByProductId`, so no alert can fire on an unbuyable item.
- **UI treatment (both retailers, identical):** link stays **clickable** (deliberate — users can verify, restocks happen, marketplace may still have it), muted outline, struck price, explicit "Out of stock" text label (never colour alone), sorted last. The buy indicator drops to `--neutral` ("Currently unavailable") and the Price Analysis current-sentence becomes "Last seen at $X, currently unavailable at Amazon" — recommending a purchase on an unbuyable item reads absurd. `pdp-hydrate.js` mirrors all of this, so baked and hydrated states cannot disagree mid-session, and a restock un-mutes on the next load.

## Keepa Backfill (`scripts/backfill-keepa.js`)

One-time historical load of full Keepa price history into `price_history`:

- **Dry-run by default** — fetches from Keepa (consumes tokens) but writes nothing. `--confirm` writes.
- **Downsampled to daily:** at most one row per product per UTC calendar day (last reading of the day). Gap days carry the last known price with `in_stock=false` (schema requires `price NOT NULL`); leading gaps are skipped.
- `regular_price` = max stored price in the trailing 90 days (or null), applied per product.
- **Full replace semantics:** with `--confirm`, each product's existing `price_history` rows are deleted before its new rows are inserted — re-runs are safe/idempotent. Inserts go in chunks of 500.
- Per-product failures are isolated and reported in the final summary.

## Frontend State

The frontend is fully built and live. The listing pages (`/ram/`, `/ssd/`) and the homepage render live data from Supabase — Market Pulse, Biggest Price Drops, and the product grids all show real prices. The 235 product detail pages are statically generated with baked stats and hydrate the current price client-side (`pdp-hydrate.js`). Site-wide search is live against the static `search-index.json`. The homepage's old "coming soon" banner is gone, replaced by a live "Now tracking 235 RAM and SSD products" banner. The alert flow is fully wired to the backend (double opt-in, real POST) — not stubbed. Market Pulse and the grids keep their hardcoded HTML values only as loading/fallback state.

**Design system:** brand cobalt `#3A5BC7` (via `--brand-primary`/`--brand-hover`/`--brand-tint`/`--brand-light` CSS vars in `:root`), neutral grays, clean sans-serif. No CSS framework. Mobile responsive with breakpoints at 768px and 480px.

**Footer copyright line.** `© {year} MemRadar`, muted, as the last line of the footer. Deliberately **no "All rights reserved"** (legally vestigial, off-brand). Mechanism, and why: the footer is **duplicated markup on every page, not a shared include**, and `js/main.js` is absent from the three alert-result pages, so a shared-JS updater would silently skip them. Each footer therefore carries a literal year plus a one-line inline script that overwrites `.footer-year` with `new Date().getFullYear()` - self-contained, works everywhere, and the baked year is the no-JS fallback. For generated PDPs the generator stamps THIS build's year into that span (`buildYear` in `buildPage`), so no-JS visitors see the build year rather than whatever the template happened to contain. Net effect: the year cannot go stale for anyone with JS, and cannot be more than one regen behind without it.

**Tap targets.** 44px minimum on touch (`max-width: 768px`) for every interactive control: retailer strip buttons, capacity chips, filter sheet, nav, and the shared `.pdp-range-btn` (the PDP chart range control AND the homepage Market Pulse switcher). The range buttons are sized with `min-height`/`min-width` rather than padding, deliberately: the `480px` block sets narrower padding for compactness, and widening them horizontally would wrap the Market Pulse heading row for no tap-target gain, since `min-width` already guarantees 44px of horizontal target. Desktop stays ~27px on purpose (pointer precision differs; that still clears WCAG 2.5.8's 24px AA minimum). **When changing the range-button height, `.pulse-windows`'s `min-height` MUST track it** — that container is empty until `market-pulse.js` injects the buttons, so a mismatch reintroduces hydration CLS. Its `768px` override has to sit AFTER the base `.pulse-windows` rule in source order: a media query adds no specificity, so a later plain declaration wins regardless (this exact ordering bug produced a 17px shift mid-development).

**Retailer-semantic colors (NOT palette additions).** `--retailer-amazon` / `--retailer-newegg` (plus `-text` / `-border` pairs) exist for ONE purpose: identifying a retailer button in the PDP header strip. They are never accents, never reused elsewhere; cobalt remains the site's only accent system for everything that is not a retailer button.

- **Revisited 2026-08-21 (supersedes the Gate-2 decision):** the Buy Now table's buttons now use the SAME retailer colors as the header strip. The original ruling kept the table cobalt on a strip-primary / table-detail hierarchy; after seeing both sections together on live pages, Malcolm chose site-wide per-retailer color consistency instead. That hierarchy argument is superseded - do not revert the table to cobalt. Zero new colors were introduced: the table reuses the same `--retailer-*` variables, so the verified contrast pairings carry over unchanged (light Amazon 13.57:1, light Newegg 8.29:1, dark Amazon 5.42:1, dark Newegg 8.29:1). Out-of-stock overrides the retailer color in BOTH surfaces, so an unavailable retailer never wears its brand color as if it were buyable.

- **Amazon is navy, NOT orange, and this is deliberate — do not "fix" it.** Measured empirically (Aug 2026): Amazon's brand orange `#FF9900` and Newegg's `#FF9600` differ by a contrast ratio of **1.02:1**, i.e. indistinguishable. Two orange buttons side by side would defeat retailer differentiation entirely, so Amazon uses its other primary brand color, "squid ink" navy `#232F3E`.
- **Values and why:** light mode Amazon `#232F3E` + white text (13.57:1 text, 13.57:1 vs page); dark mode Amazon `#546C88`, a lightened navy from the same family, because squid ink is only 1.33:1 against the `#0f1623` dark page and would vanish (5.42:1 text, 3.34:1 vs page). Newegg `#FF9600` + `#0F1623` text in both themes (8.29:1), with a `#C97400` border in light mode because the orange is only 2.18:1 against a white page and needs a 3:1 boundary (WCAG 1.4.11). Every pairing clears AA for text (4.5:1) and 3:1 for the control boundary, in both themes. **Re-verify contrast if any of these values change.**
- **Logos: deliberately text-only for now.** Amazon's Associates policy DOES permit displaying their marks "only by display on your Site with the purpose of advertising availability of products on an Amazon Site, with a corresponding Special Link" (<https://affiliate-program.amazon.com/help/operating/policies>), but also states "You may not alter any Amazon Mark in any manner. For example, you cannot change the proportion, color, or font," and **any violation automatically terminates the license to use the marks**. A logo traced or reconstructed from memory is exactly such an alteration, so no mark was drawn. Official assets must come from the source: Newegg's from the Rakuten Advertising publisher creative library, Amazon's from their brand portal. **Future follow-up (Malcolm to supply the files):** drop the official SVGs into the strip buttons at ~16-20px with proper alt text, unmodified.
- **Out-of-stock retailers stay visible** in the strip: muted outline, struck-through price, explicit "OUT OF STOCK" label, sorted last. Omitting them would silently answer "did you check the other retailer?" with nothing, reading as never having checked (same honesty rule as the three-state stock badge). The text label is required so muting is never the only signal.
- **Single source:** `retailerList()` in `scripts/generate-product-pages.js` builds the sorted retailer array (in-stock first, then cheapest, Amazon as stable tiebreak) that feeds BOTH the header strip and the Buy Now table, so affiliate wrapping, `rel` attributes, stock semantics, and sort order cannot drift between the two surfaces. Strip prices hydrate with the existing price recompute (`pdpStripAmazonPrice` joins `priceEls`; `pdpStripNeweggPrice` updates in `recomputeNeweggOffer`); the strip reserves `min-height: 44px` so hydration cannot shift layout.

**Homepage "Biggest Price Drops"** (`frontend/js/home-drops.js`): the 4 products with the largest live 30-day price DECREASE, as `.listing-card`s (image, brand badge, price, green ▼ drop %, "Amazon", card→PDP link, "View on Amazon" affiliate link, "Track Price" → alert modal pre-filled via `window.memradarAlertModal.openForProduct`). If fewer than 4 products have a negative 30-day change, remaining slots fill with products CLOSEST to their all-time low (using `all_time_low` from `search-index.json`), and the fill mode per slot is logged. Degrades by omission — the whole section hides on any fetch failure. `search-index.json` now includes `all_time_low` (added to the generator; regenerate to refresh).

**Shared data layer:** `frontend/js/product-data.js` — `window.memradarProductData.load(sb, category?)` runs the three-query live-price pattern (products + latest-48h + 30d-baseline, client-reduced) and returns products with `.price`/`.change30`. Used by BOTH `product-listing.js` and `home-drops.js` (must be included before either). Move price joins to a Postgres RPC/view if the catalog exceeds ~500 products.

## Deployment Status

- **GitHub Pages:** Live at [memradar.com](https://memradar.com). Deployed via GitHub Actions workflow (`.github/workflows/deploy-frontend.yml`) — triggers on any push to `main` that touches `frontend/`.
- **Custom 404 page:** `frontend/404.html` is served automatically by GitHub Pages for any missing URL. A copy lives at `frontend/404/index.html` so `memradar.com/404/` works as a clean URL — both files are identical and use absolute asset paths so they work from either location. Note: a Cloudflare redirect from `memradar.com/404.html` → `memradar.com/404/` would be clean, but `404.html` must remain at root level for GitHub Pages' automatic 404 handling — it cannot be moved.
- **Custom domain:** memradar.com — fully configured. Cloudflare DNS A records point to GitHub Pages IPs, SSL/TLS set to Full, CNAME file committed to `frontend/`. Custom domain set in GitHub Pages settings.
- **Vercel:** Live. All env vars set in Vercel dashboard. The twice-daily Keepa fetch is live and populating `price_history`. `BBY_API_KEY` is a vestigial `pending` placeholder — the Best Buy client is dormant and unused.
- **Data pipeline:** Live via Keepa — the twice-daily cron fetches Amazon price stats and appends `price_history` rows. (Best Buy API access was never approved; that client is dormant — see the Keepa section and `bestbuy.js`.)
- **Google Search Console:** memradar.com added as a property. Sitemap submitted at `https://memradar.com/sitemap.xml`.
- **Google Analytics:** GA4 installed on all HTML pages. Measurement ID: `G-797Q89S8GG`. Snippet is in the `<head>` of every page.
- **SEO:** Full SEO pass complete. All pages have unique titles, descriptions, Open Graph, Twitter cards, canonical tags, and JSON-LD structured data (WebSite schema on homepage, WebPage/ContactPage on inner pages). Keywords targeted: "RAM price tracker", "SSD price history", "DDR5 price drops", "PC memory deals", "best time to buy RAM", "SSD price alert".
- **Brand assets:** `frontend/brand/` holds `og-image.png` and `og-image.svg` for safekeeping. **Corrected 2026-08-27:** this entry previously also listed `memradar-x-header.png` and `memradar-x-profile.png`; neither file exists in `brand/` nor is tracked anywhere in the repo (`git ls-files | grep memradar-x` returns nothing). They were presumably uploaded straight to X and never committed. If the Bluesky account ever needs banner/avatar art, it starts from scratch or from `favicon-source.svg`.
- **OG image:** `https://memradar.com/og-image.png` — live and confirmed working (1200×630px). Source SVG at `frontend/og-image.svg` for future edits. Convert with Sharp: `node -e "require('sharp')(fs.readFileSync('frontend/og-image.svg')).png().toFile('frontend/og-image.png', ...)"` .
- **Favicons:** Full set generated from `frontend/favicon-source.svg` using `node scripts/generate-favicons.js` (requires sharp + to-ico dev deps). Files: `favicon.ico` (16+32px), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180px), `android-chrome-192x192.png`, `android-chrome-512x512.png`, `site.webmanifest`. All 6 HTML pages include the full favicon `<link>` block.
- **Privacy policy / GA cookies:** Resolved — `privacy.html` updated to accurately state that Google Analytics is used and may set anonymous cookies for traffic measurement.

## Blog

`frontend/blog/index.html` — blog index page, serves at `/blog/`. Individual posts live at `blog/[slug]/index.html` (GitHub Pages serves these as clean URLs automatically).

**Current posts:**
- `frontend/blog/why-ram-prices-are-so-high/index.html` — "Why RAM Prices Are So High Right Now" (published 2026-05-22)

**Structure notes:**
- All blog pages use absolute asset paths (`/css/style.css`, `/js/*.js`) since they're nested 2–3 levels deep
- Article pages include: breadcrumb, article header (h1, date, badge, read time), SVG hero, full article body, CTA box (`btn-alert` triggers alert modal), share buttons (`.pdp-share-btn` pattern)
- JSON-LD on index: `Blog` schema. On article pages: `Article` schema with `datePublished`, `dateModified`, `author`/`publisher` as Organization
- Blog linked from nav and footer on every page

## FAQ Page

`frontend/faq/index.html` — serves at `/faq/`. Accordion-style Q&A page with 13 questions covering what MemRadar is, how price tracking works, retailers covered, how alerts work, and more.

- SEO: `FAQPage` JSON-LD schema included — Google can show FAQ rich results directly in search
- First question open by default; clicking any question toggles it open and closes others
- Vanilla JS accordion — no libraries, inline IIFE at bottom of the file
- Linked from nav and footer on every page
- Added to sitemap.xml with `changefreq: monthly`, `priority: 0.7`

## Listing Pages

`frontend/ram/index.html` and `frontend/ssd/index.html` are LIVE — wired to real Supabase data via `frontend/js/product-listing.js` (shared by both, category detected from `data-category` on `.listing-grid`). Clean URLs (`/ram/`, `/ssd/`) via folder-based index files.

**Data load — THREE queries, all reduced client-side (no N+1):**
1. `products` for the category (retailer=`amazon`)
2. `price_history` in the last 48h → reduce to newest row per product = current price
3. `price_history` 25–35 days back → reduce to row closest to 30d = baseline for the 30-day change indicator (no indicator shown when a product has no baseline)

All queries paginate at PostgREST's 1000-row cap. At ~120 products/page this is a few hundred KB. **If the catalog grows past ~500 products, move steps 2–3 to a Postgres RPC/view** returning latest + 30d-ago per product server-side.

**Rendering (`.listing-card`):** product image (with gray-placeholder fallback on error), brand badge (omitted entirely when `brand` is null — never an empty/"null" badge), current price, 30-day change indicator (green ▼ for drops, red ▲ for rises, nothing if no baseline), and a "View on Amazon" affiliate button. Each card carries `data-sku` (used by the "Track Price" alert flow) and links to its PDP. Default sort is Name A–Z; skeleton grid (8 pulsing cards) shows while loading; a live "Showing N products · Prices updated twice daily" count sits above the grid.

**Affiliate links convention:** product URL + `?tag=memradar-20`, with `rel="nofollow sponsored noopener noreferrer"` and `target="_blank"` (SEO for paid links + external-link security).

**Filters/sorts — all client-side over the fetched dataset (AND across groups, no re-queries):**
- RAM: Type (name substring DDR5/DDR4), Capacity (**kit rule**: the total capacity that appears BEFORE the first "(" — "32GB (2x16GB)" matches 32GB — else the largest capacity token), Speed (parsed MHz/MT/s banded; excludes bandwidth codes like PC5-48000), Brand (exact match on `brand` column).
- SSD: Type (**SATA-first** — SATA in name wins over M.2, matching `marketStats.js`), Form Factor (M.2 / 2.5"), Capacity (500GB/1TB/2TB/4TB+; capacity regex excludes `TBW` endurance and `Gb/s` interface-speed false positives), Brand.
- Brand pills use an alias map (`WD` → `Western Digital` column value).
- Sorts: Price L→H, Price H→L, Biggest Price Drop (no-baseline products sort last), Name A–Z.
- Empty filter result → "No products match these filters" + Clear Filters button.

**Brand-pill rule (general):** brand filter pills must reflect brands actually present in the catalog with **at least 3 products** — otherwise a pill only ever yields the empty state. Revisit the pills whenever the catalog changes materially. Current pills: RAM = Corsair, G.Skill, Crucial, Kingston, TEAMGROUP; SSD = Samsung, WD, Crucial, Kingston, TEAMGROUP, Silicon Power.

**Unfilterable products (graceful-null note for the static-gen/PDP phase):** 9 products (as of 2026-07-22) have titles missing a token, so they don't match one specific filter (still reachable via All/Type/Capacity): 1 RAM lacks a parseable speed (`B0BQWXTDWN`), and 8 SSDs lack an "M.2"/"2.5" form-factor token (all M.2 drives: `B0B3RP4XCG, B0CK39YR9V, B0CK2RKPBL, B0DBBG7CG7, B0DBBJSGFQ, B0CK2R8YLY, B0CTRV9CVP, B0DZ5ZK225`). The full list is also commented in `product-listing.js`. PDP spec tables must handle these nulls gracefully.

**Fallback:** the `.listing-empty` radar-pulse block is now the JS-failure fallback only (hidden by default; shown with "Having trouble loading prices — try refreshing." on fetch error, logged to console).

**Back to top (`frontend/js/back-to-top.js`, listing pages + generated PDPs):** a circular floating button (bottom-right, safe-area-inset padding, 48px tap target, `aria-label="Back to top"`, real `<button>`) that smooth-scrolls to the top. Self-contained — it creates its own element, so a page just includes the script. On the two listing pages (after `filter-sheet.js`) and on every generated PDP (in the generator's `buildScripts` list); the tall decade-history PDPs benefit most. Homepage stays out (too short). Visibility uses a `requestAnimationFrame`-throttled scroll read (`scrollY > 1.5 viewports`), chosen over an IntersectionObserver sentinel because a 1.5vh marker would add phantom scroll height on short filtered result sets. Respects `prefers-reduced-motion` (instant jump, no rise animation). z-index 90 — under the filter sheet (900) and alert modal (1000), so those overlays cover it. Dark-mode styled.

**Mobile filters — bottom sheet (`frontend/js/filter-sheet.js`, ≤768px only):** the visible filter stack consumed 35–42% of the mobile viewport, so at the mobile breakpoint the filter rows collapse into a bottom sheet. **DOM-move, not duplicate:** filter-sheet.js physically moves the existing `.filter-row` elements into the sheet (and the Sort group into a slim control bar) via a `matchMedia('(max-width:768px)')` listener, and moves them back at desktop width — so `product-listing.js` keeps its click handlers on the same elements and remains the single source of truth for filter/sort state (`?q=` search, count line, all logic unchanged). The only `product-listing.js` change is one additive line: `updateCount` dispatches a `memradar:listing-count` CustomEvent that feeds the sheet's live "Show N products" button and the "Filters · N" badge (N = non-All selections). Desktop ≥769px is pixel-identical to before (all new CSS is media-scoped or sheet-only). Sheet z-index 900 (above header/search 100/300, below the alert modal 1000). Scroll lock via `body.filter-sheet-open` (mirrors `mobile-nav-open`); only one overlay open at once — opening the sheet clicks the mobile-nav toggle closed. Close via X / backdrop / swipe-down on the header / Escape; focus moves into the sheet on open and back to the Filters button on close. Included after `product-listing.js` on both listing pages.

**JSON-LD:** `ItemList.numberOfItems` is set to the real counts (119 RAM / 116 SSD) statically. Full `itemListElement` population isn't possible in static HTML — it happens in the future static-generation phase.

**Files:**
- `frontend/ram/index.html` — DDR5/DDR4 RAM listing (serves at `/ram/`)
- `frontend/ssd/index.html` — NVMe/SATA SSD listing (serves at `/ssd/`)
- `frontend/js/product-listing.js` — shared data load + render + filter/sort
- `frontend/js/filters.js` — the old console.log stub, now UNUSED (superseded by product-listing.js; no longer included on the pages)

## Product Detail Pages (Static Generation)

**235 statically generated pages** at `/ram/{slug}/` and `/ssd/{slug}/` — one real directory + `index.html` per product, full content baked in at build time (the Cyrilica lesson: every URL returns a 200 with real HTML, no JS routing). Generated by **`scripts/generate-product-pages.js`**:

- **Dry-run by default** (reports slugs/collisions/data problems); `--confirm` writes pages + slugs + sitemap.
- **Template as input:** `frontend/ram/product-template.html` supplies the skeleton (head, header/nav, footer, asset includes); the numbered content sections and variable head meta are regenerated per product. The generator **throws if template anchors are missing** — template drift can't silently mis-generate. The template file itself carries `<meta name="robots" content="noindex">` and stays out of the sitemap; generated pages have the noindex stripped.
- **SLUG COVENANT (SEO):** slugs live in `products.slug` (unique). A stored slug ALWAYS wins over a computed one — **URLs never change once a page exists**. New slugs are computed only for slug-less products (brand + meaningful name prefix + capacity/speed, ≤80 chars, `-2`/`-3` suffix on collision) and written back on `--confirm`. Never rename or clear stored slugs.
- **Idempotent regeneration:** every generated page contains a marker comment; regeneration deletes ONLY directories whose `index.html` carries the marker, then recreates. `/ram/index.html`, `/ssd/index.html`, and the template are untouchable by design.
- **Baked chart data:** full price history is inlined as `<script type="application/json" id="priceHistoryData">` `[["YYYY-MM-DD", price], …]` — daily within the last year, weekly 1–3yr back, monthly beyond (decade histories ≈432 points max). Range buttons (1M/3M/6M/1Y/All) filter the baked data client-side; no Supabase query for initial render. Chart.js from cdnjs.
- **Honesty rules baked in:** no star ratings (no review data); specs table renders only confidently parsed rows; <30-day histories get a "Limited price history — tracking since {date}" note and the stats/indicator say "average since tracking began"; buy indicator (good/caution) uses real percentages; JSON-LD Product schema uses the canonical URL (never the affiliate link) and real availability.
- **Capacity families (variant chips):** PDPs in a family render a capacity-chip selector in the product header (`Available capacities:` + `[1TB $92.99] [2TB viewing] [4TB $399.99]`), with a subtle `best $/GB here` badge on the family member with the lowest current price-per-GB. Chips ascending by capacity; the current product's chip highlighted + non-link; siblings link to sibling PDP slugs. Singletons render nothing.
  - **Two-tier grouping** (`scripts/build-families.js`). TIER 1 (authoritative) = products sharing Amazon's own parent ASIN (`products.parent_asin`, fetched by `scripts/fetch-parent-asins.js` from Keepa's `parentAsin`); `family_id = "p:{parentAsin}"`. We mirror Amazon's grouping even where it mixes speeds/CL/heatsink (its variation set is what shoppers see as "the same product's options"; the chip axis is capacity and each landing PDP fully discloses its own specs). TIER 2 (heuristic, conservative) = for products with no shared parent, a name-derived line signature (name minus brand/capacity/kit-config/speed/CL/throughput/generic-filler) plus hard invariants that MUST match: RAM = DDR gen + speed + CL + module form (SODIMM vs DIMM); SSD = protocol (SATA-first) + form factor + PCIe gen + heatsink presence. Unknown is never a wildcard (no-CL only groups with no-CL). `family_id = "k:{slug}"`. Refuses to merge products carrying different non-null parent ASINs.
  - **Determinism / stability covenant:** family ids derive only from parentAsin or the normalized key, so re-runs produce identical ids (same covenant as slugs). **Once shipped, families must not reshuffle** - changing the tokenizer/invariants can change ids and break cross-links, so treat such changes like slug changes.
  - **Canonical rule:** within a family, same-capacity duplicates resolve to the CANONICAL member = deepest price history, tiebreak lexicographic ASIN. The capacity chip links to the canonical; a non-canonical dup still gets its own PDP where its own capacity chip is the highlighted "viewing" one and the OTHER capacities link to canonicals. The generator recomputes canonical from `stats.days` (monotonic with the raw row count build-families uses, so same result).
  - **Minimum family size: 2 DISTINCT capacities.** `capacity_gb` comes from `productParsers.js` (single source); unparseable-capacity products are excluded (no capacity axis).
  - **Chip hydration** (`pdp-hydrate.js` `recomputeCapacityFamily`): sibling chip prices + best-$/GB refresh live via ONE `.in('products.sku', [siblingSkus])` price_history query (window + reduce to latest-per-sku), alongside the existing single-product hydration. Sibling skus/caps/baked-prices live in `#pdpHydrateConfig.famChips` (omitted entirely for chip-less pages so their config stays byte-identical). Graceful fallback to baked values on failure. The `best $/GB here` badge uses `display:none` (removed from the a11y tree), and hydration toggles the `--best` class.
  - **CATALOG-CHANGE RULE:** adding/removing catalog products requires re-running `fetch-parent-asins.js --confirm` then `build-families.js --confirm` BEFORE regenerating PDPs, or new products won't get chips and existing families may be stale.

- **Structured-data policy (standing):** We don't assert third-party merchant policies (returns, shipping) in structured data; we are not the merchant, and per Google's merchant-listing eligibility rules, link-out pages aren't eligible for those experiences regardless. The two Search Console warnings for these fields (`hasMerchantReturnPolicy`, `shippingDetails`) are accepted permanently. The `aggregateRating` and `review` warnings are likewise accepted permanently — we hold no review data and will never emit fabricated rating schema. Total accepted Search Console structured-data warnings: 4 (`hasMerchantReturnPolicy`, `shippingDetails`, `aggregateRating`, `review`), all deliberate.
- Stats per page (computed from full history at build time): current, all-time low/high with month+year, 90-day average, 30-day change, price-per-GB vs segment median $/GB.
- **Price hydration (`frontend/js/pdp-hydrate.js`):** prices update twice daily WITHOUT regeneration, so the baked current price would go stale. On load, the PDP fetches its latest `price_history` row from Supabase (embedded query on `products.sku`, filtered `fetched_at <= now` to skip backfill T23:59 buckets) and replaces the baked **current-price displays** (`#pdpCurrentPrice`, `#pdpBuyPrice`) and the **"Last updated"** line (`#pdpLastUpdated`) with a relative time ("Updated 3 hours ago"). It also **recomputes the price-derived UI for coherence**: the good-time-to-buy verdict (vs the baked 90-day average) and the price-per-GB line, using thresholds baked into `#pdpHydrateConfig` — **single source**: the constants `BUY_GOOD_MAX_RATIO`/`VALUE_LOW_RATIO`/`VALUE_HIGH_RATIO` live in the generator, drive the baked HTML, and are baked into the config so the browser reuses identical values (no magic numbers in `pdp-hydrate.js`). The **90-day average itself stays baked** (moves slowly; recomputing would need the full history). Fails gracefully — baked values remain on any error. Requires `supabase-client.js` on PDPs (added to the generator's script list).
- **Price Analysis (`Price Analysis` block in the stats region), REWRITTEN IN R1 (2026-09-01):** **every sentence is conditional.** Each renders only when the figure behind it is notable and is OMITTED rather than softened when it is not; a page with nothing notable renders **no section at all** (23 of 235 today; distribution 0:23, 1:106, 2:82, 3:24, mean 1.46). Conditions: at/within 5% of the all-time low, at/within 5% of the all-time high, unavailable (terminal, suppresses the rest), a 30-day move beyond +/-5%, and $/GB beyond +/-7% of the segment median (the existing `VALUE_LOW/HIGH_RATIO` 0.93/1.07 stay the single source). **WHY: measured 2026-09-01 across a 20-page sample (10 thinnest + 10 deepest), 17 sentence skeletons covered all 100 sentences, one appeared on all 20 pages, and 0% were unique to a page once segment labels were normalised.** The paragraph always said something, so it said the same thing everywhere, which is the scaled-content pattern the August 2026 spam update penalises. **The always-present all-time-low/high sentence is deleted**, as are the tracking-provenance and buy-verdict sentences (neither was notable-gated, and "thin pages 0" is impossible while they render). All surviving sentences are current-price dependent, so all of them hydrate: `pdp-hydrate.js analysisSentences()` mirrors the generator EXACTLY (same order, same thresholds passed via `#pdpHydrateConfig`, same wording) and **hides the whole section when the live price makes nothing notable**, rather than leaving baked sentences standing that were true at build time and are not now. Verified byte-identical baked-vs-mirrored on the R1 gate samples. No em dashes; all figures numbers/dates/enums. Regenerate to change.
- **Amazon staleness disclaimer:** a muted "Price may have changed on Amazon since our last check." line sits under the Buy Now button (`.pdp-amazon-disclaimer`).
- Similar Products: 3 same-segment products nearest by current price, linking to their generated URLs.
- **Regeneration workflow (manual for now):** `node scripts/generate-product-pages.js --confirm`, then commit + push (generated pages ARE committed — they're the deployed site), then purge Cloudflare. **TODO:** daily automated regeneration via a scheduled GitHub Action (not built yet).
- Sitemap: regenerated on each run — static URLs preserved, product URLs replaced (priority 0.6, changefreq daily, lastmod = build date).
- Listing cards link to PDPs (whole card + name link; the Amazon button stays a direct affiliate link via stopPropagation). `slug` is included in the listing page query.

## Recovery Build R1 (2026-09-01, after the August 2026 spam update)

Impressions collapsed 96% on 2026-08-23 (rollout Aug 18-21); indexing and crawling were unaffected, which points at **thin affiliation + scaled content**, not a technical fault. A sizing pass found the pattern was **site-wide, not thin-page-specific**: 0% of Price Analysis sentences were unique across a 20-page sample, 85% of h1s were raw Amazon titles over 100 characters (median 150), and ~28 pages were duplicates or slug collisions. R1 fixes the structural pattern.

**H1 AND NAMING.** The h1 was the raw Amazon marketing title: median 150 chars, max 202, keyword-stuffed, near-identical across siblings. That is the visible signature of the thin-affiliate pattern. Now the h1 is the concise product name (median 31, max 56, **0 over 60**), and the raw title is demoted to a muted, explicitly attributed `Amazon listing:` line below the spec summary. It is KEPT because it carries model tokens and capacity strings people search, and MPN queries were our best-ranking queries; it just no longer competes with the real name.

**MANDATORY TOKENS ARE NEVER DROPPED**, and this is the rule most likely to be broken by a future "small" change. Capacity always; DDR generation and speed for RAM; interface (NVMe/SATA) for SSD. Filler (`RAM`, `Memory`, `Kit`, `Internal`, `DRAM`, and `SSD` when the interface token is present) is stripped FIRST to make room, then any missing mandatory token is appended. **Measured before/after: 180 of 235 names were missing at least one mandatory token under the old 35-char builder (speed 104, capacity 66, interface 66, DDR gen 35); 0 of 235 after.** Truncation is mandatory-aware (`fitName`), because plain truncation eats exactly these tokens: they sit at the END of a marketing title.

**h1 and `<title>` have SEPARATE builders, deliberately.** An h1 has no SERP length constraint; a `<title>` does. `H1_NAME_BUDGET = 64`, `TITLE_NAME_BUDGET = 49`, and the title suffix is adaptive (` Price Tracker | MemRadar` when it fits, ` | MemRadar` otherwise) so every title lands <= 60. The title is FITTED from the h1 name by dropping non-mandatory words, never by blind truncation. **Both mandatory tokens AND the disambiguation token are protected during fitting** - the latter is the only thing separating a page from its sibling, so dropping it recreates the duplicate-title problem.

**TWO TRUNCATION BUGS FOUND AND FIXED HERE, same shape, worth remembering:** re-truncating a name to make room for a suffix can delete the substring that made the name distinct. `WD_Black SN7100 2TB` and `WD_Black SN8100 2TB` both collapsed to `Western Digital WD_Black 2TB`; later, `fitName` dropped `CL36`/`White` and collapsed three Corsair pages into one title. Names are now built from the GROUP KEY (the string that defined the group) and both passes end with a **hard uniqueness guarantee**: any surviving collision falls back rather than shipping a duplicate.

**SIBLING DISAMBIGUATION: never ship an ASIN fragment as a user-facing name.** `assignTokens` tries single parsed attributes (capacity, kit config, speed, CL, colour, heatsink, pack, form factor) then two-attribute composites. R1 added **capacity** and **kit config**, which alone took ambiguous groups from 16 (49 pages) to 7 (21). Excluding relisting duplicates from disambiguation resolved another (the builder had been trying to invent a difference between two listings of one product). **Everything still unresolved goes to `scripts/title-overrides.js`, hand-curated and human-approved**, read off the raw listing title. Overrides beat the automatic builder, and **the mandatory-token rule applies to them too** - an override bypasses the builder and therefore also bypasses its guarantees. Final state: 0 groups needing a ruling.

**DUPLICATES: ruled per pair on evidence, not heuristics.** 25 distinct pairs across the family+capacity and slug-collision sets. The decisive evidence is the **manufacturer part number**: a distinct MPN means a distinct physical product. 24 are VARIANT (both pages live, differentiated names); **1 is a RELISTING** (`B0BF8FVLSL` -> `B0C4G6XQQL`, identical MPN `F5-6000J3038F16GX2-TZ5NR`, identical specs, r=0.99). A relisting **keeps its page**, **inherits the canonical's name verbatim** (inventing a difference would contradict the canonical), carries `rel=canonical`, and is dropped from BOTH sitemap and search index. `RELISTINGS` in the generator is human-gated; never add entries from a script.

**GRACEFUL DEGRADATION: a section renders only when there is data behind it.** `MIN_POINTS_AVG90 = 10` (a "90-day average" off 8 sightings is arithmetic wearing the costume of a statistic; the buy indicator and value verdict omit with it, 2 pages), `MIN_POINTS_EXTREME = 5` for all-time low/high (0 pages), Part number row omitted where the MPN is unparseable (77 pages; **omit beats guess**). TODO, not built: a UPC row could serve as the identifier line on those 77, since we hold UPCs for many.

**INDEX ELIGIBILITY BY DATA DEPTH.** Under `MIN_DAYS_INDEXABLE = 30` tracked days a PDP gets `noindex,follow` and leaves sitemap.xml and search-index.json. **`follow`, not `nofollow`**, so the page still passes link equity into the catalog. 3 pages today. Recomputed from live data on EVERY regen, so a page **flips back automatically** the first run after it crosses the line; nothing to remember and nothing to clean up. The sitemap parity assertion compares against *indexable*, not *generable*: submitting a URL you have told Google not to index is a contradiction, not a hint.

**META DESCRIPTIONS are assembled greedily from this product's own numbers**, clauses added in priority order until the description clears 120 and stopping before 158. Clauses whose data is missing or untrustworthy are skipped rather than faked, which is why assembly is greedy rather than a fixed template: a page with no 90-day average still has to reach 120 honestly. **The FLOOR is measured on the RAW string and the CEILING on the escaped one** - Google counts rendered text, while the ceiling is about the HTML attribute; a name containing `2.5''` (`&#39;&#39;`) makes them differ enough that testing the floor against the escaped length accepted a 117-character description as in-band.

**THE HONEST FLAG MOVED FROM PROSE TO THE BUY INDICATOR, and is not optional.** When `buyState()` is good AND the current price is >= `INFLATION_ATL_RATIO` (1.5) x the all-time low, the indicator's sub-line gains `", though still N% above its all-time low of $X (Month Year)"`. It previously lived in the Price-Analysis verdict sentence, which R1 deleted for rendering unconditionally. **A conditional clause on a UI element is not the template problem returning**: it is absent from every page where the condition does not hold. It derives from the same `buyState()` the indicator uses and hydrates WITH the indicator, so the two cannot contradict. **91 pages carry it**, of 100 showing "Good time to buy". Scoping is deliberate: **206 of 235 products now sit at 1.5x or more above their all-time low** (measured 2026-09-01; the previously recorded ~143 was stale, memflation has deepened), but on the 106 showing "Price is elevated" the caveat is redundant because the indicator already says the price is high.

**MPN PARSER FIX (`backend/lib/productParsers.js`).** `MPN_SPEC_TOKEN` covered `PC3`/`PC4` but not `PC5` or codes with trailing letters, so 13 of 235 products parsed a bandwidth code (`PC5-48000`, `PC4-3200AA`) as their part number. Harmless while the MPN was an internal matching hint; **not harmless once R1 printed it as a labelled "Part number" row**. Now `PC[3-5][-\dA-Z]*`, 0 bogus, 158/235 with a real MPN. Verified against the live 1.38 GB Rakuten feed by running the matcher dry-run with BOTH parsers and diffing: **0 (sku, neweggSku) pairs changed**; one product moved UP from a tier-1.5 UPC proposal to a tier-1 MPN match pointing at the identical Newegg SKU. Stricter can only reduce false matches, and matching is human-gated with rulings keyed on sku+neweggSku.

## Recovery Build R2 (2026-09-02): structural variation

R1 removed the spam pattern. R2 adds content whose **COMPOSITION** differs across pages, not merely its values. **That distinction is the whole point: a block whose contents, length and membership vary per product is distinct content; a block with the same shape and different numbers is a template.** Every block hides beneath its own data minimum (the R1 rule), and every intro line is ONE short sentence, because the variation has to come from the data rather than from prose written around it.

**1. PRICE HISTORY TABLE** (`<details>`, below the chart). Monthly rows for the last 24 months, yearly rows for anything older, from the baked chart series. **Rows exist only where data exists and gaps are OMITTED, never zero-filled**, because a zero row asserts a price we never observed. Plain `<table>`, no canvas, fully crawlable: this converts the site's actual asset, a decade of prices, into text, and is unique per page by construction. Renders on **234 of 235** (minimum 3 rows; a two-row table is a restatement of the stats card). Rows per table: min 4, median 24, max 35.

**2. PRICE MILESTONES.** Only events that exist render: first tracked, all-time low, all-time high, biggest single-day drop, longest stretch within 2%, and most recent all-time low if within 12 months. Renders on **235 of 235** at 4 to 6 events (histogram 4:3, 5:190, 6:42). **Note the count varies less than the brief anticipated** (no page falls to 2) because first-tracked, the two extremes and the biggest drop exist for almost every product; the COMPOSITION still differs, and thin recent products are the ones that carry "Most recent all-time low" while deep ones carry the long flat stretch. The all-time-low/high sentence deleted from Price Analysis in R1 lives here now, as a dated fact rather than a sentence on every page.

**3. PEER COMPARISON.** 3 to 5 in-stock products of the same segment and capacity (RAM: same DDR generation, closest speeds; SSD: same interface and form factor), each row linking out with price, $/GB and delta against this product's $/GB. **SELECTION IS DETERMINISTIC FROM SPECS, NEVER FROM PRICE**, so the SET is stable day to day while the PRICES hydrate; a set that reshuffled on every price move would look generated and would churn the internal links. Excludes noindexed pages and the relisting duplicate. Renders on **218 of 235** (minimum 2 peers; 7 pages have no peer, 10 have one). **It is the strongest internal-link structure on the site: 1,069 new internal links.**

**4. SPECS EXPLAINED** (`<details>`, with the Specifications section). Pulls glossary entries ONLY for terms this product carries, from parsed specs and detected name tokens, each linking to its anchor on `/glossary/`. Renders on **235 of 235** at 2 to 7 entries (median 5; histogram 2:18, 3:23, 4:71, 5:62, 6:48, 7:13). **The three price terms are marked `pdp: false` and live on /glossary/ only**: they applied to almost every product, which pushed the median pull to 8 with 3 identical site-wide, and a block whose membership barely varies is the template shape R2 exists to avoid. `TBW (endurance)` is never pulled because no product in the catalog names it; it exists on /glossary/ for reference.

**`/glossary/`** carries all 23 entries with stable anchors, a `DefinedTermSet` JSON-LD graph, sitemap priority 0.5, and a footer link beside Price Index. **`scripts/glossary.js` is the source of truth and its wording is VERBATIM from the authored source; do not paraphrase it.** Each definition is written to stand alone if quoted in isolation (subject named, no dangling "it") and to end with a buyer-facing implication that differs per term. The sitemap now GUARANTEES its static entries rather than only carrying forward whatever the previous XML held, so a newly generated static page cannot be silently missing.

**Byte cost, measured across all 235:** raw HTML median 39KB -> **49KB**, max 54KB -> **55KB**; gzipped median 11KB -> **13KB**, max 15KB -> **15KB**; catalog total 2.45MB -> **3.07MB** gzipped. The history table is the bulk of it and needs no row cap: the yearly section tops out around 11 rows on the deepest products, and the gzipped p90 moved 11KB to 14KB.

### THE SCRIPT-ORDER BUG THIS BUILD UNCOVERED (read before touching buildScripts)

**`pdp-hydrate.js` was loading BEFORE the `#pdpHydrateConfig` JSON node existed in the DOM.** It reads that node at script-execution time, not on DOMContentLoaded, so `hydrateCfg` silently fell back to `{}`. Consequence: **every cfg-dependent hydration was inert in production** (buy indicator, value metric, capacity chips, Price Analysis, and R1's honest flag) while the raw price display still updated, because the price path needs no config. **A page with dead hydration and a page with working baked fallbacks are visually identical**, which is why this survived R1's parity work: the mirror was correct and never ran.

Found by the standing corrupt-DOM QA pattern, which is the only method that catches it. Fixed by moving the data nodes above the `<script src>`, with a comment saying so. **Do not reorder those lines.** This is the second time the same shape of failure has shipped (see the Price Index hydration that never ran until 2026-08-27); the lesson is unchanged and now has two instances: **verify hydration by breaking the baked state, never by looking at the page.**

### STANDING RULE: the PDP template is now FROZEN

**R2 is the last structural change to the PDP template for the foreseeable future. After this, the daily regen changes prices and dates only.** The reason is not aesthetic: **Google needs a stable improved state to re-evaluate.** A site that keeps changing its template gives the crawler a moving target and restarts whatever assessment was in progress, so continuing to iterate would actively delay recovery even if each individual change were an improvement. Content changes (a new guide, a new glossary term, catalog additions) are fine. Structural changes to the PDP shape are not, until there is evidence in Search Console that the re-evaluation has happened and settled.

## Recovery Build R3 (2026-09-02): hand-curated product blurbs

A short `About this kit` / `About this drive` paragraph on the pages that have one, from `scripts/blurb-overrides.js`. **Content, not structure**: a conditional block on the existing template, same override pattern as the titles. The R2 template freeze holds.

**Keyed by SKU, never by page path.** A path-keyed blurb silently orphans itself if a slug ever changes, or worse lands on a different product. **Pages without an entry render nothing, no placeholder and no generated substitute** - an auto-written blurb would be precisely the scaled content R1 removed, and the whole value of these is that a person wrote them about a specific product line. Baked, never hydrated; they carry no prices and no price history by design, because the page already has both and prose quoting them would go stale between regenerations.

**19 of 25 shipped. SIX ARE HELD, and the verification is why.** Every claim in every blurb was cross-checked against that product's parsed specs and its raw listing title before anything shipped: 84 claims across 25 blurbs. Four blurbs contradicted their own listing, one omitted a material fact, and all are commented out at the bottom of the overrides file with the reason, awaiting an author rewrite. **They were NOT silently edited**, which is the standing rule for hand-authored copy: flag it and let the author decide.

| held | what the listing says |
|---|---|
| `B0B3HGJ4V7` + `B0B3HHB3Z9` | **The two T-Force Delta RGB blurbs are swapped.** The no-suffix slug is the WHITE kit (`FF4D...`) and carries the blurb labelled black; the `-2` slug is BLACK (`FF3D...`) and carries "white heatspreader, if your build is white". |
| `B0BNTRRLYP` | Blurb asserts "both XMP and EXPO"; the T-Force Vulcan listing says "XMP 3.0 Ready" only. |
| `B0DSQMKYLN` | Crucial 128GB is "Laptop Memory Kit, SODIMM 262-Pin"; the blurb describes a desktop workstation and says "motherboard and BIOS". |
| `B0BLTDRRLF` | Crucial 32GB 5600 is "Laptop Memory 262-Pin SODIMM"; the blurb says it "will work in any DDR5 board" and suits "a first build". A SODIMM does not fit a desktop board. |
| `B0GV1RCHX2` | WD_Black SN770 listing ends "(Renewed)". The blurb recommends the drive without noting it is a refurbished unit. |

**THE LESSON WORTH KEEPING: the two failure modes were assignment and form factor, not prose.** The colour swap and both SODIMM cases came from writing at the product-line level and then binding the text to a specific ASIN, where the line is right and the individual listing differs. **Any future hand-authored per-product copy must be verified against the listing title, not just read for sense**, and the verifier should check colour, form factor (UDIMM vs SODIMM), condition (Renewed/Refurbished) and profile support (XMP vs EXPO) explicitly, because those are the four axes that varied.

**Claims that are true but NOT verifiable from our data** are recorded rather than treated as errors: the Samsung 990 PRO's TLC flash and DRAM cache, the Acer GM7 and WD SN770 being DRAM-less, and the GM7 being manufactured by BIWIN. None appears in its listing title, all are correct per manufacturer specification. The glossary pull on those pages is name-token driven, so it correctly does not claim TLC or DRAM either.

**Allocation note:** 3 of the 25 blurbs sit on pages that are currently `noindex,follow` for having under 30 tracked days. They still serve readers, and the pages flip back automatically once they cross the threshold.

## Site-Wide Instant Search

One implementation (`frontend/js/search.js`) powers all search on the site. No server: it searches a static index client-side.

- **Index:** `frontend/search-index.json` (~121KB, committed + served) — one lean entry per product (`sku, name, slug, category, brand, current_price, image_url, search`), emitted by `generate-product-pages.js` on every `--confirm` run. **Catalog changes require regenerating the index** (it's part of the normal regeneration workflow, never hand-edited). Fetched once on first focus of any search input, cached in memory for the session; the fetch URL carries the `?v=` stamp.
- **Matching:** whitespace-tokenized, EVERY token must appear in the normalized searchable string (AND — "trident z5 32gb" and "32gb trident" both work). Normalization lowercases and strips punctuation on both sides, plus a compact (space-less) fallback, so "g.skill" / "g skill" / "gskill" all match. Query words that appear in no product name (e.g. "cheap") honestly yield zero results.
- **Ranking:** exact brand match > name starts with the query > name starts with the first token > earlier token positions; shorter names win ties (shortest = canonical popular product). Display cap 8, then a "View all N results" row linking to the majority category's listing with `?q=`.
- **Where it lives:** homepage hero input (Search button navigates to the top result, or the listing with `?q=` if none; the submit rate limiter in `main.js` remains, raised to 120/min — search is local, the limiter only guards pathological automation); every other page gets a header search icon (left of the theme toggle) opening an overlay panel — full-width sheet on mobile. The homepage "Try:" suggestions are clickable chips that populate + trigger search.
- **Listing `?q=`:** `/ram/?q=…` and `/ssd/?q=…` filter the grid via `memradarSearch.textMatches` (same logic as the dropdown, loaded before `product-listing.js`), show "Showing N results for '…'" with a × Clear search button.
- **UX/a11y:** 120ms debounce; ArrowUp/Down + Enter + Escape keyboard nav mirroring mouse hover; full ARIA combobox/listbox/option + aria-live result counts; dark mode styled; zero-result and index-loading states.
- **Analytics:** GA4 `search` event (`search_term`, `result_count`) fires after a 1s typing pause, deduped. **Zero-result queries tell us which products to add to the catalog** — review them periodically in GA.

## Alert Backend (double opt-in, security-first)

**REAL SUBSCRIBERS AS OF 2026-08-22.** The alert list is no longer test-only: six confirmed alerts, four of them from third parties (two arrived 2026-08-22, completing double opt-in unprompted). Any change to alert semantics — trigger conditions, send-then-mark ordering, expiry, email content — now lands in strangers' inboxes. Test against a scratch address and re-read the duplicate-send trade-off (send-then-mark leaves `triggered=false` on a send failure, so a *mark* failure re-sends within 4h at the current cadence) before touching that path.

Full email-alert flow. **PII (email addresses) — every decision errs toward protecting it.** Reuses the existing `validateAlert`, `rateLimiter`, `verifyTurnstile` utilities.

**Endpoints** (Vercel functions; API lives on `memradar-three.vercel.app` since GitHub Pages can't serve APIs):
- **`POST /api/alerts`** — create a pending alert. Fail-closed pipeline in strict order: (1) method→405, (2) size >2KB→413 before parse, (3) honeypot→neutral, (4) Turnstile→neutral, (5) IP rate limit 3/hr (x-forwarded-for first entry)→neutral, (6) `validateAlert` (the ONE branch that returns a real 400 with errors), (7) product exists by sku→neutral if not, (8) DB abuse checks→neutral, (9) upsert on `(email,product_id)` ignore-duplicates, (10) confirmation email, (11) respond. CORS: `Access-Control-Allow-Origin: https://memradar.com` (specific), OPTIONS→204.
- **`GET /api/confirm?token=`** — atomic confirm by `confirm_token`, sets `confirmed=true`, `confirmed_at`, nulls the token (**single use** — re-clicks hit the invalid page). 302 → `/alert-confirmed/` or `/alert-invalid/`. Rate limit 30/hr/IP.
- **`GET /api/unsubscribe?token=`** — DELETEs the alert row (data minimization). Idempotent/friendly: always 302 → `/alert-unsubscribed/`. In every email we send.

**THE NEUTRAL RESPONSE:** identical `{success:true, message:"Check your email to confirm your alert."}` at 200 for EVERY outcome except validation errors — honeypot/turnstile/rate-limit/caps/breaker/dedupe/created all look the same to a prober. No artificial per-branch delays.

**Abuse limits:** pending cap **3** unconfirmed/email/48h · active cap **10** confirmed-untriggered/email · circuit breaker **200** confirmation-sends/24h (over → insert row, DEFER email; log loudly) · IP rate limit **3**/hr (in-memory, resets on cold start — the DB caps are the durable limits) · confirm endpoint **30**/hr/IP.

**Security rules (standing):**
- **Every DB op uses parameterized Supabase client methods** — no SQL built from user input via concatenation/template literals. Audit with grep on any change to the alert endpoints.
- **Tokens** are `crypto.randomBytes(32).toString('hex')` — never `Math.random`.
- **Logs never contain full emails** — masked to `ma***@gmail.com` (logs are a leak surface).
- **Email content:** user input appears NOWHERE in email bodies — recipient address is the only use of their input. All content (product name, prices, URLs) comes from OUR DB. Product names are HTML-escaped anyway (Amazon titles have `&`/`"`).
- **RLS:** `alerts` and `email_send_log` are service-role only, no public access.

**Emails** (`backend/lib/alertEmails.js`, Resend REST API via `fetch`, from `hello@memradar.com`): confirmation (product, target, confirm button, 48h expiry, unsubscribe) and price-drop (product, current vs target, all-time-low, **View on Amazon with `?tag=memradar-20`** — the revenue moment, PDP link, unsubscribe).

**Cron alert step** (`backend/lib/alertCheck.js`, run from `api/fetch-prices.js` after price inserts, isolated try/catch): query `confirmed=true AND triggered=false`, match `current<=target` against the just-inserted prices, **send-then-mark** (send email → log → set `triggered=true`; **if send fails leave `triggered=false` so the next run retries**), plus DELETE unconfirmed alerts >48h old (makes the pending cap self-healing). Stats in the cron summary: `checked/matched/sent/failed/expired_cleaned`. `scripts/run-alert-check.js` runs this step standalone for testing (no Keepa fetch).

**Result pages** (`frontend/alert-confirmed|alert-invalid|alert-unsubscribed/`): on-brand, `noindex`, excluded from sitemap.

**Frontend:** `alert-modal.js` (nav "Set an Alert" — real product search via the search index, real POST, on-demand Turnstile, shared `window.memradarAlert` helper) and `pdp-alert.js` (PDP inline form) both POST to `/api/alerts` cross-origin; Turnstile token read from the widget; validation errors inline; network failure keeps typed input.

**TODO (deferred, not built):** a mechanism to send deferred confirmation emails after the circuit breaker trips (rows are inserted but their confirmation email is skipped).

## Project Status

**The original May roadmap is fully built and live as of 2026-07-22.** MemRadar has: the Keepa-backed daily price pipeline, 235 static product pages with decade-deep history, live Market Pulse + listing pages, site-wide instant search, and the complete double-opt-in **alert backend — deployed and verified end-to-end** (submit → confirmation email → confirm → daily cron match → price-drop email with affiliate link → unsubscribe). The site is functionally launched.

**Not built (post-launch / future):**
- User accounts (currently no auth; alerts use plain email + tokens)
- Affiliate link tracking / analytics beyond GA events
- Daily automated PDP regeneration (GitHub Action — see Product Detail Pages TODO)
- Deferred-confirmation resend after the alert circuit breaker trips (see Alert Backend TODO)
- **Newegg integration (Phases 1 + 2 SHIPPED, Aug 2026):** approval via Rakuten (Publisher SID 4705448, Newegg MID 44583). 151 `retailer_offers` rows live: 100 tier-1 MPN, 17 tier-2 name, 34 tier-1.5 UPC (all non-MPN tiers Malcolm-gated; 84 products remain Amazon-only, 31 of them lacking any Keepa barcode). Two-retailer Buy Now rows + AggregateOffer JSON-LD on two-offer PDPs; Newegg/Rakuten copy pass shipped site-wide. Components: `retailer_offers` table (clean URLs stored, deep-link wrapping at render via `backend/lib/rakutenLink.js`), `backend/lib/neweggFeed.js` (shared SFTP + streaming positional parser; fastGet completion watchdog with gzip-integrity-on-timeout — the hang is intermittent and production-observed on both file sizes), `scripts/match-newegg.js` (tier-1 MPN auto / tier-1.5 UPC via `products.upc` from `scripts/fetch-upcs.js` (Keepa upcList/eanList/gtinList, leading-zero-stripped) / tier-2 name; non-MPN tiers NEVER auto-accept; accepted rulings carry over keyed on sku+neweggSku), `scripts/refresh-newegg-offers.js` + `.github/workflows/newegg-refresh.yml` (the Phase-2 cron). **Cron facts:** daily 06:00 UTC delta apply (delta col 39 = I/U/D change marker, verified empirically; D = same-day OOS because the complete feed carries only in-stock items); Sunday runs pull the ~158 MB complete file for authoritative price+presence reconciliation (absent → in_stock=false); 9-day staleness net flips unrefreshed in_stock=true offers (deltas only express changes, so the net exists solely for failed Sundays). Cron NEVER re-matches or inserts offers — matching stays human-gated. GitHub Actions secrets: RAKUTEN_SFTP_HOST/USER/PASS, SUPABASE_URL, SUPABASE_SECRET_KEY. Workflow is structured for a future second job (daily PDP regen TODO). Freshness display ruling: no UI change; the disclaimer sentence carries the nuance, per-retailer honesty lives in the AggregateOffer validFrom fields. SCOPE GUARDRAIL (permanent): price history, charts, Price Analysis, buy verdict, and alerts remain Amazon/Keepa-only; Newegg is a current-price comparison row. A wrong match is worse than a missing row.
- **"Lowest price" badge on the Buy Now row (considered and DECLINED, Gate 2, Aug 2026):** proposed as an optional indicator next to the cheaper in-stock retailer; Malcolm ruled no. The cheapest-first sort already communicates it, both prices are plainly visible, and a badge beside the "best $/GB here" chip starts badge soup. Do not re-propose.
- **Labeled marketplace price display (future consideration, explicitly NOT built):** Newegg feed rows split into first-party (`N82E…` item numbers) and marketplace sellers (`9S…`, often gray-market pricing). Current trust ruling: matched offers prefer sold-by-Newegg over cheaper marketplace rows (same editorial stance as Keepa outlier filtering); marketplace-only matches use lowest in-stock. A possible future feature is showing the marketplace price too, explicitly labeled as such. Ruled a future consideration at Gate 1 (Aug 2026) — do not build unbidden.
- Additional retailers beyond Newegg (Best Buy client dormant; Walmart never integrated)

## Data Source Evaluation Findings (July 2026)

Findings from evaluating price-data providers as a Best Buy replacement (Best Buy never approved API access). Use `scripts/test-priceapi.js [source]` to re-run a PriceAPI schema check at any time.

**PriceAPI trial:**
- US retail sources are limited to **amazon**, **ebay**, and **google_shopping** — and `google_shopping` **cannot keyword-search** on the trial (its `search_results`/`term` topic is not entitled; only `product`/`offers`/`product_and_offers`/`reviews` keyed by `id`/`gtin`). **Walmart, Newegg, and Best Buy are NOT available at all.** Everything else offered is mostly EU comparison sites (billiger, idealo, geizhals, galaxus, pricerunner, bol, medizinfuchs).
- **Validation is loose:** bogus upstream params return generic, unfiltered allowed-value lists for downstream params, so a source/topic combo only appears valid until you send a real job. **Only an actual job run truly validates a source/topic/key combination.** (Unknown sources/topics return HTTP 500 rather than a clean error.)
- **Amazon `search_results` schema notes:** ASIN arrives as `id`; prices are **strings** split into `min_price`/`max_price` (range across sellers); `brand_name` is **null** on search results; `review_rating` is a **0–100** scale, not 5-star; seller-level data requires a **second `offers` call keyed by ASIN**. **No price history on any topic** — all responses are point-in-time snapshots.
- **Cost observed:** **1 credit** per search job returning 16 products (`max_pages=1`).

**Strategic conclusion:** PriceAPI is **not worth the €99/month** post-trial for our needs (no Walmart/Newegg/Best Buy, no price history). **Keepa** (Amazon price-history API, ~€49/month) was chosen for launch and is now live — Keepa granted written permission to display Amazon price history via their API. The `test-priceapi.js` script remains useful for schema reference and any future re-evaluation.

## Price-Fetch Endpoint (RETIRED 2026-08-22)
`api/fetch-prices.js` and both `vercel.json` cron entries are gone; the fetch runs on GitHub Actions (`.github/workflows/price-fetch.yml` → `scripts/run-price-fetch.js` → `backend/lib/priceFetch.js`).

**Why:** Vercel crons bind to the current production deployment, and an invocation during a deploy handover is dropped — forensically proven Aug 2026 (two missed runs, each coinciding with pushes inside the window). Six daily entries would have meant six daily collision windows. That failure class is now extinct. Keeping a public, token-spending, email-sending endpoint with no scheduled caller was also pure attack surface.

**`CRON_SECRET` is vestigial.** It was referenced only by that endpoint; nothing in the codebase reads it now (verify with grep before reintroducing). It can be deleted from Vercel's env vars. The local `.env` copy is harmless and was deliberately left alone.

**Still on Vercel:** `api/alerts.js`, `api/confirm.js`, `api/unsubscribe.js` (user-facing, request-driven), unaffected.

## Keep-Alive Cron (RETIRED 2026-08-17)
Removed: the `/api/keep-alive` endpoint (`api/keep-alive.js`) and its `vercel.json` cron entry (`0 12 */3 * *`). It existed only to stop the Supabase free tier pausing the project during inactivity.

**Why retirement was safe.** Its documented condition ("7 consecutive successful daily fetch runs") was met weeks earlier and then some: `fetch-prices` writes ~230 `price_history` rows on the twice-daily Keepa schedule, and since Aug 2026 the nightly Newegg refresh (GitHub Actions, 06:00 UTC) writes to `retailer_offers` as well. Real DB activity now happens at least twice a day from two independent systems, so a synthetic ping adds nothing.

**Health verified at retirement (2026-08-17), NOT retired because it was broken:**
- `/api/keep-alive` returned **200** with `products_count: 235` when called with the real `CRON_SECRET`, so the function was working.
- That same 200 proves the **July 2026 CRON_SECRET incident is resolved**: the secret in Vercel's env matches `.env`. (2026-07-22 root cause, kept for the record: a CRON_SECRET mismatch/absence in Vercel meant the cron fired but 401ed before reaching Supabase, registering no DB activity. Fixed by rotating the secret across Vercel, `.env`, and 1Password, then redeploying.)
- Recurring workflow-failure emails around this time were traced to a **different repo** (`malcolm15/pillsignal`), not MemRadar.

**If Supabase inactivity pausing ever becomes a concern again**, prefer verifying the two real writers are running over reinstating a synthetic ping.

## Seed Data
`scripts/seed-database.js` was run once (2026-05-27), adding 3 seed products (`SEED-RAM-001`, `SEED-RAM-002`, `SEED-SSD-001`) + 3 seed price_history rows.

**Removed 2026-07-21.** The seed rows (and their price_history children) were deleted once the real Amazon catalog was upserted — see "Product Catalog" below. The `products` table holds only real catalog data; `price_history` is populated by the Keepa backfill plus the ongoing twice-daily fetch.

## Product Catalog
Built 2026-07-21 via `scripts/build-catalog.js` (18 Amazon keyword searches through PriceAPI, ~18 credits) → reviewed preview → `scripts/upsert-catalog.js --confirm`.

- **235 products** in `products` (119 ram / 116 ssd), retailer `amazon`, `sku` = ASIN, clean `/dp/{ASIN}/` URLs (no affiliate tag — appended at display time).
- Brands resolved via a canonical known-brands map in `build-catalog.js` (`brand_name` is null on PriceAPI search_results); 183 matched, 52 null (off-brand makers left null rather than guessed).
- `price_history` is intentionally **empty** — the catalog prices were point-in-time search snapshots and were NOT stored as history. Price history comes from Keepa in the next pipeline step.
- The preview JSON lives at `scripts/output/` (gitignored — regenerable; DB is the source of truth). Re-derive brands/filters offline with `node scripts/build-catalog.js --reprocess` (no credits).

## Development Notes

- **Node ≥ 18** required (native `fetch` used, no node-fetch)
- **Dev dependencies:** `sharp` and `to-ico` installed for image generation scripts. Run `npm install` before running `generate-favicons.js` or any image conversion scripts.
- `scripts/test-api.js` is a dormant Best Buy API sanity check — the live cron uses Keepa (`backend/lib/keepa.js`, self-test `node backend/lib/keepa.js`)
- Vercel Hobby runs each cron at most once per day, so `vercel.json` has two entries (`0 8 * * *` and `0 20 * * *`) to fetch twice daily (08:00 + 20:00 UTC)
- **Why 08/20 and not 06/18 (moved 2026-08-17):** deployment-collision avoidance. Vercel crons bind to the current production deployment, and an invocation scheduled during a deploy handover is dropped; Hobby's ±59 min scheduling precision widens that exposure to a full hour. Forensics on the two missing runs (Aug 14 06:00 and Aug 16 18:00 UTC) found ZERO rows and no partial writes, and every miss coincided with pushes inside the window (06:11/06:32/06:37 and 18:03/18:23/18:30 UTC) while every deploy-free window fired, including the Aug 15 control with both runs intact. 08:00/20:00 UTC (01:00/13:00 Pacific) are far less likely to collide with active pushing.
- **Changing the hours means changing three places together:** `vercel.json` crons (source of truth), `FETCH_HOURS_UTC` in `scripts/generate-product-pages.js`, and the deliberate browser-side duplicate `FETCH_HOURS_UTC` in `frontend/js/pdp-hydrate.js` (same duplication convention as productParsers/product-listing). They drive `priceValidUntil`/`validFrom` in the PDP JSON-LD. The alert-check and market-stats steps ride the fetch cron and use relative durations only (48h expiry, 165/195-day baselines), so they shift automatically with no independent schedule assumptions.
- The `supabase.js` client uses the **service role key** intentionally — it runs server-side only and needs to bypass RLS for writes

## Affiliate Tags

- **Amazon Associates:** `memradar-20`
  - All Amazon product URLs must include the tag: `https://amazon.com/dp/PRODUCTID?tag=memradar-20`
- **Best Buy:** dormant — no Best Buy links are generated (client unused; outreach considered closed 2026-08-21, see Retailer & Affiliate Program Status)
  - If Best Buy is ever revived, append its affiliate tag to all Best Buy URLs the same way

Never generate Amazon product links without the `memradar-20` tag appended. (The same rule would apply to Best Buy if that client is ever revived.)

## Memory Price Index (`/price-index/`)

Generated flagship page at `/price-index/` (template `frontend/price-index/template.html`, builder `buildPriceIndex()` in the generator, hydration `frontend/js/price-index.js`). The 16-cell matrix is baked at generation and refreshed from `market_stats` on load, so it is correct for crawlers and never staler than the last cron run.

**THE HYDRATION ON THIS PAGE NEVER RAN IN PRODUCTION UNTIL 2026-08-27.** The template loaded `supabase-client.js` but never the supabase-js UMD bundle it depends on, so `window.supabase` was undefined, the client threw on load, and nothing hydrated. The RAM guide had the identical defect. **The irony is worth keeping: the elaborate hydration-parity engineering below was never what kept these pages honest. The daily regeneration was.** The pages looked correct throughout because baked values are the designed fallback, which is precisely what hid it. Fixed by adding the bundle ahead of the client in both templates. **Any new page that uses `supabase-client.js` must include the jsdelivr bundle before it**, and must be verified with the method below rather than by looking at it.

**THIS IS NOW AUTOMATED: `scripts/hydration-check.js`, a step in `deploy-frontend.yml` after the smoke test.** It loads a PDP, `/price-index/` and a guide in headless Chromium, corrupts every element the page's own hydration writes to, and fails the deploy if any stays corrupt. **The enumeration is SELF-DERIVED, not hardcoded**: a first pass installs a MutationObserver scoped to `<main>` and records what actually hydrates; a second pass corrupts exactly that set. A hydrated element added in future is covered with no change to the checker. Two guards close the vacuity gap an observer cannot see on its own: a **structural** assert that every `<script type="application/json" id="X">` appears before the local script that reads `getElementById('X')` (derived from the page and its own scripts, zero upkeep, and exactly the 2026-09-02 bug), and a **vacuity** assert that a page shipping a populated config must hydrate something (exactly the 2026-08-27 bug). Verified to FAIL by re-serving the site with the script order reversed: the structural assert fired and the PDP's hydrated count fell from 29 to 9.

**Two things not to change in it.** The observer is installed SYNCHRONOUSLY at DOMContentLoaded: an earlier version waited 150ms "to be safe" and silently missed the entire Price Index, whose fetch resolved inside that window, reporting the page as having no hydration to verify. And third-party widget containers (`.cf-turnstile`, `[data-sitekey]`, `iframe`) are excluded, because depending on Cloudflare's widget rendering identically twice is a flaky failure with nothing to teach us.

**What it still cannot catch:** a single element that quietly STOPS hydrating disappears from the observed set, so the corrupt/restore pass never looks for it. The three failures this closes were all whole-page or whole-config death, which the two guards do catch. A per-page committed baseline of hydrated-element counts would close the narrower case at the cost of a file that needs maintenance; not built.

**STANDING QA PATTERN FOR HYDRATION: corrupt the DOM and watch it restore.** A page with working baked fallbacks and a page with dead hydration are visually identical, so "it looks right" proves nothing, and neither does "no console errors" when the failure mode is a module that throws before it registers anything. The only proof is to break the baked state deliberately: load the page, overwrite every live element the moment the DOM exists (table cells, prices, gap sentences, computed-date stamps) with obvious garbage, wait for the fetch, then assert every one came back. Anything still showing garbage is not hydrating. Run this against any change to a hydration path.

**HYDRATION-PARITY RULE:** on this page, any figure that also appears in a hydrated element must itself hydrate from the same source. The steepest-segment callout names both a segment and a percentage that sit beside the live table, so `price-index.js` recomputes and updates BOTH from the same `market_stats` fetch (updating only the number would produce a worse error if another segment overtook the leader). Audited 2026-08-23: the within-5%-of-all-time-low count and the daily-price-point count are derived from `price_history`, appear nowhere in any hydrated element (the only live surfaces are the table cells, the two computed-date stamps, and the steepest-segment spans), and so cannot visibly contradict anything; the price-point figure also appears in the Dataset JSON-LD description, but both are written by the same generation run from the same variable and neither hydrates. The "up more than N%" floor absorbs drift by rounding down to the nearest 10 instead.

**NOTABLE-NUMBER RULE (do not violate):** every callout in the "Notable numbers" strip must be **derived at generation time from the data it sits beside** — never a hand-written threshold. This page is built to be cited, which means it gets checked by strangers with motive, and a stale hand-typed figure beside a live table is the one failure that would discredit the whole artifact. Comparative claims are additionally **rounded away from the boundary** (the "every segment is up more than N%" line floors the weakest 1-year move down to the nearest 10): the table hydrates on load while the sentences stay baked until the next regeneration, so a claim pinned to an exact value can contradict the table beside it after a day of drift.

Other conventions on this page: the 4x4 table stays a real matrix at every width (it scrolls horizontally below 560px with a visible hint and a focusable region) because the matrix shape is what makes it screenshot-able; flagship cross-links use clean names plus capacity, NOT `_titleName` (its collision suffix leaks ASIN fragments like "DDR4 QR0C", which reads as a typo); Dataset JSON-LD carries `creditText` matching the visible citation block verbatim. Footer nav only, plus a contextual "Full price index" link under the homepage Market Pulse.

## Social Bot (`@memradar`)

Automated posting on GitHub Actions. **Bluesky is the primary and only live target** (`.github/workflows/bluesky-posts.yml` → `scripts/run-social-post.js --platform=bluesky`, client `backend/lib/blueskyClient.js`). Daily 17:00 UTC biggest-drop post, weekly Sunday 18:00 UTC market summary, ~35 posts/month.

**Composition and every guardrail are PLATFORM-AGNOSTIC** and live in `backend/lib/tweetCompose.js`. A platform client is only a publish call receiving the finished string. **Do not fork the composer per platform.**

**X is DORMANT, and not because anything is broken.** X requires the **Basic tier at $200/month** for write access; the free tier cannot `POST /2/tweets`, which is what its `402 credits depleted` meant. Not worth it at current audience size (decided 2026-08-26). The code, the four `X_*` secrets and `.github/workflows/x-posts.yml` are kept intact with the schedule commented out and `workflow_dispatch` still active. **The OAuth 1.0a signing in `backend/lib/xClient.js` is PROVEN against the live API**: the 402 was an entitlement refusal *after* successful authentication (a bad signature returns 401). To revive: uncomment the schedule block. Do not re-litigate the tier question from scratch; revisit only if traffic justifies the spend.

**Bluesky specifics.** Auth is an app password (`BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` — Settings > Privacy and Security > App Passwords, never the account password); no OAuth, no developer application, no tiers. Raw `fetch`, no `@atproto/api`: the flow is two JSON POSTs (`com.atproto.server.createSession` for an access JWT, then `com.atproto.repo.createRecord`) and we build one record type with one facet type. **CRITICAL — Bluesky does not auto-link URLs.** The record carries `app.bsky.richtext.facet#link` facets whose `byteStart`/`byteEnd` are **UTF-8 byte offsets, not JS string indices**. Our posts open with 📉 (4 UTF-8 bytes, 2 UTF-16 code units), so an `indexOf()`-derived offset is wrong by exactly 2 and would slice the link. Offsets are computed with `Buffer.byteLength` of the prefix, the client's self-test asserts the two disagree, and every run prints the ranges plus proof that the sliced bytes decode back to the URL, refusing to post if they do not. Length is checked in **graphemes against 300** (Bluesky's unit), not characters.

**Dedup state** keys are per-platform (`bluesky_daily_last_post`, `x_daily_last_post`) so a revived X could never suppress a Bluesky post.

**THE BOT MUST BE SILENT RATHER THAN WRONG OR TRIVIAL.** A missing tweet is invisible; a wrong tweet is a screenshot. Every guardrail returns a logged skip reason and exits 0 having posted nothing; only genuine failures exit nonzero (red run + failure email). Gates, all in `tweetCompose.js`:

- **Silence threshold:** no daily tweet below a 3.0% drop. Not news.
- **Glitch ceiling:** skip drops over 60% (an outlier that slipped filtering).
- **Sanity:** skip non-positive prices and products out of stock at Amazon.
- **Price-data staleness (12h, RAISED from 6h on 2026-08-27):** "biggest drop today" computed on stale data is **a wrong tweet wearing a right format**. What this gate protects is a **superlative about the present tense**, screenshotted, where the drop has since reversed or a bigger one appeared we could not see. It was never a precision claim; the site says plainly that prices are not real time. **Why it moved:** GitHub stopped creating scheduled runs reliably at 2026-08-26 20:00 UTC and `price-fetch` went from every ~4h (gaps 211-284 min, 6/6 slots daily) to every ~8-12h (gaps 355/492/714/554 min, 3 of 12 slots delivered). At 6h the gate held 100% of the time; at the new cadence it holds ~68%, and on 2026-08-28 it rejected a post carrying 12 qualifying drops and a -10.7% leader **by 0.5 hours**. It had begun converting an infrastructure fault into editorial silence, which reads identical to "the market was quiet". 12 = one degraded fetch cycle (mean 8.8h, worst observed 11.9h), and a 12h-old "biggest drop today" is still true because the window is 24h and the linked PDP hydrates live. **REVERSAL CONDITION, verbatim: when fetch cadence returns to 4-hourly, this returns to 6.** On the 2026-09-10 revisit list.
  - **Trigger-off-fetch-completion was considered and REJECTED.** It couples the pipeline to publishing, needs its own suppression logic at 6 fetches/day, and decisively: **`workflow_run` is dispatched by the same Actions scheduler that is dropping the occurrences**, so it inherits the degradation it is meant to escape. Do not re-propose without evidence that scheduling is healthy.
  - **Data age rides EVERY summary JSON, posts and skips alike** (`data_age_h`, `data_age_of`, `data_age_max_h`). A loosened guarantee observable only when it FAILS is not observable at all: you could not tell afterwards how old the data was on the runs that went out.
- **market_stats staleness (36h):** never tweet old index numbers.
- **ATL doom threshold (50%):** the all-time-low clause stops being actionable when the gap is enormous. After the 2026 price crisis most products sit 100-400% above lows set years ago, so "still 307% above its all-time low" is true, unhelpful and relentless. Above a 50% gap the clause switches to **"That's N% below its 90-day average"** — the same statistic the PDP Price Analysis reasons with, so tweet and page agree by construction. That comparator has its own **5% floor**, and falling below it **omits the clause rather than skipping the product**: the drop percentage is itself the news, so an 18.5% move still gets tweeted, just plainly. Skipping would be worse than useless here because it would hand the superlative to a smaller drop and make "Biggest drop today" false. The rule is: **a strong context clause when we have one, no clause when we do not, never a misleading one and never a wrong superlative.** The at-ATL and within-5% branches are unchanged.
- **Dedup with FALL-THROUGH:** never tweet the same product two runs running, but do not go silent if a runner-up qualifies. Fall through to the next-biggest eligible drop with every gate still applying, and change the copy from "Biggest drop today" to **"Big drop today"** so the claim stays true. Log which branch fired.

**OUTCOME HEARTBEAT (`SOCIAL_POST_HEARTBEAT_URL`, healthchecks.io, added 2026-08-27).** The runner pings it **only on a real publish**: never on a skip, never on a dry run, never merely because the job exited 0. Built because on 2026-08-28 the daily post ran, hit the staleness gate, skipped, and exited 0, so every job-level check called it healthy on a day the account published nothing. Check config: period **1 day**, grace **72h**, so it alerts at "no actual post in 3+ days". That is a **glance-at-it** signal, not a page: it could be a legitimately quiet market or a fault, and either way a human look is cheap. **Deliberately NOT the supervisor reading `bot_state`**: that table is service-role only, and handing the watcher a service key to satisfy a liveness check would break its read-only principle for a signal the bot can emit itself for free. Ping failures are logged and never fail a run that already published; an unset variable logs `outcome coverage is DISABLED` rather than silently skipping.

**Dedup state lives in Supabase** (`bot_state` table, `backend/lib/botState.js`, key `x_daily_last_post` — the key is namespaced so the table stays general-purpose for future automations). Two designs were rejected first, and the reasoning matters if anyone revisits this: repo Actions variables cannot be written by the automatic `GITHUB_TOKEN` (**HTTP 403 "Resource not accessible by integration"** from both the `gh` CLI and the REST endpoint even with `permissions: actions: write`, probed empirically 2026-08-26; the alternatives were a classic-`repo`-scope PAT or a GitHub App). Scraping the workflow's own run logs was then rejected because Actions log retention expires and, worse, "enumeration found nothing" is indistinguishable from "enumeration failed", so dedup would **fail open** — the wrong shape for a bot whose principle is failing closed. The Supabase store needs no extra credential (the service key is already a secret), has no retention limit, makes no commits, and **throws** on a read or write error so the run fails loudly.

**Copy rules.** ATL context is mandatory on every daily tweet: it is the honesty signature, and it branches like the PDP Price Analysis (at/below → "That's a new all-time low."; within 5% → "within N% of its all-time low."; else → "Still N% above its all-time low."). Zero renders as **"flat"**, tested against the *rounded display value* (a raw +0.04% shown as "+0%" reads like a bug exactly as true zero does). "at Amazon" is permanent and correct: daily drops are an Amazon-history feature because `price_history` is Amazon/Keepa-only, and naming the retailer matters precisely because the site shows two. No em dashes, no hashtags. Length is checked with URLs counted at t.co's 23 characters, never their real length.

**Names** come from the shared `shortName()` in `productParsers.js` (extracted 2026-08-23, proven identical across all 235 products), so a tweet can never disagree with the page it links. `tweetCompose.displayName()` adds composer-layer-only polish (brand prefix, trailing " - fragment" strip) and **must never change the shared builder**, whose output is baked into slugs and titles.

**RULE: tweet copy changes get a dry-run review before shipping.** `workflow_dispatch` defaults `dry_run` to **true** so a manual run composes and logs but never posts. Rollout for any copy change: dry-run dispatch reviewed by Malcolm, then one watched real dispatch, then the schedule.

## Probe-Guard Rule

**Every probe-guard gets an explicit expiry condition at the time it is written**: a date, a "remove when X lands" note, or a loud flag once the guarded thing becomes required. Write it in the same commit as the guard, never later.

A probe-guard is written for a migration window: the column or table does not exist yet, so the code degrades instead of crashing. That is correct *during* the window. **A guard that outlives its migration becomes a silent feature-deletion mechanism** - it stops meaning "not built yet" and starts meaning "this broke, carry on without it". The `retailer_offers` guard is the worked example: written in July when the table genuinely did not exist, still present in August when the table held all 151 Newegg offers, at which point a probe failure would have silently published 151 single-retailer pages that look exactly like "Newegg has nothing today".

Current guards and their expiry:
- `retailer_offers` (generator): **EXPIRED, now throws in `--confirm`**; degrades only on a dry run.
- `products.upc` (match-newegg): active, additive feature, absence is a real state. Expiry: remove if UPC matching ever becomes required for a gated write.
- `parent_asin` (build-families): active, falls back to a checked-in JSON. Expiry: remove when the column is guaranteed populated.
- `market_stats.stability_delta_pp`: active until the ALTER TABLE lands, then remove the fallback branch.

## Atomic-ish Generation (delete-only-orphans, 2026-08-27)

The generator **writes first, then sweeps only orphans**. It used to delete every generated page dir BEFORE writing, which made any mid-run failure destructive: on 2026-08-26, 151 products failed after the delete and 151 live pages vanished.

**THE INVARIANT: never delete a directory whose slug is in the catalog, no matter what else is true.** A product that fails generation is still in the catalog, so its page is protected by construction and keeps serving slightly stale content instead of becoming a 404. Detection lives in `findOrphans()`, which is pure and side-effect free so **the dry run reports exactly what `--confirm` would delete**. Proven both ways before it shipped: a normal catalog reports zero orphans, and a simulated renamed slug reports exactly the old slug and nothing else.

**Mass-orphan alarm:** more than 10 orphans throws rather than deleting. That many at once is a slug-scheme change, not routine churn, and deleting dozens of live URLs deserves a human. Override with `--allow-mass-orphan`.

**This makes failure non-destructive; it does NOT make failure acceptable.** The nonzero exit on any `--confirm` failure and the parity assertions both stay exactly as they were.

**New risk this introduced, and its signal:** a product that fails every run now serves its old page forever, silently. Consecutive failures per SKU are tracked in `bot_state` (`generator_failure_streaks`), and **3+ consecutive failures raise a STALE PAGE ALARM naming the SKU and its URL**, with a `STREAK_SUMMARY` line in every run. A streak clears by simply generating cleanly. Tracking failures are reported but never fail an otherwise-good build, since this is diagnostics rather than correctness.

## Silent Degradation: the rule and the audit

**A fallback that fires invisibly is indistinguishable from a feature that works.** Every fallback must announce itself, or carry a written reason why silence is correct there. All three of this week's failures were this shape: a guard fired, the run looked healthy, and the damage was found by a human.

**Audit, 2026-08-27.** Two fallbacks were genuine liabilities and were removed:
- **`retailer_offers` probe-guard in the generator.** It existed for the window before the DDL landed. That table now holds every Newegg and Amazon offer, so a probe failure meant silently publishing 151 single-retailer pages that look exactly like "Newegg has nothing today". Now **throws in `--confirm`** and only degrades on a dry run.
- **`(offers || [])` in the social bot.** A failed query yielded an empty stock map, silently disabling the out-of-stock gate, so the bot could have posted an unbuyable product. Now **throws**: a bot that cannot check stock must not post.

**Silence kept, with reasons.** Frontend hydration fallbacks (`pdp-hydrate`, `price-index`, `guide-live`) keep baked values on any error. Silence toward the READER is correct there: baked values were accurate at build time, and a broken banner helps nobody. They now `console.log` so the failure is visible in devtools rather than invisible everywhere. Probe-guards for genuinely optional columns (`products.upc`, `parent_asin`, `stability_delta_pp`) log and continue, because those features are additive and their absence is a real state, not a fault.

## Generation Guardrails (built 2026-08-27 after the 151-page incident)

**1. VALIDATE EVERYTHING YOU NEED BEFORE YOU DESTROY ANYTHING.** `preflight()` runs first, before any load or delete: required env present (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RAKUTEN_AFFILIATE_ID`), the deep-link builder actually invoked rather than merely checked for presence (a set-but-malformed id fails here), Supabase reachable, and the catalog above a 100-product floor. Verified against the incident's exact condition: aborts in 0.3s with every page directory intact. **Any new env the generator or its libraries read must be added to `REQUIRED_ENV`.**

**2. PARITY ASSERTIONS.** After generation: pages on disk == sitemap product URLs == manifest product entries == generable products, plus a >10% catalog-shortfall check. Partial generation's signature is the counts disagreeing, and every one of these was detectable in the 2026-08-26 run. Note the manifest filter needs a slug segment (`/(ram|ssd)/[^/]+/$`): `/ram/` and `/ssd/` are listing pages and are manifest entries too.

**3. EXTERNAL SMOKE TEST** (`scripts/smoke-test-live.js`, a step in `deploy-frontend.yml` after Pages publishes). Samples the live sitemap and asserts 200 on the homepage, both listings, the price index, both guides, and three PDPs spread deterministically across the catalog. **Deliberately outside the generator**, because preflight and parity run in its process and share its assumptions: if the generator is confidently wrong, they are wrong with it. This trusts only live HTTP.

**What these still cannot catch:** a page that returns 200 with wrong or stale CONTENT. Every check here is structural (does it exist, do the counts agree, does it serve). A regeneration that quietly bakes last week's prices onto all 235 pages passes all three. Content correctness still rests on the hydration layer and on human review.

## THE OBSERVABILITY LADDER (general principle, learned one rung at a time)

**Run-level success is not job-level success is not outcome-level success.** This project has climbed that ladder one rung per incident: a workflow run reporting `success` while the job we cared about was `skipped` (2026-08-27, which is why the supervisor keys on `(workflow file, job id)`); then a job reporting `success` while the bot published nothing (2026-08-28, which is why the social runner pings an outcome heartbeat only on a real publish). **When adding any check, ask which rung it is on and what the next rung up would catch.** The pattern each time is identical: the lower rung is easy to measure and quietly redefines "working" as "ran", and the gap only shows up when something upstream degrades. The rung above outcome-level is presumably correctness of the outcome (a post that published but says something false), which nothing currently watches.

## Scheduled-Workflow Supervisor (`ops/supervisor/`, stage 1, 2026-08-27)

A Cloudflare Worker that asks, from **outside GitHub**, whether this repo's scheduled jobs actually ran, and opens a GitHub Issue labeled `supervisor-alert` when one goes stale. Stage 1 is **read-only alerting**: no dispatch, no self-healing, and the token is scoped Actions:**read** so it cannot start a workflow even by mistake.

**WHY IT EXISTS: on 2026-08-27 five scheduled slots across two workflows were never CREATED by GitHub at all.** No run record, nothing queued, nothing cancelled, no published incident covering the window, no concurrency group that could have suppressed them, and the repo is public so Actions minutes cannot gate it. The failure is upstream of run creation, which means **nothing inside GitHub reports it**. Every existing guardrail (preflight, parity, the live smoke test) presumes a run happened; this is the first check that does not.

**IT KEYS ON (workflow file, job id), NEVER ON WORKFLOW FILE ALONE.** `newegg-refresh.yml` carries two crons gating two different jobs, and a run where one job succeeds while its sibling is `skipped` still reports run-level conclusion `success`. On 2026-08-27 the 06:00 `refresh-offers` job succeeded while the 09:00 `regenerate-pages` cron was never created, and workflow-level freshness would have called that file healthy. Verified before writing: the Actions API reports job `name` equal to the YAML job id for all four watched jobs.

**Thresholds are derived, not chosen:** `max_age_hours = interval + p95 + margin`, and `assertConfigArithmetic()` throws at tick time if the three inputs do not add up to the stored value. **This exists specifically so a future session cannot quiet a noisy alert by nudging the number**; changing it requires changing an input and saying why. Margins differ per pair by consequence: `regenerate-pages` is tightest (0.25x interval, 30.82h) because the guides and Price Index argue from baked values and print their own build date, so a stale build is a page making a false claim about itself, while `post` is most tolerant (1.00x, 49.87h) because a missed Bluesky post is invisible and harmless. Two p95 figures rest on n=1 and carry a **REVISIT 2026-09-10** note.

**`fetch-prices` at 8.98h WILL fire during the current degradation, and that is a TRUE POSITIVE, not a false one.** Three of the four observed degraded fetch gaps (8.2h, 11.9h, 9.2h) exceed it, which is the threshold doing exactly what it was designed to do: catch two consecutive missed slots. **Do not raise it to make it quiet** - that hides a real fault. The risk is alert fatigue, not incorrectness. **Concrete tripline, not vibes: if the same issue key opens and closes more than twice in any 24h window, build reopen-cooldown flap suppression then** (propose N when it is real). Below that rate, a few true alerts during a genuine degradation is the supervisor working.

**REVISIT LIST for 2026-09-10** (a reversal condition without a scheduled reader is the probe-guard lesson waiting to recur):
1. Recompute all four p95 values from healthy history; `regenerate-pages` and `post` currently rest on n=1.
2. **Has fetch cadence returned to 4-hourly? If yes, `PRICE_DATA_MAX_AGE_H` returns to 6.**
3. Has the `fetch-prices` alert flapped more than twice in any 24h window? If yes, build the cooldown.

**Manual dispatches COUNT toward freshness, deliberately.** Freshness measures whether the work happened, not how, and a manual recovery must clear the alert, otherwise the supervisor stays red after the thing is fixed, which is how alerts get ignored. The triggering event is recorded in the alert body and the tick log so cron-death stays distinguishable from job-failure when read later.

**KNOWN COVERAGE HOLE, accepted and not worked around: the Bluesky weekly pulse.** `bluesky-posts.yml` has ONE job (`post`) on TWO crons, and the daily/weekly split happens inside a step rather than a job gate. So freshness on `post` observes the **daily** cron only, and the Sunday pulse (`0 18 * * 0`) could stop firing indefinitely without any signal, because a daily-drop success satisfies the same key. Tolerable because it is the least consequential job on the board. **If the weekly ever carries real weight, the fix is a distinct marker written by the weekly path** (a separate job id, or a `bot_state` key), NOT a cleverer run scan. No scan can separate two crons that land on one job id.

**Config self-audit, and its limit.** Each tick reads `.github/workflows/*` and alerts if any job in a workflow with an active cron is missing from the config array, plus the mirror case of a config entry pointing at a job that no longer exists. The direction is deliberate: workflows are the source of truth, the hand-assembled array is under suspicion. A workflow change ships through git and registers instantly while a config change needs a manual deploy, so the two can never be atomic and **the default outcome of adding a cron is that it is unwatched, silently**. **It proves coverage, not correctness**: it cannot tell you a threshold is wrong, and it cannot see the Bluesky hole above, because that cron does map to a watched job.

**Scan bound:** stop walking runs once one predates `now - max_age_hours`, because not-found and found-too-old are the same verdict. Without it, a job that never succeeds (or whose id was renamed in config) walks the whole run history every tick forever, getting slower exactly as the incident gets worse. Costs ~7 API calls per tick, 0.56% of the hourly ceiling. `cancelled` is explicitly not a success, since `deploy-frontend.yml` cancels in-progress runs via `concurrency: group: pages`.

### DEPLOY BY HAND. NEVER FROM ACTIONS.

`cd ops/supervisor && npx wrangler deploy`. **There is deliberately no GitHub Actions workflow that deploys this Worker, and one must never be added.** A supervisor deployed by the system it supervises cannot be updated while that system is degraded, which is exactly when you need to change it. On 2026-08-27 Actions could not create runs for eleven hours; a deploy pipeline living there would have been unavailable for the entire incident it exists to report. The manual step is the design, not an omission. Secrets (`SUPERVISOR_GITHUB_TOKEN`, `SUPERVISOR_QA_SECRET`) are set via `wrangler secret put` and never appear in a file or a log.

### Signal 2 (published-SHA drift) is a STUB, and why

`checkPublishedSha()` is a named empty seam. It is **deferred, not blocked**. It will compare `https://memradar.com/build.json` against the newest successful `github-pages` deployment SHA, alerting only on drift persisting across two consecutive ticks (a deploy in flight is legitimately mid-drift). Two things must land first: **`build.json` does not exist**, and `deploy-frontend.yml` has no step between `actions/checkout@v5` and `actions/upload-pages-artifact@v5` that could write it (only `setup-node` and `configure-pages` sit there; the only `run:` block executes after the artifact is sealed). And **a query string does NOT bust GitHub's Fastly layer** (measured 2026-08-27: distinct random query values returned `x-cache: HIT` on URLs never requested before, because the object is keyed without the query string), so the 600s cache window needs a Cloudflare-side rule or a different assertion shape. Cloudflare itself is not the obstacle: root-level `.json` returns `cf-cache-status: DYNAMIC` and is not edge-cached.

The deployment half is already implemented and reported in every tick's JSON. Note its **mandatory second call**: a deployment row exists from the moment it is queued, so the row alone proves nothing was published; only an explicit `state == "success"` status does. Do not optimize that call away.

### Failing loudly, and the gap that remains

Failure modes split in two. **(a) The tick ran and threw**, self-reportable if the channel still works. **(b) The tick never ran at all** (Worker not deployed, cron removed, Cloudflare incident), **structurally unreportable from inside the Worker** because nothing executes. (b) is the faithful analogue of 2026-08-27, where the failure was not "a job errored" but "nothing ran and nothing said so", so it was built FIRST.

**LAYER 0, the dead-man switch: healthchecks.io, pinged at the end of every successful tick, 45-minute grace (three missed ticks).** Covers (b); the failure path also pings `/fail` so (a) alerts in seconds instead of waiting out the grace period. **The independence IS the feature, so it was verified rather than assumed:** `hc-ping.com` resolves to Hetzner (`176.9.71.146` HETZNER-fsn1-dc6, `159.69.66.229`) serving `server: nginx` with no Cloudflare in front, so it shares no infrastructure with GitHub Actions or with the Cloudflare edge this Worker runs on. **Better Stack was rejected on measurement, not preference:** `server: cloudflare`, same blast radius as us. A Supabase `bot_state` heartbeat stays rejected as circular, since nothing independent would read it.

**Two properties not to break.** The success ping is the LAST statement in `runTick()`, because silence is the alarm and the ping must be unreachable by any path that did not fully succeed. **Never wrap the tick in a try/catch that pings anyway**: that converts the one check catching "nothing ran" into a check that always says everything is fine. And `SUPERVISOR_HEARTBEAT_URL` is a secret rather than a var because the URL's UUID *is* the credential; anyone holding it can forge a healthy ping and silence the switch.

**Layers 1 to 3 of (a), in deliberate order:** `console.error` (Workers observability, `npx wrangler tail`), then the heartbeat `/fail`, then a `[supervisor] TICK FAILURE` issue that self-closes on the next good tick and states plainly that no freshness result is trustworthy while it is open, then **a Resend email sent ONLY when the GitHub path itself failed**. GitHub being unreachable is exactly when the issue channel is useless, and emailing on every tick failure would train it to be ignored. The email goes to `hello@memradar.com`, the project's own public mailbox, so no personal address is committed to a public repo (change `ALERT_TO` to redirect it).

## Incident: 2026-08-26 daily regen deleted 151 pages

**Cause: the `regenerate-pages` job's env block omitted `RAKUTEN_AFFILIATE_ID`.** Every product with a Newegg offer builds a Rakuten deep link, which throws without it, so exactly the 151 Newegg-matched products failed. The generator **deletes all page dirs BEFORE writing**, so those 151 live pages were deleted and never rewritten, and the run **exited 0**, so the commit gate saw ordinary-looking changes and pushed the deletion.

**The hypothesis it was NOT.** A partial `pagedSelect` read was the obvious suspect and was wrong: that run logged `Loaded 235 products` and `Loaded 77843 price_history rows`, a complete load. Check the log before believing a plausible mechanism.

**Fixes:** the secret is now passed (with a comment that any new env the generator reads must be added there too), and **the generator exits nonzero whenever `--confirm` produces any failures**, because a run that deletes page dirs up front has already removed N live pages by the time N products fail. A partial site is never a success, and the caller that commits must never see one. `pagedSelect` now reports rows and pages on labelled calls and accepts an `expected` count that fails loudly on mismatch, since a short page genuinely is treated as end-of-data.

**Still open (deeper fix, not built):** the delete-before-generate ordering is the underlying hazard. Generating to a temp location and swapping, or deleting only slugs absent from the catalog after a successful build, would make partial output non-destructive rather than merely loud.

## Guides (`/guides/`)

Editorial pages argued from our own data, generated (not hand-written) so the argument never drifts from the numbers beside it. Index at `/guides/` (sitemap 0.6); guides at `/guides/should-i-buy-ram-now/` and `/guides/should-i-buy-an-ssd-now/` (0.7 each, changefreq daily). Templates live beside their output; builders are `buildGuideRamNow()` / `buildGuideSsdNow()` / `buildGuidesIndex()`; the `GUIDES` registry drives the index.

**ONE SHARED LIVE MODULE, `frontend/js/guide-live.js`** (was `guide-ram-now.js`, renamed when the second guide landed). Nothing in it was ever RAM-specific: it is entirely DOM-driven (table cell ids, `.guide-atl-row[data-sku]`, `#guideChartData`), so both guides share it and cannot drift apart. Shared emphasis classes were renamed off their RAM origins at the same time, `.guide-row--focus` (was `--ram`) and `.listing-guide-link` (was `.ram-guide-link`), because a class named for one category lies on the other page.

**Per-guide generated elements:** the 4x4 trend table with that guide's own two segments emphasised, a deepest-history chart picked from that guide's own category, and a near-ATL list filtered by category through the shared `nearAtl(products, neweggBySku, category)`. Each guide is independently skippable in the generator: a category with no long history leaves that one guide at its last good build instead of failing the run.

- **FOOTER RULE: exactly ONE footer link, "Guides", pointing at the index.** Individual guides never get footer links, however good they are. The footer is navigation, not a reading list, and it is duplicated on 258 pages.
- **Prose states magnitudes; the table states figures.** The copy says "over 300%" and "well over 150%", never a decimal, because a per-period fairness subset can move a single figure by tens of points (measured: DDR4's 1-year change swings from +189.5% to +159.3% depending on cohort). The table carries the precise current numbers and links the Price Index methodology. Same principle as the index page's tens-floor: **a claim in prose must survive scrutiny that a table cell does not have to.**
- **Live elements:** the 4x4 trend table (same `market_stats` source as the Price Index, RAM rows emphasised), a decade chart, and the near-all-time-low RAM list. Hydration parity applies: the table and the ATL list both refresh from the same sources they were baked from. The ATL list hydrates the CURRENT price and recomputes the gap from it, since the all-time low itself only moves when a new low is set, which a regeneration captures. Out-of-stock products are excluded at BOTH retailers: recommending an unbuyable kit is the same failure as quoting an unbuyable price.
- **Chart:** a small dedicated static renderer, deliberately NOT a fork of the PDP's chart (100 lines coupled to range buttons and the hydrate config) and deliberately not a shared extraction (that would touch all 235 PDPs for a one-page benefit). It reuses only the visual language. **RESOLVED 2026-08-27:** the SSD guide was that second guide, and the renderer moved into the shared `guide-live.js`. The original objection (that a shared extraction would touch all 235 PDPs) never applied to the guide chart, which only guides use.

**DAILY REGENERATION (`regenerate-pages` job in `newegg-refresh.yml`, 09:00 UTC).** Built for this guide and long deferred before it. Every other page degrades gracefully when stale, but this one ARGUES from baked values, ranks products, prints its own build date and tells the reader it updates automatically, so a stale build is a page making a false claim about itself. That was the trigger condition. Runs after the 06:00 Newegg refresh and the 08:00 stats compute. **`set -euo pipefail`: any error commits nothing and exits red** (stale beats wrong). **DAILY COMMITS ARE EXPECTED AND ACCEPTED, and the earlier claim here that a quiet day produces no commit was never true of the code.** `contentHash` normalises `?v=`, "Last updated" and `priceValidUntil`, but NOT the "Page last regenerated" date that guides and the Price Index print, and the commit gate reads `git status --porcelain frontend/` rather than the manifest in any case. A literal no-op day is impossible by design while a page tells the reader when it was last regenerated, and that date has to stay true. This is fine: the commits deploy real price changes, and no Vercel crons remain for a push to collide with. What the gate does do is skip a genuinely empty commit and report a **truthful** `pages_changed`, computed by `scripts/count-content-changes.js` (manifest hash diff against HEAD) rather than by `git status`, which would also count files dirty only because the shared `?v=` stamp moved. The summary JSON reports `committed` and `pages_changed` so a silent no-op day is distinguishable from a broken one. Each job is gated to its own cron (`if: github.event.schedule == ...`), because two crons times two jobs would otherwise pull the Newegg feed twice daily and regenerate before stats exist.

## Retailer & Affiliate Program Status

Current queue (as of 2026-08-23):

| Retailer | Network | Status |
|---|---|---|
| **Amazon** | Associates (`memradar-20`) | **Live**, earning-ready |
| **Newegg** | Rakuten Advertising (SID 4705448, MID 44583) | **Live**, feed-automated (see the Newegg integration section) |
| **B&H Photo** | Impact | **Applied 2026-08-22**, decision expected ~2 weeks |
| **Walmart** | — | Nudged June + follow-up, still silent |
| **Best Buy** | — | Final follow-up email + public tweet sent 2026-08-21; **considered closed** pending any response |

### B&H Photo (applied 2026-08-22)

Applied **directly via B&H's own affiliate program page** (linked from the bhphotovideo.com footer), which runs on Impact.

**Impact Marketplace status is a red herring, do not re-litigate it.** The Marketplace application has been **Declined since July** (the pre-launch site did not meet their directory bar). This does **NOT** block direct brand partnerships: the Impact account is valid and domain-verified, and a B&H approval lands in the Impact dashboard regardless of Marketplace status. Reapplying to Marketplace is not a prerequisite.

**Integration policy, decided in advance of any answer: approved-relationship-first, data-path-second.**

1. **If approved AND a legitimate data path exists** (check Impact's product-feed catalog for B&H once approved), revisit using the same architecture that served Newegg: `retailer_offers` rows plus a gated matcher, current-price comparison only.
2. **If the only available data path would be scraping, we decline the data on provenance grounds.** RamRadar scrapes (stated on their own About page); MemRadar's data story is **licensed and verifiable** (Keepa written permission, Rakuten feed contract) and stays that way. A scraped price would be the only unattributable number on the site.
3. An **unpriced "also at B&H" link row** is a possible future design question if (1) fails but the affiliate relationship exists. **Explicitly not built, not designed, and not to be built unbidden.**


## Dark Mode

Implemented across all pages via:
- **localStorage key:** `memradar-theme` — values: `'dark'` or `'light'`
- **CSS class:** `dark` on `<html>` element (`document.documentElement`)
- **Flash prevention:** inline synchronous `<script>` in each `<head>` (after viewport meta, before stylesheet) reads localStorage and applies `html.dark` before any CSS renders
- **System preference:** on first visit (no saved preference), respects `prefers-color-scheme: dark`
- **Toggle button:** `.theme-toggle` button in every page's `<nav>` — moon icon in light mode, sun icon in dark mode, SVG injected by `js/theme.js`
- **JS file:** `frontend/js/theme.js` — handles icon rendering and localStorage persistence
- **Dark palette:** background `#0f1623`, surface `#1a2332`, text `#f1f5f9`, secondary text `#94a3b8`, borders `#2d3f55`, brand cobalt `#3A5BC7` unchanged (dark-mode accent text uses `--brand-light: #a4c0ec`)

## Mobile Navigation

Below the **768px** breakpoint the desktop `.nav-link`s hide (`nav .nav-link { display:none }`) and a hamburger menu takes over. Owned by **`frontend/js/mobile-nav.js`** (shared file); CSS under the `/* Mobile Nav */` section in `style.css`.

- **Markup** lives inside `<nav>` on every shared-header page: a `.mobile-nav-toggle` button (`#mobileNavToggle`, two SVGs — hamburger swaps to an X via `aria-expanded`) placed left of "Set an Alert", plus a `.mobile-nav-panel` (`#mobileNavPanel`) with the four nav links (48px tap targets). Both are `display:none` on desktop, enabled only in the ≤768px media query — **desktop is completely unaffected** (display:none elements aren't flex items, so no layout shift).
- **Panel** is `position:absolute` under the sticky `.site-header` (full-width slide-down via max-height/opacity transition).
- **Behavior:** toggle opens/closes; tapping a link navigates; outside-click and Escape close; `body.mobile-nav-open` locks scroll; resizing to desktop auto-closes.
- **Applied to all 14 shared-header pages** (index, ram/ssd/faq/blog + article, about/contact/privacy/terms/affiliate, both 404s, ram/product-template). The markup + `mobile-nav.js` include are injected uniformly; the script path mirrors each page's `theme.js` prefix. If you add a new page with the shared header, include `mobile-nav.js` and the toggle/panel markup.

## Asset Caching / Cache-Busting

`style.css` is served with `Cache-Control: max-age=14400` (**4 hours** of browser caching). A Cloudflare purge clears the edge but **NOT** visitors' browser caches — so after a CSS change, returning devices can render new HTML against a stale 4-hour-cached stylesheet (this exact mismatch broke the mobile nav on first ship: new hamburger HTML + old CSS).

**Fix / convention:** a single shared version query is appended to **both `style.css` and every local JS include** on every page — `?v=YYYYMMDD` (current value: **`20260906`**). A new URL forces browsers to refetch immediately regardless of max-age.

- **Bump the `?v=` value whenever any `style.css` OR local JS file changes**, and update ALL pages together (one shared stamp — they must all match). Bumping rebusts every asset; that's fine.
- Applies to local assets only: `css/style.css` and `js/*.js` (main, theme, alert-modal, supabase-client, market-pulse, product-listing, mobile-nav, filter-sheet, back-to-top, guide-live, price-index). **External CDN scripts are NOT versioned** (jsdelivr supabase-js, cdnjs Chart.js, Cloudflare Turnstile, gtag) — they carry their own versioning.
- When adding a new page or a new local script include, add `?v=<current>` to match.

## Safety Rules for Claude Code
- NEVER run destructive database operations (DROP TABLE, DELETE, TRUNCATE) without explicit written confirmation from Malc first
- NEVER modify or delete .env files
- NEVER commit any file containing API keys, secrets, or environment variables
- NEVER expose the SUPABASE_SECRET_KEY in any frontend file
- Always prefer additive operations over destructive ones
- When in doubt about a destructive action, stop and ask

## Social

- **Bluesky:** `@memradar.bsky.social`, the live account, posting daily. `https://bsky.app/profile/memradar.bsky.social`. **This is the ONLY social link in the footer** (swapped from X on 2026-08-27, since X went dormant at the API pivot and linking to a profile with no recent activity is the same small accuracy problem as a stale `sameAs`).
- **X (Twitter):** `@memradar` at `https://x.com/memradar`. Account still exists, **no longer linked from the site**. See the Social Bot section: the posting path is dormant, not deleted.

**THE FOOTER SOCIAL LINK IS DUPLICATED MARKUP ON 260 FILES** (235 generated PDPs + 25 hand-written/template pages), because the footer is not a shared include and the consolidation TODO still stands. The block is byte-identical everywhere by design, so **grep for every instance and verify the hashes match afterwards**; editing one and assuming is how the three alert-result pages get missed. The PDP footer comes from `frontend/ram/product-template.html`, and guides/price-index from their own templates, so any change must land in the templates AND the already-generated output together or the next regen silently reverts it.

**BLUESKY LOGO: official asset only, and it may NOT be recolored to the footer grey.** The mark is the official butterfly from `https://bsky.social/about/brand-assets/butterfly/bluesky_media_kit_logo_transparent_1.svg`, embedded with its path data byte-for-byte and its `viewBox="0 0 568 501"` intact (verified against the downloaded file at build time, not eyeballed). Bluesky's brand guidelines explicitly permit the butterfly as a profile-link icon without permission, but prohibit **"recolor the logo (other than the approved black and white variants)"** and direct you to **"use a monochrome (black or white) variant when displaying alongside other social media icons"**. The old X mark used `fill="currentColor"` to sit at the footer grey; doing that here would be a prohibited alteration. **So the resting state is the exact official black (light) / white (dark) variant via `.footer-social-icon`, and the hover affordance is opacity, not colour.** Do not "fix" this back to `currentColor`. Same standing rule as the retailer logos: source the official mark or ship text, never approximate one.

**`sameAs` LIVES IN EXACTLY ONE PLACE: the `Organization` block on the homepage** (`frontend/index.html`, added 2026-08-27). Site-wide brand identity is declared once at the site root, carries `@id: "https://memradar.com/#organization"`, and the homepage `WebSite` node references it via `"publisher": { "@id": ... }` so the two are one entity rather than two unrelated ones.

**`sameAs` lists ONLY live profiles.** Currently just the Bluesky profile. **The X account is deliberately absent**: it is dormant, and `sameAs` is precisely the field that tells search engines which profiles belong to this brand, so listing a dead one is the accuracy problem removed from the footer the same day. Do not add it back while X is dormant.

**Do not add a second top-level `@type: Organization` to the homepage.** `Organization` also appears across 156 other pages as a NESTED value and those are different nodes: `author`/`publisher` on blog articles and `creator` on the Price Index (all MemRadar), and `brand` on PDPs (the product manufacturer, e.g. Samsung). None of those conflict, because a nested node is not a page-level entity declaration. Validated on add: both homepage blocks parse, exactly one top-level Organization, no duplicate `@type` or `@id`, and the `publisher` reference resolves to a node declared on the same page.

**`logo` is `android-chrome-512x512.png`, NOT `og-image.png`, and this distinction matters.** The OG image is a 1200x630 social share card with text, which is the wrong shape and content for this field: Google wants a clean image of the mark itself, square-ish, minimum 112x112. The 512x512 app icon is the radar mark on the `#0f1623` rounded square with no text and no wordmark, 96.6% opaque with only the rounded corners transparent. It is the largest square master the site ships. Both it and the OG image derive from `frontend/favicon-source.svg`, so **re-run `scripts/generate-favicons.js` if that master changes**, or the schema will point at a stale mark.

There are no `twitter:site` / `twitter:creator` meta tags anywhere. The `twitter:card` / `twitter:title` / `twitter:image` tags on every page are card metadata that name no account, so they are correct as-is and were left alone.

## Rate Limiting & Spam Protection

Four layers are in place:

1. **Cloudflare Turnstile** — CAPTCHA widget embedded in the alert modal (Step 3) and PDP inline alert form. Site key `0x4AAAAAADTmp79GaQVF5cAu` is public and already in the frontend. Server-side token verification is implemented in `backend/lib/turnstile.js` — wire it into the alert submission endpoint when built. Requires `TURNSTILE_SECRET_KEY` in `.env` and Vercel before server-side verification is active. Script loaded in `<head>` of `index.html` and `ram/product-template.html` (add to other pages that use the alert modal when enforcing CAPTCHA site-wide).

2. **Honeypot fields** — Hidden `name="website"` input in both the alert modal (`id="modalHoneypot"`) and PDP form (`id="pdpHoneypot"`). Positioned off-screen via `position:absolute;left:-9999px;opacity:0` (not `display:none` — bots detect that). If the field contains any value, the submission is silently rejected. Check is already wired into both form submit handlers.

3. **Server-side rate limiting** — `backend/lib/rateLimiter.js` implements a sliding-window in-memory limiter: max 3 alert submissions per IP per hour. Import and call `rateLimit(ip)` in the alert submission endpoint before processing. Note: in-memory only — replace with Upstash Redis before running multiple Vercel instances.

4. **Client-side search rate limiting** — `frontend/js/main.js` limits search submissions to 30 per minute. Shows "Too many searches — please wait a moment." if exceeded. Server-side rate limiting should also be added at the Supabase/API level when search is wired up.

## Email / Alerts
- Email sending: Resend (resend.com)
- Sending address: hello@memradar.com
- API key stored as `RESEND_API_KEY`
- Used for: price drop alert notifications to users
- Alert logic: fires when `price_history` current price <= `alerts.target_price` and `alerts.triggered = false`
- After sending: update `alerts.triggered = true` so user only receives one email
- **Input validation:** When alert endpoint is built, import `validateAlert` from `backend/lib/validateAlert.js` and run before any database operation. Use `sanitized` values from the result, never raw user input.

## Security Notes
- **HTTPS:** Vercel enforces HTTPS automatically. On Cloudflare, "Always Use HTTPS" must be enabled under SSL/TLS → Edge Certificates to prevent any plain HTTP access via the CDN layer.
- **Cron endpoint:** `/api/fetch-prices` is protected by `Authorization: Bearer <CRON_SECRET>`. Returns 401 for any other request. Vercel sends this header automatically on cron triggers.
- **RLS:** All three Supabase tables have Row Level Security enabled. `products` and `price_history` are public read only. `alerts` is service-role only — no public access to user emails.
- **Secrets:** All secrets are in `.env` (local) and Vercel environment variables (production). `.env` is in `.gitignore` and was never committed. `SUPABASE_SECRET_KEY` is server-side only.
- **Frontend deps:** Zero production vulnerabilities (`npm audit --omit=dev`). Dev-only scripts (`generate-favicons.js`) are excluded from Vercel builds and GitHub Pages deploys.

## Database Performance

Indexes are defined in `backend/schema.sql` but must be manually applied in the Supabase SQL Editor — they are not created automatically. Apply once `price_history` has real data flowing. Partial index on `alerts(triggered) WHERE triggered = false` keeps the alert check query fast as the table grows (only indexes the untriggered rows, which shrinks over time as alerts fire).

## Git Identity

Commits in this repo must use this author identity so GitHub attributes contributions to Malcolm's account (github.com/malcolm15):

```
git config --global user.email "malcolmkonner@gmail.com"
git config --global user.name "MemRadar"
```

- **Email** must be exactly `malcolmkonner@gmail.com` — this is the email on the GitHub account, which is how GitHub credits contributions.
- **Name** is intentionally `MemRadar`, not Malcolm's real name — git author names are publicly visible in repo history, and personal identity is kept separate from this project.
- Apply this config at the start of any session before committing. If it's already set, no action needed.

## Code Conventions

- Vanilla JS only on the frontend — no bundler, no framework
- Backend is CommonJS (`require`/`module.exports`)
- Keep secrets out of code — always use `process.env.*`
- No comments unless the "why" is non-obvious
- Prefer parallel `Promise.all` for independent async operations (already used in fetch-prices)
