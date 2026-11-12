// Vendors the map assets that must ship with the app so labels and icons work offline (PLAN §5.3):
//   - OpenFreeMap "Liberty" style  -> src/map/style.base.json
//   - its sprite sheets            -> public/sprites/
//   - glyph PBFs for its fonts     -> public/fonts/{fontstack}/{range}.pbf
// Run with: npm run assets:map   (only needed when you want to refresh them)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'TrailKeep-asset-fetch/1.0 (personal offline hiking PWA)';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const FONT_BASE = 'https://tiles.openfreemap.org/fonts';
// Keep in sync with BUNDLED_GLYPH_RANGES in src/map/sources.ts
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447', '8448-8703'];

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
async function save(rel, buf) {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log(`${rel}  ${(buf.length / 1024).toFixed(1)} KB`);
}

const styleBuf = await get(STYLE_URL);
const style = JSON.parse(styleBuf.toString('utf8'));
await save('src/map/style.base.json', Buffer.from(JSON.stringify(style, null, 1) + '\n'));

for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
  await save(`public/sprites/ofm${suffix}`, await get(style.sprite + suffix));
}

const stacks = new Set();
for (const layer of style.layers) {
  const f = layer.layout?.['text-font'];
  if (Array.isArray(f)) f.forEach((s) => typeof s === 'string' && stacks.add(s));
}
let total = 0;
for (const stack of stacks) {
  for (const range of RANGES) {
    const buf = await get(`${FONT_BASE}/${encodeURIComponent(stack)}/${range}.pbf`);
    total += buf.length;
    await save(`public/fonts/${stack}/${range}.pbf`, buf);
  }
}
console.log(`fonts total ${(total / 1024).toFixed(0)} KB for stacks: ${[...stacks].join(', ')}`);
