/**
 * Which photos this device works out search vectors for, and when it may download the
 * resource to do it. Phones look at their own new uploads only (the rest is left to a
 * computer, or another phone's uploads), and download on Wi-Fi unless the person says
 * otherwise; computers look at everything and download straight away.
 */
import type { Connection } from './device';
import type { SearchResults } from './segment';

/** The photos still to look at, in `order`. */
export function photosToIndex({
  order,
  done,
  phone,
  uploadedHere,
}: {
  order: readonly string[];
  done: SearchResults;
  phone: boolean;
  uploadedHere: ReadonlySet<string>;
}): string[] {
  return order.filter((id) => !done.has(id) && (!phone || uploadedHere.has(id)));
}

/**
 * Whether to wait before downloading: on a phone, unless it's on Wi-Fi, the resource is
 * already in the browser's cache, or the person said to go ahead.
 */
export function waitForWifi({
  phone,
  connection,
  cached,
  allowed,
}: {
  phone: boolean;
  connection: Connection;
  cached: boolean;
  allowed: boolean;
}): boolean {
  return phone && connection !== 'wifi' && !cached && !allowed;
}

/** Overwrites every vector and empties the map, so nothing worked out outlives a lock. */
export function wipeResults(results: SearchResults): void {
  for (const vector of results.values()) vector?.fill(0);
  results.clear();
}
