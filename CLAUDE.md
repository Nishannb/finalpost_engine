# Standing rules for Claude Code in finalpost_engine

These rules apply to every task in this repo, even if a later prompt forgets to repeat them.

## Money

- **Never call Runware.**
    - Never use `MUSIC_SPECIALIST=live`, `--mode live`, `MUSIC_SPECIALIST_CALLER=pipeline`, `MUSIC_BED_FRESH=1` or `--confirm-spend`.
    - Music is generated only when the human runs a video edit in their own terminal.
- **Never call paid model APIs.**
    - No Groq, Gemini, Claude, MiniMax or other LLM/media API, and no Remotion Lambda.
    - That means you never run `npm run first-video` or anything that calls `analyzeVideo`.
- **What you may run:** local Remotion renders, local ffmpeg/Python, and `npm run render-blueprint`.
- **Spend check:** `agents/music_specialist/spend.log` must not change during your work. Check it at the start and end of every task, and report it.
- **If a task seems to need a paid call, stop and ask.** Give the reason, the number of calls and the estimated cost.

## Storage

- Do not write to R2 unless the task names the exact keys.
- Never write a new bed into `music/beds/pool/`.

## Secrets

- Never print, log or commit `RUNWARE_API_KEY` or any `.env` value.
- Do not edit `.env`. Use placeholders only in `.env.example`.

## Git

- Work on branch `bgm-phase-2` unless told otherwise.
- Commit after each task that passes its checks.
- Never push, merge, force-push or deploy.

## Scope

- Keep `polishSfx`, kinetic typography and WP27 behavior intact.
- Old blueprints must render exactly as before.
- Leave the 3 known Remotion `tsc` errors in `ShortVideo.tsx` (lines 286, 299, 300) alone.

## Checks after every task

1. pytest in `agents/`: `./.venv/bin/python -m pytest music_specialist/tests -q`
2. The server music vitest suites.
3. Server `tsc --noEmit`.
4. Remotion `tsc`: only the 3 known errors are allowed.

If a check still fails after 2 fix attempts, revert the uncommitted changes and report the task as blocked.

## Reporting

- Add a dated section at the top of `MORNING_REPORT.md` covering:
    - spend proof;
    - each task's status, files, tests and commit hash;
    - anything that needs a human decision.
- Then stop.

## Audio policy

The creator's voice is the product; music and SFX only support it. When in doubt the music gets quieter, simpler or carved, never the voice harder to hear.

- The bed never exceeds the voice in a speech window. Bed levels are relative to the voice: speech −18 LU, pause −9 LU, open −4 LU. Tune by making music quieter, never louder.
- Music is sparse and supportive: no lead melody, no vocals, nothing busy in 1–4 kHz.
- Final mix −14 LUFS integrated, −1 dBTP.
- SFX never cover a word (no hit within 120 ms after a word onset, capped count, level relative to the voice).
- Any new audio feature must log a number that proves it respects these rules.

Full rules and the list of logs: [docs/audio/VOICE_FIRST.md](docs/audio/VOICE_FIRST.md).
