// Tweet composition + guardrails for the @memradar X bot.
//
// DESIGN RULE: the bot must be SILENT rather than wrong or trivial. A missing
// tweet is invisible; a wrong tweet is a screenshot. Every gate below returns
// a skip reason instead of throwing, and the runner logs the reason.
//
// SCOPE: daily drops are an Amazon-history feature by design. price_history
// is Amazon/Keepa-only (permanent scope guardrail), so a Newegg "drop" is not
// computable; the copy says "at Amazon" as honest attribution, which matters
// precisely because the site shows two retailers.
const { shortName } = require('./productParsers');

const SITE = 'https://memradar.com';

// --- gates (all tunable in one place, all documented in CLAUDE.md) ---
const MIN_DROP_PCT = 3.0;        // silence threshold: below this it is not news
const MAX_DROP_PCT = 60.0;       // above this it is almost certainly a data glitch
const PRICE_DATA_MAX_AGE_H = 6;  // "biggest drop today" on stale data is a wrong
                                 // tweet wearing a right format
const MARKET_STATS_MAX_AGE_H = 36;
const NEAR_ATL_PCT = 5.0;        // "within N% of its all-time low"

const pct1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
const money = (v) => '$' + Number(v).toFixed(2).replace(/\.00$/, '');

// Segment figure for the weekly tweet. A raw +0.04% renders as "+0%", which
// reads like a bug exactly as true zero does, so the "flat" test is applied to
// the ROUNDED DISPLAY VALUE rather than to the raw number.
function segmentFigure(pctChange) {
  if (pctChange == null) return null;
  const shown = Math.round(Number(pctChange) * 10) / 10;
  if (shown === 0) return 'flat';
  return (shown > 0 ? '+' : '') + pct1(shown) + '%';
}

// All-time-low context is MANDATORY on every daily tweet: it is the honesty
// signature. Branches mirror the PDP Price Analysis logic.
function atlClause(current, atl) {
  if (atl == null || !(atl > 0)) return null;
  if (current <= atl) return "That's a new all-time low.";
  const above = ((current - atl) / atl) * 100;
  if (above <= NEAR_ATL_PCT) return `That's within ${pct1(above)}% of its all-time low.`;
  return `Still ${pct1(above)}% above its all-time low.`;
}

// Composer-layer polish ONLY - never changes the shared shortName() builder,
// whose output the generator bakes into slugs and titles.
function displayName(product) {
  let name = shortName(product);
  // Trailing " - {fragment}" reads as a dangling spec in prose ("Optimus 5100
  // NVMe SSD - PCIe 4.0"); the page can carry it, a sentence should not.
  name = name.replace(/\s+-\s+[^-]*$/, '').trim();
  // shortName only prefixes the brand when the title does not already start
  // with it; a brandless title still reads better with the brand in a tweet.
  const brand = product.brand && product.brand.trim();
  if (brand && !name.toLowerCase().includes(brand.toLowerCase().slice(0, 4))) {
    name = `${brand} ${name}`;
  }
  return name;
}

// candidates: [{ product, current, previous, dropPct, atl, inStock }] sorted
// most-negative first. lastTweetedSku excludes yesterday's winner.
//
// DEDUP FALL-THROUGH: when dedup excludes the top drop we do NOT go silent if
// a runner-up qualifies; we fall through to it with every gate still applying.
// The copy then says "Big drop today" rather than "Biggest drop today",
// because the runner-up is not the biggest and the claim must stay true.
function composeDaily({ candidates, lastTweetedSku, priceDataAgeH }) {
  if (priceDataAgeH == null || priceDataAgeH > PRICE_DATA_MAX_AGE_H) {
    return { skip: `price data stale (${priceDataAgeH == null ? 'unknown' : pct1(priceDataAgeH) + 'h'} old, max ${PRICE_DATA_MAX_AGE_H}h)` };
  }
  if (!candidates.length) return { skip: 'no price drops in the last 24h' };

  const rejected = [];
  let isTop = true;
  for (const c of candidates) {
    const drop = Math.abs(c.dropPct);
    if (drop < MIN_DROP_PCT) {
      rejected.push(`${c.product.sku}: ${pct1(drop)}% below the ${MIN_DROP_PCT}% floor`);
      break; // sorted, so nothing after this clears the floor either
    }
    if (!(c.current > 0)) { rejected.push(`${c.product.sku}: non-positive price`); isTop = false; continue; }
    if (drop > MAX_DROP_PCT) { rejected.push(`${c.product.sku}: ${pct1(drop)}% exceeds the ${MAX_DROP_PCT}% glitch ceiling`); isTop = false; continue; }
    if (c.inStock === false) { rejected.push(`${c.product.sku}: out of stock at Amazon`); isTop = false; continue; }
    if (lastTweetedSku && c.product.sku === lastTweetedSku) { rejected.push(`${c.product.sku}: tweeted in the previous run (dedup)`); isTop = false; continue; }

    const atl = atlClause(c.current, c.atl);
    if (!atl) { rejected.push(`${c.product.sku}: no all-time-low context available`); isTop = false; continue; }

    const url = `${SITE}/${c.product.category}/${c.product.slug}/`;
    const lead = isTop ? 'Biggest drop today' : 'Big drop today';
    const text = `📉 ${lead}: ${displayName(c.product)} down ${pct1(drop)}% to ${money(c.current)} at Amazon. ${atl} ${url}`;
    return { text, sku: c.product.sku, branch: isTop ? 'top' : 'runner-up', rejected };
  }
  return { skip: `no eligible drop cleared the gates`, rejected };
}

// rows: market_stats rows for ONE period. Label must match what the data is.
function composeWeekly({ rows, period = '1m', computedAt, nowMs = Date.now() }) {
  if (!rows || !rows.length) return { skip: 'no market_stats rows' };
  if (!computedAt) return { skip: 'market_stats has no computed_at' };
  const ageH = (nowMs - new Date(computedAt).getTime()) / 3600000;
  if (ageH > MARKET_STATS_MAX_AGE_H) {
    return { skip: `market_stats stale (${pct1(ageH)}h old, max ${MARKET_STATS_MAX_AGE_H}h)` };
  }
  const order = [['ddr5', 'DDR5'], ['ddr4', 'DDR4'], ['nvme_ssd', 'NVMe SSD'], ['sata_ssd', 'SATA SSD']];
  const parts = [];
  for (const [key, label] of order) {
    const row = rows.find((r) => r.segment === key && r.period === period);
    const fig = row ? segmentFigure(row.pct_change) : null;
    if (!fig) return { skip: `missing ${period} figure for ${key}` };
    parts.push(`${label} ${fig}`);
  }
  const window = period === '1m' ? 'This month' : 'This week';
  const text = `${window} in memory prices: ${parts.join(', ')}. Full index: ${SITE}/price-index/`;
  return { text, branch: 'weekly' };
}

module.exports = {
  composeDaily, composeWeekly, segmentFigure, atlClause, displayName,
  MIN_DROP_PCT, MAX_DROP_PCT, PRICE_DATA_MAX_AGE_H, MARKET_STATS_MAX_AGE_H,
};
