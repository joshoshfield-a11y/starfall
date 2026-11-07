#!/usr/bin/env python3
"""Optimize STARFALL v2 sprite masters into game-size PNG-8 sets.

Masters under assets/sprites/{ships-v2,fx-v2,celestial-v2}/ are NEVER modified.
Optimized copies land in loader kinds (SF.Sprites: assets/sprites/<kind>/<id>.png):
  ships-v2/factions/*.png        -> factions/            @256
  celestial-v2/<sub>/*.png       -> celestial/<sub>/     @256  (planets, moons, asteroids, fields, objects)
  celestial-v2/biomes/*.png      -> biomes/              @512
  fx-v2/<sub>/*.png              -> fx/<sub>/            @256
Skips: contact sheets (*-sheet.png), raw*/ source dirs, reference-*.png, _combined/.
Writes tools/v2-sprite-manifest.json with per-file src/dest/size.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.expanduser("~/workspace/starfall/assets/sprites")
JOBS = [
    ("ships-v2/factions", "factions", 256),
    ("celestial-v2/planets", "celestial/planets", 256),
    ("celestial-v2/moons", "celestial/moons", 256),
    ("celestial-v2/asteroids", "celestial/asteroids", 256),
    ("celestial-v2/fields", "celestial/fields", 256),
    ("celestial-v2/objects", "celestial/objects", 256),
    ("celestial-v2/biomes", "biomes", 512),
]
FX_SUBS = ["collectibles", "effects", "explosions", "mines-drones", "misc",
           "powerups", "projectiles", "stations", "turrets"]
for sub in FX_SUBS:
    JOBS.append((f"fx-v2/{sub}", f"fx/{sub}", 256))


def skip(name, parts):
    if name.endswith("-sheet.png") or name.startswith("reference-"):
        return True
    return any(p.startswith("raw") or p == "_combined" for p in parts)


def main():
    manifest = {}
    grand_src = grand_dst = grand_n = 0
    for src_rel, dst_rel, box in JOBS:
        src_dir = os.path.join(ROOT, src_rel)
        dst_dir = os.path.join(ROOT, dst_rel)
        if not os.path.isdir(src_dir):
            print(f"MISSING src {src_rel}")
            continue
        os.makedirs(dst_dir, exist_ok=True)
        n = s_src = s_dst = 0
        for dirpath, dirnames, filenames in os.walk(src_dir):
            rel_parts = os.path.relpath(dirpath, src_dir).split(os.sep)
            dirnames[:] = [d for d in dirnames if not d.startswith("raw") and d != "_combined"]
            for fn in filenames:
                if not fn.endswith(".png") or skip(fn, rel_parts):
                    continue
                sp = os.path.join(dirpath, fn)
                sub = os.path.relpath(dirpath, src_dir)
                dp = os.path.join(dst_dir, fn) if sub == "." else os.path.join(dst_dir, sub, fn)
                os.makedirs(os.path.dirname(dp), exist_ok=True)
                im = Image.open(sp).convert("RGBA")
                im.thumbnail((box, box), Image.LANCZOS)
                q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE,
                                dither=Image.Dither.NONE)
                q.save(dp, "PNG", optimize=True)
                b_src, b_dst = os.path.getsize(sp), os.path.getsize(dp)
                manifest[os.path.relpath(dp, ROOT)] = {
                    "src": os.path.relpath(sp, ROOT), "w": im.width, "h": im.height,
                    "bytes": b_dst, "src_bytes": b_src,
                }
                n += 1
                s_src += b_src
                s_dst += b_dst
        print(f"{dst_rel:28s} {n:4d} files  {s_src/1048576:8.1f} MB -> {s_dst/1024:9.0f} KB")
        grand_n += n
        grand_src += s_src
        grand_dst += s_dst
    out = os.path.expanduser("~/workspace/starfall/tools/v2-sprite-manifest.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"TOTAL {grand_n} files  {grand_src/1048576:.1f} MB -> {grand_dst/1048576:.2f} MB")
    print(f"manifest: {out}")


if __name__ == "__main__":
    sys.exit(main())
