import { z } from 'zod';

import { KEY_SIZES } from '@twofold/types';

/** Length of an unpadded base64url string encoding `bytes` bytes. */
function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

function base64Url(bytes: number) {
  return z
    .string()
    .length(base64UrlLength(bytes))
    .regex(/^[A-Za-z0-9_-]+$/);
}

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

const name = z.string().trim().min(1).max(60);

const kdf = z.strictObject({
  opsLimit: z.number().int().min(3).max(10),
  memLimit: z
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(1024 * 1024 * 1024),
});

const slot = base64Url(KEY_SIZES.slot);
const verifier = base64Url(KEY_SIZES.verifier);
const loginKey = base64Url(KEY_SIZES.loginKey);

export const keyringSchema = z.strictObject({
  salt: base64Url(KEY_SIZES.salt),
  kdf,
  slots: z.tuple([slot, slot, slot]),
  verifiers: z.tuple([verifier, verifier, verifier]),
});

export const signUpSchema = z.strictObject({ email, name, keyring: keyringSchema });

export const preLoginSchema = z.strictObject({ email });

export const loginSchema = z.strictObject({ email, loginKey });

export const updateKeyringSchema = z.strictObject({
  loginKey,
  version: z.number().int().min(1),
  keyring: keyringSchema,
});

export const deleteAccountSchema = z.strictObject({ loginKey });
