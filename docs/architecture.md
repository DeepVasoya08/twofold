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
  here, through `packages/crypto`; password hashing (Argon2id) runs in a Web Worker
  bundled from `@twofold/crypto/password-worker`.
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
  - `/api/space/*`: one space's encrypted photos and albums, addressed by the
    `x-twofold-space` header. Uploads are three steps: `POST /photos` (id, sealed metadata,
    sizes), `PUT /photos/:id/thumb` and `/full` (ciphertext, streamed to R2 at
    `photos/<id>/<part>`), then `POST /photos/:id/commit`. Also listing (paged by id),
    downloads, `GET /thumbs?ids=a,b,c` (up to 48 encrypted previews in one response, each
    after a 4-byte length; empty for photos the space doesn't have), metadata updates,
    deletes, albums, and `DELETE /api/space` to wipe a space.
    Owner-only: `/members` (who the space is shared with, add, remove) and `/joined` (the
    libraries this space joined). `DELETE /membership` lets a member leave. See
    [security.md](security.md#photo-storage).
  - `/api/invites/*`: the invite rendezvous. The inviter creates an invite and drives it by
    a private handle (`GET /:handle`, `/reveal`, `/grant`, `DELETE`); the joiner drives it
    by the code (`GET /join/:code`, `/key`, `/hello`, `DELETE`). See
    [security.md](security.md#sharing).
  - Round trips to D1 are kept few, since each one can cost a long way to the database's
    region: every space request checks its session and space token in one batch, login
    counts both guess limits in one batch, and a commit checks the files' sizes inside its
    own update. The API tests count round trips per request (`test/d1.ts`).
  - Tables: `accounts`, `sessions` (token hashes only), `login_failures`, `photos`,
    `albums`, `members` and `joined` (keyed by space, never by account), and `invites`
    (short-lived, keyed by hashes of the code and handle).
  - API tests run the real migrations on Node's built-in SQLite (`src/test/d1.ts`) and an
    in-memory R2 (`src/test/r2.ts`).

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
