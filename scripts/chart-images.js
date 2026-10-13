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

// ------------------------------------------------- the paired-change chart
// Plots the Price Index's frozen monthly records: the median same-product price
// change against the same month a year earlier, one line per segment, with the
// number of products paired each month as bars beneath and a dotted reference
// at the n = 20 caution line (the same statistic the record headline states).
//
// ONE BUILDER FOR BOTH USES. The generator inlines the string into
// /price-index/ (no JS, and it inherits the page's font stack, so the CI-only
// font rule above does not apply) and chartPng() can rasterise the identical
// string, so an image and the inline chart cannot disagree. Colours ride as
// presentation attributes, so a CSS-less render is correct, AND as pim- classes,
// so the page stylesheet can restep them for dark mode: a CSS rule beats a
// presentation attribute, which is what makes one SVG serve both themes.
//
// The four hues were validated 2026-10-12 (lightness band, chroma floor, CVD
// separation, normal-vision floor, 3:1 contrast) in both modes; the dark steps
// live in style.css. DDR4 and SATA also carry dash patterns, so the pairs that
// sit closest in value (the three non-DDR5 lines) are not told apart by hue
// alone, and every line ends in a direct label.
const CHANGE_SERIES = [
  { seg: 'ddr5', label: 'DDR5', color: '#3A5BC7', dash: '' },
  { seg: 'ddr4', label: 'DDR4', color: '#C2410C', dash: '10 6' },
  { seg: 'nvme_ssd', label: 'NVMe SSD', color: '#0D9488', dash: '' },
  { seg: 'sata_ssd', label: 'SATA SSD', color: '#7C3AED', dash: '2 6' },
];
const CHANGE_INK = { ink: INK, muted: MUTED, rule: RULE, grid: '#E5E7EB', ref: '#6B7280' };

// Percent ticks spanning negative and positive values: the smallest step from
// the list that keeps the axis at ten intervals or fewer, with zero always a
// tick so the baseline is drawn where the sign changes.
function changeTicks(min, max) {
  const lo0 = Math.min(0, min), hi0 = Math.max(0, max);
  const step = [10, 20, 25, 50, 100, 200, 500].find((s) => (Math.ceil(hi0 / s) - Math.floor(lo0 / s)) <= 10) || 1000;
  const lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  return { lo, hi, step, ticks };
}
const signedPct = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;

// records: object keyed `${seg}|${month}` with { n, median } (percent).
// months: the sorted month list to plot. Returns the SVG and the bounds the
// page heading is written from.
function changeChartSvg({ records, months, refN = 20, idPrefix = 'pim-chart' }) {
  if (!months || months.length < 2) throw new Error('change chart: fewer than two months');
  const series = CHANGE_SERIES.map((s) => ({
    ...s,
    pts: months.map((m) => {
      const r = records[`${s.seg}|${m}`];
      return r ? { m, v: Number(r.median), n: Number(r.n) } : null;
    }).filter(Boolean),
  }));
  if (series.some((s) => s.pts.length < 2)) throw new Error('change chart: a series has under two points');
  const first = months[0];
  const through = months[months.length - 1];
  const vals = series.flatMap((s) => s.pts.map((p) => p.v));
  const ns = series.flatMap((s) => s.pts.map((p) => p.n));
  const { lo, hi, ticks } = changeTicks(Math.min(...vals), Math.max(...vals));
  const nTop = Math.max(refN, Math.ceil(Math.max(...ns) / 20) * 20);

  const W = 1200, H = 620;
  const plot = { l: 84, r: W - 150, t: 70, b: 410 }; // change panel
  const np = { t: 462, b: 556 };                      // n panel
  const slot = (plot.r - plot.l) / months.length;      // a month owns one slot; points sit at slot centres
  const X = (m) => plot.l + slot * (monthIndex(m) - monthIndex(first) + 0.5);
  const Y = (v) => plot.b - ((plot.b - plot.t) * (v - lo)) / (hi - lo);
  const YN = (n) => np.b - ((np.b - np.t) * n) / nTop;
  const tId = `${idPrefix}-title`, dId = `${idPrefix}-desc`;
  const heading = `RAM and SSD price change chart, ${monthLong(first)} to ${monthLong(through)}`;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="pim-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${tId}" aria-describedby="${dId}">`);
  out.push(`<title id="${tId}">${esc(heading)}</title>`);
  out.push(`<desc id="${dId}">Median same-product price change against the same month a year earlier, for ${series.map((s) => s.label).join(', ')}, one line each, with the number of products paired each month as bars and a dotted reference at n equals ${refN}. The table that follows carries every value.</desc>`);
  out.push(`<rect class="pim-surface" width="${W}" height="${H}" fill="#FFFFFF"/>`);
  out.push(`<g font-family="${esc(FONT)}">`);
  // Legend row: a swatch and the label per series, in ink, with the line's
  // dash pattern shown on the swatch so the secondary encoding is explained.
  let lx = plot.l;
  for (const s of series) {
    out.push(`<line class="pim-line pim-c-${s.seg}" x1="${lx}" y1="30" x2="${lx + 34}" y2="30" stroke="${s.color}" stroke-width="3.5" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
    out.push(`<text class="pim-ink" x="${lx + 42}" y="35" font-size="16" font-weight="700" fill="${INK}">${esc(s.label)}</text>`);
    lx += 42 + s.label.length * 10.5 + 34;
  }
  out.push(`<text class="pim-muted" x="${plot.r}" y="35" font-size="15" text-anchor="end" fill="${MUTED}">Median same-product change vs. the same month a year earlier</text>`);
  // Change panel: hairline grid at each tick, the zero line heavier, labels at left.
  for (const v of ticks) {
    const y = f1(Y(v));
    out.push(`<line class="${v === 0 ? 'pim-rule' : 'pim-grid'}" x1="${plot.l}" y1="${y}" x2="${plot.r}" y2="${y}" stroke="${v === 0 ? RULE : CHANGE_INK.grid}" stroke-width="${v === 0 ? 1.5 : 1}"/>`);
    out.push(`<text class="pim-muted" x="${plot.l - 12}" y="${f1(Y(v) + 5)}" font-size="15" text-anchor="end" fill="${MUTED}">${signedPct(v)}</text>`);
  }
  for (const s of series) {
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.m))},${f1(Y(p.v))}`).join('');
    out.push(`<path class="pim-line pim-c-${s.seg}" d="${d}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
  }
  // End markers and direct labels, pushed apart when two series finish within a line of each other.
  const ends = series.map((s) => {
    const last = s.pts[s.pts.length - 1];
    return { s, x: X(last.m), y: Y(last.v), ly: Y(last.v) + 5, text: `${s.label} ${signedPct(last.v)}` };
  }).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 22) ends[i].ly = ends[i - 1].ly + 22;
  for (const e of ends) {
    out.push(`<circle class="pim-dot pim-c-${e.s.seg}" cx="${f1(e.x)}" cy="${f1(e.y)}" r="5" fill="${e.s.color}"/>`);
    out.push(`<text class="pim-ink" x="${plot.r + 14}" y="${f1(e.ly)}" font-size="15" font-weight="700" fill="${INK}">${esc(e.text)}</text>`);
  }
  // n panel: four thin bars per month in series order, a 2px gap between them,
  // a dotted reference at refN, and the panel's own scale at 0 and the top.
  out.push(`<text class="pim-muted" x="${plot.l}" y="${np.t - 12}" font-size="15" font-weight="700" fill="${MUTED}">Products paired each month (n)</text>`);
  const group = Math.min(slot * 0.78, 40);
  const bw = (group - 2 * (series.length - 1)) / series.length;
  for (const m of months) {
    const x0 = X(m) - group / 2;
    series.forEach((s, i) => {
      const p = s.pts.find((q) => q.m === m);
      if (!p) return;
      const x = x0 + i * (bw + 2);
      out.push(`<rect class="pim-bar pim-c-${s.seg}" x="${f1(x)}" y="${f1(YN(p.n))}" width="${f1(bw)}" height="${f1(np.b - YN(p.n))}" fill="${s.color}"/>`);
    });
  }
  out.push(`<line class="pim-rule" x1="${plot.l}" y1="${np.b}" x2="${plot.r}" y2="${np.b}" stroke="${RULE}" stroke-width="1.5"/>`);
  out.push(`<line class="pim-ref" x1="${plot.l}" y1="${f1(YN(refN))}" x2="${plot.r}" y2="${f1(YN(refN))}" stroke="${CHANGE_INK.ref}" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"/>`);
  out.push(`<text class="pim-muted" x="${plot.r + 14}" y="${f1(YN(refN) + 5)}" font-size="14" fill="${MUTED}">n = ${refN}</text>`);
  out.push(`<text class="pim-muted" x="${plot.l - 12}" y="${f1(YN(0) + 5)}" font-size="14" text-anchor="end" fill="${MUTED}">0</text>`);
  out.push(`<text class="pim-muted" x="${plot.l - 12}" y="${f1(YN(nTop) + 5)}" font-size="14" text-anchor="end" fill="${MUTED}">${nTop}</text>`);
  // Month axis under the n panel: a tick per month, a label every third month
  // and always on the last one.
  months.forEach((m, i) => {
    const x = f1(X(m));
    out.push(`<line class="pim-rule" x1="${x}" y1="${np.b}" x2="${x}" y2="${np.b + 6}" stroke="${RULE}" stroke-width="1.5"/>`);
    if (i % 3 === 0 || i === months.length - 1) {
      out.push(`<text class="pim-muted" x="${x}" y="${np.b + 28}" font-size="14" text-anchor="middle" fill="${MUTED}">${monthShort(m)}</text>`);
    }
  });
  out.push('</g></svg>');
  // THE NARROW-SCREEN AXIS. Under 760 px the page scrolls the chart sideways
  // and opens it at the newest months, which puts the SVG's own y labels off
  // screen. This is the same tick scale as positions in the SVG's own
  // coordinate space (percent of its height), rendered by the page as a
  // sticky column beside the scrolling SVG. One scale, two renderings.
  const axis = [];
  for (const v of ticks) axis.push(`<span style="top:${(Y(v) / H * 100).toFixed(2)}%">${signedPct(v)}</span>`);
  axis.push(`<span style="top:${(YN(0) / H * 100).toFixed(2)}%">0</span>`);
  axis.push(`<span style="top:${(YN(nTop) / H * 100).toFixed(2)}%">${nTop}</span>`);
  return { svg: out.join('\n'), axis: axis.join(''), first, through, heading, series: series.map((s) => ({ seg: s.seg, label: s.label, color: s.color })) };
}

module.exports = { CHARTS, CHANGE_SERIES, chartSvg, changeChartSvg, chartPng, writeChartImages, chartIndex, monthLong };
