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


def backdrop(width: int, height: int) -> Image.Image:
    """Soft glows in the mark's two colours, for the top of the sign-in screens."""
    from PIL import ImageFilter

    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for colour, centre, radius in (
        ((226, 112, 123, 150), (width * 0.22, height * 0.28), width * 0.42),
        ((108, 74, 140, 170), (width * 0.8, height * 0.22), width * 0.46),
    ):
        layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        x, y = centre
        ImageDraw.Draw(layer).ellipse((x - radius, y - radius, x + radius, y + radius), fill=colour)
        out.alpha_composite(layer.filter(ImageFilter.GaussianBlur(width * 0.12)))
    # Fade out towards the bottom so it melts into the background.
    fade = Image.linear_gradient('L').resize((width, height)).point(lambda v: 255 - v)
    alpha = ImageChops.multiply(out.getchannel('A'), fade)
    out.putalpha(alpha)
    return out


eye(96, crossed=False).save('assets/eye.png')
eye(96, crossed=True).save('assets/eye-off.png')
backdrop(720, 640).save('assets/backdrop.png', optimize=True)
