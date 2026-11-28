import type { Context } from 'hono';
import type { z } from 'zod';

import type { AccountResponse } from '@arcafold/types';

import type { AccountRecord } from './db';
import type { Env } from './env';
import { mailSetup } from './mail';

/** Whether this account must confirm its email before using anything else. */
export function mustVerifyEmail(account: Pick<AccountRecord, 'emailVerified'>, env: Env): boolean {
  return !account.emailVerified && mailSetup(env) !== null;
}

export function toAccountResponse(
  account: Omit<AccountRecord, 'unmovedBytes'>,
  env: Env,
): AccountResponse {
  return {
    email: account.email,
    name: account.name,
    version: account.version,
    keyring: account.keyring,
    smartFeatures: account.smartFeatures,
    emailVerified: account.emailVerified,
    mustVerifyEmail: mustVerifyEmail(account, env),
  };
}

/** Parses a JSON body against a schema. Returns null (after nothing is sent) if it is invalid. */
export async function readBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.infer<T> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export const messages = {
  badRequest: 'That request was not valid.',
  wrongLogin: 'That email and password don’t match.',
  throttled: 'Too many tries. Wait a few minutes, then try again.',
  wrongPassword: 'That password isn’t right.',
  emailTaken: 'An account with this email already exists. Log in instead.',
  conflict: 'Your account changed on another device. Reload and try again.',
  verifyEmail: 'Confirm your email to keep going.',
  /**
   * The same words in every space and on every plan, with no price or plan name: the phone
   * apps show it too, and they never point to a purchase (docs/billing.md).
   */
  storageFull: 'Your storage is full. Delete some photos or files to make room.',
  tooManyWrites: 'You’ve made a lot of changes today. Try again tomorrow.',
} as const;
