// Generate all required app icons from a single source image using sharp
// Usage:
// 1) Save your source square PNG at public/icon-source.png (1024x1024 recommended; >=512x512 works)
// 2) Run: npm run generate:icons
// 3) Rebuild: npm run build

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('png-to-ico');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SRC = path.join(PUBLIC, 'icon-source.png');

async function ensureSource() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Missing ${path.relative(ROOT, SRC)}. Place your neon logo there (PNG, square).`);
  }
}

async function makeIcon(size, outName, opts = {}) {
  const outPath = path.join(PUBLIC, outName);
  await sharp(SRC)
    .resize({ width: size, height: size, fit: 'cover', withoutEnlargement: false })
    .png({ compressionLevel: 9, progressive: true, quality: 90 })
    .toFile(outPath);
  console.log('✓', outName, `${size}x${size}`);
}

async function main() {
  await ensureSource();

  // PWA icons (manifest.json references logo192.png and logo512.png)
  await makeIcon(192, 'logo192.png');
  await makeIcon(512, 'logo512.png');

  // Apple touch icon
  await makeIcon(180, 'apple-touch-icon.png');

  // Favicons (png variants). Keep existing favicon.ico for legacy.
  await makeIcon(32, 'favicon-32.png');
  await makeIcon(16, 'favicon-16.png');

  // ICO (multi-size) for broad browser support
  const icoPng32 = path.join(PUBLIC, 'favicon-32.png');
  const icoPng16 = path.join(PUBLIC, 'favicon-16.png');
  const icoBuf = await toIco([icoPng16, icoPng32]);
  await fs.promises.writeFile(path.join(PUBLIC, 'favicon.ico'), icoBuf);
  console.log('✓ favicon.ico');

  // Optional extra sizes—uncomment if you want more variety
  // await makeIcon(256, 'icon-256.png');
  // await makeIcon(384, 'icon-384.png');

  console.log('\nAll icons generated into public/. Rebuild the app to use them.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
