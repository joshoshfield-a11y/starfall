#!/usr/bin/env python3
"""Batch-process STARFALL v2 sprites: for every raw/media-generation-<name>-*.png
under <root>/<cat>/raw/, produce <root>/<cat>/<name>.png (full size, transparent,
centered) and <name>-512.png.

Modes:
  key   (default) flood-fill keying of the pure-black background, for sprites
        drawn as a subject on black.
  copy  no keying; just trim nothing, resize to -512 alongside the original
        (for full-bleed tiles like biomes).

Usage: processSprites.py <root> <cat> [cat...] [--mode key|copy]
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image

THRESH = 26
SOFT = 40
PAD = 24


def flood_mask(gray):
    w, h = gray.size
    px = gray.load()
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


def key_image(img):
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
                else:
                    a = int(255 * (lum - THRESH) / SOFT)
                    r, g, b, _ = op[x, y]
                    op[x, y] = (r, g, b, min(255, a))
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    side = max(out.size) + PAD * 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2), out)
    return canvas


def name_of(p: Path) -> str:
    n = p.stem  # media-generation-<name>-0-<uuid>
    parts = n.split("-")
    return "-".join(parts[2:-2])  # strip media, generation, -0, -uuid(5 chunks? no)


def extract_name(p: Path) -> str:
    # media-generation-<name>-0-<uuid 5 segments>
    stem = p.stem
    assert stem.startswith("media-generation-"), stem
    rest = stem[len("media-generation-"):]
    segs = rest.split("-")
    # uuid is last 5 segments, preceded by the index segment "0"
    return "-".join(segs[:-6])


def main():
    argv = sys.argv[1:]
    mode = "key"
    if "--mode" in argv:
        i = argv.index("--mode")
        mode = argv[i + 1]
        del argv[i:i + 2]
    root = Path(argv[0])
    cats = argv[1:]
    for cat in cats:
        rawdir = root / cat / "raw"
        outdir = root / cat
        if not rawdir.exists():
            print(f"{cat}: no raw dir, skipped")
            continue
        done = set()
        for src in sorted(rawdir.glob("media-generation-*.png")):
            name = extract_name(src)
            if name in done:
                continue
            done.add(name)
            img = Image.open(src).convert("RGB")
            if mode == "key":
                out = key_image(img)
            else:
                out = img.convert("RGBA")
            full = outdir / f"{name}.png"
            out.save(full)
            small = out.resize((512, 512), Image.LANCZOS)
            small.save(outdir / f"{name}-512.png")
            print(f"{cat}/{name}: ok ({out.size[0]}x{out.size[1]})")
        print(f"{cat}: {len(done)} sprites")


if __name__ == "__main__":
    main()
