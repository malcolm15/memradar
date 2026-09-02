// HAND-CURATED PRODUCT NAME OVERRIDES.
//
// These beat the automatic name builder in generate-product-pages.js entirely.
//
// WHY THIS FILE EXISTS: the builder derives sibling names from parsed specs
// (capacity, kit config, speed, CL, colour, heatsink, pack, form factor, and
// two-attribute composites). Where every one of those fails to separate a group,
// it falls back to the last 4 of the ASIN, which produces names like
// "G.Skill Trident Z5 RGB Series ZM6Y". An ASIN fragment must NEVER ship as a
// user-facing name: it reads as a typo and tells a shopper nothing.
//
// So the remainder is curated by hand, read off the raw listing title. Selective
// hand-curation where automation fails, rather than a cleverer heuristic that
// would be wrong somewhere else.
//
// RULES:
//   - Every entry is read from the product's own raw title. Never invented.
//   - MANDATORY TOKENS APPLY HERE TOO. An override bypasses the builder, which
//     means it also bypasses the builder's guarantee that capacity, DDR
//     generation / speed (RAM) and interface (SSD) are never dropped. The dry
//     run audits overrides alongside generated names; keep it at zero.
//   - Keep to ~64 characters (the h1 budget); the <title> is fitted separately
//     distinguishing attribute is exactly what truncation would eat.
//   - Human-approved before shipping (gate, 2026-09-01).
//   - When a product stops colliding (a sibling is dropped, a parser improves),
//     DELETE its entry rather than leaving a stale hand-written name in place.
//
// Keyed by ASIN.
module.exports = {
  // --- Crucial 16GB DDR5: desktop UDIMM vs laptop SODIMM, and two speeds.
  // Neither module form nor pin count is parseable (formFactor() only handles
  // M.2 / 2.5" for SSDs), so this is exactly the automation gap.
  B0BLTH3KWV: 'Crucial 16GB DDR5 5600 Desktop', // UDIMM 288-Pin, CT16G56C46U5
  B0BLTGMCB7: 'Crucial 16GB DDR5 5600 Laptop',  // SODIMM 262-Pin, CT16G56C46S5
  B09HW2JNHX: 'Crucial 16GB DDR5 4800 Desktop', // UDIMM 288-Pin, CT16G48C40U5

  // --- Crucial 32GB DDR4 kit: same total, same speed, different module form.
  B08C4X9VR5: 'Crucial 32GB DDR4 3200 Laptop',  // SODIMM 260-Pin, CT2K16G4SFRA32A
  B08C4LXXCJ: 'Crucial 32GB DDR4 3200 Desktop', // UDIMM 288-Pin, CT2K16G4DFRA32A

  // --- TEAMGROUP Vulcan Z DDR4 16GB: specs are IDENTICAL (2x8GB, 3200, CL16,
  // Gray). The only real difference is the manufacturer part number, a die or
  // packaging revision. A part number is a legitimate public identifier (unlike
  // an ASIN fragment), so the revision suffix is the honest differentiator.
  B08PJNVWNZ: 'TEAMGROUP Vulcan Z DDR4 16GB 3200MHz FDC01',  // TLZGD416G3200HC16FDC01
  B07T637L7T: 'TEAMGROUP Vulcan Z DDR4 16GB 3200MHz CDC01',  // TLZGD416G3200HC16CDC01

  // --- G.Skill Trident Z5 RGB: capacity + speed + colour all vary, but no
  // single attribute and no PAIR separates all five, so the builder gave up.
  // The full line name is kept: "Trident Z5 RGB" is what people search, and the
  // 48-char name budget has room for it (ruling, 2026-09-01).
  B09PTGZM6Y: 'G.Skill Trident Z5 RGB DDR5 32GB 6000MHz Black',
  B0CB78Y7DC: 'G.Skill Trident Z5 RGB DDR5 32GB 6000MHz White',
  B09QS2K59B: 'G.Skill Trident Z5 RGB DDR5 32GB 6400MHz Black',
  B0G7RL6SPS: 'G.Skill Trident Z5 RGB DDR5 16GB 6000MHz Black', // 1x16GB single module
  B0BJ7X9P1W: 'G.Skill Trident Z5 RGB DDR5 64GB 6400MHz Black',

  // --- Samsung 990 PRO 4TB: a 2-pack and a single-drive warranty bundle. Price
  // confirms it: $1789.90 vs $889.99, exactly 2x. "2 Pack" is unparseable by the
  // pack matcher because the sibling's "Protection Pack" has no leading digit.
  B0CXZ153DP: 'Samsung 990 PRO NVMe 4TB 2-Pack',
  B0CY2SZ62P: 'Samsung 990 PRO NVMe 4TB + Warranty',

  // --- TEAMGROUP Vulcan Z 2TB SATA SSD: same capacity and interface, different
  // NAND. TLC vs QLC is a real endurance and sustained-write difference a buyer
  // should see, and it is stated plainly in both raw titles.
  B09WMSVHD4: 'TEAMGROUP Vulcan Z SATA 2TB TLC',     // 3D NAND TLC, 550/500 MB/s
  B0BYSKXGJV: 'TEAMGROUP Vulcan Z SATA 2TB QLC',     // 3D NAND QLC, 550/470 MB/s
};
