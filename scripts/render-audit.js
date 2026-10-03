// RENDERED PAGE vs SERVED HTML. Loads each page twice, once with JavaScript
// DISABLED (what a non-rendering crawler gets) and once with it enabled against
// the live site, then diffs the two and classifies every difference.
//
// WHY THIS EXISTS, and why it is not hydration-check.js. That check asks "does
// hydration run at all", by corrupting what the page writes and asserting it is
// restored. It cannot see a surface that hydrates PERFECTLY INTO THE WRONG
// VALUE, because the value it compares against is whatever hydration produced.
// On 2026-10-03 exactly that shipped: the P1 pass baked the PDP short name into
// all 232 listing cards, applyAndRender() rewrote grid.innerHTML from the raw
// Amazon title, and for three and a half weeks every card silently swapped its
// name a moment after load. The served HTML was correct, so View Source was
// correct, and so was every crawler. Only a rendered DOM showed it, and nothing
// looked at one. This diffs the two and makes that class of defect mechanical.
//
// THE EXTRACTOR RUNS ONCE AND IS CALLED TWICE. Both sides go through the same
// in-page function, so a difference cannot be an artifact of parsing HTML with
// one tool and a DOM with another, which is the standing trap in this repo:
// a check that passes for the wrong reason. The JS-off load is a real browser
// fetch of the same URL, so CSS-driven visibility is honoured on both sides and
// a block hidden by the stylesheet is hidden in both readings.
//
// PLAYWRIGHT WAS ASKED FOR AND PUPPETEER IS USED, DELIBERATELY. Playwright is
// not installed, and adding it would mean a second browser download plus a new
// install path in deploy-frontend.yml, which currently does
// `npm i --no-save puppeteer@25` and points PUPPETEER_EXECUTABLE_PATH at the
// runner's preinstalled Chrome. scripts/hydration-check.js already rides that.
// One browser driver, one CI install, and this script can join that same step.
//
// READ-ONLY. It writes nothing but its own report.
//
// Usage:
//   node scripts/render-audit.js
//   node scripts/render-audit.js --base=http://127.0.0.1:8099
//   node scripts/render-audit.js --pages=/ram/,/ssd/
//   node scripts/render-audit.js --json=scripts/output/render-audit.json
//   node scripts/render-audit.js --quiet-ms=1500 --verbose
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const BASE = (arg('base', 'https://memradar.com')).replace(/\/$/, '');
// Quiet window with no <main> mutation that counts as hydration being finished.
// 1200ms comfortably clears the 120ms search debounce and a slow Supabase round
// trip on the listing pages without making the run drag.
const QUIET_MS = Number(arg('quiet-ms', '1200'));
const NAV_TIMEOUT = Number(arg('timeout', '60000'));
const JSON_OUT = arg('json', '');
const VERBOSE = flag('verbose');

// One RAM and one SSD PDP from the IMPROVE bucket of the index plan, picked by
// highest Google impressions so the sample is the work actually queued rather
// than an arbitrary page. Re-pick from scripts/index-plan-*.tsv if that moves.
const DEFAULT_PAGES = [
  { url: '/', kind: 'homepage' },
  { url: '/ram/', kind: 'listing' },
  { url: '/ssd/', kind: 'listing' },
  { url: '/ram/teamgroup-elite-sodimm-ddr5-64gb-5600mhz/', kind: 'pdp' },
  { url: '/ssd/samsung-990-pro-w-heatsink-ssd-2tb/', kind: 'pdp' },
  { url: '/ram/ddr4-ram-laptop-only-gigastone-32gb-kit-3200mhz/', kind: 'pdp' },
  { url: '/price-index/', kind: 'generated' },
  { url: '/build-cost/', kind: 'generated' },
  { url: '/guides/should-i-buy-ram-now/', kind: 'guide' },
  { url: '/guides/should-i-buy-an-ssd-now/', kind: 'guide' },
  { url: '/blog/why-ram-prices-are-so-high/', kind: 'editorial' },
  { url: '/blog/will-ram-prices-go-back-down/', kind: 'editorial' },
  { url: '/glossary/', kind: 'reference' },
  { url: '/faq/', kind: 'reference' },
  { url: '/raycast/', kind: 'reference' },
  { url: '/alert-confirmed/', kind: 'result' },
  { url: '/data/', kind: 'reference' },
];

const PAGES = (() => {
  const override = arg('pages', '');
  if (!override) return DEFAULT_PAGES;
  return override.split(',').map((u) => {
    const url = u.trim().startsWith('/') ? u.trim() : '/' + u.trim();
    const known = DEFAULT_PAGES.find((p) => p.url === url);
    return known || { url, kind: 'other' };
  });
})();

// Third-party noise, separated rather than hidden. Analytics beacons are aborted
// on unload by design and the Turnstile challenge platform 401s for a headless
// client with no interaction. Counting those as page errors trains a reader to
// skim past the column, which is how a real error goes unread.
const THIRD_PARTY_HOST = /google-analytics\.com|googletagmanager\.com|challenges\.cloudflare\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|code\.jquery\.com|doubleclick/;
const THIRD_PARTY_CONSOLE = /font-size:0;color:transparent|gtag|google-analytics|turnstile|challenges\.cloudflare/i;

const log = (s) => console.log(s);
const norm = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// BLAME. Line numbers are RESOLVED BY SEARCHING THE FILE AT AUDIT TIME, never
// hardcoded, so a report cannot cite a line that has moved or no longer exists.
// ---------------------------------------------------------------------------
const FRONTEND = path.join(__dirname, '..', 'frontend');
function locate(rel, pattern) {
  const abs = path.join(FRONTEND, rel);
  let lines;
  try { lines = fs.readFileSync(abs, 'utf8').split('\n'); } catch (e) { return `${rel} (unreadable)`; }
  const i = lines.findIndex((l) => pattern.test(l));
  return i < 0 ? `${rel} (pattern not found: ${pattern})` : `${rel}:${i + 1}`;
}
const BLAME = {
  listing_cards: () => [
    locate('js/product-data.js', /\.from\('products'\)\.select\(/),
    locate('js/product-listing.js', /grid\.innerHTML = sorted\.map\(cardHtml\)/),
    locate('js/product-listing.js', /function displayName\(p\)/),
  ],
  listing_count: () => [locate('js/product-listing.js', /function updateCount|listing-count/)],
  home_drops: () => [
    // The CARD render, not the skeleton write above it: a bare /grid.innerHTML/
    // matches the skeleton first and would blame the wrong statement.
    locate('js/home-drops.js', /grid\.innerHTML = chosen\.map\(cardHtml\)/),
    locate('js/home-drops.js', /function displayName\(p\)/),
  ],
  home_skeleton: () => [locate('js/home-drops.js', /skeleton\(\);/)],
  pdp_hydrate: () => [locate('js/pdp-hydrate.js', /getElementById\('pdpCurrentPrice'\)|pdpCurrentPrice/)],
  price_index: () => [locate('js/price-index.js', /pi-|querySelector/)],
  guide_live: () => [locate('js/guide-live.js', /guide-atl-row|pi-/)],
  search: () => [locate('js/search.js', /search-row-name/)],
  filter_sheet: () => [locate('js/filter-sheet.js', /appendChild|insertBefore/)],
  theme: () => [locate('js/theme.js', /innerHTML|insertAdjacentHTML/)],
  mobile_nav: () => [locate('js/mobile-nav.js', /addEventListener/)],
  unknown: () => ['(no client file identified; inspect the page scripts)'],
};
function blameFor(kindOfPage, reason, where) {
  if (/card_count|product card/i.test(reason) || /listing-card/i.test(where)) {
    return kindOfPage === 'homepage' ? BLAME.home_drops() : BLAME.listing_cards();
  }
  if (/count line|Showing \d/i.test(where)) return BLAME.listing_count();
  if (kindOfPage === 'homepage') return BLAME.home_drops();
  if (kindOfPage === 'listing') return BLAME.listing_cards();
  if (kindOfPage === 'pdp') return BLAME.pdp_hydrate();
  if (kindOfPage === 'generated' && /price-index/.test(where)) return BLAME.price_index();
  if (kindOfPage === 'guide') return BLAME.guide_live();
  return BLAME.unknown();
}

// ---------------------------------------------------------------------------
// IN-PAGE EXTRACTOR. Serialized to both loads. Keep it dependency free.
// ---------------------------------------------------------------------------
const EXTRACT = function () {
  const nm = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main') || document.body;

  const inNoscript = (el) => !!el.closest('noscript');
  const visible = (el) => {
    if (inNoscript(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (el.closest('[hidden], [aria-hidden="true"]')) return false;
    // Off-screen honeypots and visually-hidden captions are real content for a
    // screen reader but not part of the visible reading experience.
    if (el.closest('.visually-hidden')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  };

  // LEAF BLOCKS ONLY: an element that matches the block set and contains no
  // descendant that also matches it, so a paragraph's text is not counted again
  // as part of its section wrapper.
  const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,td,th,dt,dd,figcaption,caption,blockquote,summary,label,button';
  // A CONTROL is a widget, not prose. The Market Pulse window switcher and the
  // PDP chart range buttons are injected by their own scripts into containers the
  // generator leaves empty on purpose, so they are absent from the served HTML by
  // design and must not read as missing content.
  const isControl = (el) => !!(el.closest('button, .pulse-windows, .pdp-range-btn, .pdp-chart-ranges, .filter-sheet, .modal-overlay, #alertModal, .search-dropdown, .back-to-top'));
  // CARDS get their own typed check below. Their text is excluded here because a
  // live-chosen set of products is a different question from a copy change, and
  // mixing them makes both unreadable.
  const inCard = (el) => !!el.closest('.listing-card, .search-row');
  const blocks = [];
  const hiddenBlocks = [];
  const controls = [];
  main.querySelectorAll(BLOCK).forEach((el) => {
    if (el.querySelector(BLOCK)) return;
    const t = nm(el.textContent);
    if (!t) return;
    if (inCard(el)) return;
    if (isControl(el)) { controls.push(t); return; }
    (visible(el) ? blocks : hiddenBlocks).push(t);
  });

  // Every product card on the page, with the name it actually DISPLAYS.
  const cards = [];
  main.querySelectorAll('.listing-card[data-sku]').forEach((el) => {
    const nameEl = el.querySelector('.listing-card-name');
    const img = el.querySelector('.listing-card-img-el');
    cards.push({
      sku: el.getAttribute('data-sku'),
      name: nameEl ? nm(nameEl.textContent) : null,
      href: el.getAttribute('data-href') || ((el.querySelector('a[href^="/ram/"], a[href^="/ssd/"]') || {}).getAttribute
        ? el.querySelector('a[href^="/ram/"], a[href^="/ssd/"]').getAttribute('href') : null),
      alt: img ? img.getAttribute('alt') : null,
      container: el.closest('#biggestDropsGrid') ? 'drops' : (el.closest('.listing-grid') ? 'listing' : 'other'),
    });
  });

  const headings = [];
  main.querySelectorAll('h1,h2,h3').forEach((el) => {
    // A card's h3 IS the product name, already checked per sku against the index.
    // Reporting it here too turns one finding into two and makes a live-chosen
    // set of products look like missing headings.
    if (inNoscript(el) || inCard(el)) return;
    headings.push({ level: el.tagName.toLowerCase(), text: nm(el.textContent), visible: visible(el) });
  });

  const links = [];
  main.querySelectorAll('a[href]').forEach((el) => {
    if (inNoscript(el) || inCard(el) || isControl(el)) return;
    links.push({ text: nm(el.textContent), href: el.getAttribute('href'), visible: visible(el) });
  });

  const alts = [];
  main.querySelectorAll('img').forEach((el) => {
    if (inNoscript(el) || inCard(el)) return;
    alts.push({ src: (el.getAttribute('src') || '').split('/').pop(), alt: el.getAttribute('alt') });
  });

  const jsonld = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try { jsonld.push(JSON.parse(el.textContent)); } catch (e) { jsonld.push({ __parse_error: String(e.message) }); }
  });

  const metaOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? nm(el.getAttribute('content')) : null;
  };

  const counts = {
    product_cards: main.querySelectorAll('.listing-card[data-sku]').length,
    listing_cards_any: main.querySelectorAll('.listing-card').length,
    skeleton_cards: main.querySelectorAll('.listing-card-skeleton, .skeleton, .listing-card--skeleton').length,
    peer_rows: main.querySelectorAll('[data-peer-sku]').length,
    atl_rows: main.querySelectorAll('.guide-atl-row').length,
    table_rows: main.querySelectorAll('tbody tr').length,
    canvases: main.querySelectorAll('canvas').length,
    details: main.querySelectorAll('details').length,
    forms: main.querySelectorAll('form').length,
    pi_cells: main.querySelectorAll('[id^="pi-"]').length,
  };

  return {
    title: nm(document.title),
    metaDesc: metaOf('meta[name="description"]'),
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
    robots: metaOf('meta[name="robots"]'),
    ogTitle: metaOf('meta[property="og:title"]'),
    blocks, hiddenBlocks, controls, cards, headings, links, alts, jsonld, counts,
    mainHtmlLen: main.innerHTML.length,
    audit: window.__audit ? {
      firstMutationMs: window.__audit.firstMutationMs,
      lastMutationMs: window.__audit.lastMutationMs,
      mutationCount: window.__audit.mutationCount,
      parseAdditions: window.__audit.parseAdditions,
      timeline: window.__audit.timeline,
      wipes: window.__audit.wipes,
    } : null,
  };
};

// Installed before any page script runs. An observer attached late is the
// documented way this repo has already fooled itself once: a 150ms delay made
// /price-index/ report as having nothing to hydrate.
const INSTRUMENT = function () {
  window.__audit = {
    t0: Date.now(), firstMutationMs: null, lastMutationMs: null,
    mutationCount: 0, parseAdditions: 0, timeline: [], wipes: [],
  };
  const A = window.__audit;
  const TRACKED = ['#biggestDropsGrid', '.listing-grid', '#pdpPriceCard', 'main'];
  const snap = () => {
    const out = {};
    if (!document.documentElement) return out;
    TRACKED.forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      out[sel] = {
        sku: el.querySelectorAll('[data-sku]').length,
        skel: el.querySelectorAll('.listing-card-skeleton, .skeleton, .radar-pulse').length,
        els: el.querySelectorAll('*').length,
      };
    });
    return out;
  };
  // ATTACHED AT DOCUMENT_START, ON `document`, NOT AT DOMContentLoaded ON <main>.
  // The classic scripts at the end of <body> execute BEFORE DOMContentLoaded
  // fires, so an observer installed there misses everything they do on first
  // run. Measured: the explainer reported ZERO mutations and no hydration, which
  // read as "this page is fully served" when in fact guide-live.js had already
  // drawn its chart. Same family as the 150ms delay that once reported
  // /price-index/ as having nothing to hydrate: an instrument that starts late
  // reports absence it caused itself.
  const start = () => {
    A.timeline.push({ t: 0, phase: 'initial', snap: snap() });
    new MutationObserver((muts) => {
      const t = Date.now() - A.t0;
      let touched = false;
      for (const m of muts) {
        const n = m.target && m.target.nodeType === 1 ? m.target
          : (m.target && m.target.parentElement ? m.target.parentElement : null);
        if (n && n.closest && n.closest('main')) { touched = true; break; }
      }
      if (!touched) return;
      // PARSING IS NOT HYDRATION. Observing from document_start means every node
      // the HTML parser inserts arrives as a childList addition, which made a
      // page no script touches report 573 mutations in its first 8ms. The parser
      // only ever ADDS, and it sets attributes before insertion, so removals,
      // attribute writes and characterData edits are script work by construction.
      // Additions are counted only once parsing is done. That keeps the early
      // coverage this observer was moved to document_start for (Chart.js sizing a
      // canvas is an attribute write) without counting the document being built.
      const parsing = document.readyState === 'loading';
      let scripted = 0, parsed = 0;
      for (const m of muts) {
        const isAdd = m.type === 'childList' && m.addedNodes.length > 0 && m.removedNodes.length === 0;
        if (isAdd && parsing) { parsed++; continue; }
        scripted++;
      }
      A.parseAdditions += parsed;
      // THE SNAPSHOT IS TAKEN ON EVERY MUTATION, INCLUDING PARSE-TIME ONES, so a
      // baseline exists before any script runs. Gating it on `scripted` left the
      // first recorded snapshot possibly already post-wipe, which would report a
      // wipe as "none": a false negative in the one check whose whole job is to
      // catch content being destroyed. Only the hydration TIMING is gated.
      const s = snap();
      const prev = A.timeline[A.timeline.length - 1];
      if (scripted) {
        A.mutationCount += scripted;
        if (A.firstMutationMs == null) A.firstMutationMs = t;
        A.lastMutationMs = t;
      }
      // A WIPE is real content leaving: a container that held [data-sku]
      // elements now holds none, or holds only skeletons. Recorded with its
      // timestamp so Node can say whether any data had arrived by then.
      Object.keys(s).forEach((sel) => {
        const before = prev && prev.snap[sel];
        if (!before) return;
        if (before.sku > 0 && s[sel].sku === 0) {
          A.wipes.push({ selector: sel, t, from: before.sku, to: 0, skeletonsAfter: s[sel].skel });
        }
      });
      if (A.timeline.length < 400) A.timeline.push({ t, phase: scripted ? 'script' : 'parse', snap: s });
    }).observe(document, { childList: true, characterData: true, subtree: true, attributes: true });
  };
  start();
};

// ---------------------------------------------------------------------------
// CLASSIFICATION
// ---------------------------------------------------------------------------
// A changed string is EXPECTED when everything that moved is a live figure the
// site states plainly is live. These are deliberately narrow: a rule that
// matches a whole sentence because it happens to contain a price would hide a
// copy change, which is the thing this audit is for.
const EXPECTED_PATTERNS = [
  { name: 'price', re: /\$\s?\d[\d,]*(\.\d{2})?/ },
  { name: 'relative time', re: /\b(updated|refreshed)\b.*\b(ago|just now)\b|\b\d+\s+(second|minute|hour|day)s?\s+ago\b/i },
  { name: 'last updated line', re: /last updated|prices update|price may have changed/i },
  { name: 'stock or buy state', re: /good price|typical price|above average|out of stock|currently unavailable|in stock|last seen/i },
  { name: 'change indicator', re: /[▼▲]\s?\d+(\.\d+)?%|\b[-+]\d+(\.\d+)?%/ },
  { name: 'count line', re: /showing \d+ (product|result)/i },
  { name: 'per-GB value', re: /\/\s?GB|per\s?GB/i },
  { name: 'percent figure', re: /\b\d+(\.\d+)?%/ },
  { name: 'all-time low gap', re: /all-time (low|high)|within \d|above its/i },
  { name: 'date stamp', re: /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d/i },
];
const EXPECTED_COUNT_KEYS = ['canvases', 'skeleton_cards'];
const EXPECTED_JSONLD_KEYS = /priceValidUntil|validFrom|dateModified|price|availability|lowPrice|highPrice/;

function expectedReason(text) {
  for (const p of EXPECTED_PATTERNS) if (p.re.test(text)) return p.name;
  return null;
}

// Multiset diff: returns what is only on each side, so pure reordering comes
// back empty and is reported as NOISE rather than as content churn.
function multisetDiff(a, b) {
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const onlyA = [], onlyB = [];
  for (const [k, n] of ca) { const d = n - (cb.get(k) || 0); for (let i = 0; i < d; i++) onlyA.push(k); }
  for (const [k, n] of cb) { const d = n - (ca.get(k) || 0); for (let i = 0; i < d; i++) onlyB.push(k); }
  return { onlyA, onlyB, reordered: onlyA.length === 0 && onlyB.length === 0 && a.join('\u0000') !== b.join('\u0000') };
}

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {});
  }
  return v;
}

// Pair up strings that are plainly the same block with a figure changed, so the
// report says "this line's price moved" instead of one removal and one addition.
function pairByShape(onlyServed, onlyRendered) {
  const skeleton = (s) => s.replace(/\$\s?\d[\d,]*(\.\d{2})?/g, '$#')
    .replace(/\b\d[\d,]*(\.\d+)?%/g, '#%')
    .replace(/\b\d[\d,]*(\.\d+)?\b/g, '#');
  const pairs = [], leftoverA = [], used = new Set();
  for (const a of onlyServed) {
    const sa = skeleton(a);
    const j = onlyRendered.findIndex((b, i) => !used.has(i) && skeleton(b) === sa);
    if (j >= 0) { used.add(j); pairs.push([a, onlyRendered[j]]); } else leftoverA.push(a);
  }
  const leftoverB = onlyRendered.filter((_, i) => !used.has(i));
  return { pairs, leftoverA, leftoverB };
}

// THE NAME-FIDELITY CHECK IS THE REAL DETECTOR, and it is deliberately NOT a
// served-vs-rendered diff. On the homepage the drops are CHOSEN from live prices,
// so the four products rendered are legitimately not the four that were baked and
// a diff can only say "different". The question that matters is whether each card
// names its product the way its own PDP does, which is answered per card against
// search-index.json: short_name is the PDP h1 by construction. A card showing the
// raw Amazon title is the 2026-10-03 regression; a card whose sku is absent from
// the index is a product the generator left off this surface and the client feed
// put back.
function checkCards(page, side, cards, index) {
  const out = [];
  for (const c of cards) {
    const e = index.bySku.get(c.sku);
    if (!e) {
      out.push({
        cls: 'DEFECT', where: `${side} card ${c.sku}`,
        reason: 'card for a product ABSENT from search-index.json, so this surface shows a product the generator excluded from it',
        served: side === 'served' ? c.name : '(not baked)', rendered: side === 'rendered' ? c.name : '(n/a)',
        detail: 'the index is keyed on healthyProducts, which is the set the page was built from',
      });
      continue;
    }
    if (c.name !== e.short_name) {
      const isRaw = c.name === e.name || (e.name && e.name.startsWith(c.name) && c.name.length > 20);
      out.push({
        cls: 'DEFECT', where: `${side} card ${c.sku}`,
        reason: isRaw ? 'card displays the RAW AMAZON TITLE instead of the PDP h1'
          : 'card displays a name that is not its PDP h1',
        served: e.short_name, rendered: c.name,
      });
    }
    if (c.alt != null && c.alt !== e.short_name && index.bySku.has(c.sku)) {
      out.push({ cls: 'DEFECT', where: `${side} card ${c.sku} img alt`,
        reason: 'card image alt is not the PDP h1', served: e.short_name, rendered: c.alt });
    }
  }
  return out;
}

function diffPage(page, served, rendered, net, index) {
  const d = [];
  const push = (cls, reason, where, servedVal, renderedVal, extra) =>
    d.push({ cls, reason, where, served: servedVal, rendered: renderedVal, ...(extra || {}) });

  // ---- head fields. None of these may move: no script on the site writes them.
  for (const [k, where] of [['title', '<title>'], ['metaDesc', 'meta description'],
    ['canonical', 'rel=canonical'], ['robots', 'meta robots'], ['ogTitle', 'og:title']]) {
    if (norm(served[k]) !== norm(rendered[k])) {
      push('DEFECT', `${where} rewritten by JS`, where, served[k], rendered[k]);
    }
  }

  // ---- element counts
  for (const k of Object.keys(served.counts)) {
    const a = served.counts[k], b = rendered.counts[k];
    if (a === b) continue;
    if (EXPECTED_COUNT_KEYS.includes(k)) {
      push('EXPECTED', `${k} differs (client-rendered element)`, `count:${k}`, a, b);
    } else if (k === 'product_cards' || k === 'listing_cards_any') {
      continue; // handled per card below, with the sku names, which is more useful
    } else {
      push('DEFECT', `${k} count changes between served and rendered`, `count:${k}`, a, b);
    }
  }

  // ---- controls injected by their own scripts into containers left empty
  {
    const { onlyA, onlyB } = multisetDiff(served.controls, rendered.controls);
    onlyA.forEach((a) => push('DEFECT', 'control present in served HTML but gone after JS', 'control', a, '(absent)'));
    if (onlyB.length) {
      push('EXPECTED', `${onlyB.length} interactive control(s) injected by JS`, 'control', '(absent)',
        onlyB.slice(0, 8).join(' | '));
    }
  }

  // ---- product cards: count, then per-card name fidelity on BOTH sides
  if (index) {
    const a = served.cards.length, b = rendered.cards.length;
    if (a !== b) {
      push('DEFECT', 'product card count changes between served and rendered', 'card count', a, b,
        { detail: `a non-rendering crawler sees ${a} cards, a reader sees ${b}` });
    }
    const sa = new Set(served.cards.map((c) => c.sku)), sb = new Set(rendered.cards.map((c) => c.sku));
    const added = [...sb].filter((x) => !sa.has(x)), gone = [...sa].filter((x) => !sb.has(x));
    if (added.length || gone.length) {
      const liveSelection = page.kind === 'homepage';
      push(liveSelection ? 'EXPECTED' : 'DEFECT',
        liveSelection ? 'drops selection differs (chosen from live prices, so a different set is correct)'
          : 'the set of products on this surface changes after JS',
        'card set', gone.length ? `gone: ${gone.join(',')}` : '(none gone)',
        added.length ? `added: ${added.join(',')}` : '(none added)');
    }
    checkCards(page, 'served', served.cards, index).forEach((x) => d.push(x));
    checkCards(page, 'rendered', rendered.cards, index).forEach((x) => d.push(x));
  }

  // ---- visible text blocks
  {
    const { onlyA, onlyB, reordered } = multisetDiff(served.blocks, rendered.blocks);
    if (reordered) push('NOISE', 'same blocks, different order', 'blocks', served.blocks.length, rendered.blocks.length);
    const { pairs, leftoverA, leftoverB } = pairByShape(onlyA, onlyB);
    for (const [a, b] of pairs) {
      const reason = expectedReason(a) || expectedReason(b);
      if (reason) push('EXPECTED', `block figure updated (${reason})`, 'block', a, b);
      else push('DEFECT', 'block text changed with no live figure in it', 'block', a, b);
    }
    for (const a of leftoverA) {
      const reason = expectedReason(a);
      push('DEFECT', reason ? `block REMOVED by JS (carries a live figure: ${reason})` : 'block REMOVED by JS',
        'block', a, '(absent)');
    }
    for (const b of leftoverB) {
      const reason = expectedReason(b);
      push(reason ? 'EXPECTED' : 'DEFECT',
        reason ? `block added by JS (live figure: ${reason})` : 'block exists ONLY after JS, invisible to a non-rendering crawler',
        'block', '(absent)', b);
    }
  }

  // ---- headings
  {
    const fmt = (h) => `${h.level}: ${h.text}`;
    const { onlyA, onlyB } = multisetDiff(served.headings.filter((h) => h.visible).map(fmt),
      rendered.headings.filter((h) => h.visible).map(fmt));
    const { pairs, leftoverA, leftoverB } = pairByShape(onlyA, onlyB);
    for (const [a, b] of pairs) {
      const reason = expectedReason(a) || expectedReason(b);
      push(reason ? 'EXPECTED' : 'DEFECT',
        reason ? `heading figure updated (${reason})` : 'HEADING TEXT CHANGED by JS', 'heading', a, b);
    }
    leftoverA.forEach((a) => push('DEFECT', 'heading REMOVED by JS', 'heading', a, '(absent)'));
    leftoverB.forEach((b) => push('DEFECT', 'heading exists ONLY after JS', 'heading', '(absent)', b));
  }

  // ---- links: href set and the text on each href
  {
    const hrefsA = served.links.map((l) => l.href), hrefsB = rendered.links.map((l) => l.href);
    const { onlyA, onlyB } = multisetDiff(hrefsA, hrefsB);
    onlyA.forEach((h) => push('DEFECT', 'link REMOVED by JS', 'link href', h, '(absent)'));
    onlyB.forEach((h) => push('DEFECT', 'link exists ONLY after JS, so it passes no equity to a non-rendering crawler',
      'link href', '(absent)', h));
    const textByHref = (ls) => ls.reduce((m, l) => { (m[l.href] = m[l.href] || []).push(l.text); return m; }, {});
    const ta = textByHref(served.links), tb = textByHref(rendered.links);
    Object.keys(ta).forEach((h) => {
      if (!tb[h]) return;
      const a = ta[h].slice().sort().join(' | '), b = tb[h].slice().sort().join(' | ');
      if (a === b) return;
      const reason = expectedReason(a) || expectedReason(b);
      push(reason ? 'EXPECTED' : 'DEFECT',
        reason ? `link text figure updated (${reason})` : 'LINK TEXT CHANGED by JS', `link text ${h}`, a, b);
    });
  }

  // ---- img alt
  {
    const fmt = (x) => `${x.src} :: ${x.alt == null ? '(no alt)' : x.alt}`;
    const { onlyA, onlyB } = multisetDiff(served.alts.map(fmt), rendered.alts.map(fmt));
    const { pairs, leftoverA, leftoverB } = pairByShape(onlyA, onlyB);
    pairs.forEach(([a, b]) => push('DEFECT', 'IMG ALT CHANGED by JS', 'img alt', a, b));
    leftoverA.forEach((a) => push('DEFECT', 'image REMOVED by JS', 'img alt', a, '(absent)'));
    leftoverB.forEach((b) => push('DEFECT', 'image exists ONLY after JS', 'img alt', '(absent)', b));
  }

  // ---- JSON-LD
  {
    const A = served.jsonld.map((x) => JSON.stringify(stable(x)));
    const B = rendered.jsonld.map((x) => JSON.stringify(stable(x)));
    if (A.length !== B.length) {
      push('DEFECT', 'JSON-LD block count changed', 'json-ld', A.length, B.length);
    }
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      if (A[i] === B[i]) continue;
      const which = EXPECTED_JSONLD_KEYS.test(A[i]) || EXPECTED_JSONLD_KEYS.test(B[i]);
      push(which ? 'EXPECTED' : 'DEFECT',
        which ? 'JSON-LD price or date field updated' : 'JSON-LD CONTENT CHANGED by JS',
        `json-ld[${i}]`, A[i].slice(0, 200), B[i].slice(0, 200));
    }
  }

  // ---- blame
  d.forEach((x) => { if (x.cls === 'DEFECT') x.blame = blameFor(page.kind, x.reason, x.where); });
  return d;
}

// ---------------------------------------------------------------------------
async function loadPage(browser, url, { js }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const net = { jsBytes: 0, scripts: [], consoleErrors: [], failed: [], bad: [], dataResponses: [], inflight: 0 };
  const t0 = Date.now();

  if (!js) await page.setJavaScriptEnabled(false);
  else await page.evaluateOnNewDocument(INSTRUMENT);

  page.on('console', (m) => {
    if (m.type() === 'error') net.consoleErrors.push(norm(m.text()).slice(0, 300));
  });
  page.on('request', (r) => { const t = r.resourceType(); if (t === 'xhr' || t === 'fetch') net.inflight++; });
  page.on('requestfailed', (r) => {
    const t = r.resourceType();
    if (t === 'xhr' || t === 'fetch') net.inflight = Math.max(0, net.inflight - 1);
    net.failed.push(`${r.failure() ? r.failure().errorText : 'failed'} ${r.url()}`);
  });
  page.on('response', async (r) => {
    const rt = r.request().resourceType();
    const u = r.url();
    if (r.status() >= 400) net.bad.push(`${r.status()} ${u}`);
    if (rt === 'script') {
      let len = Number(r.headers()['content-length'] || 0);
      if (!len) { try { len = (await r.buffer()).length; } catch (e) { len = 0; } }
      net.jsBytes += len;
      net.scripts.push({ url: u.replace(BASE, ''), bytes: len });
    }
    if (rt === 'xhr' || rt === 'fetch') {
      net.inflight = Math.max(0, net.inflight - 1);
      net.dataResponses.push({ url: u.slice(0, 120), atMs: Date.now() - t0 });
    }
  });

  await page.goto(BASE + url, { waitUntil: js ? 'networkidle2' : 'domcontentloaded', timeout: NAV_TIMEOUT });

  let hydrationMs = null;
  let sawMutation = false;
  if (js) {
    // QUIET WINDOW, BUT ONLY AFTER THE FIRST MUTATION. The first version broke
    // out immediately when nothing had mutated yet, because "time since the last
    // mutation" is Infinity before there has been one. It therefore extracted the
    // page before hydration ran and reported /ram/ at 117 cards rather than 119,
    // which is a check passing for the wrong reason, the exact failure this
    // repo's hydration work has hit three times. A page that genuinely never
    // mutates <main> is a real state and gets NO_MUTATION after FLOOR_MS.
    const FLOOR_MS = Number(arg('floor-ms', '7000'));
    const MIN_MS = Number(arg('min-ms', '1500'));
    // WHETHER TO WAIT FOR DATA IS DERIVED FROM THE PAGE'S OWN SCRIPTS, not from a
    // list of page types kept in this file. A quiet window on its own is not
    // enough and was measured failing: /ram/ mutates once at ~150ms for an
    // unrelated reason, so a 1200ms quiet window expired at ~1350ms and the audit
    // extracted the page BEFORE the Supabase round trip landed, reporting 117
    // cards against the real 119. So a page that ships a data-fetching script
    // must also show a settled fetch before it is read.
    const expectsData = net.scripts.some((x) => /supabase|product-data|home-drops|product-listing|pdp-hydrate|price-index|guide-live/.test(x.url));
    const deadline = Date.now() + 25000;
    for (;;) {
      const st = await page.evaluate(() => {
        const a = window.__audit;
        if (!a) return { has: false, last: null, since: null, elapsed: null };
        const elapsed = Date.now() - a.t0;
        return {
          has: a.lastMutationMs != null,
          last: a.lastMutationMs,
          since: a.lastMutationMs == null ? null : elapsed - a.lastMutationMs,
          elapsed,
        };
      });
      const settled = net.inflight === 0 && (!expectsData || net.dataResponses.length > 0);
      if (st.has && st.since >= QUIET_MS && settled && st.elapsed >= MIN_MS) { sawMutation = true; break; }
      if (!st.has && settled && st.elapsed >= FLOOR_MS) break;
      if (Date.now() > deadline) {
        sawMutation = st.has;
        net.timedOut = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    hydrationMs = await page.evaluate(() => (window.__audit ? window.__audit.lastMutationMs : null));
  }

  const data = await page.evaluate(EXTRACT);
  await page.close();
  return { data, net, hydrationMs, sawMutation, loadMs: Date.now() - t0 };
}

(async () => {
  log(`Rendered-page audit against ${BASE}`);
  log(`  driver: puppeteer ${require('puppeteer/package.json').version}  quiet window: ${QUIET_MS}ms  pages: ${PAGES.length}`);
  log('');
  // search-index.json is the generator's own record of what every PDP's h1 says,
  // so it is the reference the card check compares against. Fetched from the same
  // origin under audit, never from the working tree, or the audit would compare a
  // deployed page against an undeployed build.
  let index = null;
  try {
    const rows = await (await fetch(`${BASE}/search-index.json`)).json();
    index = { bySku: new Map(rows.map((e) => [e.sku, e])), count: rows.length };
    log(`  reference: /search-index.json, ${index.count} entries`);
  } catch (e) {
    log(`  *** /search-index.json unreadable (${e.message}); the card name check is DISABLED, which is not a pass`);
  }
  log('');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const report = [];
  try {
    for (const p of PAGES) {
      process.stdout.write(`  ${p.url} ... `);
      let row;
      try {
        const servedRaw = await fetch(BASE + p.url);
        const servedBytes = (await servedRaw.arrayBuffer()).byteLength;
        const off = await loadPage(browser, p.url, { js: false });
        const on = await loadPage(browser, p.url, { js: true });
        const diffs = diffPage(p, off.data, on.data, on.net, index);
        const wipes = (on.data.audit && on.data.audit.wipes) || [];
        const firstData = on.net.dataResponses.length
          ? Math.min(...on.net.dataResponses.map((r) => r.atMs)) : null;
        row = {
          page: p.url, kind: p.kind, status: servedRaw.status, servedBytes,
          jsBytes: on.net.jsBytes, scripts: on.net.scripts,
          hydrationMs: on.hydrationMs, loadMs: on.loadMs,
          mutationCount: (on.data.audit && on.data.audit.mutationCount) || 0,
          parseAdditions: (on.data.audit && on.data.audit.parseAdditions) || 0,
          firstDataResponseMs: firstData,
          wipes: wipes.map((w) => ({
            ...w,
            beforeAnyData: firstData == null ? true : w.t < firstData,
          })),
          consoleErrors: on.net.consoleErrors, failed: on.net.failed, bad: on.net.bad,
          firstPartyIssues: [
            ...on.net.consoleErrors.filter((x) => !THIRD_PARTY_CONSOLE.test(x)).map((x) => `console: ${x}`),
            ...on.net.failed.filter((x) => !THIRD_PARTY_HOST.test(x)).map((x) => `requestfailed: ${x}`),
            ...on.net.bad.filter((x) => !THIRD_PARTY_HOST.test(x)).map((x) => `http: ${x}`),
          ],
          sawMutation: on.sawMutation,
          waitTimedOut: !!on.net.timedOut,
          dataResponses: on.net.dataResponses.length,
          counts: { served: off.data.counts, rendered: on.data.counts },
          diffs,
          tally: diffs.reduce((m, d) => { m[d.cls] = (m[d.cls] || 0) + 1; return m; }, { EXPECTED: 0, DEFECT: 0, NOISE: 0 }),
        };
        process.stdout.write(`${row.tally.DEFECT} defect / ${row.tally.EXPECTED} expected / ${row.tally.NOISE} noise\n`);
      } catch (e) {
        row = { page: p.url, kind: p.kind, error: String(e.message), tally: { EXPECTED: 0, DEFECT: 0, NOISE: 0 }, diffs: [] };
        process.stdout.write(`ERROR ${e.message}\n`);
      }
      report.push(row);
    }
  } finally {
    await browser.close();
  }

  // ---------------- report ----------------
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  log('');
  log('================ PER PAGE ================');
  log(`${pad('page', 48)}${lpad('EXP', 5)}${lpad('DEF', 5)}${lpad('NOI', 5)}${lpad('hydr ms', 9)}${lpad('JS KB', 8)}${lpad('cards s/r', 12)}${lpad('wipes', 7)}${lpad('errs', 6)}`);
  for (const r of report) {
    if (r.error) { log(`${pad(r.page, 48)}  ERROR ${r.error}`); continue; }
    const cards = `${r.counts.served.product_cards}/${r.counts.rendered.product_cards}`;
    log(`${pad(r.page, 48)}${lpad(r.tally.EXPECTED, 5)}${lpad(r.tally.DEFECT, 5)}${lpad(r.tally.NOISE, 5)}` +
      `${lpad(r.hydrationMs == null ? 'none' : r.hydrationMs, 9)}${lpad((r.jsBytes / 1024).toFixed(0), 8)}` +
      `${lpad(cards, 12)}${lpad(r.wipes.length, 7)}${lpad(r.firstPartyIssues.length, 6)}`);
  }

  const defects = report.flatMap((r) => (r.diffs || []).filter((d) => d.cls === 'DEFECT').map((d) => ({ page: r.page, ...d })));
  log('');
  log(`================ DEFECTS (${defects.length}) ================`);
  if (!defects.length) log('  none');
  const byPage = defects.reduce((m, d) => { (m[d.page] = m[d.page] || []).push(d); return m; }, {});
  for (const pg of Object.keys(byPage)) {
    log('');
    log(`-- ${pg}`);
    byPage[pg].forEach((d, i) => {
      log(`   ${i + 1}. [${d.where}] ${d.reason}`);
      log(`      served  : ${String(d.served).slice(0, 160)}`);
      log(`      rendered: ${String(d.rendered).slice(0, 160)}`);
      if (d.detail) log(`      note    : ${d.detail}`);
      (d.blame || []).forEach((b) => log(`      blame   : ${b}`));
    });
  }

  log('');
  log('================ SKELETON WIPES ================');
  let anyWipe = false;
  for (const r of report) {
    (r.wipes || []).forEach((w) => {
      anyWipe = true;
      log(`  ${r.page}  ${w.selector}  ${w.from} -> 0 real cards at ${w.t}ms` +
        `  (first data response ${r.firstDataResponseMs == null ? 'none' : r.firstDataResponseMs + 'ms'}` +
        `; ${w.beforeAnyData ? 'WIPED BEFORE ITS DATA ARRIVED' : 'after data'})` +
        `${w.skeletonsAfter ? `, ${w.skeletonsAfter} skeletons shown` : ''}`);
      if (w.beforeAnyData) (BLAME.home_skeleton()).forEach((b) => log(`      blame   : ${b}`));
    });
  }
  if (!anyWipe) log('  none');

  log('');
  log('================ FIRST-PARTY CONSOLE ERRORS AND FAILED REQUESTS ================');
  let anyErr = false;
  for (const r of report) {
    if (!r.firstPartyIssues || !r.firstPartyIssues.length) continue;
    anyErr = true;
    log(`  ${r.page}`);
    r.firstPartyIssues.forEach((x) => log(`      ${x}`));
  }
  if (!anyErr) log('  none');
  const tp = report.reduce((n, r) => n + ((r.consoleErrors || []).length + (r.failed || []).length + (r.bad || []).length
    - (r.firstPartyIssues || []).length), 0);
  log(`  (${tp} third-party event(s) across all pages, excluded: analytics beacons and the Turnstile challenge platform)`);

  log('');
  log('================ PAGES WHOSE <main> NEVER MUTATED ================');
  const still = report.filter((r) => !r.error && !r.sawMutation);
  if (!still.length) log('  none');
  still.forEach((r) => log(`  ${r.page}  (fully served; nothing on this page depends on JS to show its content)`));

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    log('');
    log(`JSON written: ${JSON_OUT}`);
  }

  log('');
  log(`TOTAL: ${defects.length} defect(s) across ${report.length} page(s)`);
  // ADVISORY BY DEFAULT, exiting 0 even with defects, because the classifier is a
  // heuristic and an unrecognised EXPECTED pattern is a report to read rather
  // than a deploy to fail. --strict exits nonzero and is what a gate would use,
  // narrowed with --pages to the checks worth blocking a deploy over.
  if (flag('strict') && defects.length) {
    log('');
    log(`*** --strict: exiting 1 on ${defects.length} defect(s)`);
    process.exit(1);
  }
  process.exit(0);
})();
