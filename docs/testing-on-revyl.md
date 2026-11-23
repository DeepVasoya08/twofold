# Testing the phone app on Revyl emulators

[Revyl](https://revyl.com) runs Android emulators and iOS simulators in the cloud, driven
from a command line tool. It lets a cloud session (or anyone without a test phone) install
an Arcafold build, tap through it and take screenshots. First run: 2026-11-23, APK 33.

## What you need

- `REVYL_API_KEY` set in the environment (the cloud environment's settings). Never print it.
- The CLI: `pip install --user revyl` and `export PATH=$HOME/.local/bin:$PATH`.
  `revyl auth status` should say `Authenticated` with `Auth Method: env`.
- An APK that includes **x86_64** code. Revyl's emulators are x86_64 machines (Pixel 7 and
  Pixel Tablet, Android 14). React Native loads its libraries only for the emulator's own
  chip type, so an `arm64-v8a`-only APK installs but closes at launch ("Arcafold keeps
  stopping", `couldn't find DSO to load: libreactnative.so` in the logs). Build with
  `-PreactNativeArchitectures=arm64-v8a,x86_64` (see [mobile.md](mobile.md)); the same APK
  still works on phones.
- For screenshots, a test build with `FLAG_SECURE` taken out of
  `apps/mobile/modules/secure-screen` (local change only, never committed). With it, every
  screenshot of the app is black.

Check an APK before uploading: every `.so` under `lib/arm64-v8a/` should also be under
`lib/x86_64/` (`unzip -l app.apk 'lib/*'`).

## Steps

```sh
# Once: the Revyl app already exists (look it up with `revyl app list`).
#   "Arcafold Android", id 1f7506e1-425c-4491-8d95-7f9afb5d06f6

# Upload a build; note the build_id it prints.
revyl build upload --file app-release.apk --app <app id> --version app-33 --yes --json

# Start an emulator with that build (prints session_id; idle timeout in seconds).
revyl device start --platform android --build-version-id <build id> --timeout 1800 --no-open --json
revyl device launch

# Look, act, look again. Coordinates are screen pixels (1080 x 2400).
revyl device screenshot --session-id <session> --out screen.png
revyl device tap --session-id <session> --x 540 --y 1938
revyl device type --session-id <session> --x 540 --y 1512 --text "someone@example.com"
revyl device type --session-id <session> --x 540 --y 1746 --text-env TEST_PASSWORD  # value stays out of logs
revyl device swipe --session-id <session> --direction up --x 540 --y 1500
revyl device back --session-id <session>
revyl device wait --session-id <session> --duration-ms 3000

# Put photos on the emulator for the photo picker (they land in Downloads).
revyl device download-file --session-id <session> --url https://picsum.photos/id/1015/1200/900.jpg --filename sample.jpg

# Crash or odd behaviour: read the device log.
revyl device logs --session-id <session> --no-follow

# Always stop it when done.
revyl device stop --session-id <session>
```

Notes:

- Pass `--session-id` on every command. `revyl device list` can show sessions that someone
  else started in the same Revyl organization (the dashboard, another thread); stop only
  your own. The free plan runs 2 devices at once and queues the rest.
- A start that queued once left extra "starting" sessions behind. Check `revyl device list`
  after starting and stop any leftovers of yours by ID.
- Use a throwaway account on https://arcafold.com, never a real one. Sign-up works on the
  emulator; ticking "I've saved my recovery key" opens Android's save screen, and saving
  to the emulator's Downloads is fine for a test account.
- `revyl device tap --target "Sign in button"` (described targets) also exists, but
  coordinates read from the last screenshot are faster and predictable.

## iOS

Revyl runs iOS simulators (iPhone 15 to 18, iPad Pro), but it needs a **simulator** build:
a `.app` (or zipped `.app`) built with `xcodebuild -sdk iphonesimulator`, with arm64
simulator code. An `.ipa` for real iPhones won't install. A simulator build doesn't need the
Apple Developer account. It has to be built on a Mac: Revyl's cloud build runners or Macs,
or a GitHub macOS runner. There is no iOS project in `apps/mobile` yet.
