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

The recovery key is 128 random bits written as 12 BIP-39 words (with BIP-39's 4-bit
checksum). It is already uniformly random, so its `master` is a keyed BLAKE2b
(`crypto_generichash` keyed by the salt) instead of Argon2id.

### Why nobody can tell whether a private space exists

- At sign-up slot 2 and verifier 2 are **random bytes** of exactly the same size as real
  ones. A secretbox ciphertext under an unknown key is indistinguishable from random, so
  the stored keyring looks the same with or without a private space.
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
  (`Session.privateSpace`) until Twofold locks, so later moves don't ask. Setting up a
  private space keeps its fresh key the same way. Nothing about this reaches the server.
  Skipping the prompt entirely would mean the main library holding something that opens or
  addresses the private space at rest, which is exactly what deniability rules out.
- Setting up a private space from the main library writes a new slot 2, replacing any
  private space that was there (the main library cannot know). The dialog says so to
  everyone, always.

### Trade-offs we accepted

- **The private space has no recovery.** If the recovery key could open it, anyone holding
  the recovery key would learn it exists. Forget the private password and that space is
  gone; the recovery key restores the main library and leaves slot 2 untouched.
- **A compromised, live server could notice a second login key** when someone logs in with
  the private password on a new device (the stored data still reveals nothing). A
  compromised server could equally serve altered JavaScript, which is the limit of any
  web-delivered end-to-end encryption, so this adds no new exposure.
- **Sign-up reveals whether an email is registered** (and `POST /api/auth/prelogin`
  answers 404 for unknown emails). Hiding it needs email verification, which doesn't exist
  yet.
- The two passwords must differ; the client refuses a new password that already opens
  another slot.

## Sessions and the API

- Passwords never reach the API. It sees the keyring (salt, KDF settings, sealed slots,
  verifiers), the email and display name, and login keys.
- A login (or sign-up) sets a 256-bit random session token in an `HttpOnly`,
  `SameSite=Strict` cookie (`__Host-` prefixed and `Secure` over HTTPS), valid 30 days.
  D1 stores only its SHA-256.
- Every write must be `Content-Type: application/json`, which a cross-site form can't send
  without a CORS preflight the API never answers. This backs up `SameSite=Strict`.
- Changing the keyring or deleting the account needs a fresh login key as well as the
  cookie. Keyring updates carry a version number, so two devices can't silently overwrite
  each other, and may not change the salt or KDF settings.
- Failed logins (and failed proofs) are limited to 10 per email per 15 minutes, counted for
  unknown emails too.
- Input is validated with zod at the API boundary (`apps/api/src/schemas.ts`), including
  exact key sizes and KDF bounds.

## In the browser

- Keys live only in React state (`apps/web/src/app/account.tsx`). Locking, signing out or
  reloading drops them and remounts the vault, which drops every decrypted photo.
- Nothing is written to `localStorage`, IndexedDB or caches.

## Still to design

- Photo storage: per-photo keys under each space key, and how R2 objects are grouped by
  space without the database linking a private space to its account.
- Sharing a space with another account.
- Metadata minimisation in D1 (the display name is stored in plain text today, like the
  email).
