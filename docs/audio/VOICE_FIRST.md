# Voice-first audio policy

Most videos on the app are talking-head content. **The creator's voice is the product.** Background music and sound effects exist to support the voice. They never compete with it or overshadow it.

> When in doubt, the music gets quieter, simpler or carved. Never make the voice harder to hear.

This file is written for engineers and for AI agents working in this repo. `CLAUDE.md` links here.

## Rules

1. **The voice is the loudest, clearest element in every speech window.** The bed never exceeds the voice there.
2. **Bed levels are measured relative to the creator's voice** (`talking` duck preset, `server/src/stages/music/duckEnvelope.ts`):
   - speech: 18 LU under the voice;
   - pause: 9 LU under;
   - open sections (no speech): 4 LU under.

   These are starting points, tuned by ear. Tune them by making the music quieter, never louder. Do not change the −18 default to hide a measurement problem.
3. **Music arrangement is supportive.** Sparse, steady, no lead melody, no vocals, no busy energy in the 1–4 kHz speech band. Prefer pads, soft keys, light plucks and simple drums. (`agents/music_specialist/prompts.py`.)
4. **Final mix: −14 LUFS integrated, −1 dBTP true peak.** The local master pass does this (`MUSIC_MASTER_PASS`, on by default).
5. **SFX punctuate the edit. They never cover a word.** No hit within 120 ms after a word onset, a capped count, and a level set relative to the voice too (`SFX_VOICE_OFFSET_LU`, default −10).
6. **Any new audio feature must log a number that proves it respects these rules.**

## Production defaults (voice-first)

Each is the default when unset and keeps its env override. They apply to **new** edits; a saved blueprint keeps the values it was saved with.

| Setting | Default | Override |
|---|---|---|
| Duck preset, speech / pause / open | `talking`, −18 / −9 / −4 LU under the voice | `MUSIC_DUCK_PRESET`, `render-blueprint --speech-offset` etc. |
| Release | 300 ms (hold 150 ms) | `MUSIC_DUCK_RELEASE_MS`, `--release-ms` |
| Attack look-ahead | one frame (33 ms): the dip finishes before the word | `--lead-ms` |
| Carved bed under speech | on | `MUSIC_CARVED_TWIN=0` |
| Master pass (−14 LUFS, −1 dBTP), local **and** Lambda | on | `MUSIC_MASTER_PASS=0` |
| Pool size per mood | 3 | `MUSIC_BED_POOL_SIZE` |

Remotion rounds every volume to a multiple of 1/97, so a bed or SFX level can land up to about half a step off its target (about 0.3 dB at the −22 dB speech gain, up to about 1.5 dB for a −30 dBFS SFX). That is outside our control and is not corrected.

## Personalised music (Phase 3)

`MUSIC_PERSONALIZE` (default `1`) applies to **new** edits only; a saved blueprint renders exactly as before. `0` restores Phase 2.4 (5 family moods, no placement).

- **MusicBrief** (`server/src/stages/music/musicBrief.ts`): a pure function of data the director already has: caption words, content mood and type, duration, the cuts known so far. No extra LLM call. Output is logged as `music.brief`.
- **Styles** (`briefRules.json`): 10 styles, each in one of the 5 families, each with at most 12 caption tags including the voice-first ones (no lead melody, no vocals), a tempo range, a preferred mode and 4 or 5 roots. Every visual mood x content type maps to a style (a test fails on any gap). A style's family is its pool fallback.
- **Tempo** from the creator's speech pace (speech time only, pauses over 600 ms excluded): under 130 wpm the low end of the style's range, 130 to 170 the middle, over 170 the high end, one band up when the cut rate is over 30 a minute, always a multiple of 4 inside the range. **Key**: the style's mode, a root from `hash(videoId)`: varied across videos, stable across re-renders.
- **Arc** is requested, then measured: under 25 s `hook-then-steady`, 25 to 60 s `build` (unless low energy), longer or low energy `steady`, sent as section tags in `settings.lyrics`. Placement never trusts the request: postprocess measures a per-bar energy map and the lift bar on the bed itself.
- **Placement** (`placement.ts`): frame 0 lands on a bed downbeat. Candidates are scored 3.0 for the lift landing near the hook, 1.5 for the bed's energy following the video's intensity, 0.5 for a quiet intro bar, 0.2 for covering the video without a hand-off. The ending is the last bar line (a 120 ms fade, then silence) or, if that is more than 1.5 s early, a hold with a 400 ms fade. The loop hand-off is on a bar line.
- **SFX** snap to the nearest beat within 60 ms; the 120 ms word mask always wins; with a catalog `hook` entry a hit plays on frame 0, with a `cta` entry on the bar line nearest the CTA. Cap and spacing hold.
- **Voice-first guard (Phase 3.1):** placement and the brief write times, a tempo, a style and a fade length. Placement never writes a gain itself. **Gains are computed from the measured loudness of the bed section actually playing** (loudness-aware ducking, below), so the gap to the voice holds wherever on the bed placement starts. The only other level change is the end fade, which is between 0 and 1.

### Loudness-aware ducking

The static envelope assumed the bed sits at -16 LUFS everywhere. A real bed has quiet intros and loud sections, so the speech and pause gaps moved with whichever section placement put under the voice. Now:

- `postprocess.py` (version 5) stores short-term LUFS **per bar**, aligned to the downbeats, for `bed_full`, `bed_carved` and `bed_loop` (`loudness_map`, `carved_loudness_map`, `loop_loudness_map` in `meta.json` and in the pool entry).
- After placement, `bedLoudness.ts` builds the loudness of the section playing at each moment of the video: the full bed from the start offset, then the loop body from the hand-off; under speech the carved twin, mixed with the renderer's own crossfade weights. It is smoothed over about one bar and limited to 0.4 dB per frame (30 fps), and stored on the duck as `bedLoudness` (a sampled track).
- The envelope (`duckEnvelope.ts`, and the same file in Remotion) adds a correction to the static curve: `gain(t) = clamp((voice + offset) - bedLoudness(t))` in dB, written as the static gain plus `(assumed -16) - bedLoudness(t)`. The correction is **never more than +6 dB** (a near-silent intro is not pumped up: it stays quieter than the target, never louder) and the total stays in [-40, 0] dB. Attack, hold, release and look-ahead are unchanged.
- An older bed with no loudness map, an older blueprint, and every preset except `talking` get no correction: they behave exactly as before.
- `music.summary` reports `loudnessAware` and the lowest and highest correction applied (`loudnessCorrectionDb`).

Limit: the correction is capped at +6 dB, so a bed whose quiet section is more than 6 LU under its average will still sit a little under target there (the safe side).

Pools are keyed by **style**. Fallback when generation fails, times out or misses the cost cap: the same style's bed with the nearest tempo, then the same family's, then no bed (`music.fallback {reason, tier}`).

### Tuning `briefRules.json`

One file, read by the server and by `agents/music_specialist/prompts.py`; no code change needed. Edit a style's `bpmRange` (ends must be multiples of 4), `roots`, `mode` or tags (keep the total at 12 or fewer and keep `no lead melody`), the `pace` thresholds, the `arc` cut-offs or the `matrix` (visual mood x content type -> style). `npm test` in `server` fails if any combination is unmapped, a tempo end is not a multiple of 4, or a style breaks the tag budget. Any change to a style's tags or an arc's lyrics changes the generation cache key by design; bump `PROMPT_VERSION` in `agents/music_specialist/models.py` when you change what the model is asked for. The file is imported (not read with `fs`), so the production build emits it; the Dockerfile copies it for Python.

## SFX library

Human-curated sounds live in `remotion/public/sfx-library/` (lowercase, deliberately: `remotion/public/sfx/` holds the built-in wavs and `SFX` would be the same folder on macOS but a different one on Linux and Lambda). See its `README.md`. No hit lands within 120 ms after a word onset: built-in hits are masked when a new edit is scheduled, and catalog hits are masked again when a file is picked. Saved blueprints keep their stored hits.

## Numbers the engine already logs

| Log | What it proves |
|---|---|
| `music.mix_check` | the intended gaps (speech / pause) |
| `music.mix_measured` | measured `speechGapLu`, `pauseGapLuAll`, `pauseGapLuSettled`, settled pause count, `bedOverVoiceWindows`, final LUFS and true peak |
| `music.voice_fight` (warn) | one or more speech windows where the bed came within 6 LU of the voice |
| `music.master_pass` | loudness and true peak before and after the master pass (local and Lambda) |
| `music.summary` | one line per render: source, cost, voice LUFS, intended gaps, carved, master, final LUFS / true peak, SFX by source, fallback reason |
| `music.pool_appended` | a new bed joined a style pool, with the pool size |
| `music.brief` | the brief for a new edit: style, family, tempo, key, speech pace, cut rate, energy, arc |
| `music.placement` | start offset, where the lift lands against the hook, score, ending type, snap counts |
| `music.summary` `loudnessAware`, `loudnessCorrectionDb` | whether the duck followed the bed section playing, and the range of dB it added to the static gain |
| `sfx.beat_snap` | hits snapped to the beat, dropped by the mask or spacing, and whether a catalog hook / CTA hit was added |
| `music.qc_speech_band` (meta.json) | the share of bed energy in 1–4 kHz and its spectral flux. Log only; never rejects |
| `sfx.catalog_warning` | catalog problems (missing file, wrong duration, unknown cue) |

## Checklist for a new audio feature

- Does it ever raise the bed or an SFX relative to the voice? If so, do not ship it.
- Is its level defined relative to the measured voice LUFS, not as an absolute gain?
- Does it log a number a reviewer can compare to the rules above?
- Does it leave old blueprints rendering exactly as before?
