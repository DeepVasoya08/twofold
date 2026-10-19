# Security model

Twofold is end-to-end encrypted. The rules in [CLAUDE.md](../CLAUDE.md) are
non-negotiable; this document is the threat model and key design as they stand.

## Baseline

- All crypto is confined to `packages/crypto` and uses standard libsodium constructions
  (`libsodium-wrappers-sumo`, the build that includes Argon2id) plus Web Crypto SHA-256.
  The API imports only `@twofold/crypto/webcrypto`, which never loads libsodium.
- The web app and the API share one origin (a single Worker), so there is no CORS
  surface and `connect-src 'self'` covers API calls.
- The web app ships a strict Content-Security-Policy and related headers via
  `apps/web/public/_headers` (Workers Static Assets). `'wasm-unsafe-eval'` is allowed so
  libsodium's WebAssembly can load. libsodium is loaded on first use, not on the welcome page.
  `Strict-Transport-Security` makes browsers use HTTPS only, ahead of a custom domain.
- API responses get their own, stricter headers (`default-src 'none'`, `X-Frame-Options:
DENY`, `no-referrer`, `nosniff`, `Cache-Control: no-store`) in `apps/api/src/app.ts`.
- CI runs `pnpm audit --audit-level high` on every PR and push to `main`.
- Credentials live only in GitHub secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

## Key slots

Every account has one random 16-byte salt and exactly **three key slots**, always in this
order:

| Slot | Opened by        | Holds                                                       |
| ---- | ---------------- | ----------------------------------------------------------- |
| 0    | main password    | the main library's space key                                |
| 1    | recovery key     | the same main library space key                             |
| 2    | private password | the private space's own space key, or random bytes if unset |

A space key is 32 random bytes plus a 16-byte random space id, made on the device.

**From a password to a slot** (`packages/crypto/src/keyring.ts`):

1. `master = Argon2id(password (NFC), salt)` with `crypto_pwhash` at 64 MiB and 3 passes
   (the parameters are stored with the account so they can be raised later; the client
   refuses anything below that minimum, so a hostile server can't downgrade them).
2. `wrapKey` and `loginKey` are two `crypto_kdf_derive_from_key` subkeys of `master`
   (context `twofold1`, ids 1 and 2).
3. A slot is `nonce ‖ crypto_secretbox(spaceKey ‖ spaceId, wrapKey)`: 88 bytes.
4. The slot's **verifier** is `SHA-256(loginKey)`. The server keeps it to check logins.
   Guessing a password from a verifier still costs one Argon2id run per guess.

**Where Argon2id runs.** Always on the device, never on the server: the server would need
the password, and seeing a second password work would reveal the private space. In the web
app it runs in a Web Worker (`packages/crypto/src/password-worker.ts`, set up by
`setPasswordHasher` and `workerHasher`), a thread of the same page loaded from the same
origin, so the page keeps responding during the second or so it takes on a phone. Each hash
gets a fresh worker that is shut down once it answers; it receives only the normalized
password, salt and parameters (checked again in the worker) and returns `master`, and the
copy it hashed into is wiped. If a worker can't start or fails, the hash runs on the main
thread instead, with the same result. Because the page stays usable meanwhile, a login,
unlock or password change that finishes after the person locked or signed out doesn't put
keys back in memory (`app/account.tsx`).

The recovery key is 128 random bits written as 12 BIP-39 words (with BIP-39's 4-bit
checksum). It is already uniformly random, so its `master` is a keyed BLAKE2b
(`crypto_generichash` keyed by the salt) instead of Argon2id.

### Why nobody can tell whether a private space exists

- At sign-up slot 2 and verifier 2 are **random bytes** of exactly the same size as real
  ones. A secretbox ciphertext under an unknown key is indistinguishable from random, so
  one copy of the stored keyring looks the same with or without a private space (but two
  copies can differ; see the trade-offs below).
- Every change uploads **all three slots and verifiers** together (`PUT
/api/account/keyring`). Changing the main password, making a new recovery key and setting
  up a private space are the same request. D1 keeps no per-slot columns or timestamps.
- **Unlocking** on a device that is already signed in fetches the keyring and tries the
  password against every slot locally, always all of them. Nothing is sent to the server.
- **Logging in** on a new device sends the login key; the server compares it against all
  three verifiers in constant time and returns the same response whichever matched.
- The main library never decrypts slot 2 on its own, so it has nothing to show. Settings
  always offers "Set up", and moving a photo with a wrong password gives the same answer as
  having no private space.
- **Moving photos in** from the main library needs the private space's key. The first move
  after unlocking asks for the private password once and keeps that key in memory
  (`Session.otherSpace`) until Twofold locks, so later moves don't ask. Setting up a
  private space keeps its fresh key the same way. Nothing about this reaches the server.
  Skipping the prompt entirely would mean the main library holding something that opens or
  addresses the private space at rest, which is exactly what deniability rules out.
  Moving photos back out of the private space asks for the main password the same way.
- Setting up a private space from the main library writes a new slot 2, replacing any
  private space that was there (the main library cannot know). The dialog says so to
  everyone, always.

### Trade-offs we accepted

- **The private space has no recovery.** If the recovery key could open it, anyone holding
  the recovery key would learn it exists. Forget the private password and that space is
  gone; the recovery key restores the main library and leaves slot 2 untouched.
- **Keyring history shows when the private slot changes.** Every keyring write copies the
  slots it doesn't change byte for byte, and the main library can't re-seal slot 2 without
  its key. So anyone who can compare two copies of an account's row (a compromised server
  watching the `PUT`, or D1 Time Travel, a backup or an export, which keep earlier copies
  for days) sees when slot 2 alone changed, and so that a private space was set up or its
  password changed. It reveals nothing else: no photos, keys or passwords. Closing it would
  need a new construction (ruled out by "never invent crypto") or a private password that can
  only be set at sign-up and never changed; we accepted the gap instead.
- **A compromised, live server could notice a second login key** when someone logs in with
  the private password on a new device (the stored data still reveals nothing). A
  compromised server could equally serve altered JavaScript, which is the limit of any
  web-delivered end-to-end encryption, so this adds no new exposure.
- **Storage doesn't link spaces to accounts at rest, but a live server could.** A
  compromised server watching requests sees which session uses which space token, the
  same exposure as the login key above. It can also count spaces: on a server with one
  account, a second space's photos show that a private space exists. With many accounts,
  nothing ties a space to its owner.
- **Some ciphertext can be orphaned.** Setting up a private space from the main library
  replaces any existing one without being able to delete its photos, and deleting an
  account can only wipe spaces whose keys are on the device. What's left can never be
  decrypted or reached again, but it isn't deleted.
- **The storage quota keeps a total per account.** Each account may keep 1 GB of
  ciphertext across every space it uploads to (`stored_bytes` on `accounts`). Only the total
  is stored, never which photos or spaces it is made of, but with few accounts the total can
  be matched against the sizes of spaces (500 MB = 300 + 200) and so show which spaces,
  including a private one, belong to an account. Deepu chose an exact per-account cap over a
  per-space one knowing this. Uploads are charged to the uploading account when they start,
  and deleted photos are given back to the account that deletes them (storage doesn't know
  who uploaded them), so a member deleting an owner's photo frees the member's quota, not
  the owner's.
- **Infrastructure keeps its own history.** R2 records when each object was uploaded, and
  D1 keeps point-in-time history for its Time Travel window, so a deleted photo's sealed
  row (not its key or contents) can outlive the delete for that long.
- **Sign-up reveals whether an email is registered** (and `POST /api/auth/prelogin`
  answers 404 for unknown emails). Hiding it needs email verification, which doesn't exist
  yet.
- The two passwords must differ; the client refuses a new password that already opens
  another slot.

## Photo storage

Photos and albums belong to a **space**, never to an account. A space can be shared with
other accounts; see [Sharing](#sharing).

- **Addressing.** A space's storage is named by its access token, the 16-byte space id
  from its key slot, sent in the `x-twofold-space` header. D1 stores only
  `SHA-256(token)` in a `space` column. There is no account column, no index by account
  and no table that maps one to the other, so the database can't say whose photos these
  are, or whether an account has one space or two. Storage routes still need a signed-in
  session, so only accounts can use storage, but the session is not recorded with what it
  writes.
- **Photo keys.** Every photo has its own random key. Its two files, a 640px JPEG preview
  made on the device and the original byte for byte, are each encrypted with
  `crypto_secretstream_xchacha20poly1305` in 64 KiB chunks, so any change, reordering or
  truncation fails to decrypt (`packages/crypto/src/storage.ts`).
- **Records.** A photo's metadata (its key, media type, size in pixels, date, favorite,
  albums) and an album's title are JSON sealed with `crypto_aead_xchacha20poly1305_ietf`
  under a `crypto_kdf` subkey of the space key (context `twfspace`). The associated data is
  the record's kind and id, so the server can't swap one record for another, and the
  plaintext is padded to 256-byte blocks. Records that don't open are left out.
- **What the server keeps.** Per photo: a random id, the space tag, the sealed record and
  the two ciphertext sizes; R2 objects are `photos/<id>/thumb` and `photos/<id>/full`.
  Rows carry no timestamps; `pending_since` is set only while an upload hasn't been
  committed, so abandoned uploads in a space are cleaned up after a day.
- **Uploads** are created, then both files are sent with their declared sizes (checked
  again after R2 stores them), then committed. Nothing is listed or served until commit,
  and a committed photo's files can't be overwritten. Records are at most 2 KiB, previews
  1 MiB and originals 64 MiB of ciphertext.
- **Moving** a photo to the other space downloads and decrypts it, adds it to the other
  space under a new id and key, then deletes the original. The two copies share nothing
  the server can match.
- **Deleting the account** first wipes every space the device holds keys for (the open
  one, the other one if its password was typed this session, and the one the confirming
  password opens), then the account.

## Sharing

A space is shared with another account by giving it **access**, not keys: a share token of
its own and the space's records key (the `crypto_kdf` subkey photos and albums are sealed
under). It never gets the space key or the space id.

- **Access.** The owner registers the member's share token with `POST /api/space/members`;
  D1 keeps only its SHA-256, in a `members` row next to the space's tag. A request whose
  `x-twofold-space` header is a share token reaches the owner's photos and albums: the
  member can view, add, favorite and delete photos, and add, rename and delete albums. The owner-only routes
  (who it's shared with, joined libraries, wiping the space) refuse share tokens.
- **Deleting an album** removes its row; the server can't read which photos name it, so the
  browser takes the album out of each photo's sealed metadata afterwards (best effort: a
  photo that still names a deleted album just shows nothing for it).
- **Sending copies.** Share on a selection or an album decrypts the originals into memory and
  hands them to the device's share sheet, or downloads them where there is none. Those
  copies leave Twofold unencrypted, and the dialog says so before anything is sent.
- **Owner-only records.** Who a space is shared with (`members`) and which libraries it
  joined (`joined`) are sealed under a second `crypto_kdf` subkey of the space key (id 2),
  which members never receive. So even a server that showed a member those rows couldn't
  make it read them, and joining a library doesn't open the libraries its owner joined.
- **Where shares live.** Both lists are stored per space, like photos, so nothing links
  them to an account. A library joined from the private space is kept in the private
  space's rows and only appears there. Sharing the private space tells the person you share
  it with that it exists, by your choice; it tells the server nothing new.
- **Who added what.** Photos a member adds carry their member id and name inside the
  sealed metadata, so the owner (and other members) see "Added by" without the server
  learning it. Photos from a joined library appear in the joiner's open space, marked with
  the owner's name, and can't be moved to the joiner's other space.
- **Stopping.** The owner removes a member (`DELETE /api/space/members/:id`) and that share
  token stops working at once; a member can also leave (`DELETE /api/space/membership`).
  Deleting an account leaves the libraries its reachable spaces joined, and wiping a space
  removes its `members` and `joined` rows.

### Invites

An invite moves the access from one browser to another through a server we don't trust,
in steps both sides poll for (`packages/crypto/src/sharing.ts`, `apps/api/src/routes/invites.ts`):

1. The inviter makes a code (`TWO-XXXX-XXXX`, 8 characters from 32, so 40 bits), a random
   handle that stays on its device, and a `crypto_box` key pair. It sends the code, the
   handle and a **commitment** to its public key (keyed BLAKE2b), not the key itself. D1
   keeps the code and handle only as SHA-256, with no account or space.
2. The joiner enters the code, reads the commitment and sends its own public key. Only the
   first key is accepted, so a code works once.
3. The inviter reveals its public key. The joiner checks it against the commitment, then
   sends its name sealed to the inviter's key (`crypto_box`, `hello`).
4. Both show a **safety phrase**: 4 BIP-39 words (44 bits) hashed from both public keys.
   If anyone swapped a key, the phrases differ. Because the inviter committed before seeing
   the joiner's key, and the joiner's key is sent before the inviter's is revealed, a
   server in the middle has to pick its fake keys blind: one guess at 2^-44 per invite.
5. Only when the inviter confirms the words match does it register the member and send
   the access (`grant`: share token, records key, its own name, the member id) sealed to
   the joiner's key. The joiner keeps it as an owner-only `joined` record in the open
   space and deletes the invite.

Every sealed message starts with a purpose label (`hello` or `grant`), so one can't be
replayed as the other. Each side's steps need its own secret: the code for the joiner, the
handle for the inviter, and the server only accepts steps in order. Unknown codes count
against the account like wrong passwords (10 per 15 minutes, counted before the lookup and
given back for a real code, so parallel guesses don't get more). Invites expire after 24
hours, and the inviter's screen cancels its invite when it closes.

### Trade-offs we accepted

- **Stopping sharing is enforced by the server, not by new keys.** A removed member still
  knows the records key and the per-photo keys of photos it saw, and could decrypt any
  ciphertext it got hold of later. The server refuses its token from the moment it's
  removed, but a compromised server could still hand it new ciphertext. Rotating the space
  key on removal would close that and is left for later.
- **A member can delete photos for everyone**, like the owner. Sharing is for people you
  trust.
- **The safety phrase is only as good as the comparison.** If nobody checks the words, a
  compromised server could put itself in the middle of that invite.
- **A live server sees who joins what.** Like storage, a compromised server watching
  requests can link the sessions on either side of an invite, and a member's session to
  the share token it uses. Nothing at rest records it.

## Sessions and the API

- Passwords never reach the API. It sees the keyring (salt, KDF settings, sealed slots,
  verifiers), the email and display name, login keys, space tokens, and ciphertext.
- A login (or sign-up) sets a 256-bit random session token in an `HttpOnly`,
  `SameSite=Strict` cookie (`__Host-` prefixed and `Secure` over HTTPS), valid 30 days.
  D1 stores only its SHA-256, and expired sessions are deleted when a new one starts.
- Any keyring change (a password, the recovery key, or setting up a private space) signs
  out every other device. It has to be every change: the server can't tell which slot
  changed, and treating them differently would tell it.
- Every write must be `Content-Type: application/json` (or `application/octet-stream` for
  encrypted files), which a cross-site form can't send without a CORS preflight the API
  never answers. This backs up `SameSite=Strict`; storage requests also carry a custom
  header, which needs a preflight too.
- Changing the keyring or deleting the account needs a fresh login key as well as the
  cookie. Keyring updates carry a version number, so two devices can't silently overwrite
  each other, and may not change the salt or KDF settings.
- Failed logins (and failed proofs) are limited to 10 per email from one internet address
  per 15 minutes, and 200 per email from all addresses together, counted for unknown emails
  too. Guessing from one address can't lock anyone else out, and a lockout needs 20
  addresses. Each attempt is counted, in one statement, before its key is checked (a right
  key then clears the counts), so parallel requests can't get more guesses than that. The
  address is stored only as a SHA-256, and every count is deleted once its window passes.
- The Worker keeps no per-request logs or traces (`observability` in
  `apps/api/wrangler.jsonc`), only its own error lines. Request logs would keep every
  request's path, headers and client details at Cloudflare, which could link the private
  space's requests to the main library's for as long as they're stored.
- Input is validated with zod at the API boundary (`apps/api/src/schemas.ts`), including
  exact key sizes and KDF bounds.

## In the browser

- Keys live only in React state (`apps/web/src/app/account.tsx`). Locking, signing out or
  reloading drops them and remounts the vault, which drops every decrypted photo and
  revokes its object URLs.
- Nothing is written to `localStorage`, IndexedDB or caches.
- Only raster photo formats are stored or shown (JPEG, PNG, GIF, WebP, HEIC, AVIF;
  `apps/web/src/lib/photo-types.ts`). An SVG is a document that can carry script, so it is
  refused on upload and left out if a record names it.

## Still to design

- Rotating a space's key when someone stops sharing it (see the sharing trade-offs).
- Metadata minimisation in D1 (the display name is stored in plain text today, like the
  email).
