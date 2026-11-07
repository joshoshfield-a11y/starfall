# STARFALL — Design Document

Top-down open-world 2D space shooter. Vanilla JS + Canvas 2D, zero dependencies,
touch-first, `localStorage` saves. Ships as an offline Android WebView APK
(`com.dogbyte.starfall`). Reconstructed 2026-10-19 after a tree wipe; the
original lived here 2026-10-18. Later-phase specs: `phases/queue.json` briefs
+ `~/memory/2026-10-18.md` / `~/memory/2026-10-19.md`.

## Global rules
- Item tiers: white → green → blue → purple → orange → gold.
- Everything upgradable has 1–5 star ranks.
- Save schema is versioned (`starfall_save_v1`, `version` field, `migrateVn` in
  `js/save.js` / per-module migrate hooks). Current: **v6** (weapons-arsenal, 2026-10-19).

## Architecture
Single global namespace `SF`, one module per file in `js/`. Game states:
TITLE → PLAYING ⇄ DOCKED, plus overlays (station UI, quest log, dialogue).

| File | Owns |
|---|---|
| `main.js` | game loop, states, camera, system switching, `SF.Game.dockedAt` |
| `ship.js` | player ship, weapons fire, health/shield, `migrateV3` (factions/karma/quests/companions defaults) |
| `enemies.js` | pirates, faction patrols, AI, drops |
| `asteroids.js` / `pickups.js` | mining, ore, loot |
| `station.js` | docking, store, shipyard UI |
| `builder.js` / `parts.js` / `upgrade.js` | drag-and-drop ship builder, 24 parts, star upgrades |
| `crew.js` / `boarding.js` | hireable crew, boarding crippled ships |
| `factions.js` | `SF.Factions`: 3 factions (Solar Compact, Free Drifters, Ember Pact), standing −100…+100, karma −100…+100, `priceMul()` (evil ≤−15 ×1.15, good ≥+15 ×0.95, allied ≥50 ×0.90), `blackMarketMul()` stub for a later phase |
| `quests.js` | `SF.Quests`: quest board (kill/mining/supply/escort, 3 offers per dock, re-rolled each dock), turn-in at the offering station; `SF.Companions`: 6 hireable pilots, wingman combat AI, **cap 2 active, wingmen untargetable** |
| `npcs.js` | `SF.Dialogue` tree runner; `SF.NPCs`: bartender rumors (10cr drink), shipwright, faction recruiter |
| `save.js` | `SF.Save`: save/load/wipe; `load()` persists the save after a version migration |
| `starmap.js` / `hud.js` / `input.js` / `audio.js` / `particles.js` / `projectiles.js` / `data.js` | map, HUD, touch+keys, WebAudio SFX, particles, projectiles, static data |

Quest offers store `station: systemId + ':' + dockedAt`; `turnIn()` checks the
station **before** deducting cargo. The `visibilitychange` handler autosaves
when PLAYING — tests that doctor saves must dock first.

## World
3 systems (Solace, Drift, Ember); Haven Dock station. One station per system is
assumed (`dockedAt = 'Haven Dock'`); multi-station support is a Phase 5 job.

## Build / release
`android/` = WebViewAssetLoader shell (offline, `FLAG_KEEP_SCREEN_ON`,
landscape, minSdk 26, targetSdk 35). `./build.sh` one-shot. Keystore:
second generation (2026-10-19; the 2026-10-18 key died in the wipe) — password
in `android/.keypass` (0600). **Reinstalls require uninstalling the old copy.**
APK v1.4: versionCode 6, 1,267,629 bytes, md5
`74ab7f639e084117fc829d854ed73839`.

## Loop protocol (for builders)
Work ONLY in `~/workspace/starfall/phases/<slug>/` staging. Merge only when no
STARFALL builder runs anywhere AND the sha256 snapshot manifest verifies clean.
Merge with **per-directory copies, NEVER `rsync --delete`** (it deleted
`android/`, `phases/`, `data/` twice on 2026-10-18/19). Re-verify after merge,
then `./build.sh` (require BUILD_OK). Builders never upload APKs.
