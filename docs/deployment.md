# Deployment

`.github/workflows/deploy.yml` runs after the CI workflow succeeds on a push to `main`.
It deploys the exact commit CI tested, in this order:

1. Writes the `D1_DATABASE_ID` variable into `apps/api/wrangler.jsonc` (the committed
   file holds a placeholder).
2. Applies D1 migrations (`wrangler d1 migrations apply DB --remote`).
3. Deploys the API worker `twofold-api` (`wrangler deploy`).
4. Builds the web app and uploads `apps/web/dist` to the Pages project `twofold-web`
   (`wrangler pages deploy … --branch main`).

The job stops at the first failing step, so a missing Pages project still leaves a
freshly deployed API behind. Fix the cause and use **Re-run jobs** on the failed
Deploy run.

## One-time setup

Do these steps in order, before the first push to `main`. Each one maps to a deploy
step that fails without it.

### 1. Create the Cloudflare resources

Run these from your own machine, logged in as yourself, so the CI token never needs
permission to create resources:

```sh
pnpm install
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler d1 create twofold
pnpm exec wrangler r2 bucket create twofold-blobs
pnpm exec wrangler pages project create twofold-web --production-branch main
```

| Resource      | Name            | Must match                                        |
| ------------- | --------------- | ------------------------------------------------- |
| D1 database   | `twofold`       | `database_name` in `apps/api/wrangler.jsonc`      |
| R2 bucket     | `twofold-blobs` | `bucket_name` in `apps/api/wrangler.jsonc`        |
| Pages project | `twofold-web`   | `PAGES_PROJECT` in `.github/workflows/deploy.yml` |

Keep the ID that `wrangler d1 create` prints (`database_id = "…"`); step 3 needs it.
`wrangler d1 list` shows it again later.

Create the Pages project with the command above, which makes a **Direct Upload**
project. Do not create it in the dashboard by connecting the GitHub repository: that
turns on Cloudflare's own Git builds, which try to build the monorepo on every push and
fail, alongside the GitHub Actions deploy. If a Git-connected `twofold-web` already
exists, delete it and recreate it with the command. The same applies to the API worker:
leave Workers Builds (Git integration) off, because GitHub Actions deploys it.

The API worker itself needs no setup; the first `wrangler deploy` creates it.

### 2. Create the Cloudflare API token

In the Cloudflare dashboard, open **My Profile → API Tokens → Create Token → Create
Custom Token** and add these **Account** permissions, all set to **Edit**:

| Permission         | Used by                                 |
| ------------------ | --------------------------------------- |
| Workers Scripts    | `wrangler deploy` (API worker)          |
| D1                 | `wrangler d1 migrations apply --remote` |
| Cloudflare Pages   | `wrangler pages deploy`                 |
| Workers R2 Storage | the worker's R2 bucket binding          |

Under **Account Resources**, choose **Include → your account** only. No zone
permissions are needed while the API is served on `workers.dev`. Copy the token; it is
shown once.

Your account ID is on the dashboard's **Workers & Pages** overview (right-hand side),
or in the output of `pnpm exec wrangler whoami`.

### 3. Configure GitHub

In the repository, open **Settings → Secrets and variables → Actions**:

| Kind     | Tab           | Name                    | Value                            |
| -------- | ------------- | ----------------------- | -------------------------------- |
| Secret   | **Secrets**   | `CLOUDFLARE_API_TOKEN`  | the token from step 2            |
| Secret   | **Secrets**   | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID       |
| Variable | **Variables** | `D1_DATABASE_ID`        | the ID from `wrangler d1 create` |

`D1_DATABASE_ID` must be a **variable**, not a secret: the workflow reads
`vars.D1_DATABASE_ID`, so a secret with that name is invisible to it and the
"Configure D1 database ID" step fails with "Repository variable D1_DATABASE_ID is not
set". It is not sensitive; it only identifies the database to the account.

Repository-level secrets and variables are the simplest choice. They are visible to the
deploy job even though it runs in the `production` environment.

### 4. The `production` environment (optional gate)

The deploy job declares `environment: production`. GitHub creates that environment
automatically on the first deploy, so there is nothing to set up for deploys to work.

To add a manual approval or restrict deploys to `main`, open **Settings → Environments
→ production** (create it with that exact name if the first deploy has not run yet) and:

- add yourself under **Required reviewers** to approve each deploy, and
- set **Deployment branches and tags** to **Selected branches → `main`**.

If you prefer, you can store the two secrets and the variable on the `production`
environment instead of the repository. Environment values override repository values
of the same name, so keep them in one place only to avoid stale duplicates.

## Checking a deploy

The Deploy run's "Deploy API worker" step prints the worker URL
(`https://twofold-api.<your-subdomain>.workers.dev`), and the Pages step prints the
deployment URL. The production site is the Pages project's `*.pages.dev` address,
shown on the project in the dashboard (normally `https://twofold-web.pages.dev`).

| Error in the Deploy run                          | Fix                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Repository variable D1_DATABASE_ID is not set`  | Add it on the **Variables** tab (step 3), not as a secret.                                      |
| `The Pages project "twofold-web" does not exist` | Run `wrangler pages project create` (step 1).                                                   |
| `Authentication error [code: 10000]`             | The token lacks a permission from step 2, or the account ID does not match the token's account. |

After fixing any of these, re-run the failed Deploy run; no new commit is needed.
