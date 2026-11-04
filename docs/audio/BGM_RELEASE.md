# BGM release checklist

For the human. Nothing here has been run for you: every paid or deploy step is yours. Policy: [VOICE_FIRST.md](VOICE_FIRST.md). Last updated 2026-11-04 (Phase 2.4).

## 1. Production environment

Set these on the engine host. Never commit values. The defaults in the last column apply when a variable is unset.

| Variable | Set to | Why |
|---|---|---|
| `MUSIC_SPECIALIST` | `live` | Turns the music specialist on. `off` (the default) means no bed at all. A mood whose pool already has a bed never calls Runware, so `live` costs nothing for those moods. |
| `RUNWARE_API_KEY` | your key | Only used when a mood has an empty pool. |
| `POLISH_MUSIC_BED_URL` | **empty** | A licensed URL here wins over the generated bed. Leave it empty unless you want one licensed bed on every edit. |
| `MUSIC_SPECIALIST_MAX_USD` | `0.02` (default) | Cost cap per generation (~$0.0075 per bed). Above it the edit falls back to the pool or to no bed. |
| `MUSIC_SPECIALIST_TIMEOUT_MS` | `45000` (default) | How long an edit waits for a bed. The generation is not killed; a late bed lands in the pool for the next edit. |
| `MUSIC_BED_POOL_SIZE` | `3` (default) | The most beds one mood pool holds. A QC-passing generated bed is appended only while the pool is under this. Nothing is ever removed. |
| `MUSIC_DUCK_PRESET` | `talking` (default) | Bed sits 18 / 9 / 4 LU under the measured voice (speech / pause / open). |
| `MUSIC_DUCK_RELEASE_MS` | `300` (default) | Lets short pauses settle. Plus a one-frame attack look-ahead (33 ms), stored on each new blueprint. |
| `MUSIC_CARVED_TWIN` | `1` (default) | Carved bed under speech. `0` = off. |
| `MUSIC_MASTER_PASS` | `1` (default) | −14 LUFS / −1 dBTP on the finished MP4, on local **and** Lambda renders. `0` = off. |
| `SFX_VOICE_OFFSET_LU` | `-10` (default) | Catalog SFX peak this far under the voice. Only matters once you add sounds to `remotion/public/sfx-library/`. |
| `MUSIC_SPEND_LOG` | a path on a mounted volume | The specialist appends every paid call to `agents/music_specialist/spend.log`. In a read-only image or a tmpfs `/tmp` that file does not survive; point it at persistent storage so you can audit spend. |
| `MUSIC_MIX_MEASURE` | unset | Local-only (it costs an extra render). Never on Lambda. |

Also required: R2 credentials and `R2_PUBLIC_BASE_URL` set to a public **https** host. Bed URLs must be public https; the engine drops the bed and logs `music.bed_url_not_public` if any is not. The same R2 is used for the mastered Lambda copy.

### What the production image needs (Phase 2.4 findings and fix)

- `contentMoodMap.json` was read with `fs` from beside the compiled file, but `tsc` does not copy JSON. In a built image `resolveMoodPool` would have thrown and the music plan would have failed open on every edit. It is now imported, so the build emits it. Verified with a real `tsc` build.
- The `Dockerfile` shipped only `server/dist`: no `agents/`, no Python packages. Pool beds would still play, but a mood with an empty pool could not generate, and the voice loudness would fall back to an assumed −20 LUFS (`music.vo_lufs_assumed`). The `Dockerfile` now copies `agents/music_specialist`, the mood map, and builds `/app/agents/.venv` with `pydub pyloudnorm numpy scipy librosa`, and makes `agents/music_specialist` writable for `spend.log`. **This Dockerfile change has not been built.** Before deploying: `docker build -t kinmel-engine .` and then `docker run --rm kinmel-engine /app/agents/.venv/bin/python -c "import librosa, pyloudnorm, pydub, scipy"` (run it from `/app/agents` for `-m music_specialist.vo_lufs`). The venv pulls librosa and numba, which makes the image larger.
- ffmpeg is already in the image, and the Lambda master pass needs it.

## 2. Redeploy the Remotion site (needed before the first Lambda edit)

`remotion/public/sfx-library/`, the look-ahead envelope, the carved-twin playback and the new `leadSec` / `durationSec` fields only reach Lambda when the site bundle is redeployed. The repo's command:

```
npm run remotion:deploy
```

which runs `remotion lambda sites create src/index.ts --site-name=kinmel-video-engine --region=us-east-1` (from `remotion/package.json`, using `../.env`). The site name is fixed, so `REMOTION_SERVE_URL` should keep the same value; confirm after deploying. The Lambda function does not need redeploying unless the Remotion version changed (`npm run lambda:function --workspace=remotion` is that command; do not run it unless it did).

Until you redeploy, a Lambda render uses the old site: no look-ahead, no catalog SFX, and the old envelope. Blueprints written by the new engine still render (new fields are optional), they just sound like before.

## 3. One-edit verification

Do this once, on one real talking-head video, before announcing.

1. Run one edit from your own terminal (this is the only step that can cost money):

   ```
   MUSIC_SPECIALIST=live npm run first-video -- /path/to/talking-head.mp4
   ```

   Run it on a video whose mood is `high-energy` first.
2. Find the line in `logs/engine.log`: `grep music.summary logs/engine.log | tail -1`.

   | Field | Expect |
   |---|---|
   | `source` | `pool` for high-energy (the salvaged bed is in that pool) with `costUsd` `0`. For a mood with an empty pool: `generated`, `costUsd` ≈ `0.0075`, and a `music.pool_appended` line. |
   | `voLufs` | A real number, not `-20` exactly. If it is exactly −20, look for `music.vo_lufs_assumed`. |
   | `intendedSpeechGapLu` / `intendedPauseGapLu` | `18` / `9` |
   | `carvedApplied` / `masterApplied` | `true` / `true` |
   | `finalLufs` / `finalTruePeak` | ≈ `−14` / at or under `−1` (about −2 to −3 is typical) |
   | `sfxHits` | Built-in hits are expected; `catalog` is `0` until you add sounds. |
   | `fallbackReason` | `null` |
3. `agents/music_specialist/spend.log` has a new line only when a bed was generated.
4. Open the file and listen:
   - the voice is always clearly on top;
   - the music is audible in the pauses, and drops before each phrase (not into it);
   - no click where the loop repeats (videos over about 58 s);
   - no sound effect lands on the start of a word.
5. For a Lambda edit (after §2), the same `music.summary` appears with `where: "lambda"`, followed by `music.master_pass` with `where: "lambda"`. If you see `music.master_pass_failed`, the unmastered file was served and the job has the warning `music:master_not_applied`.

## 4. Fine-tuning by ear

On the blueprint saved for that edit (`out/blueprints/…`). Each command writes `out/renders/…mp4`, free. Add `--measure 1` for numbers (`music.mix_measured`, including `bedOverVoiceWindows`).

```
# speech offset
npm run render-blueprint -- <bp> --speech-offset -16
npm run render-blueprint -- <bp> --speech-offset -18
npm run render-blueprint -- <bp> --speech-offset -20

# carved twin
npm run render-blueprint -- <bp> --carved 0
npm run render-blueprint -- <bp> --carved 1

# release
npm run render-blueprint -- <bp> --release-ms 300
npm run render-blueprint -- <bp> --release-ms 450

# look-ahead (0 = the old curve)
npm run render-blueprint -- <bp> --lead-ms 0
npm run render-blueprint -- <bp> --lead-ms 33.3
```

A rebuild keeps the timing the blueprint was saved with unless a flag overrides it.

## 5. Roll back (no code change)

- `MUSIC_SPECIALIST=off`: no bed on new edits. Old behaviour.
- `MUSIC_MASTER_PASS=0`: no master pass, local or Lambda.
- `MUSIC_CARVED_TWIN=0`, `MUSIC_DUCK_RELEASE_MS=450`: carved off, the old release, for new edits.
- Saved blueprints are never changed by any of these: they keep their stored envelope, bed URLs and hits.

## 6. Merge

1. Review the large `phase 1.1 checkpoint` commit (`54f7e9d`) on its own, first. It is not part of this feature's review.
2. Then review `bgm-phase-2` against `main`, and merge it. Nothing has been pushed, merged or deployed by the engine work.
3. Known failures that are not music: see the Phase 2.4 section of `MORNING_REPORT.md` for what fails on the branch and on `main`.
