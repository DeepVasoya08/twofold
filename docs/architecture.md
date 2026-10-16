# Architecture

```
 browser                                    Cloudflare: one Worker, one origin
 ┌───────────────────────┐   HTTPS   ┌───────────────────────────────────┐
 │ React UI (apps/web)   │ ────────▶ │ /*      static assets (apps/web)  │
 │ packages/crypto       │           │ /api/*  Hono app (apps/api)       │
 │ (encrypt / decrypt)   │ ◀──────── │           ├─ R2: encrypted blobs  │
 └───────────────────────┘ ciphertext│           └─ D1: metadata         │
                                     └───────────────────────────────────┘
```

A single Cloudflare Worker (`twofold`, configured in `apps/api/wrangler.jsonc`) serves
everything from one origin, so there is no CORS and the CSP can stay at
`connect-src 'self'`.

- **apps/web** — static SPA, served by the Worker through Workers Static Assets from
  `apps/web/dist`. Unknown paths fall back to `index.html` (SPA routing). Response headers
  for assets come from `apps/web/public/_headers`. All encryption and decryption happens
  here, through `packages/crypto`.
- **apps/api** — the Worker code, a Hono app mounted at `/api`. Only `/api/*` requests run
  Worker code (`run_worker_first`); everything else is answered from assets, and unknown
  `/api/*` routes return 404 rather than the app shell. Stores and serves
  ciphertext; never receives plaintext photos, passwords, or keys. R2 object keys are
  random IDs. D1 holds metadata. Schema changes are SQL files in `apps/api/migrations`,
  applied on deploy.
  - `/api/auth/*`: sign-up, prelogin (salt and KDF settings), login, logout.
  - `/api/account`: the signed-in account and its keyring; `PUT /api/account/keyring`
    replaces the keyring; `DELETE /api/account` deletes it. See
    [security.md](security.md#sessions-and-the-api).
  - Tables: `accounts`, `sessions` (token hashes only), `login_failures`.
  - API tests run the real migrations on Node's built-in SQLite (`src/test/d1.ts`).

## Local development

- `pnpm --filter @twofold/api dev` runs `wrangler dev` on port 8787. Run `pnpm build`
  first and it serves the built web app too, exactly like production.
- `pnpm --filter @twofold/web dev` runs Vite with hot reload on port 5173 and proxies
  `/api` to port 8787, so the app still sees one origin.
- `pnpm test:e2e` builds the web app, applies migrations to a local D1 database and runs
  Playwright against `wrangler dev`. Run `pnpm --filter @twofold/api db:migrate:local` once
  before using `wrangler dev` by hand.
- **packages/crypto** — the only place crypto code may live; libsodium constructions only.
  `@twofold/crypto/webcrypto` is the Web Crypto-only part the API uses.
- **packages/types** — types shared between web, API, and (later) mobile.

## Workspace conventions

Internal packages export their TypeScript source (`"exports": { ".": "./src/index.ts" }`);
Vite and wrangler bundle them directly, so there is no build step between packages. Each
package still has a `build` script that compiles it standalone with `tsc` to catch
problems early.
