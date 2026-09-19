// Downloadable chart images for journalists, served from /data/charts/.
//
// Drawn from the monthly CSV's rows (buildMonthlyCsv), so a chart can never
// disagree with the file a reader downloads beside it. SVG built here, rasterised
// with sharp (a production dependency for exactly this reason).
//
// ATTRIBUTION IS IN THE PIXELS. "memradar.com" and the data-through month sit in
// the bottom-right corner of every image. A caption gets stripped when an image
// is republished; the mark does not. Do not move it into alt text or a caption.
//
// FILES. <slug>-<YYYY-MM>.png is written ONCE and never rewritten: an image that
// changes under a published article makes the writer's text disagree with their
// chart. <slug>-latest.png is a byte copy of the newest dated file, so it too
// changes only when a new month completes. Dated files accumulate, by design.
//
// FONTS. Rendered on the Ubuntu runner in Liberation Sans (a Helvetica/Arial
// metric clone, verified there 2026-09-18 by a CI probe: no fallback boxes).
// A Mac renders the same SVG in Arial, so NEW dated files are only written in
// CI (GITHUB_ACTIONS) unless --render-charts is passed; otherwise a local
// --confirm run on the 1st of a month would publish a permanent file in the
// wrong face.
const fs = require('fs');
const path = require('path');

const W = 1200;
const H = 675;
const FONT = "'Liberation Sans', Arial, Helvetica, sans-serif";
const COBALT = '#3A5BC7';
const INK = '#111827';
const MUTED = '#4B5563';
const RULE = '#9CA3AF';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// RAM is charted as $/GB: its capacity spread is small (1.03x DDR5, 1.15x DDR4,
// cheapest vs dearest capacity per GB, September 2026), so $/GB removes the mix
// artifact. SSDs are charted as median price per drive: their $/GB still moves
// with capacity mix (1.40x NVMe, 3.49x SATA), and SATA's $/GB is the noisier
// series of the two.
const CHARTS = [
  { slug: 'ddr5', title: 'DDR5 memory: median price per GB', measure: 'perGb', series: [{ seg: 'ddr5', label: 'DDR5', color: COBALT }] },
  { slug: 'ddr4', title: 'DDR4 memory: median price per GB', measure: 'perGb', series: [{ seg: 'ddr4', label: 'DDR4', color: COBALT }] },
  { slug: 'nvme', title: 'NVMe SSDs: median price per drive', measure: 'price', series: [{ seg: 'nvme_ssd', label: 'NVMe', color: COBALT }] },
  { slug: 'sata', title: 'SATA SSDs: median price per drive', measure: 'price', series: [{ seg: 'sata_ssd', label: 'SATA', color: COBALT }] },
  { slug: 'ddr4-ddr5', title: 'DDR4 and DDR5 memory: median price per GB', measure: 'perGb', series: [
    { seg: 'ddr5', label: 'DDR5', color: COBALT },
    { seg: 'ddr4', label: 'DDR4', color: RULE, textColor: MUTED },
  ] },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f1 = (n) => n.toFixed(1);
const monthLong = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const monthShort = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(0, 4)}`;
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

// Ticks from zero: these are levels, and a truncated axis would exaggerate them.
function niceTicks(max) {
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // No 2.5 step: "$7.5" reads as a typo for a price.
  const step = [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(+v.toFixed(6));
  return { ticks, top: ticks[ticks.length - 1], step };
}

// rows: [segment, month, median_price_usd, median_usd_per_gb, product_count]
function chartSvg(spec, rows) {
  const col = spec.measure === 'perGb' ? 3 : 2;
  const lines = spec.series.map((s) => ({ ...s, pts: rows.filter((r) => r[0] === s.seg && r[col] !== '').map((r) => ({ m: r[1], v: Number(r[col]) })) }));
  if (lines.some((l) => l.pts.length < 12)) throw new Error(`chart ${spec.slug}: a series has under 12 months`);
  const first = lines.map((l) => l.pts[0].m).sort()[0];
  const through = lines.map((l) => l.pts[l.pts.length - 1].m).sort().pop();
  const { ticks, top, step } = niceTicks(Math.max(...lines.flatMap((l) => l.pts.map((p) => p.v))));
  const direct = lines.length > 1; // direct end labels instead of a legend
  const plot = { l: 96, r: W - (direct ? 118 : 56), t: 150, b: H - 104 };
  const i0 = monthIndex(first);
  const span = monthIndex(through) - i0;
  const X = (m) => plot.l + ((plot.r - plot.l) * (monthIndex(m) - i0)) / span;
  const Y = (v) => plot.b - ((plot.b - plot.t) * v) / top;
  const money = (v) => (step < 1 ? `$${v.toFixed(2)}` : `$${v.toLocaleString('en-US')}`);
  const unit = spec.measure === 'perGb' ? 'US dollars per GB' : 'US dollars per drive';

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`);
  out.push(`<g font-family="${esc(FONT)}">`);
  out.push(`<text x="56" y="70" font-size="34" font-weight="700" fill="${INK}">${esc(spec.title)}</text>`);
  // Y axis: the unit label sits above the tick labels, horizontal, so it reads without tilting a head.
  out.push(`<text x="56" y="${plot.t - 26}" font-size="16" font-weight="700" fill="${MUTED}">${unit}</text>`);
  for (const v of ticks) {
    out.push(`<text x="${plot.l - 14}" y="${f1(Y(v) + 6)}" font-size="16" text-anchor="end" fill="${MUTED}">${money(v)}</text>`);
  }
  out.push(`<line x1="${plot.l}" y1="${plot.t - 6}" x2="${plot.l}" y2="${plot.b}" stroke="${RULE}" stroke-width="1.5"/>`);
  out.push(`<line x1="${plot.l}" y1="${plot.b}" x2="${plot.r}" y2="${plot.b}" stroke="${RULE}" stroke-width="1.5"/>`);
  for (const v of ticks) out.push(`<line x1="${plot.l - 6}" y1="${f1(Y(v))}" x2="${plot.l}" y2="${f1(Y(v))}" stroke="${RULE}" stroke-width="1.5"/>`);
  // X axis: a tick at each January, labelled with its year.
  for (let y = Number(first.slice(0, 4)) + (first.endsWith('-01') ? 0 : 1); `${y}-01` <= through; y++) {
    const x = X(`${y}-01`);
    out.push(`<line x1="${f1(x)}" y1="${plot.b}" x2="${f1(x)}" y2="${plot.b + 6}" stroke="${RULE}" stroke-width="1.5"/>`);
    out.push(`<text x="${f1(x)}" y="${plot.b + 28}" font-size="16" text-anchor="middle" fill="${MUTED}">${y}</text>`);
  }
  for (const l of lines) {
    const d = l.pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.m))},${f1(Y(p.v))}`).join('');
    out.push(`<path d="${d}" fill="none" stroke="${l.color}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  if (direct) {
    // End labels, pushed apart if two series finish within a line of each other.
    const ends = lines.map((l) => ({ l, y: Y(l.pts[l.pts.length - 1].v) + 6 })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 22) ends[i].y = ends[i - 1].y + 22;
    for (const e of ends) out.push(`<text x="${plot.r + 12}" y="${f1(e.y)}" font-size="18" font-weight="700" fill="${e.l.textColor || e.l.color}">${e.l.label}</text>`);
  }
  // Footer: source line left, attribution mark right. The mark is the part
  // that survives a stripped caption, so it is the larger and darker of the two.
  out.push(`<text x="56" y="${H - 34}" font-size="16" fill="${MUTED}">Source: MemRadar Memory Price Index, memradar.com/price-index/</text>`);
  out.push(`<text x="${W - 56}" y="${H - 34}" font-size="19" text-anchor="end" fill="${INK}" xml:space="preserve"><tspan font-weight="700">memradar.com</tspan><tspan fill="${MUTED}">  ·  Data through ${monthLong(through)}</tspan></text>`);
  out.push('</g></svg>');
  return { svg: out.join('\n'), through };
}

async function chartPng(svg) {
  const sharp = require('sharp'); // lazy: a missing binary fails this step, not the generator
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

// Writes new dated files (write-once) and syncs each -latest copy to the newest
// dated file. Returns what exists afterwards, for the /data/ page to link.
async function writeChartImages(rows, dir, { allowNew }) {
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const spec of CHARTS) {
    const { svg, through } = chartSvg(spec, rows);
    const dated = path.join(dir, `${spec.slug}-${through}.png`);
    let status = 'kept';
    if (!fs.existsSync(dated)) {
      if (allowNew) {
        fs.writeFileSync(dated, await chartPng(svg));
        status = 'new';
      } else {
        status = 'skipped (new month renders in CI only)';
      }
    }
    const newest = newestDated(dir, spec.slug);
    let latestStatus = 'none';
    if (newest) {
      const latest = path.join(dir, `${spec.slug}-latest.png`);
      const bytes = fs.readFileSync(path.join(dir, newest.file));
      if (fs.existsSync(latest) && fs.readFileSync(latest).equals(bytes)) latestStatus = 'unchanged';
      else { fs.writeFileSync(latest, bytes); latestStatus = 'updated'; }
    }
    results.push({ spec, through, status, latestStatus, newest });
  }
  return results;
}

function newestDated(dir, slug) {
  if (!fs.existsSync(dir)) return null;
  const re = new RegExp(`^${slug}-(\\d{4}-\\d{2})\\.png$`);
  const hits = fs.readdirSync(dir).map((f) => [f, re.exec(f)]).filter(([, m]) => m).map(([f, m]) => ({ file: f, month: m[1] }));
  return hits.sort((a, b) => a.month.localeCompare(b.month)).pop() || null;
}

// What /data/ links: the newest dated file per chart, as found on disk, so a
// failed render still leaves the page pointing at real files.
function chartIndex(dir) {
  return CHARTS.map((spec) => ({ spec, newest: newestDated(dir, spec.slug) })).filter((c) => c.newest);
}

module.exports = { CHARTS, chartSvg, chartPng, writeChartImages, chartIndex, monthLong };
