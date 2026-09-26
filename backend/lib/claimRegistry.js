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


// The SSD guide's META DESCRIPTION carries its own generated tens-floor, which
// feeds <meta name="description">, Open Graph, Twitter, the JSON-LD description
// and feed.xml. It is not visible prose, which is precisely why it went
// unregistered until 2026-09-22 and was found only by noticing it still said
// 130% after the visible floors had stepped to 120%.
const bakedSsdGuideMetaFloor = () => bakedFloor(
  PAGE('guides', 'should-i-buy-an-ssd-now', 'index.html'),
  /SSD prices are up more than (\d+)% year over year/,
  '/guides/should-i-buy-an-ssd-now/', 'the SSD guide meta description floor');

// EVERY FINDING IS PUBLISHED IN TWO PLACES since 2026-09-22: the <li> on /data/
// and a line in the generated /llms.txt. Both come from the same
// buildFindings() items in the same regen, so they can only disagree if someone
// hand-edits llms.txt or a bug creeps in, and that disagreement is exactly what
// this is for.
//
// THE FLOOR IS CARRIED BY /data/ ALONE, and that is deliberate. It lives in a
// data-floor-pct attribute, which is machine-readable because HTML has a place
// to put machine-readable things. llms.txt is plain text read by people and
// models; bolting a floor token onto a published sentence there would put
// scaffolding into the one file written to be quoted. So: one floor per entry,
// read from /data/, and llms.txt is checked for the SAME SENTENCE.
//
// Absent from both -> withdrawn, which is the generator declining to emit it.
// Present in one only, or worded differently -> BREACH, because one of the two
// public locations is then saying something the other does not.
const LLMS_PATH = PAGE('llms.txt');
// A THIRD LOCATION as of 2026-09-24: /blog/will-ram-prices-go-back-down/
// restates two of the findings in its own prose. It carries the SAME
// data-claim/data-floor-pct attribute /data/ does, so the floor is readable and
// the three locations must agree on the number. It does NOT have to match the
// sentence, because the post says it in its own words on purpose; what is
// checked there is the FLOOR, which is the thing that can go false.
const POST_PATH = PAGE('blog', 'will-ram-prices-go-back-down', 'index.html');
const unescapeHtml = (t) => t
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

const bakedFindingFloor = (claimId) => () => {
  const onData = bakedFloor(
    PAGE('data', 'index.html'),
    new RegExp(`data-claim="${claimId}"[^>]*data-floor-pct="(\\d+)"`),
    '/data/', `the "${claimId}" finding`);

  // The sentence itself, from the same <li>, for the cross-location check.
  let dataSentence = null;
  try {
    const html = fs.readFileSync(PAGE('data', 'index.html'), 'utf8');
    const m = new RegExp(`data-claim="${claimId}"[^>]*>([\\s\\S]*?)<span`).exec(html);
    if (m) dataSentence = unescapeHtml(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  } catch { /* handled below */ }

  let llms;
  try {
    llms = fs.readFileSync(LLMS_PATH, 'utf8');
  } catch (err) {
    const e = new Error(`cannot read /llms.txt to cross-check the "${claimId}" finding (${err.code || err.message})`);
    e.code = 'CLAIM_LOCATION_MISMATCH';
    throw e;
  }
  const inLlms = dataSentence != null && llms.includes(dataSentence);
  if (!inLlms) {
    const e = new Error(`the "${claimId}" finding is on /data/ but not in /llms.txt with the same wording; the two published locations disagree`);
    e.code = 'CLAIM_LOCATION_MISMATCH';
    throw e;
  }
  // The post restates only two of the three findings, so its absence for a given
  // claim is normal and silent; a DISAGREEMENT is not.
  let postNote = '';
  try {
    const post = fs.readFileSync(POST_PATH, 'utf8');
    const m = new RegExp(`data-claim="${claimId}"[^>]*data-floor-pct="(\\d+)"`).exec(post);
    if (m && Number(m[1]) !== onData.floorPct) {
      const e = new Error(`the "${claimId}" floor is ${onData.floorPct}% on /data/ but ${m[1]}% on /blog/will-ram-prices-go-back-down/; two published locations disagree about the number`);
      e.code = 'CLAIM_LOCATION_MISMATCH';
      throw e;
    }
    if (m) postNote = ', and the same floor on /blog/will-ram-prices-go-back-down/';
  } catch (err) {
    if (err.code === 'CLAIM_LOCATION_MISMATCH') throw err;
    // The post not existing is not a problem: it restates, it does not own.
  }
  return { floorPct: onData.floorPct, source: `${onData.source}, and the same sentence in /llms.txt${postNote}` };
};

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
    page: '/data/ and /llms.txt',
    where: 'Current findings, published in both locations from one buildFindings() item',
    sentence: 'The median DDR5 memory kit costs more than four times what it cost a year ago.',
    requires: [{ segment: 'ddr5', period: '1y' }],
    resolveFloor: bakedFindingFloor('data-ddr5-1y'),
    floorLabel: 'the multiple baked into /data/, cross-checked against /llms.txt',
    // Generator-emitted, so an absent <li> is a DECISION, not drift: when the
    // worse cohort stops clearing the magnitude, buildFindings() withdraws the
    // finding and logs it, and this entry reports WITHDRAWN rather than
    // UNRESOLVED until the finding returns with its floor.
    withdrawable: true,
    withdrawnMeans: 'the generator did not emit this finding because DDR5 no longer clears the magnitude it states. Nothing to reword. It returns on its own when the data supports it.',
  },
  {
    id: 'data-ddr4-1y',
    page: '/data/ and /llms.txt',
    where: 'Current findings, published in both locations from one buildFindings() item',
    sentence: 'DDR4, the older generation, has more than doubled over the same year.',
    requires: [{ segment: 'ddr4', period: '1y' }],
    resolveFloor: bakedFindingFloor('data-ddr4-1y'),
    floorLabel: 'the multiple baked into /data/, cross-checked against /llms.txt',
    // Generator-emitted, so an absent <li> is a DECISION, not drift: when the
    // worse cohort stops clearing the magnitude, buildFindings() withdraws the
    // finding and logs it, and this entry reports WITHDRAWN rather than
    // UNRESOLVED until the finding returns with its floor.
    withdrawable: true,
    withdrawnMeans: 'the generator did not emit this finding because DDR4 no longer clears the magnitude it states. Nothing to reword. It returns on its own when the data supports it. Withdrawn 2026-09-21 at +98.7% on the stable cohort, measured as a ratio of medians; on the paired median used since 2026-09-22 the same data read +145.1% and this finding would not have been withdrawn.',
  },
  {
    id: 'data-ssd-1y',
    page: '/data/ and /llms.txt',
    where: 'Current findings, published in both locations from one buildFindings() item',
    sentence: 'Storage followed memory up: NVMe and SATA solid state drives have both more than doubled year over year.',
    requires: [{ segment: 'nvme_ssd', period: '1y' }, { segment: 'sata_ssd', period: '1y' }],
    resolveFloor: bakedFindingFloor('data-ssd-1y'),
    floorLabel: 'the multiple baked into /data/, on BOTH drive segments, cross-checked against /llms.txt',
    // Generator-emitted, so an absent <li> is a DECISION, not drift: when the
    // worse cohort stops clearing the magnitude, buildFindings() withdraws the
    // finding and logs it, and this entry reports WITHDRAWN rather than
    // UNRESOLVED until the finding returns with its floor.
    withdrawable: true,
    withdrawnMeans: 'the generator did not emit this finding because one of the two drive segments no longer clears the magnitude it states. Nothing to reword. It returns on its own when the data supports it.',
  },
  {
    id: 'data-atl-counts',
    page: '/data/, and restated with a date on /blog/will-ram-prices-go-back-down/',
    where: 'Current findings',
    sentence: 'N of the M products MemRadar tracks sell for at least one and a half times their lowest recorded price, and K for more than three times it.',
    monitorable: false,
    reason: 'counts, not segment figures. Both are recomputed from each product\'s own recorded history during every regen (atlMultipleDistribution), so unlike a hand-written magnitude they cannot go stale between builds, and no market_stats row can falsify them. Same standing as the explainer\'s ATL-multiple counts. They are dated with the BUILD date on the page rather than the market_stats computed_at, because that is when they were actually calculated. RESTATED 2026-09-24 on /blog/will-ram-prices-go-back-down/ as "It is 88% today", which is a DATED PIN rather than a live figure: that post carries a hand-set reviewed date and its figures are fixed to it, so the number there will not track the regen and is not expected to. If the share moves materially the post is re-reviewed by hand, never silently updated.',
  },

  // --------------------------- /blog/will-ram-prices-go-back-down/ (2026-09-24)
  // A forecast-adjacent piece, so every figure in it is PINNED to a measurement
  // date and hand-written. The four historical entries describe a closed period
  // and cannot drift; the one current comparison is dated in the copy itself.
  {
    id: 'lastcycle-peak-ratio',
    page: '/blog/will-ram-prices-go-back-down/',
    where: 'verdict box and "What happened last time"',
    sentence: 'peaked at 2.2 to 2.8 times their 2016 price in December 2017 and January 2018',
    monitorable: false,
    reason: 'historical, about a closed period, and no market_stats figure spans 2016: the segment tables start at 2019-11 because ddr4 had 2 to 3 tracked products before 2018-11. Measured 2.16x, 2.34x and 2.76x, median 2.34x, peaks on 2017-12-12, 2018-01-02 and 2018-01-08. Method: each kit\'s own price_history through buildDailySeries (in_stock only, last reading per UTC day); baseline is the median of that kit\'s 2016-H1 observations; the peak is the highest observation in 2017-2018 across ALL observations. No marketplace exclusion was applied and none is possible here: regular_price is a frozen backfill MSRP for these products, a single value of $259.99 on every row from 2015 to 2025, so price above regular_price means only above the 2015 MSRP, which is what a shortage does. Slugs: g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2.',
  },
  {
    id: 'lastcycle-months-to-baseline',
    page: '/blog/will-ram-prices-go-back-down/',
    where: 'verdict box and the per-kit list',
    sentence: 'fell back to where they started within about a year and a half',
    monitorable: false,
    reason: 'historical, a closed period. Measured 15.7, 15.9 and 17.5 months from each peak to the first observation back below that kit’s own 2016-H1 baseline, on 2019-04-05, 2019-05-07 and 2019-06-20. Method: each kit\'s own price_history through buildDailySeries (in_stock only, last reading per UTC day); baseline is the median of that kit\'s 2016-H1 observations; the peak is the highest observation in 2017-2018 across ALL observations. No marketplace exclusion was applied and none is possible here: regular_price is a frozen backfill MSRP for these products, a single value of $259.99 on every row from 2015 to 2025, so price above regular_price means only above the 2015 MSRP, which is what a shortage does. Slugs: g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2.',
  },
  {
    id: 'lastcycle-trough',
    page: '/blog/will-ram-prices-go-back-down/',
    where: 'verdict box and the per-kit list',
    sentence: 'two years later were selling for roughly half their pre-spike price',
    monitorable: false,
    reason: 'historical, a closed period. Troughs $105.99 on 2020-08-26, $58.99 on 2020-08-10 and $59.97 on 2020-09-11, which are 0.57x, 0.71x and 0.55x the respective 2016-H1 baselines. Method: each kit\'s own price_history through buildDailySeries (in_stock only, last reading per UTC day); baseline is the median of that kit\'s 2016-H1 observations; the peak is the highest observation in 2017-2018 across ALL observations. No marketplace exclusion was applied and none is possible here: regular_price is a frozen backfill MSRP for these products, a single value of $259.99 on every row from 2015 to 2025, so price above regular_price means only above the 2015 MSRP, which is what a shortage does. Slugs: g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2.',
  },
  {
    id: 'lastcycle-alltime-trough',
    page: '/blog/will-ram-prices-go-back-down/',
    where: '"Where DDR4 sits now, against that"',
    sentence: 'At their lowest, in June 2024 and March 2025, the three kits sold for about a quarter of their 2016 price.',
    monitorable: false,
    reason: 'historical, a closed period, and no market_stats figure reaches 2016. This is a DIFFERENT low from lastcycle-trough and does not supersede it: that entry is the 2020 unwind (0.57x, 0.71x, 0.55x), this one is the deeper all-time low that came years later. Both are true of different windows, which is why the sentence names its years. Measured $46.99 on 2025-03-09, $19.98 on 2024-06-27 and $27.99 on 2025-03-14, which are 0.251x, 0.241x and 0.255x the respective 2016-H1 baselines, so "about a quarter" holds on all three within 24 to 26 percent. Method: the lowest in-stock price AFTER that kit\'s 2018 peak, from its own price_history through buildDailySeries (in_stock only, last reading per UTC day); baseline is the median of that kit\'s 2016-H1 observations. THE SENTENCE STATES A LEVEL, NOT A PRICE, DELIBERATELY: two of the three lows ($46.99 and $27.99) appear in exactly ONE in-stock reading in the whole history, so a dated exact price would rest on a single observation, the same hazard as the all-time-high spikes on the backlog. The level is corroborated where the cent is not, with 31, 3 and 2 row-days inside 5 percent of each low. No low sits next to an out-of-stock gap (zero in_stock=false rows within 7 days of any of the three) and regular_price is null on all three low days, so the marketplace test returns nothing rather than a misleading pass. Slugs: g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2.',
  },
  {
    id: 'lastcycle-peak-window',
    page: '/blog/will-ram-prices-go-back-down/',
    where: '"What happened last time", closing paragraph',
    sentence: 'a peak within a five-week window at the turn of 2018',
    monitorable: false,
    reason: 'historical, a closed period. The three peaks fall on 2017-12-12, 2018-01-02 and 2018-01-08, a span of 27 days, which a five-week window contains. Method: each kit\'s own price_history through buildDailySeries (in_stock only, last reading per UTC day); baseline is the median of that kit\'s 2016-H1 observations; the peak is the highest observation in 2017-2018 across ALL observations. No marketplace exclusion was applied and none is possible here: regular_price is a frozen backfill MSRP for these products, a single value of $259.99 on every row from 2015 to 2025, so price above regular_price means only above the 2015 MSRP, which is what a shortage does. Slugs: g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2.',
  },
  {
    id: 'ddr4-now-vs-2016',
    page: '/blog/will-ram-prices-go-back-down/',
    where: '"Where DDR4 sits now, against that"',
    sentence: 'the three kits today sit between 1.2 and 1.8 times where they started, median 1.3 times (measured September 23, 2026)',
    monitorable: false,
    reason: 'PINNED TO ITS MEASUREMENT DATE, the csv-header-44pp-divergence pattern: the sentence carries its own date, so a later reading does not falsify it. Measured 2026-09-23 at $239.99 against a $187.58 baseline (1.28x), $145.99 against $83.00 (1.76x) and $129.99 against $109.80 (1.18x), median 1.28x. It compares today against a fixed 2016 baseline held only in price_history, so no stored market_stats figure could floor it in any case. Method: each kit\'s own price_history through buildDailySeries (in_stock only, last reading per UTC day); baseline is the median of that kit\'s 2016-H1 observations; the peak is the highest observation in 2017-2018 across ALL observations. No marketplace exclusion was applied and none is possible here: regular_price is a frozen backfill MSRP for these products, a single value of $259.99 on every row from 2015 to 2025, so price above regular_price means only above the 2015 MSRP, which is what a shortage does. Slugs: g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz, g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2.',
  },
  {
    id: 'longtracked-kit-count',
    page: '/blog/will-ram-prices-go-back-down/',
    where: 'verdict box and "What happened last time"',
    sentence: 'three DDR4 kits we have tracked since 2015 and 2016',
    monitorable: false,
    reason: 'a count of catalog members, not a market figure, so no market_stats row can test it. ENFORCED AT BUILD TIME INSTEAD: WILL_RAM_FALL_KITS lists the three slugs and buildWillRamFall() THROWS if one is missing from the catalog or carries noindex, which fails the regen rather than publishing a post that cites a page we tell crawlers to ignore. First observations 2015-11-12, 2015-11-27 and 2016-02-15, with no gap over 60 days before 2021.',
  },

  // ---------------- Prime Day event study (2026-09-25). All unmonitorable:
  // every figure is a historical event gap over closed sale windows, and
  // market_stats holds no history and nothing before 2019-11 at segment level.
  {
    id: 'primeday-edge-3pt',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: 'verdict box and "Prime Day: a small, repeatable edge"',
    sentence: 'by about 3 percentage points on a typical product',
    monitorable: false,
    reason: 'historical event study over closed periods; no market_stats row spans a 2017 sale window, and the table holds no history. Measured median gap across the nine Prime Days 2017 to 2025 = -3.47pp, beating the same-year control in 7 of 9 (the two that did not are 2018 +0.83pp and 2019 +0.73pp, both years whose ordinary windows already carried a discount). Prime Day 2016 is excluded because zero products had both a window reading and a prior baseline. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'primeday-nvme-6to9',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"Prime Day: a small, repeatable edge"',
    sentence: 'they bottomed 6 to 9 points further below their recent price on Prime Day than in an ordinary window',
    monitorable: false,
    reason: 'historical, closed periods. NVMe gaps: 2024 -6.68pp on n=18, 2025 -9.09pp on n=30. These are the only two Prime Days where NVMe clears n=15; earlier years hold 1 to 8 drives and are not reportable, which is why the copy names those two years. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'primeday-2024-example',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"Prime Day: a small, repeatable edge"',
    sentence: 'The typical product lowest Prime Day price was 6.7 percent under its previous month; an ordinary two-day window that year managed zero.',
    monitorable: false,
    reason: 'historical, a closed period. Prime Day 2024 event median -6.67% on n=49; same-year two-day control median -0.02% on n=4595 product-windows. The gap is -6.64pp, the largest of any Prime Day measured. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'primeday-other-segments-2to4',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"Prime Day: a small, repeatable edge"',
    sentence: 'DDR4, DDR5 and SATA drives all showed the edge, but smaller, in the 2 to 4 point range',
    monitorable: false,
    reason: 'historical, closed periods. NOTE THE STATISTIC DIFFERS FROM THE HEADLINE FIGURE and this is deliberate: these are POOLED EVENT MEDIANS across all ten Prime Days, not year-matched gaps, because per-event segment cells fall to 0 to 2 products. DDR4 -2.63% on n=62, DDR5 -3.06% on n=55, SATA -3.55% on n=45, against pooled same-length controls of -0.71%, +0.00% and +0.00%, so the implied gaps are about -1.9pp, -3.1pp and -3.6pp and the 2 to 4 range holds on either reading. NVMe pooled is -7.28% on n=60 and is reported separately. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'october-no-edge',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: 'verdict box and "The October sale: no edge at all"',
    sentence: 'it beat an ordinary window in two of the four years and lost in the other two, with a median gap under 1 point',
    monitorable: false,
    reason: 'historical, closed periods. The four October events are 2022-10-11/12 (Prime Early Access Sale), 2023-10-10/11, 2024-10-08/09 and 2025-10-07/08 (Prime Big Deal Days). Gaps -3.31pp, +0.85pp, -2.59pp, +3.87pp, so 2 of 4 beat their year and the median is -0.87pp. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'blackfriday-2pt',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"Black Friday: a small edge in normal years, a trap in a rising one"',
    sentence: 'beat an ordinary same-year window in six of nine years, by a median of about 2 points',
    monitorable: false,
    reason: 'historical, closed periods. PRIMARY FIGURE, 2017 TO 2025: 6 of 9 Black Friday windows beat their own year, median gap -2.31pp. That span was chosen to match the verdict box phrase "since 2017", after the first draft quoted the ten-year figure and disagreed with it. THE TEN-YEAR FIGURE, KEPT FOR THE RECORD: over 2016 to 2025 it is 7 of 10 with a median of -2.03pp. Both are correct; the published sentence uses the nine-year span because the rest of the post starts at 2017, where Prime Day first has usable data. Windows run Black Friday through Cyber Monday, and Black Friday was verified for each year as the day after the fourth Thursday of November. Gaps: 2016 -1.75, 2017 -6.93, 2018 -2.38, 2019 -2.31, 2020 +1.11, 2021 -2.90, 2022 -2.52, 2023 +2.68, 2024 -0.86, 2025 +13.18pp. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'blackfriday-2025-worse',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: 'verdict box and "Black Friday: a small edge in normal years, a trap in a rising one"',
    sentence: 'the typical product lowest Black Friday weekend price was 13 percent above its previous month, and 13 points worse than an ordinary week that year',
    monitorable: false,
    reason: 'historical, a closed period. BF-CM 2025 (2025-11-28 to 2025-12-01) event median +12.90% on n=116, same-year four-day control median -0.27% on n=7141, gap +13.18pp, the worst of any event measured. The companion claim that waiting cost money is supported by October Prime 2025 at +3.87% against this +12.90%. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'presale-no-inflation',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"Two things people assume that the data does not show"',
    sentence: 'the median change is zero and the price rose in 49 percent of cases',
    monitorable: false,
    reason: 'historical, closed periods, and a NULL result rather than a magnitude, so there is no floor to breach. Compares the median of days -60 to -45 before each sale with the median of days -14 to -1, pooled over all 24 event windows: n=990 product-and-sale pairs, median +0.00%, 49.1% rising. Per-event figures track the prevailing trend in both directions, from -15.84% (BF 2018) to +38.47% (BF 2025), which is why only the pooled figure is published. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'annual-low-no-month',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"Two things people assume that the data does not show"',
    sentence: 'the annual low landed in November 16 percent of the time, July 10 percent, October 3 percent',
    monitorable: false,
    reason: 'historical, and a NULL result. Product-years with at least 200 in-stock readings: 31. November 5 of 31 = 16.1% (z=+1.50), July 3 = 9.7% (z=+0.26), October 1 = 3.2% (z=-0.99), against a uniform expectation of 8.3%. January reads 9 of 31 = 29.0% (z=+3.99) and is DELIBERATELY NOT PUBLISHED as seasonality: 6 of those 9 are 2026, a partial year in which prices rose continuously so January is mechanically the minimum, and dropping 2026 returns January to 3 of 23, near uniform. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'marketplace-share',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: '"What we cannot see"',
    sentence: 'the best marketplace price where Amazon has no offer of its own, which is the case for about three quarters of the products we track',
    monitorable: false,
    reason: 'not checkable on a schedule, and this is structural rather than awkward: the price SOURCE (Keepa AMAZON versus NEW) is not stored anywhere in the database, only the resulting price, so recomputing it costs one Keepa token per product and cannot ride a stats run. Recorded figure 73.3%, 165 of 225 priced products, from the methodology audit; "about three quarters" holds on that denominator and on 70.2% of all 235. Re-measure by hand per the procedure in the methodology section of CLAUDE.md. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
  },
  {
    id: 'product-count-235',
    page: '/blog/is-prime-day-a-good-time-to-buy-ram/',
    where: 'verdict box',
    sentence: '235 memory kits and SSDs we track',
    monitorable: false,
    reason: 'a pinned catalog count, not a market figure, so no market_stats row can test it. 235 products at the 2026-09-25 audit (119 ram, 116 ssd), of which 231 are indexable. PINNED ON PURPOSE: the post is an event study fixed to its audit date, so the count is stated as of that date and does not follow the catalog. If the catalog changes materially, the sentence needs a human edit rather than a regen. METHOD, common to every entry from this post: for each sale, each product with an in-stock price in the sale window AND in the prior 30 days contributes one figure, the window MINIMUM against the median of that product over the prior 30 days. The reported gap is that figure minus the same statistic computed over ordinary windows of the same length drawn from the SAME calendar year and kept 14 days clear of every sale, which is what removes the year trend. All series built by the generator daily-series rule (in_stock only, last reading per UTC day), day strings not array positions. REGULAR PRICE ONLY: keepa.js reads csv[0] AMAZON, csv[1] NEW and csv[18] BUY_BOX_SHIPPING; csv[8] LIGHTNING_DEAL and csv[9] WAREHOUSE are never requested, so no deal price is in the data. Audited 2026-09-25 and every figure is pinned to that date.',
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
      if (err.code === 'CLAIM_LOCATION_MISMATCH') {
        // A BREACH, not an unresolved check. The claim is published in two
        // places and they no longer say the same thing, so one of them is
        // wrong and a person has to look. It carries no figures because no
        // floor could be resolved to compare against.
        breached.push({
          ...summarise(entry),
          floor_pct: null,
          floor_source: 'both published locations',
          figures: [],
          breached_on: [err.message],
        });
      } else if (err.code === 'CLAIM_TEXT_ABSENT' && entry.withdrawable) {
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
      log(`      needs ${b.floor_source}${b.floor_pct == null ? '' : ` (${b.floor_pct}%)`}; ${b.breached_on.join('; ')}`);
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
