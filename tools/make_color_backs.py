"""Generate red/yellow/green/blue card backs from assets/cards/wild_backside.jpg.

The dark background outside the white oval is replaced with the card color
(sampled from the front cards' outer frame). The oval, its gold rim, the logo
text and the gold glow are kept: the glow is screen-blended over the new color.

Usage:  python tools/make_color_backs.py [cards_dir]
Needs:  pip install pillow numpy
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

COLORS = {  # outer-frame colors measured on red5/yellow5/green5/blue5.jpg
    "red": (222, 12, 10),
    "yellow": (224, 175, 6),
    "green": (8, 104, 44),
    "blue": (6, 60, 159),
}
BRIGHT = 150      # luminance above this counts as part of the oval/rim
VIGNETTE = 0.18   # darken the corners a little for depth (0 = flat color)


def outside_mask(img):
    """True where the pixel belongs to the background around the oval."""
    lum = np.asarray(img.convert("L"))
    dark = lum < BRIGHT
    # Flood fill from the image border through dark pixels (geodesic dilation).
    out = np.zeros_like(dark)
    out[0, :] = dark[0, :]; out[-1, :] = dark[-1, :]
    out[:, 0] = dark[:, 0]; out[:, -1] = dark[:, -1]
    while True:
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]; grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]; grown[:, :-1] |= out[:, 1:]
        grown &= dark
        if (grown == out).all():
            break
        out = grown
    # soften the edge a touch so the rim blends in
    soft = Image.fromarray((out * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    return np.asarray(soft).astype(np.float32) / 255.0


def make_back(src, color):
    a = np.asarray(src.convert("RGB")).astype(np.float32) / 255.0
    h, w, _ = a.shape
    border = np.concatenate([a[:10].reshape(-1, 3), a[-10:].reshape(-1, 3)])
    base = np.median(border, axis=0)                       # the original dark background
    glow = np.clip((a - base) / (1 - base), 0, 1)          # light added on top of the dark bg

    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    col = np.array(color, np.float32) / 255.0
    bg = col[None, None, :] * (1 - VIGNETTE * r[..., None] ** 2)

    screened = 1 - (1 - bg) * (1 - glow)                   # screen blend glow over new color
    m = outside_mask(src)[..., None]
    out = screened * m + a * (1 - m)
    return Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8))


def main():
    cards = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "assets" / "cards"
    src = Image.open(cards / "wild_backside.jpg")
    for name, color in COLORS.items():
        dst = cards / f"{name}_backside.jpg"
        make_back(src, color).save(dst, quality=95)
        print("wrote", dst)


if __name__ == "__main__":
    main()
