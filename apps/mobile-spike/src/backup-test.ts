import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, AssetField, MediaType, Query, requestPermissionsAsync } from 'expo-media-library';
import type { AssetMetadata } from 'expo-media-library';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { logIn, spaceOf } from '@arcafold/core/account';
import { api } from '@arcafold/core/api';
import { FormError } from '@arcafold/core/errors';
import { photoTypeOf } from '@arcafold/core/file-types';
import { remoteStore } from '@arcafold/core/library/space-store';
import type { NewPhoto, SpaceStore } from '@arcafold/core/library/space-store';
import { Uploader } from '@arcafold/core/upload/uploader';

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
  const session = await logIn(email, password).catch(async (error: unknown) => {
    // A password that signs in but opens no space still left a session on the server.
    await api.logOut().catch(() => undefined);
    throw error;
  });
  return {
    ms: Date.now() - started,
    store: remoteStore(session.opened.space),
    email,
    space: spaceOf(session.opened),
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

/** A gallery photo waiting in the upload queue; only read once its turn comes. */
interface GalleryPhoto {
  name: string;
  type: string;
  /** Unknown until read, so the queue's byte limit doesn't hold it back. */
  size: number;
  asset: AssetMetadata;
}

async function readPhoto({ name, asset }: GalleryPhoto): Promise<NewPhoto> {
  const type = photoTypeOf({ type: '', name });
  if (!type) throw new FormError(`skipped a .${name.split('.').pop() ?? '?'} file`);
  const uri = await new Asset(asset.id).getUri();
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  return {
    thumb: await thumbnail(uri, width, height),
    full: await new File(uri).bytes(),
    type,
    width,
    height,
    takenAt: new Date(asset.creationTime ?? asset.modificationTime ?? Date.now()).toISOString(),
  };
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
  const noteError = (error: unknown) => {
    if (errors.length < 5) errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  };
  let bytes = 0;
  const finished = new Set<number>();

  // The same queue the web app uses: three at a time, promises only, no timers.
  const uploader = new Uploader<GalleryPhoto>({
    prepare: (photo) => readPhoto(photo).catch(noteError),
    upload: (photo, albumId, onStage) =>
      signedIn.store.add(photo, albumId ? [albumId] : [], onStage).catch(noteError),
    onStored: (photos) => {
      for (const photo of photos) {
        ids.push(photo.id);
        bytes += photo.size ?? 0;
      }
    },
    // Nothing is shown, so no previews are made.
    preview: { make: () => '', revoke: () => undefined },
  });
  // Open, so finished photos stay listed until the run is over.
  uploader.openDialog();

  try {
    await new Promise<void>((resolve) => {
      const check = () => {
        const items = uploader.getState().items;
        let done = 0;
        let failed = 0;
        for (const item of items) {
          if (item.status !== 'done' && item.status !== 'failed') continue;
          if (item.status === 'done') done++;
          else failed++;
          if (!finished.has(item.id)) {
            finished.add(item.id);
            finishedAt.push(Date.now());
          }
        }
        onProgress({ done, failed, total });
        BackupService.show(
          `${String(done)} of ${String(total)}${failed ? `, ${String(failed)} failed` : ''}`,
          done + failed,
          total,
        );
        // Stored photos are handed over once the queue runs dry, after the last one finishes.
        if (done + failed === total && ids.length === done) resolve();
      };
      uploader.subscribe(check);
      uploader.add(
        assets.map((asset) => ({ name: asset.filename ?? '', type: '', size: 0, asset })),
        undefined,
      );
      check();
    });
  } finally {
    uploader.dispose();
    watch.remove();
    BackupService.stop();
  }
  const end = Date.now();
  spans.push({ state, from: since, to: end });
  return {
    total,
    uploaded: ids.length,
    failed: total - ids.length,
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
