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
| Data source | Best Buy Open API (launch), Amazon (planned) |
| Cron | Vercel cron — daily at 06:00 UTC (`0 6 * * *`) |

## Directory Structure

```
memradar/
├── api/
│   └── fetch-prices.js      # Vercel serverless function + cron handler
├── backend/
│   ├── lib/
│   │   ├── bestbuy.js       # Best Buy API client + data normalizers
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
│   ├── css/style.css                # All styles — no CSS framework
│   ├── js/main.js                   # Search handler stub
│   └── js/theme.js                  # Dark mode toggle + localStorage persistence
├── .github/
│   └── workflows/
│       └── deploy-frontend.yml  # GitHub Actions — deploys frontend/ to GitHub Pages on push to main
├── scripts/
│   ├── test-api.js              # Manual Best Buy API sanity check
│   └── generate-favicons.js     # Regenerates all favicon PNGs + ICO from favicon-source.svg
├── vercel.json              # Vercel cron config
├── package.json
└── .env                     # Local secrets — NEVER commit this file
```

## Database Schema (Supabase / Postgres)

Three tables:

- **`products`** — one row per tracked product. Unique key: `sku`. Fields: `sku`, `name`, `category` (ram/ssd), `brand`, `model`, `image_url`, `product_url` (affiliate link), `retailer`.
- **`price_history`** — one price snapshot per product per cron run. Fields: `product_id` (FK), `price`, `regular_price`, `in_stock`, `fetched_at`.
- **`alerts`** — user email + target price per product. Fields: `product_id` (FK), `email`, `target_price`, `triggered`.

Row Level Security is enabled on all tables. `products` and `price_history` are public read. `alerts` is service-role only (contains user emails).

## Environment Variables

Required in `.env` (local) and Vercel project settings (production):

| Variable | Purpose |
|---|---|
| `BBY_API_KEY` | Best Buy Open API key |
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

## How the Price Fetch Works

1. Vercel cron hits `/api/fetch-prices` daily at 06:00 UTC
2. Handler verifies `Authorization: Bearer <CRON_SECRET>`
3. Fetches top-100 RAM (category `4606`) and top-100 SSD (category `3582`) from Best Buy API in parallel
4. For each product: upserts into `products` (conflict on `sku`), then inserts a new row into `price_history`
5. Logs saved/error counts per category

The script can also run directly via `node api/fetch-prices.js` for manual testing.

## Frontend State

The frontend is fully designed and built but the product cards show placeholder data — prices display as `$—`. A "coming soon" banner on the homepage communicates pre-launch status and includes a "Set an Alert" CTA. The Market Pulse section shows "Last updated: May 20, 2026" — replace this with a dynamic timestamp once real data is flowing. Search form submission is stubbed (`console.log` only).

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

`frontend/ram/index.html` and `frontend/ssd/index.html` are fully designed product listing pages. They use clean URLs (`/ram/` and `/ssd/`) via folder-based index files — GitHub Pages serves these automatically.

**What's built:**
- Page hero (h1, subtitle, Set an Alert CTA)
- Sticky filter bar with pill selectors (Type, Capacity, Speed/Form Factor, Brand, Sort by)
- Filter interaction handled by `js/filters.js` — clicking pills toggles active state and `console.log`s the selection. No actual filtering yet.
- Animated radar pulse empty state ("Prices incoming.") shown until live data flows
- Product card component fully styled (`.listing-card`) — includes image slot, brand, name, current price, strikethrough previous price, price change indicator (up/down with %), sparkline placeholder, retailer, View Deal + Set Alert actions
- 3 commented-out example product cards in each page's HTML — uncomment to see the populated grid

**What's not wired up:**
- No data from Supabase yet — waiting on Best Buy API key for first price fetch
- Filters don't actually filter anything — purely visual for now
- Sparkline chart areas are placeholder boxes — Chart.js integration comes later
- View Deal links are `href="#"` — will become affiliate links once products are in DB

**Files:**
- `frontend/ram/index.html` — DDR5/DDR4 RAM listing (serves at `/ram/`)
- `frontend/ssd/index.html` — NVMe/SATA SSD listing (serves at `/ssd/`)
- `frontend/js/filters.js` — filter pill toggle + console.log stub

## What's Not Built Yet

- Frontend → Supabase data connection (product cards, prices, search results)
- Price history charts (Chart.js or similar planned)
- Alert signup flow (email collection → `alerts` table insert)
- Alert trigger logic (compare current price to target, send email)
- Amazon data source
- User accounts (currently no auth; alerts use plain email)
- Affiliate link tracking

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

## Code Conventions

- Vanilla JS only on the frontend — no bundler, no framework
- Backend is CommonJS (`require`/`module.exports`)
- Keep secrets out of code — always use `process.env.*`
- No comments unless the "why" is non-obvious
- Prefer parallel `Promise.all` for independent async operations (already used in fetch-prices)
