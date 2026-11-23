/**
 * WCAG contrast between two colours, so both apps' palettes can be checked to stay readable.
 * Takes #rgb or #rrggbb; returns a ratio from 1 (no contrast) to 21 (black on white).
 */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Not a hex colour: ${hex}`);
  const hexDigits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const digits = [hexDigits.slice(0, 2), hexDigits.slice(2, 4), hexDigits.slice(4, 6)];
  return digits.map((pair) => parseInt(pair, 16)) as [number, number, number];
}
