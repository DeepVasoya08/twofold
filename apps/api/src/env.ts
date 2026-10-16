/** Bindings available to the Worker, as declared in wrangler.jsonc. */
export interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
}
