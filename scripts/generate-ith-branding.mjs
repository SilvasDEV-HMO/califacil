/**
 * Genera wordmark I.T.H. y actualiza assets que tenían branding SEC Sonora.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const root = process.cwd();
const publicDir = path.join(root, 'public');

const ithWordmarkSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="128" viewBox="0 0 480 128">
  <rect width="480" height="128" fill="#000000"/>
  <text x="240" y="82" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="72" font-weight="800" fill="#F97316" letter-spacing="4">I.T.H.</text>
</svg>`;

const printBannerSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="220" viewBox="0 0 1400 220">
  <rect width="1400" height="220" fill="#000000"/>
  <text x="48" y="130" font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="64" font-weight="800" fill="#F97316">CALIFÁCIL</text>
  <rect x="520" y="40" width="2" height="140" fill="#ffffff" opacity="0.55"/>
  <text x="560" y="130" font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="72" font-weight="800" fill="#F97316" letter-spacing="6">I.T.H.</text>
</svg>`;

async function writePng(fileName, svg) {
  const out = path.join(publicDir, fileName);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log('Wrote', fileName);
}

await writePng('ith-wordmark.png', ithWordmarkSvg);
await writePng('gobierno-sonora-logo.png', ithWordmarkSvg);
await writePng('print-header-banner.png', printBannerSvg);

// Keep script paths working if anyone regenerates old names.
const scripts = [
  path.join(root, 'scripts', 'knockout-logo-black.mjs'),
  path.join(root, 'scripts', 'knockout-print-banner.mjs'),
];
for (const file of scripts) {
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  // No rewrite of scripts required for runtime; assets already replaced.
  void src;
}

console.log('Branding assets updated to I.T.H.');
