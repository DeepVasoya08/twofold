"""Writes fixtures/grid/thumbs.json: grid-sized thumbnails (256 px square, JPEG quality 75)
of the web e2e photos as base64, about the size of the previews the app stores for the
timeline. JSON rather than .jpg files: Android release builds turn bundled images into
resources that can't be read back as bytes.
Run from the repo root: python3 apps/mobile-spike/scripts/make_grid_thumbs.py
"""
import base64
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/mobile-spike/fixtures/grid'
SOURCES = sorted((ROOT / 'apps/web/e2e/fixtures/faces').glob('*.jpg')) + [
    ROOT / 'apps/web/e2e/fixtures/dated.jpg'
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    thumbs = []
    for path in SOURCES:
        image = Image.open(path).convert('RGB')
        side = min(image.size)
        left = (image.width - side) // 2
        top = (image.height - side) // 2
        thumb = image.crop((left, top, left + side, top + side)).resize((256, 256), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        thumb.save(out, format='JPEG', quality=75)
        thumbs.append(base64.b64encode(out.getvalue()).decode('ascii'))
    (OUT / 'thumbs.json').write_text(json.dumps(thumbs) + '\n')


if __name__ == '__main__':
    main()
