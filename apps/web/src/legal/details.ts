/**
 * Facts the Privacy Policy and Terms of Use depend on that only the operator can supply.
 * While a value is null the pages show a highlighted placeholder in its place, and the
 * draft notice stays up until every value is filled in.
 */
export interface LegalDetails {
  /** The person or company that runs Twofold, as it should appear in a contract. */
  operator: string | null;
  /** Where people write about privacy requests, legal notices and abuse reports. */
  contactEmail: string | null;
  /** The country (and state, if relevant) whose law governs the terms. */
  jurisdiction: string | null;
  /** The minimum age to use Twofold where you operate, e.g. 13 or 16. */
  minimumAge: number | null;
  /** When this version takes effect, e.g. "1 November 2026". */
  effectiveDate: string | null;
}

export const legalDetails: LegalDetails = {
  operator: null,
  contactEmail: null,
  jurisdiction: null,
  minimumAge: null,
  effectiveDate: null,
};

/** Facts about the service itself, kept here so both pages say the same thing. */
export const serviceFacts = {
  storageLimit: '1 GB',
  inviteExpiryDays: 7,
  /** Where Cloudflare keeps the database and encrypted files. */
  dataRegion: 'Cloudflare’s Asia-Pacific region',
} as const;

export function isDraft(details: LegalDetails): boolean {
  return Object.values(details).some((value) => value === null);
}
