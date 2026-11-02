/**
 * Renders the app icons and the social preview card into public/, with the Chromium that
 * Playwright uses. Run it after changing the logo or the card, and commit the PNGs:
 *
 *   node scripts/render-images.mjs
 *
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use a preinstalled Chromium.
 */
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { landscapeDataUri } from '../src/mock/art.ts';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** The logo mark, as in components/Brand.tsx, in the dark theme's colors. */
const mark = (size) => `
  <svg width="${String(size)}" height="${String(size)}" viewBox="2 2 28 28">
    <circle cx="12" cy="16" r="9" fill="#ef7d88" />
    <circle cx="20" cy="16" r="9" fill="#9c78c2" opacity="0.9" />
    <path d="M16 8.6a9 9 0 0 1 0 14.8 9 9 0 0 1 0-14.8z" fill="#fff" opacity="0.55" />
  </svg>`;

const background = 'radial-gradient(120% 90% at 20% 0%, #3b2740, #1a131c 70%)';

/** A square icon: the mark on the dark background, `inset` of the size left around it. */
function icon(size, { inset, radius }) {
  return `<div style="width:${String(size)}px;height:${String(size)}px;display:grid;place-items:center;background:${background};border-radius:${radius}">${mark(Math.round(size * (1 - 2 * inset)))}</div>`;
}

function photo(seed, palette, width, height, style) {
  const src = landscapeDataUri({ seed, palette, width, height });
  return `<figure style="position:absolute;margin:0;padding:10px;border-radius:22px;background:#fffdf9;box-shadow:0 30px 60px -20px rgb(0 0 0 / 60%);${style}"><img src="${src}" style="display:block;width:100%;height:100%;border-radius:13px;object-fit:cover" /></figure>`;
}

const card = `
  <div style="position:relative;width:1200px;height:630px;overflow:hidden;background:${background};color:#f6eee8;font-family:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif">
    <div style="position:absolute;left:84px;top:84px;display:flex;align-items:center;gap:18px">
      ${mark(64)}<span style="font-size:46px;font-weight:600">Arcafold</span>
    </div>
    <h1 style="position:absolute;left:84px;top:210px;margin:0;font-size:84px;line-height:1.02;font-weight:600;letter-spacing:-0.02em">Your photos.<br />Truly private.</h1>
    <p style="position:absolute;left:84px;top:430px;margin:0;width:520px;font:500 28px/1.4 system-ui,sans-serif;color:#c0b2c2">An end-to-end encrypted photo library. Encrypted on your device before it's uploaded.</p>
    ${photo(11, 'dusk', 600, 800, 'left:700px;top:70px;width:250px;height:330px;transform:rotate(-7deg)')}
    ${photo(23, 'dawn', 800, 600, 'left:900px;top:50px;width:280px;height:210px;transform:rotate(5deg)')}
    ${photo(37, 'forest', 800, 800, 'left:850px;top:270px;width:280px;height:280px;transform:rotate(-2deg)')}
    ${photo(41, 'sunset', 800, 600, 'left:690px;top:420px;width:220px;height:165px;transform:rotate(4deg)')}
  </div>`;

const outputs = [
  { file: 'icon-192.png', size: 192, html: icon(192, { inset: 0.16, radius: '22%' }) },
  { file: 'icon-512.png', size: 512, html: icon(512, { inset: 0.16, radius: '22%' }) },
  // Maskable icons are cropped to a circle or squircle: keep the mark in the middle 60%.
  { file: 'icon-maskable-512.png', size: 512, html: icon(512, { inset: 0.22, radius: '0' }) },
  // iOS rounds the corners itself and shows transparency as black.
  { file: 'apple-touch-icon.png', size: 180, html: icon(180, { inset: 0.14, radius: '0' }) },
  {
    file: 'favicon-32.png',
    size: 32,
    html: `<div style="width:32px;height:32px">${mark(32)}</div>`,
  },
  {
    file: 'favicon-16.png',
    size: 16,
    html: `<div style="width:16px;height:16px">${mark(16)}</div>`,
  },
  { file: 'og-image.png', size: [1200, 630], html: card },
];

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const { file, size, html } of outputs) {
    const [width, height] = Array.isArray(size) ? size : [size, size];
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<body style="margin:0;background:transparent">${html}</body>`);
    await page.screenshot({ path: join(publicDir, file), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}

// favicon.ico for browsers and tools that ask for it by name: the 16 and 32 px PNGs.
const pngs = ['favicon-16.png', 'favicon-32.png'].map((file) => join(publicDir, file));
execFileSync('convert', [...pngs, join(publicDir, 'favicon.ico')]);
await Promise.all(pngs.map((file) => rm(file)));
console.warn(`Wrote ${String(outputs.length - 2)} images and favicon.ico`);
