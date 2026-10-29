# Backups and restore

What protects Twofold's data, how to set it up, and how to bring things back.

| Store                | Protection                                                    | Kept                               |
| -------------------- | ------------------------------------------------------------- | ---------------------------------- |
| D1 (`twofold`)       | D1 Time Travel: rewind to any minute                          | 30 days on Workers Paid, 7 on Free |
| D1 (`twofold`)       | Nightly sealed export to `twofold-backups/d1/` (`backup.yml`) | 30 days                            |
| R2 (`twofold-blobs`) | Not yet: the copy Worker needs Workers Paid (Queues)          | —                                  |

D1 matters most. It holds every account's key slots, so without it the photos in R2 can't
be decrypted by anyone, recovery key or not.

## How the nightly export works

`.github/workflows/backup.yml` runs at 20:30 UTC (02:00 in India) and on demand:

1. `wrangler d1 export DB --remote` writes the whole database as SQL on the runner.
2. `pnpm --filter @twofold/api backup seal` seals it to the `BACKUP_PUBLIC_KEY` variable
   (`@twofold/crypto/backup`: a fresh secretstream key, sealed with `crypto_box_seal`). The
   plain export is deleted on the runner and never uploaded.
3. The sealed file goes to `twofold-backups/d1/<UTC date and time>.sealed`.

Only the secret key can open an export, and it never goes to GitHub or Cloudflare. The
export holds salts and login verifiers, which would allow offline password guessing, so
this sealing matters even though photos and keys in it are already encrypted.

The job runs in the `production` environment and fails with a clear error while
`BACKUP_PUBLIC_KEY` or `CLOUDFLARE_BACKUP_API_TOKEN` is missing there, so a backup is never
silently skipped. A failed run emails the repository owner. GitHub turns scheduled workflows off after 60 days without commits; if that happens,
re-enable it on the Actions tab.

D1 answers other requests slowly while an export runs, which is why it runs at night.

## One-time setup

### 1. Make the backup key pair (on your own computer)

```sh
pnpm install
pnpm --filter @twofold/api backup keygen "$HOME/twofold-backup.key"
```

It saves the secret key to that file (readable only by you) and prints the public key.
Use an absolute path: the command runs inside `apps/api`.

- Copy the secret key into your password manager, and print or write it down too. **If it
  is lost, the exports can't be opened** (D1 Time Travel still works). Then delete the file.
- The public key is not secret; it goes to GitHub in step 4.

### 2. Create the backup bucket

```sh
cd apps/api
pnpm exec wrangler r2 bucket create twofold-backups
# Nothing can delete or overwrite an export for 30 days, our own tokens included.
pnpm exec wrangler r2 bucket lock add twofold-backups d1-30-days d1/ --retention-days 30
# Then exports are removed a day after the lock ends.
pnpm exec wrangler r2 bucket lifecycle add twofold-backups d1-expiry d1/ --expire-days 31
```

### 3. Create the backup API token

**My Profile → API Tokens → Create Token → Create Custom Token**, **Account** permissions:

| Permission         | Level | Used by                            |
| ------------------ | ----- | ---------------------------------- |
| D1                 | Edit  | `wrangler d1 export --remote`      |
| Workers R2 Storage | Edit  | `wrangler r2 object put` (exports) |

Account Resources: your account only. This token can't deploy code. Cloudflare's R2
permission covers every bucket, so the bucket lock (step 2) is what protects the exports
from it.

### 4. Configure GitHub

Add both to the `production` environment (Settings → Environments → production), where the
deploy workflow's values already are:

| Where                 | Name                          | Value                  |
| --------------------- | ----------------------------- | ---------------------- |
| Environment secrets   | `CLOUDFLARE_BACKUP_API_TOKEN` | the token from step 3  |
| Environment variables | `BACKUP_PUBLIC_KEY`           | the public key, step 1 |

`CLOUDFLARE_ACCOUNT_ID` and `D1_DATABASE_ID` are shared with the deploy workflow.

Then run **Actions → Backup → Run workflow** once and check that a file appears under
`d1/` in the bucket.

## Restore

Always start with the least drastic option.

### The database changed badly in the last 30 days (7 on Free)

Use D1 Time Travel. It restores in place, and the database ID stays the same.

```sh
cd apps/api
pnpm exec wrangler d1 time-travel info DB --timestamp 2026-11-02T10:00:00Z   # check the point
pnpm exec wrangler d1 time-travel restore DB --timestamp 2026-11-02T10:00:00Z
```

It prints a bookmark for the state before the restore, so a restore can be undone the same
way.

### Time Travel can't help (database deleted, or older than its window)

1. Download the export you want from the `twofold-backups` bucket (dashboard, or
   `pnpm exec wrangler r2 object get twofold-backups/d1/<name>.sealed --file d1.sealed --remote`).
2. Open it on your own computer with the offline key:
   `pnpm --filter @twofold/api backup open "$PWD/d1.sealed" "$PWD/d1.sql" "$HOME/twofold-backup.key"`
3. Create a new database and import it:
   `pnpm exec wrangler d1 create twofold-restored` then
   `pnpm exec wrangler d1 execute twofold-restored --remote --file d1.sql`.
4. Set the `D1_DATABASE_ID` variable to the new ID and re-run the deploy workflow.
5. Delete `d1.sql` and `d1.sealed` from your computer.

Data written after the export is lost, so prefer the newest export. Sessions in it may
have expired; people just log in again.

## Still to come

- R2 copy-on-write into `twofold-backups/r2/` by a separate Worker (needs Workers Paid for
  Queues).
- A staging Worker and a quarterly restore drill.
