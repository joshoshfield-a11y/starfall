# STARFALL v2 sprite sets — optimized for the game

The v2 art was generated at print resolution (~1400–2800px PNGs, ~608MB total across
`assets/sprites/ships-v2/`, `fx-v2/`, `celestial-v2/`). Those folders are **masters**:
never edited, never shipped in the APK (`android/build.sh` excludes them).

`tools/optimize-v2-sprites.py` produces the game-ready copies: resized to the size the
game actually draws, quantized to PNG-8 (256 colors, no dither), which takes a typical
sprite from 1–5MB down to 10–30KB. Per-file detail: `tools/v2-sprite-manifest.json`.

## Loader kinds (SF.Sprites.get(kind, id) → assets/sprites/<kind>/<id>.png)

| kind | source masters | box | contents |
|---|---|---|---|
| `factions` | ships-v2/factions/ | 256 | 20 faction ships (Terran/Zeta/Xal'thar/Kra'thul) |
| `celestial/planets` | celestial-v2/planets/ | 256 | 11 planets |
| `celestial/moons` | celestial-v2/moons/ | 256 | 11 moons |
| `celestial/asteroids` | celestial-v2/asteroids/ | 256 | 10 asteroids |
| `celestial/fields` | celestial-v2/fields/ | 256 | 10 fields |
| `celestial/objects` | celestial-v2/objects/ | 256 | 10 space objects |
| `biomes` | celestial-v2/biomes/ | 512 | 11 biome tiles (full-bleed) |
| `fx/projectiles` | fx-v2/projectiles/ | 256 | weapon projectiles |
| `fx/explosions` | fx-v2/explosions/ | 256 | explosion sprites |
| `fx/powerups` | fx-v2/powerups/ | 256 | powerup icons |
| `fx/collectibles` | fx-v2/collectibles/ | 256 | collectibles |
| `fx/turrets` | fx-v2/turrets/ | 256 | turret sprites |
| `fx/mines-drones` | fx-v2/mines-drones/ | 256 | mines and drones |
| `fx/effects` | fx-v2/effects/ | 256 | effects |
| `fx/misc` | fx-v2/misc/ | 256 | misc |
| `fx/stations` | fx-v2/stations/ | 256 | station sprites |

Player ships were already wired separately from `assets/sprites/ships/` (v2 art,
game-size copies); the wiring phases for the sets above are queued in the loop:
v2-faction-ships-wiring, v2-celestial-wiring, v2-fx-wiring.

## Re-running

`python3 tools/optimize-v2-sprites.py` — idempotent, overwrites the optimized copies,
never touches the masters. Re-run after new masters are generated.
