// Capacity-family clustering: groups catalog products into product-line
// families so PDPs can render capacity chips linking siblings.
//
// TWO-TIER HYBRID:
//   TIER 1 (authoritative): products sharing Amazon's own parent ASIN
//     (products.parent_asin, fetched by scripts/fetch-parent-asins.js).
//     family_id = "p:{parentAsin}".
//   TIER 2 (heuristic, conservative): for products not in a tier-1 family,
//     a name-derived line signature + hard invariants that must match:
//       RAM: DDR generation + speed + CL (unknown CL only groups with unknown
//            CL - unknown is not a wildcard) + module form (SODIMM vs DIMM).
//       SSD: protocol (SATA-first rule) + form factor + PCIe gen token +
//            heatsink presence.
//     family_id = "k:{slug of brand|signature|invariants}".
//     CONSERVATIVE: when in doubt, do NOT merge. A missed sibling is a missing
//     chip; a wrong merge is a false "same product" link. Tier-2 also refuses
//     to merge two products carrying DIFFERENT non-null parent ASINs (Amazon
//     says they are different families) - those key-groups are flagged, not
//     formed.
//
// DETERMINISM/STABILITY COVENANT: family ids derive only from parentAsin or
// the normalized key, so re-runs produce identical ids (same covenant as
// slugs). Once PDPs ship linking each other, families must not reshuffle.
//
// Same-capacity duplicates inside a family: the chip for that capacity links
// to the CANONICAL member = deepest price history (row count), tiebreak
// lexicographic ASIN. Deterministic and stable.
//
// capacity_gb comes from backend/lib/productParsers.js (single source - the
// kit-total rule and TBW/Gb-s lookaheads). Unparseable capacity => excluded
// from families entirely (cannot sit on a capacity axis).
//
// Minimum family size: 2 DISTINCT capacities. Everything else stays
// family_id NULL.
//
// Dry-run by default: prints the full Gate-1 cluster review report, writes
// nothing. --confirm persists products.family_id + capacity_gb (+ requires
// the Phase-A DDL columns).
//
// Usage:
//   node scripts/build-families.js            # dry run + Gate-1 report
//   node scripts/build-families.js --confirm  # persist family_id/capacity_gb
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../backend/lib/supabase');
const {
  totalCapacityGB, capacityLabel, parseSpeed, ramType, ssdType, formFactor, latency,
} = require('../backend/lib/productParsers');

const CONFIRM = process.argv.includes('--confirm');
const PARENT_JSON = path.join(__dirname, 'output', 'parent-asins.json');
const PAGE = 1000;

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// ------------------------------------------------------------ tokenization
const FILLER = new Set([
  // shared
  'ram', 'memory', 'memories', 'desktop', 'computer', 'pc', 'internal', 'gaming',
  'module', 'modules', 'upgrade', 'kit', 'kits', 'single', 'dual', 'quad', 'channel',
  'performance', 'high', 'speed', 'speeds', 'low', 'profile', 'latency',
  'intel', 'amd', 'xmp', 'expo', 'ready', 'compatible', 'compatibility',
  'for', 'with', 'without', 'w/o', 'and', 'the', 'of', 'up', 'to', 'up-to', 'only', 'new', 'series',
  'non-ecc', 'unbuffered', 'buffered', 'pin',
  // ram module-form words (captured as an invariant instead)
  'dimm', 'udimm', 'sodimm', 'u-dimm', 'so-dimm', 'laptop', 'notebook',
  // ssd
  'ssd', 'ssds', 'drive', 'drives', 'solid', 'state', 'hard', 'disk',
  'nvme', 'sata', 'iii', 'm.2', '2280', '2242', '2230', '2.5', '2.5in', '2.5-inch', 'inch',
  'pcie', 'pcle', 'gen', 'read', 'write', 'transfer', 'rate', 'maximum', 'max',
  'sequential', 'heatsink', 'storage', 'expansion',
  // colors (variant attributes, not lines; WD's color LINES survive via model tokens)
  'black', 'white', 'grey', 'gray', 'silver', 'red', 'blue', 'green', 'gold', 'titanium',
]);
const STRIP_PATTERNS = [
  /^\d+(\.\d+)?(gb|tb)$/,           // capacities
  /^\d+x\d+(gb|tb)$/,               // kit configs 2x16gb
  /^\d+-?pack$/,
  /^\d{4,5}(mhz|mt\/?s?|mts)$/,     // speeds
  /^ddr[45](-\d{3,5})?$/,           // gen (captured as invariant)
  /^pc[45]?\d*-\d{4,6}$/,           // bandwidth codes pc4-25600
  /^cl\s?\d{1,2}$/,                 // CL (captured as invariant)
  /^cl?\d{1,2}-\d{1,2}-\d{1,2}(-\d{1,3})?$/, // timing strings
  /^\d\.\d{1,3}v$/,                 // voltage
  /^\d{3}-?pin$/,                   // pin counts
  /^gen[3-5](x[248])?$/,            // pcie gen (captured as invariant)
  /^[3-5]\.0$/,                     // pcie 4.0 etc (invariant)
  /^x[248]$/,                       // lane counts
  /^\d+(,\d+)?(mb\/s|mbs|mb)$/,     // throughput figures
  /^gb\/?s$/, /^mb\/?s$/, /^\d+gb\/s$/,
];
// Part numbers: raw (pre-lowercase) all-caps alnum tokens, len>=8, >=3 digits.
// These are per-capacity (CT2000..., F4-3200C16D-32GVK) and would break the
// line signature if retained. Shorter model codes (SN850X, NV3, GM7, 990) are
// the LINE identity and must survive.
function isPartNumber(rawToken) {
  return /^[A-Z0-9][A-Z0-9\-\/.]{7,}$/.test(rawToken) &&
    (rawToken.match(/\d/g) || []).length >= 3 && /[A-Z]/.test(rawToken);
}

function tokenize(name) {
  return name
    // Strip throughput figures BEFORE splitting: comma-grouped speeds
    // ("7,450MB/s", "Up-to 7,250 MB/s", R/W pairs "5,000/4,800 MB/s") would
    // otherwise fragment at the comma and leak mismatched tokens into keys -
    // and since SSD lines rate different capacities at different speeds, the
    // fragments could block legitimate families from forming.
    .replace(/\d[\d,\/.]*\s*(?:mb\/?s|gb\/?s)\b/gi, ' ')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[()\[\]【】,|·"“”]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean);
}

function lineSignature(p) {
  const brandWords = new Set((p.brand || '').toLowerCase().split(/\s+/).filter(Boolean));
  const out = [];
  for (const raw of tokenize(p.name)) {
    if (isPartNumber(raw)) continue;
    const t = raw.toLowerCase();
    if (brandWords.has(t)) continue;
    if (FILLER.has(t)) continue;
    if (STRIP_PATTERNS.some((re) => re.test(t))) continue;
    out.push(t);
  }
  return out;
}

// ------------------------------------------------------------- invariants
function ramForm(name) {
  return /sodimm|so-dimm|laptop|notebook|260-pin|262-pin/i.test(name) ? 'sodimm' : 'dimm';
}
function pcieGen(name) {
  const m = name.match(/(?:pcie|pcle)[\s-]*(?:gen)?[\s-]*([3-5])(?:\.0)?/i) || name.match(/\bgen\s?([3-5])\b/i);
  return m ? 'g' + m[1] : '';
}
function hasHeatsink(name) {
  if (/without\s+heatsink|w\/o\s+heatsink|no\s+heatsink/i.test(name)) return '';
  return /heatsink/i.test(name) ? 'hs' : '';
}

function invariants(p) {
  if (p.category === 'ram') {
    return [
      ramType(p.name) || 'nogen',
      parseSpeed(p.name) != null ? String(parseSpeed(p.name)) : 'nospeed',
      latency(p.name) || 'nocl',   // unknown CL only groups with unknown CL
      ramForm(p.name),
    ];
  }
  return [
    ssdType(p.name) || 'noproto',  // SATA-first
    formFactor(p.name) || 'noform',
    pcieGen(p.name) || 'nogen',
    hasHeatsink(p.name) || 'nohs',
  ];
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function tier2Key(p) {
  const sig = lineSignature(p);
  if (!sig.length) return null; // nothing left to identify the line: never group
  const brandPart = (p.brand || '').toLowerCase() || 'x';
  return slugify([p.category, brandPart, sig.join(' '), invariants(p).join(' ')].join(' '));
}

// ----------------------------------------------------------------- data
async function pagedSelect(builder) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function run() {
  log(`Family clustering started${CONFIRM ? '' : ' (DRY RUN - Gate-1 report only; pass --confirm to persist)'}`);

  const products = await pagedSelect(() =>
    supabase.from('products').select('id, sku, name, brand, category, slug').eq('retailer', 'amazon').order('id'));
  log(`Catalog: ${products.length} products`);

  // parent ASINs: prefer the DB column (post-DDL), fall back to the fetch
  // script's JSON artifact so the Gate-1 dry run works before the DDL.
  let parentBySku = new Map();
  const probe = await supabase.from('products').select('sku, parent_asin').limit(1);
  if (!probe.error) {
    const rows = await pagedSelect(() => supabase.from('products').select('sku, parent_asin').eq('retailer', 'amazon').order('id'));
    parentBySku = new Map(rows.map((r) => [r.sku, r.parent_asin || null]));
    if ([...parentBySku.values()].every((v) => v == null) && fs.existsSync(PARENT_JSON)) {
      log('parent_asin column present but empty - using scripts/output/parent-asins.json');
      parentBySku = new Map(JSON.parse(fs.readFileSync(PARENT_JSON, 'utf8')).map((r) => [r.sku, r.parentAsin]));
    }
  } else if (fs.existsSync(PARENT_JSON)) {
    log('parent_asin column not found (DDL pending) - using scripts/output/parent-asins.json');
    parentBySku = new Map(JSON.parse(fs.readFileSync(PARENT_JSON, 'utf8')).map((r) => [r.sku, r.parentAsin]));
  } else {
    throw new Error('No parent-ASIN source: run scripts/fetch-parent-asins.js first (or apply the DDL and --confirm it).');
  }

  // price_history: row count (canonical rule) + latest price (report display)
  log('Scanning price_history (paginated) for depth + latest price...');
  const hist = await pagedSelect(() =>
    supabase.from('price_history').select('product_id, price, fetched_at').order('id'));
  const depth = new Map(), latest = new Map();
  for (const r of hist) {
    depth.set(r.product_id, (depth.get(r.product_id) || 0) + 1);
    const cur = latest.get(r.product_id);
    if (!cur || r.fetched_at > cur.fetched_at) latest.set(r.product_id, r);
  }
  log(`price_history: ${hist.length} rows across ${depth.size} products`);

  // ------------------------------------------------------------ clustering
  for (const p of products) {
    p.capacity_gb = totalCapacityGB(p.name);
    p.parentAsin = parentBySku.get(p.sku) || null;
    p.depth = depth.get(p.id) || 0;
    p.price = latest.get(p.id) ? Number(latest.get(p.id).price) : null;
  }

  const noCapacity = products.filter((p) => p.capacity_gb == null);
  const withCapacity = products.filter((p) => p.capacity_gb != null);

  // tier 1
  const byParent = new Map();
  for (const p of withCapacity) {
    if (!p.parentAsin) continue;
    (byParent.get(p.parentAsin) || byParent.set(p.parentAsin, []).get(p.parentAsin)).push(p);
  }
  const families = [];
  const inTier1 = new Set();
  for (const [parent, members] of [...byParent.entries()].sort()) {
    if (members.length < 2) continue;
    const caps = new Set(members.map((m) => m.capacity_gb));
    if (caps.size < 2) {
      members.forEach((m) => { m.singletonReason = 'same-capacity-only (tier-1 parent group)'; });
      members.forEach((m) => inTier1.add(m.id)); // still tier-1-claimed: no tier-2 fallthrough
      continue;
    }
    members.forEach((m) => inTier1.add(m.id));
    families.push({ tier: 1, id: 'p:' + parent, members: members.sort((a, b) => a.sku.localeCompare(b.sku)) });
  }

  // tier 2
  const tier2Pool = withCapacity.filter((p) => !inTier1.has(p.id));
  const byKey = new Map();
  const keyOf = new Map();
  for (const p of tier2Pool) {
    const k = tier2Key(p);
    keyOf.set(p.id, k);
    if (!k) { p.singletonReason = 'empty line signature'; continue; }
    (byKey.get(k) || byKey.set(k, []).get(k)).push(p);
  }
  const flagged = [];
  for (const [key, members] of [...byKey.entries()].sort()) {
    if (members.length < 2) { members[0].singletonReason = members[0].singletonReason || 'no key match'; continue; }
    const caps = new Set(members.map((m) => m.capacity_gb));
    if (caps.size < 2) {
      members.forEach((m) => { m.singletonReason = 'same-capacity-only (tier-2 key group)'; });
      continue;
    }
    const parents = new Set(members.map((m) => m.parentAsin).filter(Boolean));
    if (parents.size >= 2) {
      flagged.push({ kind: 'CONFLICTING PARENTS - family NOT formed', key, members });
      members.forEach((m) => { m.singletonReason = 'tier-2 key group with conflicting parent ASINs'; });
      continue;
    }
    if (parents.size === 1) {
      flagged.push({ kind: 'mixed parent/no-parent members (formed - review)', key, members });
    }
    families.push({ tier: 2, id: 'k:' + key, members: members.sort((a, b) => a.sku.localeCompare(b.sku)) });
  }

  // canonical owner per capacity
  for (const f of families) {
    const byCap = new Map();
    for (const m of f.members) {
      (byCap.get(m.capacity_gb) || byCap.set(m.capacity_gb, []).get(m.capacity_gb)).push(m);
    }
    f.byCap = byCap;
    for (const [, group] of byCap) {
      group.sort((a, b) => (b.depth - a.depth) || a.sku.localeCompare(b.sku));
      group.forEach((m, i) => { m.isCanonical = i === 0; });
    }
    if (f.byCap.size > 6) flagged.push({ kind: `family with ${f.byCap.size} capacities (review)`, key: f.id, members: f.members });
  }

  // near-miss detection: tier-2 keys differing by exactly one signature token
  const keyMeta = [...byKey.keys()].map((k) => ({ k, toks: k.split('-') }));
  const nearMisses = [];
  for (let i = 0; i < keyMeta.length; i++) {
    for (let j = i + 1; j < keyMeta.length; j++) {
      const a = keyMeta[i].toks, b = keyMeta[j].toks;
      if (Math.abs(a.length - b.length) > 1) continue;
      const setA = new Set(a), setB = new Set(b);
      const onlyA = a.filter((t) => !setB.has(t)), onlyB = b.filter((t) => !setA.has(t));
      if (onlyA.length + onlyB.length === 1 || (onlyA.length === 1 && onlyB.length === 1)) {
        nearMisses.push({ a: keyMeta[i].k, b: keyMeta[j].k, diff: [...onlyA, ...onlyB].join(' vs ') });
      }
    }
  }

  // ------------------------------------------------------------ Gate-1 report
  const fmt = (v) => v == null ? 'n/a' : '$' + v.toFixed(2);
  console.log('\n════════════════════ GATE 1 - CLUSTER REVIEW ════════════════════');
  console.log(`Families proposed: ${families.length} (tier-1: ${families.filter(f => f.tier === 1).length}, tier-2: ${families.filter(f => f.tier === 2).length})`);
  console.log(`Products in families: ${families.reduce((a, f) => a + f.members.length, 0)}/${products.length}`);
  for (const f of families.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))) {
    console.log(`\n── [tier ${f.tier}] ${f.id}  (${f.byCap.size} capacities, ${f.members.length} members)`);
    for (const m of [...f.members].sort((a, b) => a.capacity_gb - b.capacity_gb || a.sku.localeCompare(b.sku))) {
      const chip = m.isCanonical ? `owns ${capacityLabel(m.capacity_gb)} chip` : `dup of ${capacityLabel(m.capacity_gb)} (canonical elsewhere)`;
      console.log(`   ${String(capacityLabel(m.capacity_gb)).padEnd(6)} ${fmt(m.price).padEnd(9)} [${m.sku}] ${chip}${m.parentAsin ? ' parent=' + m.parentAsin : ''}`);
      console.log(`          ${m.name.slice(0, 100)}`);
    }
  }
  const singles = products.filter((p) => !families.some((f) => f.members.includes(p)));
  const reasons = {};
  for (const s of singles) {
    const r = s.capacity_gb == null ? 'unparseable capacity' : (s.singletonReason || 'no key match / no shared parent');
    reasons[r] = (reasons[r] || 0) + 1;
  }
  console.log('\n──────────── singletons by reason ────────────');
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${String(n).padStart(3)}  ${r}`));
  const emptySig = singles.filter((s2) => s2.singletonReason === 'empty line signature');
  if (emptySig.length) {
    console.log('  empty-signature SKUs:');
    emptySig.forEach((p2) => console.log(`    [${p2.sku}] ${p2.name.slice(0, 80)}`));
  }
  if (noCapacity.length) {
    console.log('  unparseable-capacity SKUs:');
    noCapacity.forEach((p) => console.log(`    [${p.sku}] ${p.name.slice(0, 80)}`));
  }
  console.log('\n──────────── FLAGGED for review ────────────');
  if (!flagged.length && !nearMisses.length) console.log('  (nothing flagged)');
  for (const fl of flagged) {
    console.log(`  ⚑ ${fl.kind}: ${fl.key}`);
    fl.members.forEach((m) => console.log(`      [${m.sku}] ${capacityLabel(m.capacity_gb)} ${m.name.slice(0, 80)}`));
  }
  if (nearMisses.length) {
    console.log(`  ⚑ near-miss key pairs (differ by one token - kept separate, review for false splits):`);
    nearMisses.slice(0, 25).forEach((nm) => console.log(`      ${nm.a}\n        vs ${nm.b}\n        diff: ${nm.diff}`));
    if (nearMisses.length > 25) console.log(`      ... and ${nearMisses.length - 25} more`);
  }

  // ------------------------------------------------------------ persist
  if (CONFIRM) {
    let writes = 0, failures = 0;
    const famOf = new Map();
    for (const f of families) for (const m of f.members) famOf.set(m.id, f.id);
    for (const p of products) {
      const { error } = await supabase.from('products')
        .update({ family_id: famOf.get(p.id) || null, capacity_gb: p.capacity_gb })
        .eq('id', p.id);
      if (error) { console.error(`  write failed [${p.sku}]: ${error.message}`); failures++; continue; }
      writes++;
    }
    log(`Persisted family_id + capacity_gb: ${writes} writes, ${failures} failures`);
  } else {
    log('Dry run complete - nothing written. Re-run with --confirm after Gate-1 approval + DDL.');
  }
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
