"""Writes the model inputs the spike app feeds to CLIP and SFace (fixtures/ml/*.bin).

The inputs are fixed tensors, so the phone and the web runtime see exactly the same numbers
and any difference in the output vectors comes from the runtime, not from image decoding.
CLIP: centred square, 224 x 224, normalised RGB planes (as apps/web clip-image.ts).
SFace: centred square, 112 x 112, RGB planes 0..255 (as apps/web sface.ts; not aligned).
Run from the repo root: python3 apps/mobile-spike/scripts/make_ml_inputs.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/mobile-spike/fixtures/ml'
PHOTOS = {
    'obama': ROOT / 'apps/web/e2e/fixtures/faces/obama-1.jpg',
    'harris': ROOT / 'apps/web/e2e/fixtures/faces/harris-1.jpg',
    'dated': ROOT / 'apps/web/e2e/fixtures/dated.jpg',
}
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def square(image: Image.Image, size: int) -> np.ndarray:
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    crop = image.convert('RGB').crop((left, top, left + side, top + side))
    return np.asarray(crop.resize((size, size), Image.Resampling.BICUBIC), dtype=np.float32)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, path in PHOTOS.items():
        image = Image.open(path)
        clip = ((square(image, 224) / 255 - MEAN) / STD).transpose(2, 0, 1)
        (OUT / f'clip-{name}.bin').write_bytes(np.ascontiguousarray(clip, dtype='<f4').tobytes())
        face = square(image, 112).transpose(2, 0, 1)
        (OUT / f'sface-{name}.bin').write_bytes(np.ascontiguousarray(face, dtype='<f4').tobytes())


if __name__ == '__main__':
    main()
