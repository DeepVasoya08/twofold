/**
 * Tells photos of documents (receipts, ID cards, paper, screenshots, notes) from everyday
 * photos, by comparing a photo's search vector with descriptions of each (look-prompts.ts).
 * It only reads the vectors Smart search has already worked out on this device: nothing new
 * is downloaded, and nothing is sent anywhere.
 *
 * The descriptions compete, as CLIP is used to sort pictures: the photo's similarity to each
 * one, scaled by CLIP's own factor of 100, becomes a share of 1 (softmax). A photo is a
 * document photo when the document descriptions take at least DOCUMENT_SHARE of it. Tuned on
 * 300 everyday photos, 200 street photos full of signs and 240 receipts, forms, scans and
 * screenshots (scripts/document-looks/README.md).
 */
import { fromBase64Url } from '@arcafold/crypto/webcrypto';

import { PACKED_BYTES, unpackVector } from '@arcafold/core/search/segment';
import type { SearchResults } from '@arcafold/core/search/segment';
import type { Category } from '@arcafold/core/file-categories';
import { LOOK_PROMPTS, LOOK_VECTORS } from './look-prompts';

/** What a picture looks like. Everything but 'photo' is a kind of document. */
export type Look = 'receipt' | 'id' | 'paper' | 'screen' | 'notes' | 'photo';

/** A document photo's look, or null for an everyday photo. */
export type DocumentLook = Exclude<Look, 'photo'>;

/** CLIP's own scale for similarities before they're compared (its logit scale). */
export const LOOK_SCALE = 100;
/** How much of the share document descriptions need for a document photo. */
export const DOCUMENT_SHARE = 0.8;

/** The category a document photo's look belongs in, where there is one. */
const LOOK_CATEGORIES: Partial<Record<DocumentLook, Category>> = {
  receipt: 'receipts',
  id: 'ids',
  notes: 'notes',
};

export function lookCategory(look: DocumentLook): Category | null {
  return LOOK_CATEGORIES[look] ?? null;
}

export interface LookPrompt {
  look: Look;
  vector: Float32Array;
}

/** The shipped descriptions with their vectors. */
export function lookPrompts(): LookPrompt[] {
  const bytes = fromBase64Url(LOOK_VECTORS);
  if (bytes?.length !== LOOK_PROMPTS.length * PACKED_BYTES) {
    throw new Error('The document descriptions don’t match their vectors.');
  }
  return LOOK_PROMPTS.map(({ look }, index) => {
    const vector = unpackVector(bytes.subarray(index * PACKED_BYTES, (index + 1) * PACKED_BYTES));
    if (!vector) throw new Error('A document description’s vector is broken.');
    return { look, vector };
  });
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** What a photo with search vector `vector` looks like: a document's look, or null. */
export function documentLook(
  vector: Float32Array,
  prompts: readonly LookPrompt[],
): DocumentLook | null {
  const scores = prompts.map((prompt) => LOOK_SCALE * dot(vector, prompt.vector));
  const top = Math.max(...scores);
  let total = 0;
  let documents = 0;
  let best: DocumentLook | null = null;
  let bestScore = -Infinity;
  for (const [index, prompt] of prompts.entries()) {
    const score = scores[index] ?? -Infinity;
    const share = Math.exp(score - top);
    total += share;
    if (prompt.look === 'photo') continue;
    documents += share;
    if (score > bestScore) {
      best = prompt.look;
      bestScore = score;
    }
  }
  return total > 0 && documents / total >= DOCUMENT_SHARE ? best : null;
}

/**
 * The look of everything in `results` that looks like a document. `known` keeps looks
 * already worked out, by id, so each vector is only compared once.
 */
export function documentLooks(
  results: SearchResults,
  prompts: readonly LookPrompt[],
  known = new Map<string, DocumentLook | null>(),
): Map<string, DocumentLook> {
  const found = new Map<string, DocumentLook>();
  for (const [id, vector] of results) {
    let look = known.get(id);
    if (look === undefined) {
      look = vector ? documentLook(vector, prompts) : null;
      known.set(id, look);
    }
    if (look) found.set(id, look);
  }
  return found;
}
