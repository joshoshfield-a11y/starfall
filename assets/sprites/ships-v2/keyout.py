#!/usr/bin/env python3
"""Key pure-black backgrounds out of STARFALL ships-v2 raw sprites.

Flood-fills from the image borders through near-black pixels (so dark
interior hull detail is preserved), converts the filled region to
transparency with a soft edge falloff, trims to the ship's bounding box,
and re-centers on a transparent square canvas at native resolution.
Also writes a 512x512 game-size copy alongside each full-size sprite.
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image

RAW = Path(__file__).parent / "raw"
OUT = Path(__file__).parent
THRESH = 26        # pixels at/below this luminance are "background"
SOFT = 40          # falloff range above THRESH for edge alpha
PAD = 24           # transparent padding around the trimmed ship


def flood_mask(alpha_src):
    """Return a boolean mask of pixels reachable from the border through
    near-black pixels (the exterior background)."""
    w, h = alpha_src.size
    px = alpha_src.load()
    seen = bytearray(w * h)
    q = deque()

    def try_push(x, y):
        i = y * w + x
        if not seen[i] and px[x, y] <= THRESH:
            seen[i] = 1
            q.append((x, y))

    for x in range(w):
        try_push(x, 0)
        try_push(x, h - 1)
    for y in range(h):
        try_push(0, y)
        try_push(w - 1, y)
    while q:
        x, y = q.popleft()
        if x > 0:
            try_push(x - 1, y)
        if x < w - 1:
            try_push(x + 1, y)
        if y > 0:
            try_push(x, y - 1)
        if y < h - 1:
            try_push(x, y + 1)
    return seen


def process(src: Path, name: str):
    img = Image.open(src).convert("RGB")
    gray = img.convert("L")
    w, h = gray.size
    mask = flood_mask(gray)
    gp = gray.load()

    out = img.convert("RGBA")
    op = out.load()
    for y in range(h):
        base = y * w
        for x in range(w):
            if mask[base + x]:
                lum = gp[x, y]
                if lum <= THRESH:
                    op[x, y] = (0, 0, 0, 0)
                else:  # soft edge: partially transparent fringe
                    a = int(255 * (lum - THRESH) / SOFT)
                    r, g, b, _ = op[x, y]
                    op[x, y] = (r, g, b, min(255, a))

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    side = max(out.size) + PAD * 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2), out)

    full = OUT / f"{name}.png"
    canvas.save(full)
    small = canvas.resize((512, 512), Image.LANCZOS)
    small_path = OUT / f"{name}-512.png"
    small.save(small_path)
    print(f"{name}: {src.name} -> {full.name} {canvas.size}, {small_path.name} 512x512")


def main():
    jobs = {
        "fighter": "media-generation-fighter-",
        "interceptor": "media-generation-interceptor-",
        "frigate": "media-generation-frigate-",
        "hauler": "media-generation-hauler-",
        "corvette": "media-generation-corvette-",
        "destroyer": "media-generation-destroyer-",
        "battleship": "media-generation-battleship-",
        "carrier": "media-generation-carrier-",
        "mothership": "media-generation-mothership-",
    }
    only = sys.argv[1:] or None
    for name, prefix in jobs.items():
        if only and name not in only:
            continue
        matches = sorted(RAW.glob(prefix + "*.png"))
        if not matches:
            print(f"{name}: NO RAW FILE (skipped)")
            continue
        process(matches[0], name)


if __name__ == "__main__":
    main()
