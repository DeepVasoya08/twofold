# Web UI

Accounts are real: sign-up, log in, unlock, recovery and both passwords call the API and
`packages/crypto` (design in [security.md](security.md)). Photo storage is not wired up yet,
so a new account starts with an empty library, uploads stay in memory, and locking or
reloading clears them. The mock library in `apps/web/src/mock/` (placeholder landscape
"photos" drawn as SVG data URIs) now only decorates the welcome and sign-in screens and
feeds unit tests; sharing, invite codes and
auto-lock are still mock UI.

Twofold presents itself as a private, end-to-end encrypted photo library for anyone. Sharing
exists but is low-key (Settings → Sharing).

![Library](screenshots/desktop-gallery.png)

## Two passwords, two spaces

- The **main password** opens the main library: everyday uploads and backups.
- An optional **private password** opens a separate **private space** with its own photos
  and albums. It is set up from Settings → Passwords.
- Log in and Unlock have a single password box; the password typed decides which space
  opens. Nothing on those screens differs between the two.
- The main library never reveals whether a private space exists: Settings always offers
  "Set up", and the move dialog gives the same answer for a wrong password and for no
  private space.
- Inside the private space the app is re-tinted violet (`data-space="private"` on `<html>`,
  tokens in `styles/base.css`) and shows a small "Private" label, so you know where you are.
- **Move to private space** (photo viewer, main library) asks for the private password.
  **Move to library** (private space) moves a photo back. Albums belong to one space, so a
  moved photo arrives unfiled.
- Each space is shared separately (Settings → Sharing → Invite). Sharing the library never
  shares the private space.
- The lock button (sidebar, or top bar on phones) forgets which space was open.

Unlocking tries the password against every key slot on the device (see
[security.md](security.md#key-slots)), so the server never learns which space opened.
Setting up a private space from the main library always looks the same and replaces any
private space that already exists, since the main library can't know whether there is one.

## Accounts and locking

- Signed out: only the welcome, sign-up, log-in and recovery screens are reachable; library
  routes redirect to `/login`.
- Signed in but locked (after a reload, or the lock button): library routes redirect to
  `/unlock`, which greets the account by name. Keys are only ever in memory, so a reload
  always locks.
- Sign-up makes the keys and the recovery key at step 1 (Argon2id runs on the device, so
  the button shows "Creating your keys…"), shows the 12 words at step 2, and only then
  creates the account.
- `/signup/recovery-key` doubles as "New key" from Settings in the main library. The private
  space can't make a recovery key; its Settings say the private password can't be recovered.
- Delete account asks for a password.
- State lives in `app/account.tsx` (who is signed in, which slot is open) and
  `app/account-ops.ts` (every operation that touches keys); `app/access.ts` decides
  redirects.

## Screens and routes

Routes are the same in both spaces; the content depends on which space is open.

| Route                  | Screen                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `/`                    | Welcome                                                         |
| `/signup`              | Create your account (step 1 of 2)                               |
| `/signup/recovery-key` | Save your 12-word recovery key (step 2)                         |
| `/login`               | Log in                                                          |
| `/unlock`              | Unlock (returning user, key not in memory)                      |
| `/recover`             | Reset the password with the recovery key                        |
| `/photos`              | Library or private space: timeline grouped by month             |
| `/photos/:id`          | Photo viewer; `?from=favorites` or `?from=album:<id>` scopes it |
| `/albums`              | Albums, with "New album"                                        |
| `/albums/:id`          | One album                                                       |
| `/favorites`           | Favorites                                                       |
| `/settings`            | Profile, passwords, sharing, security, devices, appearance      |
| `/settings/share`      | Invite someone to the open space, or join with a code           |
| anything else          | Not found                                                       |

Upload is a dialog opened from the sidebar (desktop) or the top bar (phones); inside an
album it also adds the photos to that album. Its "encrypting" progress is simulated.

## Structure (`apps/web/src`)

- `app/` — routing (`routes.ts` parses URLs, `router.tsx` is a small History API router
  with no dependency), and in-memory state: vault (both spaces), theme, toasts.
- `components/` — layout (`AppShell`, `AuthLayout`) and shared pieces (fields, dialog,
  photo grid, upload dialog, icons, logo).
- `screens/` — one file per screen, each with its own stylesheet.
- `styles/base.css` — design tokens, light and dark themes, the private-space tint, buttons
  and forms.

## Visual language

- Warm ivory with a rose-coral accent in light mode, deep plum in dark mode; cooler violet
  in the private space. The theme follows the device; Settings can force light or dark
  (kept in memory only).
- Serif headings (system serif stack) over a system sans body. No web fonts, so the CSP's
  `default-src 'self'` needs no exceptions.
- Plain CSS with custom properties; no CSS-in-JS and no `<style>` injection, so
  `style-src 'self'` holds. The only inline style is the upload progress width, set
  through the CSSOM, which the CSP allows.
- Layout switches at 860px: sidebar on wide screens, top bar plus bottom tabs on phones.

## Security notes

- Decrypted photos are shown through in-memory object URLs (as uploads already are) and
  must never be written to `localStorage`, IndexedDB or caches.
- No password is kept anywhere: it is turned into keys inside `app/account-ops.ts` and
  dropped. Keys live only in React state and are dropped on lock, sign-out and reload,
  along with every decrypted photo (the vault provider is remounted).
- The invite code and the sharing rows are still placeholders.

## Screenshots

| Desktop                                                        | Desktop                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| ![Welcome](screenshots/desktop-welcome.png)                    | ![Sign up](screenshots/desktop-signup.png)                    |
| ![Unlock](screenshots/desktop-unlock.png)                      | ![Albums](screenshots/desktop-albums.png)                     |
| ![Album](screenshots/desktop-album.png)                        | ![Viewer](screenshots/desktop-viewer.png)                     |
| ![Move](screenshots/desktop-move-dialog.png)                   | ![Settings](screenshots/desktop-settings.png)                 |
| ![Share](screenshots/desktop-share.png)                        | ![Dark mode](screenshots/desktop-gallery-dark.png)            |
| ![Private space](screenshots/desktop-private-gallery.png)      | ![Private settings](screenshots/desktop-private-settings.png) |
| ![Private, dark](screenshots/desktop-private-gallery-dark.png) |                                                               |

Phones:

![Onboarding on a phone](screenshots/mobile-onboarding.png)
![The library on a phone](screenshots/mobile-library.png)
![The private space on a phone](screenshots/mobile-private.png)
