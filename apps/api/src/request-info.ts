import type { Context } from 'hono';

import { describeDevice } from './device';

/**
 * Who asked, as far as an email to the owner needs to say: the kind of device, roughly
 * where (city and country, from Cloudflare's guess for the internet address) and when.
 * It goes into that one email and is never stored or logged.
 */
export interface RequestInfo {
  device: string;
  place: string | null;
  when: number;
}

// Cloudflare's codes for "Tor" and "unknown", which name no country.
const NO_COUNTRY = new Set(['T1', 'XX']);

function countryName(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code) || NO_COUNTRY.has(code)) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? null;
  } catch {
    return null;
  }
}

function field(cf: Record<string, unknown>, key: string): string | null {
  const value = cf[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null;
}

/** "Mumbai, India" from a request's `cf` details, or null when Cloudflare didn't say. */
export function describePlace(cf: unknown): string | null {
  if (!cf || typeof cf !== 'object') return null;
  const details = cf as Record<string, unknown>;
  const country = countryName(field(details, 'country') ?? '');
  if (!country) return null;
  const city = field(details, 'city');
  return city ? `${city}, ${country}` : country;
}

export function requestInfo(c: Context, when = Date.now()): RequestInfo {
  return {
    device: describeDevice(c.req.header('user-agent')).name || 'an unknown device',
    place: describePlace((c.req.raw as Request & { cf?: unknown }).cf),
    when,
  };
}
