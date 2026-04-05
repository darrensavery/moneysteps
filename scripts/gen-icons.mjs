/**
 * Generates PWA icons from the source SVG mark.
 * Outputs transparent-background PNGs for icon-192.png and icon-512.png.
 * Run: node scripts/gen-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath   = path.join(__dirname, '../dist/icons/morechard mark.svg');
const outDir    = path.join(__dirname, '../dist/icons');

const svg = readFileSync(svgPath);

const sizes = [
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
];

for (const { size, file } of sizes) {
  await sharp(svg)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, file));
  console.log(`✓ ${file} (${size}×${size})`);
}
