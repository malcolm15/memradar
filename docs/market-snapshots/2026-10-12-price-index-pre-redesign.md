# Price Index snapshot before the Phase 2 redesign

Captured 2026-10-12T22:38:41.812Z from https://memradar.com/price-index/ while the site was serving commit
`5b27c4d6fbf6e14d76268056799c42935c04f4a4` (the 2026-10-12 19:19 UTC regen). The served HTML was
byte-identical to `frontend/price-index/index.html` at that commit (`cmp` exit 0, no normalisation).

This file is the before side of the Batch B word-count and content comparison. Do not edit it.

## Word counts

| view | words |
|---|---|
| served HTML, JavaScript off, as a crawler receives it (scripts, styles and comments stripped) | 799 |
| hydrated page, JavaScript on, `document.body.innerText` after networkidle plus 2.5 s | 746 |
| hydrated `<main>` only | 659 |

The JS-off count is higher than the hydrated count because it includes the hidden mobile nav links and the
`<title>`, which `innerText` omits.

## Meta, Open Graph and Twitter descriptions

| field | value |
|---|---|
| `<title>` | RAM & SSD Price Index: Memory Price Trends | MemRadar |
| `og:title` | The MemRadar Memory Price Index |
| `meta description` | DDR5 is up +269.8% year over year. Median price changes across 235 tracked RAM and SSD products, from live price history. Updated daily. |
| `og:description` | DDR5 is up +269.8% year over year. Median price changes across 235 tracked RAM and SSD products, from live price history. Updated daily. |
| `twitter:description` | DDR5 is up +269.8% year over year. Median price changes across 235 tracked RAM and SSD products, from live price history. Updated daily. |

## JSON-LD, verbatim

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Dataset",
      "@id": "https://memradar.com/data/#dataset",
      "name": "MemRadar Memory Price Index",
      "url": "https://memradar.com/data/",
      "description": "Median retail price levels and median price changes for DDR5, DDR4, NVMe SSD and SATA SSD segments, computed from daily price observations across the RAM and SSD products MemRadar tracks. Monthly levels are published as CSV and current segment medians as JSON.",
      "creator": {
        "@type": "Organization",
        "name": "MemRadar",
        "url": "https://memradar.com/"
      },
      "isAccessibleForFree": true,
      "license": "https://memradar.com/data/#how-to-cite",
      "creditText": "MemRadar Memory Price Index, memradar.com/price-index/",
      "temporalCoverage": "2019-11/2026-09",
      "variableMeasured": [
        {
          "@type": "PropertyValue",
          "name": "DDR5 median price change"
        },
        {
          "@type": "PropertyValue",
          "name": "DDR4 median price change"
        },
        {
          "@type": "PropertyValue",
          "name": "NVMe SSD median price change"
        },
        {
          "@type": "PropertyValue",
          "name": "SATA SSD median price change"
        }
      ],
      "distribution": [
        {
          "@type": "DataDownload",
          "name": "Monthly price levels by segment (CSV)",
          "contentUrl": "https://memradar.com/data/memradar-price-index-monthly.csv",
          "encodingFormat": "text/csv"
        },
        {
          "@type": "DataDownload",
          "name": "Segment medians and period changes (JSON)",
          "contentUrl": "https://memradar.com/data/raycast-v1-market.json",
          "encodingFormat": "application/json"
        }
      ],
      "dateModified": "2026-10-12"
    },
    {
      "@type": "WebPage",
      "name": "The MemRadar Memory Price Index",
      "url": "https://memradar.com/price-index/"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": "https://memradar.com/"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Price Index",
          "item": "https://memradar.com/price-index/"
        }
      ]
    }
  ]
}
```

## Served text, JavaScript off

RAM & SSD Price Index: Memory Price Trends | MemRadar Mem Radar RAM SSDs FAQ Blog Set an Alert RAM SSDs FAQ Blog The MemRadar Memory Price Index Median price changes across 235 tracked RAM and SSD products, computed from live price history and updated daily. Last computed October 12, 2026 Or browse the tracked products themselves: RAM Price Tracker · SSD Price Tracker Segment 1 month 3 months 6 months 1 year DDR5 +4.9% +16% +19.6% +269.8% DDR4 +0% +3.4% -5% +114.3% NVMe SSD +3.6% +7.2% +5.1% +130.8% SATA SSD +2.8% +4.2% +29.9% +153.3% Scroll the table sideways to see every period. Last computed October 12, 2026 · median-based · per-period fairness subsets Notable numbers DDR5 prices are up +269.8% versus a year ago , the steepest rise of any segment we track. Every segment is up more than 90% year over year. The memory and storage market has not returned to its pre-2026 pricing. 3 of 235 tracked products sit within 5% of their all-time low , the closest thing to a buying opportunity in the current market. The index draws on 75,275 daily price points , the deepest series running back to 2015. What a build's memory and storage costs The index above measures change. This measures level: what a fixed basket of parts cost, added up. In September 2026 , the memory and storage for a current build (a 32GB DDR5-6000 kit, a 1TB NVMe drive and a 2TB NVMe drive) cost $1,066 . The same parts around a DDR4 board (a 32GB DDR4-3200 kit and a 1TB NVMe drive) cost $410 . Against the same month a year earlier, the current build is up more than 210% and the DDR4 build is up more than 130% . These are regular Amazon listing prices, not deals. Each month's figure is fixed once that month ends; the current month is not shown. From $295.19 at the lowest to $1065.79 at the highest over the period The full series, the basket definitions and what the figures do not tell you , back to January 2023. Methodology The summary below covers the index itself. How MemRadar tracks prices is the full reference: where the data comes from, how every figure is calculated, and what it cannot tell you. Every figure is a median , not an average. A single mispriced listing at $1,900 drags a mean badly in a segment of thirty products; the median reports the typical price and stays stable as the catalog changes. Each period compares the same set of products in both timeframes . A product only counts toward a period if we have both a current price and a price from that period's baseline window, and both medians are computed over that same subset. Products added recently cannot distort a one-year figure by appearing on only one side of it. Subset sizes differ between periods for this reason, and that is the honest result rather than a flaw. Figures over longer windows rest on smaller, older product sets, since a product only counts if we tracked it that far back. As the catalog grows, a long-window figure can move when its cohort changes, independently of any price movement. Amazon price history is licensed from Keepa ; Newegg pricing comes from an official Rakuten Advertising product feed. Prices refresh every few hours and the index is recomputed daily. The catalog holds 235 products, 119 memory and 116 storage, with the deepest price history running back to 2015. Citing this data This data may be referenced and quoted with attribution. Suggested attribution line: Source: MemRadar Memory Price Index, memradar.com/price-index/ If you are citing this data for a story, our data page for journalists and researchers carries current findings, citation guidance, and custom cuts on request. A monthly series of segment medians is available as a CSV download ; it reports price levels, not the period changes in the table above. For questions about methodology or figures, email hello@memradar.com . Explore the data Browse every tracked product on the RAM price tracker and the SSD price tracker , or look at individual histories: G.SKILL RipjawsV Series DDR4 RAM 32GB , tracked since 2015 Samsung 960 EVO Series - 250GB PCIe NVMe , tracked since 2016 Samsung SSD 860 EVO 2TB 2.5 Inch SATA , tracked since 2018 MemRadar · RAM & SSD price tracking for PC builders. Track prices RAM SSDs Price Index Raycast extension Research Guides Blog Glossary Methodology Data Build cost RSS Site About FAQ Contact Legal Affiliate Disclosure Privacy Terms MemRadar participates in Newegg's affiliate program via Rakuten Advertising. Links to Newegg may be affiliate links. If you purchase through them, we may earn a small commission at no extra cost to you. Links to Amazon are not affiliate links. © 2026 MemRadar

## Hydrated text, JavaScript on

MemRadar RAM SSDs FAQ Blog Set an Alert The MemRadar Memory Price Index Median price changes across 235 tracked RAM and SSD products, computed from live price history and updated daily. Last computed October 12, 2026 Or browse the tracked products themselves: RAM Price Tracker · SSD Price Tracker SEGMENT 1 MONTH 3 MONTHS 6 MONTHS 1 YEAR DDR5 +4.9% +16% +19.6% +269.8% DDR4 +0% +3.4% -5% +114.3% NVMe SSD +3.6% +7.2% +5.1% +130.8% SATA SSD +2.8% +4.2% +29.9% +153.3% Last computed October 12, 2026 · median-based · per-period fairness subsets Notable numbers DDR5 prices are up +269.8% versus a year ago, the steepest rise of any segment we track. Every segment is up more than 90% year over year. The memory and storage market has not returned to its pre-2026 pricing. 3 of 235 tracked products sit within 5% of their all-time low, the closest thing to a buying opportunity in the current market. The index draws on 75,275 daily price points, the deepest series running back to 2015. What a build's memory and storage costs The index above measures change. This measures level: what a fixed basket of parts cost, added up. In September 2026, the memory and storage for a current build (a 32GB DDR5-6000 kit, a 1TB NVMe drive and a 2TB NVMe drive) cost $1,066. The same parts around a DDR4 board (a 32GB DDR4-3200 kit and a 1TB NVMe drive) cost $410. Against the same month a year earlier, the current build is up more than 210% and the DDR4 build is up more than 130%. These are regular Amazon listing prices, not deals. Each month's figure is fixed once that month ends; the current month is not shown. The full series, the basket definitions and what the figures do not tell you, back to January 2023. Methodology The summary below covers the index itself. How MemRadar tracks prices is the full reference: where the data comes from, how every figure is calculated, and what it cannot tell you. Every figure is a median, not an average. A single mispriced listing at $1,900 drags a mean badly in a segment of thirty products; the median reports the typical price and stays stable as the catalog changes. Each period compares the same set of products in both timeframes. A product only counts toward a period if we have both a current price and a price from that period's baseline window, and both medians are computed over that same subset. Products added recently cannot distort a one-year figure by appearing on only one side of it. Subset sizes differ between periods for this reason, and that is the honest result rather than a flaw. Figures over longer windows rest on smaller, older product sets, since a product only counts if we tracked it that far back. As the catalog grows, a long-window figure can move when its cohort changes, independently of any price movement. Amazon price history is licensed from Keepa; Newegg pricing comes from an official Rakuten Advertising product feed. Prices refresh every few hours and the index is recomputed daily. The catalog holds 235 products, 119 memory and 116 storage, with the deepest price history running back to 2015. Citing this data This data may be referenced and quoted with attribution. Suggested attribution line: Source: MemRadar Memory Price Index, memradar.com/price-index/ If you are citing this data for a story, our data page for journalists and researchers carries current findings, citation guidance, and custom cuts on request. A monthly series of segment medians is available as a CSV download; it reports price levels, not the period changes in the table above. For questions about methodology or figures, email hello@memradar.com. Explore the data Browse every tracked product on the RAM price tracker and the SSD price tracker, or look at individual histories: G.SKILL RipjawsV Series DDR4 RAM 32GB, tracked since 2015 Samsung 960 EVO Series - 250GB PCIe NVMe, tracked since 2016 Samsung SSD 860 EVO 2TB 2.5 Inch SATA, tracked since 2018 MemRadar · RAM & SSD price tracking for PC builders. TRACK PRICES RAM SSDs Price Index Raycast extension RESEARCH Guides Blog Glossary Methodology Data Build cost RSS SITE About FAQ Contact LEGAL Affiliate Disclosure Privacy Terms MemRadar participates in Newegg's affiliate program via Rakuten Advertising. Links to Newegg may be affiliate links. If you purchase through them, we may earn a small commission at no extra cost to you. Links to Amazon are not affiliate links. © 2026 MemRadar
