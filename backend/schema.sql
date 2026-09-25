-- MemRadar Database Schema
-- Run this in the Supabase SQL Editor to create all tables

-- Products table: one row per tracked product
CREATE TABLE products (
  id            BIGSERIAL PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE,       -- Best Buy SKU (unique product ID)
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,              -- 'ram' or 'ssd'
  brand         TEXT,
  model         TEXT,
  image_url     TEXT,
  product_url   TEXT,                       -- affiliate link
  retailer      TEXT NOT NULL DEFAULT 'bestbuy',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Price history table: one row per price check per product
CREATE TABLE price_history (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price         NUMERIC(10, 2) NOT NULL,
  regular_price NUMERIC(10, 2),             -- non-sale price for context
  in_stock      BOOLEAN DEFAULT TRUE,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert subscriptions: user enters email + target price for a product
CREATE TABLE alerts (
  id            BIGSERIAL PRIMARY KEY,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  target_price  NUMERIC(10, 2) NOT NULL,
  triggered     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security: alerts contain user emails, lock them down
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- For now (no auth yet): only the backend service role can read/write alerts
-- This policy gets updated when we add user accounts
-- WITH CHECK is explicit here — do not rely on PostgreSQL's implicit fallback
CREATE POLICY "Service role only" ON alerts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Products and price_history are public read (no user data)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read products" ON products
  FOR SELECT USING (true);

CREATE POLICY "Service role write products" ON products
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read price_history" ON price_history
  FOR SELECT USING (true);

CREATE POLICY "Service role write price_history" ON price_history
  FOR ALL USING (auth.role() = 'service_role');

-- Market Pulse stats: one row per segment, recomputed daily by the cron
-- (backend/lib/marketStats.js). Read by the frontend via the anon key.
CREATE TABLE IF NOT EXISTS market_stats (
  id BIGSERIAL PRIMARY KEY,
  segment TEXT NOT NULL UNIQUE,        -- 'ddr5' | 'ddr4' | 'nvme_ssd' | 'sata_ssd'
  current_avg_price NUMERIC(10,2),
  baseline_avg_price NUMERIC(10,2),    -- avg ~180 days ago
  pct_change NUMERIC(6,1),             -- e.g. 42.3 means +42.3%
  product_count INTEGER,               -- products contributing to this segment
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- stable_paired_pct  (added 2026-09-22) median of per-product current/baseline
--   ratios over the stable cohort. The published pct_change is a ratio of two
--   INDEPENDENTLY sorted medians, so a membership change moves each median on
--   its own: on 2026-09-22 three products aging out of the 6m window took ddr4
--   1y from +98.7% to +162.1% while this figure moved 145.1 to 146.9. The claim
--   floors read this one. Cannot be reconstructed from any other column.
-- jackknife_spread_pp (added 2026-09-22) leave-one-out range of the FULL
--   cohort's pct_change. STORED, NOT ACTED ON: product_count is not a proxy for
--   robustness (n=14 spread 3.6pp, n=49 spread 22.0pp on the same day), and this
--   accumulates the history someone will need before setting a threshold on it.
ALTER TABLE market_stats ADD COLUMN IF NOT EXISTS stable_paired_pct   NUMERIC(7,1);
ALTER TABLE market_stats ADD COLUMN IF NOT EXISTS jackknife_spread_pp NUMERIC(7,1);

ALTER TABLE market_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read market_stats" ON market_stats
  FOR SELECT USING (true);

CREATE POLICY "Service role write market_stats" ON market_stats
  FOR ALL USING (auth.role() = 'service_role');

-- email_send_log: one row per email SENT. Its only reader is the signup
-- circuit breaker in api/alerts.js, which counts 'confirmation' rows in the
-- last 24h by send_type and sent_at.
--
-- DELIBERATELY HOLDS NO PERSONAL DATA. The email column was dropped on
-- 2026-09-19 (it had been written on every send and read by nothing); see
-- CLAUDE.md, "email_send_log holds no personal data". Do not add it back.
--
-- Recorded from the LIVE table (PostgREST schema) after the drop, because
-- this table was created outside this file. Verified: columns, types, NOT
-- NULL, the sent_at default, id as a self-filling primary key, RLS enabled
-- (anon inserts are refused by RLS and anon reads return nothing). NOT
-- verified, since nothing here has SQL access: whether id is BIGSERIAL or
-- IDENTITY, any CHECK constraint or index, and the policy text. No policy is
-- written below rather than a guessed one; the Supabase dashboard is
-- authoritative until its text is copied here.
CREATE TABLE IF NOT EXISTS email_send_log (
  id         BIGSERIAL PRIMARY KEY,
  send_type  TEXT NOT NULL,                        -- 'confirmation' | 'alert'
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;
-- Policy: UNRECORDED. Observed behaviour (2026-09-19): service role only.

-- -----------------------------------------------
-- CLAIM FLOOR RUNS (added 2026-09-22)
-- One row per stats run that reached the published-claim check, CLEAN RUNS
-- INCLUDED. That is the point: market_stats is overwritten every run and the
-- run summary lives only in the job log, so before this table existed the
-- question "when did this breach start?" had no answer. Because an OK run
-- writes a row too, a day with NO row means the check did not run at all,
-- which is its own signal.
--
-- ran_at and computed_at are separate on purpose. ran_at is when the check
-- executed; computed_at is the market_stats run it checked. Their divergence
-- IS the bug this table was added alongside: on 2026-09-21 the stats step was
-- skipped and the site served figures computed two days earlier.
--
-- status is the run verdict: 'ok' | 'breached' | 'unresolved' | 'error'.
-- A withdrawal is NOT a status. A run whose only note is a withdrawn finding
-- is a clean run, and the detail lives in the withdrawn column.
-- tightest holds only the narrowest passing margin ({id, min_margin_pp,
-- floor_pct}), not all passing entries: it is the sole part of a clean result
-- anyone acts on, and it is how a claim creeping toward its floor is visible
-- before it goes through.
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS claim_floor_runs (
  id           BIGSERIAL PRIMARY KEY,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when the check executed
  computed_at  TIMESTAMPTZ,                         -- the market_stats run it checked
  status       TEXT NOT NULL,                       -- 'ok' | 'breached' | 'unresolved' | 'error'
  checked      INTEGER,
  ok_count     INTEGER,
  tightest     JSONB,                               -- {id, min_margin_pp, floor_pct}
  breached     JSONB,
  unresolved   JSONB,
  withdrawn    JSONB,
  -- WHICH BUILD THE CHECK READ (added 2026-09-22). The floors are read off
  -- baked HTML on disk, so a verdict without its commit is a verdict about an
  -- unknown page. Format: short sha, with '-dirty' and '-behind:N' suffixes
  -- when they apply. NULL when git could not answer, which is honest: an
  -- unknown commit is not a clean one. Row id 1 is null for that reason and is
  -- the incident this column exists for.
  checked_commit TEXT
);

-- SERVICE ROLE ONLY. RLS on with NO policy of any kind, which denies every
-- anon and authenticated request: this table records which published sentences
-- are currently unsupported by the data, and that is operational, not public.
-- The frontend anon key must never read it.
ALTER TABLE claim_floor_runs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------
-- retailer_offer_history (2026-09-26)
-- Append-only log of CHANGES to retailer_offers. retailer_offers is current
-- state, exactly one row per (product, retailer), upserted in place, so it
-- structurally cannot answer "what did Newegg charge in July". This can.
--
-- WRITTEN ONLY ON A CHANGE. A row is appended only when price or in_stock
-- differs from the row already in retailer_offers. Neither cron writer compares
-- the incoming price to the stored one, so the run summary's priceUpdates
-- counts rows REFRESHED, not rows that moved: measured over 13 runs,
-- 2026-09-12 to 2026-09-25, 592 offer writes carried 81 real price changes, so
-- an unconditional log would be 86% duplicates. At the change rate this table
-- grows by roughly 130 to 440 rows a month.
--
-- GRANULARITY IS WEEKLY FOR MOST PRODUCTS, NOT DAILY. The daily Rakuten delta
-- surfaces 0 to 3 real changes; the Sunday full reconciliation surfaced 27 of
-- the 35 changes in the ten days to 2026-09-25. Any figure derived from this
-- table must be worded as COMPARISONS ("on 14 of the 21 times we compared
-- them"), never as days, or it implies a resolution the data does not have.
--
-- AMAZON IS DELIBERATELY ABSENT. price_history already logs every Amazon
-- observation six times a day, append-only. A second Amazon log in a different
-- shape would be two sources for one fact.
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS retailer_offer_history (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retailer    TEXT NOT NULL,                       -- 'newegg' (see note above)
  price       NUMERIC(10, 2) NOT NULL,             -- last known price carried forward on a stock flip, mirroring retailer_offers
  in_stock    BOOLEAN NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SERVICE ROLE ONLY. RLS on with NO policy of any kind, which denies every anon
-- and authenticated request. The frontend reads current state from
-- retailer_offers and has no use for this; same reasoning as claim_floor_runs.
ALTER TABLE retailer_offer_history ENABLE ROW LEVEL SECURITY;

-- SEED, run once on 2026-09-26 alongside the CREATE. One row per existing
-- Newegg offer, so every series starts from a known state instead of from its
-- first later change. The NOT EXISTS guard makes re-running it a no-op.
INSERT INTO retailer_offer_history (product_id, retailer, price, in_stock, observed_at)
SELECT o.product_id, o.retailer, o.price, o.in_stock, o.fetched_at
FROM retailer_offers o
WHERE o.retailer = 'newegg'
  AND o.price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM retailer_offer_history h
    WHERE h.product_id = o.product_id AND h.retailer = o.retailer
  );

-- -----------------------------------------------
-- INDEXES
-- Run these in Supabase SQL Editor after data starts flowing.
-- These are not created automatically — must be applied manually.
-- -----------------------------------------------

-- price_history: most queries will filter by product_id and order by fetched_at
CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_fetched_at ON price_history(fetched_at DESC);

-- alerts: alert trigger logic queries by triggered status and product_id
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered) WHERE triggered = false;
CREATE INDEX IF NOT EXISTS idx_alerts_product_id ON alerts(product_id);

-- products: category filter used on RAM and SSD listing pages
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_retailer ON products(retailer);

-- claim_floor_runs: every read is "the recent history of this check"
CREATE INDEX IF NOT EXISTS idx_claim_floor_runs_ran_at ON claim_floor_runs(ran_at DESC);

-- retailer_offer_history: every read is "this product's offer history at this
-- retailer, newest first"
CREATE INDEX IF NOT EXISTS idx_roh_product_retailer
  ON retailer_offer_history(product_id, retailer, observed_at DESC);
