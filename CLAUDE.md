# MemRadar — Claude Code Context

RAM & SSD price tracker for PC builders. Goal: ship a real product at **memradar.com**.

---

## Project Overview

MemRadar tracks RAM and SSD prices across retailers (Best Buy at launch, Amazon planned), stores historical price data, and alerts users when prices drop to their target. Targeted at PC builders who know exactly what they want and are waiting for the right price.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS / HTML / CSS — static, no framework |
| Hosting | GitHub Pages + Cloudflare (frontend) |
| Backend | Node.js serverless functions on Vercel |
| Database | Supabase (Postgres) |
| Data source | Keepa API — Amazon price history (launch). Best Buy client dormant (never approved) |
| Cron | Vercel cron — daily at 06:00 UTC (`0 6 * * *`) |

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
│   │   └── supabase.js      # Supabase client (uses service role key)
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
│   ├── brand/                       # Brand assets — og-image.png, og-image.svg, memradar-x-header.png, memradar-x-profile.png
│   ├── css/style.css                # All styles — no CSS framework
│   ├── js/main.js                   # Search handler stub
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
│   └── generate-favicons.js     # Regenerates all favicon PNGs + ICO from favicon-source.svg
├── vercel.json              # Vercel cron config
├── package.json
└── .env                     # Local secrets — NEVER commit this file
```

## Database Schema (Supabase / Postgres)

Four tables:

- **`products`** — one row per tracked product. Unique key: `sku`. Fields: `sku`, `name`, `category` (ram/ssd), `brand`, `model`, `image_url`, `product_url` (affiliate link), `retailer`.
- **`price_history`** — one price snapshot per product per cron run. Fields: `product_id` (FK), `price`, `regular_price`, `in_stock`, `fetched_at`.
- **`alerts`** — user email + target price per product. Fields: `product_id` (FK), `email`, `target_price`, `triggered`.
- **`market_stats`** — one row per Market Pulse segment (`ddr5`/`ddr4`/`nvme_ssd`/`sata_ssd`), recomputed daily by the cron. Fields: `segment` (unique), `current_avg_price`, `baseline_avg_price`, `pct_change`, `product_count`, `computed_at`. Despite the column names, the values are **medians** (see Market Pulse Stats section).

Row Level Security is enabled on all tables. `products`, `price_history`, and `market_stats` are public read. `alerts` is service-role only (contains user emails).

## Environment Variables

Required in `.env` (local) and Vercel project settings (production):

| Variable | Purpose |
|---|---|
| `BBY_API_KEY` | Best Buy Open API key |
| `PRICE_API_KEY` | PriceAPI.com key for price data (trial, evaluating as Best Buy replacement) |
| `KEEPA_API_KEY` | Keepa API key for Amazon price history (20 tokens/min plan) — must also be set in Vercel env vars |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service role key (not the anon key) |
| `CRON_SECRET` | Random secret — Vercel sends as Bearer token to protect `/api/fetch-prices` |
| `RESEND_API_KEY` | Resend email sending API key — production key from resend.com |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key — from dash.cloudflare.com. Site key (public, already in frontend): `0x4AAAAAADTmp79GaQVF5cAu` |

**Security notes:**
- `.env` must never be committed — it is (and must stay) in `.gitignore`
- `SUPABASE_SECRET_KEY` is the service role key — it bypasses RLS. Only used server-side.
- The cron endpoint checks `Authorization: Bearer <CRON_SECRET>` and returns 401 otherwise.
- The frontend only ever uses public/anon Supabase access (when that's wired up).

## How the Price Fetch Works (Keepa)

1. Vercel cron hits `/api/fetch-prices` daily at 06:00 UTC
2. Handler verifies `Authorization: Bearer <CRON_SECRET>`
3. Loads the Amazon catalog from `products` (retailer=`amazon`, `sku` = ASIN)
4. Fetches current stats from Keepa in batches of ≤100 ASINs (`history=0&stats=90` — stats only, smaller payload, same token cost of 1/ASIN)
5. For each product with a current price, appends ONE `price_history` row (`fetched_at` = now, `regular_price` = 90-day stats max). Out-of-stock products (no valid current price anywhere) get no row and are counted in the summary. Per-product errors are isolated — one failure never kills the run.
6. Returns a JSON summary: `{success, source:'keepa', ram/ssd counts, out_of_stock, errors, tokens_left, duration_ms}`

The script can also run directly via `node api/fetch-prices.js` for manual testing.

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

## Keepa Backfill (`scripts/backfill-keepa.js`)

One-time historical load of full Keepa price history into `price_history`:

- **Dry-run by default** — fetches from Keepa (consumes tokens) but writes nothing. `--confirm` writes.
- **Downsampled to daily:** at most one row per product per UTC calendar day (last reading of the day). Gap days carry the last known price with `in_stock=false` (schema requires `price NOT NULL`); leading gaps are skipped.
- `regular_price` = max stored price in the trailing 90 days (or null), applied per product.
- **Full replace semantics:** with `--confirm`, each product's existing `price_history` rows are deleted before its new rows are inserted — re-runs are safe/idempotent. Inserts go in chunks of 500.
- Per-product failures are isolated and reported in the final summary.

## Frontend State

The frontend is fully designed and built but the product cards show placeholder data — prices display as `$—`. A "coming soon" banner on the homepage communicates pre-launch status and includes a "Set an Alert" CTA. The Market Pulse section is LIVE — `js/market-pulse.js` renders real `market_stats` data with a dynamic "Last updated" date (hardcoded HTML values remain as loading/fallback state). Search form submission is stubbed (`console.log` only).

**Design system:** blue accent `#2563eb`, neutral grays, clean sans-serif. No CSS framework. Mobile responsive with breakpoints at 768px and 480px.

## Deployment Status

- **GitHub Pages:** Live at [memradar.com](https://memradar.com). Deployed via GitHub Actions workflow (`.github/workflows/deploy-frontend.yml`) — triggers on any push to `main` that touches `frontend/`.
- **Custom 404 page:** `frontend/404.html` is served automatically by GitHub Pages for any missing URL. A copy lives at `frontend/404/index.html` so `memradar.com/404/` works as a clean URL — both files are identical and use absolute asset paths so they work from either location. Note: a Cloudflare redirect from `memradar.com/404.html` → `memradar.com/404/` would be clean, but `404.html` must remain at root level for GitHub Pages' automatic 404 handling — it cannot be moved.
- **Custom domain:** memradar.com — fully configured. Cloudflare DNS A records point to GitHub Pages IPs, SSL/TLS set to Full, CNAME file committed to `frontend/`. Custom domain set in GitHub Pages settings.
- **Vercel:** Live. All env vars set in Vercel dashboard. `BBY_API_KEY` is set to `pending` — awaiting Best Buy API approval before the cron fetch will work.
- **Best Buy API:** Access pending approval. Cron is configured but non-functional until approved.
- **Google Search Console:** memradar.com added as a property. Sitemap submitted at `https://memradar.com/sitemap.xml`.
- **Google Analytics:** GA4 installed on all HTML pages. Measurement ID: `G-797Q89S8GG`. Snippet is in the `<head>` of every page.
- **SEO:** Full SEO pass complete. All pages have unique titles, descriptions, Open Graph, Twitter cards, canonical tags, and JSON-LD structured data (WebSite schema on homepage, WebPage/ContactPage on inner pages). Keywords targeted: "RAM price tracker", "SSD price history", "DDR5 price drops", "PC memory deals", "best time to buy RAM", "SSD price alert".
- **Brand assets:** `frontend/brand/` contains brand assets for safekeeping — og-image.png, og-image.svg, memradar-x-header.png, and memradar-x-profile.png. The X header/profile images are uploaded manually on GitHub.
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

**Rendering (`.listing-card`):** product image (with gray-placeholder fallback on error), brand badge (omitted entirely when `brand` is null — never an empty/"null" badge), current price, 30-day change indicator (green ▼ for drops, red ▲ for rises, nothing if no baseline), and a "View on Amazon" affiliate button. Each card has `data-sku` for future PDP wiring. Default sort is Name A–Z; skeleton grid (8 pulsing cards) shows while loading; a live "Showing N products · Prices updated daily" count sits above the grid.

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
- Stats per page (computed from full history at build time): current, all-time low/high with month+year, 90-day average, 30-day change, price-per-GB vs segment median $/GB.
- Similar Products: 3 same-segment products nearest by current price, linking to their generated URLs.
- **Regeneration workflow (manual for now):** `node scripts/generate-product-pages.js --confirm`, then commit + push (generated pages ARE committed — they're the deployed site), then purge Cloudflare. **TODO:** daily automated regeneration via a scheduled GitHub Action (not built yet).
- Sitemap: regenerated on each run — static URLs preserved, product URLs replaced (priority 0.6, changefreq daily, lastmod = build date).
- Listing cards link to PDPs (whole card + name link; the Amazon button stays a direct affiliate link via stopPropagation). `slug` is included in the listing page query.

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

**Cron alert step** (`backend/lib/alertCheck.js`, run from `api/fetch-prices.js` after price inserts, isolated try/catch): query `confirmed=true AND triggered=false`, match `current<=target` against the just-inserted prices, **send-then-mark** (send email → log → set `triggered=true`; **if send fails leave `triggered=false` so tomorrow retries**), plus DELETE unconfirmed alerts >48h old (makes the pending cap self-healing). Stats in the cron summary: `checked/matched/sent/failed/expired_cleaned`. `scripts/run-alert-check.js` runs this step standalone for testing (no Keepa fetch).

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
- Additional retailers (Best Buy client dormant; Walmart/Newegg never integrated)

## Data Source Evaluation Findings (July 2026)

Findings from evaluating price-data providers as a Best Buy replacement (Best Buy never approved API access). Use `scripts/test-priceapi.js [source]` to re-run a PriceAPI schema check at any time.

**PriceAPI trial:**
- US retail sources are limited to **amazon**, **ebay**, and **google_shopping** — and `google_shopping` **cannot keyword-search** on the trial (its `search_results`/`term` topic is not entitled; only `product`/`offers`/`product_and_offers`/`reviews` keyed by `id`/`gtin`). **Walmart, Newegg, and Best Buy are NOT available at all.** Everything else offered is mostly EU comparison sites (billiger, idealo, geizhals, galaxus, pricerunner, bol, medizinfuchs).
- **Validation is loose:** bogus upstream params return generic, unfiltered allowed-value lists for downstream params, so a source/topic combo only appears valid until you send a real job. **Only an actual job run truly validates a source/topic/key combination.** (Unknown sources/topics return HTTP 500 rather than a clean error.)
- **Amazon `search_results` schema notes:** ASIN arrives as `id`; prices are **strings** split into `min_price`/`max_price` (range across sellers); `brand_name` is **null** on search results; `review_rating` is a **0–100** scale, not 5-star; seller-level data requires a **second `offers` call keyed by ASIN**. **No price history on any topic** — all responses are point-in-time snapshots.
- **Cost observed:** **1 credit** per search job returning 16 products (`max_pages=1`).

**Strategic conclusion:** PriceAPI is **not worth the €99/month** post-trial for our needs (no Walmart/Newegg/Best Buy, no price history). **Keepa** (Amazon price-history API, ~€49/month) is the **leading candidate for launch data**, pending their reply about public-display terms. The `test-priceapi.js` script remains useful for schema reference and any future re-evaluation.

## Keep-Alive Cron
- Endpoint: `/api/keep-alive`
- Schedule: Every 3 days at 12:00 UTC (`0 12 */3 * *`)
- Purpose: Prevents Supabase free tier from pausing the project due to inactivity
- Auth: Same `CRON_SECRET` Bearer token as `fetch-prices`
- Can be removed once `fetch-prices` is running daily with real Best Buy data
- 2026-07-22: Root cause was CRON_SECRET mismatch/absence in Vercel env (cron fired but 401ed before reaching Supabase, so no DB activity registered). Fixed by rotating CRON_SECRET across Vercel, .env, and 1Password, then redeploying. Verified 200 response with live product count. Keep-alive remains active until Keepa daily fetches are confirmed running for a week, then can be retired.
- Daily Keepa fetch is now the primary DB activity; keep-alive can be retired after confirming 7 consecutive successful daily fetch runs (check Vercel cron logs or the fetch summary responses).

## Seed Data
`scripts/seed-database.js` was run once (2026-05-27), adding 3 seed products (`SEED-RAM-001`, `SEED-RAM-002`, `SEED-SSD-001`) + 3 seed price_history rows.

**Removed 2026-07-21.** The seed rows (and their price_history children) were deleted once the real Amazon catalog was upserted — see "Product Catalog" below. The `products` table now holds only real catalog data; `price_history` is empty pending Keepa.

## Product Catalog
Built 2026-07-21 via `scripts/build-catalog.js` (18 Amazon keyword searches through PriceAPI, ~18 credits) → reviewed preview → `scripts/upsert-catalog.js --confirm`.

- **235 products** in `products` (119 ram / 116 ssd), retailer `amazon`, `sku` = ASIN, clean `/dp/{ASIN}/` URLs (no affiliate tag — appended at display time).
- Brands resolved via a canonical known-brands map in `build-catalog.js` (`brand_name` is null on PriceAPI search_results); 183 matched, 52 null (off-brand makers left null rather than guessed).
- `price_history` is intentionally **empty** — the catalog prices were point-in-time search snapshots and were NOT stored as history. Price history comes from Keepa in the next pipeline step.
- The preview JSON lives at `scripts/output/` (gitignored — regenerable; DB is the source of truth). Re-derive brands/filters offline with `node scripts/build-catalog.js --reprocess` (no credits).

## Development Notes

- **Node ≥ 18** required (native `fetch` used, no node-fetch)
- **Dev dependencies:** `sharp` and `to-ico` installed for image generation scripts. Run `npm install` before running `generate-favicons.js` or any image conversion scripts.
- Run `node scripts/test-api.js` to verify the Best Buy API key works before touching the cron logic
- Vercel Hobby plan limits cron to once per day — the `0 6 * * *` schedule reflects this
- The `supabase.js` client uses the **service role key** intentionally — it runs server-side only and needs to bypass RLS for writes

## Affiliate Tags

- **Amazon Associates:** `memradar-20`
  - All Amazon product URLs must include the tag: `https://amazon.com/dp/PRODUCTID?tag=memradar-20`
- **Best Buy:** pending API approval — update when confirmed
  - Same principle applies: append affiliate tag to all Best Buy product URLs once confirmed

Never generate Amazon or Best Buy product links without the appropriate affiliate tag appended.

## Dark Mode

Implemented across all pages via:
- **localStorage key:** `memradar-theme` — values: `'dark'` or `'light'`
- **CSS class:** `dark` on `<html>` element (`document.documentElement`)
- **Flash prevention:** inline synchronous `<script>` in each `<head>` (after viewport meta, before stylesheet) reads localStorage and applies `html.dark` before any CSS renders
- **System preference:** on first visit (no saved preference), respects `prefers-color-scheme: dark`
- **Toggle button:** `.theme-toggle` button in every page's `<nav>` — moon icon in light mode, sun icon in dark mode, SVG injected by `js/theme.js`
- **JS file:** `frontend/js/theme.js` — handles icon rendering and localStorage persistence
- **Dark palette:** background `#0f1623`, surface `#1a2332`, text `#f1f5f9`, secondary text `#94a3b8`, borders `#2d3f55`, blue accent `#2563eb` unchanged

## Mobile Navigation

Below the **768px** breakpoint the desktop `.nav-link`s hide (`nav .nav-link { display:none }`) and a hamburger menu takes over. Owned by **`frontend/js/mobile-nav.js`** (shared file); CSS under the `/* Mobile Nav */` section in `style.css`.

- **Markup** lives inside `<nav>` on every shared-header page: a `.mobile-nav-toggle` button (`#mobileNavToggle`, two SVGs — hamburger swaps to an X via `aria-expanded`) placed left of "Set an Alert", plus a `.mobile-nav-panel` (`#mobileNavPanel`) with the four nav links (48px tap targets). Both are `display:none` on desktop, enabled only in the ≤768px media query — **desktop is completely unaffected** (display:none elements aren't flex items, so no layout shift).
- **Panel** is `position:absolute` under the sticky `.site-header` (full-width slide-down via max-height/opacity transition).
- **Behavior:** toggle opens/closes; tapping a link navigates; outside-click and Escape close; `body.mobile-nav-open` locks scroll; resizing to desktop auto-closes.
- **Applied to all 14 shared-header pages** (index, ram/ssd/faq/blog + article, about/contact/privacy/terms/affiliate, both 404s, ram/product-template). The markup + `mobile-nav.js` include are injected uniformly; the script path mirrors each page's `theme.js` prefix. If you add a new page with the shared header, include `mobile-nav.js` and the toggle/panel markup.

## Asset Caching / Cache-Busting

`style.css` is served with `Cache-Control: max-age=14400` (**4 hours** of browser caching). A Cloudflare purge clears the edge but **NOT** visitors' browser caches — so after a CSS change, returning devices can render new HTML against a stale 4-hour-cached stylesheet (this exact mismatch broke the mobile nav on first ship: new hamburger HTML + old CSS).

**Fix / convention:** a single shared version query is appended to **both `style.css` and every local JS include** on every page — `?v=YYYYMMDD` (current value: **`20260725`**). A new URL forces browsers to refetch immediately regardless of max-age.

- **Bump the `?v=` value whenever any `style.css` OR local JS file changes**, and update ALL pages together (one shared stamp — they must all match). Bumping rebusts every asset; that's fine.
- Applies to local assets only: `css/style.css` and `js/*.js` (main, theme, alert-modal, supabase-client, market-pulse, product-listing, mobile-nav). **External CDN scripts are NOT versioned** (jsdelivr supabase-js, cdnjs Chart.js, Cloudflare Turnstile, gtag) — they carry their own versioning.
- When adding a new page or a new local script include, add `?v=<current>` to match.

## Safety Rules for Claude Code
- NEVER run destructive database operations (DROP TABLE, DELETE, TRUNCATE) without explicit written confirmation from Malc first
- NEVER modify or delete .env files
- NEVER commit any file containing API keys, secrets, or environment variables
- NEVER expose the SUPABASE_SECRET_KEY in any frontend file
- Always prefer additive operations over destructive ones
- When in doubt about a destructive action, stop and ask

## Social

- **X (Twitter):** `@memradar` — official account at `https://x.com/memradar`. The X icon link appears in the footer of every HTML page (`index.html`, `about.html`, `contact.html`, `privacy.html`, `terms.html`, `affiliate.html`, `ram/index.html`, `ssd/index.html`, `ram/product-template.html`).

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
