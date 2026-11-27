# Deployment

One Cloudflare Worker, `arcafold`, serves the whole app from one origin: the built web app
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
5. Keeps recent builds' files (`apps/web/scripts/keep-old-assets.mjs`): reads
   `/asset-history.json` from the live site (`SITE_URL`, or the workers.dev address), copies
   the `/assets` files that earlier builds used in the last 7 days into `dist`, and writes a
   new `asset-history.json`. Without this, a tab opened before the deploy would ask for
   scripts that are gone (for example Smart search's worker) and that part would stop with a
   404 until a reload. A problem reaching the live site only prints a warning; it never fails
   the deploy. Open tabs also check for a newer build when unlocked, when they come back into view and
   every hour, and offer a reload ("Arcafold has been updated").
6. Deploys the `arcafold` Worker (`wrangler deploy` in `apps/api`), which uploads the web
   app's assets and the API code together. One deploy updates both, so the web app and
   the API can never be out of step.

The job stops at the first failing step. Fix the cause and use **Re-run jobs** on the
failed Deploy run.

Nightly database backups run in a separate workflow (`backup.yml`) with their own token;
setup and restore are in [backups.md](backups.md). A separate staging copy, deployed by
hand, is described in [staging.md](staging.md).

Dependency updates come from Dependabot (`.github/dependabot.yml`). Security fixes open a
PR as soon as an advisory is published. Routine minor and patch bumps arrive once a month
in one grouped PR (plus one for GitHub Actions), and each major version gets its own PR,
with Expo SDK majors grouped. Avoid broad `ignore` rules there, because they also stop
security PRs.

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
pnpm exec wrangler d1 create arcafold
pnpm exec wrangler r2 bucket create arcafold-blobs
```

| Resource    | Name             | Must match                                   |
| ----------- | ---------------- | -------------------------------------------- |
| D1 database | `arcafold`       | `database_name` in `apps/api/wrangler.jsonc` |
| R2 bucket   | `arcafold-blobs` | `bucket_name` in `apps/api/wrangler.jsonc`   |

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

| Kind     | Tab           | Name                          | Value                                              |
| -------- | ------------- | ----------------------------- | -------------------------------------------------- |
| Secret   | **Secrets**   | `CLOUDFLARE_API_TOKEN`        | the token from step 2                              |
| Secret   | **Secrets**   | `CLOUDFLARE_ACCOUNT_ID`       | your Cloudflare account ID                         |
| Variable | **Variables** | `D1_DATABASE_ID`              | the ID from `wrangler d1 create`                   |
| Variable | **Variables** | `SITE_URL` (optional)         | the public origin, e.g. `https://arcafold.example` |
| Variable | **Variables** | `GOOGLE_CLIENT_ID` (optional) | the OAuth client ID from step 6                    |

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

To serve the app on your own domain, open **Workers & Pages → arcafold → Settings →
Domains & Routes** and add a **Custom Domain**. The domain must be a zone on the same
Cloudflare account. The token from step 2 does not need zone permissions for this,
because you add the domain in the dashboard, not from CI.

Then set the `SITE_URL` repository variable (step 3) to the new origin and redeploy. The
build writes it into the landing and legal pages' canonical links and link previews, the
sitemap and robots.txt; without it they point at `https://arcafold.deepvasoya08.workers.dev`.

The product's domain is `arcafold.com`. Moving to it, in order:

1. Add `arcafold.com` to Cloudflare as a zone (change the nameservers at the registrar to
   the two Cloudflare shows), then add it as a Custom Domain on the `arcafold` Worker as
   above. Add `www.arcafold.com` too if you want it.
2. Set `SITE_URL` to `https://arcafold.com` and redeploy. Production's `workers.dev`
   address is off (`workers_dev: false` in `wrangler.jsonc`), so the custom domain is the
   only way in. In the zone's **SSL/TLS → Edge Certificates**, turn on **Always Use HTTPS**
   and **HSTS**: static pages are served before the Worker runs, so only that setting sends
   a plain-http visit to https (the Worker itself refuses the API over http).
3. Google Photos (step 6): add `https://arcafold.com` as an Authorized JavaScript origin and
   `https://arcafold.com/import/google/done` as a redirect URI, and set the home page and
   privacy policy links on the consent screen to the new domain. Keep the workers.dev
   entries until nobody uses that address.
4. Search Console: add a **Domain** property for `arcafold.com` (DNS verification works now)
   and re-request Google's branding review.

### 6. Google Photos connection (optional)

"Connect Google Photos" on the import screen signs people in to Google in their browser and
lets them pick photos with Google's Photos Picker API. It needs an OAuth client of your own;
without the `GOOGLE_CLIENT_ID` variable the button is hidden and the export steps show
instead.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. In **APIs & Services → Library**, enable **Photos Picker API**.
3. In **Google Auth Platform**, set up the consent screen (External, app name, support
   email). Under **Data access**, add only the scope
   `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`. Under **Audience**,
   add test users: until Google verifies the app, at most 100 test users can connect.
4. In **Clients**, create an OAuth client of type **Web application** with:
   - Authorized JavaScript origin: the app's origin, e.g.
     `https://arcafold.deepvasoya08.workers.dev`
   - Authorized redirect URI: the origin plus `/import/google/done`
5. Set the client ID as the `GOOGLE_CLIENT_ID` repository variable (step 3) and redeploy.
   The client ID is public (it is in the built app); there is no client secret, because the
   browser signs in directly and Arcafold's server never takes part.

To let anyone connect, publish the app and ask Google to verify it from **Google Auth
Platform → Verification center**; Google reviews the scope's use, which can take weeks.
Google's branding check needs two things from the site:

- **Proof you own the home page.** In [Google Search Console](https://search.google.com/search-console),
  add a **URL prefix** property for the app's origin (a `workers.dev` address can't use the
  Domain option, which needs DNS). Pick the **HTML tag** method, copy only the `content`
  value from the tag it shows, set it as the `GOOGLE_SITE_VERIFICATION` repository variable,
  redeploy, then press **Verify** in Search Console. The build adds the tag to every page.
  Use the same Google account that owns the Cloud project, and wait a day before asking
  Google to re-check the branding.
- **A privacy policy that covers Google data.** `/privacy` has an "Importing from Google
  Photos" section, including the Limited Use statement Google asks for.

### 7. Account email (optional)

Confirming emails, and later sign-in notices and invites, need Cloudflare Email Service and
the `EMAIL_CODE_SECRET` secret in the `production` environment. Until both are set up email
stays off. Steps: [email.md](email.md).

## Checking a deploy

The Deploy run's "Deploy Worker" step prints the Worker URL
(`https://arcafold.<your-subdomain>.workers.dev`). That one address serves the web app at
`/` and the API at `/api` (for example `/api/health`).

| Error in the Deploy run                                                    | Fix                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Repository variable D1_DATABASE_ID is not set`                            | Add it on the **Variables** tab (step 3), not as a secret.                                      |
| `The directory specified by the "assets.directory" field … does not exist` | The web build step did not run or failed; check the "Build web app" step.                       |
| `Authentication error [code: 10000]`                                       | The token lacks a permission from step 2, or the account ID does not match the token's account. |
| `SHA-256 does not match the pinned source` (Build Smart search resources)  | The download changed or was cut short. Re-run; if it repeats, the pinned export moved.          |

After fixing any of these, re-run the failed Deploy run; no new commit is needed.

## Moving off Cloudflare Pages

This happened before the rename below, so it uses the old `twofold` names.

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

## Moving from Twofold to Arcafold

The app was called Twofold until November 2026. Every name changed with it: the Workers
(`arcafold`, `arcafold-backup`, `arcafold-staging`), the D1 databases, the R2 buckets, the
`@arcafold/*` packages, the session cookie, browser storage keys and the crypto context
strings. Because the context strings changed, data encrypted under the old names can't be
read, so the move starts from empty resources. Do it once, **before merging** the rename
(a deploy against missing resources fails):

1. From `apps/api`, logged in as yourself, create the new resources:
   `wrangler d1 create arcafold`, `wrangler r2 bucket create arcafold-blobs` and
   `wrangler r2 bucket create arcafold-backups`, then add the backup bucket's locks and
   lifecycle rules ([backups.md](backups.md)).
2. Set the `D1_DATABASE_ID` variable to the new database's ID.
3. Merge. The deploy creates the `arcafold` Worker at
   `https://arcafold.<your-subdomain>.workers.dev`, and every account starts fresh.
4. Point Google's OAuth client and Search Console at the new address (or at
   `arcafold.com`, step 5), and move any custom domain from the `twofold` Worker.
5. Staging creates its own new database and buckets on its next run.
6. When the new address works, delete the old ones: `wrangler delete --name twofold`,
   `wrangler delete --name twofold-backup`, `wrangler delete --name twofold-staging`, the
   `twofold` and `twofold-staging` databases and the `twofold-*` buckets. The old backup
   bucket's locks keep its files for up to 30 days before it can be emptied.
