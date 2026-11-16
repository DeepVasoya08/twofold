/** Response body of the API health check (`GET /health`). */
export interface HealthResponse {
  status: 'ok';
}

/** Error body every failing API route returns. The message is safe to show to the user. */
export interface ErrorResponse {
  error: string;
}

/**
 * Byte sizes of the key material the browser sends. The API checks lengths against these;
 * packages/crypto produces values of exactly these sizes. Binary values travel as unpadded
 * base64url.
 */
export const KEY_SIZES = {
  salt: 16,
  /** A sealed key slot: nonce (24) + MAC (16) + space key (32) + space id (16). */
  slot: 88,
  /** A login key, and the SHA-256 verifier the server keeps of it. */
  loginKey: 32,
  verifier: 32,
} as const;

/**
 * Every account has exactly this many key slots, in this order: main password, recovery
 * key, private password. A slot that is not in use holds random bytes, which look the same
 * as a sealed slot, so nobody can tell from the keyring whether a private space exists.
 */
export const SLOT_COUNT = 3;

export type Slots = [string, string, string];

/** Argon2id cost parameters, kept with the account so they can be raised later. */
export interface KdfParams {
  opsLimit: number;
  memLimit: number;
}

/** Everything the server keeps about an account's keys. None of it is readable without a password. */
export interface Keyring {
  salt: string;
  kdf: KdfParams;
  slots: Slots;
  /** SHA-256 of each slot's login key, so the server can check a login without learning keys. */
  verifiers: Slots;
}

/** The account as the signed-in browser sees it. */
export interface AccountResponse {
  email: string;
  name: string;
  /** Bumped on every keyring change; updates must name the version they started from. */
  version: number;
  keyring: Keyring;
  /** The answer to the smart features question, or null if it hasn't been asked yet. */
  smartFeatures: SmartFeaturesChoice | null;
}

/**
 * The smart features question shown once after sign-up (and once to accounts made before it
 * existed). Bumped if what it asks changes, so everyone is asked again.
 */
export const SMART_FEATURES_VERSION = 1;

/**
 * What someone answered: whether face grouping starts on for their devices, and which
 * version of the question they saw. It's the same in both spaces, so it says nothing about
 * a private space.
 */
export interface SmartFeaturesChoice {
  choice: 'on' | 'off';
  version: number;
}

export type SmartFeaturesRequest = SmartFeaturesChoice;

export interface SignUpRequest {
  email: string;
  name: string;
  keyring: Keyring;
}

export interface PreLoginRequest {
  email: string;
}

/** What the browser needs to turn a password into a login key. */
export interface PreLoginResponse {
  salt: string;
  kdf: KdfParams;
}

export interface LoginRequest {
  email: string;
  /** Login key derived from the main password, the private password, or the recovery key. */
  loginKey: string;
}

/** Replaces the whole keyring. Sending all slots every time hides which one changed. */
export interface UpdateKeyringRequest {
  /** Proves the caller knows a password (or the recovery key), not just the session cookie. */
  loginKey: string;
  version: number;
  keyring: Keyring;
}

export interface DeleteAccountRequest {
  loginKey: string;
}

/** Changes the name shown on the account. Names are not secret: sign-up sends one too. */
export interface UpdateNameRequest {
  name: string;
}

export type DeviceKind = 'computer' | 'phone' | 'tablet';

/** One signed-in device: a session, labeled from its browser when it was last used. */
export interface Device {
  id: string;
  /** "Chrome on Android"; empty when the browser couldn't be told. */
  name: string;
  kind: DeviceKind;
  /** Milliseconds since the epoch. */
  signedInAt: number;
  /** Milliseconds since the epoch, to the hour. */
  lastActive: number;
  /** True for the device asking. */
  current: boolean;
}

export interface DeviceList {
  devices: Device[];
}

/**
 * Photo storage. A space's storage is addressed by its access token (the space id from its
 * key slot), sent in this header. The server keeps only the token's SHA-256 and never links
 * a space to an account, so it cannot tell whose space it is or how many an account has.
 */
export const SPACE_HEADER = 'x-arcafold-space';

export const STORAGE_SIZES = {
  /** The space access token: the space id from the key slot. */
  spaceToken: 16,
  /** Photo and album ids are random, chosen by the browser. */
  recordId: 16,
  /** Largest sealed record (photo or album metadata), in bytes before base64url. */
  maxRecord: 2048,
  /** Largest encrypted thumbnail and full-size photo, in bytes. */
  maxThumb: 1024 * 1024,
  maxFull: 64 * 1024 * 1024,
  /** Most encrypted bytes one account can upload and keep, across every space. */
  accountQuota: 1024 * 1024 * 1024,
  /** Largest encrypted profile photo, in bytes. The browser shrinks photos well below this. */
  maxProfilePhoto: 128 * 1024,
} as const;

/**
 * Most thumbnails one `GET /space/thumbs?ids=a,b,c` returns. The response is the encrypted
 * thumbnails in the order asked, each as a 4-byte big-endian length and then its bytes; a
 * length of 0 means that photo isn't there (deleted, still uploading, or another space's).
 */
export const THUMB_BATCH_MAX = 48;

/**
 * Reads a thumbnail batch response as it arrives, so each thumbnail can be shown without
 * waiting for the rest. `push` takes the next bytes and returns the thumbnails they
 * complete, in order (null where the server had none); it returns null once the response
 * turns out to be malformed. `finished` says whether exactly `count` thumbnails came, with
 * nothing after them.
 */
export class ThumbBatchParser {
  /** Bytes received but not yet read, kept as they came so a large thumbnail is copied once. */
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  /** How many bytes the next step needs: a length, or the thumbnail it announced. */
  private needed = 4;
  private length: number | null = null;
  private read = 0;
  private broken = false;

  constructor(private readonly count: number) {}

  push(chunk: Uint8Array): (Uint8Array<ArrayBuffer> | null)[] | null {
    if (this.broken) return null;
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    const parts: (Uint8Array<ArrayBuffer> | null)[] = [];
    while (this.buffered >= this.needed && this.buffered > 0) {
      if (this.read === this.count) return this.fail();
      const bytes = this.take(this.needed);
      if (this.length === null) {
        const length = new DataView(bytes.buffer).getUint32(0);
        if (length > STORAGE_SIZES.maxThumb) return this.fail();
        if (length === 0) {
          parts.push(null);
          this.read += 1;
        } else {
          this.length = length;
          this.needed = length;
        }
      } else {
        parts.push(bytes);
        this.read += 1;
        this.length = null;
        this.needed = 4;
      }
    }
    return parts;
  }

  /** True once exactly `count` thumbnails came, with nothing after them. */
  get finished(): boolean {
    return !this.broken && this.read === this.count && this.buffered === 0;
  }

  private fail(): null {
    this.broken = true;
    this.chunks = [];
    return null;
  }

  /** Removes the first `size` buffered bytes and returns them as one array. */
  private take(size: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      const first = this.chunks[0];
      if (!first) break;
      const used = Math.min(first.length, size - filled);
      out.set(first.subarray(0, used), filled);
      filled += used;
      if (used === first.length) this.chunks.shift();
      else this.chunks[0] = first.subarray(used);
    }
    this.buffered -= size;
    return out;
  }
}

/**
 * Splits a whole thumbnail batch response into one entry per id asked for, in order: the
 * encrypted thumbnail, or null where the server had none. Returns null if the response is
 * malformed.
 */
export function readThumbBatch(
  bytes: Uint8Array<ArrayBuffer>,
  count: number,
): (Uint8Array<ArrayBuffer> | null)[] | null {
  const parser = new ThumbBatchParser(count);
  const parts = parser.push(bytes);
  return parts && parser.finished ? parts : null;
}

/** Which encrypted file of a photo: a small preview, or the original. */
export type PhotoPart = 'thumb' | 'full';

/** A photo as stored: an id, sealed metadata (which holds the photo's key) and file sizes. */
export interface StoredPhoto {
  id: string;
  meta: string;
  thumbSize: number;
  fullSize: number;
  /**
   * Set when a phone added this photo with an upload-only token: its metadata is sealed to
   * the space's upload key, so only the owner can open it (and seal it again as usual).
   */
  sealedForOwner?: true;
}

export interface StoredAlbum {
  id: string;
  meta: string;
}

/** One page of a space's photos. `next` is the cursor for the following page, if any. */
export interface PhotoPage {
  photos: StoredPhoto[];
  next: string | null;
}

export interface AlbumList {
  albums: StoredAlbum[];
}

/**
 * A space's profile photo: the image encrypted under its own file key, and that key in an
 * owner-only sealed record. Each space has its own, so one never hints at the other.
 */
export interface StoredProfilePhoto {
  id: string;
  meta: string;
  /** The encrypted image, base64url. */
  image: string;
}

export interface ProfilePhotoResponse {
  photo: StoredProfilePhoto | null;
}

/** The account's storage across both spaces, shown in either one. */
export interface AccountStorage {
  /** Encrypted bytes stored, uploads in progress included. */
  used: number;
  limit: number;
}

/**
 * Starts a photo upload. The two files follow with PUT (in either order, or together); the
 * one that lands second makes the photo visible, so a separate commit is only a fallback.
 */
export type CreatePhotoRequest = Omit<StoredPhoto, 'sealedForOwner'>;

/** A space's upload key: its secret half, sealed under the owner's key, if it has one. */
export interface UploadKeyResponse {
  meta: string | null;
}

/** The ids of the phones' upload-only tokens for a space. */
export interface UploadTokenList {
  ids: string[];
}

/** Registers one phone's upload-only token (the server keeps its SHA-256). */
export interface CreateUploadTokenRequest {
  id: string;
  token: string;
}

/** The answer to uploading one file: whether that made the photo visible. */
export interface PutFileResponse {
  committed: boolean;
}

export type CreateAlbumRequest = StoredAlbum;

/** Replaces a photo's or album's sealed metadata (favorites, albums, titles). */
export interface UpdateRecordRequest {
  meta: string;
}

/** The most photos one request may move into or out of Recently deleted. */
export const TRASH_BATCH_MAX = 100;

/**
 * Moves photos into Recently deleted, or restores them. Each photo's sealed metadata is
 * replaced in the same step, since it carries when the photo was deleted (the server never
 * stores that).
 */
export interface TrashRequest {
  photos: { id: string; meta: string }[];
}

/** The photos a trash or restore request moved; ones already moved or gone are left out. */
export interface TrashResponse {
  photoIds: string[];
}

/**
 * Sharing. A space is shared by giving another account a share token of its own (sent in
 * SPACE_HEADER instead of the space id) and the space's records key. Who a space is shared
 * with, and which libraries it has joined, are sealed records only the space's owner opens.
 */
export const SHARE_SIZES = {
  /** A crypto_box public key, and the BLAKE2b commitment to one. */
  publicKey: 32,
  commitment: 32,
  /** The inviter's private handle on its invite. */
  handle: 16,
  /** The token in an invite link. It only names the invite; it holds no key. */
  link: 16,
  /** Largest sealed message between the two sides of an invite, in bytes. */
  maxMessage: 1024,
} as const;

/** An invite works once and only for this long. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Most people one space can be shared with, most people one album can be shared with, and
 * most libraries and albums one space can join.
 */
export const MAX_MEMBERS = 20;
export const MAX_ALBUM_MEMBERS = 20;
export const MAX_JOINED = 50;
/** Most invites one space can have in progress at once (either side of them). */
export const MAX_PENDING_INVITES = 20;

/**
 * Starts an invite. The joiner will use `link` (in a link) or `code` (typed); both only name
 * the invite. The inviter keeps `handle` to itself and uses it for its own steps.
 * `commitment` binds the inviter's public key before it is revealed.
 */
export interface CreateInviteRequest {
  code: string;
  link: string;
  handle: string;
  commitment: string;
}

/** What the inviter sees of its invite as it progresses. */
export interface InviterView {
  joinerKey: string | null;
  /** True once the inviter's key (and its sealed name) has been revealed. */
  revealed: boolean;
  /** The joiner's name, sealed to the inviter's key. */
  hello: string | null;
}

/** What the joiner sees of the invite as it progresses. */
export interface JoinerView {
  commitment: string;
  inviterKey: string | null;
  /** The inviter's name, sealed to the joiner's key, revealed with the inviter's key. */
  intro: string | null;
  /** True once the joiner's name has been sent. */
  helloSent: boolean;
  /** The access, sealed to the joiner's key, once the inviter confirms. */
  grant: string | null;
}

export interface JoinInviteRequest {
  joinerKey: string;
}

export interface HelloRequest {
  hello: string;
}

export interface RevealRequest {
  inviterKey: string;
  intro: string;
}

export interface GrantRequest {
  grant: string;
}

/**
 * What someone a library is shared with may do: `view` sees and downloads, `edit` also adds,
 * changes and deletes photos and albums. Someone given one album can only ever view.
 */
export const MEMBER_ACCESS = ['view', 'edit'] as const;

export type MemberAccess = (typeof MEMBER_ACCESS)[number];

/**
 * Someone a space is shared with: a random id and who they are, sealed for the owner.
 * `album` is set when they were given one album rather than the whole library.
 */
export interface StoredMember {
  id: string;
  meta: string;
  album: string | null;
  access: MemberAccess;
}

/**
 * Shares a space, or one album of it: the member's own token (stored hashed) and their
 * sealed details. An album-scoped token reaches only that album's shared photos, read-only.
 */
export interface CreateMemberRequest {
  id: string;
  token: string;
  meta: string;
  album?: string;
  /** What they may do. Left out, they can only view. */
  access?: MemberAccess;
}

/** Changes what someone the library is shared with may do. */
export interface UpdateMemberRequest {
  access: MemberAccess;
}

/** What a member's token may do, as the member asks for it. */
export interface MembershipResponse {
  access: MemberAccess;
}

export interface MemberList {
  members: StoredMember[];
}

/** Starts or updates sharing an album: its title, sealed under the album's own key. */
export type ShareAlbumRequest = UpdateRecordRequest;

/** A photo's details sealed under a shared album's key, for the people it's shared with. */
export type PutAlbumItemRequest = UpdateRecordRequest;

/** The photos a shared album currently lists for the people it's shared with. */
export interface AlbumItemList {
  photoIds: string[];
}

/** A library this space has joined: its share token and records key, sealed for the owner. */
export type StoredJoined = StoredAlbum;

export type CreateJoinedRequest = StoredJoined;

export interface JoinedList {
  joined: StoredJoined[];
}

/**
 * One side of an invite still in progress, kept by the space it was made from or is joining
 * into: its secret key for the invite and what the invite is for, sealed for the owner.
 */
export type StoredPendingInvite = StoredAlbum;

export type CreatePendingInviteRequest = StoredPendingInvite;

export interface PendingInviteList {
  invites: StoredPendingInvite[];
}

/**
 * People: faces found and grouped on the device. What the face models produce is sealed in
 * segments, each a batch of results for many photos, so another device can download them
 * instead of looking at every photo again. People (names, the faces confirmed or turned
 * down) are small owner-only records. Both are owner-only: someone a library is shared with
 * finds faces on their own device and keeps the results in their own space.
 */
export const FACE_SIZES = {
  /** Largest sealed segment, in bytes before base64url. */
  maxSegment: 256 * 1024,
} as const;

/** Most segments one space keeps; the device merges them well before this. */
export const MAX_FACE_SEGMENTS = 400;
/** Most people one space keeps. */
export const MAX_PEOPLE = 1000;
/** Segments per `GET /space/faces` page. */
export const FACE_SEGMENT_PAGE = 16;
/** Most segments one `DELETE /space/faces` removes. */
export const FACE_SEGMENT_DELETE_MAX = 100;

/** A sealed segment of face results. */
export interface StoredFaceSegment {
  id: string;
  data: string;
}

export interface FaceSegmentPage {
  segments: StoredFaceSegment[];
  /** Pass as `after` for the next page; null on the last one. */
  next: string | null;
}

export interface PutFaceSegmentRequest {
  data: string;
}

/** Removes segments merged into a newer one. */
export interface DeleteFaceSegmentsRequest {
  ids: string[];
}

/** A person: their name and faces, sealed for the owner. */
export type StoredPerson = StoredAlbum;

export type PutPersonRequest = UpdateRecordRequest;

export interface PersonList {
  people: StoredPerson[];
}

/**
 * Smart search: what each photo shows, worked out on the device as a vector of numbers and
 * sealed in segments like face results, so another device can download them instead of
 * looking at every photo again. Owner-only, for the same reason as face results.
 */
export const SEARCH_SIZES = {
  /** Largest sealed segment, in bytes before base64url. */
  maxSegment: 256 * 1024,
} as const;

/** Most segments one space keeps; the device merges them well before this. */
export const MAX_SEARCH_SEGMENTS = 400;
/** Segments per `GET /space/search` page. */
export const SEARCH_SEGMENT_PAGE = 16;
/** Most segments one `DELETE /space/search` removes. */
export const SEARCH_SEGMENT_DELETE_MAX = 100;

/** A sealed segment of search vectors. */
export type StoredSearchSegment = StoredFaceSegment;

export type SearchSegmentPage = FaceSegmentPage;

export type PutSearchSegmentRequest = PutFaceSegmentRequest;

/** Removes segments merged into a newer one. */
export type DeleteSearchSegmentsRequest = DeleteFaceSegmentsRequest;

/** Most words one space can teach search. */
export const MAX_WORDS = 200;

/** A word taught to search: its name and the photos that show it, sealed for the owner. */
export type StoredWord = StoredAlbum;

export type PutWordRequest = UpdateRecordRequest;

export interface WordList {
  words: StoredWord[];
}

/** Most smart albums (saved searches) one space keeps. */
export const MAX_SMART_ALBUMS = 100;

/** A smart album: a saved search, sealed for the owner. */
export type StoredSmartAlbum = StoredAlbum;

export type PutSmartAlbumRequest = UpdateRecordRequest;

export interface SmartAlbumList {
  albums: StoredSmartAlbum[];
}
