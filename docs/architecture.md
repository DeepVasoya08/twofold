# Architecture

```
 browser (apps/web)                         Cloudflare
 ┌───────────────────────┐   HTTPS   ┌──────────────────────────┐
 │ React UI              │ ────────▶ │ Worker (apps/api, Hono)  │
 │ packages/crypto       │           │   ├─ R2: encrypted blobs │
 │ (encrypt / decrypt)   │ ◀──────── │   └─ D1: metadata        │
 └───────────────────────┘ ciphertext└──────────────────────────┘
```

- **apps/web** — static SPA on Cloudflare Pages. All encryption and decryption happens
  here, through `packages/crypto`.
- **apps/api** — Cloudflare Worker. Stores and serves ciphertext; never receives
  plaintext photos, passwords, or keys. R2 object keys are random IDs. D1 holds metadata.
  Schema changes are SQL files in `apps/api/migrations`, applied on deploy.
- **packages/crypto** — the only place crypto code may live; libsodium constructions only.
- **packages/types** — types shared between web, API, and (later) mobile.

## Workspace conventions

Internal packages export their TypeScript source (`"exports": { ".": "./src/index.ts" }`);
Vite and wrangler bundle them directly, so there is no build step between packages. Each
package still has a `build` script that compiles it standalone with `tsc` to catch
problems early.
