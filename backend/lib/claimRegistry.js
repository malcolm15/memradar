// PUBLISHED-CLAIM FLOORS — the registry of prose magnitude claims currently
// live on the site, each bound to the figure it rests on and the floor that
// figure must hold for the sentence to stay true.
//
// WHY THIS EXISTS. The stability tripwire (marketStats.js) answers "is this
// figure robust enough to quote?" It is a property of the DATA and it fires
// before prose is written. It cannot answer the question that matters after
// publication: "is the sentence we already shipped still true?" A figure can
// be perfectly stable across cohorts and still have fallen through the floor
// its sentence assumed. DDR4 1y is the live example: it sat near +198% when
// the RAM guide said "well over 150%", and every point it gives back walks
// that sentence toward false while the tripwire stays silent, because the
// tripwire was never measuring truth.
//
// So: the tripwire guards figures going INTO prose, this guards prose already
// OUT there. Both run on every stats run and both ride the summary JSON.
//
// MONITORING ONLY. Nothing here writes to the database, regenerates a page or
// edits a sentence. A breach is a message to Malcolm saying which page and
// which sentence to reword. Prose is hand-authored and stays that way.
//
// THE REGISTRY RULE (also stated in CLAUDE.md): any new prose magnitude claim
// gets a registry entry IN THE SAME COMMIT as the copy. The registry is the
// complete inventory of live magnitude claims, which is why claims that
// cannot be floor-checked are listed here too, with `monitorable: false` and
// the reason, rather than silently omitted. An absent entry must mean "no such
// claim on the site", never "we forgot" or "that one was awkward".

const fs = require('fs');
const path = require('path');

// Floors are stated as RATIOS because that is how the sentences read ("triple",
// "double", "well over 150%"), then converted to the percent-change units
// market_stats actually stores. 3.0x of a year ago is pct_change +200.
const pctOf = (ratio) => (ratio - 1) * 100;

// Notable #2 on the Price Index is generated, not hand-written: the generator
// floors the weakest 1y segment down to the nearest ten and bakes that number
// into the sentence. Its floor therefore moves with the regen, so hardcoding a
// value here would go stale the first time the weakest segment crossed a tens
// boundary. Read it back off the page instead — the baked HTML is the claim.
const PRICE_INDEX_PAGE = path.join(__dirname, '..', '..', 'frontend', 'price-index', 'index.html');
const PRICE_INDEX_RE = /Every segment is up more than (\d+)% year over year/;

function bakedPriceIndexFloor() {
  let html;
  try {
    html = fs.readFileSync(PRICE_INDEX_PAGE, 'utf8');
  } catch (err) {
    throw new Error(`cannot read the baked Price Index page (${err.code || err.message})`);
  }
  const m = PRICE_INDEX_RE.exec(html);
  if (!m) {
    // The sentence was reworded or dropped without updating this entry, which
    // is exactly the drift the registry rule exists to prevent. Unresolved, and
    // reported as loudly as a breach.
    throw new Error('the "Every segment is up more than N%" sentence is no longer on the page');
  }
  return { floorPct: Number(m[1]), source: `baked into /price-index/ as ${m[1]}%` };
}

const CLAIM_REGISTRY = [
  // ---------------------------------------------------------------- explainer
  {
    id: 'explainer-verdict-ddr5-several-times',
    page: '/blog/why-ram-prices-are-so-high/',
    where: 'verdict box',
    sentence: 'DDR5 costs several times what it did a year ago',
    requires: [{ segment: 'ddr5', period: '1y' }],
    floorRatio: 3.0,
    floorLabel: '3.0x ("several times" reads as three or more)',
  },
  {
    id: 'explainer-verdict-ddr4-more-than-doubled',
    page: '/blog/why-ram-prices-are-so-high/',
    where: 'verdict box',
    sentence: 'and DDR4 more than doubled',
    requires: [{ segment: 'ddr4', period: '1y' }],
    floorRatio: 2.0,
    floorLabel: '2.0x',
  },
  {
    id: 'explainer-ddr5-well-over-triple',
    page: '/blog/why-ram-prices-are-so-high/',
    where: 'section 1',
    sentence: 'Across the DDR5 kits MemRadar tracks, the median price is well over triple what it was a year ago.',
    requires: [{ segment: 'ddr5', period: '1y' }],
    floorRatio: 3.0,
    floorLabel: '3.0x',
  },
  {
    id: 'explainer-ddr4-well-over-double',
    page: '/blog/why-ram-prices-are-so-high/',
    where: 'section 1',
    sentence: 'DDR4 is well over double.',
    requires: [{ segment: 'ddr4', period: '1y' }],
    floorRatio: 2.0,
    floorLabel: '2.0x',
  },

  // --------------------------------------------------------------- RAM guide
  {
    // Reworded from "DDR4 up well over 150%" on 2026-09-03, PROACTIVELY, while
    // the old wording still held. It had 8.1pp of headroom on the board's most
    // cohort-sensitive figure (ddr4 1y moves 39.6pp), so it could have breached
    // in any week's data. "More than doubled" says the same thing rhetorically
    // and clears its floor by roughly 50pp. It also reads true whether the
    // reader takes it as the peak or as today, which the 150% version did not.
    id: 'ram-guide-ddr4-more-than-doubled',
    page: '/guides/should-i-buy-ram-now/',
    where: 'what actually happened',
    sentence: 'DDR4 more than doubled',
    requires: [{ segment: 'ddr4', period: '1y' }],
    floorRatio: 2.0,
    floorLabel: '2.0x',
  },

  // --------------------------------------------------------------- SSD guide
  {
    id: 'ssd-guide-verdict-more-than-doubled',
    page: '/guides/should-i-buy-an-ssd-now/',
    where: 'verdict box',
    sentence: 'drive prices more than doubled over the past year',
    requires: [{ segment: 'nvme_ssd', period: '1y' }, { segment: 'sata_ssd', period: '1y' }],
    floorRatio: 2.0,
    floorLabel: '2.0x on BOTH drive segments',
  },
  {
    id: 'ssd-guide-both-well-over-double',
    page: '/guides/should-i-buy-an-ssd-now/',
    where: 'what the data says',
    sentence: 'Both NVMe and SATA drives now cost well over double what they did a year ago.',
    requires: [{ segment: 'nvme_ssd', period: '1y' }, { segment: 'sata_ssd', period: '1y' }],
    floorRatio: 2.0,
    floorLabel: '2.0x on BOTH drive segments',
  },

  // ------------------------------------------------------------- Price Index
  {
    id: 'price-index-every-segment-up',
    page: '/price-index/',
    where: 'notable numbers #2',
    sentence: 'Every segment is up more than N% year over year.',
    // Every segment, so every segment is a requirement: the claim is only as
    // strong as the weakest one, which is the same rule the generator used to
    // derive the number in the first place.
    requires: [
      { segment: 'ddr5', period: '1y' },
      { segment: 'ddr4', period: '1y' },
      { segment: 'nvme_ssd', period: '1y' },
      { segment: 'sata_ssd', period: '1y' },
    ],
    resolveFloor: bakedPriceIndexFloor,
    floorLabel: 'the tens-floor baked into the page',
  },

  // ------------------------------------- registered, deliberately not checked
  //
  // These are live magnitude claims that no market_stats figure can falsify.
  // They are listed so the registry stays a complete inventory: a reader
  // auditing the site's claims against this file should find every one of them
  // here, either with a floor or with the reason it has none.
  {
    id: 'ram-guide-ddr5-over-300-at-peak',
    page: '/guides/should-i-buy-ram-now/',
    sentence: 'DDR5 up over 300% year over year at its peak',
    monitorable: false,
    reason: 'claims a past peak, not a current level. market_stats holds only the current window, and a peak that happened stays happened, so no live figure can breach it.',
  },
  {
    id: 'ram-guide-ddr4-fell-double-digits',
    page: '/guides/should-i-buy-ram-now/',
    sentence: 'DDR4 actually fell double digits from its peak and has now flattened',
    monitorable: false,
    reason: 'peak-to-now, and DDR4 peaked in April 2026, between the 3m and 6m windows. No stored figure spans it. Checking the "flattened" half alone against ddr4 1m would report a pass on half a sentence, which is worse than reporting nothing.',
  },
  {
    id: 'explainer-2016-2018-roughly-doubled',
    page: '/blog/why-ram-prices-are-so-high/',
    sentence: 'Between 2016 and early 2018, memory prices roughly doubled on a smaller supply crunch',
    monitorable: false,
    reason: 'historical, about a closed period. Cannot drift.',
  },
  {
    id: 'ram-guide-2017-18-roughly-tripled',
    page: '/guides/should-i-buy-ram-now/',
    sentence: 'In 2017-18, memory prices roughly tripled on supply constraints',
    monitorable: false,
    reason: 'historical, about a closed period. Cannot drift.',
  },
  {
    id: 'about-ram-crashed-60-in-2023',
    page: '/about.html',
    sentence: 'RAM prices crashed over 60% in 2023, then bounced back hard over the following year',
    monitorable: false,
    reason: 'historical, about a closed period. Cannot drift.',
  },
  {
    id: 'explainer-atl-multiple-counts',
    page: '/blog/why-ram-prices-are-so-high/',
    sentence: 'N of the M products MemRadar tracks are priced at least one and a half times their all-time low, and K are at more than triple it',
    monitorable: false,
    reason: 'generated, not asserted: the generator recomputes all three numbers from product history on every regen, so the sentence cannot go stale the way a hand-written magnitude can. It also reads off all-time lows rather than market_stats, so this monitor holds no figure that could test it.',
  },
];

// Checks every monitorable entry against a stats run, on BOTH cohorts.
//
// stats: the in-memory rows from computeMarketStats, which carry
// stable_pct_change alongside pct_change. The stable figure is the whole point:
// a claim that holds on the full cohort but not on the products present in
// every window is a claim that survives only because of who happens to qualify
// this week, and it is not safe to leave in prose.
function checkClaimFloors(stats) {
  const by = new Map(stats.map((s) => [`${s.segment}|${s.period}`, s]));
  const breached = [];
  const unresolved = [];
  const ok = [];

  for (const entry of CLAIM_REGISTRY) {
    if (entry.monitorable === false) continue;

    let floorPct, floorSource;
    try {
      if (entry.resolveFloor) {
        const r = entry.resolveFloor();
        floorPct = r.floorPct;
        floorSource = r.source;
      } else {
        floorPct = pctOf(entry.floorRatio);
        floorSource = entry.floorLabel;
      }
    } catch (err) {
      unresolved.push({ ...summarise(entry), reason: err.message });
      continue;
    }

    const figures = [];
    let missing = null;
    for (const req of entry.requires) {
      const s = by.get(`${req.segment}|${req.period}`);
      if (!s || s.pct_change == null) { missing = `${req.segment} [${req.period}] has no figure this run`; break; }
      if (s.stable_pct_change == null) { missing = `${req.segment} [${req.period}] has no stable-cohort figure (stable n=0)`; break; }
      figures.push({
        segment: req.segment,
        period: req.period,
        full_pct: s.pct_change,
        stable_pct: s.stable_pct_change,
        full_margin_pp: round1(s.pct_change - floorPct),
        stable_margin_pp: round1(s.stable_pct_change - floorPct),
        n: s.product_count,
        stable_n: s.stable_count,
      });
    }
    if (missing) {
      unresolved.push({ ...summarise(entry), floor_pct: floorPct, reason: missing });
      continue;
    }

    // BOTH cohorts, every required figure. One failure anywhere breaches.
    const failing = figures.filter((f) => f.full_pct < floorPct || f.stable_pct < floorPct);
    const record = { ...summarise(entry), floor_pct: floorPct, floor_source: floorSource, figures };
    if (failing.length) {
      breached.push({
        ...record,
        breached_on: failing.map((f) => {
          const which = [];
          if (f.full_pct < floorPct) which.push(`full ${f.full_pct}%`);
          if (f.stable_pct < floorPct) which.push(`stable ${f.stable_pct}%`);
          return `${f.segment} [${f.period}] ${which.join(' and ')} vs floor ${floorPct}%`;
        }),
      });
    } else {
      // The tightest margin across both cohorts, so a claim creeping toward its
      // floor is visible before it goes through.
      record.min_margin_pp = round1(Math.min(...figures.flatMap((f) => [f.full_margin_pp, f.stable_margin_pp])));
      ok.push(record);
    }
  }

  return {
    checked: breached.length + unresolved.length + ok.length,
    registered: CLAIM_REGISTRY.length,
    unmonitorable: CLAIM_REGISTRY.filter((e) => e.monitorable === false).length,
    breached,
    unresolved,
    ok,
  };
}

function summarise(entry) {
  return { id: entry.id, page: entry.page, where: entry.where, sentence: entry.sentence };
}

const round1 = (x) => Math.round(x * 10) / 10;

// Logs the result. Breaches SHOUT and name the page and the sentence, because
// the only useful form of this alert is one that tells Malcolm what to reword
// without opening anything. Unresolved entries shout equally: an entry that
// could not be checked is indistinguishable from a passing one in a silent log,
// and that is precisely how a disabled safety check goes unnoticed for a week.
function logClaimFloors(result, log) {
  if (result.breached.length) {
    log(`⚠ CLAIM FLOOR BREACHED: ${result.breached.length} published sentence(s) no longer supported by the data. REWORD THESE:`);
    for (const b of result.breached) {
      log(`    ${b.page} (${b.where})`);
      log(`      "${b.sentence}"`);
      log(`      needs ${b.floor_source}; ${b.breached_on.join('; ')}`);
    }
  }
  if (result.unresolved.length) {
    log(`⚠ CLAIM FLOOR UNRESOLVED: ${result.unresolved.length} registered claim(s) could NOT be checked - treat as unverified, not as passing:`);
    for (const u of result.unresolved) log(`    ${u.page} "${u.sentence}" - ${u.reason}`);
  }
  if (!result.breached.length && !result.unresolved.length) {
    const tightest = result.ok.slice().sort((a, b) => a.min_margin_pp - b.min_margin_pp)[0];
    log(`Claim floors: all ${result.ok.length} monitorable claims hold on both cohorts${tightest ? ` (tightest ${tightest.id}, ${tightest.min_margin_pp}pp of headroom)` : ''}`);
  }
  if (result.unmonitorable) {
    log(`Claim registry: ${result.registered} claims registered, ${result.unmonitorable} recorded as not floor-checkable (historical or generated).`);
  }
}

module.exports = { CLAIM_REGISTRY, checkClaimFloors, logClaimFloors, pctOf };
