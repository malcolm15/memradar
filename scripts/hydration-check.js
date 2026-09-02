// Post-deploy HYDRATION check. Loads live pages in headless Chromium,
// deliberately corrupts every element the page's hydration is supposed to
// write, waits, and asserts each one was restored. Exits nonzero if anything
// stays corrupt, which fails the deploy.
//
// WHY THIS EXISTS. Dead hydration and working baked fallbacks are VISUALLY
// IDENTICAL, and "no console errors" proves nothing when the failure mode is a
// module that reads a config node that does not exist yet. That exact class has
// now shipped three times:
//   2026-08-27  /price-index/ and the RAM guide loaded supabase-client.js
//               without the supabase-js bundle, so the client threw on load and
//               nothing hydrated. Found by hand.
//   2026-09-02  pdp-hydrate.js was emitted BEFORE #pdpHydrateConfig, so
//               hydrateCfg silently fell back to {} and every cfg-dependent
//               hydration (buy indicator, value metric, capacity chips, Price
//               Analysis, the R1 honest flag) was inert in production while the
//               raw price still updated. Found by hand.
// Each time the fix was trivial and the detection was not. This automates the
// detection.
//
// THE ENUMERATION IS SELF-DERIVED, NOT HARDCODED. A first pass installs a
// MutationObserver and records every element the page's own hydration writes
// to; the second pass corrupts exactly that set. A hydrated element added in
// future is therefore covered with no change to this file.
//
// The one thing an observer cannot catch on its own is hydration that never
// runs at all: nothing mutates, so there is nothing to corrupt and the check
// would pass vacuously. Two guards close that:
//   1. STRUCTURAL: for every <script type="application/json" id="X"> the page
//      ships, find the local script that reads getElementById('X') and assert
//      the JSON node appears FIRST in document order. This is derived from the
//      page and its own scripts, so it needs no maintenance, and it is exactly
//      the 2026-09-02 bug.
//   2. VACUITY: a page that ships a non-empty hydration config must mutate at
//      least one element. Zero mutations with a populated config is a failure,
//      which is exactly the 2026-08-27 bug.
//
// Usage: node scripts/hydration-check.js [--base=https://memradar.com]
const puppeteer = require('puppeteer');

const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').replace('--base=', '') || 'https://memradar.com';
const SENTINEL = '__MEMRADAR_CORRUPT__';
const HYDRATE_WAIT_MS = 6000; // fetch + render headroom; hydration is network-bound
const NAV_TIMEOUT_MS = 45000;
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// Observe only <main>: hydration targets all live there, and scoping keeps out
// parse-time noise from the theme toggle and the footer-year inline script.
// childList + characterData only, never attributes, because Chart.js resizing a
// canvas is an attribute mutation and is not hydration.
const OBSERVER_SETUP = (sentinel) => {
  window.__hydrated = [];
  window.__ready = false;
  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      let sel = n.tagName.toLowerCase();
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      const sibs = Array.from(n.parentNode ? n.parentNode.children : []).filter((c) => c.tagName === n.tagName);
      if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
      parts.unshift(sel);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  // Third-party widgets render into main but are NOT our hydration. Corrupting
  // Turnstile's injected wrapper would make the deploy depend on Cloudflare's
  // widget rendering identically on two consecutive loads, which is a flaky
  // failure with nothing to teach us. This is the only exclusion, and it is by
  // widget container rather than by element id so it needs no upkeep.
  const THIRD_PARTY = '.cf-turnstile, [data-sitekey], iframe';
  const record = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest('main')) return;
    if (el.closest(THIRD_PARTY)) return;
    // Ignore anything we corrupted ourselves.
    const p = cssPath(el);
    if (p && window.__hydrated.indexOf(p) === -1) window.__hydrated.push(p);
  };
  // Installed SYNCHRONOUSLY at DOMContentLoaded, with no delay. Scripts sit at
  // the end of <body>, so they execute, issue their fetch, and DOMContentLoaded
  // fires before any network response can land: the observer is always in place
  // before hydration writes. An earlier version waited 150ms "to be safe" and
  // silently missed the entire Price Index, whose fetch resolved inside that
  // window. Do not reintroduce a delay here; a check that misses the write is
  // worse than no check, because it reports a page as having no hydration to
  // verify.
  document.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main');
    if (!main) return;
    window.__ready = true;
    new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === 'characterData') record(m.target);
        else m.addedNodes.forEach(record);
        if (m.type === 'childList' && m.addedNodes.length === 0) record(m.target);
      });
    }).observe(main, { childList: true, characterData: true, subtree: true });
  });
};

// Corrupt exactly the elements pass A saw hydrate. Descendants of another
// target are skipped: corrupting a parent detaches them, and a detached element
// can never be "restored", which would be a false failure.
const CORRUPT_SETUP = (paths, sentinel) => {
  document.addEventListener('DOMContentLoaded', () => {
    const els = [];
    paths.forEach((p) => { try { const e = document.querySelector(p); if (e) els.push([p, e]); } catch (_) { /* bad selector */ } });
    const keep = els.filter(([, e]) => !els.some(([, o]) => o !== e && o.contains(e)));
    window.__corrupted = keep.map(([p]) => p);
    keep.forEach(([, e]) => { e.textContent = sentinel; });
  });
};

// Which JSON config nodes exist, and does the script that reads each one come
// after it? Derived from the page and its own local scripts.
async function checkScriptOrder(page, url) {
  const info = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('script[type="application/json"][id]'));
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const order = Array.from(document.querySelectorAll('script'));
    return {
      configs: nodes.map((n) => ({ id: n.id, index: order.indexOf(n), keys: (() => { try { return Object.keys(JSON.parse(n.textContent) || {}).length; } catch (e) { return -1; } })() })),
      scripts: scripts.map((s) => ({ src: s.src, index: order.indexOf(s) })),
    };
  });
  const problems = [];
  for (const s of info.scripts) {
    if (!s.src.startsWith(BASE)) continue; // only our own scripts
    let body = '';
    try { body = await (await fetch(s.src)).text(); } catch (e) { continue; }
    for (const c of info.configs) {
      const reads = body.includes(`getElementById('${c.id}')`) || body.includes(`getElementById("${c.id}")`);
      if (reads && s.index < c.index) {
        problems.push(`${s.src.replace(BASE, '')} reads #${c.id} but is emitted BEFORE it (script @${s.index}, config @${c.index})`);
      }
    }
  }
  return { configs: info.configs, problems };
}

async function checkPage(browser, url) {
  const out = { url, hydrated: [], corrupted: [], stillCorrupt: [], problems: [], configs: [] };

  // ---- pass A: observe what this page's own hydration writes ----
  const a = await browser.newPage();
  await a.evaluateOnNewDocument(OBSERVER_SETUP, SENTINEL);
  await a.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  await new Promise((r) => setTimeout(r, HYDRATE_WAIT_MS));
  const order = await checkScriptOrder(a, url);
  out.problems.push(...order.problems);
  out.configs = order.configs;
  out.hydrated = await a.evaluate(() => window.__hydrated || []);
  await a.close();

  // VACUITY GUARD: a page shipping a populated config must hydrate something.
  const populated = out.configs.filter((c) => c.keys > 0);
  const brokenJson = out.configs.filter((c) => c.keys === -1);
  brokenJson.forEach((c) => out.problems.push(`#${c.id} is not parseable JSON`));
  if (populated.length && out.hydrated.length === 0) {
    out.problems.push(`ships ${populated.length} populated config node(s) (${populated.map((c) => '#' + c.id).join(', ')}) but hydrated NOTHING`);
  }
  if (!out.hydrated.length) return out;

  // ---- pass B: corrupt exactly that set, assert restoration ----
  const b = await browser.newPage();
  await b.evaluateOnNewDocument(CORRUPT_SETUP, out.hydrated, SENTINEL);
  await b.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  await new Promise((r) => setTimeout(r, HYDRATE_WAIT_MS));
  const res = await b.evaluate((sentinel) => {
    const corrupted = window.__corrupted || [];
    return corrupted.map((p) => {
      const e = document.querySelector(p);
      return { path: p, missing: !e, stillCorrupt: !!e && e.textContent.indexOf(sentinel) !== -1 };
    });
  }, SENTINEL);
  await b.close();
  out.corrupted = res.map((r) => r.path);
  out.stillCorrupt = res.filter((r) => r.stillCorrupt || r.missing).map((r) => r.path + (r.missing ? ' (element vanished)' : ''));
  return out;
}

// Deterministic target selection from the DEPLOYED sitemap, so the check tests
// what the internet is actually serving. Among a fixed sample of product pages
// it picks the one with the richest hydration config, which maximises the
// surface under test without hardcoding a slug that could be retired.
async function pickTargets() {
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // Rewrite to BASE so the check can run against a local server or a preview
  // origin: the sitemap always carries absolute production URLs.
  const origin = new URL(BASE).origin;
  const rebase = (u) => u.replace(/^https?:\/\/[^/]+/, origin);
  const products = locs.map(rebase).filter((u) => /\/(ram|ssd)\/[^/]+\/$/.test(u));
  if (!products.length) throw new Error('no product URLs in the live sitemap');
  const sample = [0, 0.25, 0.5, 0.75, 0.99].map((f) => products[Math.floor((products.length - 1) * f)]);
  let best = sample[0], bestKeys = -1;
  for (const u of sample) {
    try {
      const html = await (await fetch(u)).text();
      const m = html.match(/id="pdpHydrateConfig">([\s\S]*?)<\/script>/);
      const keys = m ? Object.keys(JSON.parse(m[1].split('<\\/').join('</'))).length : 0;
      if (keys > bestKeys) { bestKeys = keys; best = u; }
    } catch (e) { /* skip */ }
  }
  const guide = locs.map(rebase).find((u) => /\/guides\/[^/]+\/$/.test(u));
  return [
    { kind: 'PDP', url: best },
    { kind: 'Price Index', url: `${BASE}/price-index/` },
    { kind: 'Guide', url: guide || `${BASE}/guides/should-i-buy-ram-now/` },
  ].filter((t) => t.url);
}

async function run() {
  log(`Hydration check against ${BASE}`);
  const targets = await pickTargets();
  // CI points this at the runner's preinstalled Chrome so the deploy does not
  // pay for a ~150MB Chromium download on every run. Locally it is unset and
  // puppeteer uses its own bundled browser.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  try {
    for (const t of targets) {
      const r = await checkPage(browser, t.url);
      r.kind = t.kind;
      results.push(r);
      log(`${t.kind}: ${t.url.replace(BASE, '')}`);
      log(`   config nodes : ${r.configs.length ? r.configs.map((c) => `#${c.id}(${c.keys} keys)`).join(', ') : 'none'}`);
      log(`   hydrated     : ${r.hydrated.length} element(s)`);
      r.hydrated.forEach((p) => log(`      ${p}`));
      log(`   corrupted    : ${r.corrupted.length} (descendants of another target skipped)`);
      if (r.problems.length) r.problems.forEach((p) => log(`   PROBLEM      : ${p}`));
      if (r.stillCorrupt.length) r.stillCorrupt.forEach((p) => log(`   NOT RESTORED : ${p}`));
      else if (r.corrupted.length) log('   all corrupted elements restored');
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => r.stillCorrupt.length || r.problems.length);
  console.log('SUMMARY ' + JSON.stringify({
    base: BASE,
    pages: results.map((r) => ({
      kind: r.kind, url: r.url.replace(BASE, ''),
      hydrated: r.hydrated.length, corrupted: r.corrupted.length,
      not_restored: r.stillCorrupt.length, problems: r.problems,
    })),
    failed: failed.length,
  }));
  if (failed.length) throw new Error(`${failed.length} of ${results.length} page(s) failed the hydration check`);
  log('Hydration check passed.');
}

run().catch((err) => {
  console.error(`[${new Date().toISOString()}] HYDRATION CHECK FAILED: ${err.message}`);
  process.exit(1);
});
