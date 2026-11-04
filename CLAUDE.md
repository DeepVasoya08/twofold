# Arcafold — rules for every task

Arcafold is an end-to-end encrypted private photo vault for couples. pnpm monorepo:
`apps/web` (Vite + React, Cloudflare Pages), `apps/api` (Hono on Cloudflare Workers, R2 + D1),
`packages/crypto` (libsodium), `packages/core` (shared app logic), `packages/types`
(shared types), `apps/mobile` (React Native phone app), `apps/mobile-spike` (phone test
app), `docs/`.

## Security rules (non-negotiable)

- The server must never see plaintext photos, passwords, or keys.
- All crypto lives in `packages/crypto` using standard libsodium constructions.
  Never invent crypto or write crypto code elsewhere.
- Never log keys, passwords, tokens, or decrypted data.
- Never store decrypted images in localStorage, IndexedDB, or caches.
- R2 object names are random IDs, never filenames.
- No secrets in code or committed files; use env vars and GitHub secrets.

## Engineering standards

- Follow industry best practices: strict TypeScript, no `any`, small focused modules,
  clear naming, input validation at API boundaries (zod).
- Every change includes tests. Crypto changes need failure-case tests (wrong key,
  tampered data). New web flows need a Playwright test.
- Lint, typecheck, and all tests must pass before a task is considered done
  (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`).
- One feature per branch, small PRs, conventional commit messages.
- Update `docs/` when behavior or architecture changes.
- Ask before adding a new dependency; prefer well-maintained, audited ones.
