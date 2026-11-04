# Mobile apps

Plan and recommendation: [Arcafold mobile apps](https://claude.ai/artifact/MekYTEW8Us1rq2HHBhi3k4).
The apps will be React Native (Expo with prebuild), sharing `packages/crypto` and the other
TypeScript logic with the web app, with the slow or sensitive work in native code.

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
- Uploads and removals go through the shared library store
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
