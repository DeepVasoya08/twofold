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
  /**
   * Razorpay (docs/billing.md), all Worker secrets: the API key id and secret, the webhook
   * secret its notifications are signed with, and RAZORPAY_PLANS, a JSON object of Razorpay
   * plan ids keyed "plus:monthly", "plus:yearly" and so on. Until all four are set, plans
   * can't be bought and notifications are refused.
   */
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_PLANS?: string;
}
