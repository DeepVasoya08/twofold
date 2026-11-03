/**
 * Runs the spike's fixed model inputs (fixtures/ml/*.bin) through ONNX Runtime Web, the
 * runtime the web app uses, and writes the vectors to fixtures/ml/reference.json. The phone
 * app runs the same inputs through ONNX Runtime mobile and compares.
 * Run from the repo root: node apps/mobile-spike/scripts/make-ml-reference.mjs
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const fixtures = join(here, '../fixtures/ml');
const ort = createRequire(join(root, 'apps/web/package.json'))('onnxruntime-web');
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export const CLIP = {
  base: 'https://arcafold.com/resources/search',
  name: 'photo-eea088f1c6f1',
  size: 88_985_490,
  sha256: '7qCI8cbxi9Po3_-hRxoHE-lydgNB4EjPzsG0-B9xPHE',
  chunk: 24 * 1024 * 1024,
};
const SFACE = {
  path: join(root, 'apps/web/src/lib/people/models/sface-2021dec-w8.onnx'),
  sha256: 'PPdPcIQNYBbO_ZiLBtaIS774lYO6J0Eh_sFZiNF0X0g',
};
const PHOTOS = ['obama', 'harris', 'dated'];

const digest = (bytes) => createHash('sha256').update(bytes).digest('base64url');

async function clipBytes() {
  const cache = join(root, 'node_modules/.cache/mobile-spike/clip-photo.onnx');
  try {
    const cached = await readFile(cache);
    if (digest(cached) === CLIP.sha256) return cached;
  } catch {
    // Not downloaded yet.
  }
  const parts = [];
  for (let i = 0; i * CLIP.chunk < CLIP.size; i++) {
    const response = await fetch(`${CLIP.base}/${CLIP.name}.${String(i)}.bin`);
    if (!response.ok) throw new Error(`Chunk ${String(i)}: HTTP ${String(response.status)}`);
    parts.push(Buffer.from(await response.arrayBuffer()));
  }
  const bytes = Buffer.concat(parts);
  if (digest(bytes) !== CLIP.sha256) throw new Error('CLIP photo model failed its SHA-256 check');
  await mkdir(dirname(cache), { recursive: true });
  await writeFile(cache, bytes);
  return bytes;
}

async function vectors(modelBytes, prefix, side) {
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    extra: { session: { disable_quant_qdq: '1' } },
  });
  const out = {};
  for (const photo of PHOTOS) {
    const raw = await readFile(join(fixtures, `${prefix}-${photo}.bin`));
    const input = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const tensor = new ort.Tensor('float32', input, [1, 3, side, side]);
    const result = await session.run({ [session.inputNames[0]]: tensor });
    out[photo] = Array.from(result[session.outputNames[0]].data);
  }
  return out;
}

const sface = await readFile(SFACE.path);
if (digest(sface) !== SFACE.sha256) throw new Error('SFace failed its SHA-256 check');
const reference = {
  runtime: `onnxruntime-web ${ort.env.versions.web ?? ''}`.trim(),
  clip: await vectors(await clipBytes(), 'clip', 224),
  sface: await vectors(sface, 'sface', 112),
};
await writeFile(join(fixtures, 'reference.json'), `${JSON.stringify(reference)}\n`);
process.stdout.write(`wrote fixtures/ml/reference.json with ${reference.runtime}\n`);
