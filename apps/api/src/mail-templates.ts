import type { Mail } from './mail';

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

/** Wraps paragraphs (plain text) into the text and HTML bodies of one email. */
function compose(to: string, subject: string, paragraphs: string[], code?: string): Mail {
  const text = `${paragraphs.join('\n\n')}\n\n—\n${FOOTER}\n`;
  const codeHtml = code
    ? `<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:24px 0">${escapeHtml(code)}</p>`
    : '';
  const body = paragraphs
    .map((paragraph) =>
      code && paragraph === code
        ? codeHtml
        : `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`,
    )
    .join('');
  const html =
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b2230">' +
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">' +
    '<p style="margin:0 0 24px;font-weight:600;color:#2148c0">Arcafold</p>' +
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
    code,
  );
}

/**
 * Sent instead of a code when someone asks to move another account to an address that
 * already has an account. Only the address's owner reads it, so it says so plainly.
 */
export function emailInUseMail(to: string): Mail {
  return compose(to, 'This email already has an Arcafold account', [
    'Someone asked to use this email for an Arcafold account, but it already has one.',
    'If that was you, sign in with this email instead. If it wasn’t, you can ignore this email: nothing has changed.',
  ]);
}
