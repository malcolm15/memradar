// Single-source product-name parsers, extracted verbatim from
// scripts/generate-product-pages.js so the generator and the family-clustering
// scripts share ONE implementation (never write a second parser).
//
// Conventions (battle-tested against the live catalog):
// - Kit-total capacity rule: the capacity BEFORE the first "(" wins, so
//   "32GB (2x16GB)" -> 32; else the largest capacity token anywhere.
// - The capacity regex's (?![\w/]) lookahead excludes TBW endurance ("600TBW")
//   and interface speeds ("6Gb/s").
// - SATA-first SSD classification: "M.2 SATA" drives are SATA-protocol despite
//   the M.2 form factor (matches marketStats.js and the listing filters).
// - Speed parsing bands to 1800-9000 to exclude bandwidth codes (PC5-48000).
//
// frontend/js/product-listing.js keeps a browser-side DUPLICATE of these rules
// (it cannot require this file); keep the two in sync when rules change.

function capTokensGB(str) {
  const caps = []; let m; const re = /(\d+)\s*(gb|tb)(?![\w/])/gi;
  while ((m = re.exec(str))) caps.push(/tb/i.test(m[2]) ? +m[1] * 1024 : +m[1]);
  return caps;
}
function totalCapacityGB(name) {
  const pre = capTokensGB(name.split('(')[0]);
  if (pre.length) return Math.max(...pre);
  const all = capTokensGB(name);
  return all.length ? Math.max(...all) : null;
}
// TWO CAPACITIES, AND THE DIFFERENCE MATTERS ONLY FOR MULTI-UNIT LISTINGS.
// Added 2026-10-06.
//
//   capacity_gb and totalCapacityGB() are the PRODUCT-CLASS capacity, used for
//   identity and grouping: for SSDs this is the capacity of one drive; for RAM
//   kits it is the kit's stated total capacity. offerCapacityGB() is the total
//   storage or memory capacity purchased in the listing, and is the denominator
//   for every price-per-GB calculation. The two differ only when a listing sells
//   more than one unit of the same product.
//
// A listing can sell several of the same drive and Amazon states it as prose
// ("4TB 2 Pack"), which no parser read, so on such a listing every price-per-GB
// site divided the whole offer price by one drive's capacity. Measured on
// B0CXZ153DP: $0.437/GB published against a true $0.218/GB, and the page read as
// the dearest member of its 4TB NVMe M.2 group.
//
// A RAM KIT CAN NEVER BE MULTIPLIED TWICE, AND THAT INVARIANT IS ASSERTED HERE
// RATHER THAN ASSUMED. RAM titles state the kit TOTAL before the parenthesis
// ("32GB (2x16GB)"), and totalCapacityGB already reads that total, so multiplying
// again by a pack count would double a figure that is already complete. Returning
// 1 whenever parseKitConfig matches makes that explicit at the one place a future
// reader would look. No catalogue title today has both a kit config and a pack
// word (measured: 0 of 235), so this costs nothing and guards the next one.
//
// KNOWN GAP, STATED RATHER THAN HIDDEN: a title that states only "2x2TB" with no
// total before a parenthesis would give totalCapacityGB 2048 and unitCount 1, so
// the offer capacity would be half. No such title exists in the catalogue today
// (0 SSD titles match parseKitConfig at all). If one appears, the fix belongs in
// totalCapacityGB, not here.
//
// "Protection Pack", "Value Pack" and similar are service or marketing nouns
// rather than multiplicity, so they are excluded explicitly.
function unitCount(name) {
  const n = String(name || '');
  if (parseKitConfig(n)) return 1;
  if (/\b(protection|cps|value|expansion|software|starter)\s+pack\b/i.test(n)) return 1;
  const m = /\b(\d{1,2})\s*[-\s]?pack\b/i.exec(n) || /\bpack of\s*(\d{1,2})\b/i.exec(n);
  const c = m ? Number(m[1]) : 1;
  return c >= 1 && c <= 12 ? c : 1;
}

// TOTAL CAPACITY PURCHASED IN THE LISTING. This is the denominator for price per
// GB and nothing else. The product class stays totalCapacityGB(): a 2-pack of 4TB
// drives is still a 4TB drive for the spec summary, the peer spec group, the
// per-GB group key and the capacity chips, and calling it 8TB would be a worse
// error than the one being fixed. For RAM the two are always equal, by the
// invariant above.
function offerCapacityGB(name) {
  const per = totalCapacityGB(name);
  return per == null ? null : per * unitCount(name);
}

// THE PRICE-PER-GB ARITHMETIC, in one place so a test has one thing to assert.
// The generator's offerPerGb() and anything else that needs a price per GB call
// this; nothing divides a price by a capacity on its own.
function pricePerGb(price, name) {
  if (price == null) return null;
  const c = offerCapacityGB(name);
  return c ? price / c : null;
}

function capacityLabel(gb) {
  if (gb == null) return null;
  return gb >= 1024 && gb % 1024 === 0 ? (gb / 1024) + 'TB' : gb + 'GB';
}
function parseSpeed(name) {
  const s = []; let m;
  const re = /(\d{4,5})\s*(?:mhz|mt\/s)/gi;
  while ((m = re.exec(name))) s.push(+m[1]);
  const re2 = /ddr[45]-(\d{4,5})/gi;
  while ((m = re2.exec(name))) s.push(+m[1]);
  const ok = s.filter((x) => x >= 1800 && x <= 9000);
  return ok.length ? Math.max(...ok) : null;
}
function ramType(name) {
  if (/ddr5/i.test(name)) return 'DDR5';
  if (/ddr4/i.test(name)) return 'DDR4';
  return null;
}
function ssdType(name) {
  if (/sata|2\.5/i.test(name)) return 'SATA';
  if (/nvme|m\.2/i.test(name)) return 'NVMe';
  return null;
}
function formFactor(name) {
  if (/m\.2/i.test(name)) return 'M.2';
  if (/2\.5/.test(name)) return '2.5"';
  return null;
}
function latency(name) {
  const m = name.match(/\bCL\s?(\d{2})\b/i);
  return m ? 'CL' + m[1] : null;
}

// Kit configuration: "32GB Kit (2x16GB)" → '2x16', "1X16GB" → '1x16' (module
// size GB-normalized). "Single Module"/"Single Stick" counts as 1x{total}
// when total capacity is known. Null when the name states no configuration -
// a 2x8 kit and a 1x16 module are different products to a PC builder even
// though the totals match. Rank markings (1Rx8/2Rx8) never match the pattern.
function parseKitConfig(name) {
  const m = name.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,4})\s*(gb|tb)\b/i);
  if (m) return `${+m[1]}x${/tb/i.test(m[3]) ? +m[2] * 1024 : +m[2]}`;
  if (/\bsingle\s+(module|stick)\b/i.test(name)) {
    const total = totalCapacityGB(name);
    if (total != null) return `1x${total}`;
  }
  return null;
}

// Canonical barcode form: digits only, leading zeros stripped. UPC-A (12) /
// EAN-13 / GTIN-14 encodings of the same barcode differ only by leading-zero
// padding, so they all collapse to one comparable value. Used by the UPC
// fetch (Keepa upcList/eanList/gtinList) and the tier-1.5 Newegg matcher.
const normBarcode = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
// A value that LOOKS like a barcode (Newegg's feed sometimes puts UPCs in
// the MPN column): 10-14 digits, nothing else.
const looksLikeBarcode = (s) => /^\d{10,14}$/.test(String(s || '').trim());


// Short display name: brand + the meaningful prefix of the title (up to the
// first "(" or comma), trimmed at a word boundary. Drives slugs, <title>, and
// the X bot's tweet copy - keep those consumers on THIS function so a naming
// tweak can never make the tweet disagree with the page it links.
function shortName(p) {
  let base = p.name.split('(')[0].split(',')[0].trim();
  if (p.brand && !base.toLowerCase().startsWith(p.brand.toLowerCase().slice(0, 4))) {
    base = p.brand + ' ' + base;
  }
  const words = base.split(/\s+/).slice(0, 8).join(' ');
  let out = words;
  if (out.length > 42) {
    out = out.slice(0, 42);
    out = out.slice(0, out.lastIndexOf(' ')); // word boundary
  }
  return out;
}

// PC[3-5][-\dA-Z]* (was PC[34][-\d]+): the old form missed DDR5 bandwidth codes
// entirely (PC5-38400) and any code with trailing letters (PC4-3200AA, PC4-2666V),
// so 13 of 235 products parsed a bandwidth code as their "part number". Harmless
// while the MPN was only an internal matching hint; not harmless from 2026-09-01,
// when R1 began printing it as a labelled "Part number" spec row. A wrong part
// number is worse than none. Stricter here can only REDUCE false MPN matches in
// match-newegg.js, and matching is human-gated with rulings keyed on sku+neweggSku,
// so no existing accepted offer is disturbed.
const MPN_SPEC_TOKEN = /^(?:\d+X\d+(?:GB|TB)|DDR[45][-\d]*|PC[3-5][-\dA-Z]*|CL\d[\d-]*|\d+(?:GB|TB|MHZ|MTS?)|\d+MT\/S|XMP[\d.]*|EXPO|AMD|INTEL|RGB|NVME|SATA(?:\s?III)?|SSD|M\.2|2280|2242|PCIE[\d.X]*|GEN[\d.X]+|U-?DIMM|SO-?DIMM|RDIMM|QLC|TLC|NAND|\d+V|1\.\d+V|PS5|PC)$/;
function mpnCandidate(t) {
  return /^[A-Z0-9][A-Z0-9\-\/\.]{5,}$/.test(t) && /[A-Z]/.test(t) &&
    ((t.match(/\d/g) || []).length >= 3) && !MPN_SPEC_TOKEN.test(t);
}
function parseMpn(name) {
  const parens = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  for (let i = parens.length - 1; i >= 0; i--) if (mpnCandidate(parens[i])) return parens[i];
  const words = name.replace(/[(),]/g, ' ').trim().split(/\s+/);
  const last = words[words.length - 1];
  const prev = words[words.length - 2] || '';
  if (mpnCandidate(last) && !/^[A-Z]{1,3}$/.test(prev)) return last;
  return null;
}

module.exports = {
  parseMpn,
  shortName,
  capTokensGB,
  totalCapacityGB,
  unitCount,
  offerCapacityGB,
  pricePerGb,
  capacityLabel,
  parseSpeed,
  parseKitConfig,
  normBarcode,
  looksLikeBarcode,
  ramType,
  ssdType,
  formFactor,
  latency,
};

// Self-test: node backend/lib/productParsers.js
if (require.main === module) {
  const assert = require('assert');
  const T = [
    // [title, expected unitCount, expected offerCapacityGB]
    ['MZ-V9P4T0B/AM 990 PRO PCIe 4.0 NVMe M.2 SSD 4TB 2 Pack', 2, 8192],
    ['Samsung 990 PRO 4TB NVMe M.2 2-Pack', 2, 8192],
    ['Samsung 990 PRO 4TB NVMe M.2, Pack of 2', 2, 8192],
    ['MZ-V9P4T0B/AM 990 PRO PCIe 4.0 NVMe M.2 SSD 4TB Bundle with 2 YR CPS Enhanced Protection Pack', 1, 4096],
    ['WD_Black SN850X 4TB NVMe SSD with Heatsink - M.2 2280, Up to 7,300 MB/s Read speeds', 1, 4096],
    ['CORSAIR Vengeance DDR5 RAM 32GB (2x16GB) Up to 6000MHz CL30-36-36-76 1.4V', 1, 32],
    ['FURY Beast 16GB 6000MT/s DDR5 CL30 Desktop Memory | AMD EXPO | Single Module | KF560C30BBE-16', 1, 16],
    ['Samsung 990 PRO 2TB, 3-bit TLC V-NAND, M.2 (2280), NVMe 2.0, 1200TBW, 5 Years Warranty', 1, 2048],
    ['Some Enclosure Adapter With No Capacity At All', 1, null],
  ];
  for (const [name, units, offer] of T) {
    assert.strictEqual(unitCount(name), units, `unitCount: ${name}`);
    assert.strictEqual(offerCapacityGB(name), offer, `offerCapacityGB: ${name}`);
  }
  // A RAM kit can never be multiplied twice, whatever else the title says.
  assert.strictEqual(unitCount('Corsair 32GB (2x16GB) DDR5 ... 2 Pack'), 1);
  assert.strictEqual(offerCapacityGB('Corsair 32GB (2x16GB) DDR5 ... 2 Pack'), 32);
  // THE REGRESSION PROPERTY: for any multi-unit title the offer capacity is
  // exactly the product-class capacity times the unit count. A price-per-GB site
  // that reached for the product-class value would break this.
  for (const [name] of T) {
    const u = unitCount(name);
    if (u > 1) assert.strictEqual(offerCapacityGB(name), totalCapacityGB(name) * u, `property: ${name}`);
    else assert.strictEqual(offerCapacityGB(name), totalCapacityGB(name), `property (single): ${name}`);
  }
  // pricePerGb is the only arithmetic, and it divides by the OFFER capacity.
  assert.strictEqual(pricePerGb(1789.90, 'MZ-V9P4T0B/AM 990 PRO ... SSD 4TB 2 Pack'), 1789.90 / 8192);
  assert.strictEqual(pricePerGb(1789.90, 'Samsung SSD 990 PRO 4TB, PCIe 4.0 M.2 2280'), 1789.90 / 4096);
  assert.strictEqual(pricePerGb(null, 'anything 4TB'), null);
  assert.strictEqual(pricePerGb(100, 'no capacity here'), null);
  console.log('productParsers.js self-test: all assertions passed');
}
