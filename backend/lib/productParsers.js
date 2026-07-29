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

module.exports = {
  capTokensGB,
  totalCapacityGB,
  capacityLabel,
  parseSpeed,
  ramType,
  ssdType,
  formFactor,
  latency,
};
