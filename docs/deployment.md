# Deployment

One Cloudflare Worker, `twofold`, serves the whole app from one origin: the built web app
as static assets and the API under `/api` (see [architecture.md](architecture.md)).

`.github/workflows/deploy.yml` runs after the CI workflow succeeds on a push to `main`.
It deploys the exact commit CI tested, in this order:

1. Writes the `D1_DATABASE_ID` variable into `apps/api/wrangler.jsonc` (the committed
   file holds a placeholder).
2. Applies D1 migrations (`wrangler d1 migrations apply DB --remote`).
3. Builds Smart search's resources: downloads a pinned ONNX export from Hugging Face
   (about 600 MB), converts it with Python and checks the result against the SHA-256 the
   app pins, then writes 24 MiB chunks into `apps/web/public/resources/search`
   ([README](../apps/web/scripts/search-resources/README.md)).
4. Builds the web app into `apps/web/dist`. The build fails if any file is over the
   25 MiB static asset limit.
5. Deploys the `twofold` Worker (`wrangler deploy` in `apps/api`), which uploads the web
   app's assets and the API code together. One deploy updates both, so the web app and
   the API can never be out of step.

The job stops at the first failing step. Fix the cause and use **Re-run jobs** on the
failed Deploy run.

Nightly database backups run in a separate workflow (`backup.yml`) with their own token;
setup and restore are in [backups.md](backups.md).

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
```

| Resource    | Name            | Must match                                   |
| ----------- | --------------- | -------------------------------------------- |
| D1 database | `twofold`       | `database_name` in `apps/api/wrangler.jsonc` |
| R2 bucket   | `twofold-blobs` | `bucket_name` in `apps/api/wrangler.jsonc`   |

Keep the ID that `wrangler d1 create` prints (`database_id = "…"`); step 3 needs it.
`wrangler d1 list` shows it again later.

The Worker itself needs no setup; the first `wrangler deploy` creates it. Leave Workers
Builds (Git integration) off for it, because GitHub Actions deploys it.

### 2. Create the Cloudflare API token

In the Cloudflare dashboard, open **My Profile → API Tokens → Create Token → Create
Custom Token** and add these **Account** permissions, all set to **Edit**:

| Permission         | Used by                                 |
| ------------------ | --------------------------------------- |
| Workers Scripts    | `wrangler deploy` (code and assets)     |
| D1                 | `wrangler d1 migrations apply --remote` |
| Workers R2 Storage | the Worker's R2 bucket binding          |

Under **Account Resources**, choose **Include → your account** only. No zone
permissions are needed while the app is served on `workers.dev`. Copy the token; it is
shown once.

Your account ID is on the dashboard's **Workers & Pages** overview (right-hand side),
or in the output of `pnpm exec wrangler whoami`.

### 3. Configure GitHub

In the repository, open **Settings → Secrets and variables → Actions**:

| Kind     | Tab           | Name                    | Value                                             |
| -------- | ------------- | ----------------------- | ------------------------------------------------- |
| Secret   | **Secrets**   | `CLOUDFLARE_API_TOKEN`  | the token from step 2                             |
| Secret   | **Secrets**   | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID                        |
| Variable | **Variables** | `D1_DATABASE_ID`        | the ID from `wrangler d1 create`                  |
| Variable | **Variables** | `SITE_URL` (optional)   | the public origin, e.g. `https://twofold.example` |

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

### 5. Custom domain (optional)

To serve the app on your own domain, open **Workers & Pages → twofold → Settings →
Domains & Routes** and add a **Custom Domain**. The domain must be a zone on the same
Cloudflare account. The token from step 2 does not need zone permissions for this,
because you add the domain in the dashboard, not from CI.

Then set the `SITE_URL` repository variable (step 3) to the new origin and redeploy. The
build writes it into the landing and legal pages' canonical links and link previews, the
sitemap and robots.txt; without it they point at `https://twofold.deepvasoya08.workers.dev`.

## Checking a deploy

The Deploy run's "Deploy Worker" step prints the Worker URL
(`https://twofold.<your-subdomain>.workers.dev`). That one address serves the web app at
`/` and the API at `/api` (for example `/api/health`).

| Error in the Deploy run                                                    | Fix                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Repository variable D1_DATABASE_ID is not set`                            | Add it on the **Variables** tab (step 3), not as a secret.                                      |
| `The directory specified by the "assets.directory" field … does not exist` | The web build step did not run or failed; check the "Build web app" step.                       |
| `Authentication error [code: 10000]`                                       | The token lacks a permission from step 2, or the account ID does not match the token's account. |
| `SHA-256 does not match the pinned source` (Build Smart search resources)  | The download changed or was cut short. Re-run; if it repeats, the pinned export moved.          |

After fixing any of these, re-run the failed Deploy run; no new commit is needed.

## Moving off Cloudflare Pages

Earlier versions deployed the web app to a Pages project (`twofold-web`) and the API to a
separate Worker (`twofold-api`). The D1 database and R2 bucket stay the same; the new
Worker binds to them. After the first deploy of the `twofold` Worker succeeds:

1. Open the new `twofold.<your-subdomain>.workers.dev` URL and check the app and
   `/api/health` load.
2. If a custom domain is attached to the `twofold-web` Pages project, remove it there and
   add it to the `twofold` Worker (step 5).
3. Delete the old deployments: `pnpm exec wrangler pages project delete twofold-web` and
   `pnpm exec wrangler delete --name twofold-api` (from `apps/api`, logged in as yourself).
4. Edit the CI token and remove its **Cloudflare Pages** permission; nothing uses it now.
