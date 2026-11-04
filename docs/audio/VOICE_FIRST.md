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

## Numbers the engine already logs

| Log | What it proves |
|---|---|
| `music.mix_check` | the intended gaps (speech / pause) |
| `music.mix_measured` | measured `speechGapLu`, `pauseGapLuAll`, `pauseGapLuSettled`, settled pause count, `bedOverVoiceWindows`, final LUFS and true peak |
| `music.voice_fight` (warn) | one or more speech windows where the bed came within 6 LU of the voice |
| `music.master_pass` | loudness and true peak before and after the master pass |
| `music.qc_speech_band` (meta.json) | the share of bed energy in 1–4 kHz and its spectral flux. Log only; never rejects |
| `sfx.catalog_warning` | catalog problems (missing file, wrong duration, unknown cue) |

## Checklist for a new audio feature

- Does it ever raise the bed or an SFX relative to the voice? If so, do not ship it.
- Is its level defined relative to the measured voice LUFS, not as an absolute gain?
- Does it log a number a reviewer can compare to the rules above?
- Does it leave old blueprints rendering exactly as before?
