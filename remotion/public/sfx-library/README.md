# SFX library

Sound effects the engine can pick for an edit. **You add the files by hand.** The engine never downloads, generates or edits anything in this folder.

SFX only punctuate the edit. They never cover a word: the engine skips a hit that would land within 120 ms after a word onset, keeps the hit cap and spacing, and plays every sound **about 10 LU under the creator's voice** (`SFX_VOICE_OFFSET_LU`, default −10, plus the file's `gainDb`, never closer than −6 LU). See `docs/audio/VOICE_FIRST.md`.

Folder: `remotion/public/sfx-library/` (lowercase, on purpose: `remotion/public/sfx/` already holds the three built-in wavs, and `SFX` and `sfx` are the same folder on macOS but different on Linux and Lambda).

## How to add a sound

1. Copy the file (wav, mp3 or m4a) into this folder. Make it start at 0.0 s (no leading silence) and peak at about −1 dBFS.
2. Add an entry to `sfxinfo.json`, then run `npm run sfx:check` and fix what it suggests.

```json
[
  {
    "fileName": "whoosh_soft_01.wav",
    "duration": 0.42,
    "tobeused": ["cut", "transition"],
    "gainDb": 0,
    "notes": "airy, short, good under fast cuts"
  }
]
```

| Field | Required | Meaning |
|---|---|---|
| `fileName` | yes | File inside this folder (wav, mp3 or m4a). |
| `duration` | yes | Length in seconds. |
| `tobeused` | yes | When to use it: an array of cue names from the table below. A single comma-separated string is also accepted. |
| `gainDb` | no | Per-file level trim, default 0. |
| `notes` | no | Free text, ignored by the engine. |

## Cues (`tobeused`)

| Value | When it plays |
|---|---|
| `cut` | Hard visual cut. |
| `transition` | Scene or section change. |
| `zoom_in` | Punch-in or zoom. |
| `zoom_out` | Pull-out. |
| `caption_pop` | An emphasized caption word appearing. |
| `kinetic_plate` | Kinetic text plate entrance. |
| `emphasis` | A key point or reveal. |
| `hook` | Opening second of the video. |
| `cta` | Call-to-action moment near the end. |
| `ui` | App or screen UI moments: click, tap, notification. |
| `ambience` | A background texture that loops under a section. |

**Wired today:** `cut`, `transition`, `zoom_in`, `kinetic_plate`, `emphasis` (these are the moments `polishSfx` already schedules). The other values are accepted and checked, and are reserved for later wiring, so an entry that uses only those is valid but is not played yet.

## How the engine picks

- It takes the hits `polishSfx` schedules, finds the entries whose `tobeused` includes that hit's cue, and chooses one deterministically from `hash(videoId + cue + time)`. A re-render picks the same file.
- No matching entry, or an empty catalog: the built-in whoosh, hit or pop plays exactly as before.

## `npm run sfx:check`

Read-only. It checks that every file exists, that `duration` is within 50 ms of the real length, that `tobeused` values are known, that every file in the folder has an entry, and that no file has more than 10 ms of leading silence. It also warns when the peak is outside −3…0 dBFS, because the engine assumes about −1. It prints suggestions and never edits your files. The engine runs the same check at startup and logs `sfx.catalog_warning` (non-fatal).
