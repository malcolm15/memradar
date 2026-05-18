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
│   ├── css/style.css        # All styles — no CSS framework
│   └── js/main.js           # Minimal JS, search handler stub
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

## Code Conventions

- Vanilla JS only on the frontend — no bundler, no framework
- Backend is CommonJS (`require`/`module.exports`)
- Keep secrets out of code — always use `process.env.*`
- No comments unless the "why" is non-obvious
- Prefer parallel `Promise.all` for independent async operations (already used in fetch-prices)
