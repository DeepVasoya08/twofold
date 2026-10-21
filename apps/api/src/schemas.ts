import { z } from 'zod';

import {
  FACE_SEGMENT_DELETE_MAX,
  FACE_SIZES,
  KEY_SIZES,
  MEMBER_ACCESS,
  SHARE_SIZES,
  STORAGE_SIZES,
} from '@twofold/types';

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

export const updateNameSchema = z.strictObject({ name });

/** A session's public id: 16 random bytes in lowercase hex, made by SQLite. */
export const deviceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

const recordId = base64Url(STORAGE_SIZES.recordId);

/** A sealed record: nonce, ciphertext and tag, at most STORAGE_SIZES.maxRecord bytes. */
const sealedRecord = z
  .string()
  .min(base64UrlLength(40))
  .max(base64UrlLength(STORAGE_SIZES.maxRecord))
  .regex(/^[A-Za-z0-9_-]+$/);

export const spaceTokenSchema = base64Url(STORAGE_SIZES.spaceToken);

export const recordIdSchema = recordId;

export const photoPartSchema = z.enum(['thumb', 'full']);

export const createPhotoSchema = z.strictObject({
  id: recordId,
  meta: sealedRecord,
  thumbSize: z.number().int().min(1).max(STORAGE_SIZES.maxThumb),
  fullSize: z.number().int().min(1).max(STORAGE_SIZES.maxFull),
});

export const createAlbumSchema = z.strictObject({ id: recordId, meta: sealedRecord });

export const updateRecordSchema = z.strictObject({ meta: sealedRecord });

/** An encrypted profile photo: secretstream output, at most STORAGE_SIZES.maxProfilePhoto. */
export const profilePhotoSchema = z.strictObject({
  id: recordId,
  meta: sealedRecord,
  image: z
    .string()
    .min(base64UrlLength(41))
    .max(base64UrlLength(STORAGE_SIZES.maxProfilePhoto))
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const emptySchema = z.strictObject({});

/** TWO-XXXX-XXXX, from the alphabet packages/crypto draws codes from. */
export const inviteCodeSchema = z.string().regex(/^TWO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

export const inviteHandleSchema = base64Url(SHARE_SIZES.handle);

/** The token in an invite link: 128 random bits. */
export const inviteLinkSchema = base64Url(SHARE_SIZES.link);

const publicKey = base64Url(SHARE_SIZES.publicKey);

/** nonce (24) + MAC (16) + at most SHARE_SIZES.maxMessage bytes of sealed message. */
const peerMessage = z
  .string()
  .min(base64UrlLength(41))
  .max(base64UrlLength(SHARE_SIZES.maxMessage))
  .regex(/^[A-Za-z0-9_-]+$/);

export const createInviteSchema = z.strictObject({
  code: inviteCodeSchema,
  link: inviteLinkSchema,
  handle: inviteHandleSchema,
  commitment: base64Url(SHARE_SIZES.commitment),
});

export const joinInviteSchema = z.strictObject({ joinerKey: publicKey });

export const helloSchema = z.strictObject({ hello: peerMessage });

export const revealSchema = z.strictObject({ inviterKey: publicKey, intro: peerMessage });

export const grantSchema = z.strictObject({ grant: peerMessage });

const memberAccess = z.enum(MEMBER_ACCESS);

export const createMemberSchema = z.strictObject({
  id: recordId,
  token: spaceTokenSchema,
  meta: sealedRecord,
  album: recordId.optional(),
  access: memberAccess.optional(),
});

export const updateMemberSchema = z.strictObject({ access: memberAccess });

export const createJoinedSchema = z.strictObject({ id: recordId, meta: sealedRecord });

export const createPendingInviteSchema = z.strictObject({ id: recordId, meta: sealedRecord });

/** A sealed face segment: nonce, ciphertext and tag, at most FACE_SIZES.maxSegment bytes. */
export const faceSegmentSchema = z.strictObject({
  data: z
    .string()
    .min(base64UrlLength(40))
    .max(base64UrlLength(FACE_SIZES.maxSegment))
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const deleteFaceSegmentsSchema = z.strictObject({
  ids: z.array(recordId).min(1).max(FACE_SEGMENT_DELETE_MAX),
});
