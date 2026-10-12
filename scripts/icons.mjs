// Builds the site icons and the social-share image at the repo root.
//
//   node scripts/icons.mjs
//
// favicon.svg           the wrench/hammer mark from assets/orangeLogo.svg on a rounded --color-action square
// favicon.ico           32x32, from the same art
// apple-touch-icon.png  180x180, same art with square corners (iOS rounds them itself)
// og-image.jpg          1200x630 centre crop of the hero master with assets/whiteLogo.svg on it.
//                       The master already has the hero's darkening baked in, so it isn't darkened again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => path.join(ROOT, name);

const ACTION = '#b35a1f'; // --color-action (orange-600) in css/tokens.css

// ---- Mark: the first 11 top-level elements of orangeLogo.svg (hammer + wrench). The rest are the
// rings, the "Est 2025" / "RIGHT AWAY" / "REPAIRS" text and its band. The texture filters are dropped.
const MARK_COUNT = 11;
const MARK_BOX = { x: 107.6, y: 42.3, w: 102, h: 86.5 }; // measured bounding box in the logo's viewBox
const SIDE = 142;                                       // square side: the mark fills ~72% of it
const RADIUS = 28;

const logo = fs.readFileSync(out('assets/orangeLogo.svg'), 'utf8');
const shapes = logo
  .slice(logo.indexOf('>') + 1, logo.indexOf('<defs'))
  .match(/<(g|rect|path)\b[^>]*?(\/>|>[\s\S]*?<\/\1>)/g)
  .slice(0, MARK_COUNT)
  .map((el) => el.replace(/ filter="url\(#\w+\)"/, ''));

const r1 = (n) => Math.round(n * 100) / 100;
const x0 = r1(MARK_BOX.x + MARK_BOX.w / 2 - SIDE / 2);
const y0 = r1(MARK_BOX.y + MARK_BOX.h / 2 - SIDE / 2);
const iconSvg = (radius) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${SIDE} ${SIDE}">` +
  `<rect x="${x0}" y="${y0}" width="${SIDE}" height="${SIDE}" rx="${radius}" fill="${ACTION}"/>` +
  `${shapes.join('')}</svg>\n`;

const favicon = iconSvg(RADIUS);
fs.writeFileSync(out('favicon.svg'), favicon);

const png = (svg, size) => sharp(Buffer.from(svg), { density: (72 * size) / SIDE * 4 }).resize(size, size).png().toBuffer();
fs.writeFileSync(out('favicon.ico'), await pngToIco([await png(favicon, 32)]));
fs.writeFileSync(out('apple-touch-icon.png'), await png(iconSvg(0), 180));

// ---- Open Graph image
const OG = { w: 1200, h: 630 };
const LOGO_H = 380;
const logoPng = await sharp(out('assets/whiteLogo.svg'), { density: 300 }).resize({ height: LOGO_H }).png().toBuffer();
await sharp(out('assets/source/heroGraphic.png'))
  .resize(OG.w, OG.h, { fit: 'cover', position: 'centre' })
  .composite([{ input: logoPng, gravity: 'centre' }])
  .flatten()
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(out('og-image.jpg'));

for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og-image.jpg']) {
  const { width, height } = await sharp(out(f)).metadata().catch(() => ({}));
  console.log(`${f.padEnd(22)} ${String(width ?? '').padStart(4)}x${String(height ?? '').padEnd(4)} ${(fs.statSync(out(f)).size / 1024).toFixed(1)} KB`);
}
