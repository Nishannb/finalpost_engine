# Director vs engine — one full-toolkit run

Date: 2026-09-20  
Clip: `/Users/nishanbaral/Downloads/24.mp4` (Gabby Beckford talking-head, 29.6s)  
B-roll: `/Users/nishanbaral/Downloads/o.mp4` (~2.0s couple silhouette at dusk)  
Model: `gemini-3.6-flash`  
Blueprint: `bp_8dfb8c10881e4ab58e2b`  
Output: https://media-kinmel.namantechnologies.biz/ai-video/render/2026-09-20/first_bp_8dfb8c10881e4ab58e2b.mp4

Command:

```bash
npm run first-video -- "/Users/nishanbaral/Downloads/24.mp4" auto \
  --edits=inset_reveal,depth_overlay,cutaway \
  --captions=karaoke \
  --delivery-shaping \
  --broll="/Users/nishanbaral/Downloads/o.mp4"
```

Raw traces (full prompt + raw model JSON): `ai-video-engine/director-dump/`

---

## Conclusion

**Both are failing, but the engine is the reason the edit does not match what we asked. The flash director is too sloppy to be a real editor. A stronger model would help JSON hygiene and timing. It would not, by itself, produce the edit we want.**

Gemini never sees pixels. It only reads the transcript + occupancy text + a 2-second asset description, then returns JSON. The engine then restimes, leftover-injects the user clip, drops zooms, fails delivery shaping, and composites without a real speaker mask. So the “director” is a brief-writer, and the “editor” is a pile of post-filters that do not faithfully execute that brief.

| Layer | Verdict |
| --- | --- |
| `gemini-3.6-flash` | Weak for this job. Generic plan, no zooms, never attached `ub_1` to a cutaway, then looped a garbage `user_broll_id` for thousands of tokens. |
| Engine assembler | Stronger bottleneck. Rewrites timestamps, force-places leftover B-roll at 3.5s instead of the directed 11.6s, kills always-on zooms, occupancy is fallback, speaker cutout is unavailable, delivery shaping crashed on true-peak. |
| Prompt contract | Contradicts itself. System says “do not apply every tool.” Allowlist says “MUST place each required toolkit.” |

Upgrading the model without fixing the assembler will still look like “AI didn’t edit properly.” Fixing the assembler without a stricter director will still get vague/wrong JSON.

---

## What we asked vs what shipped

| Toolkit | Gemini said | Engine shipped |
| --- | --- | --- |
| karaoke captions | yes, white + gold | yes, but recolored to `#111111` / `#F5B942` |
| hook title | `BUILD YOUR DREAM LIFE`, style `duo` | `Build Your Dream Life`, style **`stack`**, 1.2s at 4.44s |
| cutaway | two stock cutaways at **11.64s** and **23.54s**; never set `user_broll_id` | **one** user clip at **3.50–8.08s** (not the directed time). Second stock query `no_match` |
| depth_overlay | 18.50–20.66, then a looping fake id | 17.46–19.62 using `o.mp4`, occupancy crop (no real mask) |
| inset_reveal | 13.46–15.30, variant field was garbage text | 12.42–15.82, `simple` |
| zoom | none | engine filled two, then **dropped both** (overlap with cutaway/depth/inset) |
| delivery_shaping | N/A (audio preflight) | planned `subtle`, then **failed** (`-1 dBTP` ceiling). Auto-trim still cut 1.04s |

Warnings on the blueprint:

`delivery_shaping_failed`, `no_match:solo woman traveler city`, `occupancy_fallback`, `layout_patch:geometric`, `speaker_cutout_crop`

---

## 1. What we send Gemini (the instruction)

Gemini is told it is both video editor and motion designer. It does **not** get the video file. It gets:

- clip duration
- occupancy text (`speaker_box` from **fallback**, legal slots: **none**)
- `SPEAKER_CUTOUT: not available`
- user asset `ub_1` described as a romantic couple kissing (~2.0s)
- word-level timestamps
- `REQUIRED_EDIT_STYLES: cutaway, delivery_shaping, depth_overlay, inset_reveal`
- caption locked to karaoke

The user prompt this run (verbatim):

```
Clip duration: 29.6 seconds.
Propose up to 5 moments.
Analyze this talking-head and choose a unique subset of primitives — do not apply every tool, and do not copy a previous edit format.
Time every graphic and B-roll to the TIMESTAMPED_WORDS it illustrates. No guessed clocks.
Place every graphic in a LEGAL_SLOT from FRAME_OCCUPANCY. Never cover the speaker or the caption band.
All search_keyword, queries, and visual_world MUST be 2–4 English words naming a visible Pexels scene.
Match the overall TOPIC — never a single random noun. Include video cutaways for list items only if they help the viewer see the point.
Pick a hook_style that fits THIS video. Use motion primitives only when they serve this transcript.
Add motion_graphics when a claim should stay on screen long enough to read. media_containers only if the leftover canvas will hold real assets or a title.
Design caption.template + caption.animation for THIS video. Default to clean/minimal/subtitle/karaoke. Never default to a shiny spoken-word border.
ALLOWED_EDIT_STYLES: cutaway, delivery_shaping, depth_overlay, inset_reveal
REQUIRED_EDIT_STYLES: cutaway, delivery_shaping, depth_overlay, inset_reveal
You MUST place each required visual toolkit at least once. Decide WHERE on the spoken timeline, not WHETHER to use it.
You may ONLY emit these element kinds: hook_title, cutaway, zoom, depth_overlay, inset_reveal.
delivery_shaping is enabled as an audio/pacing preflight. It is not a visual element kind. Visual timestamps are already on the shaped timeline.
hook_title and zoom are always on. Place them even if they are not listed above.
Captions still render (they are not an element kind). Pick textColor/highlightColor that contrast THIS footage — never white-on-white or teal-on-cream.
Do not emit any other visual toolkit. Do not add split unless split is in REQUIRED_EDIT_STYLES.
cutaway replaces the talking head. depth_overlay keeps the masked speaker in front and slides a clip in from above or below, then plays it.
The same USER B-roll file may be reused for cutaway and depth_overlay at non-overlapping times.
Every title, lockup, and overlay_text must cover only the TIMESTAMPED_WORDS it quotes.
CAPTION_TEMPLATE is locked to karaoke. Set caption.template to karaoke. Do not pick another kinetic look.
FRAME_OCCUPANCY (9:16 fractions). Never cover the speaker box with graphics, cards, titles, or emphasis.
speaker_box: x=0.18 y=0.16 w=0.64 h=0.62 source=fallback
open_side: left
LEGAL_SLOTS (accent overlays only):
- none; keep the talking-head full-bleed and use cutaways instead of shrinking it
media_containers are optional. pip_corner is legal ONLY when timed hero cards/graphics fill the leftover canvas. An empty canvas (plain white/color with a small speaker tile) is a failed edit — keep full-bleed.
optional_pip_slots: none
CAPTION_BAND y>=0.76 is reserved. Titles, cards, and pip tiles must end above y=0.72.
SPEAKER_CUTOUT: not available (busy background). Do not use layout=cutout.

USER_ASSETS (place these as designed cards or cutaways; set user_broll_id; each id once):
- ub_1 [clip] A romantic silhouette of a couple embracing and kissing against a warm dusk sky with distant mountains. (~2.0s)
Documents → layout=card treatment=focus with focus_region matching spoken words.
Tall clips/images → treatment=scroll. Photos → treatment=card with glow.
TIMESTAMPED_WORDS (use these start/end times; overlay_text must match the words on screen):
0 [0.08-0.70] I'm
1 [0.70-0.98] Gabby
... (88 words through "financial freedom" at 28.22)
Transcript:
I'm Gabby Beckford, I go by app Pax Lite online. I am a travel and lifestyle content creator and speaker. But what I really do is help women in their late 20s to late 40s build their dream lives and take their dream trips. I have a community of about a million plus online and it is full of smart, ambitious women who want to live big, bold lives of adventure in every way. They wanna see the world, travel solo, negotiate six figure salaries, achieve financial freedom.
```

System instruction (in `geminiDirector.ts`) also says:

- “Never require a primitive just because it exists.”
- depth_overlay needs a subject mask; “Do not use if no mask”
- inset_reveal must snap to sentence boundaries, not first 3s / last 2s

That fights the allowlist block: “You MUST place each required visual toolkit at least once.” Occupancy also says legal slots are **none**, so the model is told to use cutaways instead of overlays, then required to emit depth_overlay anyway.

Token use this call: 5721 prompt, 2097 thinking, 5509 output. Most of the output tokens were a **string loop** on `user_broll_id`, not a better edit.

---

## 2. What Gemini actually returned

Cleaned copy of the usable JSON (the `user_broll_id` field was a ~5k-character loop of `ub_10101010-0000-...`; not pasted in full):

```json
{
  "hook_title": "BUILD YOUR DREAM LIFE",
  "topic": "Travel and Lifestyle Content Creator Community",
  "caption": {
    "template": "karaoke",
    "position": "bottom",
    "box": false,
    "animation": "karaoke",
    "font_scale": 1,
    "highlight_color": "#F59E0B",
    "text_color": "#FFFFFF"
  },
  "moments": [
    {
      "timestamp": 11.64,
      "search_keyword": "woman tropical beach vacation",
      "media": "video",
      "layout": "cutaway",
      "why": "Illustrate taking dream trips with vivid travel visual"
    },
    {
      "timestamp": 23.54,
      "search_keyword": "solo woman traveler city",
      "media": "video",
      "layout": "cutaway",
      "why": "Visualizes traveling solo abroad"
    }
  ],
  "depth_overlays": [
    {
      "start": 18.5,
      "end": 20.66,
      "user_broll_id": "ub_10101010-0000-…(looped until output filled)"
    }
  ],
  "inset_reveals": [
    {
      "start": 13.46,
      "end": 15.3,
      "variant": "motion_graphicPlugin key constraint: `ub_1` ID mapping required string asset name directly in JSON."
    }
  ]
}
```

What this plan gets right:

- Karaoke honored.
- Cutaway 1 is timed to “take their dream trips” (11.64).
- Cutaway 2 is timed to “travel solo” (23.54).
- Inset sits on “community / million plus” (13.46).
- Depth sits on “want to live big” (18.50).

What this plan gets wrong (model):

- Generic hook, not a specific spoken line.
- No zooms even though the prompt said zoom is always on.
- Never set `user_broll_id: "ub_1"` on a cutaway, even though the prompt said to place user assets and reuse the file.
- Did not notice `o.mp4` is a 2s couple-kissing clip, not beach travel or “million community.”
- Depth/inset JSON is malformed (id loop, garbage `variant` string). This is typical flash-model schema collapse, not a thoughtful edit.
- Parser then invented two `WATCH THIS` motion graphics that were not in the JSON. Those died later because `kinetic_text` was not in the allowlist.

---

## 3. What the engine did to that plan

### Engine-only rewrites (not Gemini)

1. **User B-roll leftover injection.** Gemini wanted a *stock* beach cutaway at 11.64s. The engine put `o.mp4` as a cutaway at **3.50–8.08s** (intro / “I am a travel…”). That is leftover/forced placement of unused uploads, not director timing.
2. **Second cutaway dropped.** `no_match:solo woman traveler city`. Query rewriter expanded it to junk like `woman solo woman traveler`.
3. **Hook style `duo` → `stack`.** Occupancy compositor / layout patch. Gemini’s design did not survive.
4. **Caption colors rewritten** for contrast (`#FFFFFF` → `#111111`).
5. **Inset/depth retimed** (13.46→12.42, 18.50→17.46) by speech-align + planners.
6. **Zooms filled then deleted.** After-allowlist still had zooms at 8.28s and 18.33s. `resolveDirectedZooms` blocked them against the cutaway, inset, and depth windows. Final `zoomTriggerCount`: 0.
7. **Delivery shaping** ran acoustics, planned a dynamics chain, then ffmpeg failed true-peak. Director never touched audio.
8. **Depth overlay cannot do the promised shot.** `SPEAKER_CUTOUT: not available`, occupancy `source=fallback`. Compositor falls back to an occupancy crop, so it will not look like “clip sliding in behind a masked speaker.”
9. **Same 2s loop used twice.** Cutaway + depth both burn `o.mp4` (couple kissing) over a travel-community monologue.

Until this diagnostic run, Gemini’s **response schema did not even include `depth_overlays` / `inset_reveals`**, while the system prompt asked for those arrays. Structured output then cannot emit the required tools. That is an engine contract bug, not a weak model.

---

## 4. Is the model too weak, or is the engine not powerful enough?

### The model is too weak for “be the editor”

`gemini-3.6-flash` is a cheap brief-writer:

- It cannot see the talking-head or the B-roll pixels.
- It does not bind `ub_1` correctly.
- It hallucinates unconstrained strings.
- It does not plan zooms, LUTs, or graphic copy.
- A 2s kissing silhouette is a bad asset for this speech; a real editor would say so. Flash still scheduled it.

A stronger director (Pro / a vision pass on stills + the user clip) would write cleaner JSON and better timestamps. Worth doing later. Not the main miss on this video.

### The engine is not a faithful editor

Even if Gemini had returned a perfect plan, this pipeline would still:

- Move or replace cutaways with leftover user media.
- Drop zooms that collide with other tools.
- Composite depth overlay without a real person mask on this clip.
- Change hook treatment in layout.
- Fail delivery shaping independently.

The renderer *can* draw karaoke, inset cards, a cutaway, and a depth plate. Those primitives exist. What it cannot do is take a director brief and execute it as specified, and it cannot invent a cinematic behind-subject composite when cutout/occupancy already said “not available.”

### Bottom line

**We are underpowered in the assembler, and under-specified in the director.**

- Weak flash director → vague / broken JSON.
- Engine post-processing → the JSON is not the edit.
- Missing vision + missing mask → depth overlay cannot match the “speaker in front, clip behind” look on this footage.

Fix order if the goal is “the edit we asked for”:

1. Stop leftover B-roll from overriding directed timestamps.
2. Put `depth_overlays` / `inset_reveals` in the schema **with maxLength** so flash cannot loop ids (schema fields were added on this run; string caps were not).
3. If occupancy/cutout is unavailable, do not pretend depth_overlay is possible — skip or use cutaway.
4. Do not fill zooms on top of other tools and then silently drop them.
5. Only then spend money on a stronger / vision director.

Until (1)–(4), swapping models will not make this look like a human edit.
