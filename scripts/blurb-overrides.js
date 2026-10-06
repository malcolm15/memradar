// HAND-CURATED PRODUCT BLURBS. Authored 2026-09-02, keyed by ASIN.
//
// Keyed by SKU rather than by page path DELIBERATELY: a slug can change (the
// slug covenant makes that rare, not impossible) and a path-keyed blurb would
// silently orphan itself onto nothing, or worse, onto a different product.
//
// WORDING IS VERBATIM from the authored source. Do not paraphrase and do not
// "fix" a claim. Every claim was cross-checked against the product's parsed
// specs and its RAW LISTING TITLE before shipping; a blurb that contradicts its
// listing is held for the author to rewrite, never silently edited.
//
// VERIFY ON FOUR AXES, because these are the four that actually went wrong on
// the first pass (2026-09-02): COLOUR, FORM FACTOR (UDIMM vs SODIMM),
// CONDITION (Renewed/Refurbished), and PROFILE SUPPORT (XMP vs EXPO). The prose
// was never the problem; binding line-level copy to a specific ASIN was.
// A fifth check earned its place on the rewrite: any claim about MemRadar's own
// content ("our own storage guide advises...") must be verified against that
// page, since it is checkable by any reader.
//
// AN ENTRY IS EITHER a plain string, OR { text, guide } where guide is 'ram' or
// 'ssd'. The optional guide field makes the template append a trailing link to
// that buying guide. Authors still write plain prose only: the anchor is built
// by the generator from the GUIDES registry, so a retitled guide follows
// automatically and no blurb ever contains markup.
//
// Two kinds of blurb live here. Product-line blurbs describe the kit or drive.
// Price-record blurbs annotate what MemRadar has recorded for one listing.
// SKU-specific numbers (capacity, speed, CL, colour) still live on the
// generated spec line.
//
// Rendered as "About this kit" / "About this drive" only on pages with an
// entry. Pages without one render nothing, no placeholder. Static prose:
// nothing here hydrates.
//
// What a blurb may say about price (rule set 2026-10-04):
//   ALLOWED: a recorded price on a named date; a change between two named
//   dates with both prices; a median for a completed calendar year, or for
//   the tracked portion of a year when stated as such; a verdict from
//   ath-classification.json about a named date, in the file's own terms.
//   NOT ALLOWED: current prices, ranks, cheapest or most expensive,
//   all-time high or low as a standing status, counts or shares over the
//   whole history, family position, catalogue comparisons, retailer stock
//   state, and anything from an incomplete year stated as a year figure.
//   Do not upgrade an observation into a stronger claim. "No in-stock
//   observation between X and Y" is allowed; "there was no stock" is not.
//   "Amazon had no offer on DATE" only where the classification file says
//   so. Do not infer causes, demand, shortages or product quality from
//   price movements. Product facts come from the raw title, attributed to
//   the listing.
//   THE RULE SET APPLIES TO EVERY BLURB, PRODUCT-LINE ONES INCLUDED: no
//   ranks, no recommendations, no value judgements, whatever the blurb is
//   about.
//   Title-derived product facts are a separate maintenance category. They
//   reflect the raw title as stored when the blurb was written and can go
//   stale if the listing title changes. Price-record claims written in the
//   allowed dated or closed-interval forms above do not stale as new data
//   arrives.
//   Rounding: a yearly median quoted as "about $N" is the stored median
//   rounded to the nearest dollar, half up (757.50 reads as $758). One
//   convention for every blurb; do not choose per entry.
//   No minimum reading count is set for a completed-year median. A year
//   qualifies when its observations span January through December; if a
//   minimum is ever wanted, it is a methodology decision applied to every
//   blurb at once.
module.exports = {
  // Corsair Vengeance RGB DDR5 32GB 6000
  // /ram/corsair-vengeance-rgb-ddr5-ram-32gb-6000mhz-4/
  B0DPJ9DJ3D: 'This is the white Vengeance RGB kit: 2x16GB, listed at up to 6000MHz CL30 and 1.4V, with AMD EXPO and Intel XMP 3.0 both named in the title. Its median recorded price across 2025 was $159. In November of that year the recorded price moved on five recorded days in a row: $246.99 on the 16th, $317.99 on the 17th, $422.33 on the 18th, $326.99 on the 19th and $448.99 on the 20th.',
  // G.Skill Flare X5 64GB 6000
  // /ram/g-skill-flare-x5-series-ddr5-ram-64gb-6000mhz/
  B0CGQ3KS8X: 'G.Skill lists this Flare X5 kit as 2x32GB at 6000MT/s CL30 and 1.40V, in matte black, with AMD EXPO named in the title. No calendar year before 2026 is fully covered in our record, so the figures here are dated prices. We recorded $354.99 on October 17, 2025, $248.00 on October 20 and $354.99 again on October 21. On January 6, 2026 we recorded $712.99, and $869.99 the next day.',
  // T-Force Delta RGB 32GB 6000, black  [rewritten 2026-09-02 after verification]
  // /ram/teamgroup-t-force-delta-rgb-ddr5-ram-32gb-6000mhz/
  B0B3HGJ4V7: 'The white Delta RGB: TEAMGROUP\'s full-width light bar in a white heatspreader, one of the cheaper ways to keep a white build consistent. White memory is one of the few parts where the colour is aesthetic but the price is not, which is why the black version has its own page here; the two drift apart more than you\'d expect. XMP and EXPO on the 6000 kit, and the heatspreader is tall enough that cooler clearance is worth measuring. Otherwise it is the Delta you\'d expect.',
  // Trident Z5 Neo RGB 64GB 6000
  // /ram/g-skill-trident-z5-neo-rgb-series-ddr5-ram-64gb-6000mhz/
  B0BJNTLJ5X: 'Trident Z5 Neo is G.Skill\'s AMD EXPO flagship: the Trident heatspreader, the RGB strip, timings tuned for Ryzen. At 64GB and 6000 it is what you buy when you want a workstation-sized pool of memory that still runs at the AM5 sweet spot. It is tall and it is not cheap even by 2026 standards. A non-RGB Neo exists for less if the lighting means nothing to you, and on Intel the plain Trident Z5 is the better-matched sibling.',
  // Corsair Vengeance RGB RS 32GB 5600
  // /ram/corsair-vengeance-rgb-rs-ddr5-ram-32gb-5600mhz/
  B0GGJ2GN9K: 'Corsair\'s lower-priced RGB tier: the same module family with a simpler light bar, for builders who want the look without paying for a top speed bin. 5600 MT/s is the entry end of DDR5, fine for an Intel build or an everyday machine and a step below where Ryzen owners usually land. 32GB across two sticks is the sensible configuration. Buy it for the lighting and the price, not the speed.',
  // T-Force Delta RGB 32GB 6000, white  [rewritten 2026-09-02 after verification]
  // /ram/teamgroup-t-force-delta-rgb-ddr5-ram-32gb-6000mhz-2/
  B0B3HHB3Z9: 'The black version of TEAMGROUP\'s Delta RGB kit, listed as 2x16GB at 6000MHz CL30 with both Intel XMP 3.0 and AMD EXPO named in the title. Across three completed years its median recorded price stayed within about five dollars: $105 in 2023, $105 in 2024 and $110 in 2025. The daily record also contains two sharp moves. We recorded $239.99 on November 1, 2022, $471.00 on November 2 and $239.99 again on November 3; and $100.66 on November 30, 2023, then $169.30 the next day.',
  // generic DDR4 16GB 3200
  // /ram/ddr4-ram-16gb-3200mhz/
  B0GYF4X5V8: 'An unbranded DDR4 kit at the most common DDR4 speed. What you trade for the low price is everything that isn\'t the chips: no recognisable warranty path, unknown binning, and no guarantee the modules match a previous kit. For an office machine or a spare DDR4 board that needs to work, that trade is often fine. For a gaming rig you plan to keep, a Crucial or Kingston kit at the same speed usually costs little more and answers the support question.',
  // Corsair Vengeance DDR5 32GB 6000, non-RGB
  // /ram/corsair-vengeance-ddr5-ram-32gb-6000mhz-2/
  B0CBRJ63RT: 'The plain Vengeance is the RGB kit without the lighting, and it is the version to buy for a windowless case, a home server, or anyone who finds glowing memory faintly embarrassing. It sits lower than the RGB version, which matters under wide air coolers. Same speed, same profiles, same Corsair support. The price difference between this and the lit version is a recurring lesson in what people will pay for a light bar.',
  // Crucial 128GB DDR5 5600 kit  [rewritten 2026-09-02 after verification]
  // /ram/crucial-128gb-kit-5600mhz/
  B0DSQMKYLN: 'Two 64GB laptop modules at JEDEC 5600, which is as much memory as a DDR5 laptop can currently hold. This is for mobile workstations and mini PCs whose spec sheet explicitly lists 128GB as the maximum; many machines cap at 64GB or 96GB and will not recognise a 64GB module at all, so confirm that line before ordering. Crucial\'s standard line runs at rated speed with nothing to enable. It is not desktop memory; SODIMMs do not fit a full-size board.',
  // Corsair Vengeance RGB DDR5 32GB 6000, alternate listing
  // /ram/corsair-vengeance-rgb-ddr5-32gb-6000mhz/
  B0G5QFNNV3: 'Corsair sells the Vengeance RGB 32GB 6000 kit in several timings, and the CL figure on the spec line above is what separates the listings. Lower CL means slightly lower latency and usually a higher price; CL30 is the enthusiast bin, CL36 and CL40 the volume bins. For gaming the difference between them is small, and the cheaper bin at the same speed is usually the better buy. Compare the CL against the sibling listings before deciding this one is the deal.',
  // Crucial 32GB DDR5 5600 kit  [rewritten 2026-09-02 after verification]
  // /ram/crucial-32gb-ddr5-ram-kit-5600mhz/
  B0BLTDRRLF: 'A laptop upgrade kit: two 16GB SODIMMs at JEDEC 5600 that run at rated speed in any DDR5 laptop or mini PC with two free slots, no profile to enable. Crucial is Micron\'s consumer brand, and its site has a compatibility lookup by machine model that is worth thirty seconds before you order, mostly to confirm the memory isn\'t soldered. The low-drama choice for a laptop that shipped with less than it needed. Not for desktops.',
  // T-Force Vulcan DDR5 32GB 6000  [rewritten 2026-09-02 after verification]
  // /ram/teamgroup-t-force-vulcan-ddr5-32gb-6000mhz/
  B0BNTRRLYP: 'Vulcan is TEAMGROUP\'s heatspreader kit without the light bar: the Delta\'s speed in a lower, plainer module at a lower price. This listing is XMP 3.0 only, with no EXPO profile, which makes it a straightforward pick on Intel and a slightly less certain one on AM5, where the XMP profile usually loads but is not AMD-certified. The lower height suits big air coolers. Nothing to install and nothing to light up.',
  // Crucial 64GB DDR5 5600
  // /ram/crucial-64gb-ddr5-ram-5600mhz/
  B0BLTG3RLR: 'Crucial lists this 64GB desktop kit at 5600MHz, or 5200MHz or 4800MHz, as UDIMM 288-pin memory. Its median recorded price was about $178 in 2024 and $184 in 2025. In the last weeks of 2025 we recorded $429.70 on November 15, $299.90 on November 16 and $429.50 on November 17, then $568.99 on December 9 and $719.99 on December 10.',
  // Corsair Vengeance DDR5 32GB 6000, alternate listing
  // /ram/corsair-vengeance-ddr5-32gb-6000mhz/
  B0G5Q1XTKM: 'Corsair offers the non-RGB Vengeance 32GB 6000 in both XMP-only and EXPO-certified versions, and which one this is matters more than the small price gap between them. On Intel either works. On AM5, the EXPO version is the one that reaches rated speed with a single BIOS setting; the XMP-only kit usually runs too, but with less certainty. Check the listing title for EXPO before assuming the cheaper one is interchangeable.',
  // Samsung 990 PRO 2TB
  // /ssd/samsung-990-pro-ssd-2tb-nvme-m-2-pcie/
  B0BHJJ9Y77: 'The 990 PRO has been the reference Gen4 NVMe drive since it launched: TLC flash, a DRAM cache, a controller that holds its speed under sustained load, and a five-year warranty. It is the drive reviewers compare other drives against. A heatsink version exists for the PS5, and Samsung\'s Gen5 successor exists for people who need it, but for gaming and general use this is as fast as storage needs to be. If it is priced sanely, it is the drive to buy.',
  // TEAMGROUP Elite SODIMM 64GB 5600
  // /ram/teamgroup-elite-sodimm-ddr5-64gb-5600mhz/
  B0CN9376FP: 'Laptop memory, and a lot of it: two 32GB SODIMMs at JEDEC 5600, no profiles, no heatspreader. This is for a workstation laptop or a mini PC that ships with two slots and a stingy factory configuration. Check two things before buying: that the machine\'s memory is socketed rather than soldered, and that it supports 32GB modules. Many mini PCs do; many thin laptops do not.',
  // Corsair Vengeance DDR5 16GB 6000  [rewritten 2026-09-02 after verification]
  // /ram/corsair-vengeance-ddr5-ram-16gb-6000mhz/
  B0GJFTS22V: '16GB is the floor for a gaming PC in 2026, and this is the entry ticket at a proper speed: 2x8GB at 6000 with both EXPO and XMP, so it runs at rated speed on either platform. The catch is growth. Both slots on a two-slot board are filled, so moving to 32GB later means replacing the kit rather than adding to it. The honest advice is that 32GB is the sensible target now; this is the budget-constrained version of a fine kit.',
  // Acer Predator GM7 2TB
  // /ssd/acer-predator-gm7-2tb-ssd-m-2-2280-pcie/
  B0CB8JJR7F: 'A DRAM-less Gen4 drive that reviewers were surprised by: fast enough in everyday use to embarrass drives that cost more, using host memory instead of an onboard cache. That design keeps the price down and is fine for a game library or a boot drive. It is not the drive for constant large file writes, where DRAM-equipped competitors hold up better. Acer\'s storage line is made by BIWIN; the brand on the sticker is not the manufacturer.',
  // Crucial 16GB DDR5 5600, desktop
  // /ram/crucial-16gb-ddr5-ram-5600mhz/
  B0BLTH3KWV: 'A single 16GB desktop module at JEDEC speed. The usual reason to buy one stick rather than a kit is to pair it with one you already have, and Crucial\'s standard line is the safest bet for that, since it runs at the platform default with no profile to reconcile. As a lone module it runs single-channel. As an upgrade to a prebuilt that shipped with one stick, it is exactly the right part.',
  // WD_Black SN770 2TB  [rewritten 2026-09-02 after verification]
  // /ssd/western-digital-wd-black-2tb-sn770-nvme/
  B0GV1RCHX2: {
    text: 'This is the renewed listing for the SN770, WD\'s DRAM-less Gen4 gaming drive, and the drive itself is excellent: close to the SN850X in the things games do, single-sided, laptop-friendly. Renewed changes the math. Flash wears with writes, a refurbished drive\'s remaining endurance is unknown unless the seller shows SMART data, and the warranty is the seller\'s short guarantee rather than WD\'s five years. Our own storage guide advises against used flash. Compare this against a new SN770 before deciding the discount covers the uncertainty.',
    // The blurb cites the SSD guide in prose; the link makes that citation
    // followable. Verified 2026-09-02: the guide's "Should I buy a used SSD?"
    // section does advise against used flash.
    guide: 'ssd',
  },
  // TEAMGROUP Elite SODIMM 32GB 5600
  // /ram/teamgroup-elite-sodimm-ddr5-32gb-5600mhz/
  B0CN92HXZL: 'The laptop upgrade most people actually need: 32GB across two SODIMMs at 5600, the capacity that turns a 16GB machine from adequate into comfortable. JEDEC speed, no profiles, works in any DDR5 laptop or mini PC with two free slots. The single check that matters is whether your machine\'s memory is soldered; if it is, no kit on this site will help. If it is socketed, this is the plain, reliable option.',
  // Crucial 64GB DDR5 4800 kit
  // /ram/crucial-64gb-ddr5-ram-kit-4800mhz/
  B09HW6ZJV5: 'Crucial lists this kit as two 32GB desktop modules at 4800MHz CL40. For the four completed years from 2022 through 2025 its median recorded prices were about $352, $158, $171 and $189. In late January 2026 we recorded $749.00 on January 26, $292.28 on January 29 and $749.00 again on January 30.',
  // G.Skill Flare X5 32GB 6000
  // /ram/g-skill-flare-x5-series-ddr5-ram-32gb-6000mhz/
  B0BFGB2D2Z: 'This Flare X5 kit is listed as 2x16GB at 6000MT/s CL36 and 1.35V, with both AMD EXPO and Intel XMP 3.0 named in the title. Its median recorded price stayed within eight dollars across three completed years: about $95 in 2023, $95 in 2024 and $88 in 2025. In its first months on record we recorded $159.99 on November 25, 2022, $292.00 on November 26 and $159.99 again on November 27.',
  // Silicon Power DDR5 64GB 6000
  // /ram/silicon-power-ddr5-64gb-6000mhz/
  B0GN5MSZXJ: 'Silicon Power is a Taiwanese value brand, and this is 64GB at 6000 for less than the enthusiast names charge. What you give up is mostly reputation: the modules use the same few memory die suppliers as everyone else, but the binning, support, and community track record are thinner. For a capacity-heavy build on a budget it is a reasonable gamble. Confirm the profile type on the listing matches your platform before assuming it will hit 6000.',
  // Acer Predator Vesta II RGB 32GB 6000
  // /ram/acer-predator-vesta-ii-rgb-ddr5-ram-32gb-6000mhz/
  B0CRNNVYM2: 'Acer\'s memory is made by BIWIN, and the Vesta II is its RGB DDR5 line: a lit heatspreader, 6000 MT/s, and pricing that is often aggressive because the brand is still earning trust in this category. Reviews have been kind to the underlying modules. The lighting works with the major motherboard RGB tools rather than a dedicated app. Worth a look when the big names are priced above their history and this one is not.',

  // ---- PRICE-RECORD BLURBS, batch 1, added 2026-10-04. Every figure is a
  // recorded price on a named date, a change between two named dates, a median
  // for a completed or explicitly partial year, or a verdict quoted from
  // ath-classification.json. See the rule set at the top of this file.
  // Samsung 990 PRO 2TB
  // /ssd/samsung-990-pro-2tb/
  B0BXX1JJH8: 'Samsung\'s listing for this drive states a 1,200 TBW endurance rating and a five-year warranty, details a price chart does not show. Our price record starts in July 2023. The median recorded price was about $191 over the tracked portion of 2023, $211 in 2024 and $179 in 2025. Of those three periods, 2025 had the lowest median.',
  // Samsung 870 EVO 1TB 2.5in SATA
  // /ssd/samsung-870-evo-1tb-2-5in-sata-iii/
  B08W5TLTL2: 'This listing is the 2.5-inch SATA version of Samsung\'s 870 EVO, tracked here since the end of December 2024. The median recorded price in 2025 was about $109, and from July 8 to October 16 that year the price made no real move. December was different: the recorded price rose from $149 on December 12 to $225 on December 15, then fell to $169 the next day.',
  // Crucial Pro 64GB DDR5 5600
  // /ram/crucial-pro-64gb-ddr5-ram-kit-5600mhz/
  B0C79H54TQ: 'Two 32GB modules, 64GB in total. The median recorded price was about $186 for the part of 2023 we tracked, $160 in 2024 and $190 in 2025. The $1,087.99 recorded on September 23, 2026 deserves a note. Our classification for that day shows Amazon had no offer, and a marketplace seller\'s price was the one recorded.',
  // Corsair Vengeance DDR5 32GB 6000 CL36
  // /ram/corsair-vengeance-ddr5-ram-32gb-6000mhz/
  B0CJ8ZHMVF: 'The title lists both AMD EXPO and Intel XMP 3.0 profiles for this 2x16GB kit. Its price record is easiest to read as two dated points. On November 23, 2024 we recorded $92.99. On October 1, 2026 we recorded $771.52, up from $567.99 the day before, and by October 3 it was $580. In between, the median recorded price went from about $115 in 2024 to about $205 in 2025.',
  // Corsair Vengeance LPX DDR4 32GB 3200
  // /ram/corsair-vengeance-lpx-ddr4-ram-32gb-3200mhz/
  B07RW6Z692: 'MemRadar has tracked this kit since June 2019. Over the months we tracked that year its median recorded price was about $180, and we recorded $277.27 on December 4, 2019. By 2024 the median was about $60, and on May 5, 2025 we recorded $47.49. On October 4, 2026 the recorded price was above $240, still below the $277.27 observation from December 2019.',
  // Lexar NM790 4TB Gen4
  // /ssd/lexar-4tb-nm790-ssd-pcie-gen4-nvme-m-2/
  B0C91RNCDV: 'Lexar lists this 4TB Gen4 drive as PS5 compatible, with read speeds up to 7,400 MB/s. Its yearly median price rose each year from 2023 to 2025: about $198 in the second half of 2023, $263 in 2024 and $288 in 2025. A sharper move came just after that. Between January 5 and January 7, 2026 the recorded price went from $399.99 to $615.13.',
  // Samsung 990 EVO Plus 4TB
  // /ssd/samsung-990-evo-plus-ssd-4tb/
  B0DHLBDSP7: 'For 2025, the record of this 4TB drive shows a median price of $255, with $199.99 recorded on October 7. May 2026 looks very different in the series: $1,049.99 on May 17, $649.87 on May 18 and 19, then $1,049.99 again on May 20.',
  // Samsung 990 PRO 4TB
  // /ssd/samsung-990-pro-4tb-pcie-gen-4-0-x4/
  B0CHRSJ4LR: 'This listing\'s record begins on December 15, 2025 at $453.51. By February 24, 2026 the recorded price was $729.99. Between April 21 and July 21, 2026 the series contains no in-stock observation; the recorded prices on either side of that gap were $965.00 and $899.88. Only four of its observations fall in 2025.',
  // Samsung 990 PRO 2TB (MZ-V9P2T0BW)
  // /ssd/samsung-990-pro-nvme-m-2-ssd-2tb/
  B0B9C4DKKG: 'The September 2026 spike on this chart needs context. Between September 14 and September 22 the recorded price went from $374.95 to $1,299.99. Our classification for September 22 shows Amazon itself had no offer, and the recorded price came from a marketplace seller. The figure is a third-party asking price during a gap in Amazon\'s own offer, not a price Amazon charged. For 2023, 2024 and 2025 the median recorded prices were about $198, $190 and $178.',
  // Corsair Vengeance RGB DDR5 32GB 6000 CL36, white
  // /ram/corsair-vengeance-rgb-ddr5-ram-32gb-6000mhz/
  B0CDY46PFK: 'The white RGB version of Corsair\'s 6000MHz CL36 kit, listed with an Intel XMP 3.0 profile and no mention of AMD EXPO. The median recorded price stayed within ten dollars across late 2023, 2024 and 2025: about $105, $115 and $111. That 2025 figure hides how the year ended. Between November 13 and December 4, 2025 the recorded price went from $226.99 to $499.99.',

  // ---- PRICE-RECORD BLURBS, batch 2, added 2026-10-05. Same rule set as
  // batch 1: every figure is a recorded price on a named date, a change between
  // two named dates, a median for a completed year, or a verdict quoted from
  // ath-classification.json. Nine cite a classification; two of those are
  // class (a), where Amazon's own series carried the high.
  // G.SKILL RipjawsV DDR4 16GB 3200, 1x16GB
  // /ram/g-skill-ripjawsv-series-ddr4-ram-16gb-3200mhz-2/
  B0171GQXME: 'This listing is a single 16GB module (1x16GB). Its yearly median price in our record peaked at about $183 in 2018, then fell in every year but one through 2025: $94, $71, $85, $65, $43, $35 and $33. The $237.42 recorded on December 12, 2017 sits between $180.00 on December 4 and $219.99 on December 13. Our classification for December 12 shows Amazon had no offer that day, and a marketplace seller\'s price was the one recorded.',
  // G.SKILL RipjawsV DDR4 32GB 3200
  // /ram/g-skill-ripjawsv-series-ddr4-ram-32gb-3200mhz/
  B0171GQR0C: 'For the ten completed calendar years from 2016 through 2025, the median recorded prices were about $188, $265, $344, $170, $119, $140, $116, $65, $54 and $69. On January 8, 2018 we recorded $439.78. We also recorded $429.78 on January 3 and $437.08 on January 12. For January 8 itself, our classification shows Amazon had no offer and a marketplace seller\'s price was recorded.',
  // Intel 660p 1TB NVMe
  // /ssd/intel-660p-series-m-2-2280-1tb-pcie-nvme/
  B07GCL6BR4: 'Intel\'s listing describes this as a QLC drive on PCIe NVMe 3.0 x4. From 2019 through 2025 its yearly median price stayed between about $84 and $126: $114, $126, $116, $84, $101, $104 and $115. Its first weeks on record looked different. We recorded $199.00 on October 20, 2018, $268.47 on October 25 and $199.00 again on October 27. Our classification for October 25 shows Amazon had no offer that day.',
  // PNY CS900 2TB SATA
  // /ssd/pny-cs900-2tb-3d-nand-2-5-sata-iii/
  B08GB8S6R3: 'The recorded price of this drive was $189.99 on January 10, 2021 and $479.99 on January 19. It was $478.98 on January 26 and $218.49 the next day. Our classification for January 19 shows Amazon had no offer, and the price recorded was a marketplace seller\'s. The yearly medians for the same drive: about $207 in 2021, $157 in 2022, $97 in 2023, $122 in 2024 and $100 in 2025.',
  // Samsung 860 EVO 2TB SATA
  // /ssd/samsung-ssd-860-evo-2tb-2-5-inch-sata/
  B0786QNSBD: 'In March 2018 the recorded price of this drive climbed over four days, from $699.99 on March 23 to $896.95 on March 26, and was $604.87 the day after. Our classification for March 26 shows Amazon had no offer. In August 2021 it went from $801.85 to $399.99 between the 11th and the 13th, and was back at $801.85 by the 20th. Away from those weeks, the yearly medians were about $300, $290 and $299 from 2019 through 2021, and about $240, $241 and $236 from 2023 through 2025.',
  // Samsung 870 EVO 500GB SATA
  // /ssd/samsung-ssd-870-evo-500gb/
  B08PC43D78: 'For four years the yearly median price of this 500GB drive moved between about $63 and $127: $71 in 2022, $63 in 2023, $127 in 2024 and $69 in 2025. In September 2026 we recorded $306.00 on September 22, $310.52 on September 25 and $309.00 on September 28. Our classification for September 25 shows Amazon had no offer that day, and the recorded price was a marketplace seller\'s.',
  // WD Green SN350 2TB NVMe
  // /ssd/western-digital-2tb-wd-green-sn350-nvme/
  B09DVRBNWV: 'The title lists this as a QLC drive on Gen3 PCIe, rated up to 3,200 MB/s. Its yearly median price was about $170 in 2022, $90 in 2023 and $115 in both 2024 and 2025. In January and February 2026 the recorded price went from $231.00 on January 23 to $437.49 on January 24, was $441.42 on February 3, and $266.33 on February 4. For February 3 our classification shows Amazon had no offer and a marketplace seller\'s price was recorded.',
  // WD_Black SN850X 4TB NVMe, heatsink
  // /ssd/western-digital-wd-black-sn850x-4tb-nvme/
  B0D9WTKV1B: 'The $1,249.99 recorded on March 23, 2026 was Amazon\'s own price. Our classification marks it as a genuine Amazon first-party high. Two days earlier we had recorded $838.81, and two days later $699.99. For comparison, the median recorded price across 2025 was about $320.',
  // Samsung 990 PRO 2TB, heatsink
  // /ssd/samsung-990-pro-w-heatsink-ssd-2tb/
  B0BHJDY57J: 'Samsung\'s listing gives this heatsink version as PlayStation 5 compatible. Its median recorded price was about $189 in 2024 and $180 in 2025. On April 16, 2026 the recorded price reached $669.99, up from $506.78 the day before, and our classification shows that was Amazon\'s own price: Amazon\'s series moved to $669.99 during the day, showed no offer for part of the day, and returned at $669.99. A $250 step then appears twice that summer: $669.99 to $419.99 on July 28, and $419.99 back to $669.99 on August 3.',
  // Samsung 990 EVO Plus 2TB
  // /ssd/samsung-990-evo-plus-ssd-2tb/
  B0DHLCRF91: 'The title lists two interface modes for this drive, PCIe Gen 4x4 and Gen 5x2. Across 2025 its median recorded price was about $140. The $579.99 recorded on May 4, 2026 was Amazon\'s own price according to our classification. Later that year we recorded $369.99 on August 30, $579.99 on August 31 and $369.99 on September 1.',
  // Crucial 16GB DDR4 3200 SODIMM (laptop)
  // /ram/crucial-16gb-ddr4-ram-3200mhz/
  B08C511GQH: 'This listing is 16GB of SODIMM 260-pin laptop memory at 3200MHz CL22. Its median recorded price fell from about $86 in 2021 to $70 in 2022 and $36 in 2023, was $37 in 2024, and $60 in 2025. In December 2025 we recorded $105.99 on the 19th, $59.99 on the 20th and $99.99 on the 21st.',
  // Samsung 990 PRO 1TB NVMe
  // /ssd/samsung-ssd-990-pro-1tb/
  B0BHJF2VRN: 'Samsung\'s title for this 1TB drive gives PCIe 4.0, M.2 2280 and speeds up to 7,450 MB/s. Its median recorded price was about $118 in 2024 and $117 in 2025. In July 2023 we recorded $59.99 on July 11, $89.95 on July 12, $59.99 on July 13, $89.93 on July 14, $88.80 on July 15 and $59.99 on July 16.',
  // Samsung 870 QVO 8TB SATA
  // /ssd/samsung-870-qvo-sata-iii-ssd-8tb-2-5/
  B089C3TZL9: 'On May 4, 2026 we recorded $1,770.63 for this 8TB SATA drive, and $2,399.99 the next day. Earlier that year we recorded $999.99 on January 22, $755.99 on January 23 and $982.99 on January 24. For the five completed years from 2021 through 2025 its median recorded prices were about $800, $720, $400, $612 and $672.',
  // Samsung 9100 PRO 2TB NVMe
  // /ssd/samsung-ssd-9100-pro-2tb/
  B0DX2DPJZ5: 'Samsung\'s title lists this 2TB drive as PCIe 5.0 x4, M.2 2280, with sequential read speeds up to 14,700MB/s. We have tracked it since March 2025, and the median recorded price over the tracked part of that year was about $220. In January 2026 we recorded $237.52 on the 12th, $378.95 on the 13th, $283.24 on the 14th and $340.49 on the 15th.',
  // Samsung 860 PRO 2TB SATA
  // /ssd/samsung-ssd-860-pro-2tb-2-5-inch-sata/
  B07879KC15: 'Samsung\'s 860 PRO in the 2TB, 2.5-inch SATA III version. Its yearly median price did not move in one direction: about $380 in 2021, $580 in 2022, $758 in 2023, $500 in 2024 and $425 in 2025. In February 2022 we recorded $379.99 on the 8th, $850.00 on the 9th and $439.99 on the 10th.',
  // Samsung 870 EVO 2TB SATA
  // /ssd/samsung-ssd-870-evo-sata-iii-2-5-2tb/
  B08QB93S6R: 'The title for this 2TB SATA III drive gives read speeds up to 560MB/s. Its median recorded prices for the five completed years from 2021 through 2025 were about $300, $190, $127, $172 and $170. In December 2025 we recorded $224.99 on the 18th, $349.99 on the 19th and $189.99 on the 20th.',
  // TEAMGROUP Vulcan Z DDR4 16GB 3200
  // /ram/teamgroup-t-force-vulcan-z-ddr4-dram-16gb-3200mhz/
  B08PJNVWNZ: 'In the week of January 10, 2022 we recorded $95.48 on the 10th, $57.99 on the 11th, $139.49 on the 12th, $99.98 on the 13th and $57.99 on the 14th for this kit. It is listed as two 8GB desktop modules at 3200MHz CL16, in gray. Its median recorded price was about $77 in 2021, $51 in 2022 and $36 in both 2023 and 2024.',
  // Crucial T500 1TB NVMe
  // /ssd/crucial-t500-pcie-gen4-nvme-1tb-ssd/
  B0CK39YR9V: 'Crucial\'s title lists this 1TB drive as PCIe Gen4 NVMe with TLC NAND and speeds up to 7,300MB/s. Its median recorded price was about $90 in 2024 and $94 in 2025. In April 2026 we recorded two moves from $199.99 to $268.92: April 19 to April 20, and April 24 to April 25.',
  // Crucial 32GB DDR4 3200 SODIMM (laptop)
  // /ram/crucial-32gb-ddr4-ram-kit-3200mhz/
  B08C4X9VR5: 'Laptop memory: two 16GB SODIMM 260-pin modules at 3200MHz CL22. For the five completed years from 2021 through 2025 the median recorded prices were about $162, $122, $73, $66 and $113. In April 2026 we recorded $256.98 on the 20th, $120.88 on the 21st and $249.99 on the 22nd.',
};
