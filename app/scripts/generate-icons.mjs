/**
 * generate-icons.mjs
 *
 * Generates PWA icon PNGs from the brand mark SVG.
 * Run once (or whenever the mark changes):
 *
 *   node app/scripts/generate-icons.mjs
 *
 * Requires: sharp
 *   npm install --save-dev sharp   (or: npm install -g sharp)
 *
 * Output: app/public/icons/
 *   icon-192.png          — standard home-screen icon
 *   icon-512.png          — large splash / store icon
 *   icon-maskable-512.png — Android adaptive icon (safe-zone padded)
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath }  from 'url';
import { dirname, join }  from 'path';

const __dir   = dirname(fileURLToPath(import.meta.url));
const outDir  = join(__dir, '../public/icons');
mkdirSync(outDir, { recursive: true });

// Inline SVG with hardcoded hex (sharp renders SVG without a browser,
// so CSS variables don't resolve — we use the raw brand colours here).
const TEAL   = '#00959c';
const YELLOW = '#e6b222';
const BG     = '#f9f7f2';  // brand parchment — icon background

// The mark path (same as BrandMark in Logo.tsx)
const MARK_PATH = `M427.64,1.69l-202.38,139.41c-.32.25-.66.46-1,.66-.1.06-.2.11-.3.16-.32.16-.64.32-.97.43-.02,0-.03,0-.05.02-.37.13-.75.22-1.13.29-.03,0-.06.01-.1.02-.39.06-.79.1-1.18.1-1.65,0-3.3-.56-4.74-1.67L13.42,1.69C7.64-2.79,0,2.16,0,10.37v421.58c0,5.72,3.89,10.35,8.68,10.35h168.33c5.21,0,9.82-3.37,11.4-8.33.98-3.06,2.13-6.89,3.34-11.35.39-1.44.79-2.95,1.18-4.52.2-.78.4-1.58.6-2.4.4-1.63.8-3.32,1.19-5.07.39-1.75.78-3.55,1.16-5.4.76-3.71,1.49-7.62,2.15-11.7.17-1.02.33-2.05.48-3.09.78-5.21,1.45-10.67,1.94-16.32.1-1.13.19-2.27.27-3.41,2.09-28.61-.6-61.56-15.95-90.46-2.45-4.62-5.23-9.14-8.37-13.53,0,0,27.23,16.74,44.08,54.11,16.85-37.37,44.08-54.11,44.08-54.11-41.71,58.29-20.37,141.01-11.99,167.25,1.58,4.96,6.19,8.32,11.4,8.32h168.37c4.8,0,8.68-4.64,8.68-10.35V10.37c0-8.22-7.64-13.16-13.42-8.68ZM278.05,203.52c8.68-1.11,17.68,2.48,23.07,10.14,5.39,7.65,5.76,17.33,1.79,25.14-8.68,1.11-17.68-2.48-23.07-10.14-5.39-7.65-5.76-17.33-1.79-25.14ZM257.86,182.83c6.09,2.37,10.04,7.85,10.75,13.92-4.62,4-11.24,5.38-17.33,3.02-6.09-2.37-10.04-7.85-10.75-13.92,4.62-4,11.24-5.38,17.33-3.02ZM220.5,174.69c5.02-.02,9.39,2.79,11.6,6.93-2.18,4.16-6.52,7.01-11.54,7.03-5.02.02-9.39-2.79-11.6-6.93,2.18-4.16,6.52-7.01,11.54-7.03ZM138.43,222.92c9.47-3.52,20.53-1.82,28.59,5.38,8.06,7.2,11,17.99,8.57,27.8-9.47,3.52-20.53,1.82-28.59-5.38-8.06-7.2-11-17.99-8.57-27.8ZM123.74,265.47c1.15-6.91,6.46-12.19,13.3-14.15,5.83,4.07,9.15,10.79,8,17.7-1.15,6.91-6.46,12.19-13.3,14.15-5.83-4.07-9.15-10.79-8-17.7ZM191.82,358.95c-8.69,3.37-18.99,1.94-26.68-4.63-7.69-6.56-10.72-16.52-8.74-25.63,8.69-3.37,18.99-1.94,26.68,4.63,7.69,6.56,10.72,16.52,8.74,25.63ZM182.94,308.24c-7.36,8.49-19.08,12.74-30.85,10.05-11.77-2.69-20.47-11.62-23.41-22.47,7.36-8.49,19.08-12.74,30.85-10.05,11.77,2.69,20.47,11.62,23.41,22.47ZM161.78,216.36c-1.43-10.47,2.82-21.36,12.01-27.94,9.18-6.59,20.86-7.12,30.32-2.41,1.43,10.47-2.82,21.36-12.01,27.94-9.18-6.59-20.86-7.12-30.32-2.41ZM186.67,236.75c2.82-12.73,12.45-22.19,24.21-25.42,9.29,7.9,14.02,20.54,11.2,33.27-2.82,12.73-12.45,22.19-24.21,25.42-9.29-7.9-14.02-20.54-11.2-33.27ZM231.53,285.81c-6.01,5.93-14.57,7.68-22.1,5.3-2.27-7.56-.4-16.09,5.62-22.02,6.01-5.93,14.57-7.68,22.1-5.3,2.27,7.56.4,16.09-5.62,22.02ZM239.57,247.8c-9.19-10.21-11.41-24.25-6.98-36.31,12.46-3.13,26.19.54,35.38,10.75,9.19,10.21,11.41,24.25,6.98,36.31-12.46,3.13-26.19-.54-35.38-10.75ZM279.72,349.22c-6.01,9.4-16.53,14.17-26.93,13.31-5.14-9.08-5.23-20.62.78-30.03,6.01-9.4,16.53-14.17,26.93-13.31,5.14,9.08,5.23,20.62-.78,30.03ZM262.83,307.05c-4.37-8.89-3.82-19.83,2.39-28.41,6.21-8.58,16.44-12.52,26.25-11.13,4.37,8.89,3.82,19.83-2.39,28.41-6.21,8.58-16.44,12.52-26.25,11.13ZM310.84,313.15c-3.42,7.3-10.51,11.71-18.04,12.07-4.54-6.02-5.69-14.28-2.27-21.58,3.42-7.3,10.51-11.71,18.04-12.07,4.54,6.02,5.69,14.28,2.27,21.58ZM309.95,281.38c-6.91-3.09-11.94-9.79-12.48-17.87-.54-8.08,3.55-15.39,9.99-19.37,6.91,3.09,11.94,9.79,12.48,17.87.54,8.08-3.55,15.39-9.99,19.37Z`;

function makeSvg(size, padding = 0) {
  const inner = size - padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${size * 0.18}"/>
  <svg x="${padding}" y="${padding}" width="${inner}" height="${inner}" viewBox="0 0 441.06 442.31">
    <defs>
      <linearGradient id="g" x1="0" y1="221.15" x2="441.06" y2="221.15" gradientUnits="userSpaceOnUse">
        <stop offset="0.5" stop-color="${TEAL}"/>
        <stop offset="0.5" stop-color="${YELLOW}"/>
      </linearGradient>
    </defs>
    <path fill="url(#g)" d="${MARK_PATH}"/>
  </svg>
</svg>`;
}

// Maskable: extra padding so the mark sits inside Android's safe zone (80% of canvas)
function makeMaskableSvg(size) {
  const padding = Math.round(size * 0.1);
  const inner   = size - padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${TEAL}"/>
  <svg x="${padding}" y="${padding}" width="${inner}" height="${inner}" viewBox="0 0 441.06 442.31">
    <defs>
      <linearGradient id="g" x1="0" y1="221.15" x2="441.06" y2="221.15" gradientUnits="userSpaceOnUse">
        <stop offset="0.5" stop-color="${BG}"/>
        <stop offset="0.5" stop-color="${YELLOW}"/>
      </linearGradient>
    </defs>
    <path fill="url(#g)" d="${MARK_PATH}"/>
  </svg>
</svg>`;
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error([
    '✗  sharp not found. Install it first:',
    '   npm install --save-dev sharp',
    '',
    '   Then re-run:  node app/scripts/generate-icons.mjs',
  ].join('\n'));
  process.exit(1);
}

const jobs = [
  { name: 'icon-192.png',          size: 192, svg: makeSvg(192, 12)          },
  { name: 'icon-512.png',          size: 512, svg: makeSvg(512, 32)          },
  { name: 'icon-maskable-512.png', size: 512, svg: makeMaskableSvg(512)      },
];

for (const { name, size, svg } of jobs) {
  const dest = join(outDir, name);
  await sharp(Buffer.from(svg)).png().toFile(dest);
  console.log(`✓  ${name}  (${size}×${size})`);
}

console.log('\nDone — icons written to app/public/icons/');
