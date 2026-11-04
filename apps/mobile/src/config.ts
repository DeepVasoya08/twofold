import type { ApiConfig, ApiFetch } from '@arcafold/core/api';

/** Where the app talks to. Only HTTPS, and only Arcafold's own server. */
export const API_ORIGIN = 'https://arcafold.com';

/**
 * How the shared API client runs on a phone: against arcafold.com, with the platform's
 * fetch, and with the session cookie kept in the client's memory only (never in the system
 * cookie store, so it goes when the app closes or locks).
 */
export function apiConfig(fetch: ApiFetch): ApiConfig {
  return { origin: API_ORIGIN, fetch, cookies: 'memory' };
}
