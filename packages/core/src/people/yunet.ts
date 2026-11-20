/**
 * Face detection with YuNet (OpenCV Zoo, MIT licence): turns the model's raw outputs into
 * face boxes with five landmarks (eyes, nose tip, mouth corners). The model takes a fixed
 * 640×640 BGR image with values 0-255, so a preview is drawn into the top-left corner of
 * that square at a scale that fits, and boxes are scaled back to the preview's pixels.
 * The decoding follows OpenCV's own FaceDetectorYN.
 */

export const YUNET_SIZE = 640;
const STRIDES = [8, 16, 32] as const;
const MIN_SCORE = 0.8;
const NMS_IOU = 0.3;
/** Faces smaller than this many preview pixels across are too blurry to recognise. */
export const MIN_FACE_SIDE = 24;

export interface Point {
  x: number;
  y: number;
}

export interface DetectedFace {
  /** Box in the source image's pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  /** Right eye, left eye (as seen in the photo: left then right), nose, mouth corners. */
  landmarks: [Point, Point, Point, Point, Point];
}

/** The model's outputs by name, each a flat array as ONNX Runtime returns it. */
export type YunetOutputs = Record<string, Float32Array>;

/** How a source image sits in the model's square: scaled by `scale` from the top left. */
export function letterboxScale(width: number, height: number): number {
  return Math.min(YUNET_SIZE / width, YUNET_SIZE / height);
}

/** Packs RGBA pixels of the 640×640 square into the model's planar BGR input. */
export function yunetInput(rgba: ArrayLike<number>): Float32Array {
  const plane = YUNET_SIZE * YUNET_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = rgba[i * 4 + 2] ?? 0;
    input[plane + i] = rgba[i * 4 + 1] ?? 0;
    input[2 * plane + i] = rgba[i * 4] ?? 0;
  }
  return input;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function iou(a: DetectedFace, b: DetectedFace): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

/** Keeps the best of any boxes that overlap a lot. */
export function suppressOverlaps(faces: DetectedFace[], maxIou = NMS_IOU): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const face of sorted) {
    if (kept.every((other) => iou(face, other) <= maxIou)) kept.push(face);
  }
  return kept;
}

/**
 * Decodes the outputs for an image drawn at `scale` (from letterboxScale) and returns faces
 * in the source image's pixels, best first.
 */
export function decodeYunet(outputs: YunetOutputs, scale: number): DetectedFace[] {
  const found: DetectedFace[] = [];
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${String(stride)}`];
    const obj = outputs[`obj_${String(stride)}`];
    const bbox = outputs[`bbox_${String(stride)}`];
    const kps = outputs[`kps_${String(stride)}`];
    if (!cls || !obj || !bbox || !kps) throw new Error('Face model returned unexpected outputs');
    const cols = YUNET_SIZE / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(clamp01(cls[i] ?? 0) * clamp01(obj[i] ?? 0));
      if (score < MIN_SCORE) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const cx = (col + (bbox[i * 4] ?? 0)) * stride;
      const cy = (row + (bbox[i * 4 + 1] ?? 0)) * stride;
      const w = Math.exp(bbox[i * 4 + 2] ?? 0) * stride;
      const h = Math.exp(bbox[i * 4 + 3] ?? 0) * stride;
      const point = (n: number): Point => ({
        x: (((kps[i * 10 + n * 2] ?? 0) + col) * stride) / scale,
        y: (((kps[i * 10 + n * 2 + 1] ?? 0) + row) * stride) / scale,
      });
      found.push({
        x: (cx - w / 2) / scale,
        y: (cy - h / 2) / scale,
        width: w / scale,
        height: h / scale,
        score,
        landmarks: [point(0), point(1), point(2), point(3), point(4)],
      });
    }
  }
  return suppressOverlaps(found).filter(
    (face) => Math.min(face.width, face.height) >= MIN_FACE_SIDE,
  );
}
