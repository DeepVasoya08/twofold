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
  `apps/web/dist`. The public pages (`/`, `/privacy`, `/terms`) are prerendered at build
  time into `index.html`, `privacy.html` and `terms.html`, with their own titles, link
  previews and structured data, plus `sitemap.xml` and `robots.txt` (see
  [ui.md](ui.md#landing-page-legal-pages-and-seo)). Any other path that isn't a file reaches
  the Worker, which answers with the plain app shell, `app.html` (marked `noindex`); a
  missing file (a path with an extension) gets a 404. Response headers for assets, the
  shell included, come from `apps/web/public/_headers`. All encryption and decryption happens
  here, through `packages/crypto`; password hashing (Argon2id) runs in a Web Worker
  bundled from `@twofold/crypto/password-worker`, encrypting and decrypting originals in one
  bundled from `@twofold/crypto/file-crypto-worker`, upload previews are drawn in
  `lib/thumbnail-worker.ts` (an OffscreenCanvas), and face grouping runs its two ONNX
  models (YuNet, SFace) with ONNX Runtime Web's WebAssembly backend in
  `lib/people/face-worker.ts`. The model files are bundled assets, pinned by SHA-256.
  Smart search's two halves (OpenCLIP ViT-B/32, about 89 MB and 65 MB) are built at
  deploy time and served as 24 MiB chunks from `/resources/search/`; `lib/search/resources.ts`
  joins them and checks the pinned SHA-256. The photo half runs in
  `lib/search/encoder-worker.ts`, on the same WebAssembly backend; it loads the fast way
  and starts again the low-memory way if that runs out of memory (`photo-encoder.ts`).
  The text half runs in `lib/search/query-worker.ts`, with CLIP's tokenizer written out in
  `tokenizer.ts` and built from a third resource, the word list (`merges.txt`, 0.5 MB).
  Face grouping and Smart search share the background scan in `lib/background-scan.ts`.
  A hidden page, `/lab/speed`, times them on the device it's opened on, with made-up
  inputs, so they can be tuned on real phones.
- **apps/api** — the Worker code: a Hono app mounted at `/api`, and the app shell
  fallback (`src/app-shell.ts`). `/api/*` requests always run Worker code
  (`run_worker_first`); other paths are answered from assets when a file matches, and
  unknown `/api/*` routes return 404 rather than the app shell. Stores and serves
  ciphertext; never receives plaintext photos, passwords, or keys. R2 object keys are
  random IDs. D1 holds metadata. Schema changes are SQL files in `apps/api/migrations`,
  applied on deploy.
  - `/api/auth/*`: sign-up, prelogin (salt and KDF settings), login, logout.
  - `/api/account`: the signed-in account and its keyring; `PUT /api/account/keyring`
    replaces the keyring; `DELETE /api/account` deletes it; `GET /api/account/devices`
    lists signed-in devices and `DELETE /api/account/devices/:id` signs one out;
    `GET /api/account/storage` is the account's total across spaces, shown in both;
    `PUT /api/account/smart-features` keeps the answer to the smart features question. See
    [security.md](security.md#sessions-and-the-api).
  - `/api/space/*`: one space's encrypted photos and albums, addressed by the
    `x-twofold-space` header. Uploads are two steps: `POST /photos` (id, sealed metadata,
    sizes), then `PUT /photos/:id/thumb` and `/full` together (ciphertext, streamed to R2 at
    `photos/<id>/<part>`). Whichever file lands second sees the other and commits the photo,
    answering `{ committed: true }`; `POST /photos/:id/commit` is only a fallback for when
    neither saw the other. Also listing (paged by id),
    downloads, `GET /thumbs?ids=a,b,c` (up to 48 encrypted previews in one response, each
    after a 4-byte length; empty for photos the space doesn't have; the Worker reads four
    from R2 at a time, since it may only hold six R2 responses open, and streams each one
    out as it's read, so the browser can show it before the rest arrive), metadata updates,
    deletes, albums (`POST /albums`, `PUT /albums/:id` to replace an album's sealed title,
    `DELETE /albums/:id`, which keeps its photos), and `DELETE /api/space` to wipe a space.
    Shared albums: `PUT /albums/:id/shared` (the title sealed under the album's own key),
    `DELETE /albums/:id/shared` (owner only: stops sharing with everyone), and
    `GET /albums/:id/items`, `PUT` and `DELETE /albums/:id/items/:photo` (which photos the
    album lists for the people it's shared with, each sealed under the album key).
    Owner-only: `/members` (who the space, or one album of it, is shared with; add, remove),
    `/joined` (the libraries and albums this space joined), `/faces` (sealed face data in
    segments: list paged, add, delete), `/people` (sealed person records: list, put,
    delete), `/face-data` (delete both), `/search` (sealed search vectors in segments: list
    paged, add, delete), `/words` (sealed words taught to search: list, put, delete), `/search-data` (delete
    the vectors and words) and `/pending-invites` (invites
    this space has in progress, on either side: list, add, replace, remove). `DELETE /membership` lets a
    member leave. A token given one album only reaches `GET /photos`, `/albums`, `/thumbs`,
    `/photos/:id/:part` (that album's listed photos) and `DELETE /membership`. See
    [security.md](security.md#photo-storage).
  - `/api/invites/*`: the invite rendezvous. The inviter creates an invite and drives it by
    a private handle (`GET /:handle`, `/reveal`, `/grant`, `DELETE`); the joiner drives it
    by the typed code or the link's token (`GET /join/:ref`, `/key`, `/hello`, `DELETE`).
    Neither has to be online at the same time as the other. See
    [security.md](security.md#invites).
  - Round trips to D1 are kept few, since each one can cost a long way to the database's
    region: every space request checks its session and space token in one batch, login
    counts both guess limits in one batch, and a commit checks the files' sizes inside its
    own update. The API tests count round trips per request (`test/d1.ts`).
  - Tables: `accounts`, `sessions` (token hashes only), `login_failures`, `photos`,
    `albums`, `album_items`, `members`, `joined`, `pending_invites`, `face_segments`,
    `people`, `search_segments` and `search_words` (keyed by space, never
    by account), and `invites` (up to a week, keyed by hashes of the code, link and handle).
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
