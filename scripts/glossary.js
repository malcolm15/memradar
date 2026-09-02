// MemRadar spec glossary. SOURCE OF TRUTH for the per-product "Specs explained"
// pulls and for /glossary/.
//
// WORDING IS VERBATIM from the authored source and must stay that way. Each
// definition is written to stand alone if quoted in isolation (subject named, no
// dangling "it") and to end with a buyer-facing implication that differs per
// term rather than a shared framing clause. No em dashes.
//
// `when(ctx)` decides whether a term is pulled onto a product page. A term is
// pulled ONLY when that product's parsed specs or detected name tokens include
// it. NEVER render the whole glossary on a product page: the point of the block
// is that its membership differs per product, and a fixed list of 23 entries
// repeated 235 times is the scaled-content pattern R1 removed.
//
// ctx: { p, stats, segment, ram, ssd, cap, speed, cl, kit, ff, name (lowercased),
//        hasValueMetric, hasExtremes, hasAvg90 }
//
// PDP_PULL: entries marked `pdp: false` live on /glossary/ ONLY and are never
// pulled onto a product page. The three price terms are marked that way because
// they applied to almost every product, which pushed the median pull to 8 terms
// with 3 of them identical site-wide. A block whose membership barely varies is
// the template shape R2 exists to avoid, so the price terms stay where they have
// one canonical home and the PDP block carries only what THIS product's specs
// and name tokens actually contain.
// ---- pull predicates -------------------------------------------------------
// Each returns true when the product genuinely carries that spec or token.
// RAM generation / interface come from the parsers; the rest are name tokens,
// which is why `name` is pre-lowercased by the caller.
const WHEN_ddr4 = (c) => c.ram === 'DDR4';
const WHEN_ddr5 = (c) => c.ram === 'DDR5';
const WHEN_speed = (c) => !!c.ram && c.speed != null;
const WHEN_cas_latency = (c) => !!c.cl;
const WHEN_xmp = (c) => /\bxmp\b/.test(c.name);
const WHEN_expo = (c) => /\bexpo\b/.test(c.name);
const WHEN_kit_configuration = (c) => !!c.kit;
const WHEN_udimm_sodimm = (c) => /\b(so-?dimm|u-?dimm)\b/.test(c.name);
const WHEN_nvme = (c) => c.ssd === 'NVMe';
const WHEN_sata = (c) => c.ssd === 'SATA';
const WHEN_m2_2280 = (c) => c.ff === 'M.2' || /\b2280\b/.test(c.name);
const WHEN_two_point_five_inch = (c) => c.ff === '2.5"';
const WHEN_pcie_generation = (c) => /\b(pcie|pcle)\s*(gen\s*)?[345]\b|\bgen\s*[345]\b|\bgen[345]x?\d?\b/.test(c.name);
const WHEN_tlc = (c) => /\btlc\b/.test(c.name);
const WHEN_qlc = (c) => /\bqlc\b/.test(c.name);
const WHEN_dram_cache = (c) => /dram.?less|\bhmb\b|dram cache|with dram/.test(c.name);
const WHEN_slc_cache = (c) => /slc\s*cache/.test(c.name);
const WHEN_tbw = (c) => /\btbw\b/.test(c.name);
// Only when the listing actually quotes a transfer rate, not merely because the
// product is an SSD; otherwise this would land on nearly every drive page.
const WHEN_sequential_speeds = (c) => !!c.ssd && /\d[\d,.]*\s*(mb|gb)\/s/.test(c.name);
const WHEN_heatsink = (c) => /heat\s?sink/.test(c.name);
// The three price terms are gated on the page ACTUALLY SHOWING the figure, the
// same conditionality R1 applied to the stats card and Price Analysis. A page
// whose 90-day average was withheld for want of data does not explain it.
const WHEN_price_per_gb = (c) => c.hasValueMetric;
const WHEN_all_time_low_high = (c) => c.hasExtremes;
const WHEN_ninety_day_average = (c) => c.hasAvg90;

module.exports = [
  {
    id: 'ddr4',
    section: 'RAM',
    title: 'DDR4',
    body: 'DDR4 is the memory generation that dominated desktops and laptops from about 2015 until DDR5 arrived in late 2021. DDR4 kits typically run between 2133 and 3600 MT/s and use 288-pin desktop modules or 260-pin laptop modules. DDR4 is not compatible with DDR5 motherboards; the slots are keyed differently. For buyers on an existing DDR4 platform, the practical question is price against the kit\'s own history, since DDR4 pricing has moved independently of DDR5 during the 2025 to 2026 surge.',
    when: WHEN_ddr4,
  },
  {
    id: 'ddr5',
    section: 'RAM',
    title: 'DDR5',
    body: 'DDR5 is the current memory generation, standard on AMD AM5 and Intel LGA1700 and LGA1851 platforms. DDR5 kits start around 4800 MT/s and enthusiast kits run 6000 to 8000 MT/s, with on-module power management and on-die error correction that DDR4 lacks. DDR5 modules do not fit DDR4 boards. DDR5 has been the most price-volatile segment MemRadar tracks, so the kit\'s position against its own 90-day average matters more than the sticker discount.',
    when: WHEN_ddr5,
  },
  {
    id: 'speed',
    section: 'RAM',
    title: 'Speed (MT/s and MHz)',
    body: 'Memory speed is quoted in megatransfers per second (MT/s), though retailers and manufacturers often label the same number as MHz. A DDR5-6000 kit transfers data 6000 million times per second. Higher speed generally helps in memory-sensitive workloads and on AMD Ryzen systems up to the platform\'s sweet spot, beyond which gains shrink. Kits at the same capacity but different speeds are different products with separate price histories, which is why MemRadar tracks them on separate pages.',
    when: WHEN_speed,
  },
  {
    id: 'cas-latency',
    section: 'RAM',
    title: 'CAS latency (CL)',
    body: 'CAS latency, written CL followed by a number such as CL30 or CL36, is the number of clock cycles between a memory request and the start of data delivery. Lower is faster at the same speed. Because faster kits run more cycles per second, a CL36 kit at 6000 MT/s can have similar real latency to a CL30 kit at 5200 MT/s. CL is one of the specs that most often separates two kits that otherwise look identical, and it usually carries a price premium at the low end.',
    when: WHEN_cas_latency,
  },
  {
    id: 'xmp',
    section: 'RAM',
    title: 'XMP',
    body: 'XMP (Extreme Memory Profile) is Intel\'s standard for storing a kit\'s rated speed and timings on the module so a motherboard can apply them with one BIOS setting. Without an XMP or equivalent profile enabled, memory runs at the platform\'s default speed, often well below the kit\'s rating. XMP profiles also work on most AMD boards. A kit advertised at 6000 MT/s is only 6000 MT/s once its profile is enabled.',
    when: WHEN_xmp,
  },
  {
    id: 'expo',
    section: 'RAM',
    title: 'EXPO',
    body: 'EXPO (Extended Profiles for Overclocking) is AMD\'s equivalent of XMP for DDR5, storing rated speed and timings tuned for Ryzen 7000 and later. Many kits carry both XMP and EXPO profiles. For an AM5 build, an EXPO-certified kit is the lower-friction choice, and kits that are otherwise identical except for EXPO certification are sometimes priced differently, which shows up as separate product pages on MemRadar.',
    when: WHEN_expo,
  },
  {
    id: 'kit-configuration',
    section: 'RAM',
    title: 'Kit configuration and dual channel',
    body: 'A memory kit\'s configuration, such as 2x16GB or 1x32GB, is the number of modules and the capacity of each. Two matched modules run in dual-channel mode, which roughly doubles available memory bandwidth compared with a single module of the same total capacity. A 1x16GB module and a 2x8GB kit both provide 16GB but perform differently and cost differently, so MemRadar treats them as separate products.',
    when: WHEN_kit_configuration,
  },
  {
    id: 'udimm-sodimm',
    section: 'RAM',
    title: 'UDIMM and SODIMM',
    body: 'UDIMM is the full-size unbuffered module used in desktops; SODIMM is the shorter module used in laptops and small-form-factor systems. The two are not interchangeable. Desktop DDR5 UDIMMs have 288 pins and laptop DDR5 SODIMMs have 262 pins. A kit listed as "laptop memory" is a SODIMM, and MemRadar\'s product name states Desktop or Laptop wherever a listing\'s title left it ambiguous.',
    when: WHEN_udimm_sodimm,
  },
  {
    id: 'nvme',
    section: 'SSD',
    title: 'NVMe',
    body: 'NVMe (Non-Volatile Memory Express) is the protocol modern SSDs use to talk to the system over PCIe, replacing the older AHCI protocol designed for spinning disks. NVMe drives, almost always in the M.2 form factor, are several times faster than SATA SSDs in sequential transfers and much faster at handling many simultaneous requests. NVMe has become the default for new builds, and its price per gigabyte now overlaps with SATA on many capacities.',
    when: WHEN_nvme,
  },
  {
    id: 'sata',
    section: 'SSD',
    title: 'SATA',
    body: 'SATA (Serial ATA) is the older storage interface, capped at roughly 550 MB/s for SSDs. SATA SSDs come in the 2.5-inch drive shape or as M.2 SATA modules, and they remain useful for older systems, secondary storage, and machines without spare NVMe slots. SATA\'s traditional price advantage over NVMe has narrowed, so a SATA drive is worth buying on its own price history rather than on the assumption that it is the budget option.',
    when: WHEN_sata,
  },
  {
    id: 'm2-2280',
    section: 'SSD',
    title: 'M.2 2280',
    body: 'M.2 is the compact card form factor for SSDs that plugs directly into a motherboard slot, and 2280 describes the dimensions: 22mm wide and 80mm long, the most common size for desktops and laptops. Other lengths exist, notably 2230 for handhelds like the Steam Deck. An M.2 slot may carry NVMe, SATA, or both, and a drive must match what the slot supports.',
    when: WHEN_m2_2280,
  },
  {
    id: 'two-point-five-inch',
    section: 'SSD',
    title: '2.5-inch',
    body: 'A 2.5-inch drive is the laptop-sized rectangular case that SATA SSDs share with laptop hard drives, connected by separate SATA data and power cables. It fits any system with a SATA port and a drive bay. 2.5-inch SSDs are the simplest upgrade path for older desktops and laptops, and they are the form factor most often bought as bulk secondary storage.',
    when: WHEN_two_point_five_inch,
  },
  {
    id: 'pcie-generation',
    section: 'SSD',
    title: 'PCIe generation (Gen3, Gen4, Gen5)',
    body: 'The PCIe generation of an NVMe drive sets its maximum bandwidth: roughly 3.5 GB/s for Gen3, 7 GB/s for Gen4, and 14 GB/s for Gen5 on four lanes. A drive runs at the lower of its own generation and the slot\'s. Gen4 covers gaming and general use with no perceptible difference for most people; Gen5 carries a price premium and runs hot enough to usually need a heatsink. Buying a generation beyond what the workload uses is a common way to overpay for storage.',
    when: WHEN_pcie_generation,
  },
  {
    id: 'tlc',
    section: 'SSD',
    title: 'TLC',
    body: 'TLC (triple-level cell) flash stores three bits per memory cell and is the mainstream NAND type in performance SSDs. TLC balances cost, speed, and endurance, and it holds sustained write speed better than QLC once a drive\'s fast cache fills. Two drives with the same capacity and interface can differ in price mainly because one is TLC and the other QLC.',
    when: WHEN_tlc,
  },
  {
    id: 'qlc',
    section: 'SSD',
    title: 'QLC',
    body: 'QLC (quad-level cell) flash stores four bits per cell, which lowers cost per gigabyte at the expense of slower sustained writes and lower rated endurance. QLC drives perform well for game libraries, media, and general storage, where reads dominate. For scratch disks, video editing, or heavy daily writes, TLC is the safer choice. In a market where every gigabyte costs more, the QLC discount is real money, and it is worth knowing which type a drive uses before comparing prices.',
    when: WHEN_qlc,
  },
  {
    id: 'dram-cache',
    section: 'SSD',
    title: 'DRAM cache and DRAM-less (HMB)',
    body: 'Some SSDs include a small DRAM chip to hold the map of where data lives, which keeps performance steady under heavy use. DRAM-less drives instead borrow a slice of system memory through Host Memory Buffer (HMB), which works well for everyday use and lowers the price. DRAM-less designs are common in budget NVMe drives and are usually fine as a boot or game drive; the difference shows up under sustained mixed workloads.',
    when: WHEN_dram_cache,
  },
  {
    id: 'slc-cache',
    section: 'SSD',
    title: 'SLC cache',
    body: 'Most TLC and QLC SSDs reserve part of their flash to operate in a fast single-level (SLC) mode as a write cache. Writes are quick until that cache fills, after which speed drops to the drive\'s native rate, sometimes sharply on QLC drives. Advertised write speeds usually describe cache speed. The cache size and the speed after it fills matter for anyone regularly copying large files.',
    when: WHEN_slc_cache,
  },
  {
    id: 'tbw',
    section: 'SSD',
    title: 'TBW (endurance)',
    body: 'TBW (terabytes written) is the manufacturer\'s endurance rating: the total amount of data the drive is warranted to write over its life, such as 600 TBW for a typical 1TB TLC drive. Most consumer use never approaches the rating. TBW matters for write-heavy work and for used drives, where the remaining endurance is unknown unless the seller provides SMART data. A higher TBW rating often accompanies a higher price and a longer warranty.',
    when: WHEN_tbw,
  },
  {
    id: 'sequential-speeds',
    section: 'SSD',
    title: 'Sequential read and write speeds',
    body: 'The headline speeds on an SSD listing, such as 7,450 MB/s read, describe large sequential transfers under ideal conditions. They are the numbers that separate PCIe generations, and they are the least representative of everyday use, where small random reads dominate and most modern drives feel similar. Two drives with different headline speeds but the same generation and NAND type usually perform indistinguishably for gaming and desktop work.',
    when: WHEN_sequential_speeds,
  },
  {
    id: 'heatsink',
    section: 'SSD',
    title: 'Heatsink',
    body: 'Some NVMe drives ship with an attached heatsink to keep the controller from throttling under sustained load; others ship bare. Most motherboards include their own M.2 heatsinks, and a drive with a built-in heatsink may not fit under them or in a laptop. Gen5 drives are the ones that most often need cooling. The heatsink version of a drive is a separate product with its own price, which is why MemRadar lists it on its own page.',
    when: WHEN_heatsink,
  },
  {
    id: 'price-per-gb',
    pdp: false, // /glossary/ only, see PDP_PULL note
    section: 'Price terms',
    title: 'Price per GB',
    body: 'Price per gigabyte divides a product\'s current price by its capacity, so a 2TB drive at $200 is $0.10 per GB and a 32GB kit at $160 is $5.00 per GB. It is the most useful way to compare different capacities of the same product line and to judge a drive or kit against its segment. MemRadar compares each product\'s price per GB against the current median for its segment, so "above" or "below" is relative to the market as it stands, not to a fixed threshold.',
    when: WHEN_price_per_gb,
  },
  {
    id: 'all-time-low-high',
    pdp: false, // /glossary/ only, see PDP_PULL note
    section: 'Price terms',
    title: 'All-time low and all-time high',
    body: 'On MemRadar, a product\'s all-time low and all-time high are the lowest and highest prices recorded in its tracked history, which for the longest-tracked products reaches back to 2015. They are bounds, not predictions. During the 2025 to 2026 price surge most products sit far above their all-time low, so a price near the all-time low is rare and worth attention, while a price near the all-time high is a signal to check the 90-day average before buying.',
    when: WHEN_all_time_low_high,
  },
  {
    id: 'ninety-day-average',
    pdp: false, // /glossary/ only, see PDP_PULL note
    section: 'Price terms',
    title: '90-day average',
    body: 'The 90-day average is the mean of a product\'s recorded prices over the past 90 days, and it is the baseline MemRadar\'s buy indicator compares against. A price below the average means the product is cheaper than it has recently been; it does not mean the product is cheap historically. That distinction is the reason the indicator also notes how far the current price sits above the all-time low.',
    when: WHEN_ninety_day_average,
  },
];
