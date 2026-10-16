# Twofold

An end-to-end encrypted private photo vault for couples. Photos are encrypted on your
device before upload; the server only ever stores ciphertext.

Web first; a mobile app (Expo) will follow.

> Status: foundation only — no product features yet.

## Repository layout

| Path              | What                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `apps/web`        | Vite + React client, deployed to Cloudflare Pages                 |
| `apps/api`        | Cloudflare Worker (Hono); R2 for encrypted blobs, D1 for metadata |
| `packages/crypto` | All cryptography (libsodium-wrappers)                             |
| `packages/types`  | Types shared between apps                                         |
| `docs/`           | Architecture, security model, deployment                          |

## Running locally

Requirements: Node.js 22 (see `.nvmrc`) and pnpm 10 (`corepack enable` picks up the
pinned version).

```sh
pnpm install
pnpm --filter @twofold/web dev   # web app on http://localhost:5173
pnpm --filter @twofold/api dev   # API worker on http://localhost:8787 (local D1/R2 via wrangler)
```

## Checks and tests

```sh
pnpm lint            # ESLint (typescript-eslint strict, type-aware)
pnpm typecheck       # tsc in every package
pnpm test            # Vitest unit tests in every package
pnpm test:coverage   # same, with coverage
pnpm test:e2e        # Playwright smoke test (builds and previews the web app)
pnpm build           # build every app and package
pnpm format          # Prettier
```

Before the first `pnpm test:e2e`, install a browser with
`pnpm --filter @twofold/web exec playwright install chromium`, or point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at an existing Chromium.

See [CLAUDE.md](CLAUDE.md) for the security rules and engineering standards every change
must follow, and [docs/](docs/) for architecture and deployment.
