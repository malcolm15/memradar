// Post-deploy smoke test. Samples live URLs from the DEPLOYED sitemap and
// asserts each returns 200.
//
// DELIBERATELY EXTERNAL to the generator. Preflight and the parity checks both
// run inside the generator's own process and share its assumptions: if the
// generator is confidently wrong, they are confidently wrong with it. This
// only trusts what the public internet actually serves, so it catches a class
// the in-process checks structurally cannot (a deploy that did not publish, a
// path/rewrite regression, a CDN serving 404s for pages that exist in git).
//
// Usage: node scripts/smoke-test-live.js [--base https://memradar.com]
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').replace('--base=', '') || 'https://memradar.com';
const TIMEOUT_MS = 20000;
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Some CDNs treat HEAD differently from GET, so test what readers get.
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    return { status: res.status, ok: res.ok };
  } catch (e) {
    return { status: 0, ok: false, error: e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function run() {
  log(`Smoke test against ${BASE}`);
  const sm = await fetch(`${BASE}/sitemap.xml`);
  if (!sm.ok) throw new Error(`sitemap.xml returned ${sm.status}`);
  const xml = await sm.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length < 50) throw new Error(`sitemap has only ${locs.length} URLs - suspiciously small`);

  // Always check the pages whose breakage would matter most, then sample the
  // long tail so a systemic PDP failure surfaces without fetching 235 pages.
  const pin = (pred) => locs.find(pred);
  const mustCheck = [
    `${BASE}/`,
    pin((u) => /\/price-index\/$/.test(u)),
    pin((u) => /\/guides\/$/.test(u)),
    pin((u) => /\/guides\/should-i-buy-ram-now\/$/.test(u)),
    pin((u) => /\/guides\/should-i-buy-an-ssd-now\/$/.test(u)),
    pin((u) => /\/ram\/$/.test(u)),
    pin((u) => /\/ssd\/$/.test(u)),
  ].filter(Boolean);

  const pdps = locs.filter((u) => /\/(ram|ssd)\/[^/]+\/$/.test(u));
  // Deterministic spread (first, middle, last) rather than random: a flaky
  // sample makes a red run hard to reproduce.
  const sampled = pdps.length
    ? [...new Set([pdps[0], pdps[Math.floor(pdps.length / 2)], pdps[pdps.length - 1]])]
    : [];
  const urls = [...new Set([...mustCheck, ...sampled])];
  log(`Checking ${urls.length} URLs (${mustCheck.length} pinned, ${sampled.length} sampled from ${pdps.length} PDPs)`);

  const results = [];
  for (const u of urls) {
    const r = await get(u);
    results.push({ url: u, ...r });
    log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.status || '---'} ${u}${r.error ? ` (${r.error})` : ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log('SUMMARY ' + JSON.stringify({
    base: BASE, checked: results.length, failed: failed.length,
    failures: failed.map((f) => ({ url: f.url, status: f.status, error: f.error || null })),
  }));
  if (failed.length) throw new Error(`${failed.length} of ${results.length} live URLs did not return 200`);
  log('Smoke test passed.');
}

run().catch((err) => {
  console.error(`[${new Date().toISOString()}] SMOKE TEST FAILED: ${err.message}`);
  process.exit(1);
});
