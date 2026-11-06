# Kinetic Typography v2: foundation decision (Part E) and plan for Parts A to D

Branch `feat/kinetic-v2` (from engine `feat/edit-styles` 9c921f2), worktree `~/Desktop/apps/finalpost_engine-kinetic-v2`.
Status: **Checkpoint 1. Nothing built yet. Awaiting approval.**

The rule: **the Director decides WHAT, the type engine decides HOW.** The LLM tags meaning. Deterministic code owns pixels, sizes, colours, frames and
easing. Same input gives the same output.

## 1. Why the current renders fail (hi.mp4, `~/Desktop/style-verify-2026-11-06-final/hi-kinetic_typography`)

- What the viewer sees: Skill A one-word captions in white, centred on the chest, with the same size, colour and motion all the way through. Kinetic
  type adds only **3 beats in 45 s**: a word pop ("real"), a mesh ground and a full-frame match cut.
- The Director returned `kinetic_type:director:0_of_0`, so the regex fallback chose the beats.
- `environmental:skipped:no_matte_no_headroom`: the hero was skipped on tight framing.
- Nothing directs phrases, energy or the word hierarchy, so there is nothing for the type to express.

## 2. Part E: the three existing kinetic code paths

| | Skill C textual MG | Kinetic-Led (WP55/57, clip_35..55) | Standalone `stages/kinetic/` (18 presets + playbook) |
|---|---|---|---|
| Unit of work | sparse plates (max 5 per clip, about 1 per 8 s) | discrete template beats (about 1 per 3.5 s, max 24) | **every word**: a continuous track of lockups plus gap captions |
| Who decides | regex triggers (stat / pivot / CTA) | Director picks template ids, then regex fallback | Gemini `KineticPlan` (roles, presets, entry / exit, accent, pose), then deterministic fallback |
| Word hierarchy | none | per template | hero / support / connector / punch, with sizes on a ratio |
| Timing | plate windows | each template has its own clock and easing | frame-exact; words enter 1 to 2 frames before onset; central cubic-bezier |
| Render path | `GeneratedGraphicTrack` modules | **published module per beat** (R2 + a runtime Remotion check), so local replay needs R2 | `blueprint.kinetic` -> `KineticTrack` mounted **directly in `ShortVideo`**, no publishing |
| Layout | plate recipe | per template; the hero is skipped on tight framing | solver: safe rect, face keep-out, occlusion, guardrail re-verification, seeded |
| Tests | catalog parity | planner tests | 125 tests, all pass on this branch (determinism, safe rect, schema parity) |
| Wired into HTTP | yes (flag) | yes (the current Kinetic style) | **no** (CLI only); its timebase is source frames, so it ignores the keep-plan cuts |
| Conflicts with the v2 brief | sparse by design | a random mix of template looks, publishing cost, per-template easing | mixes font families per video (`fontPair` street / editorial / neon); 18 legacy presets, 3D extrusion and accent cycling are noise |

### Recommendation: a new module `stages/kineticV2/` + `remotion/src/kineticV2/`, built on the standalone engine's chassis

**Keep** (move or import from the standalone engine):

- The plan / spec split and the strict zod contracts, with a byte-identical server / Remotion copy and a parity test.
- Mounting as a blueprint track in `ShortVideo`. This needs no R2 publishing, so replay renders fully locally.
- The safe rect, face keep-out, guardrail re-verification, seeded determinism tests, `cubicBezier` and word-keyframe primitives.
- Gap-free word coverage: every spoken word is shown by the type track, so it replaces captions rather than sitting on top of them.

**Do not carry over:** the 18 legacy presets, `fontPair` (more than one family), 3D extrusion, behind-matte signatures (no RVM in production),
match-cut-as-preset, or the old director prompt.

**Drop for this style:** Kinetic-Led beats, Skill C and motion-template text beats. A v2 job turns them off, so one type system owns the screen.

**Why not extend the standalone module in place:** its contracts (`KineticPlan` v1, preset enum, `fontPair`) contradict "one family, variance
everywhere else". Rewriting them in place would break its 125 pinned tests and the CLI for no gain. A clean v2 contract beside it keeps both honest.
The old module stays untouched as a CLI.

**Why not Kinetic-Led:** each beat is a separately published template with its own clock and easing. A per-video motion grammar, central springs,
push-through between beats and full word coverage cannot be expressed across independent modules, and every render needs R2.

**Fixed in v2:** the timebase becomes **output frames** (word times mapped through `keepSegments`), the same timebase as every other blueprint track.
The speaker zoom (`zoomTriggers`) is applied to the face box before any overlap test.

## 3. Plan

### Part A: record once, replay forever (built first)

- **Tape at the single model choke point.**
  - Every Groq and Gemini call goes through `lib/http.ts requestWithRetry` (checked; `spendGuard.ts` already wraps `fetch` the same way).
  - A `modelTape` fetch wrapper, installed only by the eval script, works in two modes:
    - **record**: forwards the request and stores status, response body and `usageMetadata`;
    - **replay**: serves the stored response and never touches the network.
  - The key is `label + model + ordinal-within-label + sha256(request body)`.
  - A replay miss, or a body digest that differs (the prompt or an upstream input changed), **fails closed** with "re-record needed: <stage>".
  - Production code is unchanged: replay swaps only the model responses.
- **Fixture folder:** `server/src/eval/fixtures/kinetic-v2/<clipSha12>/<promptVersion>/`, containing:
  - `tape.jsonl` (the source of truth);
  - `manifest.json` (clip hash, prompt versions, models, per-call tokens and estimated USD, date, git sha);
  - readable copies of each stage output: transcript and word timestamps, keep plan, story analysis, creative director, perception, speaker
    position, content profile, motion director and kinetic direction (through the existing `DIRECTOR_DUMP_DIR` hooks plus new ones).
- **`promptVersion`** is a digest of every Director system prompt and the model ids. Changing a prompt changes the folder, so a stale tape cannot
  replay silently.
- **Script `server/src/scripts/kineticV2.ts`:**
  - `record --clip id=path --approved`: refuses without `--approved`; uses an explicit `--env-file` and the styleVerify guards (no override
    `.env`, local render, `LOCAL_RENDER_SKIP_R2=1`, no Claude / Runware / Lambda, test bucket only); spend guard with a call cap and a USD cap.
  - `replay --all`: the default; zero network to model hosts. A guard asserts it.
- **Source video in replay:** served from a loopback static server (no R2). If `startAnalysis` cannot take a local URL, I add a test-only source
  hook and report it.
- **Models:**
  - `KINETIC_DIRECTOR_MODEL` env for the kinetic Director stages only (default: today's `GEMINI_MODEL`, so production is unchanged).
  - Every other stage stays on Flash.
  - Each call logs input / output / thinking tokens, and the manifest totals them.

### Part B: kinetic direction (Director output)

One new Gemini call after the transcript and keep plan (output timeline), on `KINETIC_DIRECTOR_MODEL`. Schema `KineticDirection v1`:

```
{ version: "1",
  tone: "bold" | "calm" | "playful" | "tech" | "editorial",                      // the engine maps this to family / palette / grammar
  phrases: [{ id, wordRange: [a, b],                                             // contiguous; together they cover every kept word exactly once
              lines: [[wordIdx...]],                                             // on-screen line grouping, max 4 lines, max 6 words per phrase card
              energy: 0..4,                                                      // calm .. explosive
              emotion: "neutral|warm|serious|excited|urgent|playful|surprised|reflective",
              beat: "hook|setup|build|payoff|aside|cta",
              words: [{ idx, role: "hero|emphasis|support|connector",
                        emphasis: 0..3, hint?: "number|name|contrast|punchline|question|list_item" }] }] }
```

- **Validation:** zod, then transcript fidelity (indices exist, the coverage is exact, lines partition the phrase, at most 1 hero per phrase,
  `hint: number` only on words that contain a number).
- **On failure:** **one repair call** with the validator errors, then a **deterministic fallback**:
  - phrases split at pauses / punctuation, at most 6 words each;
  - stopwords become connectors;
  - the emphasis score picks the hero;
  - a regex supplies the number / question / contrast hints.
- The direction is recorded in the tape and dumped as a readable file.

### Part C: typography system

- **One family per video,** picked deterministically from `tone` (the clip hash breaks ties). The curated set is all OFL, bundled as woff2 with
  licences, never fetched at render:

  | Family | Tone | On disk |
  |---|---|---|
  | Inter 300-900 | tech / calm | yes |
  | Poppins 300-900 | playful / creator | yes |
  | **Archivo** (variable weight + width) | bold: condensed heroes in the same family | to add |
  | **Fraunces** (variable serif + italic) | editorial | to add |

  Glyph advances are precomputed from the font files with fontTools (already in the image for CaptionKit), so measurement is exact rather than
  Inter-scaled.
- **Size:** a modular scale (ratio 1.333):
  - connector = step 0;
  - support = +1 to +2;
  - emphasis = +3;
  - hero = +4 to +5 (3.2 to 4.2 times a connector).

  The base size comes from the frame and the number of words on screen.
- **Other variance within the family:** weight (300 connectors, 900 heroes), case (caps heroes), tracking (tight on big, open on small), leading
  0.86 to 1.0.
- **Palette:** per video, 3 to 4 colours (base, accent, highlight, optional plate) from a curated set chosen by tone and the plate's measured
  luminance / hue.
  - Colour follows meaning: hero and number = highlight; contrast word = accent; support = base; connector = base at 80%.
  - Contrast is at least 4.5:1 against the sampled plate behind each block, or the block gets a plate or shadow.
- **Layout:**
  - stacked lines with tight leading; composition driven by word size; max 3 to 6 words on screen (by energy);
  - text is placed in the largest free region (headroom, below the face, beside the speaker) using the occupancy face and speaker boxes, zoom
    applied;
  - a **full-frame type card** for heroes when no region fits. This fixes `no_matte_no_headroom`. Cards are capped at 20% of the runtime and
    never back-to-back.
- **Readability:** connectors at least 44 px @1080; each word on screen at least 8 frames; contrast as above. The guardrails re-verify all of it.

### Part D: motion grammar

- **Central tokens** (`motionTokens.ts`): four springs (gentle / snappy / bouncy / explosive), the easing curves and duration tables. No template
  defines its own.
- **Library:**
  - entrances: per-word and per-letter stagger, spring scale-pop with overshoot, mask / wipe reveal, slide with directional motion blur,
    push-through (the new block pushes the old one out), stack build with reflow;
  - exits: line collapse, blur / scale-out;
  - transitions: match-cut between beats (a shared word holds while the layout swaps);
  - continuous drift (scale 1 to 1.03 and a few px), so nothing sits dead.
- **Grammar:** each video picks 2 to 3 motion families from its tone (seeded). Every phrase draws from those, varied by energy and beat. Energy
  scales the amplitude, overshoot and stagger: calm is gentle, a punchline is big.
- **Sync:** each word becomes visible 2 to 3 frames before its onset and is never late. It holds while its phrase is live and exits into the next
  beat.
- **Spec form:** the solver emits compact parameters (motion id, frames, spring id, amplitude). One pure `motionEval.ts` (byte-identical on the
  server and in Remotion, with a parity test) turns them into transforms, so the metrics, the guardrails and the render use the same math.
- **Content:** no images, only type plus the speaker. No SFX in v1. If SFX are added later, they follow VOICE_FIRST (no hit within 120 ms after
  an onset).

### Evaluation loop (each iteration, all fixtures, replay only)

`kineticV2.ts replay --all --out ~/Desktop/kinetic-v2/<iter>/` writes, per clip:

- `render.mp4`;
- `sheet.jpg` (a still every 0.5 s);
- `report.md` / `report.json` with:
  - word-sync error in frames (first visible frame minus onset: distribution and worst);
  - % of frames where text overlaps the face box (computed from the spec through `motionEval`);
  - words on screen (max / mean);
  - the number of distinct sizes and colours;
  - dead frames (text visible, no element moving more than 0.5 px or 0.2%);
  - fallbacks taken.

Each iteration comes with a 3-line note.

### Integration (after the look is approved)

- `EffectiveFlags.kineticV2` (env `KINETIC_V2`, default off) is pinned on by `kinetic_typography`. A v2 job turns off Kinetic-Led, Skill C and
  motion-template text, and the v2 track owns the words.
- `STYLE_FLAGS_VERSION` becomes v3, and `blueprint.kineticType` is a new optional field, so old blueprints render byte-for-byte.
- Run the unstyled parity suite (`PARITY_TESTS=1`) and compare against the baseline failure list. Then write the deploy notes.
- Kinetic stays out of `EDIT_STYLES_AVAILABLE` until approved.

## 4. Cost of the one recording run (hi.mp4, needs approval)

| Calls | Count |
|---|---|
| Groq transcription | 1 |
| Gemini Flash (keep plan, occupancy, story, creative + repair, perception, content profile, motion director, critique) | up to 12 (style cap) |
| Gemini Pro-tier kinetic direction (+ 1 repair) | 1-2 |
| **Total** | **up to 15** |

Estimated total **under US$0.50**. The spend guard hard-caps it at $1, and real per-call token usage is reported. Each extra clip is the same
again, once.
