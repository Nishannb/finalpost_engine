# Phase 2.3

Branch: `bgm-phase-2`. Not pushed. Date: 2026-11-04.

## 1. Spend proof

- `agents/music_specialist/spend.log`: absent at the start, absent at the end (0 lines, unchanged).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0. R2 writes: 0. No audio file was added, downloaded or generated. The existing pool bed was not touched. The only renders were one local Remotion probe (bed stem) for the shortfall investigation.

## 2. Per task

### 1. Voice-first policy
- Status: done. `docs/audio/VOICE_FIRST.md` (rules, the logs that prove them, a checklist for new audio features) and an "Audio policy" section in `CLAUDE.md`.
- `CLAUDE.md` is still **untracked** in git (it was before this task), so the edit is on disk but not committed. Decide whether to commit that file.
- Commit: `7d3d8f5` (doc, with tasks 2 and 3).

### 2. Supportive music prompts
- Status: done. `PROMPT_VERSION` 3. Every caption now carries `background underscore, minimal, sparse arrangement, no lead melody, supportive`. The negative prompt gains `lead, solo, busy arpeggio, vocal chops, loud drums`.
- Every caption is exactly 12 tags. Adding 5 tags to the old 10–11 cannot fit in 12 by dropping only production tags, so the order of what is dropped is: all production tags, then `instrumental` (redundant with `no vocals`), and high-energy's third instrument `supersaw lead` (it contradicts "no lead melody"). `no vocals` and the `<bpm> bpm` tag stay.
- high-energy bpm 128 → **120** (÷4, still inside synthwave's range, calmer under a voice). Say if you would rather keep 128.
- New cache keys, as expected. The salvaged pool bed is untouched and stays in the pool.
- Files: `prompts.py`, `models.py`. Tests: existing suite passes unchanged.

### 3. Measuring "fighting the voice"
- Status: done. Commit `7d3d8f5`.
- `music.qc_speech_band`: `speech_band_stats()` in `postprocess.py` (energy share in 1–4 kHz, and spectral flux in that band: mean positive frame-to-frame rise over mean band level). Log only, never rejects. It is in the postprocess result, logged by the agent and the server, and written into the bed's `meta.json` (`qc_speech_band`) on the next generated bed. Existing pool beds get it when they are next processed; I did not rewrite the pool.
- `music.mix_measured` now has `bedOverVoiceWindows` (speech windows where voice − bed is under 6 LU), `minSpeechWindowGapLu`, `speechWindowsUnmeasured` (windows under 0.4 s have no loudness of their own and are counted apart, never as a pass), plus `intendedSpeechGapLu` and `speechGapShortfallLu`. `music.voice_fight` warns when the count is above 0.
- Files: `postprocess.py`, `agent.py`, `vo_lufs.py`, `schema.ts`, `musicSpecialist.ts`, `mixMeasure.ts`, tests.

### 4. The 0.7 LU speech shortfall (17.3 measured vs 18 intended)
- **Cause: not our envelope and not the measurement.** It is Remotion's volume handling. Rendering the bed-only probe locally and comparing it with the ideal gain, frame by frame:
  1. **Volume rounding.** `@remotion/renderer` rounds every volume to a multiple of 1/97 (`round-volume-to-avoid-stack-overflow.js`, to keep the ffmpeg expression shallow). The −22 dB speech gain is 0.0794. It becomes 8/97 = 0.0825 = −21.7 dB. That is a steady **+0.28 dB** across every speech window. It is bigger at lower gains (a −30 dB gain would round to 3/97).
  2. **Late attack.** The gain lands about one frame (33 ms) later than the envelope says. At the 0.5 s onset the envelope has −22 dB at frame 15 and the render plays −14.2 dB; at 3.9 s it plays −15.9 dB at frame 117. The first ~40 ms of each phrase has the bed up to 8 dB too loud. About **+0.3 dB** over the windows.
  3. **Voice side:** the VO measures −20.13 LUFS in the render against the −20 the envelope was built from: 0.13 LU.
  Together: 0.28 + 0.29 on the bed plus 0.13 on the voice, about 0.7.
- Fix: **none applied.** It is outside the envelope and the measurement, and I did not touch the −18 default. Nothing here lets the bed pass the voice. The numbers are now logged side by side (`intendedSpeechGapLu`, `speechGapLu`, `speechGapShortfallLu`) so it stays visible.
- Option if you want it closed: add a one-frame look-ahead to the attack (an optional field, old blueprints unchanged), and pick the speech gain from the 1/97 grid. Not done; it changes the envelope in two files and the parity tests.
- Remotion rounds the SFX volume the same way. A −30 dBFS hit (0.0316) lands on 3/97, so the "10 LU under the voice" is about ±1.5 dB. Fine for an "about" rule.

### 5. SFX library
- Status: done. Commit `73df0b5`.
- **Final path: `remotion/public/sfx-library/`** (see decision 1 below). It holds `README.md` and `sfxinfo.json` (`[]`) and no audio.
- Built-in wavs stay in `remotion/public/sfx/` (`SfxTrack.tsx` still points there).
- `npm run sfx:check` (root and `server`): read-only. Checks missing file, real duration against `duration` (50 ms), unknown `tobeused`, files with no entry, leading silence over 10 ms. Extra: warns when a file's peak is outside −3…0 dBFS, because the level logic assumes about −1. It prints suggestions and never edits. Exit 1 only on an error (missing or unreadable file, bad catalog).
- Engine startup runs the same check and logs `sfx.catalog_warning` (non-fatal). Missing folder or empty `[]` is silent.
- Wiring (`server/src/lib/sfxCatalog.ts`, called in `analyzeVideo.ts` after the bed block): only when the catalog has entries. For each hit `polishSfx` scheduled, it maps the hit to a cue, picks an entry deterministically from `hash(videoId + cue + time)`, and otherwise keeps today's built-in hit. Level: peak at `voLufs + SFX_VOICE_OFFSET_LU (−10) + gainDb`, never closer to the voice than −6 LU. A catalog hit within 120 ms after a word onset is dropped. It never adds a hit, so cap and spacing are unchanged. It logs `sfx.catalog_applied` with `maxPeakVsVoiceLu`, `maskedByWord`, `clamped`, and how many came from the catalog.
- Blueprint `hits[]` gained an optional `durationSec` (catalog hits only), so a longer file is not cut at 0.45 s. `polishSfx.ts` is untouched; `mergeHits` stays unwired; `MUSIC_SPECIALIST_SFX` stays off.
- Cues the engine fires today: `cut`, `transition`, `zoom_in`, `kinetic_plate`, `emphasis`. `hook`, `cta`, `ui`, `caption_pop`, `zoom_out`, `ambience` are accepted and checked but not scheduled by anything yet. Mapping is `cueForHit()`.
- Tests: `sfxCatalog.test.ts`, 20 tests. Parsing and the string-to-array rule; unknown cue is a warning; empty catalog gives the same hits (snapshot of the scheduler, deep-equal through `applyCatalogToHits`); a two-entry fixture with synthetic tones in a temp dir picks the right file, stable across runs and catalog order; the 120 ms mask and the −6 LU ceiling; `sfx:check` flags a missing file, a wrong duration and leading silence and leaves the files byte-identical; the real folder ships with no audio.

## 3. How to add a sound
1. Copy the wav/mp3/m4a into `remotion/public/sfx-library/` (starts at 0.0 s, peak about −1 dBFS) and add an entry to `sfxinfo.json` (`fileName`, `duration`, `tobeused`, optional `gainDb`).
2. Run `npm run sfx:check` and fix what it suggests. The README in that folder has the cue table.

## 4. Checks
- pytest `music_specialist/tests`: 44 passed. Server tsc: clean. Remotion tsc: only the 3 known errors.
- Server vitest (music, scripts, render, `sfxCatalog`, existing SFX suites): 235 passed, **2 failed, both pre-existing**. I reproduced both with my changes stashed:
  - `wp12dSfxHits.test.ts` "wiring pins": `analyzeVideo.ts` has not had the comment it searches for (`musicMood intentionally omitted` / `No music bed`) since at least `a064742`.
  - `wp17FlashCards.test.ts` "caption exclusivity" fails the same way before my changes.
  I did not fix them (out of scope); they need a look.
- I did not run the whole server suite (it exceeds the tool time limit); I ran the music, scripts, render, lib and SFX-related suites.

## 5. Needs a human decision
- **Folder name.** You asked for `SFX`. `remotion/public/sfx/` already exists, and on macOS `SFX` and `sfx` are the same folder while on Linux/Lambda they are not, so I asked and went with `remotion/public/sfx-library/` (your answer).
- **Word mask scope.** The 120 ms rule exists only in `mergeHits` (unwired); `polishSfx` never had it. Applying it to today's built-in hits would change old renders, so it applies to catalog hits only. Say if you want it on built-ins too.
- high-energy bpm 128 → 120, and the dropped caption tags (above).
- Whether to close the 0.7 LU shortfall with a one-frame look-ahead (above).
- Commit `CLAUDE.md`?
- The 2 failing pin tests.

## 6. `render-blueprint` A/B commands for your real edit
Use your saved blueprint for `<bp>`. Master pass is on by default; add `--measure 1` to log the numbers (`music.mix_measured`, including `bedOverVoiceWindows`, in `logs/engine.log`).

```
# speech offset
npm run render-blueprint -- <bp> --speech-offset -16
npm run render-blueprint -- <bp> --speech-offset -18
npm run render-blueprint -- <bp> --speech-offset -20

# carved twin
npm run render-blueprint -- <bp> --carved 0
npm run render-blueprint -- <bp> --carved 1

# release
npm run render-blueprint -- <bp> --release-ms 450
npm run render-blueprint -- <bp> --release-ms 300
```

# Phase 2.2

Branch: `bgm-phase-2`. Not pushed. Date: 2026-11-04.

## 1. Spend proof

- `agents/music_specialist/spend.log`: absent at the start, absent at the end (0 lines, unchanged).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0. R2 writes: 0. Only local Remotion, ffmpeg, Python and `render-blueprint` were run.

## 2. Per task

### 1. Honest pause measurement
- Status: done.
- `pauseGapLu` is now `pauseGapLuAll` (whole window) plus `pauseGapLuSettled` (only where the envelope has reached the pause gain: from `phrase.end + hold + release` to `next.start − attack`, 20 ms guard each side, at least 0.3 s). `settledPauseCount` and `settledPauseSec` are logged in `music.mix_measured`, along with a per-pause table (`pauses`).
- Files: `server/src/stages/music/mixMeasure.ts` (+ test), `agents/music_specialist/vo_lufs.py`, `tests/test_mix_measure.py`.
- Tests: synthetic 2 s pause with the real hold/release/attack: settled gap 9 ± 1 LU (passes); the whole-window gap reads higher, because the ramps run quieter than the pause gain.
- Gate: pyloudnorm needs at least 0.6 s of settled audio in total. Below that `pauseGapLuSettled` is `null` rather than a made-up number.
- **Found while doing this:** `MusicMixProbe` played the bare `musicUrl`, so it never played the loop or carved twin. The Phase 2.1 "carved changes nothing" reading came partly from that. The probe now takes the real bed fields (`bedSpec`: full, loop, carved, full duration, source). `MusicMixProbe.tsx` only; ShortVideo untouched.

### 2. Does the envelope do what the preset says
- Status: done. Defaults unchanged (hold 150 ms, release 450 ms).
- Added `--hold-ms` and `--release-ms` to `render-blueprint` (they rebuild the duck; the stored hold/release are what Remotion evaluates, so no Remotion change). Output file names now carry `-r<release>`.
- Fixture pauses (the 5 that qualify as pause windows, ≥ 0.6 s): 0.84, 0.64, 1.04, 0.74, 0.94 s.
  - release 450 / hold 150: **1 of 5 settles** (1.04 s, settled 0.32 s).
  - release 300 / hold 150: **2 of 5** (1.04 s, 0.94 s; 0.84 s settled total).
  - release 300 / hold 100: 3 of 5 (computed only, not rendered).
- The fixture's pauses are synthetic (0.6–1.0 s), so this tells you the mechanism, not your real edit. Almost every pause under about 1.0 s never reaches the pause gain at 450 ms release.
- **Proposed change (not applied): release 300 ms.** Hold stays 150 ms for now. Decide by ear with the A/B below.

### 3. Carved-twin decision
- Status: done. `carvedDecision(carved0, carved1)` in `mixMeasure.ts` (tested). Carved is allowed only when speech gap and settled pause gap are each within 1 LU of carved=0. It needs both numbers, so it is "not allowed" when the settled pause gap is missing.
- On the numbers below (release 300): speech +1.4 LU, settled pause 0.0 LU. The speech shift is outside 1 LU, so the rule says **not allowed**. That is a loudness check only: carved moves the speech-band balance, not just the level.
- `MUSIC_CARVED_TWIN` stays **off by default**. Decide by ear: `render-blueprint --carved 0|1`.

### 4. Master pass default
- Status: done. `masterPassEnabled` is on unless `MUSIC_MASTER_PASS=0`. `render-blueprint --master` now defaults to 1. `music.master_pass` (before/after LUFS and true peak) logs on every render; `music.master_pass_off` when it is off.
- Files: `flags.ts`, `masterPass.test.ts`, `localRender.ts`, `.env.example`.
- Old blueprints: the proof fixture is a Phase 2.1 blueprint with no hold/release fields. It renders unchanged apart from the mastered loudness (about −22 → −14 LUFS).

### 5. Re-run of the synthetic proof
All four renders: master on, measure on, same fixture, salvaged bed.

| carved | release | speech gap | pause gap (all) | pause gap (settled) | settled pauses | final LUFS | true peak | before master |
|---|---|---|---|---|---|---|---|---|
| 0 | 450 | 17.3 | 12.4 | null (0.32 s, too short to gate) | 1 | −13.9 | −2.7 | −22.0 / −11.1 |
| 0 | 300 | 17.3 | 11.3 | **9.1** | 2 (0.84 s) | −13.9 | −2.8 | −22.1 / −11.1 |
| 1 | 450 | 18.7 | 13.2 | null (0.32 s) | 1 | −13.9 | −3.1 | −21.9 / −11.1 |
| 1 | 300 | 18.7 | 11.8 | **9.1** | 2 (0.84 s) | −14.0 | −2.7 | −22.1 / −11.1 |

Reading: the 12.4 was the ramps, not the carved twin. At release 300 the settled gap is 9.1 against the intended 9. Speech gap is 17.3, not 18: there is a 0.7 LU shortfall in speech that I have not explained. The carved twin now shows up in the speech gap (+1.4 LU).

Commits: `6b7f1ff` (tasks 1–3), `4c1be67` (task 4). Task 5 and this report: the commit that follows.

## 3. Checks
- pytest `music_specialist/tests`: 42 passed. Server vitest (music, scripts, render): 131 passed. Server `tsc --noEmit`: clean. Remotion `tsc`: only the 3 known errors in `ShortVideo.tsx`.

## 4. Commands for your real edit (A/B by ear)
Use your saved blueprint path for `<bp>`. Each run writes `out/renders/…mp4`; master is on by default.

```
# speech offset
npm run render-blueprint -- <bp> --speech-offset -16
npm run render-blueprint -- <bp> --speech-offset -18
npm run render-blueprint -- <bp> --speech-offset -20

# carved twin
npm run render-blueprint -- <bp> --carved 0
npm run render-blueprint -- <bp> --carved 1

# release
npm run render-blueprint -- <bp> --release-ms 450
npm run render-blueprint -- <bp> --release-ms 300
```
Add `--measure 1` to any of them for the numbers (`music.mix_measured` in `logs/engine.log`). `--master 0` turns the master pass off.

## 5. Needs a human decision
- Release 450 vs 300 ms (proposed 300), by ear.
- Carved on or off, by ear. The loudness rule alone says no on the fixture because of the 1.4 LU speech shift.
- The 0.7 LU speech-gap shortfall (17.3 vs 18): not investigated; probably bed LUFS and the speech-window average, not the envelope.

# Phase 2.1

Branch: `bgm-phase-2`. Not pushed.

## 1. Spend proof

- `agents/music_specialist/spend.log` at the start of Phase 2.1: absent (0 lines).
- After A: absent (0 lines).
- After B: absent (0 lines).
- After C: absent (0 lines).
- After D: absent (0 lines).
- After E (end of Phase 2.1): absent (0 lines).
- Runware calls: 0. LLM calls: 0. Lambda renders: 0.

## 2. Per task

### A. Trim trailing silence

- Status: done.
- Files: `silence_trimmer.py` (`trim_trailing_segment`), `postprocess.py` (`POSTPROCESS_VERSION` 3, 150 ms fade on `bed_full` only), `test_trailing_trim.py`, `test_loop.py` version pin, optional `trailing_trimmed_sec` on the music result schema.
- Tests: pytest 37 passed. Vitest 75 passed (`src/stages/music` plus wp27). Server tsc clean. Remotion tsc only the 3 known errors.
- Salvaged bed, reprocessed locally: `trailing_trimmed_sec` 3.25, `duration_sec` 56.68, measured bpm 129.2, 16-bar loop 29.094 s, −16.0 LUFS, `loop_fallback` false. The hand-off time is that 56.68 s, which is the end of the audible file.
- Listen files (gitignored): `remotion/out/music-loop/bed_full.wav`, `bed_loop.wav`, `bed_loop_x3.wav`, `bed_carved.wav`.
- Commit: `dc737d7`.

### B. QC gate

- Status: done. Vocal score is log-only. Live retry is implemented and was not run.
- Files: `qc.py`, `agent.py` (one live retry, dry never retries), `test_qc.py`, schema qc fields, `musicSpecialist.ts` logs `music.qc_vocal_score`.
- Tests: pytest 41 passed. Vitest 75 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- Salvaged bed after the v3 trim: `passed` true, silence 0.04 s, true peak −4.119 dBFS, bpm error 0.94%, seam 0.867 dB, vocal score 0.5956 (recorded, not a reject).
- Commit: `eafdbbc`.

### C. Wire loop and carved end to end

- Status: done. R2 backfill already applied for the salvaged bed (rule 3 only).
- Files: `uploadBed.ts` (`uploadBedDetailed`, `mergePoolEntry`, optional `full_url`/`loop_url`/`carved_url`), `musicSpecialist.ts` (`poolPlan` + generated upload paths), `toAudioDesign.ts` (`playbackFromPlan`), `analyzeVideo.ts` uses `playbackFromPlan`, `ShortVideo.tsx` passes `musicCarvedUrl` only (not lines 286/299/300), `schema.ts` bed paths, `poolPlayback.test.ts`, `backfillSalvagedBed.ts` (gated on `--write-r2`).
- Tests: pytest 41 passed. Vitest 84 passed (music + wp27). Server tsc clean. Remotion tsc only the 3 known errors.
- Old pool entries with only `url` keep single-file playback. Carved is only attached when `MUSIC_CARVED_TWIN=1`.
- Commit: `a064742`.

### D. Free re-renders (save + render-blueprint)

- Status: done.
- Files: `saveBlueprint.ts` (+ test), `renderBlueprint.ts` (+ test), `duckEnvelope.ts` (optional talking offset overrides), `analyzeVideo.ts` (save just before return), root and server `package.json` scripts, `.gitignore` for `out/blueprints/` and `out/renders/`.
- Tests: vitest renderBlueprint + saveBlueprint 18 passed; full music suite was 99 before the carved strip, then 18 again after. Server tsc clean. Remotion tsc only the 3 known errors. Pytest 41 passed.
- `render-blueprint` source ban: no analyzeVideo, Runware, Anthropic, Groq, Gemini, or Lambda strings. `--carved 0` strips `musicCarvedUrl`; `--carved 1` never invents a URL. Mix and master numbers stay in the engine log under the printed `renderJobId`.
- Commit: `ed9fe69` (path resolve follow-up included in the E commit).

### E. Synthetic proof renders

- Status: done. Zero spend. Fixture is a 12 s color video with band-limited noise "speech" bursts at −20 LUFS, not a re-analyze of `2.mp4`.
- Files: `makeProofFixture.ts` (+ test), `.gitignore` `out/fixtures/`, relative path resolve in `renderBlueprint.ts`.
- Tests: maker + render-blueprint + saveBlueprint vitest 22 passed. Server tsc clean. Spend log still absent.
- Four local `render-blueprint` burns with `--measure 1`. Salvaged bed URLs from the backfilled pool. Intended `music.mix_check` was speechGapLu 18 / pauseGapLu 9 on every run.
- `MusicMixProbe` only passes `musicUrl` into `MusicBedTrack`, so bed-stem `mix_measured` cannot see the carved twin. Final LUFS still barely moved between carved 0 and 1 (−22.0 vs −21.9 before master).
- `MUSIC_CARVED_TWIN` stays **default off**. Reason: measured pauseGapLu was 12.4 on carved=1 (and on carved=0), outside the 9 ± 1.5 LU band required to flip the default on. SpeechGapLu 17.3 was inside 18 ± 1.5.
- Commit: `a607609`.

## 3. R2 objects written

Allowed keys only (salvaged cache key `108abbca…`):

- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/bed_full.wav` (HEAD 200)
- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/bed_loop.wav` (HEAD 200)
- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/bed_carved.wav` (HEAD 200)
- `music/beds/108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53/meta.json` (`postprocess_version` 3, trim 3.25 s, QC scores, derived URLs; original licence kept)
- `music/beds/pool/high-energy.json` (same cache key patched with `full_url`/`loop_url`/`carved_url`, `duration_sec` 56.68)
- Backup: `music/beds/pool/high-energy.json.bak-2026-11-04` (HEAD 200) and local `remotion/out/music-loop/high-energy.json.bak-2026-11-04`

`bed.wav` was not rewritten. No other pool moods were touched.

## 4. Task E table

| carved | master | speechGapLu (intended → measured) | pauseGapLu (intended → measured) | final LUFS | true peak |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 18 → 17.3 | 9 → 12.4 | −22.0 | −11.1 |
| 1 | 0 | 18 → 17.3 | 9 → 12.4 | −21.9 | −11.1 |
| 0 | 1 | 18 → 17.3 | 9 → 12.4 | −13.9 (after master; before −22.0) | −2.7 |
| 1 | 1 | 18 → 17.3 | 9 → 12.4 | −13.9 (after master; before −21.9) | −3.1 |

`MUSIC_CARVED_TWIN` default: **off**. Pause gap stayed outside 9 ± 1.5 LU with carved on.

## 5. Listen list

v3 beds:

- `remotion/out/music-loop/bed_full.wav`
- `remotion/out/music-loop/bed_loop.wav`
- `remotion/out/music-loop/bed_loop_x3.wav`
- `remotion/out/music-loop/bed_carved.wav`

Proof renders:

- `out/renders/proof-synth-0001-talking-c0-m0-20261104T050033.mp4`
- `out/renders/proof-synth-0001-talking-c1-m0-20261104T050228.mp4`
- `out/renders/proof-synth-0001-talking-c0-m1-20261104T050406.mp4`
- `out/renders/proof-synth-0001-talking-c1-m1-20261104T050538.mp4`

Fixture: `out/fixtures/proof/blueprint.json`, `source.mp4`, `dialogue.wav`.

## 6. Commands for the human (do not run overnight)

One real polish edit. Analyze still uses Groq/Gemini as any normal edit does. The bed should pool-hit the salvaged high-energy entry (Runware $0) unless `MUSIC_BED_FRESH=1`. After it finishes, `out/blueprints/{videoId}.json` is written for free replays.

```
cd /Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine
MUSIC_SPECIALIST=live POLISH_MUSIC_BED_URL= PRODUCT_EDIT_PROFILE=polish \
  MUSIC_MIX_MEASURE=1 MUSIC_MASTER_PASS=1 \
  npm run first-video -- "/Users/nishanbaral/Downloads/2.mp4" auto
```

Look for `music.pool_hit` (cost 0). `music.generated` with a cost means a paid bed. Then A/B the saved blueprint by ear:

```
npm run render-blueprint -- out/blueprints/<videoId>.json --duck-preset talking --speech-offset -16 --measure 1 --master 1
npm run render-blueprint -- out/blueprints/<videoId>.json --duck-preset talking --speech-offset -18 --measure 1 --master 1
npm run render-blueprint -- out/blueprints/<videoId>.json --duck-preset talking --speech-offset -20 --measure 1 --master 1
```

Replace `<videoId>` with the 24-char id from `music.blueprint_saved` / the filename under `out/blueprints/`.

---

# BGM Phase 2 morning report

Branch: `bgm-phase-2`. Not pushed.

## 1. Spend proof

- `agents/music_specialist/spend.log` before the run: absent (0 lines).
- After T1: absent (0 lines).
- After T2: absent (0 lines).
- After T3: absent (0 lines).
- After T4 (reverted): absent (0 lines).
- After T5: absent (0 lines).
- After T6: absent (0 lines).
- After T7: absent (0 lines).
- After T8: absent (0 lines).
- After T9 and at the end of the run: absent (0 lines).
- Runware calls: 0. Lambda renders: 0. Gemini/Groq/Claude generation calls: 0.

## 2. Per task

### Checkpoint

- Status: done.
- Commit: `54f7e9de92a942e57871b17b3efd1fbf46d93f0d` `phase 1.1 checkpoint`.
- The working tree on `main` had never been committed past the early engine. This checkpoint is that whole source tree plus Phase 1.1, excluding `.env`, `agents/.venv`, `__pycache__`, and `captionkit_tmp`.
- Stash list was empty.

### T1. Content-mood map

- Status: done.
- Files: `server/src/stages/music/contentMoodMap.json`, `flags.ts`, `musicSpecialist.test.ts`, `agents/music_specialist/prompts.py`, `tests/test_content_mood_map.py`.
- Tests: pytest 24 passed; vitest 42 passed (musicBed, musicSpecialist, wp27); server tsc clean; Remotion tsc only the 3 known `ShortVideo.tsx` errors.
- `tech_sharp` now resolves to `high-energy` before the keyword buckets. An unknown tone logs `music.mood_unmapped` and becomes `neutral`. `neutral talking-head` does not log.
- Commit: `7cdd2c7c8466868e4a4a59d3e7f48f7095ca065f`.

### T2. Bed-only loudness check

- Status: done.
- Files: `mixMeasure.ts`, `mixMeasure.test.ts`, `flags.ts` (`mixMeasureEnabled`), `localRender.ts`, `MusicMixProbe.tsx`, `Root.tsx`, `vo_lufs.py` (`measure_mix`, stereo BS.1770), `test_mix_measure.py`, `.env.example` comment.
- Tests: pytest 25 passed. The salvaged bed measures −16.0 LUFS. Vitest 48 passed and both tsc checks were clean before the stereo-reader fix; that fix is Python-only and pytest covers it.
- `pauseGapLu` is voice-speech LUFS minus bed loudness inside pause windows, because the voice is silent in a pause. Same reference as `music.mix_check`.
- The optional 6 s Remotion `--codec=wav` probe was not rendered. The fixture applies the talking gains to the salvaged bed and measures those wavs.
- Commit: `4b64ac55cafef9e8647ea2b538f8ead374c0135a`.

### T3. Bar-aligned loop

- Status: done, with one wiring gap.
- Files: `postprocess.py` (POSTPROCESS_VERSION 2), `test_loop.py`, requirements (`librosa`), blueprint fields `musicFullUrl` / `musicLoopUrl` / `musicFullDurationSec`, `MusicBedTrack` split path, `ShortVideo.tsx` prop pass-through (not lines 286/299/300), `loopBed.ts`, `uploadBed` optional loop file.
- Tests: pytest 28 passed. Salvaged bed: measured bpm 129.2 (within 3% of 128), 16 bars, not drum-led (30 ms fade), loop 29.094 s, seam jump ≤ 1.5 dB. Vitest loopBed + musicBed 33 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- Gap: `MusicPlan.loopUrl` is never set, and `uploadBed` is not passed `loopFilePath`. A render therefore still uses the single file. The existing high-energy pool bed has no loop object. Recorded for the human. Not fixed overnight because connecting it is an upload-path change and this run must not write the pool.
- Listen files (gitignored, local): `remotion/out/music-loop/bed_full.wav`, `bed_loop.wav`, `bed_loop_x3.wav`.
- Commit: `4ea32fc74e470207000caa037183690b2630e16c`.

### T4. QC gate

- Status: blocked and reverted. Nothing from this task is in the tree.
- The salvaged bed's tail is a real 3.2 s run at about −67 dBFS, ending at 59.9 s (median level of the rest is about −19 dBFS). The silence check correctly fails that tail. Two retunes did not make the bed pass without ignoring a hole the spec calls a failure.
- Vocal fraction on that bed was 0.60, so the first constant (0.45) also flagged the synth bed. That part was raised to 0.72 and then reverted with the rest.
- Pytest was 31 passed and 1 failed (`test_smoke_bed_passes`) at revert time. Server tsc was not green yet on the first draft (`MusicMode` `'off'`). Those edits are gone.
- Human decision: trim the trailing near-silence before the gate, or exempt the tail, before turning a live retry on. Left off so a future live edit cannot reject the bed we already have.

### T5. VO-carved twin

- Status: done. Default off.
- Files: `postprocess.py` (`carve_for_voice`, writes `bed_carved.wav`), `test_carved.py`, `flags.ts` (`carvedTwinEnabled`), `carvedMix.ts` + vitest, `MusicBedTrack.tsx` (full and carved in sync on both the loop-split path and the single-file path), optional `musicCarvedUrl` on the server type and the Remotion zod schema, `.env.example` comment.
- Tests: pytest 30 passed (salvaged bed: below 150 Hz at least 6 dB down, 2.5–3.5 kHz within −3 dB ± 1.5). Vitest 51 passed (musicBed, musicSpecialist, loopBed, wp27, carvedMix). Server tsc clean. Remotion tsc only the 3 known `ShortVideo.tsx` errors.
- `MUSIC_CARVED_TWIN` defaults to off. T2 never measured a rendered mix, so there is no regression number to justify defaulting it on.
- Gap: nothing in the pipeline sets `musicCarvedUrl`, and `ShortVideo.tsx` does not pass it. Turning the flag on does not change a render until a later change copies `bed_carved.wav` onto the blueprint. Left that way so this run does not upload a new pool object. Old blueprints with no carved URL stay on the single file.
- Commit: `0d1526448704367652d038a3dd2eb01496c90337`.

### T6. Master pass

- Status: done. Default off.
- Files: `masterPass.ts`, `masterPass.test.ts`, `flags.ts` (`masterPassEnabled`), `localRender.ts` (after output validation, before `logMixCheck`), `.env.example` comment.
- Tests: vitest 56 passed, including a 2 s local lavfi MP4: after loudness within 1 LU of −14, true peak ≤ −0.5 dBFS, h264 video kept, aac audio. A bad file throws and the original bytes stay. Pytest 30 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- Failure logs `music.master_pass_failed` and the render continues with the unmastered file. Success logs `music.master_pass` with before and after LUFS and true peak.
- The existing voice-delivery loudnorm in `deliveryAcoustics.ts` was not changed.
- Commit: `715e561`.

### T7. SFX merge (stays off)

- Status: done. Not wired into the render. `MUSIC_SPECIALIST_SFX` stays off.
- Files: `mergeHits.ts`, `mergeHits.test.ts`, `runDirectorV2.ts` (caption-pop `visual_cuts` only), optional `src` on hits in the blueprint type, the Remotion zod schema, and `SfxTrack.tsx`.
- Tests: mergeHits vitest 9 passed inside a music run of 60 passed. Pytest 30 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- `mergeHits` is not called from analyze or the director. `schedulePolishSfxHits` is still the only writer of `audioDesign.hits`. A non-empty `src` on a hit plays that URL; hits without `src` still play the local whoosh/hit/pop wav.
- The music job now sends at most 24 `caption_pop` cuts. `include_sfx` is still false, and the seed does not read cuts, so the bed does not change. Kinetic plates, motion entrances, and recipe peaks are accepted by `collectVisualCuts` but are not known when music starts, so they are not sent.
- When a kinetic hit and a caption hit land within 250 ms, the kinetic one wins. The brief grouped them; a collision needed one winner.
- An older `wp12d` pin looks for a "musicMood intentionally omitted" comment in `analyzeVideo.ts`. That comment is already gone from Phase 1. T7 did not touch that file. Not treated as a T7 failure.
- Commit: `d2cdf8a`.

### T8. Pool prewarm (plan only)

- Status: done as a planner with hard gates. The live fill is not wired, on purpose.
- Files: `agents/music_specialist/scripts/prewarm_pool.py`, `scripts/__init__.py`, `tests/test_prewarm.py`.
- Tests: pytest 35 passed (5 of them are this script). Server tsc clean. A music vitest subset passed. Remotion tsc still the 3 known errors. `spend.log` still absent after the tests (pytest points `MUSIC_SPEND_LOG` at a temp file).
- `--plan` prints the call count and the cost from `BGM_COST_USD` ($0.0075) and exits 0 with no caller token and no TTY.
- `--confirm-spend` exits 2 unless `MUSIC_SPECIALIST_CALLER=pipeline`, stdin is a TTY, and the answer is exactly `y`. It prints the plan before those checks.
- After those gates, `run_live_fill` still raises before constructing `RunwareTransport` and before `append_spend`. A human who types `y` will not spend and will not fill the pool. Wiring it would also need an R2 upload, which this run must not perform.
- Commit: `9385a34`.

### T9. Late-upload spool

- Status: done. Tested with a fake uploader, not R2.
- Files: `spool.ts`, `spool.test.ts`, `musicSpecialist.ts` (flush at the start of `runMusicPlan`, copy into the spool before `uploadBed`, delete the entry only after upload succeeds), `.gitignore` line `agents/music_specialist/spool/`.
- Tests: spool tests passed inside a 57-test vitest run (spool, musicSpecialist, mergeHits, loopBed, musicBed). Pytest 35 passed. Server tsc clean. Remotion tsc only the 3 known errors.
- A child that writes `bed.wav` and `meta.json` and is then SIGKILLed still leaves a complete entry. The next `flushSpool` uploads it and deletes it. A failed upload leaves its entry and does not block the next one. A half-written `.tmp-*` directory is ignored.
- Default directory is `agents/music_specialist/spool` unless `MUSIC_SPOOL_DIR` is set. Nothing was uploaded to R2.
- Commit: `44983c6`.

### T10. Proof render

- Status: skipped. Not run.
- `npm run first-video` renders with `renderLocally` (not Lambda), but it always calls `analyzeVideo` first. That path calls Groq and Gemini. Those are paid generation APIs, so the command was not started.
- There is no saved blueprint on disk to re-render locally. The only blueprint JSON in the repo is an old eval fixture, not the polish edit of `2.mp4`.
- The earlier dry pool-hit render, from before this run, is still the one to listen to: `https://media.kinmel.shop/ai-video/render/2026-11-03/first_bp_2753aa41d02f423c8e11.mp4`. Its log line was `music.pool_hit` for cache key `108abbca07e0c08d977649dbd1d1d842c072e564986b495f627caf07bfb55a53`, video id `350490efc54c233ae72d8772`, `cost_usd` 0. It predates `music.mix_check` on the local path and predates `MUSIC_MASTER_PASS`, so it has neither measured gaps nor a −14 master.
- `music.python` lines in `logs/engine.log` from this run are vitest dry spawns, not a live specialist.

## 3. Flags

- `MUSIC_MIX_MEASURE`: default off. `1` renders bed-only and VO-only wavs after a local render and logs `music.mix_measured`. Off so normal renders do not pay the extra render.
- `MUSIC_CARVED_TWIN`: default off. `1` is the intended switch for playing `bed_carved.wav` under speech. Off because T2 has no rendered-mix measurement, and because the URL is not wired yet.
- `MUSIC_MASTER_PASS`: default off. `1` runs a local two-pass loudnorm (I=−14, TP=−1, LRA=11) on the finished MP4 audio and copies the video. Off so a normal render is not re-encoded.
- `MUSIC_SPOOL_DIR`: unset. The spool then lives in `agents/music_specialist/spool` (gitignored). Set it to put the durable copy somewhere else. The next pipeline run uploads whatever is still there.

## 4. Numbers from T2 and T10

- Fixture (salvaged bed + synthetic −20 LUFS voice, gains applied per region): full-file bed −16.0 LUFS. Speech gap and pause gap passed at 18 ± 1 and 9 ± 1. No final MP4 yet, so no final LUFS or true peak.
- T10 not run, so there is no measured mix of `2.mp4` and no mastered MP4. The T6 fixture (2 s sine, local ffmpeg) landed within 1 LU of −14 with true peak ≤ −0.5 dBFS. That is not the talking-head mix.

## 5. Listen list

- `remotion/out/music-loop/bed_full.wav`
- `remotion/out/music-loop/bed_loop.wav`
- `remotion/out/music-loop/bed_loop_x3.wav` (three loops, for the seam)
- `remotion/out/music-loop/bed_carved.wav` (high-pass ~200 Hz, −3 dB at 3 kHz, from the salvaged bed)


## 6. Decisions for the human

- `tech_sharp` → `high-energy`. The visual theme is sharp/tech, the brief asked for high-energy unless a better fit, and the only real bed is the 128 bpm A minor high-energy bed. Other visual moods: warm_intimate→nostalgic, calm_cool→calm, bold_energetic→high-energy, clean_light→neutral, dark_cinematic→tense, earthy_natural→calm, soft_pastel→calm.
- T10's `npm run first-video` calls Groq and Gemini before the local render. It was not run. No polish blueprint was saved on disk, so there was nothing local to re-render.
- `MUSIC_CARVED_TWIN` stays off. Playback code is in `MusicBedTrack`, but no blueprint gets `musicCarvedUrl` yet.
- On a 250 ms collision, a kinetic hit outranks a caption pop. The brief listed them as one group.
- The prewarm script does not generate. Saying `y` raises before any Runware call. The $0.105 figure is the plan for a future wired run, not a spend that happened.
- T10 was skipped because `first-video` analyzes with Groq and Gemini before the local render. No saved polish blueprint was on disk to render instead.
- QC (T4) stays off until the salvaged bed's 3.2 s near-silent tail is trimmed or exempted. A live retry would reject the only real bed.

## 7. Commands for the human (do not run overnight)

Live polish edit. `tech_sharp` maps to `high-energy`, so this should pool-hit the salvaged bed and log `music.pool_hit` with `cost_usd` 0. A `music.generated` line with a cost means a paid generation. Do not add `MUSIC_BED_FRESH=1`.

```
cd /Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine
MUSIC_SPECIALIST=live POLISH_MUSIC_BED_URL= PRODUCT_EDIT_PROFILE=polish \
  npm run first-video -- "/Users/nishanbaral/Downloads/2.mp4" auto
```

Pool plan. This does not spend. With pool size 3 and one high-energy bed already stored, and the other four moods empty, it prints `calls=14` and `cost_usd=0.1050` (14 × $0.0075).

```
cd /Users/nishanbaral/Desktop/apps/creators_kinmel/finalpost_engine/agents
./.venv/bin/python -m music_specialist.scripts.prewarm_pool --plan --counts high-energy=1 --pool-size 3
```

Do not run `--confirm-spend`. The live body is not connected to generation or to R2, so it cannot fill the pool.
