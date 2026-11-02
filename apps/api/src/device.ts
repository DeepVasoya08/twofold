import type { DeviceKind } from '@arcafold/types';

/**
 * A coarse label for a session's device, made from its User-Agent: browser and system
 * only, never versions or models, so it says little more than "which of my devices". The
 * User-Agent itself is not stored.
 */
export interface DeviceLabel {
  name: string;
  kind: DeviceKind;
}

// Order matters: Edge, Opera and Samsung Internet also say "Chrome", and Chrome says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|OPT)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
];

function firstMatch(text: string, table: [RegExp, string][]): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function kindOf(userAgent: string, system: string | null): DeviceKind {
  if (system === 'iPhone') return 'phone';
  if (system === 'iPad') return 'tablet';
  if (system === 'Android') return /\bMobile\b/.test(userAgent) ? 'phone' : 'tablet';
  return 'computer';
}

export function describeDevice(userAgent: string | undefined): DeviceLabel {
  const text = (userAgent ?? '').slice(0, 512);
  const browser = firstMatch(text, BROWSERS);
  const system = firstMatch(text, SYSTEMS);
  const kind = kindOf(text, system);
  if (browser && system) return { name: `${browser} on ${system}`, kind };
  return { name: browser ?? system ?? '', kind };
}
