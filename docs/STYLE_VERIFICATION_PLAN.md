# Edit styles: Checkpoint 3 verification plan (paid; NOT run yet)

Status: approved; waiting for the three recorded clips. Harness built (`server/src/scripts/styleVerify.ts`), not run.

Decisions taken: the pins in `lib/editStyles.ts POLISH_STYLE_PINS` are the verification baseline (tunable per style after the renders);
speech-cut tuning stays on env; front-only Kinetic counts as honoured (`matte: 'optional'`, note `matte_unavailable:<why>` in
`styleNotes`); RVM on the droplet is out of scope for v1.

Goal: prove Kinetic Typography and Explainer look right in REAL renders (models live, templates published, matte real) before they
are added to `EDIT_STYLES_AVAILABLE`, with AI Clean Cut as the control. Nothing in this plan runs until it is approved.

## 1. Environment

**Where: this Mac (M1, 8 GB), from the `feat/edit-styles-engine` worktree.** Not the droplet, for now:

- The production image cannot publish templates today. Publishing runs a one-frame Remotion still check (`motionWorker/runtimeCheck.ts`:
  `@remotion/bundler` on `remotion/src/index.ts` + a headless Chrome). The Dockerfile copies no `remotion/` folder and installs no browser
  libraries, so in the container every Kinetic beat and Explainer template would fail to publish (`kinetic_type_unpublished`). This is a
  ship blocker independent of CP3; see §6.
- RVM is not in the image either (weights and venv are host-provisioned; none on the droplet as far as the repo shows).
- The Mac has both: the Remotion project, `@remotion/renderer` 4.0.524 (it downloads its own headless shell once), and the RVM venv
  with torch 2.15 on `mps`.

Configuration for the runs (a separate env file, `.env.verify`, never the prod `.env`):

| Setting | Value | Why |
|---|---|---|
| R2 | a NEW bucket (e.g. `kinmel-engine-verify`) with an API token scoped to that bucket only, and its own public URL | there is no key-prefix setting (prefixes like `ai-video/motion-graphics/v0/` are hard-coded), so a separate bucket is the zero-code way to keep prod paths untouched |
| Render | local Remotion (`REMOTION_FUNCTION_NAME` / `REMOTION_SERVE_URL` empty -> `renderMode() = 'local'`) | no Lambda spend; same Remotion code |
| `EDIT_STYLES_ENGINE_FLAGS` | 1 | |
| `PRODUCT_EDIT_PROFILE` | polish | proves Clean Cut stays cuts on a polish server |
| `ANTHROPIC_API_KEY` | empty | belt and braces: styles are library-only anyway |
| `MUSIC_SPECIALIST` | off; `RUNWARE_API_KEY` empty | no Runware; pool beds only |
| `RVM_PYTHON` | the existing venv (`creators_kinmel/finalpost_engine/subjectmatte/.venv-rvm/bin/python`) for the RVM runs, empty for the no-RVM runs | |
| `RVM_DEVICE` | mps | |
| Keys | `GEMINI_API_KEY`, `GROQ_API_KEY` (live); Pexels / Pixabay optional (free; with them Explainer places stock stills, without them text plates) | |

Harness: `server/src/scripts/styleVerify.ts`. Per run it uploads the clip to the verify bucket, calls `startAnalysis` with
`useCache: false` (the RVM and no-RVM Kinetic runs share a cache key), renders locally (`LOCAL_RENDER_SKIP_R2=1`), counts every outbound
request through the run observer, and writes the output folder (§5). Default is a dry run (guards + plan, no network); `--approved` runs.
It refuses to start if: any `.env` that `config/env.ts` loads with `override:true` exists (they would replace the verify settings, so the
worktree `.env` must be moved aside), `R2_BUCKET_NAME` is not `--bucket` or the name lacks verify / staging / test, the Lambda variables or
`ANTHROPIC_API_KEY` / `RUNWARE_API_KEY` are set, `MUSIC_SPECIALIST` is not off, `EDIT_STYLES_ENGINE_FLAGS` != 1, `PRODUCT_EDIT_PROFILE` != polish,
or a clip is missing audio / outside 20-75 s. While running it stops at `--max-gemini` (180) and aborts on any request to a host other
than Gemini, Groq, Pexels, Pixabay or R2.

## 2. Fixtures (30-60 s, vertical 9:16, real speech)

The repo has exactly one usable clip: `remotion/public/hi.mp4` (48.7 s, 720x1280, 25 fps; one presenter waist-up, indoor, windows and
plants behind: a moderately busy background). Please record three more on the phone (1080x1920, front or back camera, normal room sound):

| id | Content | Tests |
|---|---|---|
| A `list` | 40-50 s, "3 reasons / 3 steps" script with numbers and names ("3 mistakes", "42 %", "$1,200", a product name) | Explainer claim beats + layouts, Kinetic impact-number templates |
| B `punchy` | 30-40 s, emotional / punchy delivery, short sentences, a pause or two, one retake on purpose | Kinetic hero beats on emphasis, speech cuts, timing lock |
| C `busy` | 30-45 s outdoors or a cluttered room (street, café, shelves), people or motion behind you | matte quality, text-behind on a hard background, front-only legibility |
| D `hi` | the repo clip | baseline, moderately busy background |

## 3. Runs

Per clip:

| Run | Style | RVM | Gemini cap |
|---|---|---|---|
| 1 | ai_clean_cut (control) | - | 3 |
| 2 | kinetic_typography | off | 12 |
| 3 | kinetic_typography | on (mps) | 12 |
| 4 | explainer | - | 12 |

Plus a repeat of runs 3 and 4 on clip A (stability: same clip, same style, does the plan stay similar?). **18 runs total.**

Worst-case paid calls (every run hits its cap):

- Gemini: 4 x (3 + 12 + 12 + 12) + 12 + 12 = **180 attempts**. The stubbed pipeline used 9 per polish run and 1 per Clean Cut run, so
  the expected number is about 4 x (1 + 9 + 9 + 9) + 18 = **130**. At the engine's own rate constant ($0.075 / M input tokens, flat;
  whole-video Director input for a 60 s clip is in the tens of thousands of tokens) that is on the order of a dollar; each run's
  `stats.estimatedCostUsd` is recorded so the real figure is known after the run.
- Groq transcription: 18 calls at most (KI-38 makes reruns of the same clip cache hits).
- Claude, Runware, Remotion Lambda, MiniMax: **0**.
- Pexels / Pixabay: free; only if keys are set.

Time: analysis about 1-2 min per polish run; the RVM runs add the matte (measured, §6: about 9.5 min on mps / 10.5 min on CPU for a 49 s clip on this Mac); local
render a few minutes per clip. Expect roughly 2-3 hours for all 18, run sequentially (the Mac has 8 GB).

## 4. What to check in each render

**Kinetic Typography**
- [ ] Hero type beats are present (the count in the report matches what is on screen) and readable at phone size (contrast, size, on screen at least ~0.6 s)
- [ ] Each beat's words are the words being spoken at that moment (timing locked to speech, no drift after cuts)
- [ ] With RVM: environmental hero words sit BEHIND the person (the person's head/shoulders occlude the type), edges clean, no halo or flicker
- [ ] Without RVM: the same beats are in front, in headroom / clear space, never over the face or mouth
- [ ] No two text elements overlap (captions vs kinetic type vs hook), nothing clipped at the frame edge or safe area; captions mute while a full-frame beat owns the frame
- [ ] The look is the Kinetic-Led palette (not the editorial default)

**Explainer**
- [ ] The explainer layouts are VISIBLE in the render (B / C / D splits or cutaways), not only listed in the blueprint
- [ ] Claim beats: a number / name / amount gets its visual within ~0.5 s
- [ ] Chunk-swap captions (short phrases swapping in place), positioned for each layout
- [ ] Pacing: layouts change on sentence boundaries, not mid-word; no flashing (spans too short)
- [ ] Media: stock stills or text plates, no broken image, no placeholder text

**Every style (Clean Cut included)**
- [ ] Voice clearly audible over music and SFX for the whole clip (spot-check loud and quiet passages; the report includes integrated loudness)
- [ ] No broken cuts: no clipped words, no repeated words, retake removed (clip B), no audio pops at cut points
- [ ] No black frames, frozen frames or A/V drift at the end
- [ ] `degraded` / `degradedReasons` match what actually happened (e.g. a no-RVM Kinetic run says `kinetic_front_only:no_matte` and the render shows front-only type; a run that shows its templates must NOT say `*_unpublished`)
- [ ] Clean Cut control: the cuts profile (no Director visuals, no kinetic type), `editProfile: cuts` on a polish server

## 5. Output

One folder, e.g. `~/Desktop/style-verify-<date>/`:

```
<clip>-<style>[-rvm]/
  render.mp4            the final local render
  report.json           style, styleApplied, editProfile, degraded, degradedReasons, Gemini attempts (sent / refused, by stage),
                        estimatedCostUsd, analysis seconds, matte seconds, render seconds, blueprint counts (kinetic beats published,
                        explainer layouts, captions), voice / music loudness
  report.md             the same, readable, plus the §4 checklist to tick
  warnings.txt          the blueprint warnings
  stills/               4-6 frames at the beat / layout times, for quick review
SUMMARY.md              one row per run: style, degraded, reasons, Gemini used, cost, times
```

## 6. RVM on the server

Measured on this Mac (M1, `mps`, `--quality high`, `--max-side 1280`, `hi.mp4` with `--ranges 0-10`):
- inference 121 ms per frame on the 252 frames in range (about 30 s of work);
- but the whole run took **572 s**: the CLI still post-processes and VP9-encodes all 1,218 frames of the clip (transparent outside the
  ranges), about 350 ms per frame. The range limit saves inference, not encoding.
- CPU on the same Mac (M1 cores, same settings): inference **414 ms per frame** (3.4x slower than mps), whole run **627 s**. Inference was
  ~104 s of that; the full-timeline post-process / encode again dominates.
- Extrapolated to a fully matted 30 s clip (750 frames at 25 fps) on CPU: ~5 min of inference on M1 cores alone, plus the encode. A
  shared-vCPU droplet is typically slower per core than an M1, so budget **10+ minutes per 30 s clip** until measured there.

What production needs:
- **Image**: torch + torchvision (the Mac venv is 957 MB; Linux CPU-only wheels from the PyTorch CPU index are smaller, on the order of
  0.7-0.9 GB installed) + 15 MB of weights (or a mounted volume, as the Dockerfile comment intends). A GPU droplet is a different price
  class; CPU is the realistic target.
- **Time per 30 s clip on the droplet**: not measurable from here (the droplet's vCPU count is not in the repo). On a 2-4 vCPU droplet,
  expect CPU inference slower than the Mac's mps figure and the same full-timeline encode cost: many minutes per clip, inside an analysis
  slot (`MAX_CONCURRENT_ANALYSES = 2`) and under `MATTING_TIMEOUT_SEC = 900`. One command on the droplet gives the real number
  (`nproc; free -h`), and a 10 s benchmark there would settle it.
- **Future task (not v1)**: encode only the matted ranges (or stop refining frames outside them). That is the dominant cost and an
  easy win, independent of CPU vs GPU. RVM on the droplet is out of scope for v1.

**Is front-only Kinetic good enough to ship while RVM is pending?** My view: yes, if CP3's no-RVM renders pass the §4 checks
(readable, never over the face, timing locked). Behind-the-person type is the signature shot, but front-only hero type is still a
distinct, polished style. Two consequences to decide:
1. DONE: front-only counts as honoured (`matte: 'optional'` on Kinetic); no matte is the note `matte_unavailable:<why>` in `styleNotes`.
2. Template publishing in the production image (§1) must be fixed either way: add the Remotion project and Chrome's system libraries to
   the image (simplest; larger image), or publish library templates without the per-beat still check (they are curated and covered by
   repo tests; smaller image, less runtime validation). This is needed for Kinetic AND Explainer, RVM or not.

Also confirm before production: the Remotion site deployed to Lambda (`REMOTION_SERVE_URL`) is built from code that contains the kinetic
and explainer components (final production renders run there, not locally).
