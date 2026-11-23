"""Draws the phone app's small line icons (the password eye and the fingerprint).

The app icon, splash and sign-in artwork come from apps/web/scripts/render-images.mjs, with
the logo's arch shapes.

Run from apps/mobile: python3 scripts/make_icons.py
"""

from PIL import Image, ImageChops, ImageDraw


def eye(size: int, crossed: bool) -> Image.Image:
    """A line-drawn eye (white, tinted in the app), with a slash through it when `crossed`."""
    big = size * 4
    stroke = big // 12

    def lens(inset: float) -> Image.Image:
        # The eye's outline is where two large circles overlap.
        radius = big * 0.62 - inset
        top = Image.new('L', (big, big), 0)
        ImageDraw.Draw(top).ellipse(
            (big / 2 - radius, big * 0.18 + inset, big / 2 + radius, big * 0.18 + inset + 2 * radius),
            fill=255,
        )
        bottom = Image.new('L', (big, big), 0)
        ImageDraw.Draw(bottom).ellipse(
            (big / 2 - radius, big * 0.82 - inset - 2 * radius, big / 2 + radius, big * 0.82 - inset),
            fill=255,
        )
        return ImageChops.multiply(top, bottom)

    shape = ImageChops.subtract(lens(0), lens(stroke))
    r = big * 0.14
    ImageDraw.Draw(shape).ellipse((big / 2 - r, big / 2 - r, big / 2 + r, big / 2 + r), fill=255)
    if crossed:
        line = (big * 0.16, big * 0.12, big * 0.84, big * 0.88)
        ImageDraw.Draw(shape).line(line, fill=0, width=stroke * 3)
        ImageDraw.Draw(shape).line(line, fill=255, width=stroke)
    out = Image.new('RGBA', (big, big), (255, 255, 255, 0))
    out.putalpha(shape)
    return out.resize((size, size), Image.LANCZOS)


def fingerprint(size: int) -> Image.Image:
    """A line-drawn fingerprint (white, tinted in the app): nested rings, each with a break."""
    big = size * 4
    stroke = big // 26
    shape = Image.new('L', (big, big), 0)
    draw = ImageDraw.Draw(shape)
    cx, cy = big / 2, big * 0.52
    # (radius across, start angle, end angle) from the centre out; 0 degrees points right.
    rings = (
        (0.06, 200, 470),
        (0.13, 150, 400),
        (0.20, 190, 470),
        (0.27, 160, 380),
        (0.34, 200, 345),
        (0.41, 215, 325),
    )
    for r, start, end in rings:
        rx, ry = r * big, r * big * 1.12
        draw.arc((cx - rx, cy - ry, cx + rx, cy + ry), start, end, fill=255, width=stroke)
    out = Image.new('RGBA', (big, big), (255, 255, 255, 0))
    out.putalpha(shape)
    return out.resize((size, size), Image.LANCZOS)


eye(96, crossed=False).save('assets/eye.png')
eye(96, crossed=True).save('assets/eye-off.png')
fingerprint(144).save('assets/fingerprint.png')
