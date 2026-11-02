# Staging and restore drills

Staging is a second copy of Arcafold at `https://twofold-staging.<your-subdomain>.workers.dev`.
It shares nothing with production: it has its own Worker (`twofold-staging`), its own
database (`twofold-staging`) and its own bucket (`twofold-staging-blobs`). It's used for
restore drills and for trying a branch before it reaches production. Accounts made there
are separate from production accounts.

## Deploy to staging

Go to **Actions → Deploy staging → Run workflow** and pick a branch (`main` by default).

The first run creates the database and the two buckets. Every run applies migrations and
deploys. It uses the production environment's `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`, and the names in `wrangler.jsonc`'s `staging` section decide what
it touches. If the token isn't allowed to create a D1 database or an R2 bucket, the run
stops at that step. Create them once by hand and run it again:

```sh
cd apps/api
pnpm exec wrangler d1 create twofold-staging
pnpm exec wrangler r2 bucket create twofold-staging-blobs
pnpm exec wrangler r2 bucket create twofold-staging-backups
```

Staging's `robots.txt` blocks search engines. Staging has its own photo backup Worker
(`twofold-staging-backup`) copying into `twofold-staging-backups`, so changes to the backup
can be tried there first.

## Restore drill (every quarter)

The drill shows that a backup really opens and loads. It runs on your own computer,
because only that computer holds the backup's secret key.

1. Pick an export. The Backup workflow's log ends with its name, for example
   `d1/2026-10-29T0912Z.sealed`. The bucket in the Cloudflare dashboard lists them too.
2. Load it into staging:

   ```sh
   pnpm install
   pnpm --filter @twofold/api drill d1/2026-10-29T0912Z.sealed "$HOME/twofold-backup.key"
   ```

   The command downloads the export and opens it with the key. It then empties the staging
   database and imports the export. Last, it prints how many rows each table has. It
   deletes the downloaded and opened files when it finishes, even if it fails. With the
   wrong key or a damaged file, it stops before staging is touched. It only ever writes to
   `twofold-staging`.

3. Check that the counts look like production's. For example, `accounts` should match the
   number of people who have signed up.
4. Run **Deploy staging** once, so staging gets any migrations newer than the export.
5. Open staging and sign in with your own production password. Signing in shows that key
   slots, salts and login checks came back intact. Photos show as missing, because the
   photo files live in R2 and the drill only restores the database.
6. Note the date and the export you used in the restore log below.

Sign in only with your own account. Staging now holds a copy of everyone's (encrypted)
records, so when you've checked, empty it again:

```sh
pnpm --filter @twofold/api drill wipe
```

## Restore log

| Date       | Export                       | Result                                               |
| ---------- | ---------------------------- | ---------------------------------------------------- |
| 2026-10-29 | `d1/2026-10-29T0912Z.sealed` | Opened and imported; owner signed in. Staging wiped. |
