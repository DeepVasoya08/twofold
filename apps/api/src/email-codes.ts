import {
  emailCodeMatches,
  emailCodeScope,
  emailCodeTag,
  newEmailCode,
  newSessionToken,
} from '@arcafold/crypto/webcrypto';

import { deleteEmailCodeQuery, findEmailCode, saveEmailCode, takeEmailCodeTry } from './email-db';
import { sendMail } from './mail';
import type { Mail, MailSetup } from './mail';

/** How long a code works. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong tries a code allows before a new one is needed. */
export const CODE_MAX_TRIES = 5;
/** The shortest wait between two codes for the same scope. */
export const RESEND_WAIT_MS = 60 * 1000;
/** Codes one scope (an account, or an address at sign-up) can ask for per hour. */
export const MAX_SENDS_PER_HOUR = 5;
/** Sign-up codes one internet address can ask for per hour, whatever the emails. */
export const MAX_SENDS_PER_ADDRESS = 20;
/** How long a confirmed sign-up email may wait for the account to be made. */
export const TICKET_TTL_MS = 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** What each kind of code is for, mixed into its scope so kinds never match each other. */
export type CodePurpose = 'verify' | 'signup' | 'signup-ticket' | 'signup-from';

export const codeMessages = {
  wait: 'Wait a minute before asking for another code.',
  tooMany: 'That’s a lot of codes. Try again in an hour.',
  notSent: 'We couldn’t send the email. Try again in a minute.',
  runOut: 'That code has run out. Ask for a new one.',
  wrong: 'That code isn’t right.',
} as const;

export function codeScope(setup: MailSetup, purpose: CodePurpose, subject: string) {
  return emailCodeScope(setup.secret, purpose, subject);
}

export type IssueResult = 'sent' | 'wait' | 'too-many' | 'not-sent';

/**
 * Makes a new code for `scope`, keeps only its HMAC (bound to `address`), and emails
 * `mail(code)` to the address. At most one a minute and MAX_SENDS_PER_HOUR an hour per scope;
 * two requests at once send one code.
 */
export async function issueCode(
  db: D1Database,
  setup: MailSetup,
  options: {
    scope: string;
    accountId: string | null;
    address: string;
    mail: (code: string) => Mail;
  },
  now: number,
): Promise<IssueResult> {
  const earlier = await findEmailCode(db, options.scope);
  if (earlier && now - earlier.sentAt < RESEND_WAIT_MS) return 'wait';
  const sameHour = earlier !== null && now - earlier.sendsSince < HOUR_MS;
  const sends = (sameHour ? earlier.sends : 0) + 1;
  if (sends > MAX_SENDS_PER_HOUR) return 'too-many';
  const code = newEmailCode();
  const saved = await saveEmailCode(
    db,
    {
      scope: options.scope,
      accountId: options.accountId,
      tag: await emailCodeTag(setup.secret, options.scope, options.address, code),
      expiresAt: now + CODE_TTL_MS,
      sentAt: now,
      sends,
      sendsSince: sameHour ? earlier.sendsSince : now,
    },
    now - RESEND_WAIT_MS,
  );
  if (!saved) return 'wait';
  return (await sendMail(setup, options.mail(code))) ? 'sent' : 'not-sent';
}

export type CheckResult = 'ok' | 'run-out' | 'wrong';

/**
 * Checks a typed code (or a ticket) against `scope`. The try is counted before the check, so
 * parallel guesses still stop at the limit. The row stays; the caller deletes it once used.
 */
export async function checkCode(
  db: D1Database,
  setup: MailSetup,
  scope: string,
  address: string,
  code: string,
  now: number,
): Promise<CheckResult> {
  const tag = await takeEmailCodeTry(db, scope, CODE_MAX_TRIES, now);
  if (!tag) return 'run-out';
  return (await emailCodeMatches(setup.secret, scope, address, code, tag)) ? 'ok' : 'wrong';
}

/**
 * After a sign-up code is right: swaps it for a ticket that lets one account be made with
 * this address within the hour. Returns the ticket, which only the browser keeps.
 */
export async function swapForTicket(
  db: D1Database,
  setup: MailSetup,
  codeScopeId: string,
  ticketScope: string,
  address: string,
  now: number,
): Promise<string> {
  const ticket = newSessionToken();
  await db.batch([deleteEmailCodeQuery(db, codeScopeId), deleteEmailCodeQuery(db, ticketScope)]);
  await saveEmailCode(
    db,
    {
      scope: ticketScope,
      accountId: null,
      tag: await emailCodeTag(setup.secret, ticketScope, address, ticket),
      expiresAt: now + TICKET_TTL_MS,
      sentAt: now,
      sends: 0,
      sendsSince: now,
    },
    now + 1,
  );
  return ticket;
}
