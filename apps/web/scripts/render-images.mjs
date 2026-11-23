/**
 * Renders the app icons and the social preview card into public/, with the Chromium that
 * Playwright uses. Run it after changing the logo or the card, and commit the PNGs:
 *
 *   node scripts/render-images.mjs
 *
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use a preinstalled Chromium.
 */
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { landscapeDataUri } from '../src/mock/art.ts';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
/** The phone app's images (apps/mobile/assets): its icons, splash and sign-in artwork. */
const phoneDir = join(publicDir, '..', '..', 'mobile', 'assets');

/** The arch mark's shapes, as in components/Brand.tsx (a 32-unit view box). */
const ARCH_OUTER = 'M6 29V14.5a10 10 0 0 1 20 0V29zM11.5 29v-9a4.5 4.5 0 0 1 9 0v9z';
const ARCH_INNER = 'M13.5 29v-8.6a2.5 2.5 0 0 1 5 0V29z';

/** The logo mark: an arch with a smaller arch inside it. */
const mark = (size, { outer = '#2f4bf0', inner = '#7d8fff' } = {}) => `
  <svg width="${String(size)}" height="${String(size)}" viewBox="4 2 24 28">
    <path d="${ARCH_OUTER}" fill="${outer}" fill-rule="evenodd" />
    <path d="${ARCH_INNER}" fill="${inner}" />
  </svg>`;

/** On cobalt, the mark is white with a lavender inner arch. */
const onCobalt = { outer: '#ffffff', inner: '#a9b5ff' };
const background = 'radial-gradient(120% 90% at 30% 0%, #4a63ff, #2f4bf0 55%, #2238c9)';

/** A square icon: the mark on cobalt, `inset` of the size left around it. */
function icon(size, { inset, radius }) {
  return `<div style="width:${String(size)}px;height:${String(size)}px;display:grid;place-items:center;background:${background};border-radius:${radius}">${mark(Math.round(size * (1 - 2 * inset)), onCobalt)}</div>`;
}

const font = (await readFile(join(publicDir, 'fonts', 'bricolage-grotesque.woff2'))).toString(
  'base64',
);
const fontFace = `<style>@font-face{font-family:'Bricolage Grotesque';font-weight:500 800;src:url(data:font/woff2;base64,${font}) format('woff2')}</style>`;

/** A landscape in an arch-shaped window, like the sign-in screens. */
function arch(seed, palette, style) {
  const src = landscapeDataUri({ seed, palette, width: 640, height: 800 });
  return `<img src="${src}" style="position:absolute;object-fit:cover;border-radius:999px 999px 24px 24px;box-shadow:0 40px 80px -30px rgb(0 0 0 / 60%);${style}" />`;
}

const card = `
  ${fontFace}
  <div style="position:relative;width:1200px;height:630px;overflow:hidden;background:#f6f6f3;color:#15171c;font-family:'Bricolage Grotesque',system-ui,sans-serif">
    <div style="position:absolute;left:84px;top:84px;display:flex;align-items:center;gap:16px">
      ${mark(60)}<span style="font-size:44px;font-weight:700;letter-spacing:-0.02em">Arcafold</span>
    </div>
    <h1 style="position:absolute;left:84px;top:210px;margin:0;font-size:84px;line-height:1;font-weight:700;letter-spacing:-0.035em">Your photos.<br />Truly private.</h1>
    <p style="position:absolute;left:84px;top:430px;margin:0;width:540px;font:500 28px/1.4 system-ui,sans-serif;color:#565a63">An end-to-end encrypted photo library. Encrypted on your device before it's uploaded.</p>
    ${arch(23, 'golden', 'left:770px;top:70px;width:330px;height:420px')}
    ${arch(7, 'night', 'left:1010px;top:330px;width:150px;height:190px;border:8px solid #f6f6f3;border-radius:999px 999px 16px 16px')}
  </div>`;

/** A plain landscape for the phone's sign-in screens, which cut it into an arch themselves. */
function landscape(seed, palette, width, height) {
  const src = landscapeDataUri({ seed, palette, width, height });
  return `<img src="${src}" style="display:block;width:${String(width)}px;height:${String(height)}px" />`;
}

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
  // The phone app. Android's adaptive icon keeps the mark inside the middle 66%.
  { dir: phoneDir, file: 'icon.png', size: 1024, html: icon(1024, { inset: 0.16, radius: '0' }) },
  {
    dir: phoneDir,
    file: 'splash-icon.png',
    size: 1024,
    html: `<div style="width:1024px;height:1024px;display:grid;place-items:center">${mark(400)}</div>`,
  },
  {
    dir: phoneDir,
    file: 'android-icon-foreground.png',
    size: 432,
    html: `<div style="width:432px;height:432px;display:grid;place-items:center">${mark(220, onCobalt)}</div>`,
  },
  {
    dir: phoneDir,
    file: 'android-icon-background.png',
    size: 432,
    html: `<div style="width:432px;height:432px;background:${background}"></div>`,
  },
  {
    dir: phoneDir,
    file: 'android-icon-monochrome.png',
    size: 432,
    html: `<div style="width:432px;height:432px;display:grid;place-items:center">${mark(220, { outer: '#fff', inner: '#fff' })}</div>`,
  },
  {
    dir: phoneDir,
    file: 'arch-day.png',
    size: [480, 600],
    html: landscape(23, 'golden', 480, 600),
  },
  {
    dir: phoneDir,
    file: 'arch-night.png',
    size: [240, 300],
    html: landscape(7, 'night', 240, 300),
  },
];

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const { dir = publicDir, file, size, html } of outputs) {
    const [width, height] = Array.isArray(size) ? size : [size, size];
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<body style="margin:0;background:transparent">${html}</body>`);
    await page.screenshot({ path: join(dir, file), omitBackground: true });
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
