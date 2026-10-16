# Twofold

An end-to-end encrypted private photo vault for couples. Photos are encrypted on your
device before upload; the server only ever stores ciphertext.

Web first; a mobile app (Expo) will follow.

> Status: foundation only — no product features yet.

## Repository layout

| Path              | What                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `apps/web`        | Vite + React client, served as static assets by the Worker       |
| `apps/api`        | The Worker: Hono API under `/api`, R2 for blobs, D1 for metadata |
| `packages/crypto` | All cryptography (libsodium-wrappers)                            |
| `packages/types`  | Types shared between apps                                        |
| `docs/`           | Architecture, security model, deployment                         |

## Running locally

Requirements: Node.js 22 (see `.nvmrc`) and pnpm 10 (`corepack enable` picks up the
pinned version).

```sh
pnpm install
pnpm --filter @twofold/api dev   # Worker on http://localhost:8787 (local D1/R2 via wrangler)
pnpm --filter @twofold/web dev   # web app with hot reload on http://localhost:5173, /api proxied to :8787
```

In production one Cloudflare Worker serves the web app and the API from the same origin;
see [docs/architecture.md](docs/architecture.md).

## Checks and tests

```sh
pnpm lint            # ESLint (typescript-eslint strict, type-aware)
pnpm typecheck       # tsc in every package
pnpm test            # Vitest unit tests in every package
pnpm test:coverage   # same, with coverage
pnpm test:e2e        # Playwright smoke test (builds the web app, runs it in wrangler dev)
pnpm build           # build every app and package
pnpm format          # Prettier
```

Before the first `pnpm test:e2e`, install a browser with
`pnpm --filter @twofold/web exec playwright install chromium`, or point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` at an existing Chromium.

See [CLAUDE.md](CLAUDE.md) for the security rules and engineering standards every change
must follow, and [docs/](docs/) for architecture and deployment.
