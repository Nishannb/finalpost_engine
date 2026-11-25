# Kinetic Composer

The Kinetic Composer is a beat-driven planning layer inside the Kinetic V2 engine. It sits behind `POLISH_KINETIC_COMPOSER`, which defaults to **off**.

The old engine always lays words out in the same `type.words` stack. The composer works differently:

1. It decides what each moment of the talk is, called a beat.
2. It decides how this video should feel, called the edit direction.
3. It picks which composition draws each beat.
4. It solves every composition deterministically into the same `RenderSpec` contract, plus a scene layer of shapes, counters and plate treatments.

No model ever draws pixels or coordinates. The composer uses the same single Director call slot as V2, so it adds no extra paid calls.

```
words -> beats.ts (P2) -> direction.ts (P6, Director optional) -> controller.ts (P6) -> stagecraft.ts (P4 punch-ins)
      -> compositions.ts (P3) / captionLane.ts (P7) -> verify.ts (P8: verifyRenderSpec + composer rules) -> repair -> metrics.ts (P0)
```

## Pieces

| file | job |
|---|---|
| `beats.ts` | Splits the transcript into reading units. It types each one as stat, list, contrast, question, CTA, warning, claim, definition, story, hook or plain, using numbers with units, "from X to Y" ranges, ordinal markers, antonym pairs and parallel negations ("not about talent… about execution"). It also scores intensity and picks key words. |
| `direction.ts` | Sets the tone (hype, educational, business, story or calm) and energy. It picks a seeded toolkit of 4–7 compositions, a motion palette, a plate rate and a per-video look (alignment bias, corner radius, accent mode, tilt). It can take one optional Director call; the reply is checked with zod and limited to known names. |
| `controller.ts` | Decides which beats are designed and which are quiet. It ranks compositions by meaning, direction and intensity, then picks a variant: zone family, alignment, entry and exit motion, voice, plate, side and tilt. It enforces the variety rules listed below. |
| `compositions.ts` | Curated backing pairs, the backed-word split, and 14 solvers: `giantWord`, `wordSwap`, `lineWipe`, `sideStack`, `topHeadline`, `contrastSplit`, `counterStat`, `listItem`, `questionCard`, `calloutBar`, `markerHighlight`, `ctaCard`, `takeover`, `heroStack`. |
| `captionLane.ts` | Quiet beats become short phrase lines in one stable lane below the hands, with the beat's key word in the accent colour. |
| `voice.ts` | The caption preset stays the identity: its face, colours, case and outline. Companion faces add range: a display face, an editorial serif or italic, a condensed face and a small face. |
| `stagecraft.ts` | Adds beat punch-in zooms on the hardest-hitting beats. They are planned before solving, so every placement clears the zoomed face. A punch-in that displaces its beat is removed and the edit is solved again. |
| `kit.ts` | Shared building blocks: measurement, row fitting, the free regions around the speaker, the motion vocabulary (13 entries, 7 exits) sampled into word keyframes, event assembly, and scene-element builders. |
| `verify.ts` | Runs the V2 `verifyRenderSpec` (safe rect, per-word face keep-out, contrast, density, gaps, Match Cut rules) and the readability floor. Composer rules on top: a takeover card must sit on an opaque backdrop, words on a backing are judged against that backing, counters stay off the face and inside the safe rect, and only one text system is on screen at a time. |
| `metrics.ts` | Measures any spec: designed share, caption-only share, distinct treatments and distinct per 30 s, max share, repeats, zone entropy, scale contrast, motion count, torso overlap, scene elements, a 0–100 variety score, and pairwise sameness. |
| `cli.ts` | Local corpus harness. It builds composer and V2-baseline specs, writes metrics and a summary, and renders stills or MP4s through `remotion/scripts/kinetic/render.mjs` using `KineticEdit` with the edit's zooms. |

## Variety rules (controller)

- The same composition never appears twice in a row. A list's items are one series and share one layout.
- No composition takes more than 34% of the designed beats.
- Unused compositions get a small pull upward in the ranking.
- Zone families (above the head, below the face, side) rotate. Small multi-word treatments never sit on the hands; only giant word, counter, word swap and CTA may use the chest band.
- No designed run lasts longer than 4 beats, so there are quiet beats.
- A takeover card appears at most once every 18 s, and only on the hook or a peak.
- Content binds to compositions: a number becomes a counter, a list becomes chips, opposing words become a split where the old word dims away as the new one lands (no strike line), and a question becomes a card.

## Craft rules (backed text, motion, behind)

**Backed text** is any word on a chip, highlighter, callout bar, question card or takeover card.
- Backed words get their own event (`<id>.b`), drawn with no outline, no glow and no push, so they stay locked to their backing. The verifier rule `backed-stroke` refuses an outline or glow on backed text.
- Padding is at least `0.34 x font px` vertically and `0.24–0.30 x font px` horizontally (`kit.ts` `backPad`). Row and word gaps are widened so the padding never covers a neighbouring word.
- Colours come from a curated pair (`compositions.ts` `BACKED_PAIRS`):
  - sun `#FFE14D` with ink `#141414`
  - paper `#FFFFFF` with ink `#111111`
  - navy `#14213D` with white
  - cream `#FFF3D9` with ink `#161616`
  - ink `#121318` with white
  - forest `#0F4C3A` with white
- The preset's accent is used only when it is clean light (dark ink at 8:1 or better) or deep (white at 8:1 or better). Mid-tones such as salmon or coral are refused.

**Uniform boxes**: a callout draws exactly one bar per visual row (words grouped by vertical overlap), every bar in the callout has the same height and padding, and every word on the bars is set at one size (the key word stands out by its heavier face). There are no side-by-side boxes of different sizes.

**No underlines**: the engine draws no underline shapes (`lineWipe` and `ctaCard` dropped theirs; `shapeEl` no longer accepts `'underline'`).

**No overlapping words**:
- A phrase line or swap unit that replaces another enters only after the old one has fully left (`buildEvent` floors each word's entry at its predecessors' exit end). An exit is never pushed later than planned; a word that has not settled by then is cut short of its entry.
- An entering word never travels across a word already on screen. A side entry (`slide`, `whip`) comes from the clear side, or travels only as far as the gap. A `rise` / `drop` stops short of the row it would cross. Split plain and backed events see each other's words.
- The verifier rule `word-collision` refuses any two words of a beat that overlap on screen at the same frame. The repair loop then re-solves or drops that beat.

**Contrast** has no strike line. The old word sits muted and slides or fades away about 0.35 s after the new word lands.

**Motion**
- Key words enter with the direction's verb.
- Supporting words use their own pool per tone (slide, drop, whip, rise, mask, track, blur), so they are not all rising.
- Words enter from alternating sides (`dir`) and leave to the same side or across (`exitDir`). The exits include `slideOut`, `whipOut`, `scaleOut`, `lift`, `sink` and `blurOut`.
- **Slant**: most treatments of an energetic video turn in perspective, so the type recedes into the frame or comes out of it, with one side clearly bigger than the other. This is rotateY yaw (hype 32–40°, calm 20–28°, sign alternating), sometimes with a little rotateX pitch, on a short perspective of 950 px.
  - There is no in-plane rotation: crooked flat text read badly. `RenderEvent.rotateDeg` stays in the contract but the composer no longer sets it.
  - The projected block is kept inside its free region: the yaw is trimmed to 80% or 60% if needed, and the block slides a few pixels so its projection fits. The base verifier projects every word through the yaw, so the safe-rect and face checks are exact.
  - Treatments drawn on flat 2D shapes (chips, highlighters, bars, cards) stay flat. In a list item, the item words slant while the chip stays flat. A side rule is dropped when its words slant. The engine draws no underlines.
- The **motion gate** applies to edits with 6 or more designed treatments. It requires at least 5 distinct entries, at least 3 distinct exits, at least 2 side flips, and at least 2 angled treatments (at least 1 for a calm video). A failing edit is re-planned with another seed up to twice. If it still fails, the composer fails closed and the V2 engine runs.

**Behind the speaker (RVM)**
- RVM produces a person alpha matte for the clip (`pipeline/kineticMatteStage.ts`, local Python and torch, MPS/CUDA/CPU). That gives two outputs:
  - the occlusion grid the composer and verifier use;
  - the person foreground: the original pixels plus the RVM alpha, as a VP9 alpha WebM.
- The renderer draws, in order: plate, text behind, person foreground, text in front. The foreground goes back on top in its original place, so the person passes in front of the word.
- The composer, given the matte, puts a high-impact giant-word or hero-stack moment behind the head. It needs intensity 0.6 or more and at most one every 6 s.
  - The word slides down onto the real head (measured on the matte across the beat's frames) to the lowest position where the person covers at least 8% of it, while it stays readable: at most 26% covered, first and last letters at most 20%.
  - Any lead-in words stay in front, in the open band above. The verifier re-judges every placement; a refusal goes back to the front.
- New punch-ins are switched off when a matte is used, because the matte and foreground were mapped through the edit's existing zooms.
- Production needs `POLISH_KINETIC_ENGINE_MATTE` (off in V1: RVM is deferred from V1 by the product plan) plus an RVM host (`docs/RVM_HOST.md`). Without a matte, nothing is drawn behind the speaker.
- Local review: `RVM_PYTHON=… RVM_WEIGHTS_PATH=… RVM_DEVICE=mps npx tsx server/src/stages/kinetic/composer/cli.ts <corpus> <out> --matte --stills --render`.

## One slant per frame (`slant.ts`)

- Every text event on screen at the same moment shares one perspective turn (same yaw, pitch and direction), or none is slanted.
- A beat with backed words (list chip, highlighter) is flat, plain words included: the chip cannot turn, so its neighbours do not either. `listItem` is no longer a slantable composition.
- A slanted block with several rows is split into one event per row (`<id>.rN`), each turned about its own centre. Turning the whole block about one centre made rows above and below the centre lean in opposite directions.
- Each row's perspective scales with its height (clamped to 0.7 to 1x), so smaller rows converge at the same angle as the tallest.
- The verifier refuses `slant-rows` (a multi-row block turned about one centre) and `slant-mixed` (two different slants on screen together).
- The motion gate asks for angled type only up to the number of treatments that can slant. The first two slantable treatments of a non-calm edit always lean.

## AI-chosen colours (`POLISH_KINETIC_AI_PALETTE`, default off)

- Off: the caption preset's text and accent colours, exactly as before.
- On: the Director (same single call) also gets the footage's average colour and brightness and the preset's colours. It picks one of the curated `PALETTES` in `voice.ts` (sunshine, electric, mint, coral, candy, lime, gold, ice, crimson, earth) or `preset`.
- The palette replaces text, accent and accent2 only. Faces, case, outline and shadow stay the preset's. An unknown name, `preset` or no Director keeps the preset's colours.
- The choice is reported as `kinetic_composer:palette:<name>`.

## Contracts

- `RenderEvent.composition?`, `RenderEvent.rotateDeg?` and `RenderSpec.scene?` are new optional fields. The compositor applies `rotate()` only when `rotateDeg` is present. Both copies of the schema stay byte-identical (`server/src/stages/kinetic/schema.ts` and `remotion/src/kinetic/spec.ts`).
- An old spec parses and renders exactly as before.
- `remotion/src/kinetic/SceneLayer.tsx` only interpolates. It is mounted in `KineticTrack` on the front layer only when `spec.scene` exists.
- `kineticEngineStage.ts` runs the composer first when `composer: true` and no matte is used. On any failure it runs the V2 engine unchanged. On success it returns `composer.zoomTriggers`, and `analyzeVideo` puts exactly that list on the blueprint.
- The V1 Match Cut is reused: the existing planner and solver, with its window reserved. The shutter treatment still applies downstream.
- B-roll windows drop composer scene elements together with the type (`brollCaptionSplit.ts`).

## Run the corpus (local, free)

```
npx tsx server/src/stages/kinetic/composer/cli.ts <corpus.json> <outDir> [--stills] [--render] [--render-baseline] [--only a,b] [--concurrency 4] [--no-baseline]
```

`corpus.json` has the shape `{clips: [{id, video, words | fixture, box: {x,y,w,h}, preset?, trimSec?}]}`:
- `words` is a `[{text,start,end}]` file. `fixture` is an eval fixture with `captionWords` and `keepSegments`.
- `box` is the speaker box as source fractions.

## Tests

```
cd server && npx vitest run src/stages/kinetic/composer
```

The tests cover beats, direction, end-to-end compose (verified, varied, deterministic, transcript fidelity), punch-ins, explicit failure, backward compatibility of old specs, the B-roll scene drop, metrics, and the pipeline stage with the composer on and off.
