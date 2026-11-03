# Kinetic typography engine

A vertical talking-head video in, a text-led edit out: words synced to speech, mixed typography, hero words behind the speaker, 3D text, text that holds world position.

**Rule:** AI analyzes and decides (typed JSON `KineticPlan`). Deterministic code places (`layout.ts` -> frame-exact `RenderSpec`). Remotion only interpolates keyframes. No model draws pixels or coordinates.

## Pipeline (`runKinetic.ts`)

```
S1 ingest.ts      ffprobe (source fps kept, integer frames) + PySceneDetect if on PATH, else ONE shot
S2 transcript.ts  Groq word timings (wrapped) | --transcript json | WhisperX only if WHISPERX=1 (stub). emphasisScore, >= 0.65 = hero candidate
S3 matte.ts       --matte | existing RVM if configured | else noMatte (all text in front). Foreground = ORIGINAL RGB + matte alpha (alphamerge), not RVM fgr
S4 depth.ts       SubjectBandDepth (alpha grid, else bbox silhouette model). DepthAnything: stub, only if DEPTH_MODEL_PATH
S5 camera.ts      StaticCamera (default) | MeasuredCamera (smoothed, never across a cut) | BboxMotionCamera (CAMERA_PROVIDER=bbox) | tracker stub (CAMERA_TRACKER=1)
S6 scene.ts       subject bbox, alpha area, face keep-out = upper 42% of the box, free space, luminance
D1 director.ts    Gemini (existing GEMINI_API_KEY) -> KineticPlan; any failure -> deterministic fallback (fallback.ts), reason recorded. No retry
D2 workerGate.ts  Claude worker ONLY for needsCustomTreatment, OFF unless KINETIC_WORKER=1 + ANTHROPIC_API_KEY; otherwise closest preset + log. Never blocks
L1 layout.ts      measure, place inside SHORTS_SAFE, occlusion, forced front, contrast, jitter downgrade, cuts, density. Pure, seeded
G  guardrails.ts  independent re-verification of a RenderSpec (`verifyRenderSpec`)
R  remotion/src/kinetic/  KineticTrack (behind / front), 18 presets, KineticEdit + KineticStoryboard compositions
```

Every stage is cached by content hash in `.cache/kinetic/<jobHash>/<stage>.json` (git-ignored); a rerun recomputes only stages whose inputs changed (`pipeline.test.ts` pins this).

## Why the default path needs no GPU model

Transcript = existing Groq (or JSON). Matte = existing RVM output. Depth = the matte (inside = near, outside = far, "pocket" = the band between). Camera = static: text holds world position, which is exactly what a locked-off or slow handheld plate wants.
No torch, no WhisperX, no Video Depth Anything, no CoTracker is imported unless its env flag is set, and each of those adapters is a typed stub in this repo that falls back to the default and records a warning.
Flat presets are DOM/CSS; `@remotion/three` mounts only for `hero.extruded3d.rise` / `hero.extruded3d.worldAnchored`. Claude is called only for `needsCustomTreatment`.

## Contracts

`schema.ts` (server) and `remotion/src/kinetic/spec.ts` are **byte-identical** (Lambda duplication, same as the blueprint zod; `parity.test.ts` enforces it).
`KineticPlan` is strict: pixel fields, frame numbers, font sizes, unknown keys and unknown presets are rejected. The old `stages/textTreatment` `TextTreatment` is untouched; this contract is `KineticPlan` / `RenderSpec`.
`blueprint.kinetic?: RenderSpec` (both blueprint copies) mounts the track in `ShortVideo`; absent = nothing mounted. Behind events are drawn behind only when a person-foreground layer exists; otherwise they draw in front (never over a face).
RenderSpec frames are composition frames (= source frames, no trim).

## Safe-zone numbers (reused from `broll/heroSweep.ts::shortsSafeRect`, which is NOT edited)

Left 60/1080, right 120/1080, top 250/1920, bottom 270/1920 (900x1400 inside 1080x1920; 720x1280 scales the same). Every keyframe's **projected** AABB (scale + rotateX/Y + perspective) is clamped into it and re-verified every frame (`safeProof`).
Occlusion: hero behind = 10-40% covered target, never > 45% (mean > 40% also rejects); support/caption behind <= 5%. Violations: move -> shrink <= 15% -> flip to front. Alpha area > 0.55, hero box overlapping subject bbox > 70%, or no matte -> front.
Front text keeps off the face keep-out (front text may shrink further, down to 0.45x, rather than cover eyes/mouth). Contrast < 3:1 adds a stroke. Anchored jitter (px/frame^2, anchored factor 1.0 floor / 0.85 wall / 0.6 background) > 1.5 downgrades plane -> background -> screen.
Density: <= 1 hero active, <= 2 clusters + 1 caption, >= 6 frames between unrelated events. No event crosses a cut unless `persistAcrossCut`.

## Fonts

Bebas Neue, Inter, Space Grotesk (existing) + **Playfair Display (400, 400 italic, 700 italic) and Poppins (500, 700) vendored as woff2 under `remotion/public/fonts` with their OFL files** (no hot-fetch). 3D uses typeface JSON generated from the vendored fonts (`remotion/scripts/kinetic/make-typeface.mjs`, woff1 from `@fontsource`; Bebas, Inter 900, Playfair 400).
Width measurement: Bebas + Inter tables from heroSweep, Playfair from its typeface advances; Poppins/Space Grotesk are Inter-scaled estimates (conservative). Italic reuses roman advances.

## Swapping a provider

Implement `DepthProvider` / `CameraProvider` / `TranscriptProvider` (interfaces in `depth.ts`, `camera.ts`, `transcript.ts`) and either pass it via `runKinetic({deps})` or wire it behind an env flag in `runKinetic.ts` (see the DEPTH_MODEL_PATH / CAMERA_TRACKER blocks). Keep it a dynamic `import()` so default runs never load it. Bump `version` so cache keys change.

## Add a preset

1. Name in `schema.ts` `PRESET_NAMES`, then copy it byte-for-byte to `remotion/src/kinetic/spec.ts` (`cp`).
2. Entry in `presets.ts` (layering, anchor, region, roles -> fonts / fills, entrance, lines).
3. Component + map entry in `remotion/src/kinetic/presets.tsx` (animation inside the block only).
4. A sample row in `storyboard.ts`; run `cli.ts storyboard`; tests (`schema.test.ts` counts 18 -> update).

## Commands

```
# full edit (from repo root). --range a-b renders only those frames
npx tsx server/src/stages/kinetic/cli.ts run <video> --brand server/src/stages/kinetic/brand.example.json --out out/edit.mp4 [--matte person.webm] [--transcript words.json] [--debug] [--range 0-124]

# storyboard: rewrites remotion/src/kinetic/storyboard.spec.json, renders 3 stills + a 2 s fallback preset through the real compositor
npx tsx server/src/stages/kinetic/cli.ts storyboard
# or browse all 18 in Remotion Studio (compositions KineticStoryboard / KineticEdit):
npm run studio --workspace=remotion
```
`--debug` writes `<out>.report.json` (providers that ran, cache hits, fallback reasons, guardrail violations, occlusion per event, worker-gate outcomes). Local renders use `remotion/scripts/kinetic/render.mjs` with `chromiumOptions.gl = 'angle'` (required for three.js locally).

## Tests

`cd server && npx vitest run src/stages/kinetic src/stages/broll/heroSweep.test.ts`

## Known gaps

- No real RVM matte exists in this checkout (`subjectmatte/out/phase3/*.webm` is 0 bytes); the alpha path is tested with a synthetic alpha WebM. `subjectmatte` was not touched.
- PySceneDetect is not installed here: only the single-shot path ran. Its CSV parsing is untested.
- A Claude-worker result is recorded but not mounted by the kinetic compositor yet (closest preset renders).
- Lambda rendering of the three presets is untested (Lambda has its own GL defaults).
- Stage-2 creative director / `ShortVideo` pre-existing TS errors (`forceSplit`, `explainer_a`) are not from this work.


## MOTION-PLAYBOOK (`type.words`, `playbook.ts`, `motion.ts`)

Word-by-word type synced to speech, stacked into headline blocks with size contrast, floating in a slow 3D hold. The director only TAGS; the solver owns pixels, sizes, frames, easing.

**Layout rule: gutter first, behind is rare.** Subject centre x < 0.42 -> type in the right gutter (`besideRight`); > 0.58 -> left (`besideLeft`); centred and box < 0.62 wide -> `flank` (left cluster + right cluster, face column empty); free space above a low head -> `upper`; filler -> `running` (centred, ~66% height, below the face keep-out, one word at a time). `behindSignature` is honoured at most once per 8 s and only if the occlusion rules pass (hero 10-40%, never > 45%); otherwise the event goes in front, in a gutter. Resting ink is always inside `shortsSafeRect`; E1/E2 travel is shortened if it would clip; only E3 and X6 may cross the edge while they move (X6 once per plan).

**Styles** (`KineticPlan.style`, default `cinematicClean`): `cinematicClean` white only, Poppins 300 connectors / 700 support / 900 caps hero (-2% tracking), no glow, rare full-width title moment (E6 + X4 + orange light-leak flash, <= 1 per 15 s); `editorialLuxury` white only, Poppins 500/600 + Playfair italic lowercase hero tucked into the line above (-8% baseline, ~10% overlap); `retroNeon` heavy lowercase sans + ONE accent per block (#F2C14E #E6FF3B #4FD8C9 #FF4FA8 or gradient #F7D774 -> #4FD8C9 @20deg, chosen for contrast with the plate, never the same twice in a row) with a 14 px / 55% glow on that word only, Shrikhand script hero, E5.

| Role | px @1080 | Case | Entry |
| hero | 140 (title 240-300) | A caps / B lowercase italic / C script | E2 (C: E5, title: E6) |
| support | 83 | lower | E1 |
| connector | 46 (opacity 0.9) | lower | E1 |
| running | 44 | lower | E1, X2 swap |
| punch | 130 | per style | E3 |

`caption` is still accepted and means `running`. Exactly one hero per headline block; max 6 words / 4 lines. Hero ~3x connector, support ~1.8x.

**Entrances** (per word, start 1-2 frames before speech, expo-out cubic-bezier(.16,1,.3,1)): E1 Blur-Settle 8f, E2 Hero Slam 10f (+2-frame ghost), E3 Whip-In 8f, E4 Line stack (block rescales ~0.85 / y -40 over 10f when a later row joins; shrunk less if ink would leave the safe rect), E5 Script draw 11f, E6 Title reveal 16f. **Hold** (whole block): linear push 1 -> 1.04, sine drift rotY +-3 / rotX +-1.5 / <= 8 px, period 5 s, parallax z hero/punch +40, support 0, connector -20; camera similarity blended at 30% (`CAMERA_BLEND`). **Exits** (expo-in): X1 cut-out, X2 word swap (running), X3 blur-lift 7f, X4 ghost dissolve 12f (titles), X5 dim-back 12f (last block, no logo / end card), X6 swipe-out 6f (<= 1 per plan). Exits are shorter than the entry except X4/X5, which are fixed at 12f by the playbook.

Fonts vendored as OFL woff2 in `remotion/public/fonts`: Inter 300, Poppins 300/600/800/900, Shrikhand. Nothing is fetched at render. Legacy presets stay registered; the contact sheet (`cli.ts storyboard` -> `remotion/out/kinetic-engine/stills/sheet.png`) and the proof (`cli.ts motion-proof`) use the playbook.
