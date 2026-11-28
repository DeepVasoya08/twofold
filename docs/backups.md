# Backups and restore

What protects Arcafold's data, how to set it up, and how to bring things back.

| Store                 | Protection                                                       | Kept                                  |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| D1 (`arcafold`)       | D1 Time Travel: rewind to any minute                             | 30 days on Workers Paid, 7 on Free    |
| D1 (`arcafold`)       | Nightly sealed export to `arcafold-backups/d1/` (`backup.yml`)   | 30 days                               |
| R2 (`arcafold-blobs`) | Hourly copy to `arcafold-backups/r2/` (`arcafold-backup` Worker) | Until 30 days after a file is deleted |

D1 matters most. It holds every account's key slots, so without it the photos in R2 can't
be decrypted by anyone, recovery key or not.

Each account's storage total and counts (what it added to the database today, its wrong
invite codes) aren't in D1 or its backups: they live in a Durable Object per account
(`AccountCounters`), so that the database's history can't line accounts up with their spaces
([security.md](security.md#account-totals-live-outside-the-database)). Nothing backs them up
on purpose. Cloudflare keeps 30 days of point-in-time history for them, which only Worker
code can use.

## How the photo backup works

A separate Worker, `arcafold-backup` (`apps/api/src/backup`, `wrangler.backup.jsonc`), runs
every hour at minute 17. It holds the photo bucket and the backup bucket; the app's Worker
never holds the backup bucket. Each run lists both buckets and then:

1. Copies every file that isn't backed up yet to `arcafold-backups/r2/<same name>`, once
   the file is an hour old (a pending upload may still be retried). A first backup of many
   files spreads over several runs, at most 500 files per run.
2. Marks copies whose file has disappeared, with an empty `gone/<name>`. Its upload time
   is when the file was first missed.
3. Removes a copy and its mark 30 days after the mark. A photo deleted by mistake, or by
   someone with access to the photo bucket, can still be restored for those 30 days.

Copies are stored in R2's Infrequent Access class ($0.01 per GB-month instead of $0.015).
They're only read during a restore, which costs $0.01 per GB read, and every copy lives at
least 30 days, that class's minimum. Marks stay in Standard.

The files are already encrypted on the device, so the copies are ciphertext; this keeps
deleted photos' ciphertext for 30 days more. If the photo bucket ever lists empty while
copies exist, nothing is marked: that's far more likely a broken binding than every photo
deleted at once. Failed copies are retried the next hour, and a run with failures shows as
an error in the Worker's logs and metrics. It logs only counts, never file names.

## How the nightly export works

`.github/workflows/backup.yml` runs at 20:30 UTC (02:00 in India) and on demand:

1. `wrangler d1 export DB --remote` writes the whole database as SQL on the runner.
2. `pnpm --filter @arcafold/api backup seal` seals it to the `BACKUP_PUBLIC_KEY` variable
   (`@arcafold/crypto/backup`: a fresh secretstream key, sealed with `crypto_box_seal`). The
   plain export is deleted on the runner and never uploaded.
3. The sealed file goes to `arcafold-backups/d1/<UTC date and time>.sealed`.

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
pnpm --filter @arcafold/api backup keygen "$HOME/arcafold-backup.key"
```

It saves the secret key to that file (readable only by you) and prints the public key.
Use an absolute path: the command runs inside `apps/api`.

- Copy the secret key into your password manager, and print or write it down too. **If it
  is lost, the exports can't be opened** (D1 Time Travel still works). Then delete the file.
- The public key is not secret; it goes to GitHub in step 4.

### 2. Create the backup bucket

```sh
cd apps/api
pnpm exec wrangler r2 bucket create arcafold-backups
# Nothing can delete or overwrite an export for 30 days, our own tokens included.
pnpm exec wrangler r2 bucket lock add arcafold-backups d1-30-days d1/ --retention-days 30
# Then exports are removed a day after the lock ends.
pnpm exec wrangler r2 bucket lifecycle add arcafold-backups d1-expiry d1/ --expire-days 31
# Photo copies can't be deleted or overwritten for 30 days either.
pnpm exec wrangler r2 bucket lock add arcafold-backups r2-30-days r2/ --retention-days 30
# The Worker puts new copies in Infrequent Access. This moves copies made before that once
# their lock has ended (31 days), so older copies get cheaper too.
pnpm exec wrangler r2 bucket lifecycle add arcafold-backups r2-infrequent r2/ --ia-transition-days 31
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

Use D1 Time Travel. It restores in place, and the database ID stays the same. A restore
rewinds the live database for everyone: anything written after that point (accounts,
uploads, shares, deletes) is gone, and photos uploaded since then lose their records.
Check the point with `info` first.

Account storage totals don't rewind with it, and can't be rebuilt from the database by
design, so an account's total still counts the photos uploaded after the restore point.
The same goes for a restore from an export, below.

`apps/api/wrangler.jsonc` holds a placeholder database ID that only the deploy workflow
fills in. Before these commands, set `database_id` there to your real ID (the
`D1_DATABASE_ID` variable) and don't commit it. Timestamps need the full form with seconds
(`2026-11-02T10:00:00Z`) or a Unix time.

```sh
cd apps/api
pnpm exec wrangler d1 time-travel info DB --timestamp 2026-11-02T10:00:00Z   # check the point
pnpm exec wrangler d1 time-travel restore DB --timestamp 2026-11-02T10:00:00Z
```

It prints a bookmark for the state before the restore. Keep it: restoring to that bookmark
(`--bookmark <it>`) undoes the restore.

### Time Travel can't help (database deleted, or older than its window)

1. Download the export you want from the `arcafold-backups` bucket (dashboard, or
   `pnpm exec wrangler r2 object get arcafold-backups/d1/<name>.sealed --file d1.sealed --remote`).
2. Open it on your own computer with the offline key:
   `pnpm --filter @arcafold/api backup open "$PWD/d1.sealed" "$PWD/d1.sql" "$HOME/arcafold-backup.key"`
3. Create a new database and import it:
   `pnpm exec wrangler d1 create arcafold-restored` then
   `pnpm exec wrangler d1 execute arcafold-restored --remote --file d1.sql`.
4. Set the `D1_DATABASE_ID` variable to the new ID and re-run the deploy workflow.
5. Delete `d1.sql` and `d1.sealed` from your computer.

Data written after the export is lost, so prefer the newest export. Sessions in it may
have expired; people just log in again.

### Photo files are missing or damaged

Copies keep the photo bucket's names, so a restore copies `r2/<name>` back to `<name>`.
The photo's database record must exist too: if it was deleted, rewind the database first
(Time Travel, above).

- **One photo:** with its ID (from the database row),
  `pnpm exec wrangler r2 object get arcafold-backups/r2/photos/<id>/full --file full --remote`
  then `pnpm exec wrangler r2 object put arcafold-blobs/photos/<id>/full --file full --remote`,
  and the same for `thumb`. Delete the local files afterwards.
- **Everything:** wrangler can't list a bucket, so use rclone with an R2 API token
  (**R2 → Manage API tokens**, Object Read & Write on both buckets):
  `rclone copy r2:arcafold-backups/r2/ r2:arcafold-blobs/ --ignore-existing --s3-storage-class STANDARD`.
  Files that are still there are left alone. The last flag keeps restored photos in
  Standard, since the app reads them often.

Reading copies back costs $0.01 per GB (Infrequent Access), so a full restore of 1 TB costs
about $10.

Practise a restore every quarter on staging, never on production: see
[staging.md](staging.md#restore-drill-every-quarter).

## Still to come

- An off-Cloudflare copy (for example Backblaze B2), so one Cloudflare account isn't the
  only place the data lives.
