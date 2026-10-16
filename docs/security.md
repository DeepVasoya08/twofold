# Security model

Twofold is end-to-end encrypted. The rules in [CLAUDE.md](../CLAUDE.md) are
non-negotiable; this document will grow into the full threat model as features land.

## Baseline (in place today)

- All crypto is confined to `packages/crypto` and uses libsodium.
- The web app and the API share one origin (a single Worker), so there is no CORS
  surface and `connect-src 'self'` covers API calls.
- The web app ships a strict Content-Security-Policy and related headers via
  `apps/web/public/_headers` (Workers Static Assets). `'wasm-unsafe-eval'` is allowed so
  libsodium's WebAssembly can load.
- API responses get their own, stricter headers (`default-src 'none'`, `X-Frame-Options:
DENY`, `no-referrer`, `nosniff`) from Hono's `secureHeaders` middleware in
  `apps/api/src/app.ts`.
- CI runs `pnpm audit --audit-level high` on every PR and push to `main`.
- Credentials live only in GitHub secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

## To be designed

- Key hierarchy (password-derived key, per-vault key, per-photo keys) and how the two
  partners share a vault.
- Password hashing / KDF parameters.
- Metadata minimisation in D1.
