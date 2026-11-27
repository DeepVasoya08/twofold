import type { Mail } from './mail';
import { MAIL_LOGO_URL } from './mail';
import type { RequestInfo } from './request-info';

/**
 * Every email Arcafold sends. They are short and plain, never carry a sign-in link, and never
 * mention the private space. The footer says what Arcafold will never email, to blunt
 * phishing that pretends to be us.
 */

const FOOTER =
  'Arcafold will never email you a link to unlock your photos, and never asks for your password or recovery key.';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Label and value lines shown in a small box, such as which device asked and when. */
type Details = [label: string, value: string][];

/** What an email says about the request behind it. The place is left out when unknown. */
function aboutRequest(info: RequestInfo): Details {
  const details: Details = [['Device', info.device]];
  if (info.place) details.push(['Location', `Near ${info.place}`]);
  details.push(['Time', mailTime(info.when)]);
  return details;
}

/**
 * Wraps paragraphs (plain text) into the text and HTML bodies of one email. Details, when
 * given, go after the first paragraph.
 */
function compose(
  to: string,
  subject: string,
  paragraphs: string[],
  options: { code?: string; details?: Details } = {},
): Mail {
  const { code, details } = options;
  const detailText = details?.map(([label, value]) => `${label}: ${value}`).join('\n');
  const textParts = [...paragraphs];
  if (detailText) textParts.splice(1, 0, detailText);
  const text = `${textParts.join('\n\n')}\n\n—\n${FOOTER}\n`;

  const paragraphHtml = (paragraph: string) =>
    code && paragraph === code
      ? `<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:24px 0">${escapeHtml(code)}</p>`
      : `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`;
  const detailHtml = details
    ? '<table role="presentation" style="width:100%;margin:0 0 16px;border-collapse:collapse;background:#f6f7fb;border-radius:12px">' +
      details
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 14px;font-size:13px;color:#5b6475;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>` +
            `<td style="width:100%;padding:8px 14px;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`,
        )
        .join('') +
      '</table>'
    : '';
  const body = paragraphs
    .map((paragraph, index) => paragraphHtml(paragraph) + (index === 0 ? detailHtml : ''))
    .join('');
  const html =
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b2230">' +
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">' +
    '<table role="presentation" style="margin:0 0 24px;border-collapse:collapse"><tr>' +
    `<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${MAIL_LOGO_URL}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px"></td>` +
    '<td style="vertical-align:middle;font-size:18px;font-weight:700;color:#1b2230">Arcafold</td>' +
    '</tr></table>' +
    body +
    `<p style="margin:32px 0 0;font-size:13px;color:#5b6475">${escapeHtml(FOOTER)}</p>` +
    '</div></body></html>';
  return { to, subject, text, html };
}

/** The code that confirms an address. */
export function confirmEmailMail(to: string, code: string): Mail {
  return compose(
    to,
    `${code} is your Arcafold code`,
    [
      'Enter this code in Arcafold to confirm your email:',
      code,
      'It works for 10 minutes. If you didn’t ask for it, you can ignore this email.',
    ],
    { code },
  );
}

/**
 * Sent instead of a code when someone asks to move another account to an address that
 * already has an account. Only the address's owner reads it, so it says so plainly.
 */
export function emailInUseMail(to: string, info: RequestInfo): Mail {
  return compose(
    to,
    'This email already has an Arcafold account',
    [
      'Someone asked to use this email for another Arcafold account, but it already has one.',
      'If that was you, sign in with this email instead. If it wasn’t, you can ignore this email: nothing has changed.',
    ],
    { details: aboutRequest(info) },
  );
}

/**
 * Sent instead of a sign-up code to an address that already has an account. The sign-up
 * screen says "check your email" either way, so only the address's owner learns this.
 */
export function alreadySignedUpMail(to: string, info: RequestInfo): Mail {
  return compose(
    to,
    'You already have an Arcafold account',
    [
      'Someone tried to create an Arcafold account with this email, but it already has one.',
      'If that was you, sign in instead. If you’ve lost your password, your recovery key can set a new one. If it wasn’t you, you can ignore this email: nothing has changed.',
    ],
    { details: aboutRequest(info) },
  );
}

/** Hides most of an address for a notice to someone else's inbox: "s•••@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** A time anyone can read without knowing their time zone: "26 Nov 2026, 10:48 UTC". */
export function mailTime(when: number): string {
  const date = new Date(when);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getUTCDate())} ${months[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear())}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/**
 * Sent to the old address once the account's email has moved, so a change nobody meant to
 * make doesn't go unseen. It carries no undo link: a link that changes the account would be
 * a way into it.
 */
export function emailChangedMail(oldAddress: string, newAddress: string, info: RequestInfo): Mail {
  return compose(
    oldAddress,
    'Your Arcafold email was changed',
    [
      `The email for your Arcafold account was changed to ${maskEmail(newAddress)}. This address won’t get Arcafold emails any more.`,
      'If you didn’t do this, sign in with your password and change your password in Settings: that signs out every other device. Then write to support@arcafold.com.',
    ],
    { details: aboutRequest(info) },
  );
}

/**
 * Sent when a new device signs in. It's the same whichever password or key was used, so it
 * says nothing about what was opened.
 */
export function newSignInMail(to: string, info: RequestInfo): Mail {
  return compose(
    to,
    'New sign-in to Arcafold',
    [
      'Your Arcafold account was just signed in on a new device.',
      'If this was you, there’s nothing to do. If it wasn’t, open Settings, then Devices, sign that device out and change your password.',
    ],
    { details: aboutRequest(info) },
  );
}

/** Sent once the account and everything in it is gone. */
export function accountDeletedMail(to: string): Mail {
  return compose(to, 'Your Arcafold account was deleted', [
    'Your Arcafold account and everything in it has been deleted. It can’t be brought back.',
    'If you didn’t do this, write to support@arcafold.com.',
  ]);
}
