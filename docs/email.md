# Account email

Arcafold emails people about their own account: a 6-digit code to confirm or change their
address, a notice when it changes, a note on each new sign-in, a confirmation when the
account is deleted, and (in a later change) invites. Email is only ever a way to reach the
owner. It never resets a password, never unlocks anything and never mentions the private
space. Losing the password and the recovery key still means losing the photos.

## How it works

- Mail is sent by the app's Worker through **Cloudflare Email Service** (the `EMAIL`
  `send_email` binding in `apps/api/wrangler.jsonc`), always from `no-reply@arcafold.com`,
  with replies going to `support@arcafold.com`. No extra package or API key is involved.
- Codes are 6 digits, work for 10 minutes and allow 5 tries (counted before each check, so
  parallel guesses don't get more). An account can ask for one code a minute and 5 an hour.
  Codes to a new address are also limited to 5 an hour across all accounts (a note to an
  address that has an account counts the same), as sign-up codes are per address, so many
  accounts together get no more guesses at an address than one.
  D1 keeps only HMACs of the code and of what it is for, keyed with the `EMAIL_CODE_SECRET`
  Worker secret (`email_codes`, migration 0022), so a copy of the database can't be used to
  guess codes or read addresses. A code is bound to the address it was sent to.
- **Sign-up** (while email is on): after name, email and password, the address gets a code
  (`POST /api/auth/signup/code`), and typing it back (`/signup/verify`) gives the browser a
  one-use ticket, valid an hour, that `POST /api/auth/signup` must carry. Keys are only made
  after that, and the account starts confirmed. An address that already has an account gets
  a "you already have an account" note instead of a code, and the screen says "check your
  email" either way, with a line under the code box saying that an address with an
  account gets a note instead (so nobody is left wondering, without saying which it was). Sign-up codes are also limited to 20 an hour per internet address.
  While email is off, `signup/code` answers `{ codeSent: false }` and sign-up goes on
  without a code, as before.
- **Sign-in** (while email is on) gives an email with no account a made-up salt that is
  always the same for it, so the first step of sign-in doesn't say whether an account
  exists.
- Rows nobody can use any more (codes, tickets and address counts expired a day ago) are
  deleted whenever a sign-up code is asked for.
- Until an account has confirmed its email (`accounts.email_verified`), the server refuses
  every library, sharing and account request with `403 { code: "verify-email" }`. Only
  reading the account, asking for a code, confirming and signing out still work. A phone's
  background backup (its upload-only token) keeps uploading meanwhile. The web and phone
  apps show a **Confirm your email** step after unlocking instead of the library.
- Before it's confirmed, the address can be changed to fix a typo. That needs the login key
  as well as the session, and an address that already has an account gets a short "this
  email already has an account" note instead of a code, while the app gets the same answer
  either way.
- **Changing a confirmed email** (Settings > Email > Change, on web and phone) works the
  same way: the login key and the session ask for a code at the new address, and the
  account moves only once it's typed back. The old address then gets "Your Arcafold email
  was changed", which shows the new address only partly (`s•••@example.com`) and has no
  link, so it can't be used to undo the change or hand the account to someone else. Asking
  for a code to the address the account already has is refused.
- **New sign-in**: each successful sign-in to a confirmed account emails it "New sign-in to
  Arcafold" with the kind of device (as in the Devices list, such as "Chrome on Android")
  the approximate location (city and country, from Cloudflare's guess for the internet
  address) and the time in UTC. The email is the same whichever password or key signed in, so it
  never says whether the private space was opened. A wrong password sends nothing.
- **Account deleted**: deleting the account emails a short confirmation to a confirmed
  address once it's gone. There is no email for a password change: the server can't tell
  a main password change from setting up a private space, and a dated email would be a
  record of one.
- Notices are sent after the response is ready (`waitUntil`), and a failed send never
  undoes the change it is about.
- The "already has an account" notes and the "email was changed" notice show the same
  device, rough location ("Near Pune, India") and time, so the owner can tell whether it was them. None of
  this is stored or logged: it is read from the request for that one email.
- Emails start with the app icon, loaded from `https://arcafold.com/icon-192.png`. Mail
  apps that hide images until asked still show the "Arcafold" name beside it.
- Templates live in `apps/api/src/mail-templates.ts`. They are plain and short, carry no
  links, and end by saying Arcafold never emails a link to unlock photos.

## Turning it on (production)

Email stays off, and nobody is asked to confirm, until both of these are done:

1. **Onboard the sending domain.** In the Cloudflare dashboard open **Compute (Workers) →
   Email Service → Email Sending**, choose **Onboard Domain** and pick `arcafold.com`.
   Accept the DNS records it offers (MX, SPF and DKIM on a `cf-bounce` subdomain, and
   DMARC). Email Routing rules for receiving (`no-reply@` and `support@` forwarding to the
   owner's inbox) stay as they are. Sending to anyone other than your own verified
   addresses needs the Workers Paid plan.
2. **Add the code secret.** In GitHub open **Settings → Environments → production** and add
   the secret `EMAIL_CODE_SECRET`, a random value of at least 32 characters
   (`openssl rand -base64 32`). The Deploy workflow copies it to the Worker with
   `wrangler secret put` after each deploy. Set it only once the domain is onboarded: the
   moment the Worker has it, accounts are asked to confirm their email.

Changing the secret makes codes already sent stop working; nothing else depends on it.

Staging deploys never get the secret, so staging sends no email.

Cloudflare's Email Service is in beta. Workers Paid includes about 3,000 emails a month and
then charges per thousand; new accounts start on a small daily sending limit.

## Locally and in tests

`wrangler dev` has no `EMAIL_CODE_SECRET`, so local runs and the Playwright tests behave as
before. API tests pass a stand-in mailbox as `EMAIL` (`apps/api/src/email.test.ts`), and the
Playwright test for the confirm step stands in for the email routes
(`apps/web/e2e/confirm-email.spec.ts`).
