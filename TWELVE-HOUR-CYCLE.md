# STARFALL 12-Hour Improvement & Refinement Cycle — Charter
Started: 2026-10-31 ~23:20 PDT. Ends: 2026-11-01 ~11:20 PDT (12 hours).
User directive: make the game higher quality and more likely to sell,
WITHOUT removing any of its depth. Autonomous; report only at completion
(or a genuine blocker needing the user).

## Depth guard (non-negotiable)
- NOTHING is removed: no system, feature, item, quest line, faction,
  station, or mechanic is cut. Improvements add polish, fix bugs, deepen
  feedback, or streamline access — never delete depth to fake simplicity.
- Before/after depth inventory is kept in TWELVE-HOUR-LOG.md: system list
  at cycle start vs end must match or grow.
- Save stays v12, old saves must load. Same signing key, installs over v1.5.

## Quality pillars (in priority order)
1. **First 10 minutes (sells the game):** onboarding/first-time experience,
   rookie curve intact (Lv1 time-to-die 14.3s), early goals clarity, no
   dead-ends, no unexplained deaths. This is where players decide to keep
   playing — and where store reviewers judge.
2. **Feel/juice:** combat feedback, hit/impact clarity, engine/explosion/
   shield FX, audio cues where missing, screen feedback that never obscures
   play. Within the S25 perf tier (drawImage budget already met — do not
   regress it).
3. **Bug hunt:** crash hunt, stuck states, dead buttons (native-dialog
   class of bugs), hail-pause regressions, save/load edge cases, builder
   edge cases. Every bug found gets fixed or logged with a repro.
4. **Visual consistency:** remaining procedural-looking art, icon gaps,
   HUD polish leftovers, station/ship readability at phone size.
5. **Sellability — PREPARE ONLY, never publish:** itch page copy drafts,
   screenshot capture list + captured shots, short trailer shot list,
   shop/supporter presentation polish in-game, share hooks (photo mode).
   Standing rule stands: nothing pushed, merged to a public repo, or
   published to any store/page without the user's word. Prepared materials
   live under phases/twelve-hour-cycle/ and are handed to the user at the
   end for his publish decision.

## Standing rules (unchanged from the autonomous program)
- Builders stage under phases/<slug>/ with REPORT.md + smoke.mjs +
  snapshot-manifest.txt; coordinator audits before merging; per-file cp
  only, NEVER rsync --delete; snapshot before every merge into
  ~/workspace/starfall-backups/ (code + html/css/js + asset manifests only,
  never phases/ or v2 masters or raw/).
- Local-only generation (no cloud APIs/keys); downloaded tools/assets only
  if license-clean with source + license recorded, within APK size budget.
- Never break: freeze fix, hail pause (flag gate), open-space crossing,
  district tabs, S25 perf tier — re-run their smokes after touching changes.
- Touch-first, vanilla JS/Canvas 2D, zero dependencies.

## Waves (coordinator-run, each wave = one staged slice + audit + merge)
- Wave 0: depth inventory + bug backlog + FTUE audit (baseline).
- Waves 1–5: slices in pillar order; each wave updates TWELVE-HOUR-LOG.md
  with a timestamp heartbeat, what changed, smoke numbers.
- Final wave (before 11:20 PDT Nov 1): full regression suite + 240s soak
  + playthrough, final build via android/build.sh + asset-path check,
  verify packaged markers, record APK path/size/md5, mark log COMPLETE.
- If a wave's agent is interrupted, the next worker resumes from the log —
  never redo completed waves, never merge red.

## Completion signal
APK + report to the user: what improved (per pillar), verification numbers,
depth inventory before/after, prepared-but-unpublished store materials,
honest remaining limits. The upload approval tap at the end is the user's
only mechanical step.
