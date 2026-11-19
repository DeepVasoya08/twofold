# Mobile apps

Plan and recommendation: [Arcafold mobile apps](https://claude.ai/artifact/MekYTEW8Us1rq2HHBhi3k4).
The apps will be React Native (Expo with prebuild), sharing `packages/crypto` and the other
TypeScript logic with the web app, with the slow or sensitive work in native code.

## The app (`apps/mobile`)

Phase 2 builds the real app here, in small steps, tested as an Android APK until the store
accounts exist. It uses the shared code in `packages/core` for everything that isn't a screen
or a native module.

- `src/platform.ts` sets up the core for the phone before anything else runs: the API client
  talks only to `https://arcafold.com` over `expo/fetch` and keeps the session cookie in
  memory (`src/config.ts`). Crypto uses the core's default loader, which on a phone is
  libsodium's native C library.
- Android backup of app data is off (`allowBackup: false`), so nothing in the app's storage is
  copied to Google's cloud backup.
- Over-the-air updates are off (`updates.enabled: false`): every change ships as a new build.
- Icons are drawn from the web app's mark by `scripts/make_icons.py`.
- Signing in (`src/session/`): sign-in, sign-up with the recovery key, and the unlock screen
  use the shared account code, so the same single password field opens either space. Keys
  live in memory only. The session cookie is kept across launches (`session/kept-session.ts`,
  `expo-secure-store`, encrypted with a keystore key), so a closed app opens at the lock
  screen, after checking the session is still good; signed out from another device meanwhile,
  it opens at sign-in. Signing out forgets it. The last email that signed in is kept in the
  app's private storage to fill in the sign-in screen. Signing out always goes back to the
  sign-in screen (`src/routes.ts`), even straight after signing up.
- Locking: the app locks after a minute without a touch by default (1, 5, 15 or 30 minutes
  in Settings, saved in a plain file on this phone, `session/auto-lock.ts`), on screen
  or in the background, where time away counts; Android may pause the timer in the
  background, so coming back checks it too. Android's photo picker gets
  up to three minutes instead (`onSystemScreen` in `session/account.tsx`); away longer than
  that, it locks the moment it's back.
- Sign-in, sign-up and unlock have the mark's glow and the logo at the top and their form
  on a card. Password fields have an eye button to show what's typed. A form's problem
  shows in a red banner by the button, and sign-up takes you back to the first field that
  needs fixing.
- The recovery key: "Download key", or ticking "I've saved my recovery key", saves it as
  `arcafold-recovery-key.txt` (the same text as the web app's download, from
  `@arcafold/core/recovery-file`). `modules/save-file` opens Android's own "Save to" screen
  (`ACTION_CREATE_DOCUMENT`), so the person picks where it goes, and writes the text straight
  from memory; the app needs no storage permission and keeps no copy.
- The keyboard: the app draws edge to edge, so Android no longer resizes the window for the
  keyboard. Every screen (`ui/kit.tsx` `Screen`) shrinks itself to the space above the keyboard
  and scrolls, and the return key moves to the next field.
- The timeline (`screens/Timeline.tsx`): the open space's photos by month, newest first,
  four across, in a FlashList with one list row per grid row. It loads like the web app:
  the shared library store (`sessionStore`) lists the photos, and previews are fetched in
  batches as tiles come near the screen, the ones on screen first (the shared
  `@arcafold/core/library/thumb-loader`). Files, album-only shares and Recently deleted stay
  out, as on the web.
- Decrypted previews never touch the disk and never become base64 text: the store hands
  each one to `modules/memory-image`, which keeps the JPEG bytes in native memory and
  decodes them off the main thread into a size-limited picture cache, shown by its own
  native view. Closing the library (lock or sign-out) wipes them all. (The Phase 0 grid was
  slow on the Pixel 9a because every tile went through base64 and a data URI on the
  JavaScript thread; decrypting itself is a single libsodium call per preview.)
- The viewer (`screens/Viewer.tsx`): tapping a photo opens it full screen over the
  timeline (in the same window, so screenshot blocking still applies), swiping left and
  right in timeline order. The preview shows at once; the original downloads once the photo
  has been in view for a moment, is decoded no larger than the screen and turned upright
  (Android's `ImageDecoder`, which also reads HEIC, from Android 9), and is freed when the
  next one opens. Tapping hides the bar; Back closes it. Pinch, double-tap and pan zoom up to
  5x (`zoomable` on `MemoryImageView`, native gestures). Zoomed in, the original is decoded
  again at up to 4096 px so it stays sharp, the swap from preview to original keeps the zoom,
  and one finger pans the photo instead of swiping to the next.
- The private space works as on the web. The same password field opens either space, and
  the private space shows in the web app's violet tones. In the viewer, "Move to private
  space" (or "Move to library") asks for the other space's password the first time after
  unlocking (`screens/MoveSheet.tsx`, drawn in the app's own window so screenshot blocking
  covers it). The keys then stay in memory until the app locks. From the library, a wrong
  password gets the same answer as having no private space at all. A moved photo is
  re-encrypted in the other space under a new key and id, and arrives in no album. Photos
  shared with you can't be moved.
- Moving photos from the phone's gallery into the private space: photos added with `+ Add`
  in the private space are remembered (their gallery addresses only, in memory, by
  `library/originals.ts`) once each is stored, never before, so a photo that failed is never
  offered. When the last is in, the upload card offers "Delete from gallery" or "Keep them
  there". Deleting asks Android (`PhotoPicker.deleteAsync`, `MediaStore.createDeleteRequest`,
  Android 11 and later), which shows the photos and asks first, then deletes them outright
  (not to a recycle bin). The photo picker's local items carry the gallery's own id; a photo
  only in a cloud service can't be deleted from here and is counted as kept. Locking forgets
  the list. The main library never offers this, since it backs up rather than moves; a photo
  automatic backup already copied into the main library stays there.
- Adding photos (`+ Add` on the timeline): Android's own photo picker (`ACTION_PICK_IMAGES`
  from Android 13, the document picker before that), so the app needs no storage permission
  and sees only the photos picked, up to 100 at a time. `PhotoPicker` in
  `modules/memory-image` reads each photo's bytes and makes its 640 px JPEG preview, upright,
  in memory (no copy or preview is written to disk). The shared uploader
  (`@arcafold/core/upload/uploader`) then encrypts and uploads them a few at a time, exactly
  as the web app does, and the timeline shows them all together once the last is in. The date
  taken comes from the photo's EXIF (`@arcafold/core/photo-date`, moved from the web app).
  Uploads keep going with the app in the background or the screen off:
  `modules/upload-service` runs an Android foreground service (data sync) with a progress
  notification and a partial wake lock while any photo is on its way
  (`library/background-uploads.ts`). When the last one is in and Arcafold isn't on screen, a
  notification says how many were added (it asks for the notification permission after the
  first pick, from Android 13). Notifications give counts only, never names, and read the
  same whichever space the photos went to. If the app locks mid-upload, the photos already
  added still finish with the keys they started with, which are then dropped; they show at
  the next unlock. Only photos for now, no videos or other files.
- Fingerprint and face unlock (`session/biometric.ts`, `expo-secure-store`), for the main
  library only. After the main password opens the library, the app offers it once ("Not now"
  isn't asked again). Turning it on keeps the main password's secret (what Argon2id makes of
  it: the wrap key and login key, never the password) in Android's keystore under an AES key
  that opens only after a strong (class 3) biometric check and that Android destroys when
  fingerprints or faces are added. The lock screen then asks for a fingerprint as it shows,
  and the sign-in screen (after the app was closed) has "Sign in with fingerprint or face".
  The secret opens only the main slot (`unlockWithSecret` / `logInWithSecret` in
  `@arcafold/core/account`), so the private space always needs its password, and nothing kept
  says whether there is one. Signing out, forgetting the account, being signed out from
  another device, a changed password or changed fingerprints all turn it off.
- Settings (`screens/Settings.tsx`, the round initial at the top right): the account's name
  and email; fingerprint unlock on or off (shown only in the main library; turning it on
  asks for the main password, so the private space's password is never kept); the auto-lock
  time; this account's devices, with "Sign out" for any other one (`/api/account/devices`,
  like the web app's Settings); and Lock now, Sign out, and Sign out and forget this account.
- Automatic backup, step one (`src/backup`, Settings > Backup, main library only). Turning
  it on asks to see all the phone's photos (READ_MEDIA_IMAGES; "Select photos" isn't
  enough), sets up this phone's upload-only token (see "Upload-only keys" in
  [security.md](security.md)) and starts from the newest photo, so only photos added after
  that are backed up. "Back up now" lists newer photos with `PhotoLibrary`
  (`modules/memory-image`, a MediaStore query, no new dependency), reads each in memory like
  a picked photo and adds it with `addForOwner`, using only the token and the public key.
  It remembers the last photo's MediaStore id after each one; a photo it can't read or
  store is passed over, and anything else (offline, storage full) stops the run until next
  time. What it keeps (the token, the public key and that id) is in `expo-secure-store`.
  Turning it off revokes the token; signing out forgets it (and revokes it too when the main
  library is open).
- Backup in the background (`modules/backup-job`, `src/backup/background.ts`). Android's
  JobScheduler (no extra library) runs the `ArcafoldBackup` headless JS task (registered in
  `index.ts`) soon after a photo is added and
  every six hours (a periodic job kept across restarts). Both wait for Wi-Fi (or any network
  with "Use mobile data" on) and a battery that isn't low, and get about ten minutes; what's
  left waits for the next run. Android drops a content-URI job once it runs, so there are two
  that take turns: as one starts, it sets the other (setting a running job again would stop
  it), so a photo the camera finishes during a run gets a run of its own. The photo list stops
  at a photo the camera is still writing (`IS_PENDING`), so it is never passed over. The task starts React Native without a screen if Arcafold is
  closed, restores the kept session (to reach the API, never the keys), and runs the same
  backup as "Back up now" (`backup-runner.ts`, one run at a time). It posts "Photos backed
  up" when it added any while Arcafold wasn't on screen. Being signed out (a 401) stops the
  jobs and forgets backup. The jobs are set again at each launch while backup is on.
  Each run (or a background run that gave up: no photo access, signed out) is kept as a
  time, counts and a reason in `backup-last-run.json` (`last-run.ts`; nothing about the
  photos), which Settings shows as "Last backup", and the library reloads on coming back
  when a run added photos after it loaded.
- Photos and Albums tabs (`screens/Home.tsx`): the library opens once and stays open across
  both tabs, an open album, the viewer and Settings. The tab bar and the bottom of sheets and
  the viewer sit above Android's navigation bar, using its height from `modules/system-bars`
  (the app draws edge to edge). Back leaves an album or a person, then goes from Albums or People to Photos.
- Albums (`screens/Albums.tsx`, `screens/AlbumScreen.tsx`, `screens/AlbumSheets.tsx`): album
  cards with their cover (the chosen one, else the newest photo), count and who shared them;
  "+ New" names a new album and opens it. An album shows its photos by month with "Add
  photos": from your library (`screens/ChoosePhotos.tsx`, tick photos that can go in it) or,
  for your own albums, straight from this phone, uploaded into the album. Its menu renames or
  deletes it; deleting keeps the photos and takes the album out of their records, best effort,
  as on the web. In the viewer, "Add to album" picks an album (or makes one) and, inside an
  album, "Remove from album" takes the photo out. The rules (which photos fit which album,
  what you can only view) are shared with the web app in `@arcafold/core/library/albums`.
  Albums shared with you show here and can be viewed, and the Albums tab filters All, Shared
  with me and Shared by me.
- Sharing and invites (`src/sharing/invites.tsx`, `screens/ShareScreen.tsx`,
  `screens/JoinScreen.tsx`, `screens/InviteCards.tsx`, `screens/SharingSettings.tsx`): the same
  invites as the web app, moved along by the same shared pass (`@arcafold/core/sharing-pass`)
  when the library opens, when Arcafold comes back on screen, and every few seconds while
  someone is partway through. An album's ⋯ menu has Share (who has access, remove someone,
  stop sharing, and an invite); Settings > Sharing shares the whole space (View only or Add
  and edit), lists who it's shared with (change what they can do, or stop), and the libraries
  it joined (leave). "Send invite" opens Android's share sheet with the link and the code (no
  clipboard library); the code is also selectable on screen. "Enter an invite code" takes a
  code or a pasted link (`@arcafold/core/invite-input`). When someone accepts, the four words
  and "They match, share" show over the library on any screen; the person who joined sees the
  same words while they wait. An album someone shared with you can be left from its menu.
  An album is shared View only or Add and edit, changed later on its Share screen; with Add
  and edit, the person adds photos from their phone ("Add photos" in the album) and can take
  any photo out of it from the viewer, the same as on the web (see docs/security.md,
  "Sharing one album").
- People (`src/people/use-people.ts`, `screens/People.tsx`, `screens/PersonScreen.tsx`,
  `screens/PeopleSheets.tsx`, `screens/FaceThumb.tsx`): the People tab shows the face groups
  found so far, worked out on the phone from the sealed face results and person records (the
  same ones the web app saves), with each face cut out of its photo's preview in memory. A
  person's page lists their photos; its ⋯ menu names them, marks "This is me", sets Friends,
  Family or Work, merges them with someone, or hides them. In the viewer, "Not <name>" takes
  a photo out of them. The changes are shared with the web app in `@arcafold/core/people/edits`.
  The phone doesn't find faces itself yet: faces come from Arcafold in a browser with face
  grouping on.
- Screenshots: `modules/secure-screen` marks the window `FLAG_SECURE` as Android creates it,
  so screenshots and recordings come out black and the app switcher shows a blank card. The
  recovery key is never put on the clipboard.

Build it the same way as the spike (below), from `apps/mobile`.

## Phase 0 spike (`apps/mobile-spike`)

A throwaway app that checks the risky parts on real phones before the real app is built.
It is not a product. Only test 8 touches an account, a throwaway one, and keeps its session
cookie in memory.

| Test                             | What it shows                                                                                                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Open web-made data            | The native libsodium build opens a keyring, an encrypted file, sealed records, a sealed backup and an invite message made by the web build (`fixtures/crypto/web.json`), and refuses tampered data and wrong keys.                                                                                       |
| 2. Make data for the web to open | The phone makes the same kind of fixture and shares it as a file. Saved as `fixtures/crypto/phone-*.json`, it is opened by the web build in `pnpm test`.                                                                                                                                                 |
| 3. Argon2id timing               | Unlock cost at the real settings (64 MiB, 3 passes) on the phone.                                                                                                                                                                                                                                        |
| 4–5. Models vs web               | SFace and CLIP's photo half on ONNX Runtime mobile (CPU, XNNPACK, NNAPI) give the same vectors as ONNX Runtime Web for the same inputs (`fixtures/ml`), and how long each run takes.                                                                                                                     |
| 6. Grid                          | 5,000 encrypted tiles in a FlashList, each decrypted as it appears and shown from memory.                                                                                                                                                                                                                |
| 7. Photos on disk                | Scans the app's cache and documents folders for any file that starts like a JPEG or PNG. It should find none.                                                                                                                                                                                            |
| 8. Background backup             | Signs in to a throwaway account on arcafold.com and uploads the newest 200 gallery photos exactly as the web app stores them (three at a time), inside an Android foreground service with a partial wake lock. It records which photos finished while the app was off screen, and can remove them again. |

Not covered yet: iOS, and on-device image decoding for the models (the model tests feed
fixed tensors on purpose).

### Background backup (test 8)

- `modules/backup-service` is a small local Expo module: an Android foreground service of
  type `dataSync` with a progress notification (counts only, never photo names) and a
  partial wake lock, so the JavaScript upload loop keeps running with the app in the
  background or the screen off. Android 15 and later limit `dataSync` services to six hours
  a day; the service stops when told its time is up.
- The upload loop uses promises only. React Native pauses JavaScript timers while the app
  is in the background, so a `setTimeout` in that path would stall the backup.
- Requests go through the shared API client (`@arcafold/core/api`), configured in
  `src/api-setup.ts` to use `expo/fetch`, which sends encrypted bytes as they are (React
  Native's own `fetch` would turn them into base64 first). The client keeps the session
  cookie in memory, not in the system cookie store.
- Sign-in goes through the shared account code (`@arcafold/core/account`), the backup
  through the web app's upload queue (`@arcafold/core/upload/uploader`), and uploads and
  removals through the shared library store
  (`@arcafold/core/library/space-store`), the same code the web app uses, so photos are
  encrypted and stored exactly as on the web. `src/api-setup.ts` tells the store not to
  make images, since the spike never shows what it uploads.
- Known gap: expo-image-manipulator writes each thumbnail to the app's cache before we read
  and delete it. That's a plaintext copy of a gallery photo on disk for a moment, which the
  real app must avoid (a native in-memory resize), above all for photos headed to the
  private space.
- The app asks for media location access, so originals keep their GPS data, as the web
  app's uploads do.

### How the crypto runs on phones

Hermes, React Native's JavaScript engine, has no WebAssembly, so the web build of libsodium
can't run there. `packages/crypto/src/sodium.native.ts` adapts react-native-libsodium (the
same C library, called through JSI) to the `Sodium` interface. react-native-libsodium 1.7.0
doesn't bind secretstream, `crypto_scalarmult_base`, `crypto_hash_sha256`, `sodium_pad`,
`sodium_unpad` or `sodium_memcmp`, and its XChaCha20-Poly1305 binding only takes the
associated data as a string (Arcafold binds records to binary associated data), so `patches/react-native-libsodium@1.7.0.patch` adds them
as direct calls into libsodium (no cryptography is implemented there). SHA-256 for login
verifiers goes through libsodium on phones (`digest.native.ts`) because Hermes has no Web
Crypto either.

`patches/onnxruntime-react-native@1.24.3.patch` makes the package's Android module start in
React Native's bridgeless mode (it called the removed `getCatalystInstance()`, so the app
closed at launch), removes its `unimodule.json` (with it, Expo's autolinking treated the package as an Expo
module and never registered its React Native package), fixes its Android build for Gradle 9, pins ONNX Runtime 1.24.3 instead of `latest.integration`, and stops it shipping
mockito and junit inside the app.

### Building the Android test app

Needs the Android SDK (Gradle downloads the NDK and build tools it wants) and JDK 17+.

```sh
cd apps/mobile-spike
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# app/build/outputs/apk/release/app-release.apk, signed with the debug key: test phones only
```

Regenerate the fixtures with `pnpm --filter @arcafold/mobile-spike exec vitest run --config
vitest.fixture.config.mts` (crypto), `python3 apps/mobile-spike/scripts/make_ml_inputs.py`
and `node apps/mobile-spike/scripts/make-ml-reference.mjs` (models).
