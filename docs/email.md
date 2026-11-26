# Account email

Arcafold emails people about their own account: a 6-digit code to confirm their address, and
(in later changes) new sign-in notices and invites. Email is only ever a way to reach the
owner. It never resets a password, never unlocks anything and never mentions the private
space. Losing the password and the recovery key still means losing the photos.

## How it works

- Mail is sent by the app's Worker through **Cloudflare Email Service** (the `EMAIL`
  `send_email` binding in `apps/api/wrangler.jsonc`), always from `no-reply@arcafold.com`,
  with replies going to `support@arcafold.com`. No extra package or API key is involved.
- Codes are 6 digits, work for 10 minutes and allow 5 tries (counted before each check, so
  parallel guesses don't get more). An account can ask for one code a minute and 5 an hour.
  D1 keeps only HMACs of the code and of what it is for, keyed with the `EMAIL_CODE_SECRET`
  Worker secret (`email_codes`, migration 0022), so a copy of the database can't be used to
  guess codes or read addresses. A code is bound to the address it was sent to.
- Until an account has confirmed its email (`accounts.email_verified`), the server refuses
  every library, sharing and account request with `403 { code: "verify-email" }`. Only
  reading the account, asking for a code, confirming and signing out still work. A phone's
  background backup (its upload-only token) keeps uploading meanwhile. The web and phone
  apps show a **Confirm your email** step after unlocking instead of the library.
- Before it's confirmed, the address can be changed to fix a typo. That needs the login key
  as well as the session, and an address that already has an account gets a short "this
  email already has an account" note instead of a code, while the app gets the same answer
  either way.
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
