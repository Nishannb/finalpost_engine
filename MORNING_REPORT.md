# BGM Phase 2 morning report

Branch: `bgm-phase-2`. Not pushed.

## 1. Spend proof

- `agents/music_specialist/spend.log` before the run: absent (0 lines).
- After T1: absent (0 lines).
- After T2: absent (0 lines).
- After T3: absent (0 lines).
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

## 3. Flags

- `MUSIC_MIX_MEASURE`: default off. `1` renders bed-only and VO-only wavs after a local render and logs `music.mix_measured`. Off so normal renders do not pay the extra render.

## 4. Numbers from T2 and T10

- Fixture (salvaged bed + synthetic −20 LUFS voice, gains applied per region): full-file bed −16.0 LUFS. Speech gap and pause gap passed at 18 ± 1 and 9 ± 1. No final MP4 yet, so no final LUFS or true peak.
- T10 not run.

## 5. Listen list

Not produced yet.

## 6. Decisions for the human

- `tech_sharp` → `high-energy`. The visual theme is sharp/tech, the brief asked for high-energy unless a better fit, and the only real bed is the 128 bpm A minor high-energy bed. Other visual moods: warm_intimate→nostalgic, calm_cool→calm, bold_energetic→high-energy, clean_light→neutral, dark_cinematic→tense, earthy_natural→calm, soft_pastel→calm.
- T10's `npm run first-video` calls Groq and Gemini. Those are paid APIs, so that full command will not be run. A local Remotion render that does not call them will be used if the code can do it without a new analyze.

## 7. Commands for the human (do not run overnight)

Filled in after T8.
