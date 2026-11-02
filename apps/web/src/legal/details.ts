/**
 * Facts the Privacy Policy and Terms of Use depend on that only the operator can supply.
 * While a value is null the pages show a highlighted placeholder in its place, and a page
 * that uses it keeps its draft notice until it is filled in.
 */
export interface LegalDetails {
  /** The person or company that runs Arcafold, as it should appear in a contract. */
  operator: string | null;
  /** Where people write about privacy requests, legal notices and abuse reports. */
  contactEmail: string | null;
  /** The country (and state, if relevant) whose law governs the terms. */
  jurisdiction: string | null;
  /** When this version takes effect, e.g. "1 November 2026". */
  effectiveDate: string | null;
}

export const legalDetails: LegalDetails = {
  operator: 'Deep Vasoya',
  contactEmail: 'deepvasoya08@gmail.com',
  jurisdiction: null,
  effectiveDate: '1 October 2026',
};

/** Facts about the service itself, kept here so both pages say the same thing. */
export const serviceFacts = {
  storageLimit: '1 GB',
  inviteExpiryDays: 7,
  /** Where Cloudflare keeps the database and encrypted files. */
  dataRegion: 'Cloudflare’s Asia-Pacific region',
} as const;

/** Whether any of `fields` (every detail, by default) is still missing. */
export function isDraft(
  details: LegalDetails,
  fields: readonly (keyof LegalDetails)[] = Object.keys(details) as (keyof LegalDetails)[],
): boolean {
  return fields.some((field) => details[field] === null);
}
