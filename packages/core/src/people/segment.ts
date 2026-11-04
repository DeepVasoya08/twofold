/**
 * The bytes of a face segment before it's sealed: for each photo looked at, the faces found
 * in it (none is an answer too, so the photo isn't looked at again). Boxes are fractions of
 * the preview, and each fingerprint is stored as 128 signed bytes and one scale, which keeps
 * cosine similarity within about 0.01 of the original.
 *
 *   header:  "TF" · version (1) · model (1) · photo count (u32)
 *   photo:   id (16 bytes) · face count (u8) · faces
 *   face:    x, y, width, height (u16, of 65535) · score (u8, of 255) · scale (f32) · 128 × i8
 */
import { fromBase64Url, toBase64Url } from '@arcafold/crypto/webcrypto';

import { EMBEDDING_LENGTH } from './vectors';

/** Which models made the results. Results from any other are ignored and redone. */
export const FACE_MODEL = 1;

const VERSION = 1;
const HEADER_BYTES = 8;
const ID_BYTES = 16;
const FACE_BYTES = 8 + 1 + 4 + EMBEDDING_LENGTH;
/** Most faces a photo's entry can hold. */
export const MAX_ENTRY_FACES = 255;

export interface StoredFace {
  /** Box as fractions of the photo's width and height. */
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  /** 128 numbers of length 1. */
  embedding: Float32Array;
}

/** What a photo holds, keyed by the photo's id. */
export type FaceResults = Map<string, StoredFace[]>;

export function entryBytes(faces: number): number {
  return ID_BYTES + 1 + faces * FACE_BYTES;
}

const unit = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 65535);

/** Packs results for many photos. Photos whose id isn't a record id are skipped. */
export function encodeSegment(results: FaceResults): Uint8Array<ArrayBuffer> {
  const entries = [...results].flatMap(([id, faces]) => {
    const bytes = fromBase64Url(id);
    return bytes?.length === ID_BYTES ? [{ bytes, faces: faces.slice(0, MAX_ENTRY_FACES) }] : [];
  });
  const size = entries.reduce((total, entry) => total + entryBytes(entry.faces.length), 0);
  const out = new Uint8Array(HEADER_BYTES + size);
  const view = new DataView(out.buffer);
  out.set([0x54, 0x46, VERSION, FACE_MODEL]);
  view.setUint32(4, entries.length);
  let offset = HEADER_BYTES;
  for (const { bytes, faces } of entries) {
    out.set(bytes, offset);
    out[offset + ID_BYTES] = faces.length;
    offset += ID_BYTES + 1;
    for (const face of faces) {
      view.setUint16(offset, unit(face.x));
      view.setUint16(offset + 2, unit(face.y));
      view.setUint16(offset + 4, unit(face.width));
      view.setUint16(offset + 6, unit(face.height));
      out[offset + 8] = Math.round(Math.min(1, Math.max(0, face.score)) * 255);
      let largest = 0;
      for (const v of face.embedding) largest = Math.max(largest, Math.abs(v));
      const scale = largest > 0 ? largest / 127 : 1;
      view.setFloat32(offset + 9, scale);
      for (let i = 0; i < EMBEDDING_LENGTH; i++) {
        view.setInt8(offset + 13 + i, Math.round((face.embedding[i] ?? 0) / scale));
      }
      offset += FACE_BYTES;
    }
  }
  return out;
}

/**
 * Reads a segment. Returns null for a segment this version can't read, or one made by other
 * models, so its photos are looked at again.
 */
export function decodeSegment(bytes: Uint8Array): FaceResults | null {
  if (bytes.length < HEADER_BYTES || bytes[0] !== 0x54 || bytes[1] !== 0x46) return null;
  if (bytes[2] !== VERSION || bytes[3] !== FACE_MODEL) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4);
  const results: FaceResults = new Map();
  let offset = HEADER_BYTES;
  for (let n = 0; n < count; n++) {
    if (offset + ID_BYTES + 1 > bytes.length) return null;
    const id = toBase64Url(bytes.subarray(offset, offset + ID_BYTES));
    const faceCount = bytes[offset + ID_BYTES] ?? 0;
    offset += ID_BYTES + 1;
    if (offset + faceCount * FACE_BYTES > bytes.length) return null;
    const faces: StoredFace[] = [];
    for (let f = 0; f < faceCount; f++) {
      const scale = view.getFloat32(offset + 9);
      const embedding = new Float32Array(EMBEDDING_LENGTH);
      let sum = 0;
      for (let i = 0; i < EMBEDDING_LENGTH; i++) {
        const v = view.getInt8(offset + 13 + i) * scale;
        embedding[i] = v;
        sum += v * v;
      }
      const length = Math.sqrt(sum);
      if (!(length > 0)) return null;
      for (let i = 0; i < EMBEDDING_LENGTH; i++) embedding[i] = (embedding[i] ?? 0) / length;
      faces.push({
        x: view.getUint16(offset) / 65535,
        y: view.getUint16(offset + 2) / 65535,
        width: view.getUint16(offset + 4) / 65535,
        height: view.getUint16(offset + 6) / 65535,
        score: (bytes[offset + 8] ?? 0) / 255,
        embedding,
      });
      offset += FACE_BYTES;
    }
    results.set(id, faces);
  }
  return offset === bytes.length ? results : null;
}

/** Splits results into groups whose encoded size stays under `maxBytes` each. */
export function splitResults(results: FaceResults, maxBytes: number): FaceResults[] {
  const parts: FaceResults[] = [];
  let current: FaceResults = new Map();
  let size = HEADER_BYTES;
  for (const [id, faces] of results) {
    const bytes = entryBytes(Math.min(faces.length, MAX_ENTRY_FACES));
    if (current.size > 0 && size + bytes > maxBytes) {
      parts.push(current);
      current = new Map();
      size = HEADER_BYTES;
    }
    current.set(id, faces);
    size += bytes;
  }
  if (current.size > 0) parts.push(current);
  return parts;
}
