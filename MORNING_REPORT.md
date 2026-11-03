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
- Commit: filled after the commit.

## 3. Flags

- `MUSIC_MIX_MEASURE`: default off. `1` renders bed-only and VO-only wavs after a local render and logs `music.mix_measured`. Off so normal renders do not pay the extra render.
- `MUSIC_CARVED_TWIN`: default off. `1` is the intended switch for playing `bed_carved.wav` under speech. Off because T2 has no rendered-mix measurement, and because the URL is not wired yet.
- `MUSIC_MASTER_PASS`: default off. `1` runs a local two-pass loudnorm (I=−14, TP=−1, LRA=11) on the finished MP4 audio and copies the video. Off so a normal render is not re-encoded.

## 4. Numbers from T2 and T10

- Fixture (salvaged bed + synthetic −20 LUFS voice, gains applied per region): full-file bed −16.0 LUFS. Speech gap and pause gap passed at 18 ± 1 and 9 ± 1. No final MP4 yet, so no final LUFS or true peak.
- T10 not run.

## 5. Listen list

- `remotion/out/music-loop/bed_full.wav`
- `remotion/out/music-loop/bed_loop.wav`
- `remotion/out/music-loop/bed_loop_x3.wav` (three loops, for the seam)
- `remotion/out/music-loop/bed_carved.wav` (high-pass ~200 Hz, −3 dB at 3 kHz, from the salvaged bed)


## 6. Decisions for the human

- `tech_sharp` → `high-energy`. The visual theme is sharp/tech, the brief asked for high-energy unless a better fit, and the only real bed is the 128 bpm A minor high-energy bed. Other visual moods: warm_intimate→nostalgic, calm_cool→calm, bold_energetic→high-energy, clean_light→neutral, dark_cinematic→tense, earthy_natural→calm, soft_pastel→calm.
- T10's `npm run first-video` calls Groq and Gemini. Those are paid APIs, so that full command will not be run. A local Remotion render that does not call them will be used if the code can do it without a new analyze.
- `MUSIC_CARVED_TWIN` stays off. Playback code is in `MusicBedTrack`, but no blueprint gets `musicCarvedUrl` yet.
- On a 250 ms collision, a kinetic hit outranks a caption pop. The brief listed them as one group.
- The prewarm script does not generate. Saying `y` raises before any Runware call. The $0.105 figure is the plan for a future wired run, not a spend that happened.

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
