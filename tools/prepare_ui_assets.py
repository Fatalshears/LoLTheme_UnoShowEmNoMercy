"""Copy the icons and pixel effects the game uses out of the local asset packs.

Icons (Free Icon Pack v3.1 Basic) -> assets/ui/<key>.png
Effects (Effect and FX Pixel All Free) -> assets/fx/<key>.png, merged into assets/fx/fx.json.
Each effect sheet is 64x64 frames, one colour per row; we keep only the row we need.
Run tools/prepare_fx.py first (it rewrites fx.json), then this script.

Usage:  python tools/prepare_ui_assets.py [packs_dir]   (default: assets/)
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PACKS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets"
ICONS = PACKS / "Free Icon Pack v3.1 (Basic)"
FXPACK = PACKS / "Effect and FX Pixel All Free" / "Free"

ICON_FILES = {
    "help": "UI/Question Mark/256px/Question Mark 1st Outline 256px.png",
    "chat": "UI/Chat/256w/Chat 1st Outline 256px.png",
    "settings": "Main/Settings/256px/Settings 1 1st 256px.png",
    "close": "UI/Close Button/256px/Close Button 1st 256px.png",
    "trophy": "Item/Trophy/256w/Golden Trophy 1st 256px.png",
    "crown": "Item/Crown/256px/Crown 1st 256px.png",
    "clock": "Item/Clock/256px/Golden Clock 1st 256px.png",
}

# colour rows in every sheet: 0 red, 1 purple, 2 cyan, 3 green, 4 brown, 5 grey, 6 mauve, 7 orange, 8 blue
ROW = {"red": 0, "yellow": 7, "green": 3, "blue": 2, "purple": 1}
EFFECTS = {
    # key: (sheet, colour)
    "swirl_red": ("Part 1/03.png", "red"),
    "swirl_yellow": ("Part 1/03.png", "yellow"),
    "swirl_green": ("Part 1/03.png", "green"),
    "swirl_blue": ("Part 1/03.png", "blue"),
    "starburst": ("Part 9/436.png", "yellow"),
    "rune": ("Part 4/186.png", "yellow"),
}
SIZE = 64


def main():
    ui = ROOT / "assets" / "ui"
    ui.mkdir(parents=True, exist_ok=True)
    for key, rel in ICON_FILES.items():
        Image.open(ICONS / rel).convert("RGBA").resize((128, 128), Image.LANCZOS).save(ui / f"{key}.png", optimize=True)

    fxdir = ROOT / "assets" / "fx"
    meta = json.loads((fxdir / "fx.json").read_text())
    for key, (sheet, colour) in EFFECTS.items():
        im = Image.open(FXPACK / sheet).convert("RGBA")
        n = im.width // SIZE
        y = ROW[colour] * SIZE
        row = im.crop((0, y, n * SIZE, y + SIZE))
        # drop trailing empty frames
        while n > 1 and row.crop(((n - 1) * SIZE, 0, n * SIZE, SIZE)).getbbox() is None:
            n -= 1
        row.crop((0, 0, n * SIZE, SIZE)).save(fxdir / f"{key}.png", optimize=True)
        meta["fx"][key] = {"src": f"{key}.png", "frames": [[i * SIZE, 0, SIZE, SIZE] for i in range(n)]}
    meta["credit2"] = "Effect and FX Pixel (Free)"
    (fxdir / "fx.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {len(ICON_FILES)} icons to {ui} and {len(EFFECTS)} effects to {fxdir}")


if __name__ == "__main__":
    main()
