/**
 * Model checks: run the same fixed inputs the web runtime ran (fixtures/ml) through ONNX
 * Runtime mobile, compare the vectors with the web's (cosine similarity), and time each run.
 * CLIP's photo half is downloaded from arcafold.com exactly as the web app gets it and checked
 * against the same SHA-256; SFace ships inside the app.
 */
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

import SFACE_MODEL from '../../web/src/lib/people/models/sface-2021dec-w8.onnx';
import clipDated from '../fixtures/ml/clip-dated.bin';
import clipHarris from '../fixtures/ml/clip-harris.bin';
import clipObama from '../fixtures/ml/clip-obama.bin';
import reference from '../fixtures/ml/reference.json';
import sfaceDated from '../fixtures/ml/sface-dated.bin';
import sfaceHarris from '../fixtures/ml/sface-harris.bin';
import sfaceObama from '../fixtures/ml/sface-obama.bin';
import { cosine, median, nextFrame } from './timing';

const CLIP = {
  base: 'https://arcafold.com/resources/search',
  name: 'photo-eea088f1c6f1',
  size: 88_985_490,
  /** SHA-256 (hex) of the whole file; the web app pins the same digest in base64url. */
  sha256: 'eea088f1c6f18bd3e8dfffa1471a0713e972760341e048cfcec1b4f81f713c71',
  chunk: 24 * 1024 * 1024,
};

const PHOTOS = ['obama', 'harris', 'dated'] as const;
type Photo = (typeof PHOTOS)[number];

const INPUTS: Record<'clip' | 'sface', Record<Photo, number>> = {
  clip: { obama: clipObama, harris: clipHarris, dated: clipDated },
  sface: { obama: sfaceObama, harris: sfaceHarris, dated: sfaceDated },
};

export type Provider = 'cpu' | 'xnnpack' | 'nnapi';

export interface ModelReport {
  model: 'clip' | 'sface';
  provider: Provider;
  loadMs: number;
  /** Lowest cosine similarity to the web runtime's vector across the three inputs. */
  minCosine: number;
  /** Median of 10 runs on one input. */
  runMs: number;
  error?: string;
}

async function assetPath(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Asset has no local file');
  return asset.localUri;
}

async function floats(module: number): Promise<Float32Array> {
  const bytes = await new File(await assetPath(module)).bytes();
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/**
 * Downloads CLIP's photo half (about 89 MB, four chunks) into the app's documents folder,
 * unless a copy that passes the SHA-256 check is already there.
 */
export async function ensureClip(onProgress: (done: number) => void): Promise<string> {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create();
  const target = new File(dir, 'clip-photo.onnx');
  if (target.exists && (await target.digest('SHA-256')) === CLIP.sha256) return target.uri;
  if (target.exists) target.delete();
  target.create();
  const handle = target.open();
  try {
    let written = 0;
    for (let i = 0; written < CLIP.size; i++) {
      const response = await fetch(`${CLIP.base}/${CLIP.name}.${String(i)}.bin`);
      if (!response.ok) throw new Error(`Download failed (HTTP ${String(response.status)})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await handle.writeBytes(bytes);
      written += bytes.length;
      onProgress(written / CLIP.size);
    }
  } finally {
    handle.close();
  }
  if ((await target.digest('SHA-256')) !== CLIP.sha256) {
    target.delete();
    throw new Error('Downloaded model failed its SHA-256 check');
  }
  return target.uri;
}

const pathOf = (uri: string) => uri.replace(/^file:\/\//, '');

export async function checkModel(
  model: 'clip' | 'sface',
  modelUri: string,
  provider: Provider,
): Promise<ModelReport> {
  const side = model === 'clip' ? 224 : 112;
  const report: ModelReport = { model, provider, loadMs: 0, minCosine: 0, runMs: 0 };
  try {
    await nextFrame();
    // Loaded on first use, so the other tests still run if the model runtime can't start.
    const { InferenceSession, Tensor } = await import('onnxruntime-react-native');
    const loadStart = Date.now();
    const session = await InferenceSession.create(pathOf(modelUri), {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
    });
    report.loadMs = Date.now() - loadStart;
    const input = session.inputNames[0] ?? '';
    const output = session.outputNames[0] ?? '';
    const run = async (data: Float32Array) => {
      const result = await session.run({
        [input]: new Tensor('float32', data, [1, 3, side, side]),
      });
      const values = result[output].data;
      if (!(values instanceof Float32Array)) throw new Error('Unexpected model output');
      return values;
    };
    let minCosine = 1;
    for (const photo of PHOTOS) {
      const vector = await run(await floats(INPUTS[model][photo]));
      minCosine = Math.min(minCosine, cosine(vector, reference[model][photo]));
    }
    report.minCosine = minCosine;
    const sample = await floats(INPUTS[model].obama);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await run(sample);
      times.push(Date.now() - start);
    }
    report.runMs = median(times);
    await session.release();
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  return report;
}

export function sfaceUri(): Promise<string> {
  return assetPath(SFACE_MODEL);
}
