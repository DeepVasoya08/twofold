import * as crypto from '@arcafold/crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, AssetField, MediaType, Query, requestPermissionsAsync } from 'expo-media-library';
import type { AssetMetadata } from 'expo-media-library';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { api } from '@arcafold/core/api';
import { photoTypeOf } from '@arcafold/core/file-types';
import { remoteStore } from '@arcafold/core/library/space-store';
import type { SpaceStore } from '@arcafold/core/library/space-store';

import { BackupService } from '../modules/backup-service';
import { eachLimited, finishedInBackground, longestGap } from './backup-meta';
import type { StateSpan } from './backup-meta';
import { fromBase64 } from './encoding';

/**
 * Phase 0's background backup test: signs in to a real (throwaway) Arcafold account,
 * then encrypts and uploads the newest gallery photos exactly as the web app stores them,
 * three at a time, inside an Android foreground service. It records what the app's state
 * was as each photo finished, to show whether work carries on with the app in the
 * background or the screen off.
 */

const THUMB_MAX_SIDE = 640;
const THUMB_QUALITY = 0.82;
const PARALLEL = 3;

export interface SignedIn {
  /** How long signing in took, Argon2id included. */
  ms: number;
  /** The signed-in library, through the same store the web app uses. */
  store: SpaceStore;
  email: string;
  space: 'main' | 'private';
}

export async function signIn(email: string, password: string): Promise<SignedIn> {
  const started = Date.now();
  const params = await api.preLogin({ email });
  const secret = await crypto.deriveFromPassword(password, params.salt, params.kdf);
  const account = await api.logIn({ email, loginKey: crypto.toBase64Url(secret.loginKey) });
  const opened = await crypto.openKeyring(account.keyring, secret);
  if (!opened) {
    await api.logOut().catch(() => undefined);
    throw new Error('That email and password don’t match.');
  }
  const access = await crypto.ownerAccess(opened.space);
  return {
    ms: Date.now() - started,
    store: remoteStore(access),
    email,
    space: opened.slot === crypto.SLOT.private ? 'private' : 'main',
  };
}

export interface BackupProgress {
  done: number;
  failed: number;
  total: number;
}

export interface BackupReport {
  total: number;
  uploaded: number;
  failed: number;
  errors: string[];
  megabytes: number;
  seconds: number;
  perPhotoMs: number;
  inBackground: number;
  longestGapMs: number;
  spans: StateSpan[];
  ignoresBatteryOptimizations: boolean;
  /** Ids uploaded, so the test can remove them again. */
  ids: string[];
}

async function askPermissions(): Promise<void> {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    // Without it the service still runs, but its notification is hidden.
    await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
  }
  const media = await requestPermissionsAsync(false, ['photo']);
  if (!media.granted) throw new Error('Arcafold Spike needs access to your photos to test this.');
}

function newestPhotos(count: number): Promise<AssetMetadata[]> {
  return new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(count)
    .exeForMetadata();
}

/** A JPEG thumbnail, made from the gallery file; its temporary file is removed at once. */
async function thumbnail(
  uri: string,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(width, height, 1));
  const context = ImageManipulator.manipulate(uri);
  if (scale < 1) {
    context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    compress: THUMB_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  image.release();
  context.release();
  try {
    new File(saved.uri).delete();
  } catch {
    // Already gone.
  }
  if (!saved.base64) throw new Error('No thumbnail data');
  return fromBase64(saved.base64);
}

async function uploadOne(
  signedIn: SignedIn,
  asset: AssetMetadata,
): Promise<{ id: string; bytes: number }> {
  const filename = asset.filename ?? '';
  const type = photoTypeOf({ type: '', name: filename });
  if (!type) throw new Error(`skipped a .${filename.split('.').pop() ?? '?'} file`);
  const uri = await new Asset(asset.id).getUri();
  const original = await new File(uri).bytes();
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const thumbPlain = await thumbnail(uri, width, height);

  const stored = await signedIn.store.add(
    {
      thumb: thumbPlain,
      full: original,
      type,
      width,
      height,
      takenAt: new Date(asset.creationTime ?? asset.modificationTime ?? Date.now()).toISOString(),
    },
    [],
  );
  return { id: stored.id, bytes: stored.size ?? 0 };
}

export async function runBackup(
  signedIn: SignedIn,
  count: number,
  onProgress: (progress: BackupProgress) => void,
): Promise<BackupReport> {
  await askPermissions();
  const assets = await newestPhotos(count);
  const total = assets.length;
  BackupService.show(`0 of ${String(total)}`, 0, total);

  const start = Date.now();
  const spans: StateSpan[] = [];
  let state: string = AppState.currentState ?? 'unknown';
  let since = start;
  const watch = AppState.addEventListener('change', (next) => {
    const now = Date.now();
    spans.push({ state, from: since, to: now });
    state = next;
    since = now;
  });

  const finishedAt: number[] = [];
  const ids: string[] = [];
  const errors: string[] = [];
  let bytes = 0;
  let failed = 0;
  const report = () => {
    const done = ids.length;
    onProgress({ done, failed, total });
    BackupService.show(
      `${String(done)} of ${String(total)}${failed ? `, ${String(failed)} failed` : ''}`,
      done + failed,
      total,
    );
  };

  try {
    await eachLimited(assets, PARALLEL, async (asset) => {
      try {
        const stored = await uploadOne(signedIn, asset);
        ids.push(stored.id);
        bytes += stored.bytes;
      } catch (error) {
        failed++;
        if (errors.length < 5) errors.push(error instanceof Error ? error.message : String(error));
      }
      finishedAt.push(Date.now());
      report();
    });
  } finally {
    watch.remove();
    BackupService.stop();
  }
  const end = Date.now();
  spans.push({ state, from: since, to: end });
  return {
    total,
    uploaded: ids.length,
    failed,
    errors,
    megabytes: bytes / 1e6,
    seconds: Math.round((end - start) / 1000),
    perPhotoMs: total ? Math.round((end - start) / total) : 0,
    inBackground: finishedInBackground(finishedAt, spans),
    longestGapMs: longestGap(start, finishedAt),
    spans,
    ignoresBatteryOptimizations: BackupService.ignoresBatteryOptimizations(),
    ids,
  };
}

/** Removes the photos a test uploaded, for good. */
export async function removeUploads(signedIn: SignedIn, ids: readonly string[]): Promise<number> {
  let removed = 0;
  await eachLimited(ids, PARALLEL, async (id) => {
    await signedIn.store.remove(id).catch(() => undefined);
    removed++;
  });
  return removed;
}

/** Signs this device out of the test account. */
export function signOut(): Promise<void> {
  return api.logOut();
}
