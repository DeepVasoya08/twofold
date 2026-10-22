import type { Context } from 'hono';
import type { z } from 'zod';

import type { AccountResponse } from '@twofold/types';

import type { AccountRecord } from './db';

export function toAccountResponse(account: AccountRecord): AccountResponse {
  return {
    email: account.email,
    name: account.name,
    version: account.version,
    keyring: account.keyring,
    smartFeatures: account.smartFeatures,
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
} as const;
