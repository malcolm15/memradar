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

-- Index for fast lookups of a product's price history
CREATE INDEX idx_price_history_product_id ON price_history(product_id);
CREATE INDEX idx_price_history_fetched_at ON price_history(fetched_at);

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
