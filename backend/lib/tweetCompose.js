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
// "Biggest drop today" computed on stale data is a wrong post wearing a right
// format. That is what this gate protects against: a superlative about the
// present tense, screenshotted, where the drop has since reversed or a bigger
// one appeared that we could not see. It was NEVER a precision claim; the site
// says plainly that prices are not real time.
//
// RAISED 6 -> 12 ON 2026-08-27. Measured: GitHub stopped creating scheduled
// runs reliably on 2026-08-26 20:00 UTC, and price-fetch went from firing every
// ~4h (observed gaps 211-284 min, 6/6 slots daily) to every ~8-12h (gaps 355,
// 492, 714, 554 min; 3 of 12 slots delivered). At 6h the gate rejected a post
// that had 12 qualifying drops and a -10.7% leader, by 0.5 hours. It held 100%
// of the time at the old cadence and about 68% at the new one, so it had begun
// converting an infrastructure fault into editorial silence, which reads
// identical to "the market was quiet" and is exactly the silent-degradation
// shape this repo keeps getting bitten by.
//
// 12 = one degraded fetch cycle (mean gap 8.8h, worst observed 11.9h). A
// 12-hour-old "biggest drop today" is still TRUE, because the comparison
// window is 24h and the linked PDP hydrates live.
//
// REVERSAL CONDITION, verbatim: when fetch cadence returns to 4-hourly, this
// returns to 6. Scheduled reader: the 2026-09-10 revisit list in CLAUDE.md.
// An undated reversal condition is the probe-guard lesson waiting to recur.
const PRICE_DATA_MAX_AGE_H = 12;
const MARKET_STATS_MAX_AGE_H = 36;
const NEAR_ATL_PCT = 5.0;        // "within N% of its all-time low"
// Above this ATL gap the all-time-low comparison stops being actionable and
// becomes daily doom: after the 2026 memory price crisis most products sit
// 100-400% above lows set years ago, so "still 307% above its all-time low"
// is true, unhelpful, and relentless. Past the threshold we switch to a
// comparator the reader can act on.
const ATL_DOOM_PCT = 50.0;
// ...but only if THAT comparator says something. A drop that lands barely
// under a falling average ("5% below its 90-day average" on an 18.5% drop)
// undersells the news. When it is that weak we OMIT the clause and tweet the
// drop plainly: the drop percentage is itself the news, so a weak trailing
// stat adds nothing but does not warrant silence on a big move. We never
// fall through to a smaller drop for this reason - that would make the
// "Biggest drop today" superlative false.
const MIN_BELOW_AVG_PCT = 5.0;

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
// Returns the context clause, or '' when no strong, honest one exists - in
// which case the tweet carries the drop alone. The rule: a strong clause when
// we have one, no clause when we do not, never a misleading one.
function atlClause(current, atl, avg90) {
  if (atl == null || !(atl > 0)) return '';
  if (current <= atl) return "That's a new all-time low.";
  const above = ((current - atl) / atl) * 100;
  if (above <= NEAR_ATL_PCT) return `That's within ${pct1(above)}% of its all-time low.`;
  if (above <= ATL_DOOM_PCT) return `Still ${pct1(above)}% above its all-time low.`;
  // Doom territory: use the 90-day average instead, the same statistic the
  // PDP Price Analysis reasons with, so tweet and page agree by construction.
  if (avg90 == null || !(avg90 > 0)) return '';
  const below = ((avg90 - current) / avg90) * 100;
  if (below < MIN_BELOW_AVG_PCT) return ''; // too weak to be worth saying
  return `That's ${pct1(below)}% below its 90-day average.`;
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

    // A weak or absent context clause is NOT a reason to skip: the drop
    // itself is the news, and skipping would hand the superlative to a
    // smaller drop, making "Biggest drop today" false.
    const clause = atlClause(c.current, c.atl, c.avg90);
    const url = `${SITE}/${c.product.category}/${c.product.slug}/`;
    const lead = isTop ? 'Biggest drop today' : 'Big drop today';
    const text = `📉 ${lead}: ${displayName(c.product)} down ${pct1(drop)}% to ${money(c.current)} at Amazon.${clause ? ' ' + clause : ''} ${url}`;
    return { text, sku: c.product.sku, branch: (isTop ? 'top' : 'runner-up') + (clause ? '' : '+no-clause'), rejected };
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
  MIN_DROP_PCT, MAX_DROP_PCT, PRICE_DATA_MAX_AGE_H, MARKET_STATS_MAX_AGE_H, ATL_DOOM_PCT, MIN_BELOW_AVG_PCT,
};
