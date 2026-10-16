# Deployment

`.github/workflows/deploy.yml` runs after the CI workflow succeeds on a push to `main`.
It deploys the exact commit CI tested:

1. Applies D1 migrations (`wrangler d1 migrations apply DB --remote`).
2. Deploys the API worker (`wrangler deploy`).
3. Builds and deploys the web app to Cloudflare Pages.

## One-time setup

GitHub secrets (already configured): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
The token needs Workers Scripts, Workers R2 Storage, D1, and Cloudflare Pages edit
permissions.

Create these Cloudflare resources once (e.g. with `pnpm --filter @twofold/api exec wrangler …`):

| Resource      | Name            | Command                                                              |
| ------------- | --------------- | -------------------------------------------------------------------- |
| D1 database   | `twofold`       | `wrangler d1 create twofold`                                         |
| R2 bucket     | `twofold-blobs` | `wrangler r2 bucket create twofold-blobs`                            |
| Pages project | `twofold-web`   | `wrangler pages project create twofold-web --production-branch main` |

Then set the GitHub **repository variable** `D1_DATABASE_ID` to the ID printed by
`wrangler d1 create`. The deploy workflow substitutes it into `apps/api/wrangler.jsonc`;
the committed file holds a placeholder.

The deploy job uses the GitHub environment `production`, so you can add required
reviewers there if you want a manual gate.
