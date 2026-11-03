# Edit reference — multi-skill craft bar (live PAUSED)

The engine must hold **multiple edit grammars as skills** without one wiping the other.

| Skill | Example | Feel | Flag / path |
|-------|---------|------|-------------|
| **A — Faceless documentary** | Metromedia “Founder got fired” | Hyper-cut (~0.85s ASL), 100% B-roll, accumulate captions, flash/B&W, card fly-out | `POLISH_FACELESS_DOC=1` · proof `wp36-faceless-doc.mp4` |
| **B — Explainer / talking-head** | 9:16 educational reel | Medium pace (~3–5s cuts), layouts A/B/C/D, chunk-swap captions, **preferred** lime + paper board (content-aware override) | `POLISH_EXPLAINER_SKILL` (default off) · `wp42-explainer-mounted.mp4` |
| **C — Textual motion graphics** | [Jitter text templates](https://jitter.video/templates/text/) | Hero/emphasis type plates — **not** karaoke | `POLISH_TEXTUAL_MG` (default off) · `wp43-textual-mg.mp4` |
| **D — Newsroom MG explainer** | B/W + signal-red motion-graphics reel (~13% host) | GFX / CARD / HOST / EXPERT; hard cuts ~3.1s median; red emphasis; grayscale cards | `POLISH_NEWSROOM_MG` (default off) · grammar `newsroom-mg-grammar.yaml` |

**Live renders: PAUSED (2026-10-31).** After WP55 live burn of `test2` (`first_bp_…` / `test2-polish-wp55-live.mp4`) — **FAILED craft QA again**: stillness `frame_inset` spam (~4× in ~8s), kinetic type under-placed (Director owned empty → 0 overlays), double “200” / early stats, ungrounded overlay copy, flashy website-blue plates copying reference 2-word style, captions muted during pure money/inset B-roll with no text, hard split seams. Screenshots: `remotion/out/phase36-readiness/wp56-craft-qa/`. **WP56 IN PROGRESS** (Color Director + kinetic fallback + inset/caption/seam/grounding). Unpause only for a deliberate re-QA burn after WP56 READY.

**Lane priority:** faceless (A) > newsroom_mg (D) > explainer (B) > default. Skill C is an overlay flag (can co-exist).

**Colors are preferred, not locked (WP44):** `editPalette.ts` picks accent + ground from a researched catalog. Skill B prefers lime `#BFFF00` on paper dots; Skill D prefers red `#E00000` on `#0A0A0A`. Finance/news cues on a Skill B edit can select newsroom red; SaaS-only cues on Skill D can select edu lime. Blueprint carries `editPalette`; ShortVideo paints accents/grounds from it.

**Caption vs Skill C:** A accumulate + B/D chunk-swap = VO subtitles. Skill C = designed type that can **own** the spoken words for a beat.

### Architecture: Skill (L1) → Primitives (L2)
| Level | What | Count |
|-------|------|-------|
| **Skill** | Whole-edit grammar (pacing, layouts, captions, palette preference) | Few (A–D) |
| **Primitive / template** | Toolkit move inside a skill (grid morph, slit carousel, bento camera, card stack, …) | Growing catalog |
| **Params** | Accent, assets, duration for this beat | Per video |

Skills declare **allowlists** of templates. The director picks sparse beats (`planMotionTemplateBeats`); it does not invent a new skill per animation. Canon: `motion-template-primitives.yaml` · catalog `motionTemplateCatalog.ts` · WP45–48.

| Template | Primitives | Prefer in |
|----------|------------|-----------|
| `clip_01_grid_morph` | tile wipe / merge / color flood / window reveal | A, B, D |
| `clip_02_slit_carousel` | slot carousel + accordion expand | B, default |
| `clip_03_bento_camera` | camera creep / jump / ease zoom | A, B, D |
| `clip_04_stacked_cards` | card stack advance | A, D, default, C (behind type) |
| `clip_05_config_brand_loop` | hard cut on 1.5s grid + mask morph + sticker pop | A, D, default |
| `clip_06_blur_word_carousel` | blur-by-distance vertical word carousel | B, C, D, default |
| `clip_07_ios_notification` | iOS banner mock + cursor (overlay; does not mute captions) | B, D, default |
| `clip_08_nested_rect_title` | nested-rect wipe + typewriter title | A, B, D, default |
| `clip_09_acme_fruit_swap` | letter swap + color field hard cuts | A, C, D, default |
| `clip_10_morph_stretch` | font morph + vertical stretch | B, C, D, default |
| `clip_11_menu_slide` | slide carousel + microtext frame | B, D, default |
| `clip_12_editorial_inset` | inset→full-bleed + line mask reveal + microtext | A, B, D, default |
| `clip_13_heritage_poster` | hard cut full-bleed + scale-to-thumb + mask line reveal + corner markers + marquee | A, B, D, default |
| `clip_14_silk_legacy` | scale-expand cover + blank beat + mask reveal (+ optional text-behind-subject) | A, C, D, default |
| `clip_15_glass_testimonial` | frosted glass card morph over lifestyle plate | B, D, default |
| `clip_16_portrait_push` | vertical push carousel (3 portraits, white gaps) | A, B, D, default |
| `clip_17_photo_stack_collapse` | stack mask-collapse exit (2-up) | A, D |
| `clip_18_photo_stack_reveal` | fade → blank → stagger top-anchored reveal (3-up) | A, B, D, default |
| `clip_19_two_up_stack` | static 2-up inset photo stack hold | A, B, default |
| `clip_20_never_done_slit` | black statement poster + slit photo reveal | A, B, C, D, default |
| `clip_21_typewriter` | typewriter poster (placeholder lines) + replaceable mark | B, C, default |
| `clip_22_chat_conversation` | chat bubbles: typing dots → expand → word-rise | B, C, default |
| `clip_23_sale_promo` | sale flash → video + clock dock + masked headline + glass CTA | A, B, D, default |
| `clip_24_color_word_wheel` | color-name wheel + hard bg color cuts | B, C, default |
| `clip_25_tracking_collapse` | letter type + tracking collapse headline | B, C, D, default |
| `clip_26_spatial_blur_tilt` | blur+tilt text resolve + expanding squircle rings | B, C, default |
| `clip_27_riso_number` | riso `number` (counter · stat / big_number) — visual backend, flag `POLISH_RISO_TEMPLATES` | B, D, default |
| `clip_28_riso_versus` | riso `versus` (emphasis · myth_fact) | B, D, default |
| `clip_29_riso_compare` | riso `compare` (counter · before_after) | B, D, default |
| `clip_30_riso_converge` | riso `converge` (kinetic_text · many_to_few) | B, default |
| `clip_31_riso_quote` | riso `quote` (kinetic_text · speaker_conclusion; max 1 per edit; WP52 callouts win) | B, default |
| `clip_32_riso_chapter` | riso `title` (kinetic_text · chapter) | A-faceless, B, default |
| `clip_33_collage_assemble` | gbro collage i2v (cutaway · visual_metaphor; spec only in analyze, `COLLAGE_RENDER=1` + `GEMINI_API_KEY` to render) | A-faceless, B, default |
| `clip_34_doodle_explain` | anidoodle (cutaway · illustrated_explain; WP54: native Remotion `DoodleDrawOn` draws it when no `ANIDOODLE_ENGINE_ROOT`) | B, default |
| `clip_35_type_word_reveal` | `WordRevealType` (kinetic_text · emphatic_type; WP54) | B, C, D, default |
| `clip_36_type_line_mask` | `LineMaskReveal` (kinetic_text · line_type; WP54) | B, C, D, default |
| `clip_37_type_char_stagger` | `CharStaggerType` (kinetic_text · char_type; ≤ 24 chars; WP54) | B, C, default |
| `clip_38_type_weight_morph` | `WeightMorphType` (kinetic_text · weight_type; WP54) | B, C, default |
| `clip_39_logo_reveal` | `LogoReveal` (lockup · needs a logo asset; WP54) | B, default |
| `clip_40_mesh_gradient_ground` | `MeshGradientGround` (card · ambient overlay, ≤ 1, never mutes captions; WP54) | B, C, default |
| `clip_41_product_device_frame` | `ProductDeviceFrame` (cutaway · GATED: product/sales profile + provided screenshot; WP54) | B, default |
| `clip_42_product_cursor_click` | `ProductCursorClick` (cutaway · GATED; click cue + screenshot; WP54) | B, default |
| `clip_43_promo_price_drop` | `PromoPriceDrop` (counter · GATED: grounded was→now price only; WP54) | B, default |
| `clip_44_photo_ken_burns` | `PhotoKenBurns` (zoom · one existing still; faceless may; WP54) | A-faceless, B, default |

> **WP53 — not a fifth skill.** clip_27–34 are *visual backends inside the existing toolkits*: toolkit = WHY (counter / emphasis / kinetic_text / cutaway), template id = WHICH move, backend (riso / collage_gbro / anidoodle / native fallback) = HOW. No new toolkit ids. Planned by `visualBackend/planVisualBackendBeats.ts`, never by `planMotionTemplateBeats`. Flags default OFF.

**WP45 status:** comps `GridMosaicMorph` / `SlitPanelCarousel` / `BentoCardWall` / `StackedCardDeck` + library registry + `motionTemplateStage` shipped; `POLISH_MOTION_TEMPLATES` (default off) runs the active skill's allowlist sparsely. Report: `WP45_MOTION_TEMPLATES.md` · proof `wp45-motion-templates.mp4`.

**WP46 status:** **DONE offline** — comps `ConfigBrandLoop` / `BlurWordCarousel` / `IosNotificationMock` / `NestedRectTitleWipe` + registry 26 + timelines; `POLISH_MOTION_TEMPLATES` still opt-in. Report: `WP46_MOTION_TEMPLATES.md` · proof `wp46-motion-templates.mp4`.

**WP47 status:** **DONE offline** — comps `AcmeFruitLetterSwap` / `MorphFontStretch` / `MenuSlidePoster` / `EditorialInsetPoster` + registry 30 + timelines; `POLISH_MOTION_TEMPLATES` still opt-in. Report: `WP47_MOTION_TEMPLATES.md` · proof `wp47-motion-templates.mp4`.

**WP48 status:** **DONE offline** — comps `HeritageDevotionPoster` / `SilkLegacyCover` / `GlassTestimonialMorph` / `PortraitPushCarousel` + registry 34 + timelines; `POLISH_MOTION_TEMPLATES` still opt-in. Live PAUSED. Report: `WP48_MOTION_TEMPLATES.md` · proof `wp48-motion-templates.mp4`.

**WP50 status:** **READY** — Part 4 CLIP_17–21 (`PhotoStackCollapse` / `PhotoStackReveal` / `TwoUpStackHold` / `NeverDoneSlitPoster` / `TypewriterPoster`). Craft pass: no payoff flash at t=0, centred collapse card, two-up exit slide, rename + replaceable `markSrc`. Live PAUSED.

**WP51 status:** **IN PROGRESS (Claude)** — Batch B CLIP_22–26 (`ChatConversationBubbles` / `SalePromoCountdown` / `ColorWordWheel` / `TrackingCollapseHeadline` / `SpatialBlurTiltReveal`). Catalog/grammar/allowlists ready (26 templates / 48 primitives). Live PAUSED.

---

## Skill A — Faceless documentary (KEEP)

**Source:** `/Users/nishanbaral/Downloads/994ed0aecfa0429899c9b99171d351b8.MP4`  
**Canon files:** `metromedia-grammar.yaml` · proofs `wp33`–`wp36-*`  
**User note (2026-10-29):** `wp36-faceless-doc.mp4` is the best so far — **keep as a skill**. Default still push-in felt slightly fast → slower default with context-dependent speed (WP39).

Full machine grammar: see `remotion/out/phase36-readiness/metromedia-grammar.yaml` and prior WP33–36 docs. Summary:
- ASL ~0.85s · hard cut ~85% · chapter cards 15–25s
- Accumulate captions, blur-fade, y ~42–50%, ~7% frame H
- 100% B-roll · literal noun stills · blur_self · fly-out framed cards
- Flash / sat-pop / B&W~15% / money punch-in

---

## Skill B — Explainer / talking-head (NEW)

**Grammar source:** user AI analysis (scene cuts + 2s samples + loudness), 2026-10-29  
**Canon file:** `remotion/out/phase36-readiness/explainer-grammar.yaml`

### Layouts (every rule refers to these)
- **A** — full-frame talking head
- **B** — split: b-roll top half (y 0–50%), speaker bottom half
- **C** — full-frame b-roll on **#FFFFFF + light-gray dotted grid** (diagrams, mockups, logo grids)
- **D** — full-frame dark cutaway (public figures / archival), vertical crop

### Pacing (not Metromedia hyper-cut)
- Hard cuts; avg ~5.2s, median ~3.8s, min ~2s, max ~15s (closing TH)
- Pattern loop: talking head ↔ b-roll; cuts on sentence/idea boundaries
- Structure: hook → proof → explainer → payoff → CTA
- B-roll segs ~2–4s; talking-head ~3–11s; silence trim >0.3s

### Captions (different from Skill A)
- Heavy geometric sans; white fill + **thick black stroke** + soft shadow
- **Chunk swap** 1–3 words (replace next group) — **not** accumulate karaoke
- y ≈ **50%** on LAYOUT_B (seam); y ≈ **75%** on A/C/D

### Highlights & B-roll
- Accent wipe L→R behind key phrase (preferred lime `#BFFF00`; may be another catalog accent via `editPalette`); rest dims ~28%
- Visual within **0.5s** of spoken number/name/claim
- Logo stagger ~0.5s pop-in; connector draw-on; chat typing mockups
- Cutaways (D) only late; 3–7s
- Single accent discipline (one signal colour per edit)
- No punch-in / motion blur on speaker; ending dip to ~30% then black

---

## Skill D — Newsroom motion-graphics explainer (NEW)

**Grammar source:** user analysis 2026-10-29 (scene detection, 2s samples, loudness).  
**Canon:** `remotion/out/phase36-readiness/newsroom-mg-grammar.yaml`

### Layouts
- **GFX** — animated graphics on black (charts, maps, pictograms, big numerals)
- **CARD** — desaturated photo/doc/clip as rounded card + soft shadow on black/gray
- **HOST** — full-frame color narrator (~13% of runtime), shallow DOF, red rim light
- **EXPERT** — grayscale interview + 2-line white name tag

### Pacing & transitions
- Avg ~3.5s / median ~3.1s; min ~0.7s; max ~9.6s; internal animation beats ~0.5s
- Opening is one continuous GFX shot (~6–7s); bookend chart at start and end
- Host used sparingly as a break from graphics; cuts on idea / named entity / number
- Default hard cut or element-driven change; motion-blur horizontal slide for cards/buildings; expanding mask reveal; ending cut-to-black + audio fade
- Avoid: glitch, light leak, speed ramp, emoji stickers, punch-in on host

### Text
- Captions: thin white sans, **no** stroke/shadow/box, y≈74%, 1–3 word hard swap
- Big numerals white on black; **one** red emphasis word per line (`#E00000` preferred)
- Stacked line-by-line lists; gray source tags; white name tags; red hand ellipses / strike-throughs on docs

### Color
- Preferred palette `newsroom_red_ink` (black / white / signal red); footage grayscale except HOST
- Same WP44 picker may override if content clearly demands another catalog palette

### Explicitly not Skill A
No hyper-cut montage, no accumulate blur-fade captions, no flash-overexpose documentary grade as default, no 100% faceless coverage.

```json
{
  "canvas": {"w": 720, "h": 1280, "fps": 30},
  "layouts": {"A": "full TH", "B": "split broll|speaker", "C": "white dot-grid broll", "D": "dark cutaway"},
  "pacing": {"cut": "hard", "avg_s": 5.2, "median_s": 3.8, "pattern": "B/A/C loop → D → A_cta"},
  "captions": {"mode": "chunk_swap", "words": [1, 3], "stroke": "thick black", "y_pct": {"B": 50, "A": 75, "C": 75, "D": 75}},
  "highlight": {"color": "#BFFF00", "anim": "ltr_wipe", "dim_rest": 0.28},
  "broll": "visual within 0.5s of claim; logo stagger 0.5s; connectors; typing mockups",
  "sfx_music": "deferred"
}
```

---

## Skill C — Textual motion graphics (NEW)

**Research:** [Jitter text templates](https://jitter.video/templates/text/) · [custom text effects](https://jitter.video/templates/custom-text) · [Animate text help](https://help.jitter.video/en/articles/6500074-animate-text) · Apple Event sliding titles · existing FinalPost `type_physics` recipes (`elastic_type_snap`, `type_trail`, `scramble_settle`, `smear_blur_in`, `split_mask_reveal`, `counter_snap`, …).

**Canon:** `remotion/out/phase36-readiness/textual-mg-grammar.yaml`

### Vernacular families (not 300 ports)
| Family | Feel | Engine starting point |
|--------|------|------------------------|
| snap_elastic | scale overshoot + blur clear; bold land | `elastic_type_snap`, `stretch_squash_pop`, `blur_spin_settle` |
| trail_cascade | letter/word stagger; ghosts | `type_trail` |
| scramble_glitch | glyph flicker / RGB then settle | `scramble_settle`, `glitch_text_reveal` |
| smear_blur | directional blur + stretch in | `smear_blur_in` |
| mask_reveal | clip/wipe sliding title | `split_mask_reveal` |
| counter_metric | number ticks to value | `counter_snap` |
| tagline_plate | 1–6 word hero over media | restyle BigKineticHeadline / StampTitle / FlashCard / OpenPlate — **no ProcessSteps** |
| blend_extrude | blend modes / extrusion / repeater | **deferred** (do not fake with web UI cards) |

### Blend into frame
- Type on media or designed ground; soft shadow/stroke for legibility
- Mid-frame / chest-band for hero lines — not lower-third karaoke chrome
- Exit before next cut; one plate at a time (max 2 intentional stack)
- Mute A/B captions while Skill C owns the words

### Triggers
hook title · spoken stat · chapter pivot · CTA keyword · product lockup — never replace all karaoke with Jitter bounces.

---

## Shared craft rules (all skills)
- No solid-color worlds, ProcessSteps hero, glossy neon pills, literal emoji-as-meaning
- Hard cut is a first-class default (whips optional accents)
- Stock/Pexels/Pixabay + labeled uploads OK; no Google scrape
- SFX/music later when assets exist
- Transitions: prefer hard cuts on idea boundaries; layout A↔B↔C↔D swaps are hard; no mushy soft-blend defaults

---

## Offline roadmap (live stays paused)

| WP | Focus | Status |
|----|--------|--------|
| 29–36 | Skill A scaffolding + faceless proof | DONE offline |
| **39** | Still-motion speed dial — slower default; fast when context needs | **DONE offline** — `WP39_MOTION_SPEED.md` |
| **40** | Skill B layouts A/B/C/D + white dotted grid + explainer pacing | **DONE offline** — `WP40_EXPLAINER_LAYOUTS.md` |
| **41** | Skill B chunk-swap captions + lime wipe + claim→visual ≤0.5s | **DONE offline** — `WP41_EXPLAINER_CAPTIONS.md` |
| **37** | Stock relevance / noun-lock (improves A + B) | **DONE offline** — `WP37_NOUN_LOCK.md` |
| **38** | Skill A tools on classic talking-head polish | **DONE offline** — `WP38_TH_SKILL_A.md` |
| **42** | Mount Skill B into production ShortVideo + blueprint + hard-cut transitions | **DONE offline** — `WP42_EXPLAINER_MOUNT.md` · `wp42-explainer-mounted.mp4` |
| **43** | Skill C textual MG catalog + library + analyze + proof | **DONE offline** — `WP43_TEXTUAL_MG.md` · `wp43-textual-mg.mp4` |
| **44** | Content-aware edit palette + Skill D newsroom MG grammar/pacing | **DONE offline (plan+palette; ShortVideo mount of D = follow-up)** |
| **45** | Layer-2 motion-template toolkit (CLIP_01–04) + skill allowlists + sparse planner | **DONE offline** — `WP45_MOTION_TEMPLATES.md` · `wp45-motion-templates.mp4` |
| **46** | Layer-2 toolkit +4 (CLIP_05–08: brand loop, blur carousel, iOS notify, nested-rect typewriter) | **DONE offline** — `WP46_MOTION_TEMPLATES.md` · `wp46-motion-templates.mp4` |
| **47** | Layer-2 toolkit +4 (CLIP_09–12 / Part 2: fruit letter-swap, MORPH stretch, menu slide, editorial inset) | **DONE offline** — `WP47_MOTION_TEMPLATES.md` · `wp47-motion-templates.mp4` |
| **48** | Layer-2 toolkit +4 (CLIP_13–16 / layout C1–C4: heritage poster, silk cover, glass testimonial, portrait push) | **DONE offline** — `WP48_MOTION_TEMPLATES.md` · `wp48-motion-templates.mp4` |
| **49** | Engagement grammar: VO sync lead, edit-palette on toolkits, split→full expand, stillness `frame_inset` | **DONE offline** — tests `wp49EngagementGrammar.test.ts` |
| **50** | Layer-2 toolkit +5 (CLIP_17–21 / Part 4: photo stacks, never-done slit, livestream typewriter) | **READY** offline |
| **51** | Layer-2 toolkit +5 (CLIP_22–26 / Batch B) | **READY** offline |
| **52** | Live craft QA gates (test2 feedback): ban Klipy default, ban scatter-bubble, callout discipline, no double-stat, plate variety + end clamp | **DONE offline** — `WP52_CRAFT_QA.md` · tests `wp52CraftQa.test.ts` (Live stays PAUSED) |
| **53** | Visual backends inside existing toolkits: riso (eian-riso-broll) · collage (gbro, deferred) · anidoodle (adapter only); clip_27–34; flags `POLISH_RISO_TEMPLATES` / `POLISH_COLLAGE_BROLL` / `POLISH_ANIDOODLE` default OFF | **DONE offline** — `WP53_VISUAL_BACKENDS.md` · tests `wp53VisualBackends.test.ts` (Live stays PAUSED) |
| **54** | Craft standards + kinetic/ecommerce L2 + finish WP53 mounts (six-repo expand; not new L1) | **DONE offline** — `WP54_CRAFT_AND_TEMPLATES.md` · audit `WP54_AUDIT.md` · tests `wp54CraftAndTemplates.test.ts` · `npm run preview:wp54` (Live stays PAUSED) |
| **55** | KINETIC_TYPE_STORYTELLING overlays clip_45–54 | **DONE offline** — live re-QA `test2-polish-wp55-live.mp4` showed Director owned empty → 0 overlays |
| **56** | Live craft: stillness inset pacing, kinetic fallback, Color Director (editorial), caption ownership, split-seam blur, copy relevance | **DONE offline** — `WP56_CRAFT_DIRECTOR.md` · tests `wp56CraftDirector.test.ts` (Live stays PAUSED) |
| **57** | Kinetic-Led experimental mode (`POLISH_KINETIC_LED`, default OFF): style bible density ~1/3.5s, face-safe type, captions on | **DONE offline** — `WP57_KINETIC_LED.md` · `KINETIC_LED_STYLE_BIBLE.md` · tests `wp57KineticLed.test.ts` (Live stays PAUSED) |
| Live | **ACTIVE** (2026-10-31) — deliberate Kinetic-Led burn: `jensen.mp4` (`POLISH_KINETIC_LED=1`) · dump `jensen-kinetic-led/` | |

### WP49 — Engagement grammar (integrate toolkits)
**Implemented (offline):** make Layer-2 toolkits feel like part of the edit, not demos.
1. **VO sync lead** — `MOTION_TEMPLATE_SYNC_LEAD_SEC` / `CLAIM_BEAT_LEAD_SEC` = 0.35 s (graphics open before the cue word).
2. **Edit palette discipline** — motion-template stage passes `accent` + `ground` + `ink` from `editPalette`; bind merges them into every grounded beat; Heritage/Glass comps honour them (proof shells only when unset).
3. **Split → full expand** — `explainerSplitExpandAt` animates the B seam: speaker expands up into A, top pane expands down into C/D (~0.4 s); ShortVideo uses it.
4. **Stillness `frame_inset`** — `planStillnessFrameInsets` fills long open talking-head gaps (trigger 3.2 s, hold 1.35 s, scale 0.86); wired on polish in `analyzeVideo`.
Tests: `wp49EngagementGrammar.test.ts`. Live QA still PAUSED.

### WP39 — Still motion speed (Skill A polish)
**Implemented (offline):** `motionSpeed: 'slow' | 'normal' | 'fast'` = push-in 1.00→1.04 (DEFAULT) / 1.06 / 1.08, linear over the hold. Per still (`items[i].motionSpeed`) or per run; faceless planner: money / headline holds + hook shot = fast, breathing / chapter-adjacent = slow, else slow. Framed cards unchanged. Proof: `wp39-motion-speed.jpg`; tests `wp39MotionSpeed.test.ts`. `POLISH_FACELESS_DOC` path unchanged.

- Default full-bleed push-in slower than 1.00→1.08 over short holds (e.g. target ~1.00→1.05 over hold, or longer ease).
- `motionSpeed: 'slow' | 'normal' | 'fast'` (or numeric) on ImageRun / editorial items; money/hook may stay fast; chapter/breathing moments slow.
- Must not break WP36 skill — regression pin on faceless tests + short before/after strip.

### WP37 — Noun-lock / stock relevance
**Implemented (offline):** `server/src/stages/broll/nounLock.ts` (pure): head-noun profile (server room, audio / video editing, markets, money, counted people / users / customers), noun-locked 2–4 word queries ("six billion" → `dollar bills cash stack`, never `bank notes table`; "six billion people" → crowd, never cash), a food / dining ban unless the speech says food, a candidate judge (Pexels alt / Pixabay tags / page slug / query words: accept · reject · unknown), and a bounded reject→exclude→re-ask loop. Wired into `facelessDocLane` + `editorialStillMontage` (`nounLock` option, default on) and `explainerClaims.claimBeatQueries`; both `analyzeVideo` resolvers pass photo metadata. Warnings `polish_assets:noun_lock:<n>` / `noun_lock_rejected:<n>` / `noun_lock_miss:<n>`. Cut grammar, caption modes and WP39 speed untouched. Proof `wp37-noun-lock.json`; tests `wp37NounLock.test.ts`.

### WP40 — Explainer layouts
**Implemented (offline):** layout ids `explainer_a|b|c|d` (`remotion/src/lib/explainerLayouts.ts`, `components/ExplainerLayouts.tsx`; C = #FFF + light-gray dot grid), pure planner `server/src/stages/broll/explainerPacing.ts` (B hook → A/C alternating → late D → A cta; median ~3.5–4 s; warning `polish_pace:explainer_cuts:<n>`), env `POLISH_EXPLAINER_SKILL=0` default, mutual exclusion with `POLISH_FACELESS_DOC` (faceless wins). Proof `npm run preview:wp40`; tests `wp40ExplainerLayouts.test.ts`. Production render mounting = later.

Original spec:
- First-class layout enum A/B/C/D in polish explainer skill.
- LAYOUT_C: white + dotted grid ground for diagrams/mockups/logo grids.
- Pacing planner: medium intervals (2–11s), alternate TH ↔ b-roll; not ASL 0.85.
- Offline proof cycling A→B→C→A→D with fixture stills/speaker stand-in.

### WP38 — Skill A tools on classic talking-head polish
**Implemented (offline):** classic polish (neither `POLISH_FACELESS_DOC` nor `POLISH_EXPLAINER_SKILL`) keeps the face primary and composes the Skill A tools. Honest split — ALREADY there by default: WP33 cut plan, WP34 accumulate captions (at y 46 %, over the face), WP35 impact FX, WP30/37 stills (up to ~30 % of runtime). NEW: `server/src/stages/broll/talkingHeadSkillA.ts` (pure) + env `POLISH_TH_SKILL_A_TOOLS` (default on; 0 = pre-WP38): (1) the accumulate line moves to the face-safe band via optional `CaptionDirection.faceSafeYFrac` 0.58 (WP34 `centerYFrac` band unchanged; first row anchored so a wrapped line grows down), (2) tighter still caps (1 open + 2 mid runs, 3–4 stills, runs <= 5.4 s, <= 25 % of runtime and <= 28 % with chapter cards, via new optional `planEditorialStillMontage` inputs), (3) `polish_th_skill_a:*` summary warnings. Wired in `analyzeVideo.ts` only when the switch is true; faceless / explainer blocks and planners do not reference it. Proof `npm run preview:wp38` -> `wp38-talking-head-skill-a.mp4` (+ `wp38-contact-sheet.jpg`, `wp38-caption-y.jpg`, `wp38-measured.json`); tests `wp38TalkingHeadSkillA.test.ts`.

### WP41 — Explainer captions + lime claim visuals
- Chunk-swap caption mode (1–3 words), thick black stroke, y by layout.
- Lime `#BFFF00` L→R wipe highlight on screenshot/article plates; dim rest ~28%.
- Claim/number/name → visual within 0.5s (planner).
- Logo stagger pop-ins ~0.5s. No SFX.

**Implemented (offline):** caption mode `chunk_swap` (`remotion/src/lib/chunkSwapCaptions.ts`, `components/ChunkSwapCaptions.tsx`; schema + `CaptionDirection.mode` / `yTrack`; `KineticCaptions` + `DynamicCaptionRenderer` branch; accumulate stays Skill A / polish default): 1–3 word chunks that REPLACE each other, white + thick black stroke + soft shadow, y by layout (B 50 %, A/C/D 75 %). `LimeHighlightWipe` + `lib/limeHighlight.ts`: `#BFFF00` L→R wipe behind the key phrase, rest dims to 0.28. `server/src/stages/broll/explainerClaims.ts` (`detectClaims`, `planClaimVisuals`): number / amount / percent / name → a B/C/D segment or a layout-B article beat ≤ 0.5 s (unmet reported, never hidden); `server/src/lib/polishExplainerCaptions.ts` writes the direction. Wired only inside the `POLISH_EXPLAINER_SKILL=1` block of `analyzeVideo.ts` (plan + warnings `polish_claim:*`, `polish_explainer_captions:*`; faceless still wins). Proof `npm run preview:wp41` → `wp41-explainer-captions.mp4`; tests `wp41ExplainerCaptions.test.ts`. Production mounting of layouts/beat plates = later.

---

## Status snapshot

| Skill / WP | Status |
|------------|--------|
| Skill A (Metromedia faceless) | **KEEP** — `wp36-faceless-doc.mp4` |
| Skill B (Explainer) | **MOUNTED** — WP42 + WP44 palette (lime preferred, content can override) |
| Skill C (Textual MG) | **SHIPPED offline** — WP43 |
| Skill D (Newsroom MG) | **PLANNED** — grammar + pacing + analyze track; ShortVideo mount follow-up |
| Edit palette | **SHIPPED** — `editPalette.ts` / `blueprint.editPalette` |
| Live | **PAUSED** — WP52 + WP53 + WP54 offline DONE; next burn is deliberate re-QA |

---

## Non-goals
- Not deleting Skill A/B/C to make room for Skill D
- Not SFX/music this cycle
- Not live unpause
- Not website ProcessSteps as hero
- Not locking every edit to the reference video's hex colours
- Not porting every Jitter template 1:1 — vernacular families only
