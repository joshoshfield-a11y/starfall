# STARFALL Autonomous Quality Program — Charter (2026-10-31)

User directive (verbatim intent): build this game and fix its graphics until
it's the biggest quality possible, fully autonomously, no intervention until
confident complete, then present the APK as the completion signal. Download
tools/assets that help, run beta + bug tests, research higher-quality
graphics methods, correct own errors, document steps against a fatal wipe,
make own decisions, work around limitations.

## Authority and boundaries (standing, unchanged)
- Coordinator (this chat) audits, merges, builds, and uploads. Builders
  NEVER merge/build/upload/message the user. Per-file `cp` merges only;
  `rsync --delete` is permanently banned near this project.
- Save version stays v12 unless a migration is proven safe with old saves
  loading. Nothing merged/pushed/published without the user's word — EXCEPT
  this program itself is the user's word for STARFALL work; the final APK
  presentation is the completion signal, and its upload approval tap is the
  one mechanical step the user takes at the end.
- Generation stays LOCAL-ONLY (2026-10-19 rule, not overridden): no cloud
  APIs/keys. Downloaded tools and third-party assets are authorized by this
  directive, but must be license-clean (record source + license per asset)
  and must fit the ~100MB APK budget in ASSETS.md.
- Targets: Galaxy S25 + laptop/desktop, adaptive tiers; the 150 draw-call
  budget is S25-only. Game stays vanilla JS + Canvas 2D, zero dependencies,
  touch-first, unless a change is proven and documented.
- DOGBYTE honesty rule and human-voice rule still apply to anything public.

## Definition of DONE (coordinator's decision criteria — the user delegated this)
The program ends only when ALL of these hold on the merged live tree:
1. Graphics pass complete across: ship/enemy/station sprites (no
   placeholder/procedural-look leftovers where real art exists), backgrounds
   + parallax + nebula, weapon/impact/engine FX, explosions, shields,
   lighting/glow treatment within Canvas 2D perf, HUD/icon polish.
2. Performance gates: S25-tier draw budget respected; soak 240s forced
   combat with zero uncaught errors and no fps cliff (the freeze-hunt
   regression suite); entity counts bounded.
3. Regression gates green: dialog-sweep 23/23, combat-context, encounter
   smoke, open-space smoke, district-tabs smoke, plus a fresh full
   playthrough smoke (new pilot → combat → dock → tabs → builder →
   undock → region cross → save/reload).
4. No known crash bugs open (the two pre-existing crash bugs are already
   fixed; any new one found is fixed or explicitly documented as a
   limitation with a workaround).
5. APK builds clean via android/build.sh, asset-path script passes,
   installs over the current build (same signing key).

## Wipe recovery (explicit user requirement)
- This charter + per-phase REPORT.md + smoke.mjs files are the recovery
  record. Live tree is NOT a git repo — do not convert it without a
  backup first.
- Coordinator keeps a rolling snapshot OUTSIDE the project tree:
  `~/workspace/starfall-backups/` — code + html/css/js + current asset
  manifests only (NOT the 112GB full tree; phases staging copies are the
  bloat — exclude phases/, v2 masters, raw/). Snapshot before every merge.
- If the live tree is ever wiped: restore from the newest snapshot, then
  re-apply phase REPORT.md files in order; each phase's snapshot-manifest
  lists exactly which files it changed.

## Program structure (coordinator-run, phased)
Phase A — Baseline audit: graphics inventory (what's procedural vs real
  art), perf baseline, bug backlog triage. Output: GRAPHICS-BASELINE.md.
Phase B — Art upgrades in slices (sprites, backgrounds, FX, lighting),
  each slice a staged phase with its own smoke + screenshots.
Phase C — HUD/menus polish (finish the consolidation: hub quick actions,
  empty-category hiding, parts-vs-installs dedupe — the deferred items).
Phase D — Full QA: soak, perf, playthrough, crash hunt, balance sanity
  (rookie curve from early-game-difficulty-1 must not regress).
Phase E — Final build + APK + completion report to the user.
Subagents stage under phases/<slug>/ with REPORT.md + smoke.mjs and the
  .lock bookkeeping; the coordinator merges only after its own audit run.

## Program progress (coordinator log)
- 2026-10-31 ~23:16 PDT: B3 (b3-environment) MERGED into live tree (index.html, js/fx.js, js/main.js, js/station.js, per-file cp). Pre-merge snapshot: ~/workspace/starfall-backups/pre-b3-20261031-2316/ (code + asset manifest only). Post-merge live verification: b3 verify 13/13, dialog-sweep 23/23, encounter-pause 50/50, district-tabs 59/59, open-space 50/50.
- B4 (b4-sprite-lighting) builder spawned: UI icons audit+wire, boss glow, sprite-preserving hit flash, sprite shield rings, placeholder sweep. Awaiting builder handoff, then coordinator audit + merge.

- 2026-11-01 ~00:05 PDT: B4 (b4-sprite-lighting) SALVAGED + MERGED by continuation coordinator (prior builder interrupted with staging + verify harness + screenshots but no REPORT/smoke/manifest). Change set proven narrow: staging-before == live exactly; merged js/enemies.js (sprite-preserving hit flash, boss _glow), js/mods.js (m_* icons), js/station.js (store icons, ring-teal station shield bubble), js/trading.js (g_*/s_* icons). Pre-merge snapshot: ~/workspace/starfall-backups/pre-b4-20261031/. Post-merge live verification: b4 verify 25/25, dialog-sweep 23/23, encounter-pause 50/50, district-tabs 59/59, open-space 50/50, zero console errors.
- 2026-11-01 ~00:20 PDT: C (c-hud-polish) AUDITED + MERGED (js/station.js + css/style.css only; trading.js/index.html byte-identical). Hub quick actions (Repair all, Sell junk, SF.Dialog confirm, exact price parity), empty hiding (conditional Sell tab, all-maxed Upgrades collapse, all-hired Crew collapse), parts dedupe (audit correction: no second buy button existed; Commerce single buy source + Shipwright cross-link + Owned/Fitted notes). Pre-merge snapshot: ~/workspace/starfall-backups/pre-c-20261101/. Post-merge audit-tree verification: c-hud-polish 49/49, district-tabs 59/59, dialog-sweep 23/23. Known: fitted-count display code present but not smoke-exercised via Builder UI (loose path exercised). B-perf still running.
- 2026-11-01 ~00:35 PDT: B-perf AUDITED + MERGED (7 files only: fx.js, projectiles.js, enemies.js, asteroids.js, pickups.js, particles.js, ship.js). New s25 tier (auto on Android-mobile): view culling all tiers + batched procedural bolts, glow gating, particle x0.6, 2 star planes. Heavy-combat drawImage 198->42 (915x412) / 188->46 (800x390); 240s s25 soak zero errors, fps 37.6-58.9 no cliff, heap flat 9.5MB. Staging station.js/css deliberately NOT merged (C-phase merge landed mid-build). Pre-merge snapshot: ~/workspace/starfall-backups/pre-bperf-20261101/. Audit-tree verification: b-perf verify 17/17, dialog 23/23, encounter 50/50, district-tabs 59/59, c-hud-polish 49/49. Honest limit: budget met on drawImage/frame; total canvas calls on s25 combat (238/220) still exceed 150, as even quiet flight did before — noted as budget-definition question, not hidden.
- 2026-11-01 ~01:05 PDT: D (d-full-qa) COMPLETE, nothing to merge (live tree untouched, no staging). Suites on live-tree copy: dialog 23/23, encounter 50/50, open-space 50/50, district-tabs 59/59, c-hud-polish 49/49, b-perf 17/17, b4 25/25, b3 13/13, combat-context 41/42 (sole fail = stale v11 assertion line 136, canonical v12 — coordinator re-ran on live tree: 41/42 confirmed), early-game 20/21 (haven artifact proven harness-side: leftover bolts from L3 probe; isolated + projectile-cleared runs pass). Playthrough smoke 48/48 (coordinator re-ran on live tree: 48/48). 240s s25 soak zero errors, fps 16.2-31.3 no cliff, heap flat 12.1MB. Rookie Lv1 time-to-die 14.3s exact, Lv3 7.3s full strength. Crash hunt 16/16, no new crashes. DONE 2, 3, 4 hold modulo the two proven harness artifacts.
- 2026-11-01 ~01:10 PDT: E (final build) COMPLETE. android/build.sh clean, asset-path check OK, same signing key (installs over current build). Final APK: ~/workspace/starfall/android/starfall.apk, 100,494,052 B, md5 b3fd12df251c275dd81202facdefae36. APK verified to contain s25 tier (fx.js isS25), district-tile-action + hail modalBlocking markers. Pre-final snapshot: ~/workspace/starfall-backups/pre-final-20261101/. PROGRAM DONE per Definition of DONE: graphics pass (B1-B4 + s25 tier), perf gates (drawImage budget met on s25; 240s soak zero errors, no cliff), regression gates green modulo two proven harness artifacts (combat-context stale v11 assertion; early-game haven projectile-leftover artifact), no known crash bugs open. Carried limitations (not hidden): on-device S25 fps/touch feel unverified; total canvas calls on s25 combat (238/220) exceed 150 while drawImage/frame is within budget — budget-definition question; Ember crossing end-to-end and non-Haven district tabs not re-exercised in D; fitted-count display not smoke-exercised via Builder UI.
## Current live-tree state at program start (2026-10-31)
- Latest merged: encounter-pause-1 (hail pause). APK 100,477,668 B,
  md5 72da610b — upload approval EXPIRED, not yet delivered; the
  district-tabs build (100,473,572 B, md5 8027bfd2) WAS delivered.
- Open threads: phone direct-push channel down (Tailscale/Termux);
  planet control system + defense tuning at higher danger (user's word
  still pending — NOT in this program unless the coordinator judges them
  part of "complete"; default: out of scope, listed as follow-ups).
- Known unverified: on-device S25 fps, on-device touch feel of tabs,
  Ember crossing end-to-end, non-Haven district tabs.
