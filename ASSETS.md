# STARFALL Asset Manifest — the road to 100MB

User directive (2026-10-19): steer the loop toward real assets. Target: ~100MB installed.
Everything is generated locally with no API keys and no cloud services.

## Budget

| Category | Path | Content | Target |
|---|---|---|---|
| Music | `assets/audio/music/` | 10 tracks, ~4.5 min each, OGG q5 | ~50MB |
| SFX | `assets/audio/sfx/` | ~60 effects, OGG q4 | ~8MB |
| Voice | `assets/audio/voice/` | ~120 campaign barks + station lines, OGG q4 | ~6MB |
| Ship sprites | `assets/sprites/ships/` | 8 ships × PNG-8/WebP, with engine-glow variants | ~8MB |
| Station/planet sprites | `assets/sprites/stations/` | stations, planets, landmarks | ~6MB |
| Backgrounds | `assets/bg/` | 6 high-res nebula/parallax layers, WebP q80 2048px | ~12MB |
| UI | `assets/ui/` | fonts, icons, title art | ~4MB |
| Code growth headroom | — | — | ~6MB |
| **Total** | | | **~100MB** |

Fill order: loader infra → music vol 1 → sfx bank → voice pack 1 → ship sprites →
backgrounds → station/planet sprites → music vol 2 → voice pack 2 → ui.

## Generation pipelines (local only)

All commands run on the sandbox. Builders: use these, do not invent cloud steps.

- **Music**: `python3` + numpy compose (pads, bass, arp, synthesized drum hits;
  deterministic seed per track) → WAV → `ffmpeg -c:a libvorbis -q:a 5` → OGG.
  ~4.5 min at q5 ≈ 4–5MB. Keep scripts at `phases/<slug>/gen/`.
- **SFX**: `sox synth` + numpy → OGG q4. One-shots, <3s each.
- **Voice**: `~/tools/piper/piper --model ~/tools/piper/lessac.onnx`
  (more voices: download other `*.onnx` from rhasspy/piper-voices on GitHub —
  network to github is reachable; bing/edge-tts is NOT). WAV → OGG q4.
  A 3.7s line ≈ 21KB.
- **Sprites**: PIL/numpy pixel art → PNG-8 (`convert -colors 256`) or WebP.
  Power-of-two canvases; ship sprites 256×256 with glow layer.
- **Backgrounds**: numpy fbm noise nebulae → WebP q80, 2048×2048 max.

Python: system `python3` has PIL + numpy. For anything else use
`~/workspace/venvs/ml-stack/bin/python`.

## Loader contract (what the game code must do)

`js/audio.js` (extend, don't rewrite):
- `SF.Audio.playMusic(id)` — streams `assets/audio/music/<id>.ogg` via
  HTMLAudioElement (low memory). Crossfade 1.5s. Per-system track mapping.
- `SF.Audio.sfx(id)` — WebAudio buffer cache from `assets/audio/sfx/<id>.ogg`.
- `SF.Audio.voice(id)` — plays `assets/audio/voice/<id>.ogg`, ducking music.
- **Fallback**: if a file 404s/fails to decode, fall back to the existing
  procedural synth for that sound. The game must never break on missing assets.

Sprites (`js/sprites.js`, new file ok):
- `SF.Sprites.get(kind, id)` → cached `Image` from
  `assets/sprites/<kind>/<id>.png`; returns null on miss → caller keeps its
  canvas-drawn fallback.

Paths are relative (`assets/audio/...`) — the APK serves the tree from
`file:///android_asset/`, and `android/build.sh` bundles `../assets/*`.

## Phase verification (asset phases)

1. Manifest check: every file in the brief exists at its manifest path.
2. Format check: `ffprobe` (audio) / `identify` (images) valid, no errors.
3. Size check: per-file within budget, batch total recorded in REPORT.md.
4. Loader smoke: headless page loads the tree, plays/decodes/draws each new
   asset class at least once, zero console errors. smoke.mjs keeps the
   `--base <dir>` contract.
