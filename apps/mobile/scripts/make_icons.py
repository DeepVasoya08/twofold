"""Draws Arcafold's app icons from the web favicon's shapes (two overlapping circles).

Run from apps/mobile: python3 scripts/make_icons.py
"""

from PIL import Image, ImageChops, ImageDraw

BACKGROUND = (22, 17, 23, 255)  # #161117, the web app's theme colour
LEFT = (226, 112, 123, 255)  # #e2707b
RIGHT = (108, 74, 140, 230)  # #6c4a8c at 0.9
SHINE = (255, 255, 255, 140)  # white at 0.55


def mark(size: int, scale: float, mono: bool = False) -> Image.Image:
    """The two circles and their overlap, `scale` of `size` wide, centred, on transparent."""
    big = size * 4
    unit = big * scale / 28  # the favicon's view box is 28 units wide
    ox = (big - 28 * unit) / 2 - 2 * unit
    oy = (big - 28 * unit) / 2 - 2 * unit

    def circle(cx: float) -> tuple[float, float, float, float]:
        return (ox + (cx - 9) * unit, oy + 7 * unit, ox + (cx + 9) * unit, oy + 25 * unit)

    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    left = Image.new('L', (big, big), 0)
    ImageDraw.Draw(left).ellipse(circle(12), fill=255)
    right = Image.new('L', (big, big), 0)
    ImageDraw.Draw(right).ellipse(circle(20), fill=255)
    if mono:
        out.paste((255, 255, 255, 255), mask=ImageChops.lighter(left, right))
    else:
        out.paste(LEFT, mask=left)
        layer = Image.new('RGBA', (big, big), RIGHT)
        out.alpha_composite(Image.composite(layer, Image.new('RGBA', (big, big)), right))
        shine = Image.new('RGBA', (big, big), SHINE)
        out.alpha_composite(
            Image.composite(shine, Image.new('RGBA', (big, big)), ImageChops.multiply(left, right))
        )
    return out.resize((size, size), Image.LANCZOS)


def on_background(size: int, scale: float) -> Image.Image:
    base = Image.new('RGBA', (size, size), BACKGROUND)
    base.alpha_composite(mark(size, scale))
    return base


on_background(1024, 0.78).convert('RGB').save('assets/icon.png')
on_background(1024, 0.5).convert('RGB').save('assets/splash-icon.png')
# The mark on its own, for the sign-in screens.
mark(288, 1.0).save('assets/logo.png')
# Android adaptive icons: keep the mark inside the middle 66% safe zone.
mark(432, 0.6).save('assets/android-icon-foreground.png')
Image.new('RGBA', (432, 432), BACKGROUND).save('assets/android-icon-background.png')
mark(432, 0.6, mono=True).save('assets/android-icon-monochrome.png')
