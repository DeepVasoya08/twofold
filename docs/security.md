# Security model

Arcafold is end-to-end encrypted. The rules in [CLAUDE.md](../CLAUDE.md) are
non-negotiable; this document is the threat model and key design as they stand.

## Baseline

- All crypto is confined to `packages/crypto` and uses standard libsodium constructions
  (`libsodium-wrappers-sumo`, the build that includes Argon2id) plus Web Crypto SHA-256.
  The API imports only `@arcafold/crypto/webcrypto`, which never loads libsodium.
- The web app and the API share one origin (a single Worker), so there is no CORS
  surface and `'self'` in `connect-src` covers API calls. The only other hosts the app may
  connect to are Google's Photos Picker API (`photospicker.googleapis.com`) and the host
  picked photos download from (`*.googleusercontent.com`), for Connect Google Photos.
- The web app ships a strict Content-Security-Policy and related headers via
  `apps/web/public/_headers` (Workers Static Assets). `'wasm-unsafe-eval'` is allowed so
  libsodium's WebAssembly can load. libsodium is loaded on first use, not on the welcome page.
  `Strict-Transport-Security` makes browsers use HTTPS only, ahead of a custom domain.
- API responses get their own, stricter headers (`default-src 'none'`, `X-Frame-Options:
DENY`, `no-referrer`, `nosniff`, `Cache-Control: no-store`) in `apps/api/src/app.ts`.
- CI runs `pnpm audit --audit-level high` on every PR and push to `main`. An advisory with
  no fixed version, reached only by dev or build tools, may be ignored by its GHSA id under
  `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, with a note saying why; take it out
  once a fix ships.
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
   (context `arcafold`, ids 1 and 2).
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
  (`Session.otherSpace`) until Arcafold locks, so later moves don't ask. Setting up a
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
- **Backups keep 30 days of history too.** A nightly export of D1 is kept for 30 days
  ([backups.md](backups.md)). It holds what D1 holds (sealed records, salts, login
  verifiers, emails, the per-account storage total), so it carries the same signals as Time
  Travel: earlier copies of each keyring row, and deleted rows for up to 30 days. Each export
  is sealed (`crypto_box_seal` of a fresh secretstream key, `@arcafold/crypto/backup`) to a
  public key whose secret half is kept offline, so a leaked export can't be used for
  offline password guessing. A restore drill opens one on the owner's own computer and
  loads it into the separate staging database ([staging.md](staging.md)), which is wiped
  again afterwards. The opened export never goes to GitHub, and the drill deletes it when it
  finishes.
- **Photo files are copied to a backup bucket** every hour by a separate Worker, and a
  deleted photo's copy is kept 30 days after the deletion ([backups.md](backups.md)). The
  copies are the same ciphertext under the same random names, so they reveal nothing the
  photo bucket doesn't, but deleted photos' ciphertext outlives the delete by 30 days. The
  backup bucket is locked for those 30 days, so a stolen token can't wipe it.
- **Sign-up reveals whether an email is registered** (and `POST /api/auth/prelogin`
  answers 404 for unknown emails). Hiding it needs email verification, which doesn't exist
  yet.
- The two passwords must differ; the client refuses a new password that already opens
  another slot.

## Photo storage

Photos and albums belong to a **space**, never to an account. A space can be shared with
other accounts; see [Sharing](#sharing).

- **Addressing.** A space's storage is named by its access token, the 16-byte space id
  from its key slot, sent in the `x-arcafold-space` header. D1 stores only
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
  under a `crypto_kdf` subkey of the space key (context `arcspace`). The associated data is
  the record's kind and id, so the server can't swap one record for another, and the
  plaintext is padded to 256-byte blocks. Records that don't open are left out.
- **What the server keeps.** Per photo: a random id, the space tag, the sealed record and
  the two ciphertext sizes; R2 objects are `photos/<id>/thumb` and `photos/<id>/full`.
  Rows carry no timestamps; `pending_since` is set only while an upload hasn't been
  committed, so abandoned uploads in a space are cleaned up after a day.
- **Uploads** are created, then both files are sent with their declared sizes (checked
  again after R2 stores them). The second file to land commits the photo, and the commit
  itself checks both sizes against what was declared; a separate commit call is a
  fallback. Nothing is listed or served until commit,
  and a committed photo's files can't be overwritten. Records are at most 2 KiB, previews
  1 MiB and originals 64 MiB of ciphertext.
- **Recently deleted.** Deleting a photo first sets a `trashed` flag on its row and
  replaces its sealed record in the same statement (`POST /api/space/trash`); restoring
  clears it (`POST /api/space/trash/restore`). The record carries when it was deleted;
  the server stores no date, so nothing at rest says when a space (a private one
  included) was used. The device deletes a photo for good once 30 days have passed, the
  next time the space is opened, so a space nobody opens keeps its deleted photos until
  then. Trashed photos are hidden from the photo list and from shared albums, still
  count against storage, and can be listed (`GET /api/space/trash`) only by the owner
  and members who can edit. Moving a photo to the other space, wiping a space and
  deleting the account still delete at once.
- **Connect Google Photos.** The browser signs in to Google itself (OAuth's token flow, in a
  window of its own, asking only for `photospicker.mediaitems.readonly`, so Arcafold can see
  only the photos the person picks). Google sends the access token back in the URL fragment
  of `/import/google/done`, which never reaches a server; that page passes it to the app over
  a same-origin `BroadcastChannel`, checked against a random `state`, wipes it from the
  address bar and closes. The token is kept in memory only, never logged or stored, and
  forgotten when the import ends or the vault locks. Each picked photo downloads from Google
  straight into the browser and goes through the same encryption as an upload; Arcafold's
  server never sees the photos or the Google account.
- **Fingerprints.** Each new photo's sealed record also holds `fp`, a keyed BLAKE2b hash
  (`crypto_generichash`, 32 bytes) of its original, under a key derived from the space's
  records key (`crypto_kdf`, context `arcprint`, id 1; `photoFingerprint` in
  `packages/crypto/src/storage.ts`). The same photo always gets the same fingerprint in the
  same space, so an import can skip photos already there by comparing against the records
  it has opened, with no server lookup. The fingerprint never leaves the sealed record, and
  it is keyed, so it can't be matched against a known photo without the space's keys.
  Members who can add photos have the records key and compute the same fingerprints; they
  can already see every photo, so this tells them nothing new. Photos stored before
  fingerprints have none.
- **Files** that aren't photos (PDFs, documents, anything but video) are stored exactly
  like photos: a random id, a sealed record, a preview and the original under the file's
  own key, in the same table and R2 layout. The sealed record adds `kind: "file"` and the
  file's `name` (folders and control characters stripped, at most 120 characters); its
  `type` is any well-formed media type. The server can't tell a file from a photo: it sees
  the same two files, and every photo record is padded to at least 1,000 bytes before
  sealing (spaces in an ignored `pad` field), so a file's record, with its name, category
  and words, is the same size as a photo's. A file's words are dropped rather than let its
  record grow past that; records sealed before the padding stay at their old size until
  they next change. A PDF's first page is drawn as its preview on
  the uploading device (pdf.js, see below), as a JPEG padded with zeros after its end to at
  least 16 KiB; any other file, or a PDF the device couldn't draw in time, stores a stand-in
  of 16 to 48 KiB (zeros, encrypted like any preview). Neither is ever missing or tiny, which
  would single files out, and the sealed record says `preview: true` only for a drawn one.
  Apps from before files existed leave these records out, since their type isn't a photo
  format.
- **Folders** in Files are stored as album records (same table, same `crypto_aead`
  construction and associated data), so the server can't tell a folder from an album, how
  many of each there are, or how they nest. The sealed record is `{ v: 1, kind: "folder",
name, parent?, deletedAt? }`: it has a `name` rather than an album's `title`, so apps from
  before folders existed refuse it instead of listing it in Albums. A file (or photo) is in
  a folder when its sealed `albumIds` name it, and in one folder at most; moving it rewrites
  only its sealed record. Deleting a folder seals the same `deletedAt` into it, the folders
  inside it and their files, so they come back together, and a device that opens the space
  deletes them for good after 30 days, as with photos. A folder that is missing or deleted
  doesn't count, so its files show at the top of Files. Unshared folders reveal nothing
  new; sharing a folder is described under Sharing.
- **Moving** a photo to the other space downloads and decrypts it, adds it to the other
  space under a new id and key, then deletes the original. The two copies share nothing
  the server can match.
- **Profile photos** belong to a space too, one per space at most (`profile_photos`, keyed
  by the space tag). The browser crops and shrinks the photo to a 256px JPEG, encrypts it
  with `encryptFile` under a key of its own, and seals that key in an owner-only `profile`
  record, so members of a shared space can't read or replace it (the routes refuse share
  tokens too). The main library and the private space each have their own photo, so one
  never shows the other exists. It counts against the storage quota like any upload (at
  most 128 KiB of ciphertext), and wiping the space removes it. The account's **name** is
  not secret: sign-up sends it in plaintext, and `PUT /api/account/name` changes it with the
  session alone.
- **Storage used.** Both spaces show the account's total (`GET /api/account/storage`,
  `stored_bytes`), asked for once the space has loaded and again after its photos change.
  Deepu chose this knowing the trade-off: someone with only the main password can see the
  total is larger than the main library's photos explain, which hints that a private space
  exists (photos added to libraries shared with you also count, which gives an innocent
  explanation, but not a strong one). The settings say the 1 GB limit
  covers everything the account stores, which is also true without a private space (photos
  added to libraries shared with you count too), so a "storage full" message before the main
  library reaches 1 GB has an innocent explanation.
- **Deleting the account** first wipes every space the device holds keys for (the open
  one, the other one if its password was typed this session, and the one the confirming
  password opens), then the account.

### Upload-only keys

Automatic backup on the phone has to add photos while Arcafold is locked, when the phone
holds no keys. It gets a way to add photos that can't read anything back
(`packages/crypto/src/storage.ts`, `packages/core/src/upload/upload-only.ts`):

- **The upload key.** The owner makes one crypto_box key pair per space. Its secret half
  is kept only as an owner-only `upload-key` record (`GET`/`PUT /api/space/upload-key`,
  table `upload_keys`), sealed under the owner subkey, so members never get it. A second
  device setting one up gets 409 and opens the one already kept.
- **Upload-only tokens.** Each phone that backs up registers a random 16-byte token of its
  own (`POST /api/space/upload-tokens`; the server keeps its SHA-256 in `upload_tokens`, at
  most 20 per space, with no timestamps). Sent in place of the space token, it reaches
  only `POST /api/space/photos`, `PUT /api/space/photos/:id/:part` and the commit, and
  every other route answers 403. It can't list, download, change, trash or delete
  anything, including the photos it added. The owner revokes a phone with
  `DELETE /api/space/upload-tokens/:id`, and wiping the space forgets the key and every
  token. A session is still required, as for every space route.
- **What the phone keeps** is that token and the public half, nothing that opens anything.
  The background job (docs/mobile.md) uses them with the kept session cookie, which reaches
  the API but no keys, so backing up never needs the password and never unlocks the app.
- **Sealing for the owner.** Each backed-up photo gets a random file key as usual. Its
  metadata (which holds that key) is sealed with a fresh random key, the same
  XChaCha20-Poly1305 record sealing bound to the kind and id, and that key is sealed to the
  public half with crypto_box_seal (`sealForUpload`). The server marks such photos
  `sealed_for_owner`. When the owner next opens the library (web or phone),
  `remoteStore` opens them with the secret half (`openUpload`), shows them, and seals them
  again under the records key, which clears the flag. Until then a member sees nothing for
  them. A record that was changed, or belongs to another id or kind, doesn't open and is
  left out.
- **Trade-offs.** Someone who takes the phone and its session can fill the library with
  photos (up to the storage limit) until the phone is signed out or its token revoked, but
  can't see or remove anything. The server learns which photos came from backup, until the
  owner's next unlock. Backed-up photos have no fingerprint (that needs the records key),
  so an import can't tell they're already there. An upload cut short can't be deleted by
  the phone and is cleared by the server after a day, like any unfinished upload. Backup
  only ever targets the main library, so nothing here hints that a private space exists.

## Sharing

A space is shared with another account by giving it **access**, not keys: a share token of
its own and the space's records key (the `crypto_kdf` subkey photos and albums are sealed
under). It never gets the space key or the space id.

- **Access.** The owner registers the member's share token with `POST /api/space/members`;
  D1 keeps only its SHA-256, in a `members` row next to the space's tag. A request whose
  `x-arcafold-space` header is a share token reaches the owner's photos and albums. The
  owner-only routes (who it's shared with, joined libraries, invites in progress, wiping the
  space) refuse share tokens.
- **What a member may do.** Each library member row has an `access` of `view` or `edit`,
  chosen by the owner when inviting (kept in the invite's sealed record until it's
  confirmed) and changeable at any time with `PUT /api/space/members/:id`. The server
  enforces it on every request: a `view` token may only make `GET` requests (and leave), so
  it can view and download but not add, change, favorite or delete anything; an `edit`
  token can also add, favorite and delete photos, and add, rename and delete albums. A
  member asks what it may do with `GET /api/space/membership`, so the app only offers what
  the server will allow; if that can't be read, the app treats the library as view-only.
  Album members are always `view`. Members from before this existed kept `edit`, which is
  what they had; new members default to `view`. The server learns only which of the two a
  token has, which says nothing about the space or the account behind it.
- **The private space is never part of it.** Sharing a library hands over that space's
  records key and a token for that space only. The private space is a different space with
  its own keys and tag, so nothing shared from the main library can reach it; private
  photos can only be shared from inside the private space (`member-access.test.ts` checks
  this at the API).
- **Deleting an album** removes its row; the server can't read which photos name it, so the
  browser takes the album out of each photo's sealed metadata afterwards (best effort: a
  photo that still names a deleted album just shows nothing for it).
- **Downloading copies.** Download on a selection or an album downloads only the originals
  (not the previews), decrypts them into memory (in a Web Worker, see below) and saves them
  to the device: one photo as a file, several as one zip built in memory (a Blob of the
  decrypted files, never written to localStorage, IndexedDB or caches), or, on a touch
  device that can share files, through the system share sheet. Those copies are not
  encrypted, and the dialog says so before anything is saved. File names come from when
  each photo was taken and the zip is called `Arcafold <date>.zip`, so neither names the
  space or album. Download links are temporary object URLs, revoked after a few seconds.
  Closing the download dialog keeps the download (and its decrypted copies) in memory so
  it can finish in the background; they're dropped once saved, when the download is
  cancelled, or when the vault locks.
- **Encrypting and decrypting off the main thread.** Originals are encrypted for upload with
  `encryptFile` and decrypted with `decryptFile` inside a Web Worker bundled from
  `@arcafold/crypto/file-crypto-worker`, so large files don't freeze the page. The worker is
  a thread of the same page: the file key and bytes go to it and the result comes back.
  One worker serves a batch and shuts down after a few idle seconds. If it can't start or
  fails, the page does the work on its own thread; a wrong key or tampered file fails the
  same way in both. Upload previews are drawn in another same-page worker
  (`apps/web/src/lib/thumbnail-worker.ts`, no crypto), which gets the photo as a Blob and
  returns the small JPEG; the page draws it itself when the browser has no OffscreenCanvas.
- **Owner-only records.** Who a space is shared with (`members`), which libraries it
  joined (`joined`) and the invites it has in progress (`pending_invites`) are sealed under
  a second `crypto_kdf` subkey of the space key (id 2), which members never receive. So even a server that showed a member those rows couldn't
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

### Sharing one album

An album can be shared on its own, without the rest of the space. The person gets a share
token limited to that album and **the album's own key**, never the space's records key.

- **The album key.** Sharing an album the first time gives it 32 random bytes of its own
  (`newAlbumKey`), kept in the album's sealed record so the owner and library members can
  keep it up to date. The album's title, and each photo it holds, are sealed again under
  that key (`crypto_aead_xchacha20poly1305_ietf`, the same construction and associated data
  as space records): the photo's file key, type, size and date, without its favorite or
  its other albums. `albums.shared_meta` and `album_items` hold those copies.
- **What the token reaches.** The owner registers the member with `album` set, and with
  `access` (View only or Add and edit, which the owner can change at any time). Requests
  with that token only reach `GET /photos` and `/albums` (which return the album key's
  copies instead of the space's records), `/thumbs` and `/photos/:id/:part` (only for
  photos the album lists), and `DELETE /membership`. Everything else is refused, so a
  view-only member can view and download but not change anything. Their key can't open the
  space's records, so even a server that handed them other rows couldn't make them readable.
- **Add and edit.** A member who may edit the album can also upload photos (`POST /photos`,
  its files and commit, and abandoning their own unfinished upload), list a photo they just
  added in the album, once (`PUT /albums/:id/items/:photo`), and take any photo out of it
  (`DELETE /albums/:id/items/:photo`). They still can't rename, delete or stop sharing the
  album, see who it's shared with, or change or delete any photo itself. A photo they add is
  sealed under the album key, the only key they have, and its row is marked
  `sealed_for_album`. The owner's device (or a library member who may edit) opens it with the
  album key, seals it again under the records key and saves it, which clears the mark, so
  it stays readable after the album stops being shared. Stopping sharing and deleting the
  album wait for that first. Its storage counts toward the account that uploaded it.
- **Taking a photo out.** When an album member takes a photo out, the server unlists it at
  once and keeps the album and photo ids in `album_removed`. The owner's device sees them in
  `GET /albums` (`removed`), takes the album out of the photo's own sealed metadata (which
  only it can change), and then lets the server forget (`DELETE /albums/:id/removed/:photo`).
  The photo itself is never deleted: it stays in the owner's library.
- **Keeping it current.** When the owner (or a library member) puts a photo in a shared
  album, takes it out, or renames the album, the browser updates the album's copies. A
  deleted photo or album is removed from `album_items` by the server, and deleting an album
  revokes everyone it was shared with. Opening the album's Share dialog to invite someone
  lists anything that was missed.
- **Stopping.** Removing someone revokes their token. **Stop sharing with everyone** also
  deletes the album's copies and drops its key, so sharing it again uses a new key.
- **On the other side.** The grant is kept as a `joined` record like a library, sealed
  under the joiner's owner-only key in the space they joined from. The album and its
  photos appear under Albums → Shared with me and stay out of the timeline.

What this reveals: for shared albums only, the server can see which photo rows are in the
album (`album_items` links an album id to photo ids) and how many, which ones an album
member added until the owner's device seals them again, and which ones a member took out
until the owner's device catches up. It still sees no
contents, titles, dates or keys. Albums that aren't shared, and the private space, reveal
nothing new. An album shared from the private space is kept in the private space's rows, so
nothing links it to an account.

### Sharing one folder

A folder in Files is shared exactly like an album (it is an album row to the server): its
own random key in its sealed record, a member row scoped to it, the same token limits, and
the same View only or Add and edit.

- **What its people see.** The folder's shared record (`albums.shared_meta`), sealed under
  its key, holds its name and every folder inside it at any depth (id, name and the folder
  it's in), padded to a whole number of KiB so its size says little about how many there
  are. It may be up to 64 KiB (`maxSharedRecord`); other records stay at 2 KiB.
  `album_items` lists every file filed anywhere inside it, each sealed under the folder key
  and filed under the folder inside it that holds it. Folders inside it that are in Recently
  deleted, and their files, are left out.
- **Keeping it current.** When the owner (or a library member) makes, renames, moves or
  deletes a folder inside it, or moves a file in or out, the browser seals the record again
  and lists or unlists what changed. Moving a folder out takes everything inside it out of
  the share. A shared folder that goes to Recently deleted stops being shared at once
  (everyone's token stops working); restoring it doesn't share it again.
- **Add and edit.** For now a member who may edit can add files, into the folder or any
  folder inside it. The upload is sealed under the folder key and marked `sealed_for_album`
  with the shared folder; the owner's device seals it again under the records key and keeps
  the folder inside it that the member chose. Making, renaming, moving and deleting folders
  and files stay with the owner.

What this reveals beyond a shared album: roughly how many folders are inside a shared
folder (to the nearest KiB of names), and, as for albums, which file rows are in it. Not
their names, the tree, or anything about folders that aren't shared.

### Invites

An invite moves the access from one browser to another through a server we don't trust
(`packages/crypto/src/sharing.ts`, `apps/api/src/routes/invites.ts`,
`packages/core/src/sharing.ts`). Neither person has to be online at the same time as the
other: each side keeps its half of the invite as a sealed record of its own open space, and
takes its next step whenever that space is next open, on any device.

1. The inviter makes a code (`TWO-XXXX-XXXX`, 8 characters from 32, so 40 bits), a **link
   token** (128 random bits, base64url), a random handle, and a `crypto_box` key pair. It
   sends the code, the link token, the handle and a **commitment** to its public key (keyed
   BLAKE2b), not the key itself. D1 keeps the code, link token and handle only as SHA-256,
   with no account or space. The link is `https://<origin>/join/<token>`: it only names the
   invite and carries no key material, so it's no more secret than the code.
2. The inviter keeps the invite's secret key, the handle, the code, the link token and what
   is shared (the library, or one album's id) in an owner-only record of its open space
   (`pending_invites`, `sealPendingInvite`: the secret key followed by those details, sealed
   with the owner-only subkey, kind `invite`, bound to the record's id). Like every other
   per-space row it is keyed by the space tag, so an invite made from the private space is
   kept in the private space and says nothing about whether one exists.
3. The joiner opens the link (or types the code), reads the commitment, makes its own key
   pair, keeps it as an owner-only `invite` record in its open space, and only then sends
   its public key. Only the first key is accepted, so an invite works once.
4. On the inviter's next visit, its device sees the joiner's key, **pins** it by replacing
   its sealed record with one that also holds that key, and only then reveals its public
   key together with its name sealed to the joiner's key (`crypto_box`, `intro`). Every
   later step, on any of the inviter's devices, uses the pinned key and refuses any other.
5. On the joiner's next visit, it checks the revealed key against the commitment, opens the
   inviter's name, and sends its own name sealed to the inviter's key (`hello`). It shows
   the **safety phrase** (4 BIP-39 words, 44 bits, derived from both public keys; see below)
   and "Waiting for <name> to confirm".
6. On the inviter's next visit, every screen of that space shows "<name> wants to join …
   Check these 4 words with them", with Confirm and Cancel. Only when the inviter confirms
   the words match does it register the member and send the access (`grant`: share token,
   records key or album key, its own name, the member id) sealed to the joiner's key, and
   then delete its record.
7. On the joiner's next visit, it opens the grant, keeps it as an owner-only `joined` record
   (taking the pending record's id, so two devices finishing at once keep one copy), and
   deletes the invite and its record.

**Why waiting doesn't weaken the safety phrase.** A server in the middle wins only if both
people see the same words while each holds a key the server chose. It has to fix the fake
inviter key it shows the joiner (through the commitment it shows) before it learns the
joiner's real key, and the fake joiner key it shows the inviter before it learns the
inviter's real key, because the inviter pins the joiner's key before revealing its own and
never uses another afterwards. So each side's words are a hash of one key the server had to
commit to blind and one it couldn't predict: one guess at 2^-44 per invite. How long the
steps take doesn't change that: time only helps a server that can choose a key after
seeing the other side's, and the commitment (for the joiner) and the pin (for the inviter)
rule that out. The key pairs never change during an invite (each record is sealed with an
AEAD bound to its id, so the server can't substitute another invite's), and the joiner's
side needs nothing pinned: its words depend only on its own key and a key checked against a
commitment it read before sending that key.

**Why the words are slow to compute.** The words are the first 44 bits of Argon2id
(`crypto_pwhash`, Argon2id13, 64 MiB and 3 passes, the same cost as a login) over the
transcript: `T = BLAKE2b-256(inviter key ‖ joiner key)` keyed with the label
`arcafold:safety-phrase:v2`. The input is `T` in base64url and the 16-byte salt is
`BLAKE2b-128(T)` keyed with `arcafold:safety-phrase-salt:v2`, so the salt is fixed and
domain-separated but needs nothing beyond the two keys. Each side computes it once per
invite (a fraction of a second, in the same Web Worker that hashes passwords, falling back
to the page's thread), and the result is kept in memory so checking again is free
(`packages/crypto/src/sharing.ts`).

This matters for one attack the pin can't stop on its own. The pin lives in the inviter's
sealed record, on the server. A compromised server that kept an old copy of that record (from
before the pin) and showed it again, while claiming the inviter's key was never revealed,
could get a device to reveal a second time, to a joiner key chosen _after_ learning the
inviter's key from the first reveal. A browser that keeps nothing on the device can't tell an
old copy from the current one. What the server would then need is a joiner key whose words
match the joiner's: about 2^44 tries. With a plain hash that is cheap enough to do within
the 7 days. With the words behind Argon2id it is about 2^44 runs at 64 MiB each: at roughly
0.2 s per run that is around 10^5 CPU-years, and memory-hard, so far beyond an invite's
lifetime. So even with a rollback, the server's chance of matching words stays at a guess,
about 2^-44 per reveal it gets.

Every sealed message starts with a purpose label (`hello`, `intro` or `grant`), so one
can't be replayed as another. Each side's steps need its own secret: the code or link token
for the joiner, the handle for the inviter, and the server only accepts steps in order.
Unknown codes (and link tokens, though 128 bits can't be guessed) count against the account
like wrong passwords (10 per 15 minutes, counted before the lookup and given back for a
real one, so parallel guesses don't get more). Invites expire after **7 days**; expired rows
are deleted whenever an invite is made, and a device that finds its invite gone (expired,
cancelled, or finished elsewhere) deletes its own record. The inviter can cancel from the
Share screen, the album's people list or the confirmation; the joiner can give up with
"Don't join".

**What the server learns.** As before, the hashes of the code, link token and handle, the
public keys and sealed messages, and nothing linking an invite to an account or space at
rest. New: each space's `pending_invites` rows, so how many invites a space has in progress
and when rows come and go (no timestamps are stored), and that an invite took days rather
than minutes. A live server can still link the sessions on both sides, as it could before.

### Trade-offs we accepted

### Trade-offs we accepted

- **Stopping sharing is enforced by the server, not by new keys.** A removed member still
  knows the records key (or album key) and the per-photo keys of photos it saw, and could
  decrypt any ciphertext it got hold of later. The server refuses its token from the moment it's
  removed, but a compromised server could still hand it new ciphertext. Rotating the space
  key on removal would close that and is left for later.
- **A member can delete photos for everyone**, like the owner. Sharing is for people you
  trust.
- **The safety phrase is only as good as the comparison.** If nobody checks the words, a
  compromised server could put itself in the middle of that invite.
- **A rollback can still get a second reveal.** A server that replays the inviter's record
  from before the pin can get its key revealed again, to a joiner key it chooses. Matching
  words would then cost about 2^44 Argon2id evaluations (see above), which is out of reach,
  so this needs an actively malicious server and still comes down to a guess.
- **The inviter's name goes to whoever accepts first.** It is sealed to the key that
  accepted, before the words are checked, so someone else holding the link (or a server in
  the middle) learns the inviter's display name, which the server stores in plain text
  anyway. Album titles are never sent before the words match. Likewise the joiner's name
  goes to the inviter's revealed key, as before.
- **A grant that's never picked up leaves a member.** The inviter registers the member when
  confirming. If the joiner never comes back before the invite expires, that member can't
  be used by anyone, and stays listed until the inviter removes it.
- **A live server sees who joins what.** Like storage, a compromised server watching
  requests can link the sessions on either side of an invite, and a member's session to
  the share token it uses. Nothing at rest records it, and `pending_invites` rows are keyed
  by space like everything else.

## People (face grouping)

Face grouping finds faces and groups photos of the same person entirely on the device. The
server stores only what it stores for photos: ciphertext it can't read.

- **On only after a yes.** After sign-up, and once for accounts made earlier, the smart
  features question asks for consent with two equal choices ("Turn on" / "Not now"),
  nothing pre-selected and not tied to creating the account. The answer, the version of the
  question and the day it was given are kept on the account (`PUT
/api/account/smart-features`, columns `smart_choice`, `smart_version`, `smart_at`) as a
  record of consent. It's the same whichever space is open, so it says nothing about a
  private space. A device that never chose follows the account; turning it on or off on a
  device is saved in that browser's `localStorage` (`arcafold.faceGrouping`) and wins there.
  Either way it applies to whichever space is open.
- **On the device.** The models are YuNet (face detection, MIT) and SFace (face
  fingerprints, Apache 2.0), run by ONNX Runtime Web (WebAssembly) in a Web Worker
  (`apps/web/src/lib/people`). They are served from Arcafold's own origin, and each file is
  checked against a pinned SHA-256 before it is loaded, so a changed model is refused. The
  worker reads the 640px preview the grid already downloads and decrypts; nothing is kept
  after a photo is looked at: no pixels, no object URLs, nothing in storage or caches.
- **Face data.** For each photo the scan keeps each face's box, score and a 128-number
  fingerprint (quantised to bytes). Results are saved in **segments** of many photos,
  sealed with `crypto_aead_xchacha20poly1305_ietf` under `crypto_kdf` subkey 3 of the space
  key (context `arcspace`), with the kind and segment id as associated data, and padded to
  16 KiB blocks so the size says little about how many faces were found
  (`sealFaceSegment` in `packages/crypto/src/storage.ts`). A segment is at most 256 KiB
  and can't be replaced, only deleted; segments are merged as they go stale.
- **People.** A name, the faces confirmed as that person, faces marked "not this person"
  whether they're hidden, whether they're "me" and their labels (Friends, Family, Work)
  are an owner record of kind `person`, sealed like other records. Like everything else
  in a space, "me" and labels belong to that space only. Unnamed groups are worked out on the device each time and never stored.
- **Owner only.** Face data and people belong to the space's owner: the routes
  (`/api/space/faces`, `/people`, `/face-data`) refuse share tokens, so members of a shared
  library never see them. Each member who turns face grouping on analyses on their own
  device, into their own space. Segments count against the storage quota.
- **Deleting.** Settings → People → "Delete face data" removes every segment and person
  for the open space (`DELETE /api/space/face-data`), and wiping a space removes them too.
- **Trade-off.** A face fingerprint is biometric data. It never leaves the device
  unencrypted and only the space key opens it, but anyone who has that key (the password)
  can read it, the same as the photos themselves.

## Smart search

Smart search works out what each photo shows on the device, as a vector of 512 numbers,
so photos can later be found by describing them. The server stores only ciphertext.

- **On by default, per device.** It uses no face data, so it doesn't wait for the smart
  features question: it's on unless turned off in Settings → Search on that device, saved
  in that browser's `localStorage` (`arcafold.smartSearch`). It applies to whichever space
  is open, so the setting and the download look the same with or without a private space.
- **On the device.** The photo half of OpenCLIP ViT-B/32 (LAION-2B weights, MIT), stored
  with 8-bit weights, runs in ONNX Runtime Web (WebAssembly) in a Web Worker
  (`apps/web/src/lib/search`). It's served in chunks from Arcafold's own origin and checked
  against a pinned SHA-256 before it's loaded. Nothing is downloaded until there's a photo
  to look at. Like face grouping, the worker reads the decrypted 640px preview and keeps
  nothing after looking at it.
- **Phones.** A phone looks only at the photos it uploads, and downloads the resource only
  on Wi-Fi, when the browser already has it cached, or after the person taps "Download
  now". Browsers that don't say how they're connected (Safari, Firefox) count as not on
  Wi-Fi.
- **Search data.** Vectors are quantised to bytes and saved in segments, sealed like face
  segments but under `crypto_kdf` subkey 4 of the space key, with kind `search` and the
  segment id as associated data, padded to 16 KiB blocks (`sealSearchSegment` in
  `packages/crypto/src/storage.ts`). Segments are at most 256 KiB and count against the
  storage quota. The vectors held in memory are zeroed when the vault locks.
- **Taught words.** A word taught to search is an owner-only record of kind `word` (sealed
  like a person): its name, the ids of the 3 to 5 photos it was taught with, and their
  average vector, quantised to bytes, so the word keeps working after its photos are
  deleted. The server sees only that the space has some number of them (at most 200).
- **Smart albums.** A saved search is an owner-only record of kind `smart-album`: its
  title, the typed text, the chips tapped off, the "More like this" photo id, when it was
  saved and the words' vector (quantised). Its photos are never listed in it; they're
  found again on the device each time. Members never see smart albums, and they can't be
  shared. The server sees only how many a space has (at most 100).
- **Owner only.** The routes (`/api/space/search`, `/words`, `/smart-albums`,
  `/search-data`) refuse share tokens.
  Each member works out vectors on their own device, into their own space.
- **Deleting.** Settings → Search → "Delete search data" removes every segment, taught
  word and smart album for the open space (`DELETE /api/space/search-data`), and wiping a space removes
  them too. Each word can also be forgotten on its own.
- **Searching.** Queries are read and turned into vectors on the device: the text half
  (and its word list, `merges.txt`) is served and pinned like the photo half, downloaded on
  the first search with words, and runs in its own worker. A query is never sent anywhere,
  never put in the URL (so it can't land in browser history; the viewer's link only says
  `from=search`) and never saved; it lives in memory until lock. "More like this" works
  the same way: the photo it started from is held in memory, not in the URL. The search box asks the
  browser not to autocomplete. A search only ever sees the open space's photos, people and
  vectors.
- **Trade-off.** A vector says roughly what a photo shows (a beach, a dog, two people). It
  never leaves the device unencrypted, but anyone with the space key can read it, the same
  as the photos.

## Sessions and the API

- Passwords never reach the API. It sees the keyring (salt, KDF settings, sealed slots,
  verifiers), the email and display name, login keys, space tokens, and ciphertext.
- A login (or sign-up) sets a 256-bit random session token in an `HttpOnly`,
  `SameSite=Strict` cookie (`__Host-` prefixed and `Secure` over HTTPS), valid 30 days.
  D1 stores only its SHA-256, and expired sessions are deleted when a new one starts.
- Each session also keeps a random public id, a coarse device label made from the
  User-Agent at login ("Chrome on Android", no versions or models; the User-Agent itself
  isn't stored), and when it was last used, to the hour. Settings lists them and can sign
  any other device out, which deletes its session. Only account routes mark a session
  used, never storage routes, so the time says nothing about when a space was opened, and
  a login with the private password starts the same kind of session as any other. A
  signed-out device drops its keys on its next request, or as soon as it's looked at
  again; until then a decrypted photo already on its screen stays there.
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
- Nothing secret is written to `localStorage`, IndexedDB or caches. `localStorage` holds
  only this device's settings: the auto-lock time, whether face grouping and Smart search
  were turned on or off here, how photos and files are laid out (`arcafold.photoView`,
  `arcafold.fileView`), and whether document photos are hidden from the timeline
  (`arcafold.documentPhotos`). Which photos look like documents is worked out in memory
  each unlock and never stored.
- Only raster photo formats are stored or shown as photos (JPEG, PNG, GIF, WebP, HEIC, AVIF;
  `apps/web/src/lib/photo-types.ts`). An SVG is a document that can carry script, so it is
  never a photo: it is kept as a file, and a photo record naming it is left out.
- A file is never turned into an object URL or shown as a page (an HTML or SVG file opened
  from a same-origin object URL could run script in the app). The store refuses a file's
  original as an image, and hands out its preview only when the record says it was drawn
  and the decrypted bytes start like a JPEG, so a tampered or hand-made record can't get
  anything else into an `<img>`.
- The file viewer (`/files/:id`) decrypts a file into memory only and lets it go when it
  closes. PDFs are drawn by Mozilla's pdf.js (`pdfjs-dist`, Apache-2.0), loaded only when a
  PDF is opened or previewed. It reads the bytes in its own Web Worker, never runs a PDF's
  scripts (its scripting sandbox isn't loaded), doesn't draw XFA forms, and has no `eval`
  path; its fonts, character maps and decoders are served from Arcafold's own origin under
  `/pdfjs/`, so the content security policy stays `'self'` and nothing is fetched from a
  third party. Text files and HTML show as plain text in a `<pre>`; a Word (.docx) document
  shows its paragraphs as plain text, read from `word/document.xml` with the app's own zip
  reader. Nothing a file contains is ever rendered as markup. Any other kind of file can
  only be downloaded, saved under its own name.
- **Sorting files** happens on the device that adds them, before they're encrypted, and
  only while Smart search is on there (`apps/web/src/lib/file-sort`). It reads the file's
  text (a PDF's first 20 pages, or 5 on a light device, through pdf.js; a Word document's
  paragraphs; a text file), scores it against a fixed list of words per category, and
  checks it against the files you sorted yourself. What's kept is the category and at most
  16 words from the name and text, in the file's sealed record; the text itself is let go.
  Moving a file to another category re-seals its record with `sorted: "you"`, and those
  files' words are what later files are compared with, so learning needs nothing else
  stored. A copy of a file listed in a shared album leaves out its words. Nothing about
  sorting reaches the server or any outside service.
- Previews adapt to the device (`apps/web/src/lib/file-preview.ts`). A phone with 4 GB of
  memory or less or 4 cores or fewer, data saver, or a preview that already ran out of time
  on this device makes the device "light": it draws a 240 px preview within 3 seconds
  (otherwise 480 px within 8 seconds) and reads PDFs a page at a time at a lower resolution.
  A preview that runs late is dropped and the file shows its icon. Every other device only
  ever shows the small preview stored with the file. A preview can't be added later from a
  faster device, since a committed photo's files can't be overwritten.

## On the phone

- Keys and every decrypted photo live in memory only. The session cookie is kept across
  launches, encrypted by `expo-secure-store` with a key in Android's keystore, so a closed
  app opens locked; it reaches the account's encrypted keyring and nothing more, so the
  password (or a fingerprint) is still needed every time. It's the same whichever space was
  open, and signing out or being signed out elsewhere removes it. Decrypted images go to native memory (`modules/memory-image`), never to
  disk, and the window is `FLAG_SECURE`. See [mobile.md](mobile.md).
- **Fingerprint and face unlock** keeps one more thing on disk: the main password's secret (the
  Argon2id-derived wrap key and login key, never the password) in Android's keystore through
  `expo-secure-store`, under an AES-GCM key that needs a strong biometric check for every use
  and is destroyed by Android when fingerprints or faces are added. It opens only the main
  slot and signs in only as the main password would, so the private space always needs its
  password and nothing stored differs with or without one.
- **Trade-off.** Anyone who can pass the phone's biometric check can open the main library,
  without the password, until it's turned off. Signing out, forgetting the account, being
  signed out from another device and a password change all turn it off (the last because the
  old secret stops matching). The app's data isn't backed up (`allowBackup: false`), and the
  keystore key can't leave the phone.

## Still to design

- Rotating a space's key when someone stops sharing it (see the sharing trade-offs).
- Metadata minimisation in D1 (the display name is stored in plain text today, like the
  email).
