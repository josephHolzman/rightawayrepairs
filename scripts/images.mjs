// Builds the responsive WebP images in assets/img/ from the masters in assets/source/.
//
//   node scripts/images.mjs
//
// A higher-resolution original named <key>-original.* (in assets/source/ or assets/) is used as
// the master instead of the default one. Images are never upscaled: a width larger than the master
// is skipped with a TODO(joey) line, and the master is written at its own width instead, so every
// image has at least one file. Prints a before/after byte table and the srcset for each image.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets', 'source');
const OUT = path.join(ROOT, 'assets', 'img');
const QUALITY = 78;

const SERVICES = ['plumbing', 'electrical', 'painting', 'drywall', 'appliance', 'roofing', 'carpentry', 'masonry'];
const IMAGES = [
  { key: 'hero', master: 'heroGraphic.png', widths: [1440, 2560, 3840] },
  ...SERVICES.map((key) => ({ key, master: `${key}.png`, widths: [400, 800] })),
  { key: 'preston', master: 'prestonGraphic.png', widths: [400, 800] },
];

const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

function findMaster(img) {
  for (const dir of [SOURCE, path.join(ROOT, 'assets')]) {
    const original = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith(`${img.key}-original.`));
    if (original) return path.join(dir, original);
  }
  return path.join(SOURCE, img.master);
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.webp')) fs.rmSync(path.join(OUT, f));

const rows = [];
const todos = [];
const srcsets = [];
for (const img of IMAGES) {
  const src = findMaster(img);
  const { width: masterW } = await sharp(src).metadata();
  const widths = img.widths.filter((w) => w <= masterW);
  for (const w of img.widths.filter((w) => w > masterW)) {
    todos.push(`TODO(joey): need ${/^[aeiou]/.test(img.key) ? 'an' : 'a'} ${img.key} master ≥ ${w}px wide (have ${masterW}px: ${rel(src)})`);
  }
  if (widths.length < img.widths.length && !widths.includes(masterW)) widths.push(masterW);

  const outputs = [];
  for (const w of widths) {
    const file = path.join(OUT, `${img.key}-${w}.webp`);
    const info = await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(file);
    outputs.push({ file, w, h: info.height, bytes: info.size });
  }
  rows.push({ master: rel(src), masterW, before: fs.statSync(src).size, outputs });
  srcsets.push(`${img.key.padEnd(10)} ${outputs[0].w}×${outputs[0].h}  ${outputs.map((o) => `./${rel(o.file)} ${o.w}w`).join(', ')}`);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${'master'.padEnd(40)} ${'before'.padStart(10)}  after (WebP q${QUALITY})`);
for (const r of rows) {
  const after = r.outputs.map((o) => `${o.w}w ${kb(o.bytes)}`).join(', ');
  console.log(`${`${r.master} (${r.masterW}w)`.padEnd(40)} ${kb(r.before).padStart(10)}  ${after}`);
}
const before = rows.reduce((s, r) => s + r.before, 0);
const after = rows.reduce((s, r) => s + r.outputs.reduce((t, o) => t + o.bytes, 0), 0);
console.log(`${'total'.padEnd(40)} ${kb(before).padStart(10)}  ${kb(after)} (all widths, −${(100 - (after / before) * 100).toFixed(1)}%)`);
console.log('\nsrcset (first entry = src and its width×height):');
for (const s of srcsets) console.log(s);
if (todos.length) console.log(`\n${todos.join('\n')}`);
