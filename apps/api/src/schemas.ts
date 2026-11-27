import { z } from 'zod';

import {
  FACE_SEGMENT_DELETE_MAX,
  FACE_SIZES,
  KEY_SIZES,
  SEARCH_SEGMENT_DELETE_MAX,
  SEARCH_SIZES,
  MEMBER_ACCESS,
  PAID_PLAN_IDS,
  PLAN_PERIODS,
  SHARE_SIZES,
  SMART_FEATURES_VERSION,
  STORAGE_SIZES,
  TRASH_BATCH_MAX,
} from '@arcafold/types';

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

/** A sign-up ticket: 32 random bytes, base64url. */
const ticket = base64Url(32);

export const signUpSchema = z.strictObject({
  email,
  name,
  keyring: keyringSchema,
  ticket: ticket.optional(),
});

export const signUpCodeSchema = z.strictObject({ email });

export const preLoginSchema = z.strictObject({ email });

export const loginSchema = z.strictObject({ email, loginKey });

export const updateKeyringSchema = z.strictObject({
  loginKey,
  version: z.number().int().min(1),
  keyring: keyringSchema,
});

export const deleteAccountSchema = z.strictObject({ loginKey });

export const updateNameSchema = z.strictObject({ name });

/**
 * Asks for a code at `email`. A different address than the account's needs the login key
 * too, so a session alone (a device left signed in) can't move the account's email.
 */
export const sendEmailCodeSchema = z.strictObject({ email, loginKey: loginKey.optional() });

const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

export const verifyEmailSchema = z.strictObject({ email, code });

export const signUpVerifySchema = z.strictObject({ email, code });

/** Only the current version of the smart features question can be answered. */
export const smartFeaturesSchema = z.strictObject({
  choice: z.enum(['on', 'off']),
  version: z.literal(SMART_FEATURES_VERSION),
});

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

/**
 * What a shared album or folder shows the people it's shared with, sealed under its own key.
 * A folder's holds the folders inside it too, so it may be larger than other records.
 */
export const sharedRecordSchema = z.strictObject({
  meta: z
    .string()
    .min(base64UrlLength(40))
    .max(base64UrlLength(STORAGE_SIZES.maxSharedRecord))
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** A phone's upload-only token, sent once so the server can keep its SHA-256. */
export const createUploadTokenSchema = z.strictObject({ id: recordId, token: spaceTokenSchema });

export const trashSchema = z.strictObject({
  photos: z
    .array(z.strictObject({ id: recordId, meta: sealedRecord }))
    .min(1)
    .max(TRASH_BATCH_MAX)
    .refine((photos) => new Set(photos.map((photo) => photo.id)).size === photos.length),
});

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

export const createFolderEditSchema = z.strictObject({ id: recordId, meta: sealedRecord });

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

/** A sealed search segment: nonce, ciphertext and tag, at most SEARCH_SIZES.maxSegment bytes. */
export const searchSegmentSchema = z.strictObject({
  data: z
    .string()
    .min(base64UrlLength(40))
    .max(base64UrlLength(SEARCH_SIZES.maxSegment))
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const deleteSearchSegmentsSchema = z.strictObject({
  ids: z.array(recordId).min(1).max(SEARCH_SEGMENT_DELETE_MAX),
});

/** POST /account/billing/subscribe. Yearly Max is refused by the route (not a subscription). */
export const subscribeSchema = z.strictObject({
  plan: z.enum(PAID_PLAN_IDS),
  period: z.enum(PLAN_PERIODS),
});

/** POST /account/billing/confirm, after Razorpay Checkout closes. */
export const confirmSubscriptionSchema = z.strictObject({
  subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]{1,40}$/),
});
