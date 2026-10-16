/**
 * Procedural landscape "photos" so the UI has something to show before real, decrypted
 * photos exist. Placeholder art only: nothing here is random in a security sense.
 */

export type Palette =
  'sunset' | 'dawn' | 'golden' | 'dusk' | 'forest' | 'ocean' | 'desert' | 'night';

interface PaletteColors {
  sky: [string, string, string];
  sun: string;
  layers: [string, string, string];
  water?: string;
  stars?: boolean;
}

const palettes: Record<Palette, PaletteColors> = {
  sunset: {
    sky: ['#5b3a78', '#e0647a', '#ffc38b'],
    sun: '#fff1c9',
    layers: ['#a8506d', '#6d3560', '#3b1f45'],
  },
  dawn: {
    sky: ['#9fb8de', '#f2c4cf', '#fde7d4'],
    sun: '#fffaf0',
    layers: ['#b7a4c9', '#8a7aa8', '#5b5080'],
    water: '#c9b8d8',
  },
  golden: {
    sky: ['#f7a35c', '#ffd28a', '#fff0c4'],
    sun: '#fffbea',
    layers: ['#d98a4e', '#a95b3a', '#6b3427'],
  },
  dusk: {
    sky: ['#1f2350', '#5a3f86', '#c96b8f'],
    sun: '#ffd6c2',
    layers: ['#4a3a72', '#2e2554', '#17143a'],
    water: '#3b3168',
  },
  forest: {
    sky: ['#b9dccb', '#e4f1df', '#fbf6e6'],
    sun: '#fffdf4',
    layers: ['#7fae8c', '#4e8065', '#28503f'],
  },
  ocean: {
    sky: ['#4d8fc4', '#9fd0e8', '#e6f4f7'],
    sun: '#ffffff',
    layers: ['#78a9a0', '#4a7c7f', '#2c5263'],
    water: '#3f86b0',
  },
  desert: {
    sky: ['#e9a07a', '#f6c9a0', '#fbe6cc'],
    sun: '#fff6e3',
    layers: ['#d48a5d', '#b4643f', '#7c3d2a'],
  },
  night: {
    sky: ['#0b1030', '#1e2a5a', '#3a3f78'],
    sun: '#f4f1e3',
    layers: ['#2a2f5e', '#1a1d45', '#0d0f2b'],
    water: '#1c2552',
    stars: true,
  },
};

export const paletteNames = Object.keys(palettes) as Palette[];

/** Small deterministic PRNG (mulberry32) so a seed always draws the same picture. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): string {
  return value.toFixed(1);
}

function ridge(rand: () => number, width: number, height: number, baseY: number, rough: number) {
  const steps = 7;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (width / steps) * i;
    const y = baseY + (rand() - 0.5) * rough * height;
    points.push([x, y]);
  }
  let d = `M0 ${String(height)} L0 ${round(points[0]?.[1] ?? baseY)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    if (!prev || !point) continue;
    const midX = (prev[0] + point[0]) / 2;
    d += ` C${round(midX)} ${round(prev[1])} ${round(midX)} ${round(point[1])} ${round(point[0])} ${round(point[1])}`;
  }
  return `${d} L${String(width)} ${String(height)} Z`;
}

export interface ArtOptions {
  seed: number;
  palette: Palette;
  width: number;
  height: number;
}

export function landscapeSvg({ seed, palette, width, height }: ArtOptions): string {
  const colors = palettes[palette];
  const rand = prng(seed);
  const sunX = width * (0.2 + rand() * 0.6);
  const sunY = height * (0.22 + rand() * 0.22);
  const sunR = Math.min(width, height) * (0.06 + rand() * 0.05);
  const horizon = height * (colors.water ? 0.68 : 0.62);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" preserveAspectRatio="xMidYMid slice">`,
    '<defs>',
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.sky[0]}"/><stop offset="0.55" stop-color="${colors.sky[1]}"/><stop offset="1" stop-color="${colors.sky[2]}"/></linearGradient>`,
    `<radialGradient id="g"><stop offset="0" stop-color="${colors.sun}" stop-opacity="0.85"/><stop offset="1" stop-color="${colors.sun}" stop-opacity="0"/></radialGradient>`,
    '</defs>',
    `<rect width="${String(width)}" height="${String(height)}" fill="url(#s)"/>`,
  ];

  if (colors.stars) {
    for (let i = 0; i < 40; i++) {
      const r = round(0.6 + rand() * 1.6);
      parts.push(
        `<circle cx="${round(rand() * width)}" cy="${round(rand() * horizon * 0.8)}" r="${r}" fill="#fff" opacity="${round(0.3 + rand() * 0.6)}"/>`,
      );
    }
  }

  parts.push(
    `<circle cx="${round(sunX)}" cy="${round(sunY)}" r="${round(sunR * 3.2)}" fill="url(#g)"/>`,
    `<circle cx="${round(sunX)}" cy="${round(sunY)}" r="${round(sunR)}" fill="${colors.sun}"/>`,
  );

  colors.layers.forEach((color, index) => {
    const baseY = horizon - height * 0.16 + index * height * 0.1;
    const rough = 0.22 - index * 0.05;
    parts.push(`<path d="${ridge(rand, width, height, baseY, rough)}" fill="${color}"/>`);
  });

  if (colors.water) {
    const waterTop = height * 0.8;
    parts.push(
      `<rect y="${round(waterTop)}" width="${String(width)}" height="${round(height - waterTop)}" fill="${colors.water}"/>`,
    );
    for (let i = 0; i < 6; i++) {
      const y = waterTop + (height - waterTop) * (0.15 + i * 0.14);
      const w = sunR * (2.2 - i * 0.25);
      parts.push(
        `<rect x="${round(sunX - w / 2)}" y="${round(y)}" width="${round(w)}" height="${round(height * 0.006 + 1)}" rx="2" fill="${colors.sun}" opacity="${round(0.55 - i * 0.07)}"/>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

export function landscapeDataUri(options: ArtOptions): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(landscapeSvg(options))}`;
}
