import * as SecureStore from 'expo-secure-store';

import type { UploadOnly } from '@arcafold/core/upload/upload-only';

/**
 * What automatic backup keeps on this phone: its upload-only token and the upload key's
 * public half (which add photos to the main library but open nothing), and the id of the
 * last photo it dealt with. Kept by expo-secure-store, like the session. There's only ever
 * one, for the main library, so nothing here differs with or without a private space.
 */
export interface BackupState extends UploadOnly {
  /** MediaStore id of the last photo backed up or skipped; later ones are new. */
  lastId: number;
  /** Whether it may back up over mobile data, not only Wi-Fi. Off unless turned on. */
  mobileData: boolean;
}

const KEY = 'arcafold.backup';

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

/** Reads a kept backup state, or null if it's missing or malformed. */
export function parseBackupState(text: string | null): BackupState | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { v, token, tokenId, publicKey, lastId, mobileData } = value as Record<string, unknown>;
  if (v !== 1 || !isText(token) || !isText(tokenId) || !isText(publicKey)) return null;
  if (typeof lastId !== 'number' || !Number.isSafeInteger(lastId) || lastId < 0) return null;
  return { token, tokenId, publicKey, lastId, mobileData: mobileData === true };
}

export function encodeBackupState(state: BackupState): string {
  const { token, tokenId, publicKey, lastId, mobileData } = state;
  return JSON.stringify({ v: 1, token, tokenId, publicKey, lastId, mobileData });
}

export async function keptBackup(): Promise<BackupState | null> {
  return parseBackupState(await SecureStore.getItemAsync(KEY).catch(() => null));
}

export async function keepBackup(state: BackupState | null): Promise<void> {
  if (state) await SecureStore.setItemAsync(KEY, encodeBackupState(state));
  else await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
