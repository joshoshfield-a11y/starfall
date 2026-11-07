#!/usr/bin/env python3
"""Build labeled contact sheets from processed -512 sprites.

Usage: makeSheets.py <root> <cat> [cat...]
Reads <root>/<cat>/<name>-512.png (skipping raw/), writes <root>/<cat>-sheet.png.
Tiles are composited over a dark blue-grey backdrop so transparency reads well.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE = 256
LABEL_H = 22
BG = (24, 28, 38, 255)


def font(size=15):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def main():
    root = Path(sys.argv[1])
    cats = sys.argv[2:]
    f = font()
    for cat in cats:
        d = root / cat
        files = sorted(p for p in d.glob("*-512.png"))
        if not files:
            print(f"{cat}: none")
            continue
        cols = 5 if len(files) > 8 else max(2, len(files))
        rows = (len(files) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * TILE, rows * (TILE + LABEL_H)), (10, 10, 14, 255))
        dr = ImageDraw.Draw(sheet)
        for i, p in enumerate(files):
            name = p.stem[:-4]
            x = (i % cols) * TILE
            y = (i // cols) * (TILE + LABEL_H)
            tile = Image.new("RGBA", (TILE, TILE), BG)
            img = Image.open(p).convert("RGBA")
            img.thumbnail((TILE - 8, TILE - 8), Image.LANCZOS)
            tile.paste(img, ((TILE - img.width) // 2, (TILE - img.height) // 2), img)
            sheet.paste(tile, (x, y))
            dr.text((x + 6, y + TILE + 4), name, fill=(230, 235, 245), font=f)
        out = root / f"{cat}-sheet.png"
        sheet.save(out)
        print(f"{cat}: {len(files)} sprites -> {out}")


if __name__ == "__main__":
    main()
