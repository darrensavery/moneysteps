/**
 * Generates PWA icons from the source SVG.
 * Run: node gen-icons.mjs
 *
 * Outputs:
 *   public/icons/icon-192.png          — standard icon (any purpose)
 *   public/icons/icon-512.png          — standard icon (any purpose)
 *   public/icons/icon-maskable-512.png — maskable icon with safe-zone padding
 *   icons/apple-touch-icon.png         — 180×180 for root /icons/
 */

import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Source tree SVG path ──────────────────────────────────────────────────────
const treeSvgPath = path.join(__dirname, 'public', 'favicon.svg');
const treeSvg = fs.readFileSync(treeSvgPath, 'utf8');

// ── Colours ───────────────────────────────────────────────────────────────────
const BG_TEAL    = '#00959c';
const BG_PARCHMENT = '#f9f7f2';

// Extract inner content from the source SVG (strip the outer <svg> wrapper)
// The tree viewBox is 0 0 441.06 442.31
const TREE_VB_W = 441.06;
const TREE_VB_H = 442.31;
const treeInner = treeSvg
  .replace(/<\?xml[^>]*\?>/g, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>/, '')
  .trim();

// Variant with gradient replaced by flat white — used for maskable icon
// so the tree reads cleanly as a single-colour silhouette on the teal bg.
const treeInnerFlat = treeInner
  .replace(/<defs>[\s\S]*?<\/defs>/, '')   // strip gradient defs
  .replace(/fill="url\(#g\)"/, 'fill="#ffffff"');  // flat white path

/**
 * Wrap the tree paths inside a padded canvas using a <g transform="..."> to
 * scale + centre the tree within the desired area.
 * @param {number} size    — final canvas px (square)
 * @param {number} treePct — fraction of canvas the tree occupies (0–1)
 * @param {string} bg      — background colour
 */
function buildSvg(size, treePct, bg, inner = treeInner) {
  const treeSize = size * treePct;
  const margin   = (size - treeSize) / 2;
  const scaleX   = treeSize / TREE_VB_W;
  const scaleY   = treeSize / TREE_VB_H;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${margin}, ${margin}) scale(${scaleX}, ${scaleY})">
    ${inner}
  </g>
</svg>`;
}

function render(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  return resvg.render().asPng();
}

function write(filePath, png) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
  console.log(`✓ ${filePath}  (${Math.round(png.length / 1024)}KB)`);
}

// ── Standard icons (any) ──────────────────────────────────────────────────────
// Tree fills 76% of the canvas — leaves a small natural margin.
write(
  path.join(__dirname, 'public/icons/icon-192.png'),
  render(buildSvg(192, 0.76, BG_PARCHMENT), 192),
);

write(
  path.join(__dirname, 'public/icons/icon-512.png'),
  render(buildSvg(512, 0.76, BG_PARCHMENT), 512),
);

// ── Maskable icon ─────────────────────────────────────────────────────────────
// Safe zone = inner 80% circle. We fill the full canvas with teal, then
// draw the tree at 62% of canvas size — comfortably inside the safe zone
// even accounting for different OS circle clip shapes.
write(
  path.join(__dirname, 'public/icons/icon-maskable-512.png'),
  render(buildSvg(512, 0.62, BG_TEAL, treeInnerFlat), 512),
);

// ── Apple touch icon (180×180) ────────────────────────────────────────────────
write(
  path.join(__dirname, '../icons/apple-touch-icon.png'),
  render(buildSvg(180, 0.76, BG_PARCHMENT), 180),
);

console.log('\nAll icons generated.');
