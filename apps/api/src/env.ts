/** Bindings available to the Worker, as declared in wrangler.jsonc. */
export interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
  /**
   * Sends account email (Cloudflare Email Service). Missing in tests and local runs that
   * don't need it.
   */
  EMAIL?: SendEmail;
  /**
   * Keys the HMACs of email codes (a Worker secret, at least 32 characters). Until it is
   * set, email isn't ready: no codes are sent and no account is asked to confirm its email.
   */
  EMAIL_CODE_SECRET?: string;
}
