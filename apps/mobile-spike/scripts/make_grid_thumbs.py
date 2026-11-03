"""Writes fixtures/grid/*.jpg: grid-sized thumbnails (256 px square, JPEG quality 75) of the
web e2e photos, about the size of the previews the app stores for the timeline.
Run from the repo root: python3 apps/mobile-spike/scripts/make_grid_thumbs.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/mobile-spike/fixtures/grid'
SOURCES = sorted((ROOT / 'apps/web/e2e/fixtures/faces').glob('*.jpg')) + [
    ROOT / 'apps/web/e2e/fixtures/dated.jpg'
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for index, path in enumerate(SOURCES):
        image = Image.open(path).convert('RGB')
        side = min(image.size)
        left = (image.width - side) // 2
        top = (image.height - side) // 2
        thumb = image.crop((left, top, left + side, top + side)).resize((256, 256), Image.Resampling.LANCZOS)
        thumb.save(OUT / f'thumb-{index}.jpg', quality=75)


if __name__ == '__main__':
    main()
