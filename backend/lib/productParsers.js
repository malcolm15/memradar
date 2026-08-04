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

const MPN_SPEC_TOKEN = /^(?:\d+X\d+(?:GB|TB)|DDR[45][-\d]*|PC[34][-\d]+|CL\d[\d-]*|\d+(?:GB|TB|MHZ|MTS?)|\d+MT\/S|XMP[\d.]*|EXPO|AMD|INTEL|RGB|NVME|SATA(?:\s?III)?|SSD|M\.2|2280|2242|PCIE[\d.X]*|GEN[\d.X]+|U-?DIMM|SO-?DIMM|RDIMM|QLC|TLC|NAND|\d+V|1\.\d+V|PS5|PC)$/;
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
  capTokensGB,
  totalCapacityGB,
  capacityLabel,
  parseSpeed,
  ramType,
  ssdType,
  formFactor,
  latency,
};
