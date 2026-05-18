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
│   ├── index.html           # Landing page
│   ├── about.html           # About page
│   ├── contact.html         # Contact page (hello@memradar.com)
│   ├── privacy.html         # Privacy Policy
│   ├── terms.html           # Terms of Service
│   ├── affiliate.html       # Affiliate Disclosure
│   ├── sitemap.xml          # XML sitemap for search engines
│   ├── robots.txt           # Allows all crawlers, points to sitemap
│   ├── CNAME                # Sets custom domain for GitHub Pages
│   ├── css/style.css        # All styles — no CSS framework
│   └── js/main.js           # Minimal JS, search handler stub
├── .github/
│   └── workflows/
│       └── deploy-frontend.yml  # GitHub Actions — deploys frontend/ to GitHub Pages on push to main
├── scripts/
│   └── test-api.js          # Manual Best Buy API sanity check
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

The frontend is fully designed and built but the product cards show placeholder data — prices display as `$—`. The next step is wiring up the frontend to read live data from Supabase. Search form submission is stubbed (`console.log` only).

**Design system:** blue accent `#2563eb`, neutral grays, clean sans-serif. No CSS framework. Mobile responsive with breakpoints at 768px and 480px.

## Deployment Status

- **GitHub Pages:** Live at [memradar.com](https://memradar.com). Deployed via GitHub Actions workflow (`.github/workflows/deploy-frontend.yml`) — triggers on any push to `main` that touches `frontend/`.
- **Custom domain:** memradar.com — fully configured. Cloudflare DNS A records point to GitHub Pages IPs, SSL/TLS set to Full, CNAME file committed to `frontend/`. Custom domain set in GitHub Pages settings.
- **Vercel:** Live. All env vars set in Vercel dashboard. `BBY_API_KEY` is set to `pending` — awaiting Best Buy API approval before the cron fetch will work.
- **Best Buy API:** Access pending approval. Cron is configured but non-functional until approved.
- **Google Search Console:** memradar.com added as a property. Sitemap submitted at `https://memradar.com/sitemap.xml`.
- **Google Analytics:** GA4 installed on all HTML pages. Measurement ID: `G-797Q89S8GG`. Snippet is in the `<head>` of every page.
- **SEO:** Full SEO pass complete. All pages have unique titles, descriptions, Open Graph, Twitter cards, canonical tags, and JSON-LD structured data (WebSite schema on homepage, WebPage/ContactPage on inner pages). Keywords targeted: "RAM price tracker", "SSD price history", "DDR5 price drops", "PC memory deals", "best time to buy RAM", "SSD price alert".
- **OG image:** `https://memradar.com/og-image.png` — live and confirmed working (1200×630px). Source SVG at `frontend/og-image.svg` for future edits. Convert with Sharp: `node -e "require('sharp')(fs.readFileSync('frontend/og-image.svg')).png().toFile('frontend/og-image.png', ...)"` .
- **Favicons:** Full set generated from `frontend/favicon-source.svg` using `node scripts/generate-favicons.js` (requires sharp + to-ico dev deps). Files: `favicon.ico` (16+32px), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180px), `android-chrome-192x192.png`, `android-chrome-512x512.png`, `site.webmanifest`. All 6 HTML pages include the full favicon `<link>` block.
- **Privacy policy / GA cookies:** `privacy.html` currently states no tracking cookies are used, but GA4 uses cookies by default. This needs to be resolved — either update the policy or configure GA in cookieless mode. Flagged, awaiting decision.

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

## Code Conventions

- Vanilla JS only on the frontend — no bundler, no framework
- Backend is CommonJS (`require`/`module.exports`)
- Keep secrets out of code — always use `process.env.*`
- No comments unless the "why" is non-obvious
- Prefer parallel `Promise.all` for independent async operations (already used in fetch-prices)
