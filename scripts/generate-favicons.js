const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const SVG = fs.readFileSync(path.join(__dirname, '../frontend/favicon-source.svg'));
const OUT = path.join(__dirname, '../frontend');

async function generate() {
  const pngs = [
    { name: 'favicon-16x16.png',          size: 16  },
    { name: 'favicon-32x32.png',          size: 32  },
    { name: 'apple-touch-icon.png',        size: 180 },
    { name: 'android-chrome-192x192.png',  size: 192 },
    { name: 'android-chrome-512x512.png',  size: 512 },
  ];

  for (const { name, size } of pngs) {
    const info = await sharp(SVG)
      .resize(size, size)
      .png()
      .toFile(path.join(OUT, name));
    console.log(`✓ ${name} — ${info.width}×${info.height}px`);
  }

  // ICO: embed 16×16 and 32×32
  const [buf16, buf32] = await Promise.all([
    sharp(SVG).resize(16,  16).png().toBuffer(),
    sharp(SVG).resize(32,  32).png().toBuffer(),
  ]);
  const ico = await toIco([buf16, buf32]);
  fs.writeFileSync(path.join(OUT, 'favicon.ico'), ico);
  console.log(`✓ favicon.ico — 16×16 + 32×32 embedded`);
}

generate().catch(err => { console.error(err); process.exit(1); });
