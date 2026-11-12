// Renders the PWA icons from an inline SVG using Playwright's Chromium.
// Run with: npm run assets:icons   (only needed if you change the artwork)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
await mkdir(out, { recursive: true });

const art = `
  <path d="M-20 392 L138 204 L214 292 L318 132 L532 392 L532 532 L-20 532 Z" fill="#2f7d50"/>
  <path d="M318 132 L372 198 L346 226 L320 196 L296 230 L276 196 Z" fill="#f4f1ea"/>
  <path d="M-20 452 L170 330 L300 420 L420 350 L532 420 L532 532 L-20 532 Z" fill="#174a2e"/>
  <path d="M92 446 C 170 420, 196 366, 262 356 S 352 318, 392 262" stroke="#ff4fa8" stroke-width="20" fill="none"
        stroke-linecap="round" stroke-dasharray="2 40"/>
  <circle cx="392" cy="262" r="34" fill="#ffffff"/>
  <circle cx="392" cy="262" r="21" fill="#1a73e8"/>`;

const svg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1f5d3a"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>
</svg>`;

await writeFile(join(out, 'icon.svg'), svg(1));

const targets = [
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  // Maskable icons keep the artwork inside the central safe zone.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;background:#1f5d3a}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg(t.scale)}`,
  );
  await page.screenshot({ path: join(out, t.file), clip: { x: 0, y: 0, width: t.size, height: t.size } });
  await page.close();
  console.log(t.file);
}
await browser.close();
