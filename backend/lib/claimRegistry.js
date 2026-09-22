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
const { stableFigureOf, stableMeasureOf } = require('./stableFigure');

// Floors are stated as RATIOS because that is how the sentences read ("triple",
// "double", "well over 150%"), then converted to the percent-change units
// market_stats actually stores. 3.0x of a year ago is pct_change +200.
const pctOf = (ratio) => (ratio - 1) * 100;

// Notable #2 on the Price Index is generated, not hand-written: the generator
// floors the weakest 1y segment down to the nearest ten and bakes that number
// into the sentence. Its floor therefore moves with the regen, so hardcoding a
// value here would go stale the first time the weakest segment crossed a tens
// boundary. Read it back off the page instead — the baked HTML is the claim.
const PAGE = (...parts) => path.join(__dirname, '..', '..', 'frontend', ...parts);

// Reads a generated tens-floor back off the page that carries it. Used by every
// claim whose number the generator derives rather than a human writing it.
function bakedFloor(file, re, url, what) {
  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read the baked ${url} page (${err.code || err.message})`);
  }
  const m = re.exec(html);
  if (!m) {
    // TWO DIFFERENT EVENTS ARRIVE HERE and the caller has to tell them apart.
    // For hand-written prose, an absent sentence is the drift the registry rule
    // exists to prevent. For a GENERATED finding it is a decision the generator
    // made and logged, because the magnitude stopped being true. The code says
    // which; `withdrawable` on the entry says which reading applies.
    const err = new Error(`${what} is no longer on ${url}`);
    err.code = 'CLAIM_TEXT_ABSENT';
    throw err;
  }
  return { floorPct: Number(m[1]), source: `baked into ${url} as ${m[1]}%` };
}

const bakedPriceIndexFloor = () => bakedFloor(
  PAGE('price-index', 'index.html'),
  /Every segment is up more than (\d+)% year over year/,
  '/price-index/', '"Every segment is up more than N%"');

// /data/ bakes each floored finding's requirement into a data-floor-pct
// attribute on its own <li>. The attribute exists ONLY for this: it lets the
// prose stay words ("more than doubled") instead of being bent into a shape a
// regex can read, while the monitor still reads the exact floor the generator
// derived. Same principle as the Price Index tens-floor, one level finer.
const bakedFindingFloor = (claimId) => () => bakedFloor(
  PAGE('data', 'index.html'),
  new RegExp(`data-claim="${claimId}"[^>]*data-floor-pct="(\\d+)"`),
  '/data/', `the "${claimId}" finding`);

// The SSD guide's META DESCRIPTION carries its own generated tens-floor, which
// feeds <meta name="description">, Open Graph, Twitter, the JSON-LD description
// and feed.xml. It is not visible prose, which is precisely why it went
// unregistered until 2026-09-22 and was found only by noticing it still said
// 130% after the visible floors had stepped to 120%.
const bakedSsdGuideMetaFloor = () => bakedFloor(
  PAGE('guides', 'should-i-buy-an-ssd-now', 'index.html'),
  /SSD prices are up more than (\d+)% year over year/,
  '/guides/should-i-buy-an-ssd-now/', 'the SSD guide meta description floor');

const bakedListingFloor = (cat) => () => bakedFloor(
  PAGE(cat, 'index.html'),
  /are up more than (\d+)% year over year/,
  `/${cat}/`, '"up more than N% year over year"');

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
    // REWORDED 2026-09-21, from "more than doubled" / "well over double".
    // ddr4 1y fell to +98.7% on the stable cohort against a 2.0x floor, so all
    // three of these sentences BREACHED in the 2026-09-20 stats run. Refloored
    // at 1.7x under a standing rule: a DDR4 magnitude claim carries at least
    // 25pp of headroom on min(full, stable) or it becomes directional with no
    // magnitude. 70% leaves 28.7pp on the stable cohort and 63.4pp on the full.
    // NOTE, 2026-09-22: the +98.7% was the RATIO OF MEDIANS on the stable
    // cohort, the measure this check used until that date. On the paired median
    // the same run read +145.1% and these sentences never breached at all. The
    // floor is left at 1.7x regardless: it was set from the worse reading, and
    // lowering a floor because the measurement improved would spend the
    // headroom the rule exists to keep.
    // The id keeps its original name on purpose: it is an identifier that
    // reporting and any future issue dedup key on, not a description.
    id: 'explainer-verdict-ddr4-more-than-doubled',
    page: '/blog/why-ram-prices-are-so-high/',
    where: 'verdict box',
    sentence: 'and DDR4 is up more than 70%',
    requires: [{ segment: 'ddr4', period: '1y' }],
    floorRatio: 1.7,
    floorLabel: '1.7x ("more than 70%")',
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
    // REWORDED 2026-09-21, from "more than doubled" / "well over double".
    // ddr4 1y fell to +98.7% on the stable cohort against a 2.0x floor, so all
    // three of these sentences BREACHED in the 2026-09-20 stats run. Refloored
    // at 1.7x under a standing rule: a DDR4 magnitude claim carries at least
    // 25pp of headroom on min(full, stable) or it becomes directional with no
    // magnitude. 70% leaves 28.7pp on the stable cohort and 63.4pp on the full.
    // NOTE, 2026-09-22: the +98.7% was the RATIO OF MEDIANS on the stable
    // cohort, the measure this check used until that date. On the paired median
    // the same run read +145.1% and these sentences never breached at all. The
    // floor is left at 1.7x regardless: it was set from the worse reading, and
    // lowering a floor because the measurement improved would spend the
    // headroom the rule exists to keep.
    // The id keeps its original name on purpose: it is an identifier that
    // reporting and any future issue dedup key on, not a description.
    id: 'explainer-ddr4-well-over-double',
    page: '/blog/why-ram-prices-are-so-high/',
    where: 'section 1',
    sentence: 'DDR4 is up more than 70%.',
    requires: [{ segment: 'ddr4', period: '1y' }],
    floorRatio: 1.7,
    floorLabel: '1.7x ("more than 70%")',
  },

  // --------------------------------------------------------------- RAM guide
  {
    // Reworded from "DDR4 up well over 150%" on 2026-09-03, PROACTIVELY, while
    // the old wording still held. It had 8.1pp of headroom on the board's most
    // cohort-sensitive figure (ddr4 1y moves 39.6pp), so it could have breached
    // in any week's data. "More than doubled" says the same thing rhetorically
    // and clears its floor by roughly 50pp. It also reads true whether the
    // reader takes it as the peak or as today, which the 150% version did not.
    // REWORDED 2026-09-21, from "more than doubled" / "well over double".
    // ddr4 1y fell to +98.7% on the stable cohort against a 2.0x floor, so all
    // three of these sentences BREACHED in the 2026-09-20 stats run. Refloored
    // at 1.7x under a standing rule: a DDR4 magnitude claim carries at least
    // 25pp of headroom on min(full, stable) or it becomes directional with no
    // magnitude. 70% leaves 28.7pp on the stable cohort and 63.4pp on the full.
    // NOTE, 2026-09-22: the +98.7% was the RATIO OF MEDIANS on the stable
    // cohort, the measure this check used until that date. On the paired median
    // the same run read +145.1% and these sentences never breached at all. The
    // floor is left at 1.7x regardless: it was set from the worse reading, and
    // lowering a floor because the measurement improved would spend the
    // headroom the rule exists to keep.
    // The id keeps its original name on purpose: it is an identifier that
    // reporting and any future issue dedup key on, not a description.
    id: 'ram-guide-ddr4-more-than-doubled',
    page: '/guides/should-i-buy-ram-now/',
    where: 'what actually happened',
    sentence: 'DDR4 up more than 70% even now',
    requires: [{ segment: 'ddr4', period: '1y' }],
    floorRatio: 1.7,
    floorLabel: '1.7x ("more than 70%")',
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

  {
    // Registered 2026-09-22, with the fix that brought its floor under the
    // cohort rule. A magnitude claim in a meta description is still a published
    // magnitude claim: it is what a search result shows and what feed readers
    // syndicate, and the registry is meant to be a COMPLETE inventory.
    id: 'ssd-guide-meta-both-up',
    page: '/guides/should-i-buy-an-ssd-now/',
    where: 'meta description, Open Graph, Twitter, JSON-LD and feed.xml',
    sentence: 'SSD prices are up more than N% year over year.',
    requires: [{ segment: 'nvme_ssd', period: '1y' }, { segment: 'sata_ssd', period: '1y' }],
    resolveFloor: bakedSsdGuideMetaFloor,
    floorLabel: 'the tens-floor baked into the SSD guide meta description',
  },

  // --------------------------------------------------------- listing pages
  // Generated intros, added in the P1 pass (2026-09-08). Both floor on
  // Math.min(full, stable) per segment the way the Price Index does, so the
  // number baked into the sentence already survives cohort choice; these
  // entries keep it that way as the data moves.
  {
    id: 'ram-listing-both-up',
    page: '/ram/',
    where: 'Is RAM expensive right now?',
    sentence: 'Both DDR5 and DDR4 are up more than N% year over year across the products tracked here.',
    requires: [{ segment: 'ddr5', period: '1y' }, { segment: 'ddr4', period: '1y' }],
    resolveFloor: bakedListingFloor('ram'),
    floorLabel: 'the tens-floor baked into /ram/',
  },
  {
    id: 'ssd-listing-both-up',
    page: '/ssd/',
    where: 'Are SSDs expensive right now?',
    sentence: 'Both NVMe and SATA drives are up more than N% year over year across the products tracked here.',
    requires: [{ segment: 'nvme_ssd', period: '1y' }, { segment: 'sata_ssd', period: '1y' }],
    resolveFloor: bakedListingFloor('ssd'),
    floorLabel: 'the tens-floor baked into /ssd/',
  },

  // --------------------------------------------------- /data/ (press page)
  // The findings a journalist is most likely to lift verbatim, so these are the
  // entries most worth having. Floors are read off the page, not written here,
  // because the generator derives the magnitude from the worse cohort and the
  // wording follows the data rather than the other way round.
  {
    id: 'data-ddr5-1y',
    page: '/data/',
    where: 'Current findings',
    sentence: 'The median DDR5 memory kit costs more than four times what it cost a year ago.',
    requires: [{ segment: 'ddr5', period: '1y' }],
    resolveFloor: bakedFindingFloor('data-ddr5-1y'),
    floorLabel: 'the multiple baked into /data/',
    // Generator-emitted, so an absent <li> is a DECISION, not drift: when the
    // worse cohort stops clearing the magnitude, buildFindings() withdraws the
    // finding and logs it, and this entry reports WITHDRAWN rather than
    // UNRESOLVED until the finding returns with its floor.
    withdrawable: true,
    withdrawnMeans: 'the generator did not emit this finding because DDR5 no longer clears the magnitude it states. Nothing to reword. It returns on its own when the data supports it.',
  },
  {
    id: 'data-ddr4-1y',
    page: '/data/',
    where: 'Current findings',
    sentence: 'DDR4, the older generation, has more than doubled over the same year.',
    requires: [{ segment: 'ddr4', period: '1y' }],
    resolveFloor: bakedFindingFloor('data-ddr4-1y'),
    floorLabel: 'the multiple baked into /data/',
    // Generator-emitted, so an absent <li> is a DECISION, not drift: when the
    // worse cohort stops clearing the magnitude, buildFindings() withdraws the
    // finding and logs it, and this entry reports WITHDRAWN rather than
    // UNRESOLVED until the finding returns with its floor.
    withdrawable: true,
    withdrawnMeans: 'the generator did not emit this finding because DDR4 no longer clears the magnitude it states. Nothing to reword. It returns on its own when the data supports it. Withdrawn 2026-09-21 at +98.7% on the stable cohort, measured as a ratio of medians; on the paired median used since 2026-09-22 the same data read +145.1% and this finding would not have been withdrawn.',
  },
  {
    id: 'data-ssd-1y',
    page: '/data/',
    where: 'Current findings',
    sentence: 'Storage followed memory up: NVMe and SATA solid state drives have both more than doubled year over year.',
    requires: [{ segment: 'nvme_ssd', period: '1y' }, { segment: 'sata_ssd', period: '1y' }],
    resolveFloor: bakedFindingFloor('data-ssd-1y'),
    floorLabel: 'the multiple baked into /data/, on BOTH drive segments',
    // Generator-emitted, so an absent <li> is a DECISION, not drift: when the
    // worse cohort stops clearing the magnitude, buildFindings() withdraws the
    // finding and logs it, and this entry reports WITHDRAWN rather than
    // UNRESOLVED until the finding returns with its floor.
    withdrawable: true,
    withdrawnMeans: 'the generator did not emit this finding because one of the two drive segments no longer clears the magnitude it states. Nothing to reword. It returns on its own when the data supports it.',
  },
  {
    id: 'data-atl-counts',
    page: '/data/',
    where: 'Current findings',
    sentence: 'N of the M products MemRadar tracks sell for at least one and a half times their lowest recorded price, and K for more than three times it.',
    monitorable: false,
    reason: 'counts, not segment figures. Both are recomputed from each product\'s own recorded history during every regen (atlMultipleDistribution), so unlike a hand-written magnitude they cannot go stale between builds, and no market_stats row can falsify them. Same standing as the explainer\'s ATL-multiple counts. They are dated with the BUILD date on the page rather than the market_stats computed_at, because that is when they were actually calculated.',
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
    id: 'methodology-marketplace-share',
    page: '/methodology/',
    sentence: 'More than two thirds of the products we track are priced from third-party marketplace offers rather than Amazon\'s own.',
    monitorable: false,
    reason: 'no market_stats figure can falsify it. The price SOURCE (Keepa AMAZON series vs NEW marketplace series) is not stored anywhere in our database; only the resulting price is. Recomputing it costs one Keepa token per product (235) and needs a live stats call, so it cannot ride a stats run. TO RECOMPUTE: request Keepa stats for every tracked ASIN (history=0, stats=90; one token per product, roughly 235) and classify where each displayed price comes from in keepa.currentPrice() order, AMAZON then NEW then BUY_BOX_SHIPPING, ignoring values under $5. Run by hand; deliberately not committed as a script, since a committed script that spends Keepa credits when run is a worse trap than an absent one. Measured 2026-09-08: 165 of 225 priced products, 73.3%, and 165 of all 235 tracked, 70.2%, so the claim holds on either denominator with roughly 4pp and 7pp of headroom. The author\'s draft said "roughly two thirds", which understated the measured value; it was reworded UP to a magnitude that is both true and robust rather than pinned to a number that would need a Keepa call to re-verify.',
  },
  {
    id: 'csv-header-44pp-divergence',
    page: '/data/memradar-price-index-monthly.csv',
    sentence: 'A change computed between two rows of this file will NOT equal the MemRadar Price Index for the same period, and when measured in September 2026 it differed from the index by as much as 44 percentage points.',
    monitorable: false,
    reason: 'historical and dated. Measured 2026-09-18: DDR5 September 2025 to September 2026 from the monthly medians was +314.1% against the index 1Y of +358.3%. The sentence is pinned to that measurement ("when measured in September 2026") precisely so it cannot drift: a later, larger or smaller divergence does not falsify a dated past observation. It compares two MemRadar computations with each other, so no market_stats figure could floor it anyway. The warning it carries is structural, not numerical: the file and the index use different product sets and will always disagree.',
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
// stats: the in-memory rows from computeMarketStats. The stable figure is the
// whole point: a claim that holds on the full cohort but not on the products
// present in every window is a claim that survives only because of who happens
// to qualify this week, and it is not safe to leave in prose.
//
// SINCE 2026-09-22 THE STABLE FIGURE HERE IS `stable_paired_pct`, the median of
// per-product ratios, not `stable_pct_change`, the ratio of medians. Both are
// computed every run and both ride the summary; the tripwire keeps the ratio of
// medians, because its job is to vary the population with the statistic held
// fixed. This check has the opposite need: it asks whether a published sentence
// is still true, and a statistic that lurches 63pp when three products age out
// of a window answers that question wrongly. See stableFigure() below.
function checkClaimFloors(stats) {
  const by = new Map(stats.map((s) => [`${s.segment}|${s.period}`, s]));
  const breached = [];
  const unresolved = [];
  // WITHDRAWN is its own state, not a flavour of unresolved. A generated
  // finding the generator declined to emit has no published sentence to
  // reword, so it is not breached, and nothing failed to be checked, so it is
  // not unresolved. Reporting it as UNRESOLVED on every run trains the reader
  // to ignore the field that also carries real failures.
  const withdrawn = [];
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
      // Resumes checking BY ITSELF the first build that emits the finding
      // again: the presence of the sentence on the page is the state, so there
      // is no file to reset and nothing to remember.
      if (err.code === 'CLAIM_TEXT_ABSENT' && entry.withdrawable) {
        withdrawn.push({ ...summarise(entry), reason: err.message, means: entry.withdrawnMeans });
      } else {
        unresolved.push({ ...summarise(entry), reason: err.message });
      }
      continue;
    }

    const figures = [];
    let missing = null;
    for (const req of entry.requires) {
      const s = by.get(`${req.segment}|${req.period}`);
      if (!s || s.pct_change == null) { missing = `${req.segment} [${req.period}] has no figure this run`; break; }
      const stable = stableFigureOf(s);
      if (stable == null) { missing = `${req.segment} [${req.period}] has no stable-cohort figure (stable n=0)`; break; }
      figures.push({
        segment: req.segment,
        period: req.period,
        full_pct: s.pct_change,
        stable_pct: stable,
        stable_measure: stableMeasureOf(s),
        full_margin_pp: round1(s.pct_change - floorPct),
        stable_margin_pp: round1(stable - floorPct),
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
          if (f.stable_pct < floorPct) which.push(`stable ${f.stable_pct}% (${f.stable_measure})`);
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
    // `checked` counts claims that were actually tested. A withdrawn finding
    // was not tested and must not inflate it.
    checked: breached.length + unresolved.length + ok.length,
    registered: CLAIM_REGISTRY.length,
    unmonitorable: CLAIM_REGISTRY.filter((e) => e.monitorable === false).length,
    breached,
    unresolved,
    withdrawn,
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
  if ((result.withdrawn || []).length) {
    log(`Claim floors: ${result.withdrawn.length} generated finding(s) WITHDRAWN by the generator - no published sentence to reword, and each resumes checking if its finding returns:`);
    for (const w of result.withdrawn) log(`    ${w.page} "${w.sentence}" - ${w.means || w.reason}`);
  }
  if (!result.breached.length && !result.unresolved.length) {
    const tightest = result.ok.slice().sort((a, b) => a.min_margin_pp - b.min_margin_pp)[0];
    const wd = (result.withdrawn || []).length;
    log(`Claim floors: all ${result.ok.length} checked claims hold on both cohorts${tightest ? ` (tightest ${tightest.id}, ${tightest.min_margin_pp}pp of headroom)` : ''}${wd ? `, ${wd} withdrawn` : ''}`);
  }
  if (result.unmonitorable) {
    log(`Claim registry: ${result.registered} claims registered, ${result.unmonitorable} recorded as not floor-checkable (historical or generated).`);
  }
}

module.exports = { CLAIM_REGISTRY, checkClaimFloors, logClaimFloors, pctOf };
