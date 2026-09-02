// HAND-CURATED PRODUCT BLURBS. Authored 2026-09-02, keyed by ASIN.
//
// Keyed by SKU rather than by page path DELIBERATELY: a slug can change (the
// slug covenant makes that rare, not impossible) and a path-keyed blurb would
// silently orphan itself onto nothing, or worse, onto a different product.
//
// WORDING IS VERBATIM from the authored source. Do not paraphrase, do not
// "fix" a claim: every claim here was cross-checked against the product's
// parsed specs and its raw listing title before shipping, and an entry that
// contradicts its listing is HELD (see the block at the bottom) for the author
// to rewrite rather than silently edited.
//
// These are product-line level by design; SKU-specific numbers (capacity,
// speed, CL, colour) live on the spec line, which is generated.
//
// Rendered as "About this kit" / "About this drive" only on pages with an
// entry. Pages without one render nothing, no placeholder. Static prose:
// nothing here hydrates.
module.exports = {
  // Corsair Vengeance RGB DDR5 32GB 6000
  // /ram/corsair-vengeance-rgb-ddr5-ram-32gb-6000mhz-4/
  B0DPJ9DJ3D: 'Corsair\'s mainstream RGB DDR5 kit, and the one most builders end up cross-shopping against G.Skill\'s Trident Z5. 6000 MT/s suits both AM5 and current Intel, and 32GB in two sticks is the standard gaming configuration. The heatspreader runs tall, so check clearance under a large air cooler. Lighting is managed through iCUE; skip the software and the sticks default to a rainbow cycle. A safe choice in the good sense. The gap to the non-RGB Vengeance is the cost of the light bar.',
  // G.Skill Flare X5 64GB 6000
  // /ram/g-skill-flare-x5-series-ddr5-ram-64gb-6000mhz/
  B0CGQ3KS8X: 'Flare X5 is G.Skill\'s AMD-first line: EXPO-certified, low-profile, no lighting, built to run at the speeds Ryzen 7000 and 9000 handle best. The 64GB kit at 6000 is for people who edit video, run virtual machines, or never close a tab, and the short heatspreader clears almost any air cooler. Nothing about it is flashy, which is the point. The profile is EXPO first, so Intel builders should confirm an XMP profile is present before expecting rated speed.',
  // Trident Z5 Neo RGB 64GB 6000
  // /ram/g-skill-trident-z5-neo-rgb-series-ddr5-ram-64gb-6000mhz/
  B0BJNTLJ5X: 'Trident Z5 Neo is G.Skill\'s AMD EXPO flagship: the Trident heatspreader, the RGB strip, timings tuned for Ryzen. At 64GB and 6000 it is what you buy when you want a workstation-sized pool of memory that still runs at the AM5 sweet spot. It is tall and it is not cheap even by 2026 standards. A non-RGB Neo exists for less if the lighting means nothing to you, and on Intel the plain Trident Z5 is the better-matched sibling.',
  // Corsair Vengeance RGB RS 32GB 5600
  // /ram/corsair-vengeance-rgb-rs-ddr5-ram-32gb-5600mhz/
  B0GGJ2GN9K: 'Corsair\'s lower-priced RGB tier: the same module family with a simpler light bar, for builders who want the look without paying for a top speed bin. 5600 MT/s is the entry end of DDR5, fine for an Intel build or an everyday machine and a step below where Ryzen owners usually land. 32GB across two sticks is the sensible configuration. Buy it for the lighting and the price, not the speed.',
  // generic DDR4 16GB 3200
  // /ram/ddr4-ram-16gb-3200mhz/
  B0GYF4X5V8: 'An unbranded DDR4 kit at the most common DDR4 speed. What you trade for the low price is everything that isn\'t the chips: no recognisable warranty path, unknown binning, and no guarantee the modules match a previous kit. For an office machine or a spare DDR4 board that needs to work, that trade is often fine. For a gaming rig you plan to keep, a Crucial or Kingston kit at the same speed usually costs little more and answers the support question.',
  // Corsair Vengeance DDR5 32GB 6000, non-RGB
  // /ram/corsair-vengeance-ddr5-ram-32gb-6000mhz-2/
  B0CBRJ63RT: 'The plain Vengeance is the RGB kit without the lighting, and it is the version to buy for a windowless case, a home server, or anyone who finds glowing memory faintly embarrassing. It sits lower than the RGB version, which matters under wide air coolers. Same speed, same profiles, same Corsair support. The price difference between this and the lit version is a recurring lesson in what people will pay for a light bar.',
  // Corsair Vengeance RGB DDR5 32GB 6000, alternate listing
  // /ram/corsair-vengeance-rgb-ddr5-32gb-6000mhz/
  B0G5QFNNV3: 'Corsair sells the Vengeance RGB 32GB 6000 kit in several timings, and the CL figure on the spec line above is what separates the listings. Lower CL means slightly lower latency and usually a higher price; CL30 is the enthusiast bin, CL36 and CL40 the volume bins. For gaming the difference between them is small, and the cheaper bin at the same speed is usually the better buy. Compare the CL against the sibling listings before deciding this one is the deal.',
  // Crucial 64GB DDR5 5600
  // /ram/crucial-64gb-ddr5-ram-5600mhz/
  B0BLTG3RLR: '64GB at JEDEC speed for people whose workload is memory-hungry but whose patience for BIOS tuning is not: video editors, developers running containers, anyone hitting swap with 32GB. It runs at 5600 out of the box. No heatspreader, no profiles, no lighting. The trade is the top end: a profiled 6000 kit will edge it in memory-bound benchmarks, but for capacity-first buyers that is rarely the point.',
  // Corsair Vengeance DDR5 32GB 6000, alternate listing
  // /ram/corsair-vengeance-ddr5-32gb-6000mhz/
  B0G5Q1XTKM: 'Corsair offers the non-RGB Vengeance 32GB 6000 in both XMP-only and EXPO-certified versions, and which one this is matters more than the small price gap between them. On Intel either works. On AM5, the EXPO version is the one that reaches rated speed with a single BIOS setting; the XMP-only kit usually runs too, but with less certainty. Check the listing title for EXPO before assuming the cheaper one is interchangeable.',
  // Samsung 990 PRO 2TB
  // /ssd/samsung-990-pro-ssd-2tb-nvme-m-2-pcie/
  B0BHJJ9Y77: 'The 990 PRO has been the reference Gen4 NVMe drive since it launched: TLC flash, a DRAM cache, a controller that holds its speed under sustained load, and a five-year warranty. It is the drive reviewers compare other drives against. A heatsink version exists for the PS5, and Samsung\'s Gen5 successor exists for people who need it, but for gaming and general use this is as fast as storage needs to be. If it is priced sanely, it is the drive to buy.',
  // TEAMGROUP Elite SODIMM 64GB 5600
  // /ram/teamgroup-elite-sodimm-ddr5-64gb-5600mhz/
  B0CN9376FP: 'Laptop memory, and a lot of it: two 32GB SODIMMs at JEDEC 5600, no profiles, no heatspreader. This is for a workstation laptop or a mini PC that ships with two slots and a stingy factory configuration. Check two things before buying: that the machine\'s memory is socketed rather than soldered, and that it supports 32GB modules. Many mini PCs do; many thin laptops do not.',
  // Corsair Vengeance DDR5 16GB 6000
  // /ram/corsair-vengeance-ddr5-ram-16gb-6000mhz/
  B0GJFTS22V: '16GB is the floor for a gaming PC in 2026, and this is the entry ticket at a proper speed. If it is a single module, note that you lose dual-channel bandwidth until you add a second; if it is a 2x8GB kit, you have no free slots to grow into. Either way, the honest advice is that 32GB is the sensible target now and 16GB is the budget-constrained version. It is a fine kit; it is just a small one.',
  // Acer Predator GM7 2TB
  // /ssd/acer-predator-gm7-2tb-ssd-m-2-2280-pcie/
  B0CB8JJR7F: 'A DRAM-less Gen4 drive that reviewers were surprised by: fast enough in everyday use to embarrass drives that cost more, using host memory instead of an onboard cache. That design keeps the price down and is fine for a game library or a boot drive. It is not the drive for constant large file writes, where DRAM-equipped competitors hold up better. Acer\'s storage line is made by BIWIN; the brand on the sticker is not the manufacturer.',
  // Crucial 16GB DDR5 5600, desktop
  // /ram/crucial-16gb-ddr5-ram-5600mhz/
  B0BLTH3KWV: 'A single 16GB desktop module at JEDEC speed. The usual reason to buy one stick rather than a kit is to pair it with one you already have, and Crucial\'s standard line is the safest bet for that, since it runs at the platform default with no profile to reconcile. As a lone module it runs single-channel. As an upgrade to a prebuilt that shipped with one stick, it is exactly the right part.',
  // TEAMGROUP Elite SODIMM 32GB 5600
  // /ram/teamgroup-elite-sodimm-ddr5-32gb-5600mhz/
  B0CN92HXZL: 'The laptop upgrade most people actually need: 32GB across two SODIMMs at 5600, the capacity that turns a 16GB machine from adequate into comfortable. JEDEC speed, no profiles, works in any DDR5 laptop or mini PC with two free slots. The single check that matters is whether your machine\'s memory is soldered; if it is, no kit on this site will help. If it is socketed, this is the plain, reliable option.',
  // Crucial 64GB DDR5 4800 kit
  // /ram/crucial-64gb-ddr5-ram-kit-4800mhz/
  B09HW6ZJV5: '4800 is DDR5\'s base speed, and this kit is the cheapest route to 64GB of it. It is for capacity-first machines where memory speed barely registers: home servers, virtualization boxes, a workstation that runs out of memory before it runs out of bandwidth. Runs at spec with nothing to enable. For a gaming or Ryzen build, the same money on a faster 32GB kit is usually the better spend; for a machine that just needs room, this is the right shape.',
  // G.Skill Flare X5 32GB 6000
  // /ram/g-skill-flare-x5-series-ddr5-ram-32gb-6000mhz/
  B0BFGB2D2Z: 'If there is one canonical AM5 memory kit, it is a 32GB Flare X5 at 6000: EXPO out of the box, low enough to clear any cooler, no lighting, and the speed and capacity most Ryzen 7000 and 9000 builders settle on. It is what gets recommended when someone asks "just tell me what to buy." The CL bin on the spec line is the only thing that varies between listings; the lower one is nicer, the higher one is usually the value.',
  // Silicon Power DDR5 64GB 6000
  // /ram/silicon-power-ddr5-64gb-6000mhz/
  B0GN5MSZXJ: 'Silicon Power is a Taiwanese value brand, and this is 64GB at 6000 for less than the enthusiast names charge. What you give up is mostly reputation: the modules use the same few memory die suppliers as everyone else, but the binning, support, and community track record are thinner. For a capacity-heavy build on a budget it is a reasonable gamble. Confirm the profile type on the listing matches your platform before assuming it will hit 6000.',
  // Acer Predator Vesta II RGB 32GB 6000
  // /ram/acer-predator-vesta-ii-rgb-ddr5-ram-32gb-6000mhz/
  B0CRNNVYM2: 'Acer\'s memory is made by BIWIN, and the Vesta II is its RGB DDR5 line: a lit heatspreader, 6000 MT/s, and pricing that is often aggressive because the brand is still earning trust in this category. Reviews have been kind to the underlying modules. The lighting works with the major motherboard RGB tools rather than a dedicated app. Worth a look when the big names are priced above their history and this one is not.',
};

// ---------------------------------------------------------------------------
// HELD, NOT SHIPPED. Each contradicts its own listing title; flagged for the
// author to rewrite (2026-09-02). Verification, not editing, is this file's job.
//
// B0B3HGJ4V7  /ram/teamgroup-t-force-delta-rgb-ddr5-ram-32gb-6000mhz/
//   listing: TEAMGROUP T-Force Delta RGB DDR5 Ram 32GB (2x16GB) 6000MHz PC5-48000 CL30 Intel XMP 3.0 & AMD Expo Compatible Desktop Memory Module Ram Whit
//   REASON : COLOUR SWAP: this listing is WHITE (FF4D...), the blurb assigned here is labelled black.
//
// B0B3HHB3Z9  /ram/teamgroup-t-force-delta-rgb-ddr5-ram-32gb-6000mhz-2/
//   listing: TEAMGROUP T-FORCE DELTA RGB DDR5 Ram 32GB (2x16GB) 6000MHz PC5-48000 CL30 Intel XMP 3.0 AMD Expo Compatible Desktop Memory Black FF3D532G600
//   REASON : COLOUR SWAP: this listing is BLACK (FF3D...), the blurb assigned here says "white heatspreader".
//
// B0DSQMKYLN  /ram/crucial-128gb-kit-5600mhz/
//   listing: Crucial 128GB Kit (2X64GB) DDR5 RAM 5600MHz (or 5200MHz or 4800MHz) Laptop Memory Kit, SODIMM 262-Pin, Compatible with Latest Intel Core Ult
//   REASON : FORM FACTOR: listing is "Laptop Memory Kit, SODIMM 262-Pin"; blurb says workstation and "motherboard and BIOS".
//
// B0BLTDRRLF  /ram/crucial-32gb-ddr5-ram-kit-5600mhz/
//   listing: Crucial 32GB DDR5 RAM Kit (2x16GB), 5600MHz (or 5200MHz or 4800MHz) Laptop Memory 262-Pin SODIMM, Compatible with Intel Core and AMD Ryzen 7
//   REASON : FORM FACTOR: listing is "Laptop Memory 262-Pin SODIMM"; blurb says "any DDR5 board" and "a first build".
//
// B0BNTRRLYP  /ram/teamgroup-t-force-vulcan-ddr5-32gb-6000mhz/
//   listing: TEAMGROUP T-Force Vulcan DDR5 32GB (2x16GB) 6000MHz (PC5-48000) CL38 Desktop Memory Module Ram (Black) for Chipset 600 700 Series XMP 3.0 Re
//   REASON : EXPO: blurb asserts "both XMP and EXPO"; listing says "XMP 3.0 Ready" only, no EXPO.
//
// B0GV1RCHX2  /ssd/western-digital-wd-black-2tb-sn770-nvme/
//   listing: WD_Black 2TB SN770 NVMe Internal Gaming SSD Solid State Drive - Gen4 PCIe, M.2 2280, Up to 5,150 MB/s - WDS200T3X0E - (Renewed)
//   REASON : CONDITION: listing is "(Renewed)"; blurb recommends the drive without noting it is a refurbished unit. Page is also noindex (27 tracked days).
