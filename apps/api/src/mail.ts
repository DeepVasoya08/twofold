import { EMAIL_SECRET_MIN_LENGTH } from '@arcafold/crypto/webcrypto';

import type { Env } from './env';

/** Who account email comes from. Replies go to a person, not to the no-reply address. */
export const MAIL_FROM = { name: 'Arcafold', email: 'no-reply@arcafold.com' } as const;
export const MAIL_REPLY_TO = 'support@arcafold.com';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** What email needs to work, once both the sender and the code secret are in place. */
export interface MailSetup {
  email: SendEmail;
  secret: string;
}

/** The sender and code secret, or null while email isn't set up for this Worker. */
export function mailSetup(env: Env): MailSetup | null {
  const secret = env.EMAIL_CODE_SECRET;
  if (!env.EMAIL || !secret || secret.length < EMAIL_SECRET_MIN_LENGTH) return null;
  return { email: env.EMAIL, secret };
}

/**
 * Sends one email. Returns false if it couldn't be sent; only the error's name is logged,
 * never the address, code or body.
 */
export async function sendMail(setup: MailSetup, mail: Mail): Promise<boolean> {
  try {
    await setup.email.send({
      from: MAIL_FROM,
      replyTo: MAIL_REPLY_TO,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (error) {
    console.error('Email not sent', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}
