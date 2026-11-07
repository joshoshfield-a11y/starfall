#!/usr/bin/env python3
"""Device-path regression check for the STARFALL APK.

The Android shell serves the game via WebViewAssetLoader:
  page URL  = https://<host>/assets/index.html
  handlers  = "/assets/assets/" (registered first), then "/assets/"
A request path is resolved by stripping the first matching prefix; the
remainder must be a real asset path inside the APK (zip entries under
"assets/"). Game loaders request repo-relative paths like
"assets/sprites/ships/fighter.png", which resolve against the page dir
to "/assets/assets/sprites/ships/fighter.png".

This check walks every file the loaders can request (repo assets/ tree
plus index.html, css/, js/) and asserts each one resolves to an asset
that exists in the built APK. Run after every build.sh.
Usage: python3 tools/check-apk-asset-paths.py [path-to-apk]
Exit 0 = all resolve, 1 = failures (printed).
"""
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
APK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "android", "starfall.apk")
HANDLERS = ["/assets/assets/", "/assets/"]  # registration order in MainActivity.java


def apk_assets(apk):
    out = subprocess.run(["unzip", "-l", apk], capture_output=True, text=True).stdout
    assets = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[3].startswith("assets/"):
            assets.add(parts[3][len("assets/"):])
    return assets


def resolve(request_path):
    for prefix in HANDLERS:
        if request_path.startswith(prefix):
            return request_path[len(prefix):]
    return None


def main():
    assets = apk_assets(APK)
    if not assets:
        print("FAIL: no assets found in", APK)
        return 1
    failures = []
    checked = 0
    # Every loader-requestable file: repo-relative path from index.html.
    candidates = ["index.html"]
    for sub in ("assets", "css", "js"):
        base = os.path.join(ROOT, sub)
        for dirpath, _dirs, files in os.walk(base):
            for f in files:
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
                candidates.append(rel.replace(os.sep, "/"))
    for rel in candidates:
        if "/raw" in rel or rel.endswith(".py") or "-v2/" in rel:
            continue  # masters/tooling are excluded from the APK by design
        request = "/assets/" + rel  # page dir is /assets/
        resolved = resolve(request)
        checked += 1
        if resolved is None or resolved not in assets:
            failures.append((rel, resolved))
    print(f"checked {checked} loader paths against {APK}")
    if failures:
        print(f"FAIL: {len(failures)} paths do not resolve to APK assets:")
        for rel, resolved in failures[:20]:
            print(f"  {rel} -> {resolved!r}")
        return 1
    print("OK: every loader path resolves to a real APK asset")
    return 0


if __name__ == "__main__":
    sys.exit(main())
