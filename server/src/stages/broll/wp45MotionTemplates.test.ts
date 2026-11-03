/**
 * WP45 + WP46 + WP47 Layer-2 motion-template toolkit (CLIP_01..12; WP46 = CLIP_05..08, CLIP_07 is the one overlay that owns no frame; WP47 = CLIP_09..12 = analysis Part 2 ACME Clips 5-8): catalog completeness, skill allowlists (Skill -> Primitives), planner sparsity + caption mute, library registry hits + Tiny TSX that passes the worker's typecheck /
 * compile, publish + stage, the flag-gated analyze block, timing / craft pins on the four comps, and "Skills A / B / C / D are untouched, no 5th lane". Offline: no network, no model, no Chromium (the publisher is a fake).
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
  ACME_BASE_SEC,
  ACME_BRAND_LOOP_TIMELINE,
  ACME_FRUIT_FROM_SCALE,
  ACME_FRUIT_ROTATE_DEG,
  ACME_FRUIT_SETTLE_SEC,
  ACME_SCENES,
  ACME_SCENE_SEC,
  BENTO_CAMERA_TIMELINE,
  BLUR_CAROUSEL_BASE_SEC,
  BLUR_CAROUSEL_TIMELINE,
  BLUR_HOLD_SEC,
  BLUR_MOVE_SEC,
  BLUR_MOVES,
  BLUR_STEP_SEC,
  CONFIG_BRAND_LOOP_BASE_SEC,
  CONFIG_BRAND_LOOP_TIMELINE,
  CONFIG_CUT_GRID_SEC,
  CONFIG_STICKER_WINDOWS,
  EDITORIAL_BASE_SEC,
  EDITORIAL_COLORS,
  EDITORIAL_CUT_SEC,
  EDITORIAL_DEFAULT_LINES,
  EDITORIAL_GROW_FROM_SEC,
  EDITORIAL_INSET_TIMELINE,
  EDITORIAL_LINE_SEC,
  EDITORIAL_LINE_STAGGER_SEC,
  EDITORIAL_SETTLE_END_SEC,
  EDITORIAL_SPLIT_FROM_SEC,
  EDITORIAL_SPLIT_SEC,
  GRID_MORPH_TIMELINE,
  IOS_CURSOR_HIDE_SEC,
  IOS_HAND_AT_SEC,
  IOS_NOTIFICATION_TIMELINE,
  MENU_BASE_SEC,
  MENU_COLORS,
  MENU_DEFAULT_SLIDES,
  MENU_FOOTER,
  MENU_LINE2_LAG_SEC,
  MENU_PERIOD_SEC,
  MENU_PHOTO_LEAD_SEC,
  MENU_SLIDE_COUNT,
  MENU_SLIDE_SEC,
  MENU_SLIDE_TIMELINE,
  MORPH_BASE_SEC,
  MORPH_COLORS,
  MORPH_CUT_SEC,
  MORPH_FONT_TIMELINE,
  MORPH_LETTER_FROM_SEC,
  MORPH_LETTER_SEC,
  MORPH_LETTER_STAGGER_SEC,
  MORPH_STRETCH_FROM_SEC,
  MORPH_STRETCH_X,
  MORPH_STRETCH_Y,
  MORPH_WIDTH,
  NESTED_CUT_SEC,
  NESTED_DEFAULT_LINES,
  NESTED_LAYERS,
  NESTED_RECT_BASE_SEC,
  NESTED_RECT_TIMELINE,
  NESTED_TYPE_CPS,
  NESTED_TYPE_START_SEC,
  MOTION_TEMPLATE_TIMELINES,
  SLIT_ACCORDION_FACTOR,
  SLIT_CAROUSEL_TIMELINE,
  STACK_CYCLE_SEC,
  STACK_TIMELINE,
  STACK_TRANSITION_SEC,
  bentoCamera,
  bentoLayout,
  acmeFruitState,
  acmeSceneIndex,
  acmeSceneStart,
  bentoTranslate,
  blurCarouselPos,
  blurRowStyle,
  blurTiltDeg,
  configLoopTime,
  configMask,
  configMaskPath,
  configMaskRadii,
  configMaskRadiiAt,
  configScene,
  configStickerState,
  editorialLineOffset,
  editorialPhotoRect,
  editorialSplit,
  fitContain,
  gridMergeRect,
  iosCursorState,
  menuEase,
  menuLayerPositions,
  menuPosition,
  menuSlideStart,
  morphFrame,
  morphLetterStagger,
  nestedRectScale,
  slitAccordion,
  slitAdvance,
  slitFocusItem,
  stackState,
  stackTiltDeg,
  templateScale,
  typewriterChars,
} from '../../../../remotion/src/lib/motionTemplateTiming.ts';
import * as timing51 from '../../../../remotion/src/lib/motionTemplateTiming.ts';
import {env} from '../../config/env.ts';
import {validateGraphicSource, type MotionGraphicResult} from '../../motionWorker/worker.ts';
import {
  LIBRARY_COMPOSITION_IDS,
  LIBRARY_COMPOSITIONS,
  MOTION_TEMPLATE_REGISTRY_IDS,
  libraryGraphicSource,
  resolveLibraryGraphic,
} from '../motionDirector/libraryRegistry.ts';
import {
  NEVER_DONE_BASE_SEC,
  NEVER_DONE_STATE_A_FROM_SEC,
  STACK_COLLAPSE_END_HEIGHT,
  STACK_COLLAPSE_RECTS,
  STACK_REVEAL_BLANK_TO_SEC,
  STACK_REVEAL_HOLD_FROM_SEC,
  STACK_REVEAL_RECTS,
  TWO_UP_EXIT_FROM_SEC,
  TWO_UP_RECTS,
  TYPEWRITER_BASE_SEC,
  TYPEWRITER_BLOCK_Y_FROM,
  TYPEWRITER_BLOCK_Y_TO,
  neverDoneFrame,
  stackCollapseHeight,
  stackRevealHeight,
  stackRevealOpacity,
  twoUpExit,
  typewriterBarExpand,
  typewriterBlockY,
  typewriterCps,
  typewriterMark,
  GLASS_BASE_SEC,
  GLASS_BLUR_PX,
  GLASS_SNAP_SCALE,
  HERITAGE_BASE_SEC,
  HERITAGE_LOOP_CUT_SEC,
  HERITAGE_THUMB,
  PORTRAIT_PUSH_TIMELINE,
  PUSH_BASE_SEC,
  PUSH_GAP,
  PUSH_OUT_SCALE,
  SILK_BASE_SEC,
  SILK_COVER,
  SILK_THUMB,
  glassFrame,
  heritageFlash,
  heritageLineOffset,
  heritageMarkerStage,
  heritagePhotoRect,
  pushState,
  pushTravel,
  silkBodyOffset,
  silkLineOffset,
  silkPhotoRect,
  silkWordmarkOffset,
} from '../../../../remotion/src/lib/motionTemplateTiming.ts';
import {bindMotionTemplateContent} from './motionTemplateBind.ts';
import type {PolishSkill} from './explainerPacing.ts';
import {
  MOTION_TEMPLATE_CATALOG as ALL_MOTION_TEMPLATE_CATALOG,
  MOTION_TEMPLATE_GRAPHIC_ID_PREFIX,
  MOTION_TEMPLATE_IDS as ALL_MOTION_TEMPLATE_IDS,
  MOTION_TEMPLATE_PRIMITIVES,
  SKILL_MOTION_TEMPLATE_ALLOWLIST as ALL_SKILL_MOTION_TEMPLATE_ALLOWLIST,
  mapPolishSkillToMotionTemplateSkill,
  motionTemplate,
  motionTemplateBrief,
  planMotionTemplateBeats,
  templatesAllowedFor,
  type MotionTemplateSkill,
  type MotionTemplateWord,
} from './motionTemplateCatalog.ts';

// WP53: clip_27..34 are VISUAL-BACKEND rows (riso / collage / anidoodle), pinned in wp53VisualBackends.test.ts. These WP45–51 pins cover the 26 native Remotion templates only.
// WP54: clip_35..44 are native too but belong to planCraftTemplateBeats (wp54CraftAndTemplates.test.ts); this file keeps pinning CLIP_01..26.
const isNative = (id: string) => !/^clip_(2[7-9]|3\d|4\d|5\d)_/.test(id);
const MOTION_TEMPLATE_CATALOG = ALL_MOTION_TEMPLATE_CATALOG.filter(row => !row.backend && !row.lane);
const MOTION_TEMPLATE_IDS = ALL_MOTION_TEMPLATE_IDS.filter(isNative);
const SKILL_MOTION_TEMPLATE_ALLOWLIST = Object.fromEntries(Object.entries(ALL_SKILL_MOTION_TEMPLATE_ALLOWLIST).map(([skill, ids]) => [skill, ids.filter(isNative)])) as typeof ALL_SKILL_MOTION_TEMPLATE_ALLOWLIST;
import {publishMotionTemplateBeats, type MotionTemplatePublisher} from './motionTemplatePublish.ts';
import {runMotionTemplateStage} from './motionTemplateStage.ts';

const WP54_PRIMITIVES = new Set<string>(['word_stagger_reveal', 'line_mask_rise', 'char_stagger_fade', 'weight_axis_morph', 'logo_mask_open', 'mesh_field_drift', 'device_frame_rise', 'cursor_glide_click', 'strike_and_count', 'still_push_in', 'stroke_draw_on', 'environmental_type_behind_subject', 'impact_number_pop', 'directional_word_stagger', 'split_scale_color_headline', 'word_pop_beside_subject', 'layered_line_stack', 'floating_depth_icons', 'logo_chip_reveal', 'kinetic_cta_stack', 'drawn_accent_emphasis', 'text_match_cut']);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), 'utf8');
const analyze = read('server/src/pipeline/analyzeVideo.ts');
/** Source with block + line comments removed (the craft / no-SFX pins are about code, not the docs that say "no blur"). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WP45_COMPS = ['GridMosaicMorph', 'SlitPanelCarousel', 'BentoCardWall', 'StackedCardDeck'] as const;
const WP46_COMPS = ['ConfigBrandLoop', 'BlurWordCarousel', 'IosNotificationMock', 'NestedRectTitleWipe'] as const;
const WP47_COMPS = ['AcmeFruitLetterSwap', 'MorphFontStretch', 'MenuSlidePoster', 'EditorialInsetPoster'] as const;
const WP47_IDS = ['clip_09_acme_fruit_swap', 'clip_10_morph_stretch', 'clip_11_menu_slide', 'clip_12_editorial_inset'] as const;
const WP48_COMPS = ['HeritageDevotionPoster', 'SilkLegacyCover', 'GlassTestimonialMorph', 'PortraitPushCarousel'] as const;
const WP48_IDS = ['clip_13_heritage_poster', 'clip_14_silk_legacy', 'clip_15_glass_testimonial', 'clip_16_portrait_push'] as const;
const WP50_COMPS = ['PhotoStackCollapse', 'PhotoStackReveal', 'TwoUpStackHold', 'NeverDoneSlitPoster', 'TypewriterPoster'] as const;
const WP50_IDS = ['clip_17_photo_stack_collapse', 'clip_18_photo_stack_reveal', 'clip_19_two_up_stack', 'clip_20_never_done_slit', 'clip_21_typewriter'] as const;
const WP51_COMPS = ['ChatConversationBubbles', 'SalePromoCountdown', 'ColorWordWheel', 'TrackingCollapseHeadline', 'SpatialBlurTiltReveal'] as const;
const WP51_IDS = ['clip_22_chat_conversation', 'clip_23_sale_promo', 'clip_24_color_word_wheel', 'clip_25_tracking_collapse', 'clip_26_spatial_blur_tilt'] as const;
const COMPS = [...WP45_COMPS, ...WP46_COMPS, ...WP47_COMPS, ...WP48_COMPS, ...WP50_COMPS, ...WP51_COMPS] as const;
const OVERLAY_ID = 'clip_07_ios_notification';
/** The library placement a catalog template resolves under: clip_07 is the one overlay, everything else is full-bleed. */
const placementFor = (id: string) => (id === OVERLAY_ID ? 'overlay' : 'full_screen');
const SKILLS: MotionTemplateSkill[] = ['faceless', 'explainer', 'textual_mg', 'newsroom_mg', 'default'];

/** The WP45 block of analyzeVideo (from its marker to the Skill C marker). */
const wp45Block = (() => {
  const start = analyze.indexOf('// WP45: LAYER-2 MOTION TEMPLATES');
  const end = analyze.indexOf('// WP43: SKILL C');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return analyze.slice(start, end);
})();

/** A VO with a product / gallery / wall / brand / evidence phrase every ~7 s over `durationSec`. */
function voice(durationSec: number): MotionTemplateWord[] {
  const phrases = ['here is the product launch', 'a gallery of photos', 'the portfolio wall of screens', 'brand colors and logo', 'look at this proof'];
  const out: MotionTemplateWord[] = [];
  for (let at = 0.3, i = 0; at < durationSec - 3; at += 7, i++) {
    for (const [k, text] of phrases[i % phrases.length]!.split(' ').entries()) out.push({text, start: at + k * 0.4, end: at + k * 0.4 + 0.35});
  }
  return out;
}

const fakeResult = (brief: {id: string; content: Record<string, unknown>; placement?: string}): MotionGraphicResult =>
  ({
    id: brief.id,
    module: {url: `https://cdn.invalid/${brief.id}.js`, sha256: 'a'.repeat(64)},
    placement: {mode: brief.placement ?? 'full_screen'},
    props: {content: brief.content},
    brief: {purpose: 'p', visualIntent: 'v'},
  }) as unknown as MotionGraphicResult;
const okPublisher = (async (brief: {id: string; content: Record<string, unknown>; placement?: string}) => fakeResult(brief)) as unknown as MotionTemplatePublisher;

describe('WP45 + WP46 + WP47 + WP48 catalog completeness', () => {
  it('26 templates, 48 primitives, each template maps to a composition that exists, is exported and is in the compositions map', () => {
    expect(MOTION_TEMPLATE_CATALOG).toHaveLength(26);
    expect(MOTION_TEMPLATE_PRIMITIVES.filter(p => !WP54_PRIMITIVES.has(p))).toHaveLength(48); // WP54 appended 11 more (pinned in wp54CraftAndTemplates.test.ts)
    const index = read('remotion/src/motion/index.ts');
    expect(MOTION_TEMPLATE_CATALOG.map(t => t.compositionId)).toEqual([...COMPS]);
    for (const comp of COMPS) {
      expect(existsSync(join(repo, `remotion/src/motion/compositions/templates/${comp}.tsx`)), comp).toBe(true);
      expect(index, comp).toMatch(new RegExp(`export \\{${comp}\\b`));
      expect(index, comp).toMatch(new RegExp(`export const compositions = \\{[^}]*\\b${comp}\\b`));
    }
  });

  it('every catalog primitive is realised by a timeline op, and every timeline primitive is a catalog primitive of that template', () => {
    for (const spec of MOTION_TEMPLATE_CATALOG) {
      const timeline = MOTION_TEMPLATE_TIMELINES[spec.id];
      const used = new Set(timeline.ops.map(op => op.primitive).filter((p): p is string => p !== null));
      expect([...used].sort(), spec.id).toEqual([...spec.primitives].sort());
      expect(timeline.baseSec, spec.id).toBeCloseTo(spec.durationSec, 2);
    }
    // the logo_fill / hold / contract / settle helpers carry no primitive id
    expect(GRID_MORPH_TIMELINE.find(op => op.id === 'logo_fill')!.primitive).toBeNull();
  });

  it('WP46 - WP51: all 48 primitives are realised across the 26 timelines; clip_07 has NO primitive (helper ops only); op windows are well formed', () => {
    const all = new Set(Object.values(MOTION_TEMPLATE_TIMELINES).flatMap(timeline => timeline.ops.map(op => op.primitive).filter((p): p is string => p !== null)));
    expect([...all].sort()).toEqual([...MOTION_TEMPLATE_PRIMITIVES].filter(p => !WP54_PRIMITIVES.has(p)).sort());
    expect(motionTemplate(OVERLAY_ID)!.primitives).toEqual([]);
    expect(IOS_NOTIFICATION_TIMELINE.every(op => op.primitive === null)).toBe(true);
    for (const [id, timeline] of Object.entries(MOTION_TEMPLATE_TIMELINES)) {
      for (const op of timeline.ops) {
        expect(op.from, `${id}:${op.id}`).toBeGreaterThanOrEqual(0);
        expect(op.to, `${id}:${op.id}`).toBeGreaterThanOrEqual(op.from);
        expect(op.to, `${id}:${op.id}`).toBeLessThanOrEqual(timeline.baseSec + 1e-9);
      }
    }
  });

  it('grammar yaml is the source of the allowlists (parity with SKILL_MOTION_TEMPLATE_ALLOWLIST) and the durations', () => {
    const yaml = read('remotion/out/phase36-readiness/motion-template-primitives.yaml');
    const block = yaml.slice(yaml.indexOf('skill_allowlists:'), yaml.indexOf('# Director defaults'));
    for (const skill of SKILLS) {
      const match = block.match(new RegExp(`\\n  ${skill}:[^\\n]*\\n\\s+templates: \\[([^\\]]+)\\]`));
      expect(match, skill).not.toBeNull();
      const ids = match![1]!.split(',').map(id => id.trim());
      expect([...ids].sort(), skill).toEqual([...SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]].sort());
    }
    for (const spec of MOTION_TEMPLATE_CATALOG) expect(yaml).toContain(`compositionId: ${spec.compositionId}`);
    expect(yaml).toMatch(/max_templates_per_30s: 2/);
    expect(yaml).toMatch(/min_gap_s: 4\.0/);
    expect(yaml).toMatch(/mute_captions_while_opaque: true/);
  });

  it('the registry copy of the id -> composition map equals the catalog (the registry imports nothing)', () => {
    expect(Object.keys(MOTION_TEMPLATE_REGISTRY_IDS)).toEqual([...MOTION_TEMPLATE_IDS]);
    for (const spec of MOTION_TEMPLATE_CATALOG) expect(MOTION_TEMPLATE_REGISTRY_IDS[spec.id]).toBe(spec.compositionId);
    expect(read('server/src/stages/motionDirector/libraryRegistry.ts')).not.toMatch(/^import /m);
  });

  it('twenty-five are opaque full-bleed (they own the frame and mute captions; WP47, WP48 add four each, WP50 and WP51 five); clip_07 is the overlay exception (owns no frame, captions stay on)', () => {
    for (const spec of MOTION_TEMPLATE_CATALOG.filter(row => row.id !== OVERLAY_ID)) {
      const entry = LIBRARY_COMPOSITIONS.find(row => row.id === spec.compositionId)!;
      expect(spec.ownsFrame, spec.id).toBe(true);
      expect(spec.placement ?? 'full_screen', spec.id).toBe('full_screen');
      expect(entry.opaqueOnly, spec.id).toBe(true);
      expect(entry.overlayOnly, spec.id).toBeUndefined();
    }
    const notify = MOTION_TEMPLATE_CATALOG.find(row => row.id === OVERLAY_ID)!;
    const entry = LIBRARY_COMPOSITIONS.find(row => row.id === 'IosNotificationMock')!;
    expect(notify.ownsFrame).toBe(false);
    expect(notify.placement).toBe('overlay');
    expect(entry.overlayOnly).toBe(true);
    expect(entry.opaqueOnly).toBeUndefined(); // NOT opaqueOnly
  });
});

describe('WP45 skill allowlists (Skill L1 -> Primitives L2)', () => {
  it('pins (WP51): the allowlists are exactly the catalog rows below (WP50 + the chat / sale promo / colour wheel / tracking headline / spatial reveal moves, spread by skill; no 5th lane)', () => {
    expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless].sort()).toEqual(['clip_01_grid_morph', 'clip_03_bento_camera', 'clip_04_stacked_cards', 'clip_05_config_brand_loop', 'clip_08_nested_rect_title', 'clip_09_acme_fruit_swap', 'clip_12_editorial_inset', 'clip_13_heritage_poster', 'clip_14_silk_legacy', 'clip_16_portrait_push', 'clip_17_photo_stack_collapse', 'clip_18_photo_stack_reveal', 'clip_19_two_up_stack', 'clip_20_never_done_slit', 'clip_23_sale_promo']);
    expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer].sort()).toEqual(['clip_01_grid_morph', 'clip_02_slit_carousel', 'clip_03_bento_camera', 'clip_06_blur_word_carousel', 'clip_07_ios_notification', 'clip_08_nested_rect_title', 'clip_10_morph_stretch', 'clip_11_menu_slide', 'clip_12_editorial_inset', 'clip_13_heritage_poster', 'clip_15_glass_testimonial', 'clip_16_portrait_push', 'clip_18_photo_stack_reveal', 'clip_19_two_up_stack', 'clip_20_never_done_slit', 'clip_21_typewriter', 'clip_22_chat_conversation', 'clip_23_sale_promo', 'clip_24_color_word_wheel', 'clip_25_tracking_collapse', 'clip_26_spatial_blur_tilt']);
    expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.newsroom_mg].sort()).toEqual(['clip_01_grid_morph', 'clip_03_bento_camera', 'clip_04_stacked_cards', 'clip_05_config_brand_loop', 'clip_06_blur_word_carousel', 'clip_07_ios_notification', 'clip_08_nested_rect_title', 'clip_09_acme_fruit_swap', 'clip_10_morph_stretch', 'clip_11_menu_slide', 'clip_12_editorial_inset', 'clip_14_silk_legacy', 'clip_15_glass_testimonial', 'clip_16_portrait_push', 'clip_17_photo_stack_collapse', 'clip_18_photo_stack_reveal', 'clip_20_never_done_slit', 'clip_23_sale_promo', 'clip_25_tracking_collapse']);
    expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg].sort()).toEqual(['clip_04_stacked_cards', 'clip_06_blur_word_carousel', 'clip_09_acme_fruit_swap', 'clip_10_morph_stretch', 'clip_13_heritage_poster', 'clip_14_silk_legacy', 'clip_20_never_done_slit', 'clip_21_typewriter', 'clip_22_chat_conversation', 'clip_24_color_word_wheel', 'clip_25_tracking_collapse', 'clip_26_spatial_blur_tilt']);
    expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.default].sort()).toEqual(['clip_02_slit_carousel', 'clip_04_stacked_cards', 'clip_05_config_brand_loop', 'clip_06_blur_word_carousel', 'clip_07_ios_notification', 'clip_08_nested_rect_title', 'clip_09_acme_fruit_swap', 'clip_10_morph_stretch', 'clip_11_menu_slide', 'clip_12_editorial_inset', 'clip_13_heritage_poster', 'clip_15_glass_testimonial', 'clip_16_portrait_push', 'clip_18_photo_stack_reveal', 'clip_19_two_up_stack', 'clip_20_never_done_slit', 'clip_21_typewriter', 'clip_22_chat_conversation', 'clip_23_sale_promo', 'clip_24_color_word_wheel', 'clip_25_tracking_collapse', 'clip_26_spatial_blur_tilt']);
  });

  it('WP48: the layout four are gated inside the existing skills (the glass testimonial is never faceless / textual_mg; the silk cover never explainer / default; textual_mg gets the two poster covers but never the testimonial / push); every WP48 template owns the frame and loops', () => {
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain('clip_15_glass_testimonial');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg).not.toContain('clip_15_glass_testimonial');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg).not.toContain('clip_16_portrait_push');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).not.toContain('clip_14_silk_legacy');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.default).not.toContain('clip_14_silk_legacy');
    for (const skill of SKILLS) expect(new Set(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]).size).toBe(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill].length);
    for (const id of WP48_IDS) {
      const row = MOTION_TEMPLATE_CATALOG.find(spec => spec.id === id)!;
      expect(row.ownsFrame, id).toBe(true);
      expect(row.loop, id).toBe(true);
    }
  });

  it('WP47: the ACME four are gated inside the existing skills (the type-forward Skill C gets only the two type moves; the menu is never a faceless / textual move; the morph is never faceless); no skill gets a template twice', () => {
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg).not.toContain('clip_11_menu_slide');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg).not.toContain('clip_12_editorial_inset');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain('clip_10_morph_stretch');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain('clip_11_menu_slide');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).not.toContain('clip_09_acme_fruit_swap');
    for (const skill of SKILLS) expect(new Set(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]).size).toBe(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill].length);
    for (const id of WP47_IDS) expect(MOTION_TEMPLATE_CATALOG.find(row => row.id === id)!.ownsFrame, id).toBe(true);
    for (const id of WP47_IDS) expect(MOTION_TEMPLATE_CATALOG.find(row => row.id === id)!.loop, id).toBe(true);
  });

  it('WP46: the new four are gated too (faceless never gets the blur carousel / notification; textual_mg never gets the brand loop / notification / nested title); no skill gets a template twice', () => {
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain('clip_06_blur_word_carousel');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain(OVERLAY_ID);
    for (const id of ['clip_05_config_brand_loop', OVERLAY_ID, 'clip_08_nested_rect_title']) expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg).not.toContain(id);
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).not.toContain('clip_05_config_brand_loop');
    for (const skill of SKILLS) expect(new Set(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]).size).toBe(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill].length);
  });

  it('explainer never gets clip_04 (stacked cards), faceless / newsroom never get the carousel', () => {
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.explainer).not.toContain('clip_04_stacked_cards');
    expect(templatesAllowedFor('explainer').map(t => t.id)).not.toContain('clip_04_stacked_cards');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain('clip_02_slit_carousel');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.newsroom_mg).not.toContain('clip_02_slit_carousel');
  });

  it('every skill allowlist id is a catalog id and the lane skills map to themselves (no new lane)', () => {
    for (const skill of SKILLS) for (const id of SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]) expect(motionTemplate(id), `${skill}:${id}`).toBeDefined();
    const lanes: PolishSkill[] = ['default', 'faceless', 'explainer', 'newsroom_mg'];
    for (const lane of lanes) expect(mapPolishSkillToMotionTemplateSkill(lane)).toBe(lane);
    // textual_mg is never a lane: nothing maps TO it
    for (const lane of lanes) expect(mapPolishSkillToMotionTemplateSkill(lane)).not.toBe('textual_mg');
  });

  it('the planner enforces the gate for every skill over many VOs (no beat outside the active allowlist)', () => {
    for (const skill of SKILLS) {
      for (const durationSec of [20, 40, 75, 120]) {
        const plan = planMotionTemplateBeats({skill, durationSec, words: voice(durationSec)});
        for (const beat of plan.beats) expect(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill], `${skill}@${durationSec}:${beat.templateId}`).toContain(beat.templateId);
      }
    }
    for (const durationSec of [20, 40, 75, 120]) {
      expect(planMotionTemplateBeats({skill: 'explainer', durationSec, words: voice(durationSec)}).beats.some(b => b.templateId === 'clip_04_stacked_cards')).toBe(false);
    }
  });
});

describe('WP45 planner: sparse + caption mute + blocked ranges', () => {
  it('sparse: at most ~2 per 30 s, >= 4 s between beats, never overlapping, mute ranges = the opaque beats', () => {
    for (const skill of ['faceless', 'explainer', 'newsroom_mg', 'default'] as const) {
      for (const durationSec of [20, 30, 60, 120]) {
        const plan = planMotionTemplateBeats({skill, durationSec, words: voice(durationSec)});
        const per30 = (plan.beats.length / durationSec) * 30;
        expect(per30, `${skill}@${durationSec}`).toBeLessThanOrEqual(2.01);
        expect(plan.beats.length).toBeLessThanOrEqual(3);
        for (let i = 1; i < plan.beats.length; i++) {
          expect(plan.beats[i]!.start - plan.beats[i - 1]!.start, `${skill}@${durationSec}`).toBeGreaterThanOrEqual(4);
          expect(plan.beats[i]!.start, `${skill}@${durationSec}`).toBeGreaterThanOrEqual(plan.beats[i - 1]!.end);
        }
        expect(plan.captionMuteRanges).toEqual(plan.beats.filter(b => b.muteCaptions).map(b => ({start: b.start, end: b.end})));
        // WP46: a frame-owning beat mutes captions; the overlay notification (clip_07) does not
        expect(plan.beats.every(b => b.muteCaptions === motionTemplate(b.templateId)!.ownsFrame)).toBe(true);
        for (const beat of plan.beats) expect(beat.end).toBeLessThanOrEqual(durationSec);
      }
    }
  });

  it('a beat is at least 70 % of its template (capped at 5.5 s), so a template is never played crushed', () => {
    for (const durationSec of [20, 60]) {
      for (const beat of planMotionTemplateBeats({skill: 'explainer', durationSec, words: voice(durationSec)}).beats) {
        const spec = motionTemplate(beat.templateId)!;
        expect(beat.end - beat.start).toBeGreaterThanOrEqual(Math.min(spec.durationSec, 5.5) * 0.7 - 1e-6);
      }
    }
  });

  it('blocked ranges are respected; short clips / no triggers place nothing; variety prefers an unused template (faceless: a lane whose allowlist has several full-frame templates)', () => {
    const words = voice(60);
    const free = planMotionTemplateBeats({skill: 'faceless', durationSec: 60, words});
    expect(free.beats.length).toBeGreaterThan(0);
    const blocked = [{start: 0, end: 60}];
    expect(planMotionTemplateBeats({skill: 'faceless', durationSec: 60, words, blockedRanges: blocked}).beats).toEqual([]);
    const partial = planMotionTemplateBeats({skill: 'faceless', durationSec: 60, words, blockedRanges: [{start: 0, end: 10}]});
    for (const beat of partial.beats) expect(beat.start).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(planMotionTemplateBeats({skill: 'default', durationSec: 3, words: voice(3)}).warnings.join()).toMatch(/skipped:short_or_empty_allowlist/);
    expect(planMotionTemplateBeats({skill: 'default', durationSec: 40, words: []}).beats).toEqual([]);
    // two beats with DIFFERENT intents (a gallery phrase, then a wall phrase): the planner must not repeat a template
    const mixed: MotionTemplateWord[] = [...'here is a gallery of photos'.split(' ').map((text, k) => ({text, start: 0.5 + k * 0.4, end: 0.8 + k * 0.4})), ...'the portfolio wall of screens'.split(' ').map((text, k) => ({text, start: 20 + k * 0.4, end: 20.3 + k * 0.4}))];
    for (const skill of ['faceless', 'default', 'newsroom_mg'] as const) {
      const two = planMotionTemplateBeats({skill, durationSec: 40, words: mixed}).beats;
      if (two.length >= 2) expect(new Set(two.map(b => b.templateId)).size, skill).toBeGreaterThan(1);
    }
  });

  it('textual_mg only plans when asked for explicitly (and then only stacked cards / the blur word carousel / the two type moves)', () => {
    const plan = planMotionTemplateBeats({skill: 'textual_mg', durationSec: 40, words: voice(40)});
    for (const beat of plan.beats) expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg]).toContain(beat.templateId);
  });

  it('WP46: an overlay beat (clip_07) is a library overlay brief and does not mute captions; every other beat is full_screen and mutes', () => {
    const words: MotionTemplateWord[] = 'here is a message notification for the team'.split(' ').map((text, k) => ({text, start: 0.5 + k * 0.4, end: 0.8 + k * 0.4}));
    const plan = planMotionTemplateBeats({skill: 'explainer', durationSec: 20, words});
    const notify = plan.beats.find(b => b.templateId === OVERLAY_ID);
    expect(notify, 'a notification beat is planned for a notification phrase').toBeDefined();
    expect(notify!.muteCaptions).toBe(false);
    expect(plan.captionMuteRanges).not.toContainEqual({start: notify!.start, end: notify!.end});
    expect(motionTemplateBrief(notify!, 0).placement).toBe('overlay');
    for (const beat of planMotionTemplateBeats({skill: 'faceless', durationSec: 40, words: voice(40)}).beats) expect(motionTemplateBrief(beat, 0).placement).toBe('full_screen');
  });
});

describe('WP45 + WP46 + WP47 + WP48 library registry', () => {
  it('registers the 26 template comps (44 total: 25 opaque + the IosNotificationMock overlay), resolves on motionTemplateId / motionTemplate / templateTag / explicit compositionId under each template\'s own placement', () => {
    expect(LIBRARY_COMPOSITION_IDS).toHaveLength(66); // 44 + 11 WP54 comps + 10 WP55 comps
    for (const spec of MOTION_TEMPLATE_CATALOG) {
      const placement = placementFor(spec.id);
      for (const key of ['motionTemplateId', 'motionTemplate', 'templateTag']) {
        const hit = resolveLibraryGraphic({placement, content: {[key]: spec.id}})!;
        expect(hit.compositionId, `${key}:${spec.id}`).toBe(spec.compositionId);
      }
      expect(resolveLibraryGraphic({placement, content: {compositionId: spec.compositionId}})!.compositionId).toBe(spec.compositionId);
      if (spec.id !== OVERLAY_ID) expect(resolveLibraryGraphic({placement: 'split_screen', content: {motionTemplateId: spec.id}})!.compositionId).toBe(spec.compositionId);
    }
  });

  it('opaque only (the twenty): an overlay / pip brief misses. The overlay exception: IosNotificationMock hits ONLY on overlay (full_screen / split_screen / pip miss). Unknown ids and non-template compositionIds are not hijacked', () => {
    for (const spec of MOTION_TEMPLATE_CATALOG.filter(row => row.id !== OVERLAY_ID)) {
      for (const placement of ['overlay', 'pip']) expect(resolveLibraryGraphic({placement, content: {motionTemplateId: spec.id}}), `${spec.id}:${placement}`).toBeNull();
    }
    expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: OVERLAY_ID}})!.compositionId).toBe('IosNotificationMock');
    expect(resolveLibraryGraphic({content: {motionTemplateId: OVERLAY_ID}})!.compositionId).toBe('IosNotificationMock'); // no placement = overlay
    for (const placement of ['full_screen', 'split_screen', 'pip']) expect(resolveLibraryGraphic({placement, content: {motionTemplateId: OVERLAY_ID}}), placement).toBeNull();
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {compositionId: 'IosNotificationMock'}})).toBeNull();
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_99_nope'}})).toBeNull();
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {compositionId: 'StatHighlight'}})).toBeNull();
    // unrelated briefs keep their composition
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {statement: 'A plain claim'}})!.compositionId).toBe('FullscreenStatement');
    expect(resolveLibraryGraphic({placement: 'overlay', content: {textualMg: 'Six billion people'}})!.compositionId).toBe('TextualMgPlate');
  });

  it('props: only safe look knobs pass (hex colours, flags, card kinds / labels); https stills travel as assets, never as prop literals', () => {
    const grid = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_01_grid_morph', accent: '#FD5D42', accentFrom: '#4F7CFA', logoMark: false, exitSlide: true, imageSrc: 'https://x.invalid/a.jpg', intent: 'hook'}})!;
    expect(grid.props).toEqual({accent: '#FD5D42', accentFrom: '#4F7CFA', logoMark: false, exitSlide: true, imageAsset: 'photo'});
    expect(grid.assets).toEqual({photo: {src: 'https://x.invalid/a.jpg'}});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_01_grid_morph', accent: 'red'}})!.props).toEqual({});
    const bento = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_03_bento_camera', cards: [{kind: 'ui', label: 'Revenue'}, {kind: 'photo', src: 'https://x.invalid/a.jpg'}, {kind: 'ui'}], focusIndex: 1}})!;
    expect(bento.props).toEqual({cards: [{kind: 'ui', label: 'Revenue'}, {kind: 'photo', asset: 'card1'}, {kind: 'ui'}], focusIndex: 1});
    expect(bento.assets).toEqual({card1: {src: 'https://x.invalid/a.jpg'}});
    const slit = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_02_slit_carousel', panels: [{tone: '#111111'}, {src: 'https://x.invalid/b.jpg'}], accent: '#EAF826'}})!;
    expect(slit.props).toEqual({accent: '#EAF826', panels: [{tone: '#111111'}, {}]});
    const stack = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_04_stacked_cards', cards: [{label: 'One'}, {}]}})!;
    expect(stack.props).toEqual({cards: [{label: 'One'}, {}]});
    expect(JSON.stringify([grid.props, bento.props, slit.props, stack.props])).not.toMatch(/https?:/);
  });

  it('WP46 props: only safe knobs pass (hex accents, short copy that fits); a stack `cards` key never leaks into the new comps; over-long copy is dropped, never truncated; https stills travel as assets', () => {
    const loop = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_05_config_brand_loop', accent: '#FD5D42', wordmark: 'FESTIVAL', cards: [{label: 'x'}, {}], scenes: [{src: 'https://x.invalid/a.jpg'}]}})!;
    expect(loop.props).toEqual({accent: '#FD5D42', wordmark: 'FESTIVAL', scenes: [{asset: 'scene0'}]});
    expect(loop.assets).toEqual({scene0: {src: 'https://x.invalid/a.jpg'}});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_05_config_brand_loop', wordmark: 'W'.repeat(15), accent: 'red'}})!.props).toEqual({});
    const words = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_06_blur_word_carousel', words: ['One', 'Two', 'Three'], accent: '#EAF826'}})!;
    expect(words.props).toEqual({accent: '#EAF826', words: ['One', 'Two', 'Three']});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_06_blur_word_carousel', words: ['Only one']}})!.props).toEqual({});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_06_blur_word_carousel', words: ['ok', 'x'.repeat(25)]}})!.props).toEqual({});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_06_blur_word_carousel', cards: [{label: 'x'}, {}]}})!.props).toEqual({});
    const notify = resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: OVERLAY_ID, title: 'Ada', time: '9:41', body: 'Your edit is ready', canvas: true, intent: 'ui_notification'}})!;
    expect(notify.props).toEqual({title: 'Ada', time: '9:41', body: 'Your edit is ready', canvas: true});
    expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: OVERLAY_ID, title: 'T'.repeat(41), body: 'B'.repeat(121)}})!.props).toEqual({});
    const title = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_08_nested_rect_title', lines: ['Brand Guideline', 'Version 2'], accent: '#2F5BFF', leadHold: true, imageSrc: 'https://x.invalid/t.jpg'}})!;
    expect(title.props).toEqual({accent: '#2F5BFF', leadHold: true, lines: ['Brand Guideline', 'Version 2'], imageAsset: 'photo'});
    expect(title.assets).toEqual({photo: {src: 'https://x.invalid/t.jpg'}});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_08_nested_rect_title', lines: ['only one']}})!.props).toEqual({});
    expect(JSON.stringify([loop.props, words.props, notify.props, title.props])).not.toMatch(/https?:/);
  });

  for (const spec of MOTION_TEMPLATE_CATALOG) {
    it(`${spec.compositionId}: emits Tiny TSX importing the composition that passes the worker typecheck + compile`, async () => {
      const hit = resolveLibraryGraphic({placement: placementFor(spec.id), content: {motionTemplateId: spec.id, accent: '#FD5D42'}})!;
      const source = libraryGraphicSource(hit);
      // WP46: the overlay notification host is imported under a neutral alias so the WP14E aesthetic gate (it reads identifiers as words: "ios notification") passes; every other host imports under its own name
      expect(source).toContain(spec.id === OVERLAY_ID ? `import {IosNotificationMock as NotifyOverlay, type GraphicProps} from '@finalpost/motion';` : `import {${spec.compositionId}, type GraphicProps} from '@finalpost/motion';`);
      expect(source.split('\n').length).toBeLessThan(30);
      const {report, compiled} = await validateGraphicSource(source);
      expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
      expect(compiled?.bytes).toBeGreaterThan(0);
    }, 60_000);
  }
});

describe('WP45 publish + stage', () => {
  const words = voice(40);

  it('the brief is full-screen, carries only the template id + intent (+ a hex accent), and resolves with no model call', () => {
    const plan = planMotionTemplateBeats({skill: 'faceless', durationSec: 40, words});
    expect(plan.beats.length).toBeGreaterThan(0);
    const brief = motionTemplateBrief(plan.beats[0]!, 0, {accent: '#FD5D42'});
    expect(brief.id).toBe(`${MOTION_TEMPLATE_GRAPHIC_ID_PREFIX}1`);
    expect(brief.placement).toBe('full_screen');
    expect(brief.content).toEqual({motionTemplateId: plan.beats[0]!.templateId, intent: plan.beats[0]!.intent, accent: '#FD5D42'});
    expect(motionTemplateBrief(plan.beats[0]!, 0, {accent: 'nope'}).content).not.toHaveProperty('accent');
  });

  it('publishes every beat as a GeneratedGraphic with its own span; a throwing publisher goes to `failed`, never throws', async () => {
    const beats = planMotionTemplateBeats({skill: 'faceless', durationSec: 40, words}).beats;
    const ok = await publishMotionTemplateBeats(beats, {publisher: okPublisher});
    expect(ok.failed).toEqual([]);
    expect(ok.published).toHaveLength(beats.length);
    ok.published.forEach((item, i) => {
      expect(item.graphic.id.startsWith(MOTION_TEMPLATE_GRAPHIC_ID_PREFIX)).toBe(true);
      expect(item.graphic.start).toBe(beats[i]!.start);
      expect(item.graphic.end).toBe(beats[i]!.end);
      expect(item.graphic.placement.mode).toBe('full_screen');
    });
    const boom = await publishMotionTemplateBeats(beats, {publisher: (async () => {
      throw new Error('r2 down');
    }) as unknown as MotionTemplatePublisher});
    expect(boom.published).toEqual([]);
    expect(boom.failed).toHaveLength(beats.length);
  });

  it('the stage uses the ACTIVE polish skill allowlist and mutes captions only for PUBLISHED beats', async () => {
    for (const polishSkill of ['faceless', 'explainer', 'newsroom_mg', 'default'] as const) {
      const result = await runMotionTemplateStage({polishSkill, words, durationSec: 40, publish: {publisher: okPublisher}});
      expect(result.skill).toBe(polishSkill);
      expect(result.warnings).toContain(`polish_motion_templates:skill:${polishSkill}`);
      expect(result.graphics.length).toBe(result.published.length);
      // only frame-owning beats mute captions (the overlay notification keeps them on)
      expect(result.muteRanges).toEqual(result.published.filter(item => item.beat.muteCaptions).map(item => ({startSec: item.beat.start, endSec: item.beat.end})));
      for (const item of result.published) expect(item.graphic.placement.mode).toBe(item.beat.templateId === OVERLAY_ID ? 'overlay' : 'full_screen');
      for (const item of result.published) expect(SKILL_MOTION_TEMPLATE_ALLOWLIST[polishSkill]).toContain(item.beat.templateId);
    }
    const explainer = await runMotionTemplateStage({polishSkill: 'explainer', words, durationSec: 40, publish: {publisher: okPublisher}});
    expect(explainer.published.every(item => item.beat.templateId !== 'clip_04_stacked_cards')).toBe(true);
    const notifyWords: MotionTemplateWord[] = 'here is a message notification for the team'.split(' ').map((text, k) => ({text, start: 0.5 + k * 0.4, end: 0.8 + k * 0.4}));
    const notified = await runMotionTemplateStage({polishSkill: 'explainer', words: notifyWords, durationSec: 20, publish: {publisher: okPublisher}});
    const overlay = notified.published.find(item => item.beat.templateId === OVERLAY_ID);
    expect(overlay, 'the notification beat publishes').toBeDefined();
    expect(overlay!.graphic.placement.mode).toBe('overlay');
    expect(notified.muteRanges).not.toContainEqual({startSec: overlay!.beat.start, endSec: overlay!.beat.end});
    const failing = await runMotionTemplateStage({polishSkill: 'faceless', words, durationSec: 40, publish: {publisher: (async () => {
      throw new Error('boom');
    }) as unknown as MotionTemplatePublisher}});
    expect(failing.graphics).toEqual([]);
    expect(failing.muteRanges).toEqual([]); // a failed beat leaves the captions ON
    expect(failing.warnings.join()).toMatch(/publish_failed/);
  });

  it('blocked ranges, an explicit skillOverride and the palette accent flow through; no beat -> no graphics', async () => {
    const blocked = await runMotionTemplateStage({polishSkill: 'default', words, durationSec: 40, blockedRanges: [{start: 0, end: 40}], publish: {publisher: okPublisher}});
    expect(blocked.graphics).toEqual([]);
    expect(blocked.warnings.join()).toMatch(/no_triggers/);
    const contents: Array<Record<string, unknown>> = [];
    await runMotionTemplateStage({
      polishSkill: 'faceless',
      skillOverride: 'textual_mg',
      accent: '#FD5D42',
      words,
      durationSec: 40,
      publish: {publisher: (async (brief: {id: string; content: Record<string, unknown>}) => {
        contents.push(brief.content);
        return fakeResult(brief);
      }) as unknown as MotionTemplatePublisher},
    });
    expect(contents.length).toBeGreaterThan(0);
    for (const content of contents) {
      expect([...SKILL_MOTION_TEMPLATE_ALLOWLIST.textual_mg]).toContain(content.motionTemplateId);
      expect(content.accent).toBe('#FD5D42');
    }
  });

  it('the new modules carry no SFX / audio and never import remotion or React', () => {
    for (const file of ['motionTemplateCatalog.ts', 'motionTemplatePublish.ts', 'motionTemplateStage.ts', 'motionTemplateBind.ts']) {
      const source = read('server/src/stages/broll', file);
      expect(code(source), file).not.toMatch(/audioDesign|schedulePolishSfxHits|\bsfx\b/i);
      expect(code(source), file).not.toMatch(/remotion\/src\/motion/);
      expect(code(source), file).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('WP48: with spoken words, published briefs carry video-bound copy — never ACME / Bacon Club / PARIS shell defaults', async () => {
    const contents: Array<Record<string, unknown>> = [];
    const result = await runMotionTemplateStage({
      polishSkill: 'default',
      words,
      durationSec: 40,
      publish: {publisher: (async (brief: {id: string; content: Record<string, unknown>}) => {
        contents.push(brief.content);
        return fakeResult(brief);
      }) as unknown as MotionTemplatePublisher},
    });
    expect(result.published.length).toBeGreaterThan(0);
    expect(contents.length).toBe(result.published.length);
    const blob = JSON.stringify(contents).toLowerCase();
    expect(blob).not.toMatch(/\bacme\b/);
    expect(blob).not.toMatch(/bacon/);
    expect(blob).not.toMatch(/\bparis\b/);
    expect(blob).not.toMatch(/ship it/);
    for (const content of contents) {
      expect(content.personalized === true || content.word || content.wordmark || content.text || content.words || content.lines || content.slides || content.title || content.cards).toBeTruthy();
    }
  });

  it('WP48: empty / stopword-only transcript refuses every beat (no demo fallback)', async () => {
    const empty = await runMotionTemplateStage({
      polishSkill: 'faceless',
      words: [],
      durationSec: 40,
      publish: {publisher: okPublisher},
    });
    expect(empty.published).toEqual([]);
    if (empty.warnings.join().includes('no_triggers')) {
      // planner found nothing — also fine
    } else {
      expect(empty.warnings.join()).toMatch(/ungrounded|publish_failed/);
    }
    const stopOnly = await publishMotionTemplateBeats(
      planMotionTemplateBeats({skill: 'textual_mg', durationSec: 40, words}).beats,
      {
        personalize: true,
        words: [{text: 'the', start: 0, end: 0.2}, {text: 'a', start: 0.2, end: 0.4}],
        publisher: okPublisher,
      },
    );
    expect(stopOnly.published).toEqual([]);
    expect(stopOnly.failed.length).toBeGreaterThan(0);
  });
});

describe('WP45 analyzeVideo wiring (flag-gated)', () => {
  it('POLISH_MOTION_TEMPLATES defaults OFF in env + .env.example, and is the only new flag', () => {
    expect(read('.env.example')).toMatch(/# POLISH_MOTION_TEMPLATES=0/);
    expect(read('server/src/config/env.ts')).toMatch(/POLISH_MOTION_TEMPLATES: bool\(false\)/);
    expect(Object.keys(env).filter(key => /^POLISH_(CLIP|MOTION_TEMPLATE|TEMPLATE)/.test(key))).toEqual(['POLISH_MOTION_TEMPLATES']);
  });

  it('exactly one block, gated by polishPath && the flag, after the lane resolution + explainer mount, before Skill C and the caption mute', () => {
    expect(analyze.match(/runMotionTemplateStage\(/g)).toHaveLength(1);
    expect(wp45Block).toMatch(/if \(polishPath && env\.POLISH_MOTION_TEMPLATES\)/);
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeGreaterThan(analyze.indexOf('const polishSkill = resolvePolishSkill('));
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeGreaterThan(analyze.indexOf('explainerMount = mount;'));
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeGreaterThan(analyze.indexOf('planFacelessDocLane('));
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeGreaterThan(analyze.indexOf('planEditorialStillMontage('));
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeLessThan(analyze.indexOf('runTextualMgStage({'));
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeLessThan(analyze.indexOf('const muteRangesWp11a'));
    expect(analyze.indexOf('runMotionTemplateStage({')).toBeLessThan(analyze.indexOf('schedulePolishSfxHits('));
  });

  it('uses the active polish skill (not a new lane), passes the palette accent + still URLs, and blocks every frame already owned', () => {
    expect(wp45Block).toMatch(/polishSkill: polishSkill\.skill/);
    expect(wp45Block).toMatch(/accent: editPalette\?\.accent/);
    expect(wp45Block).toMatch(/ground: editPalette\?\.ground/);
    expect(wp45Block).toMatch(/ink: paletteInk/);
    expect(analyze).toMatch(/planStillnessFrameInsets/);
    expect(wp45Block).toMatch(/imageUrls: \[\.\.\.new Set\(templateStillUrls\)\]/);
    expect(wp45Block).toMatch(/templateStillUrls/);
    expect(wp45Block).toMatch(/hookTitle/);
    expect(wp45Block).toMatch(/broll\.clips/);
    expect(wp45Block).toMatch(/placement\.mode === 'full_screen' \|\| graphic\.placement\.mode === 'split_screen'/);
    expect(wp45Block).toMatch(/overlay\.layout === 'cutaway'/);
    expect(wp45Block).toMatch(/mediaContainers/);
    expect(wp45Block).toMatch(/explainerMount\.layoutTrack/);
    expect(wp45Block).toMatch(/newsroomLayoutTrack/);
  });

  it('publishes into generatedGraphics, merges ONLY mute ranges, and adds no SFX', () => {
    expect(wp45Block).toMatch(/motion = \{\.\.\.motion, generatedGraphics: \[\.\.\.motion\.generatedGraphics, \.\.\.motionTemplates\.graphics\]/);
    expect(analyze).toMatch(/mergeMuteRanges\(\[\.\.\.muteRangesWp11a, \.\.\.textualMgMute, \.\.\.motionTemplateMute, \.\.\.visualBackendMute\]\)/);
    expect(analyze).toMatch(/startsWith\(MOTION_TEMPLATE_GRAPHIC_ID_PREFIX\)/);
    expect(code(wp45Block)).not.toMatch(/audioDesign|sfx/i);
  });

  it('failure and the missing-motion case place nothing (warning only)', () => {
    expect(wp45Block).toMatch(/polish_motion_templates:skipped:no_motion/);
    expect(wp45Block).toMatch(/polish_motion_templates:failed/);
    expect(wp45Block).toMatch(/catch \(error\)/);
  });
});

describe('WP45 Skills A / B / C / D untouched, no 5th lane', () => {
  it('the WP45 block touches no captions, no transitions, no explainer mount, no faceless lane, no Skill C / D planning', () => {
    const body = code(wp45Block);
    expect(body).not.toMatch(/broll\.caption\s*=/);
    expect(body).not.toMatch(/captionDirection/);
    expect(body).not.toMatch(/explainerMount\s*=[^=]/);
    expect(body).not.toMatch(/newsroomLayoutTrack\s*=[^=]/);
    expect(body).not.toMatch(/editPalette\s*=[^=]/);
    expect(body).not.toMatch(/facelessDoc\s*=[^=]/);
    expect(body).not.toMatch(/broll\.transitions\s*=/);
    expect(body).not.toMatch(/accumulate|chunk_swap|polishExplainerCaptions|planTextualMgPlates|planNewsroomMgPacing/i);
  });

  it('every skill lane is still wired (A faceless, B explainer mount, C textual MG, D newsroom MG) with its own flag', () => {
    expect(analyze).toMatch(/planFacelessDocLane\(/);
    expect(analyze).toMatch(/planExplainerMount\(/);
    expect(analyze).toMatch(/runTextualMgStage\(/);
    expect(analyze).toMatch(/planNewsroomMgPacing\(/);
    for (const flag of ['POLISH_FACELESS_DOC', 'POLISH_EXPLAINER_SKILL', 'POLISH_TEXTUAL_MG', 'POLISH_NEWSROOM_MG']) {
      expect(read('server/src/config/env.ts')).toMatch(new RegExp(`${flag}: bool\\(false\\)`));
      expect(Object.keys(env)).toContain(flag);
    }
    expect(analyze.match(/const polishSkill = resolvePolishSkill\(/g)).toHaveLength(1);
  });

  it('the polish skill switch still has exactly the four lanes (the templates are not a lane)', () => {
    const pacing = read('server/src/stages/broll/explainerPacing.ts');
    expect(pacing).toMatch(/export type PolishSkill = 'default' \| 'faceless' \| 'explainer' \| 'newsroom_mg';/);
    expect(pacing).not.toMatch(/motion_template|clip_0/);
  });

  it('the Skill A / B / C / D proofs and the WP45 scaffold are all still on disk', () => {
    for (const file of ['wp36-faceless-doc.mp4', 'wp42-explainer-mounted.mp4', 'wp43-textual-mg.mp4']) expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    expect(existsSync(join(repo, 'remotion/src/motion/compositions/TextualMgPlate.tsx'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/out/phase36-readiness/AUTHORIZATION_WP45.txt'))).toBe(true);
  });
});

describe('WP45 timing + craft pins on the four WP45 comps', () => {
  it('CLIP_01: the payoff hold is 1.8 s and the LAST op; ops run in the grammar order; templateScale only ever compresses', () => {
    const hold = GRID_MORPH_TIMELINE[GRID_MORPH_TIMELINE.length - 1]!;
    expect(hold.id).toBe('hold');
    expect(hold.to - hold.from).toBeCloseTo(1.8, 5);
    const order = GRID_MORPH_TIMELINE.map(op => op.id);
    expect(order).toEqual(['tile_wipe_grow', 'logo_fill', 'tile_merge_expand', 'color_flood_swap', 'window_reveal', 'hold']);
    const primaryStarts = ['tile_wipe_grow', 'tile_merge_expand', 'color_flood_swap', 'window_reveal'].map(id => GRID_MORPH_TIMELINE.find(op => op.id === id)!.from);
    expect([...primaryStarts].sort((a, b) => a - b)).toEqual(primaryStarts);
    expect(templateScale(10, 4.9)).toBe(1);
    expect(templateScale(2.45, 4.9)).toBeCloseTo(0.5, 5);
    expect(templateScale(0.1, 4.9)).toBeGreaterThanOrEqual(0.25);
  });

  it('CLIP_01 merge rect grows from the centre 2x2 to the whole 4x4, x edges before y edges', () => {
    expect(gridMergeRect(0)).toEqual({x0: 1, x1: 3, y0: 1, y1: 3});
    expect(gridMergeRect(1)).toEqual({x0: 0, x1: 4, y0: 0, y1: 4});
    const mid = gridMergeRect(0.3);
    expect(1 - mid.x0).toBeGreaterThan(1 - mid.y0);
  });

  it('CLIP_02: 3.25x accordion, loop friendly (net advance 0 at the start and the end), acid yellow accent, stagger 25 ms', () => {
    expect(SLIT_ACCORDION_FACTOR).toBe(3.25);
    const end = SLIT_CAROUSEL_TIMELINE[SLIT_CAROUSEL_TIMELINE.length - 1]!.to;
    for (const item of [0, 1, 2, 3, 4, 5]) {
      expect(slitAdvance(0, item), `start:${item}`).toBe(0);
      expect(slitAdvance(end, item), `end:${item}`).toBeCloseTo(0, 5);
      expect(slitAdvance(2.2, item), `held:${item}`).toBeCloseTo(1, 5); // after the first advance, before the accordion
    }
    expect(slitAdvance(1.0, 0)).toBeGreaterThan(slitAdvance(1.0, 5)); // staggered: the first slot leads
    expect(slitAccordion(0)).toBe(0);
    expect(slitAccordion(3.5 + 0.2)).toBeCloseTo(1, 5);
    expect(slitAccordion(end)).toBeCloseTo(0, 5);
    expect(slitFocusItem(5, 3)).toBe(3); // lands in the centre slot (3 - 1 = 2) after the advance
    expect(read('remotion/src/lib/motionTemplateTiming.ts')).toMatch(/SLIT_ACID = '#EAF826'/);
    expect(read('remotion/src/lib/motionTemplateTiming.ts')).toMatch(/SLIT_STAGGER_SEC = 0\.025/);
  });

  it('CLIP_03: a HARD jump cut (a step in framing, no ease), exp-decay zoom in, hold, eased zoom out; scale never < 1; no rotation', () => {
    const wall = {width: 1080, height: 1920};
    const layout = bentoLayout(['ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'ui'], wall.width, wall.height, 15);
    const focus = layout[4]!;
    const jump = BENTO_CAMERA_TIMELINE.find(op => op.id === 'camera_jump_cut')!;
    expect(jump.to - jump.from).toBe(0);
    const before = bentoCamera(jump.from - 0.001, wall, focus);
    const after = bentoCamera(jump.from, wall, focus);
    expect(Math.abs(after.scale - before.scale)).toBeGreaterThan(0.25); // a step, not a ramp
    expect(Math.abs(after.fx - before.fx) + Math.abs(after.fy - before.fy)).toBeGreaterThan(20);
    expect(after.cut).toBe(true);
    // creep is near-linear (no jump inside it)
    expect(bentoCamera(0, wall, focus).scale).toBe(1);
    expect(bentoCamera(0.85, wall, focus).scale).toBeCloseTo(1.05, 2);
    // exp-decay: most of the push happens early
    const z0 = bentoCamera(1.7, wall, focus).scale;
    const zEnd = bentoCamera(3.1, wall, focus).scale;
    const zMid = bentoCamera(1.7 + 0.35, wall, focus).scale;
    expect((zMid - z0) / (zEnd - z0)).toBeGreaterThan(0.4);
    expect(bentoCamera(3.5, wall, focus).scale).toBeCloseTo(zEnd, 5); // hold
    expect(bentoCamera(5.2, wall, focus).scale).toBeCloseTo(1, 2);
    for (let t = 0; t <= 5.87; t += 0.05) {
      const camera = bentoCamera(t, wall, focus);
      expect(camera.scale).toBeGreaterThanOrEqual(1);
      const {tx, ty} = bentoTranslate(camera, wall);
      expect(tx).toBeLessThanOrEqual(0);
      expect(ty).toBeLessThanOrEqual(0);
      expect(tx).toBeGreaterThanOrEqual(wall.width - wall.width * camera.scale - 1e-6);
      expect(ty).toBeGreaterThanOrEqual(wall.height - wall.height * camera.scale - 1e-6);
    }
  });

  it('CLIP_03 wall is a justified bento: every row fills the width, cards never overlap, varied sizes', () => {
    const rects = bentoLayout(['ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'ui'], 1080, 1920, 15);
    expect(rects).toHaveLength(12);
    const rows = new Map<number, typeof rects>();
    for (const rect of rects) rows.set(rect.y, [...(rows.get(rect.y) ?? []), rect]);
    for (const row of rows.values()) {
      const last = row[row.length - 1]!;
      expect(last.x + last.w).toBeCloseTo(1080 - 15, 3);
    }
    expect(new Set(rects.map(r => Math.round(r.w))).size).toBeGreaterThan(4);
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) expect(a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01, `${i}`).toBe(false);
    }
  });

  it('CLIP_04: 1.03 s cycle = 0.38 s swap + 0.65 s hold, tilt 3-5 degrees alternating, swaps repeat for any length', () => {
    expect(STACK_CYCLE_SEC).toBeCloseTo(1.03, 5);
    expect(STACK_TRANSITION_SEC).toBeCloseTo(0.38, 5);
    expect(STACK_CYCLE_SEC - STACK_TRANSITION_SEC).toBeCloseTo(0.65, 5);
    const swaps = STACK_TIMELINE.filter(op => op.id === 'card_stack_advance');
    expect(swaps).toHaveLength(2);
    expect(swaps[1]!.from - swaps[0]!.from).toBeCloseTo(1.03, 5);
    expect(stackState(0)).toEqual({completed: 0, progress: 0});
    expect(stackState(0.5 + 0.19).completed).toBe(0);
    expect(stackState(0.5 + 0.19).progress).toBeCloseTo(0.5, 5);
    expect(stackState(0.5 + 0.38 + 0.01)).toEqual({completed: 1, progress: 0});
    expect(stackState(0.5 + 3 * 1.03 + 0.1).completed).toBe(3);
    for (let i = 0; i < 9; i++) {
      expect(Math.abs(stackTiltDeg(i))).toBeGreaterThanOrEqual(3);
      expect(Math.abs(stackTiltDeg(i))).toBeLessThanOrEqual(5);
    }
    expect(Math.sign(stackTiltDeg(0))).not.toBe(Math.sign(stackTiltDeg(1)));
    const deck = read('remotion/src/motion/compositions/templates/StackedCardDeck.tsx');
    expect(deck).toMatch(/BEHIND_SCALE = 0\.82/);
    expect(deck).toMatch(/grayscale/);
  });

  it('fitContain letterboxes 4:5 / 4:3 inside 9:16 and centres it', () => {
    expect(fitContain(4 / 5, 1080, 1920)).toEqual({x: 0, y: 285, w: 1080, h: 1350});
    expect(fitContain(4 / 3, 1080, 1920)).toEqual({x: 0, y: 555, w: 1080, h: 810});
    const wide = fitContain(4 / 5, 1920, 1080);
    expect(wide.h).toBe(1080);
    expect(wide.x).toBeGreaterThan(0);
  });

  it('craft: no motion blur / glow / shadow / glitch / opacity cross-fade in any of the four comps or the timing lib', () => {
    const files = [...WP45_COMPS.map(comp => `remotion/src/motion/compositions/templates/${comp}.tsx`), 'remotion/src/motion/compositions/templates/shared.tsx', 'remotion/src/lib/motionTemplateTiming.ts'];
    for (const file of files) {
      const source = code(read(file));
      expect(source, file).not.toMatch(/blur\(/i);
      expect(source, file).not.toMatch(/boxShadow|textShadow|drop-shadow|text-shadow|box-shadow|feTurbulence|feGaussianBlur/);
      expect(source, file).not.toMatch(/\bopacity\b/);
      expect(source, file).not.toMatch(/useAudio|<Audio|<Html5Audio/);
    }
    // the only opacity-free reveal tools: clip windows / edge wipes
    expect(read('remotion/src/motion/compositions/templates/GridMosaicMorph.tsx')).toMatch(/clipPath/);
    expect(read('remotion/src/motion/compositions/templates/SlitPanelCarousel.tsx')).toMatch(/clipPath/);
    // CLIP_03 camera has no rotation
    expect(code(read('remotion/src/motion/compositions/templates/BentoCardWall.tsx'))).not.toMatch(/rotate/);
    // labels / text come only from props (no invented words in the comps)
    expect(code(read('remotion/src/motion/compositions/templates/GridMosaicMorph.tsx'))).not.toMatch(/fontFamily/);
  });
});

describe('WP45 proof outputs (after npm run preview:wp45)', () => {
  it('preview script, entry, npm script, and the committed-to-disk proof artefacts exist', () => {
    expect(existsSync(join(repo, 'remotion/scripts/wp45-preview.mjs'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/scripts/wp45/entry.tsx'))).toBe(true);
    expect(read('remotion/package.json')).toMatch(/"preview:wp45": "node scripts\/wp45-preview\.mjs"/);
    for (const file of ['wp45-motion-templates.mp4', 'wp45-contact-sheet.jpg', 'wp45-plan.json', 'wp45-measured.json']) {
      expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    }
  });

  it('the measured proof is the four WP45 templates (CLIP_01..04), silent, 1080x1920', () => {
    const measured = JSON.parse(read('remotion/out/phase36-readiness/wp45-measured.json'));
    const wp45Ids = MOTION_TEMPLATE_IDS.slice(0, 4);
    expect(measured.templates.map((t: {templateId: string}) => t.templateId)).toEqual([...wp45Ids]);
    expect(measured.sfx).toMatch(/none/);
    expect(measured.live).toBe('PAUSED');
    const total = MOTION_TEMPLATE_CATALOG.filter(t => wp45Ids.includes(t.id)).reduce((sum, t) => sum + Math.round(t.durationSec * 30) / 30, 0);
    expect(Number(measured.video.format.duration)).toBeGreaterThan(total - 0.2);
    expect(Number(measured.video.format.duration)).toBeLessThan(total + 0.2);
  });
});

// ---------------------------------------------------------------------------- WP46: CLIP_05..08

describe('WP46 CLIP_05 ConfigBrandLoop: hard cuts on a 1.5 s grid, mask morph around each cut, independent stickers, static wordmark', () => {
  it('7.63 s loop, a HARD cut every 1.5 s across 5 scenes (a step, never a ramp), and the loop point wraps to scene A', () => {
    expect(CONFIG_BRAND_LOOP_BASE_SEC).toBeCloseTo(7.63, 5);
    expect(CONFIG_CUT_GRID_SEC).toBe(1.5);
    for (const [at, scene] of [[0, 0], [1.49, 0], [1.5, 1], [2.99, 1], [3.0, 2], [4.49, 2], [4.5, 3], [5.99, 3], [6.0, 4], [7.62, 4]] as const) expect(configScene(at), `t=${at}`).toBe(scene);
    expect(configScene(7.63)).toBe(0); // the loop wraps
    expect(configLoopTime(7.63 + 1.6)).toBeCloseTo(1.6, 6);
    expect(configScene(7.63 + 1.6)).toBe(1);
    expect(MOTION_TEMPLATE_TIMELINES.clip_05_config_brand_loop.ops.find(op => op.id === 'hard_cut_on_grid')!.primitive).toBe('hard_cut_on_grid');
  });

  it('mask morph: five distinct shapes that fit the unit square; the outline starts 0.15 s before a cut, is mid-morph AT the cut, and settles 0.4 s after', () => {
    const shapes = [0, 1, 2, 3, 4].map(index => configMaskRadii(index));
    for (const radii of shapes) {
      expect(radii).toHaveLength(72);
      expect(Math.min(...radii)).toBeGreaterThan(0);
      let peak = 0;
      radii.forEach((r, i) => {
        const theta = (i / radii.length) * Math.PI * 2;
        peak = Math.max(peak, Math.abs(r * Math.cos(theta)), Math.abs(r * Math.sin(theta)));
      });
      expect(peak).toBeCloseTo(1, 6);
    }
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) expect(shapes[a]!.some((r, i) => Math.abs(r - shapes[b]![i]!) > 0.05), `${a}/${b}`).toBe(true);
    expect(configMask(1.3)).toEqual({from: 0, to: 0, p: 0}); // settled well before the cut
    expect(configMask(1.349).p).toBe(0);
    const early = configMask(1.36);
    expect(early.from).toBe(0);
    expect(early.to).toBe(1);
    expect(early.p).toBeGreaterThan(0);
    const atCut = configMask(1.5);
    expect(atCut.p).toBeGreaterThan(0.05); // eased: 0.15 of the 0.55 s window has run at the cut
    expect(atCut.p).toBeLessThan(0.9);
    expect(configMask(1.9).p).toBeCloseTo(1, 5);
    expect(configMask(1.95)).toEqual({from: 1, to: 1, p: 0}); // settled on the new shape
    expect(configMaskRadiiAt(1.95)).toEqual(shapes[1]);
    expect(configMaskRadiiAt(1.3)).toEqual(shapes[0]);
    // the morph is between the outgoing and incoming shapes (neither endpoint at the cut)
    const mid = configMaskRadiiAt(1.5);
    expect(mid.some((r, i) => Math.abs(r - shapes[0]![i]!) > 0.01)).toBe(true);
    expect(mid.some((r, i) => Math.abs(r - shapes[1]![i]!) > 0.01)).toBe(true);
    const path = configMaskPath(shapes[0]!, 600, 700);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
    expect(path.split(' L')).toHaveLength(72);
  });

  it('seamless loop: the mask is continuous across the loop point (shape E -> A morphs through it)', () => {
    const before = configMaskRadiiAt(CONFIG_BRAND_LOOP_BASE_SEC - 0.001);
    const after = configMaskRadiiAt(0);
    before.forEach((r, i) => expect(Math.abs(r - after[i]!), `sample ${i}`).toBeLessThan(0.02));
    expect(configMask(CONFIG_BRAND_LOOP_BASE_SEC - 0.1).to).toBe(0);
    expect(configMask(CONFIG_BRAND_LOOP_BASE_SEC - 0.1).from).toBe(4);
    expect(configMask(0.3).to).toBe(0);
  });

  it('stickers: dot -> full over 0.8 s ease-out with a 45 degree turn, shrink over 0.2 s; independent lifecycles; absent at both loop ends and absent mid-loop, then they reappear', () => {
    for (const id of ['flower', 'disc_diamond', 'ship_tag'] as const) {
      const windows = CONFIG_STICKER_WINDOWS[id];
      expect(windows.length, id).toBeGreaterThanOrEqual(2);
      expect(configStickerState(id, 0), `${id}@0`).toBeNull();
      expect(configStickerState(id, CONFIG_BRAND_LOOP_BASE_SEC - 0.01), `${id}@end`).toBeNull();
      for (let k = 0; k < windows.length; k++) {
        const win = windows[k]!;
        if (k > 0) expect(win.from, `${id}:${k}`).toBeGreaterThan(windows[k - 1]!.to + 0.2); // an absent stretch between lifecycles
        const start = configStickerState(id, win.from)!;
        expect(start.scale).toBeCloseTo(0.08, 5); // a dot
        expect(start.rotateDeg).toBeCloseTo(45, 5);
        const quarter = configStickerState(id, win.from + 0.2)!;
        expect(quarter.scale).toBeGreaterThan(0.5); // ease-out: most of the pop is early
        expect(quarter.rotateDeg).toBeLessThan(45);
        expect(quarter.rotateDeg).toBeGreaterThan(0);
        expect(configStickerState(id, win.from + 0.8)).toEqual({scale: 1, rotateDeg: 0});
        expect(configStickerState(id, (win.from + 0.8 + win.to) / 2)).toEqual({scale: 1, rotateDeg: 0});
        expect(configStickerState(id, win.to + 0.1)!.scale).toBeCloseTo((1 + 0.08) / 2, 5); // shrinking out
        expect(configStickerState(id, win.to + 0.2 + 0.001), `${id}:${k} gone`).toBeNull();
        expect(Number.isInteger(Math.round((win.from / CONFIG_CUT_GRID_SEC) * 1000) / 1000), `${id}:${k} independent of the cut grid`).toBe(false);
      }
      const gap = (windows[0]!.to + 0.2 + windows[1]!.from) / 2;
      expect(configStickerState(id, gap), `${id} absent mid-loop`).toBeNull();
    }
    // lifecycles are staggered, not simultaneous
    expect(new Set(['flower', 'disc_diamond', 'ship_tag'].map(id => CONFIG_STICKER_WINDOWS[id as 'flower'][0]!.from)).size).toBe(3);
  });

  it('the CONFIG wordmark is static and the top-most layer (drawn last, no clock-driven style), photos are static (no Ken Burns), no fade', () => {
    const source = read('remotion/src/motion/compositions/templates/ConfigBrandLoop.tsx');
    const body = code(source);
    expect(body.indexOf('{wordmark}')).toBeGreaterThan(body.indexOf("sticker('ship_tag'"));
    expect(body.indexOf('{wordmark}')).toBeGreaterThan(body.indexOf('clipPath'));
    const wordmarkStyle = body.slice(body.lastIndexOf('<div style', body.indexOf('{wordmark}')), body.indexOf('{wordmark}'));
    expect(wordmarkStyle).not.toMatch(/\bt\b|sec|scale\(|rotate\(|state/);
    expect(body).toMatch(/clipPath: `path\(/);
    expect(body).not.toMatch(/kenBurns|zoom|scale\(1\.\d/i);
    expect(source).toContain("wordmark = 'CONFIG'");
  });
});

describe('WP46 CLIP_06 BlurWordCarousel: 0.73 s step (0.42 move + 0.31 hold), sharp white active, graded blur neighbours, tilt', () => {
  it('grammar timing: 3.67 s, a 0.73 s period = 0.42 s ease-in-out move + 0.31 s hold; every move is one slot and the list rests on whole slots between moves', () => {
    expect(BLUR_CAROUSEL_BASE_SEC).toBeCloseTo(3.67, 5);
    expect(BLUR_STEP_SEC).toBeCloseTo(0.73, 5);
    expect(BLUR_MOVE_SEC + BLUR_HOLD_SEC).toBeCloseTo(BLUR_STEP_SEC, 5);
    const moves = BLUR_CAROUSEL_TIMELINE.filter(op => op.primitive === 'blur_carousel');
    expect(moves).toHaveLength(BLUR_MOVES);
    for (const [k, move] of moves.entries()) {
      expect(move.to - move.from, `move ${k}`).toBeCloseTo(0.42, 5);
      if (k > 0) expect(move.from - moves[k - 1]!.from, `period ${k}`).toBeCloseTo(0.73, 5);
    }
    expect(blurCarouselPos(0)).toBe(0);
    for (let k = 0; k < BLUR_MOVES; k++) expect(blurCarouselPos(moves[k]!.to + 0.001), `rest ${k}`).toBeCloseTo(k + 1, 2);
    expect(blurCarouselPos(BLUR_CAROUSEL_BASE_SEC)).toBeCloseTo(BLUR_MOVES, 5);
    expect(blurCarouselPos(99)).toBe(BLUR_MOVES); // a longer beat extends the final hold
    let last = -1;
    for (let t = 0; t <= 3.67; t += 0.01) {
      const pos = blurCarouselPos(t);
      expect(pos).toBeGreaterThanOrEqual(last - 1e-9);
      last = pos;
    }
    // ease-in-out: a quarter into a move has covered far less than a quarter, the middle exactly half
    expect(blurCarouselPos(moves[0]!.from + 0.105)).toBeLessThan(0.1);
    expect(blurCarouselPos(moves[0]!.from + 0.21)).toBeCloseTo(0.5, 5);
  });

  it('row grading by distance: active = white / sharp / full size; neighbours #8A8A8A with blur 1.5 / 5 / 10 px, strength 0.6 / 0.35 / 0.2, scale 0.88', () => {
    expect(blurRowStyle(0)).toEqual({blurPx: 0, strength: 1, scale: 1, color: '#FFFFFF'});
    expect(blurRowStyle(1)).toEqual({blurPx: 1.5, strength: 0.6, scale: 0.88, color: '#8A8A8A'});
    expect(blurRowStyle(-1)).toEqual(blurRowStyle(1)); // symmetric
    expect(blurRowStyle(2)).toMatchObject({blurPx: 5, strength: 0.35, scale: 0.88});
    expect(blurRowStyle(3)).toMatchObject({blurPx: 10, strength: 0.2, scale: 0.88});
    expect(blurRowStyle(9)).toEqual(blurRowStyle(3)); // holds the last anchor
    expect(blurRowStyle(0.5).blurPx).toBeGreaterThan(0);
    expect(blurRowStyle(0.5).blurPx).toBeLessThan(1.5);
    for (let d = 0; d < 3; d += 0.25) expect(blurRowStyle(d + 0.25).blurPx).toBeGreaterThanOrEqual(blurRowStyle(d).blurPx); // progressive
  });

  it('tilt: about -1 degree on a hold, about -8 at the middle of a move; layout is left aligned with the arrow at 0.17, active line at 0.57, pitch 0.23', () => {
    const first = BLUR_CAROUSEL_TIMELINE.find(op => op.primitive === 'blur_carousel')!;
    expect(blurTiltDeg(0.05)).toBeCloseTo(-1, 5);
    expect(blurTiltDeg(first.from + 0.21)).toBeCloseTo(-8, 5);
    expect(blurTiltDeg(first.to + 0.1)).toBeCloseTo(-1, 5);
    expect(blurTiltDeg(first.from + 0.1)).toBeLessThan(-1);
    expect(blurTiltDeg(first.from + 0.1)).toBeGreaterThan(-8);
    const lib = read('remotion/src/lib/motionTemplateTiming.ts');
    expect(lib).toMatch(/arrowX: 0\.17/);
    expect(lib).toMatch(/activeY: 0\.57/);
    expect(lib).toMatch(/slotPitch: 0\.23/);
    expect(lib).toMatch(/BLUR_COLORS = \{active: '#FFFFFF', neighbor: '#8A8A8A'/);
    const comp = code(read('remotion/src/motion/compositions/templates/BlurWordCarousel.tsx'));
    expect(comp).toMatch(/transformOrigin: '0% 50%'/); // left aligned rows
    expect(comp).not.toMatch(/textAlign: 'center'/);
  });
});

describe('WP46 CLIP_07 IosNotificationMock: an overlay with a static banner and a cursor that changes', () => {
  it('2.02 s; the cursor is the arrow until 0.83 s, the open hand until 1.67 s, then hidden; the grammar numbers are pinned', () => {
    for (const [at, state] of [[0, 'arrow'], [0.82, 'arrow'], [IOS_HAND_AT_SEC, 'hand'], [1.2, 'hand'], [1.66, 'hand'], [IOS_CURSOR_HIDE_SEC, 'hidden'], [2.0, 'hidden']] as const) expect(iosCursorState(at), `t=${at}`).toBe(state);
    expect(IOS_HAND_AT_SEC).toBe(0.83);
    expect(IOS_CURSOR_HIDE_SEC).toBe(1.67);
    expect(MOTION_TEMPLATE_TIMELINES.clip_07_ios_notification.baseSec).toBeCloseTo(2.02, 5);
    const lib = read('remotion/src/lib/motionTemplateTiming.ts');
    expect(lib).toMatch(/IOS_BANNER = \{radius: 20, w: 0\.55, h: 0\.16, top: 0\.06, fill: '#E1E1E1'\}/);
    expect(lib).toMatch(/IOS_CURSOR_AT: readonly \[number, number\] = \[0\.52, 0\.7\]/);
  });

  it('the banner never moves (the clock only drives the cursor), defaults to the grammar copy, has no ground of its own, and uses no fade / shadow / blur', () => {
    const source = read('remotion/src/motion/compositions/templates/IosNotificationMock.tsx');
    const body = code(source);
    expect(body.match(/\bt\b/g)).toHaveLength(2); // `const {t} = useTemplateClock(...)` and `iosCursorState(t)`: nothing else reads the clock
    expect(body).toMatch(/title = 'Jitter Team'/);
    expect(body).toMatch(/time = 'now'/);
    expect(body).toMatch(/Remix and make it shine!/);
    expect(body).toMatch(/canvas = false/);
    expect(body).toMatch(/canvas \? '#EEEDF0' : 'transparent'/);
    expect(body).not.toMatch(/blur\(|boxShadow|textShadow|drop-shadow|\bopacity\b/);
  });
});

describe('WP46 CLIP_08 NestedRectTitleWipe: hard cut, nested rects from the exact centre (ease-in), parallel typewriter', () => {
  it('0.83 s hard cut to pale blue; six overlapping layers (each starts before the previous ends) in a fixed bottom -> top order ending on the photo; scale grows ease-in from the centre', () => {
    expect(NESTED_CUT_SEC).toBe(0.83);
    expect(NESTED_LAYERS.map(layer => layer.id)).toEqual(['navy_arcs', 'cream', 'navy_grid', 'pink', 'navy_diamonds', 'photo']);
    for (let i = 1; i < NESTED_LAYERS.length; i++) {
      expect(NESTED_LAYERS[i]!.from, `${i} starts after the previous starts`).toBeGreaterThan(NESTED_LAYERS[i - 1]!.from);
      expect(NESTED_LAYERS[i]!.from, `${i} overlaps the previous`).toBeLessThan(NESTED_LAYERS[i - 1]!.to);
    }
    expect(NESTED_LAYERS[0]!.from).toBeGreaterThan(NESTED_CUT_SEC);
    for (const [index, layer] of NESTED_LAYERS.entries()) {
      expect(nestedRectScale(layer.from - 0.01, index)).toBe(0);
      expect(nestedRectScale(layer.to, index)).toBe(1);
      expect(nestedRectScale(layer.to + 2, index)).toBe(1);
      expect(nestedRectScale((layer.from + layer.to) / 2, index), `${layer.id} ease-in`).toBeLessThan(0.2); // a cubic ease-in is ~0.125 at the midpoint
    }
    const comp = read('remotion/src/motion/compositions/templates/NestedRectTitleWipe.tsx');
    expect(code(comp)).toMatch(/transformOrigin: '50% 50%'/);
    expect(code(comp)).toMatch(/NESTED_COLORS\.paleBlue/);
    const lib = read('remotion/src/lib/motionTemplateTiming.ts');
    expect(lib).toMatch(/paleBlue: '#ABCDEE'/);
    expect(lib).toMatch(/navy: '#12112B'/);
    expect(lib).toMatch(/cream: '#F4FCD4'/);
    expect(lib).toMatch(/pink: '#F89BFA'/);
  });

  it('typewriter: ~37 chars / s from 3.95 s on two PARALLEL lines, no caret, the hold at the end is >= 1 s', () => {
    expect(NESTED_TYPE_CPS).toBe(37);
    expect(NESTED_TYPE_START_SEC).toBe(3.95);
    expect(NESTED_DEFAULT_LINES).toEqual(['Brand Guideline\u2014Version 0.1', 'Presentation Template']);
    const lines = NESTED_RECT_TIMELINE.filter(op => op.primitive === 'typewriter_reveal');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.from).toBe(lines[1]!.from); // parallel
    expect(lines[0]!.from).toBe(3.95);
    for (const [k, row] of lines.entries()) expect(row.to - row.from, `line ${k}`).toBeCloseTo(NESTED_DEFAULT_LINES[k]!.length / 37, 5);
    expect(typewriterChars(3.94, 3.95, 37, 27)).toBe(0);
    expect(typewriterChars(3.95, 3.95, 37, 27)).toBe(0);
    expect(typewriterChars(3.95 + 10 / 37 + 0.001, 3.95, 37, 27)).toBe(10);
    expect(typewriterChars(3.95 + 1, 3.95, 37, 27)).toBe(27); // capped at the line length
    expect(typewriterChars(3.95 + 0.5, 3.95, 37, 21)).toBe(18);
    expect(NESTED_RECT_BASE_SEC - Math.max(...lines.map(row => row.to))).toBeGreaterThanOrEqual(1);
    expect(NESTED_LAYERS[NESTED_LAYERS.length - 1]!.to).toBeLessThanOrEqual(3.95); // the photo is full-bleed before the first character
    const comp = code(read('remotion/src/motion/compositions/templates/NestedRectTitleWipe.tsx'));
    expect(comp).not.toMatch(/caret|cursor|'\|'/i);
    expect(comp).toMatch(/Playfair Display/);
  });
});

describe('WP46 craft: no fade / glow / shadow / bounce / glitch / audio in the four new comps; the only blur + strength is the carousel\'s static depth-of-field', () => {
  it('craft pins over the sources (comments stripped)', () => {
    for (const comp of WP46_COMPS) {
      const file = `remotion/src/motion/compositions/templates/${comp}.tsx`;
      const source = code(read(file));
      expect(source, file).not.toMatch(/boxShadow|textShadow|drop-shadow|text-shadow|box-shadow|feTurbulence|feGaussianBlur|glow|glitch|shake/i);
      expect(source, file).not.toMatch(/useAudio|<Audio|<Html5Audio|sfx/i);
      expect(source, file).not.toMatch(/spring\(|overshoot|easeOutBack|bounce|Math\.random/i);
      if (comp !== 'BlurWordCarousel') {
        expect(source, file).not.toMatch(/blur\(/i);
        expect(source, file).not.toMatch(/\bopacity\b/);
      }
    }
    // the carousel's blur is a static per-row depth blur read from blurRowStyle (never a time-smeared motion blur)
    const carousel = code(read('remotion/src/motion/compositions/templates/BlurWordCarousel.tsx'));
    expect(carousel).toMatch(/blur\(\$\{style\.blurPx/);
    expect(carousel).not.toMatch(/motionBlur|trail/i);
    expect(code(read('remotion/src/lib/motionTemplateTiming.ts'))).not.toMatch(/\bopacity\b|blur\(|boxShadow|bounce|overshoot/i);
  });

  it('every new comp is a library comp with the same clock hook, uses no cross-dissolve and no copy of its own beyond the grammar defaults (text defaults live in props)', () => {
    for (const comp of WP46_COMPS) {
      const source = read(`remotion/src/motion/compositions/templates/${comp}.tsx`);
      expect(source, comp).toMatch(/useTemplateClock\(/);
      expect(source, comp).not.toMatch(/interpolate\(.*opacity|crossfade|dissolve/i);
    }
    expect(read('remotion/src/motion/README.md')).toMatch(/\| `ConfigBrandLoop` \|/);
    for (const comp of WP46_COMPS) expect(read('remotion/src/motion/README.md'), comp).toContain(`| \`${comp}\` |`);
  });
});

describe('WP46 Skills A / B / C / D and WP45 CLIP_01-04 stay intact; no 5th lane, no new flag', () => {
  it('the WP45 comps, proofs and the Skill A / B / C proofs are still on disk; the WP46 authorization + prompt exist', () => {
    for (const comp of WP45_COMPS) expect(existsSync(join(repo, `remotion/src/motion/compositions/templates/${comp}.tsx`)), comp).toBe(true);
    for (const file of ['wp36-faceless-doc.mp4', 'wp42-explainer-mounted.mp4', 'wp43-textual-mg.mp4', 'wp45-motion-templates.mp4', 'AUTHORIZATION_WP46.txt', 'PROMPT_PASTE_WP46.txt']) expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    expect(existsSync(join(repo, 'remotion/src/motion/compositions/TextualMgPlate.tsx'))).toBe(true);
  });

  it('still exactly one motion-template flag (POLISH_MOTION_TEMPLATES, default off) and four polish lanes; the lane switch and the stage know nothing about clip ids', () => {
    expect(Object.keys(env).filter(key => /^POLISH_(CLIP|MOTION_TEMPLATE|TEMPLATE)/.test(key))).toEqual(['POLISH_MOTION_TEMPLATES']);
    expect(read('server/src/config/env.ts')).toMatch(/POLISH_MOTION_TEMPLATES: bool\(false\)/);
    expect(read('server/src/stages/broll/explainerPacing.ts')).toMatch(/export type PolishSkill = 'default' \| 'faceless' \| 'explainer' \| 'newsroom_mg';/);
    expect(read('server/src/stages/broll/motionTemplateStage.ts')).not.toMatch(/clip_\d\d|IosNotificationMock|AcmeFruitLetterSwap|MorphFontStretch|MenuSlidePoster|EditorialInsetPoster|HeritageDevotionPoster|SilkLegacyCover|GlassTestimonialMorph|PortraitPushCarousel|PhotoStackCollapse|PhotoStackReveal|TwoUpStackHold|NeverDoneSlitPoster|TypewriterPoster/);
    expect(analyze).not.toMatch(/clip_0[5-9]|clip_1[0-9]|clip_2[01]|PhotoStackCollapse|PhotoStackReveal|TwoUpStackHold|NeverDoneSlitPoster|TypewriterPoster|HeritageDevotionPoster|SilkLegacyCover|GlassTestimonialMorph|PortraitPushCarousel|ConfigBrandLoop|BlurWordCarousel|IosNotificationMock|NestedRectTitleWipe|AcmeFruitLetterSwap|MorphFontStretch|MenuSlidePoster|EditorialInsetPoster/); // analyze reaches the new templates only through the catalog
  });
});

describe('WP46 proof outputs (after npm run preview:wp46)', () => {
  it('preview script, entry, npm script and the proof artefacts exist; preview:wp45 is still wired', () => {
    expect(existsSync(join(repo, 'remotion/scripts/wp46-preview.mjs'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/scripts/wp46/entry.tsx'))).toBe(true);
    const pkg = read('remotion/package.json');
    expect(pkg).toMatch(/"preview:wp46": "node scripts\/wp46-preview\.mjs"/);
    expect(pkg).toMatch(/"preview:wp45": "node scripts\/wp45-preview\.mjs"/);
    for (const file of ['wp46-motion-templates.mp4', 'wp46-contact-sheet.jpg', 'wp46-plan.json', 'wp46-measured.json', 'WP46_MOTION_TEMPLATES.md']) {
      expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    }
  });

  it('the measured proof is the four NEW templates, silent, paused live, registry-resolved with clip_07 as the overlay, and as long as the four templates back to back', () => {
    const measured = JSON.parse(read('remotion/out/phase36-readiness/wp46-measured.json'));
    const ids = ['clip_05_config_brand_loop', 'clip_06_blur_word_carousel', 'clip_07_ios_notification', 'clip_08_nested_rect_title'];
    expect(measured.templates.map((t: {templateId: string}) => t.templateId)).toEqual(ids);
    expect(measured.templates.map((t: {compositionId: string}) => t.compositionId)).toEqual([...WP46_COMPS]);
    expect(measured.templates.map((t: {placement: string}) => t.placement)).toEqual(['full_screen', 'full_screen', 'overlay', 'full_screen']);
    expect(measured.templates.map((t: {ownsFrame: boolean}) => t.ownsFrame)).toEqual([true, true, false, true]);
    expect(measured.sfx).toMatch(/none/);
    expect(measured.live).toBe('PAUSED');
    expect(measured.allowlists).toEqual(JSON.parse(JSON.stringify(SKILL_MOTION_TEMPLATE_ALLOWLIST)));
    const total = MOTION_TEMPLATE_CATALOG.filter(t => ids.includes(t.id)).reduce((sum, t) => sum + Math.round(t.durationSec * 30) / 30, 0);
    expect(Number(measured.video.format.duration)).toBeGreaterThan(total - 0.2);
    expect(Number(measured.video.format.duration)).toBeLessThan(total + 0.2);
  });
});

describe('WP48 CLIP_13 heritage devotion poster (C1): timeline + geometry', () => {
  it('6.90 s loop: FULL BLEED at t=0 (no headline) -> expo-out shrink (0.25-0.65) -> markers -> six lines (70 ms stagger) -> marquee (2.65-3.05) -> long poster hold -> loop cut full bleed (== t 0)', () => {
    expect(HERITAGE_BASE_SEC).toBe(6.9);
    // opening frame matches the capture start: full-bleed photo + micro only
    expect(heritagePhotoRect(0)).toEqual({x: 0, y: 0, w: 1, h: 1});
    expect(heritageFlash(0)).toBe(true);
    for (let i = 0; i < 6; i++) expect(heritageLineOffset(0, i)).toBeNull();
    expect(heritageMarkerStage(0)).toBeNull();
    const mid = heritagePhotoRect(0.45);
    expect(mid.w).toBeLessThan(1);
    expect(mid.w).toBeGreaterThan(HERITAGE_THUMB.w);
    expect(heritagePhotoRect(0.65)).toEqual(HERITAGE_THUMB);
    expect(heritageFlash(0.7)).toBe(false);
    expect(heritageMarkerStage(0.5)).toBeNull();
    expect(heritageMarkerStage(0.9)).not.toBeNull();
    expect(heritageMarkerStage(2.0)).not.toBeNull();
    // finished poster is the END hold, not the open
    expect(heritageLineOffset(4.0, 0)).toBe(0);
    expect(heritagePhotoRect(HERITAGE_LOOP_CUT_SEC)).toEqual({x: 0, y: 0, w: 1, h: 1});
    expect(heritageFlash(HERITAGE_LOOP_CUT_SEC + 0.1)).toBe(true);
    expect(heritageMarkerStage(HERITAGE_BASE_SEC - 0.1)).toBeNull();
    // loop seam: last frame == first frame (full-bleed open)
    expect(heritagePhotoRect(HERITAGE_BASE_SEC - 1e-3)).toEqual(heritagePhotoRect(0));
    for (let i = 0; i < 6; i++) expect(heritageLineOffset(HERITAGE_BASE_SEC - 1e-3, i)).toBe(heritageLineOffset(0, i));
  });

  it('LAYOUT RULE: the photo is a plain rectangle and never hides a headline that is shown (flashes clear the headline; elsewhere the thumb sits in its own zone)', () => {
    for (let t = 0; t < HERITAGE_BASE_SEC; t += 1 / 30) {
      const photo = heritagePhotoRect(t);
      const shown = [0, 1, 2, 3, 4, 5].some(i => heritageLineOffset(t, i) !== null);
      if (heritageFlash(t)) expect(shown, `t=${t.toFixed(2)}`).toBe(false);
      if (shown) expect(photo.w, `t=${t.toFixed(2)}`).toBeLessThanOrEqual(HERITAGE_THUMB.w + 1e-9);
    }
    // reveals rise from below (+1 -> 0) in order; the marquee leaves upward then returns from below
    expect(heritageLineOffset(1.15, 0)).toBe(1);
    expect(heritageLineOffset(1.15, 5)).toBe(1);
    expect(heritageLineOffset(2.15, 5)).toBe(0);
    expect(heritageLineOffset(2.8, 0)!).toBeLessThan(0);
    expect(heritageLineOffset(2.95, 0)!).toBeGreaterThan(0);
    expect(heritageLineOffset(3.1, 0)).toBe(0);
  });
});

describe('WP48 CLIP_14 silk legacy cover (C2): timeline + geometry', () => {
  it('3.05 s loop: thumb (18% W) -> expo-out cover with a 4% inset (1.0-1.9) -> HARD cut -> blank white beat (2.3-2.6) -> thumb + three-line rise (90 ms stagger) (== t 0)', () => {
    expect(SILK_BASE_SEC).toBe(3.05);
    expect(SILK_THUMB.w).toBeCloseTo(0.18, 6);
    expect(SILK_COVER.x).toBeCloseTo(0.04, 6);
    expect(SILK_COVER.w).toBeCloseTo(0.92, 6);
    expect(silkPhotoRect(0)).toEqual(SILK_THUMB);
    expect(silkPhotoRect(1.0)).toEqual(SILK_THUMB);
    expect(silkPhotoRect(1.9)!.w).toBeCloseTo(SILK_COVER.w, 6);
    expect(silkPhotoRect(2.0)!.w).toBeCloseTo(SILK_COVER.w, 6);
    expect(silkPhotoRect(2.3)).toBeNull();
    expect(silkPhotoRect(2.59)).toBeNull();
    expect(silkPhotoRect(2.6)).toEqual(SILK_THUMB);
    expect(silkPhotoRect(SILK_BASE_SEC - 1e-3)).toEqual(silkPhotoRect(0));
    for (let i = 0; i < 3; i++) expect(silkLineOffset(SILK_BASE_SEC - 1e-3, i)!).toBeCloseTo(silkLineOffset(0, i)!, 3); // the last line settles exactly at the loop end
    expect(silkBodyOffset(SILK_BASE_SEC - 1e-3)).toBe(silkBodyOffset(0));
    expect(silkLineOffset(2.6, 0)).toBe(1);
    expect(silkLineOffset(2.6, 2)).toBe(1);
    expect(silkLineOffset(2.45, 0)).toBeNull();
  });

  it('LAYOUT RULE: the headline + body clear before the photo is at cover size, the blank beat is micro-only, and the in-image wordmark lives only while the photo covers (never on the blank beat)', () => {
    for (let t = 0; t < SILK_BASE_SEC; t += 1 / 30) {
      const photo = silkPhotoRect(t);
      const copyShown = [0, 1, 2].some(i => silkLineOffset(t, i) !== null) || silkBodyOffset(t) !== null;
      if (t >= 2.3 && t < 2.6) {
        expect(photo, `blank ${t.toFixed(2)}`).toBeNull();
        expect(copyShown, `blank ${t.toFixed(2)}`).toBe(false);
        expect(silkWordmarkOffset(t), `blank ${t.toFixed(2)}`).toBeNull();
      }
      if (copyShown && photo) expect(photo.w, `t=${t.toFixed(2)}`).toBeLessThan(SILK_COVER.w);
      if (silkWordmarkOffset(t) !== null) expect(photo, `wordmark ${t.toFixed(2)}`).not.toBeNull();
    }
    expect(silkWordmarkOffset(1.1)).toBeNull();
    expect(silkWordmarkOffset(1.2)).toBe(1);
    expect(silkWordmarkOffset(1.8)).toBe(0);
  });
});

describe('WP48 CLIP_15 glass testimonial morph (C3) + CLIP_16 portrait push (C4): timeline + geometry', () => {
  it('glass: opens mid-morph (blurred, no icons) -> snap to 2x in 150 ms -> settle to 1x in 400 ms -> blur-in over 500 ms -> icons fade -> long readable hold (end ≠ open; capture started on the end frame)', () => {
    expect(GLASS_BASE_SEC).toBe(3.93);
    const open = glassFrame(0);
    expect(open.scale).toBeCloseTo(1, 6);
    expect(open.centre).toBeCloseTo(0, 6);
    expect(open.contentBlurPx).toBeGreaterThan(0);
    expect(open.iconOpacity).toBe(0);
    const peak = glassFrame(0.15);
    expect(peak.scale).toBeCloseTo(GLASS_SNAP_SCALE, 6);
    expect(peak.contentBlurPx).toBeCloseTo(GLASS_BLUR_PX, 6);
    expect(peak.iconOpacity).toBe(0);
    expect(glassFrame(0.3).scale).toBeLessThan(GLASS_SNAP_SCALE);
    expect(glassFrame(0.55).scale).toBeCloseTo(1, 6);
    expect(glassFrame(0.55).contentBlurPx).toBeCloseTo(GLASS_BLUR_PX, 6);
    expect(glassFrame(1.05).contentBlurPx).toBeCloseTo(0, 6);
    expect(glassFrame(1.0).iconOpacity).toBe(0);
    expect(glassFrame(1.15).iconOpacity).toBeGreaterThan(0);
    expect(glassFrame(1.15).iconOpacity).toBeLessThan(1);
    expect(glassFrame(1.25).iconOpacity).toBe(1);
    const end = glassFrame(GLASS_BASE_SEC - 1e-3);
    expect(end.scale).toBe(1);
    expect(end.contentBlurPx).toBe(0);
    expect(end.iconOpacity).toBe(1);
    // readable end must NOT equal the blurred open (the offline recording bug)
    expect(end.contentBlurPx).not.toBe(open.contentBlurPx);
    expect(end.iconOpacity).not.toBe(open.iconOpacity);
  });

  it('push: hold A 0.9 (1.5% zoom) -> push A to B 1.0 s -> hold B 1.3 -> push B to C 1.05 -> wrap; out scale 0.94, in scale from 0.9, the white gap never closes below 7.5% of the artboard', () => {
    expect(PUSH_BASE_SEC).toBe(4.35);
    expect(pushState(0.5)).toMatchObject({from: 0, to: 0, e: 0});
    expect(pushState(0.89).outScale).toBeCloseTo(1.015, 2);
    expect(pushState(0.95)).toMatchObject({from: 0, to: 1});
    const end1 = pushState(1.9);
    expect(end1).toMatchObject({from: 1, to: 1, e: 0});
    expect(pushState(1.89).e).toBeCloseTo(1, 1);
    expect(pushState(3.0)).toMatchObject({from: 1, to: 1});
    expect(pushState(3.3)).toMatchObject({from: 1, to: 2});
    expect(pushState(4.3)).toMatchObject({from: 2, to: 2, e: 0});
    const mid = pushState(1.4);
    expect(mid.outScale).toBeLessThan(1.015);
    expect(mid.outScale).toBeGreaterThan(PUSH_OUT_SCALE);
    expect(mid.inScale).toBeGreaterThan(0.9);
    expect(mid.inScale).toBeLessThan(1);
    const cardH = 0.88 * 1350;
    const travel = pushTravel(cardH, 1350);
    for (let t = 0.9; t <= 1.9; t += 1 / 30) {
      const s = pushState(t);
      const outBottom = 675 - travel * s.e + (cardH * s.outScale) / 2;
      const inTop = 675 + travel * (1 - s.e) - (cardH * s.inScale) / 2;
      expect(inTop - outBottom, `gap@${t.toFixed(2)}`).toBeGreaterThanOrEqual(PUSH_GAP * 1350 - 1e-6);
    }
    expect(PORTRAIT_PUSH_TIMELINE.filter(row => row.primitive === 'vertical_push')).toHaveLength(2);
  });
});

describe('WP48 library registry, bind and craft pins', () => {
  it('all twenty-one ids resolve through the registry; the four WP48 comps are opaque full_screen only and carry stills as assets, never literals', () => {
    for (const id of WP48_IDS) {
      expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: id}})!.compositionId).toBe(MOTION_TEMPLATE_REGISTRY_IDS[id]);
      for (const placement of ['overlay', 'pip']) expect(resolveLibraryGraphic({placement, content: {motionTemplateId: id}}), `${id}:${placement}`).toBeNull();
    }
    const heritage = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_13_heritage_poster', lines: ['WHERE', 'HERITAGE', 'MEETS'], brandMark: 'L°', hideMicro: true, imageSrc: 'https://x.invalid/a.jpg'}})!;
    expect(heritage.props).toEqual({lines: ['WHERE', 'HERITAGE', 'MEETS'], brandMark: 'L°', hideMicro: true, imageAsset: 'photo'});
    expect(heritage.assets).toEqual({photo: {src: 'https://x.invalid/a.jpg'}});
    const silk = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_14_silk_legacy', lines: ['A', 'B', 'C'], wordmark: 'LUMEN', personalized: true}})!;
    expect(silk.props).toEqual({wordmark: 'LUMEN', hideMicro: true, personalized: true, lines: ['A', 'B', 'C']});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_14_silk_legacy', lines: ['only', 'two']}})!.props).toEqual({});
    const glass = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_15_glass_testimonial', quote: 'It changed how we work', author: 'Ada', wordmark: 'Lumen'}})!;
    expect(glass.props).toEqual({quote: 'It changed how we work', author: 'Ada', wordmark: 'Lumen'});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_15_glass_testimonial', quote: 'q'.repeat(121)}})!.props).toEqual({});
    const push = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_16_portrait_push', imageUrls: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg', 'http://x.invalid/c.jpg']}})!;
    expect(push.props).toEqual({imageAssets: ['portrait0', 'portrait1']});
    expect(push.assets).toEqual({portrait0: {src: 'https://x.invalid/a.jpg'}, portrait1: {src: 'https://x.invalid/b.jpg'}});
    expect(JSON.stringify([heritage.props, silk.props, glass.props, push.props])).not.toMatch(/https?:/);
  });

  it('libraryGraphicSource: a tiny TSX per comp that imports only the toolkit and wires stills from `assets`', () => {
    for (const id of WP48_IDS) {
      const spec = motionTemplate(id)!;
      const hit = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: id, imageSrc: 'https://x.invalid/a.jpg', imageUrls: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg']}})!;
      const source = libraryGraphicSource(hit);
      expect(source, id).toContain(`import {${spec.compositionId}, type GraphicProps} from '@finalpost/motion';`);
      expect(source, id).toMatch(/assets\?\.\[/);
      expect(source.split('\n').length, id).toBeLessThan(30);
      expect(source, id).not.toMatch(/https?:/);
    }
  });

  it('bind: personalized copy only (never ACME / PARIS / Mango); clip_16 needs two https stills; clip_13 hides the micro chrome; clip_14 gives exactly three lines', () => {
    const spoken = 'this heritage poster shows devotion and elegance from Lumen studio with silk woven by hand across five generations'.split(' ').map((text, k) => ({text, start: 1 + k * 0.4, end: 1.35 + k * 0.4}));
    const base = {words: spoken, beatStart: 1, beatEnd: 6};
    const one = bindMotionTemplateContent({...base, templateId: 'clip_13_heritage_poster'})!;
    expect(one.hideMicro).toBe(true);
    expect(one.personalized).toBe(true);
    expect((one.lines as string[]).length).toBeGreaterThanOrEqual(3);
    expect((one.lines as string[]).length).toBeLessThanOrEqual(6);
    expect(String(one.brandMark)).toMatch(/^.°$/);
    const two = bindMotionTemplateContent({...base, templateId: 'clip_14_silk_legacy'})!;
    expect((two.lines as string[]).length).toBe(3);
    expect(two.hideMicro).toBe(true);
    const three = bindMotionTemplateContent({...base, templateId: 'clip_15_glass_testimonial', imageUrls: ['https://x.invalid/a.jpg']})!;
    expect(String(three.quote).length).toBeGreaterThan(10);
    expect(String(three.quote).length).toBeLessThanOrEqual(120);
    expect(three.imageSrc).toBe('https://x.invalid/a.jpg');
    expect(bindMotionTemplateContent({...base, templateId: 'clip_16_portrait_push'})).toBeNull();
    expect(bindMotionTemplateContent({...base, templateId: 'clip_16_portrait_push', imageUrls: ['https://x.invalid/a.jpg', 'http://x.invalid/b.jpg']})).toBeNull();
    const four = bindMotionTemplateContent({...base, templateId: 'clip_16_portrait_push', imageUrls: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg', 'https://x.invalid/c.jpg', 'https://x.invalid/d.jpg']})!;
    expect(four.imageUrls).toHaveLength(3);
    expect(JSON.stringify([one, two, three, four])).not.toMatch(/acme|paris|milan|mango|ship it/i);
    // every bound content resolves through the registry
    for (const content of [one, two, three, four]) expect(resolveLibraryGraphic({placement: 'full_screen', content: {...content, motionTemplateId: ['clip_13_heritage_poster', 'clip_14_silk_legacy', 'clip_15_glass_testimonial', 'clip_16_portrait_push'][[one, two, three, four].indexOf(content)]}})).not.toBeNull();
    // a demo-shell phrase in the speech is refused for the quote
    const demo = [...'we love the Mango campaign it is great'.split(' ')].map((text, k) => ({text, start: k * 0.4, end: k * 0.4 + 0.3}));
    expect(bindMotionTemplateContent({templateId: 'clip_15_glass_testimonial', words: demo, beatStart: 0, beatEnd: 4})).toBeNull();
  });

  it('craft: the three flat comps have no blur / glow / shadow / cross-fade; the glass comp blurs only its own backdrop + the defined content blur-in; all four are silent; the polish flag is still the one', () => {
    for (const comp of ['HeritageDevotionPoster', 'SilkLegacyCover', 'PortraitPushCarousel']) {
      const source = code(read(`remotion/src/motion/compositions/templates/${comp}.tsx`));
      expect(source, comp).not.toMatch(/blur\(|backdrop|boxShadow|textShadow|drop-shadow|text-shadow|box-shadow|feTurbulence|feGaussianBlur|\bopacity\b/);
    }
    const glass = code(read('remotion/src/motion/compositions/templates/GlassTestimonialMorph.tsx'));
    expect(glass.match(/backdropFilter/g)).toHaveLength(1);
    expect(glass).not.toMatch(/boxShadow|textShadow|drop-shadow|text-shadow|box-shadow|feTurbulence|feGaussianBlur/);
    for (const comp of WP48_COMPS) expect(code(read(`remotion/src/motion/compositions/templates/${comp}.tsx`)), comp).not.toMatch(/useAudio|<Audio|<Html5Audio|dashed|cursor/i);
    expect(Object.keys(env).filter(key => /^POLISH_(CLIP|MOTION_TEMPLATE|TEMPLATE)/.test(key))).toEqual(['POLISH_MOTION_TEMPLATES']);
  });
});

describe('WP48 proof outputs (after npm run preview:wp48)', () => {
  it('preview script, entry, npm script and the proof artefacts exist; preview:wp45 / 46 / 47 are still wired', () => {
    expect(existsSync(join(repo, 'remotion/scripts/wp48-preview.mjs'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/scripts/wp48/entry.tsx'))).toBe(true);
    const pkg = read('remotion/package.json');
    for (const n of [45, 46, 47, 48]) expect(pkg).toMatch(new RegExp(`"preview:wp${n}": "node scripts/wp${n}-preview\\.mjs"`));
    for (const file of ['wp48-motion-templates.mp4', 'wp48-contact-sheet.jpg', 'wp48-plan.json', 'wp48-measured.json', 'WP48_MOTION_TEMPLATES.md']) {
      expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    }
  });

  it('the measured proof is the four WP48 templates, silent, paused live, all opaque full_screen, and as long as the four templates back to back', () => {
    const measured = JSON.parse(read('remotion/out/phase36-readiness/wp48-measured.json'));
    expect(measured.templates.map((t: {templateId: string}) => t.templateId)).toEqual([...WP48_IDS]);
    expect(measured.templates.map((t: {compositionId: string}) => t.compositionId)).toEqual([...WP48_COMPS]);
    expect(measured.templates.every((t: {placement: string; ownsFrame: boolean}) => t.placement === 'full_screen' && t.ownsFrame)).toBe(true);
    expect(measured.sfx).toMatch(/none/);
    expect(measured.live).toBe('PAUSED');
    expect(measured.allowlists).toEqual(JSON.parse(JSON.stringify(SKILL_MOTION_TEMPLATE_ALLOWLIST)));
    expect(measured.bind.clip_16_portrait_push.noStills).toBeNull();
    const total = MOTION_TEMPLATE_CATALOG.filter(t => (WP48_IDS as readonly string[]).includes(t.id)).reduce((sum, t) => sum + Math.round(t.durationSec * 30) / 30, 0);
    expect(Number(measured.video.format.duration)).toBeGreaterThan(total - 0.2);
    expect(Number(measured.video.format.duration)).toBeLessThan(total + 0.2);
  });
});

describe('WP50 CLIP_17..21 (Part 4 stacks + posters): timeline + geometry', () => {
  it('timelines: baseSec = catalog duration; clip_19 exits with slide_apart_x; primitive sets match the catalog', () => {
    for (const id of WP50_IDS) {
      const spec = MOTION_TEMPLATE_CATALOG.find(row => row.id === id)!;
      expect(MOTION_TEMPLATE_TIMELINES[id].baseSec, id).toBeCloseTo(spec.durationSec, 2);
      expect(spec.ownsFrame, id).toBe(true);
    }
    expect(MOTION_TEMPLATE_TIMELINES.clip_19_two_up_stack.ops.some(op => op.primitive === 'slide_apart_x')).toBe(true);
    expect(MOTION_TEMPLATE_TIMELINES.clip_19_two_up_stack.baseSec).toBe(2);
    expect(NEVER_DONE_BASE_SEC).toBe(2.38);
    expect(TYPEWRITER_BASE_SEC).toBe(5.03);
  });

  it('CLIP_17: full height on the hold, ease-in to the 0.005 hairline at 1.33 s; bottom card is centred; the rects stay anchored', () => {
    expect(stackCollapseHeight(0)).toBe(1);
    expect(stackCollapseHeight(0.87)).toBe(1);
    expect(stackCollapseHeight(1.33)).toBeCloseTo(STACK_COLLAPSE_END_HEIGHT, 6);
    expect(stackCollapseHeight(1.1)).toBeGreaterThan(0.5); // ease-in: slow start
    expect(STACK_COLLAPSE_RECTS[1]!.y - (STACK_COLLAPSE_RECTS[0]!.y + STACK_COLLAPSE_RECTS[0]!.h)).toBeCloseTo(0.11, 2);
    expect(STACK_COLLAPSE_RECTS[1]!.x).toBeCloseTo((1 - STACK_COLLAPSE_RECTS[1]!.w) / 2, 6);
    const src = read('remotion/src/motion/compositions/templates/PhotoStackCollapse.tsx');
    expect(src).toMatch(/clipPath/);
    expect(src).not.toMatch(/scale\(|scaleY|borderRadius/);
  });

  it('CLIP_18: starts blank (no payoff flash), then top-anchored reveal with the 0 / 0 / 0.15 stagger; gutters ~4%', () => {
    for (const i of [0, 1, 2]) {
      expect(stackRevealOpacity(0, i)).toBe(1);
      expect(stackRevealHeight(0, i)).toBe(0);
      expect(stackRevealHeight(STACK_REVEAL_BLANK_TO_SEC, i)).toBe(0);
    }
    expect(stackRevealHeight(0.4, 0)).toBeGreaterThan(stackRevealHeight(0.4, 2));
    expect(stackRevealHeight(STACK_REVEAL_HOLD_FROM_SEC, 0)).toBe(1);
    expect(stackRevealHeight(STACK_REVEAL_HOLD_FROM_SEC, 2)).toBe(1);
    expect(STACK_REVEAL_RECTS[1]!.y - (STACK_REVEAL_RECTS[0]!.y + STACK_REVEAL_RECTS[0]!.h)).toBeCloseTo(0.04, 2);
    expect(read('remotion/src/motion/compositions/templates/PhotoStackReveal.tsx')).not.toMatch(/scale\(|scaleY|borderRadius/);
  });

  it('CLIP_19: two inset cards, x 5% / w 90%, a 3-4% gutter; exit slides top left / bottom right', () => {
    expect(TWO_UP_RECTS).toHaveLength(2);
    for (const rect of TWO_UP_RECTS) {
      expect(rect.x).toBeCloseTo(0.05, 2);
      expect(rect.w).toBeCloseTo(0.9, 2);
    }
    const gutter = TWO_UP_RECTS[1]!.y - (TWO_UP_RECTS[0]!.y + TWO_UP_RECTS[0]!.h);
    expect(gutter).toBeGreaterThanOrEqual(0.025);
    expect(gutter).toBeLessThanOrEqual(0.04);
    expect(twoUpExit(TWO_UP_EXIT_FROM_SEC)).toBe(0);
    expect(twoUpExit(2.0)).toBe(1);
    expect(twoUpExit(1.7)).toBeGreaterThan(0);
    expect(read('remotion/src/motion/compositions/templates/TwoUpStackHold.tsx')).toMatch(/translateX/);
  });

  it('CLIP_20: starts black (no payoff flash) -> pairs pop -> hold -> slit opens into state A hold', () => {
    expect(neverDoneFrame(0)).toMatchObject({black: true, window: 0, lineReveal: [0, 0, 0, 0]});
    const mid = neverDoneFrame(0.18);
    expect(mid.lineReveal[0]).toBe(mid.lineReveal[1]);
    expect(mid.lineReveal[0]).toBeGreaterThan(0);
    expect(mid.lineReveal[2]).toBe(0);
    expect(neverDoneFrame(0.5)).toMatchObject({black: false, window: 0, lineReveal: [1, 1, 1, 1]});
    const slit = neverDoneFrame(1.1);
    expect(slit.window).toBeGreaterThan(0);
    expect(slit.window).toBeLessThan(1);
    expect(slit.lineY[1]).toBeLessThan(neverDoneFrame(0.5).lineY[1]!);
    expect(slit.lineY[2]).toBeGreaterThan(neverDoneFrame(0.5).lineY[2]!);
    expect(neverDoneFrame(NEVER_DONE_STATE_A_FROM_SEC)).toMatchObject({black: false, window: 1, lineReveal: [1, 1, 1, 1]});
    expect(neverDoneFrame(NEVER_DONE_BASE_SEC).window).toBe(1);
    expect(neverDoneFrame(0).black).not.toBe(neverDoneFrame(NEVER_DONE_BASE_SEC).black);
    const src = read('remotion/src/motion/compositions/templates/NeverDoneSlitPoster.tsx');
    expect(src.indexOf('<PhotoFill')).toBeLessThan(src.indexOf('copy.map'));
  });

  it('CLIP_21: block rises 0.49 -> 0.07 over 1.33-3.0 (ease-out); bar widens after line 1; mark fades in 1.83-2.4 and goes fill -> outline 4.17-4.67; long lines speed up; markSrc is replaceable', () => {
    expect(typewriterBlockY(1.0)).toBe(TYPEWRITER_BLOCK_Y_FROM);
    expect(typewriterBlockY(3.0)).toBeCloseTo(TYPEWRITER_BLOCK_Y_TO, 6);
    expect(typewriterBlockY(2.0)).toBeLessThan((TYPEWRITER_BLOCK_Y_FROM + TYPEWRITER_BLOCK_Y_TO) / 2);
    expect(typewriterBarExpand(1.3)).toBe(0);
    expect(typewriterBarExpand(1.83)).toBe(1);
    expect(typewriterMark(1.8).fadeIn).toBe(0);
    expect(typewriterMark(2.4).fadeIn).toBe(1);
    expect(typewriterMark(4.0).outline).toBe(0);
    expect(typewriterMark(4.67).outline).toBe(1);
    expect(typewriterMark(3).rotateDeg).toBeGreaterThan(typewriterMark(2.5).rotateDeg);
    expect(typewriterCps(0, 10)).toBe(10);
    expect(typewriterCps(1, 13)).toBe(20);
    expect(typewriterCps(0, 30)).toBeGreaterThan(10);
    expect(read('remotion/src/motion/compositions/templates/TypewriterPoster.tsx')).toMatch(/markSrc/);
  });

  it('registry: all five resolve opaque full_screen only, stills travel as assets; personalized hides the demo chrome', () => {
    for (const id of WP50_IDS) {
      expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: id}})!.compositionId).toBe(MOTION_TEMPLATE_REGISTRY_IDS[id]);
      for (const placement of ['overlay', 'pip']) expect(resolveLibraryGraphic({placement, content: {motionTemplateId: id}}), `${id}:${placement}`).toBeNull();
    }
    const stack = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_18_photo_stack_reveal', imageUrls: ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg', 'http://x.invalid/c.jpg']}})!;
    expect(stack.props).toEqual({imageAssets: ['photo0', 'photo1']});
    expect(stack.assets).toEqual({photo0: {src: 'https://x.invalid/a.jpg'}, photo1: {src: 'https://x.invalid/b.jpg'}});
    expect(libraryGraphicSource(stack)).toMatch(/imageUrls=\{imageUrls\}/);
    const slit = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_20_never_done_slit', lines: ['One', 'Two', 'Three', 'Four'], personalized: true, imageSrc: 'https://x.invalid/a.jpg'}})!;
    expect(slit.props).toEqual({hideMicro: true, personalized: true, lines: ['One', 'Two', 'Three', 'Four'], imageAsset: 'photo'});
    const live = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_21_typewriter', lines: ['Launch', 'Friday at noon'], accent: '#FFD400', ground: '#101010', personalized: true, markSrc: 'https://x.invalid/mark.png'}})!;
    expect(live.props).toEqual({accent: '#FFD400', ground: '#101010', hideFooter: true, personalized: true, lines: ['Launch', 'Friday at noon'], markAsset: 'mark'});
    expect(live.assets).toEqual({mark: {src: 'https://x.invalid/mark.png'}});
    expect(libraryGraphicSource(live)).toMatch(/markSrc=\{markSrc\}/);
    for (const id of WP50_IDS) expect(libraryGraphicSource(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: id}})!)).toContain(`import {${MOTION_TEMPLATE_REGISTRY_IDS[id]}, type GraphicProps} from '@finalpost/motion';`);
  });

  it('bind: clip_17 / 18 / 19 need two https stills; clip_20 / 21 are grounded in speech, personalized, and never carry acme / Mango / the demo dates', () => {
    const words = 'launch week brings faster exports shared folders better search offline mode'.split(' ').map((text, k) => ({text, start: 1 + k * 0.4, end: 1.35 + k * 0.4}));
    const base = {words, beatStart: 1, beatEnd: 5};
    const https2 = ['https://x.invalid/a.jpg', 'https://x.invalid/b.jpg'];
    for (const id of ['clip_17_photo_stack_collapse', 'clip_18_photo_stack_reveal', 'clip_19_two_up_stack'] as const) {
      expect(bindMotionTemplateContent({...base, templateId: id}), id).toBeNull();
      expect(bindMotionTemplateContent({...base, templateId: id, imageUrls: ['https://x.invalid/a.jpg', 'http://x.invalid/b.jpg']}), id).toBeNull();
      expect(bindMotionTemplateContent({...base, templateId: id, imageUrls: https2}), id).toMatchObject({imageUrls: https2, personalized: true});
    }
    const slit = bindMotionTemplateContent({...base, templateId: 'clip_20_never_done_slit'})!;
    expect(slit.lines).toHaveLength(4);
    expect(slit).toMatchObject({personalized: true, hideMicro: true});
    const live = bindMotionTemplateContent({...base, templateId: 'clip_21_typewriter', accent: '#FFD400', ground: '#101010', imageUrls: https2})!;
    expect((live.lines as string[]).length).toBeGreaterThanOrEqual(2);
    expect(live).toMatchObject({personalized: true, hideFooter: true, accent: '#FFD400', ground: '#101010', markSrc: 'https://x.invalid/a.jpg'});
    expect(JSON.stringify([slit, live])).not.toMatch(/acme|mango|july 15|8-10am/i);
    expect(bindMotionTemplateContent({...base, words: [{text: 'hello', start: 1, end: 1.3}], templateId: 'clip_20_never_done_slit'})).toBeNull();
    for (const content of [slit, live]) expect(resolveLibraryGraphic({placement: 'full_screen', content: {...content, motionTemplateId: content === slit ? 'clip_20_never_done_slit' : 'clip_21_typewriter'}})).not.toBeNull();
  });

  it('craft: silent, no selection chrome / cursor / pill, no cross-fade or glow in the comps', () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const comp of WP50_COMPS) {
      const source = code(read(`remotion/src/motion/compositions/templates/${comp}.tsx`));
      expect(source, comp).not.toMatch(/useAudio|<Audio|<Html5Audio|dashed|cursor|Screen Recording|blur\(|boxShadow|textShadow|drop-shadow|backdrop/i);
    }
    expect(Object.keys(env).filter(key => /^POLISH_(CLIP|MOTION_TEMPLATE|TEMPLATE)/.test(key))).toEqual(['POLISH_MOTION_TEMPLATES']);
  });
});

describe('WP50 proof outputs (after npm run preview:wp50)', () => {
  it('preview script, entry, npm script and the proof artefacts exist; preview:wp45 - 48 are still wired', () => {
    expect(existsSync(join(repo, 'remotion/scripts/wp50-preview.mjs'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/scripts/wp50/entry.tsx'))).toBe(true);
    const pkg = read('remotion/package.json');
    for (const n of [45, 46, 47, 48, 50]) expect(pkg).toMatch(new RegExp(`"preview:wp${n}": "node scripts/wp${n}-preview\\.mjs"`));
    for (const file of ['wp50-motion-templates.mp4', 'wp50-contact-sheet.jpg', 'wp50-plan.json', 'wp50-measured.json', 'WP50_MOTION_TEMPLATES.md']) {
      expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    }
  });

  it('the measured proof is the five WP50 templates, silent, paused live, all opaque full_screen, and as long as the five back to back', () => {
    const measured = JSON.parse(read('remotion/out/phase36-readiness/wp50-measured.json'));
    expect(measured.templates.map((t: {templateId: string}) => t.templateId)).toEqual([...WP50_IDS]);
    expect(measured.templates.map((t: {compositionId: string}) => t.compositionId)).toEqual([...WP50_COMPS]);
    expect(measured.templates.every((t: {placement: string; ownsFrame: boolean}) => t.placement === 'full_screen' && t.ownsFrame)).toBe(true);
    expect(measured.sfx).toMatch(/none/);
    expect(measured.live).toBe('PAUSED');
    expect(measured.allowlists).toEqual(JSON.parse(JSON.stringify(SKILL_MOTION_TEMPLATE_ALLOWLIST)));
    expect(measured.bind.clip_17_photo_stack_collapse.noStills).toBeNull();
    const total = MOTION_TEMPLATE_CATALOG.filter(t => (WP50_IDS as readonly string[]).includes(t.id)).reduce((sum, t) => sum + Math.round(t.durationSec * 30) / 30, 0);
    expect(Number(measured.video.format.duration)).toBeGreaterThan(total - 0.2);
    expect(Number(measured.video.format.duration)).toBeLessThan(total + 0.2);
  });
});

describe('WP51 CLIP_22..26 (Batch B): timelines + state functions', () => {
  it('catalog rows: durations / aspects / loops, primitives equal the timeline primitives exactly, op windows are well formed', () => {
    const rows = WP51_IDS.map(id => motionTemplate(id)!);
    expect(rows.map(r => r.durationSec)).toEqual([10.25, 2.87, 4.38, 1.21, 1.61]);
    expect(rows.map(r => r.aspect)).toEqual(['9:16', '4:5', '1:1', '1:1', '16:10']);
    expect(rows.map(r => r.loop)).toEqual([true, false, true, false, false]);
    expect(rows.every(r => r.ownsFrame)).toBe(true);
    for (const spec of rows) {
      const timeline = MOTION_TEMPLATE_TIMELINES[spec.id];
      expect(timeline.baseSec, spec.id).toBeCloseTo(spec.durationSec, 2);
      expect(new Set(timeline.ops.map(o => o.primitive).filter((p): p is string => p !== null)), spec.id).toEqual(new Set(spec.primitives));
      for (const o of timeline.ops) expect(o.to, `${spec.id}:${o.id}`).toBeLessThanOrEqual(timeline.baseSec + 1e-9);
    }
    expect(motionTemplate('clip_22_chat_conversation')!.intents).toContain('chat_conversation');
    expect(motionTemplate('clip_23_sale_promo')!.intents).toContain('sale_promo');
    expect(motionTemplate('clip_24_color_word_wheel')!.intents).toContain('color_wheel');
    expect(motionTemplate('clip_25_tracking_collapse')!.intents).toContain('tracking_headline');
    expect(motionTemplate('clip_26_spatial_blur_tilt')!.intents).toContain('spatial_reveal');
  });

  it('CLIP_22 chat: indicator 1.2 s, pill 0.1 s, expand 0.25 s expo-out, then 125 ms/word rise 5 px; the demo cadence is 0 / 2.4 / 5.6 / 8.6 and the last slot is indicator-only', () => {
    expect([...timing51.CHAT_CYCLE_START_SEC]).toEqual([0, 2.4, 5.6, 8.6]);
    const at = (t: number, words = 3) => timing51.chatBubbleFrame(t, 0, words);
    expect(at(-0.01).phase).toBe('hidden');
    expect(at(0.3).phase).toBe('indicator');
    expect(at(1.25).phase).toBe('pill');
    expect(at(1.4).phase).toBe('expand');
    expect(at(1.4).expand).toBeGreaterThan(0);
    expect(at(1.4).expand).toBeLessThan(1);
    expect(at(1.55).phase).toBe('words');
    expect(at(1.55 + 0.16).words[0]!.fade).toBe(1);
    expect(at(1.55 + 0.16).words[0]!.rise).toBeCloseTo(0, 5);
    expect(at(1.55 + 0.01).words[0]!.rise).toBeGreaterThan(4);
    expect(at(1.55 + 0.01).words[2]!.fade).toBe(0);
    expect(at(9.9).phase).toBe('done');
    // the bubble is at its final size from the moment the first word starts
    expect(at(1.55).expand).toBe(1);
    // the three dots pulse on a 0.5 s period, one third apart
    const d0 = timing51.chatBubbleFrame(0.1, 0, 3).dots;
    const d1 = timing51.chatBubbleFrame(0.6, 0, 3).dots;
    for (let k = 0; k < 3; k += 1) expect(d0[k]!).toBeCloseTo(d1[k]!, 5);
    expect(d0[0]).not.toBeCloseTo(d0[1]!, 3);
    // indicator-only never leaves the indicator phase
    expect(timing51.chatBubbleFrame(9.9, 3, 0, true).phase).toBe('indicator');
    expect(timing51.CHAT_DEMO_MESSAGES.at(-1)!.indicatorOnly).toBe(true);
    expect(timing51.CHAT_MAX_WIDTH).toEqual({left: 0.48, right: 0.58});
  });

  it('CLIP_23 sale promo: HARD cut at 0.32 s, clock docks (58,42,12)% -> (25,49,5)% expo-out over 1 s, line 2 at 1.45 then line 1 at 1.55, CTA pill 0.9 -> 1 over 2.0-2.3 s', () => {
    const f = timing51.saleFrame;
    expect(f(0.31).titleCard).toBe(true);
    expect(f(0.32).titleCard).toBe(false);
    expect(f(0.32).dock).toEqual({x: 0.58, y: 0.42, w: 0.12});
    const end = f(1.32).dock;
    expect(end.x).toBeCloseTo(0.25, 5);
    expect(end.y).toBeCloseTo(0.49, 5);
    expect(end.w).toBeCloseTo(0.05, 5);
    expect(f(0.32 + 0.1).dock.x).toBeLessThan(0.43); // expo-out: about half the travel is done after 0.1 s
    expect(f(1.4).line2).toBe(0);
    expect(f(1.5).line2).toBeGreaterThan(0);
    expect(f(1.5).line1).toBe(0);
    expect(f(1.6).line1).toBeGreaterThan(0);
    expect(f(1.99).pill.fade).toBe(0);
    expect(f(2.0).pill.scale).toBeCloseTo(0.9, 5);
    expect(f(2.3).pill.scale).toBeCloseTo(1, 5);
    expect(f(2.3).pill.fade).toBe(1);
  });

  it('CLIP_24 word wheel: beat 1.4 s, scroll 220 ms ease-out, the colour HARD-cuts exactly on the landing (Yellow -> Green -> Black -> Grey)', () => {
    expect([...timing51.WHEEL_LANDING_SEC]).toEqual([0, 1.4, 2.8, 4.2]);
    expect(timing51.WHEEL_DEFAULT_WORDS.slice(2, 6)).toEqual(['Yellow', 'Green', 'Black', 'Grey']);
    expect(timing51.WHEEL_DEFAULT_COLORS).toEqual(['#E0AE10', '#A8C520', '#1A1A1A', '#9A9CB8']);
    expect(timing51.wheelPosition(1.0, 2, 3)).toBe(2);
    expect(timing51.wheelPosition(1.3, 2, 3)).toBeGreaterThan(2);
    expect(timing51.wheelPosition(1.3, 2, 3)).toBeLessThan(3);
    expect(timing51.wheelPosition(1.4, 2, 3)).toBeCloseTo(3, 5);
    expect(timing51.wheelPosition(4.3, 2, 3)).toBeCloseTo(5, 5);
    expect(timing51.wheelColorIndex(1.39)).toBe(0);
    expect(timing51.wheelColorIndex(1.4)).toBe(1);
    expect(timing51.wheelColorIndex(4.2)).toBe(3);
    expect(timing51.wheelColorIndex(4.2, 2)).toBe(1); // fewer landings: the wheel stops cutting
    expect(timing51.wheelRowOpacity(0)).toBe(1);
    expect(timing51.wheelRowOpacity(1)).toBe(0.25);
    expect(timing51.wheelRowOpacity(-2)).toBe(0.15);
  });

  it('CLIP_25 tracking collapse: tracking 0.7 em -> 0 over 280 ms, indent 12% -> 0, 67 ms/char (tightened so every line lands before the hold)', () => {
    expect([...timing51.TRACKING_LINE_START_SEC]).toEqual([0, 0.33, 0.63, 0.88]);
    const start = timing51.trackingLineFrame(0, 0, 5);
    expect(start.typed).toBe(1);
    expect(start.trackingEm).toBeCloseTo(0.7, 5);
    expect(start.indent).toBeCloseTo(0.12, 5);
    expect(timing51.trackingLineFrame(0.28, 0, 5).trackingEm).toBeCloseTo(0, 5);
    expect(timing51.trackingLineFrame(0.28, 0, 5).indent).toBeCloseTo(0, 5);
    expect(timing51.trackingLineFrame(0.1, 1, 6).typed).toBe(0);
    expect(timing51.trackingLineFrame(0.33 + 0.067 * 2 + 0.001, 1, 6).typed).toBe(3);
    expect(timing51.trackingCharSec(0, 5)).toBeCloseTo(0.067, 5);
    for (const [i, line] of timing51.TRACKING_DEFAULT_LINES.entries()) {
      const chars = Array.from(line).length;
      expect(timing51.TRACKING_LINE_START_SEC[i]! + chars * timing51.trackingCharSec(i, chars), line).toBeLessThanOrEqual(timing51.TRACKING_HOLD_FROM_SEC + 1e-9);
      expect(timing51.trackingLineFrame(timing51.TRACKING_HOLD_FROM_SEC, i, chars).typed, line).toBe(chars);
    }
    expect([...timing51.TRACKING_DEFAULT_LINES]).toEqual(['HELLO', 'MONDAY', 'GOODBYE', 'WEEKEND']);
  });

  it('CLIP_26 spatial blur + tilt: 36 px / -11 deg / 0.2 at (35%, 25%) -> sharp, upright, centred, full over 0.7 s expo-out; scale 1 -> 0.93 over 1.0-1.61 s; rings 3 -> 7', () => {
    const a = timing51.spatialFrame(0);
    expect(a).toMatchObject({blurPx: 36, rotateDeg: -11, fade: 0.2, x: 0.35, y: 0.25, scale: 1});
    const b = timing51.spatialFrame(0.7);
    expect(b.blurPx).toBeCloseTo(0, 5);
    expect(b.rotateDeg).toBeCloseTo(0, 5);
    expect(b.fade).toBeCloseTo(1, 5);
    expect(b.x).toBeCloseTo(0.5, 5);
    expect(b.y).toBeCloseTo(0.5, 5);
    expect(timing51.spatialFrame(0.1).blurPx).toBeLessThan(26); // expo-out: fast start
    expect(timing51.spatialFrame(1.0).scale).toBe(1);
    expect(timing51.spatialFrame(1.61).scale).toBeCloseTo(0.93, 5);
    expect(timing51.spatialRingCount(0)).toBe(3);
    expect(timing51.spatialRingCount(1.61)).toBe(7);
    expect(timing51.SPATIAL_RING_SPACING).toBe(0.065);
  });
});

describe('WP51 library registry, bind and craft pins', () => {
  const words = (text: string, from = 1): MotionTemplateWord[] => text.split(' ').map((w, k) => ({text: w, start: from + k * 0.4, end: from + k * 0.4 + 0.35}));
  const spoken = words('launch week starts today with bigger savings across every plan and instant setup for creators worldwide');

  it('all twenty-six ids resolve through the registry; the five WP51 comps are opaque full_screen only (overlay / pip miss) and list a Tiny TSX that imports the composition', () => {
    for (const id of WP51_IDS) {
      const spec = motionTemplate(id)!;
      const hit = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: id}})!;
      expect(hit.compositionId, id).toBe(spec.compositionId);
      expect(resolveLibraryGraphic({placement: 'overlay', content: {motionTemplateId: id}}), id).toBeNull();
      expect(resolveLibraryGraphic({placement: 'pip', content: {motionTemplateId: id}}), id).toBeNull();
      expect(libraryGraphicSource(hit), id).toContain(`import {${spec.compositionId}, type GraphicProps} from '@finalpost/motion';`);
      expect(LIBRARY_COMPOSITIONS.find(row => row.id === spec.compositionId)!.opaqueOnly, id).toBe(true);
    }
    expect(MOTION_TEMPLATE_CATALOG.every(spec => resolveLibraryGraphic({placement: placementFor(spec.id), content: {motionTemplateId: spec.id}}) !== null)).toBe(true);
    expect(LIBRARY_COMPOSITION_IDS).toHaveLength(66); // 44 + 11 WP54 comps + 10 WP55 comps
  });

  it('props: palette hex + safe copy pass; over-long / non-hex values are dropped (never truncated); the sale plate travels as an asset, never a literal', () => {
    const chat = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_22_chat_conversation', accent: '#FD5D42', ground: '#101010', messages: [{side: 'left', text: 'One two'}, {side: 'right', text: 'Three four'}, {side: 'left', text: '', indicatorOnly: true}]}})!;
    expect(chat.props).toEqual({accent: '#FD5D42', ground: '#101010', messages: [{side: 'left', text: 'One two'}, {side: 'right', text: 'Three four'}, {side: 'left', text: '', indicatorOnly: true}]});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_22_chat_conversation', messages: [{side: 'left', text: 'x'.repeat(91)}, {side: 'right', text: 'ok'}]}})!.props).toEqual({});
    const sale = resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_23_sale_promo', titleCardText: 'Launch week', lines: ['Ends in', 'Two days'], cta: 'Join now', personalized: true, accent: '#FD5D42', ground: '#0A0A20', imageSrc: 'https://x.invalid/p.jpg'}})!;
    expect(sale.props).toMatchObject({titleCardText: 'Launch week', lines: ['Ends in', 'Two days'], cta: 'Join now', hideFooter: true, accent: '#FD5D42', ground: '#0A0A20', imageAsset: 'photo'});
    expect(JSON.stringify(sale.props)).not.toContain('x.invalid');
    expect(sale.assets).toEqual({photo: {src: 'https://x.invalid/p.jpg'}});
    expect(libraryGraphicSource(sale)).toContain('imageSrc={imageSrc}');
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_24_color_word_wheel', words: ['A1', 'B2', 'C3'], colors: ['#111111', '#EEEEEE']}})!.props).toEqual({words: ['A1', 'B2', 'C3'], colors: ['#111111', '#EEEEEE']});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_24_color_word_wheel', colors: ['red', '#111111']}})!.props).toEqual({});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_25_tracking_collapse', lines: ['ONE', 'TWO', 'THREE'], accent: '#FD5D42'}})!.props).toEqual({accent: '#FD5D42', lines: ['ONE', 'TWO', 'THREE']});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_26_spatial_blur_tilt', lines: ['Now in', 'Full Colour'], ground: '#06070C'}})!.props).toEqual({ground: '#06070C', lines: ['Now in', 'Full Colour']});
    expect(resolveLibraryGraphic({placement: 'full_screen', content: {motionTemplateId: 'clip_26_spatial_blur_tilt', lines: ['x'.repeat(25), 'ok']}})!.props).toEqual({});
  });

  it('bind: every WP51 template grounds in the speech + edit palette; no demo copy ever ships (buildmago / Sale: 30% Off / Spatial Audio / HELLO MONDAY / chat demo lines)', () => {
    const palette = {accent: '#FD5D42', ground: '#0A0A20', ink: '#F5F5F5'};
    const phrasing = [...words('hello there how are you today'), ...words('I am doing great thanks for asking', 4), ...words('want to see the new launch', 8), ...words('absolutely send it over now', 11)];
    const chat = bindMotionTemplateContent({templateId: 'clip_22_chat_conversation', words: phrasing, beatStart: 0, beatEnd: 14, ...palette})!;
    const messages = chat.messages as Array<{side: string; text: string; indicatorOnly?: boolean}>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]!.side).toBe('left');
    expect(messages[1]!.side).toBe('right');
    expect(messages.filter(m => !m.indicatorOnly).every(m => m.text.length > 0 && m.text.length <= 90)).toBe(true);
    expect(chat.accent).toBe('#FD5D42');
    expect(chat.personalized).toBe(true);
    const sale = bindMotionTemplateContent({templateId: 'clip_23_sale_promo', words: spoken, beatStart: 1, beatEnd: 6, ...palette})!;
    expect(sale.hideFooter).toBe(true);
    expect(sale.lines).toHaveLength(2);
    expect(sale.imageSrc).toBeUndefined(); // no still: the comp draws its flat stand-in plate
    expect((bindMotionTemplateContent({templateId: 'clip_23_sale_promo', words: spoken, beatStart: 1, beatEnd: 6, imageUrls: ['https://x.invalid/a.jpg']})!).imageSrc).toBe('https://x.invalid/a.jpg');
    const wheel = bindMotionTemplateContent({templateId: 'clip_24_color_word_wheel', words: spoken, beatStart: 1, beatEnd: 6, ...palette})!;
    expect((wheel.words as string[]).length).toBeGreaterThanOrEqual(3);
    expect((wheel.colors as string[]).length).toBeGreaterThanOrEqual(2);
    expect((wheel.colors as string[]).every(c => /^#[0-9A-F]{6}$/.test(c))).toBe(true);
    expect(bindMotionTemplateContent({templateId: 'clip_24_color_word_wheel', words: spoken, beatStart: 1, beatEnd: 6})!.colors).toBeUndefined();
    const track = bindMotionTemplateContent({templateId: 'clip_25_tracking_collapse', words: spoken, beatStart: 1, beatEnd: 6, ...palette})!;
    expect((track.lines as string[]).length).toBeGreaterThanOrEqual(2);
    expect((track.lines as string[]).length).toBeLessThanOrEqual(4);
    expect((track.lines as string[]).every(line => line === line.toUpperCase())).toBe(true);
    const spatial = bindMotionTemplateContent({templateId: 'clip_26_spatial_blur_tilt', words: spoken, beatStart: 1, beatEnd: 6, ...palette})!;
    expect(spatial.lines).toHaveLength(2);
    expect(spatial.ground).toBe('#0A0A20');
    const everything = JSON.stringify([chat, sale, wheel, track, spatial]);
    expect(everything).not.toMatch(/buildmago|sale:\s*30|spatial audio|hello monday|hey, what|what's up/i);
  });

  it('bind refuses (null) when the speech cannot ground the shell; demo phrases spoken in the video are refused too', () => {
    const one = words('thanks');
    for (const id of WP51_IDS) expect(bindMotionTemplateContent({templateId: id, words: one, beatStart: 1, beatEnd: 3}), id).toBeNull();
    expect(bindMotionTemplateContent({templateId: 'clip_22_chat_conversation', words: words('hello world how are you'), beatStart: 1, beatEnd: 4})).toBeNull(); // one phrase = no conversation
    expect(bindMotionTemplateContent({templateId: 'clip_24_color_word_wheel', words: words('the and of to'), beatStart: 1, beatEnd: 4})).toBeNull();
  });

  it('craft: blur lives ONLY in SpatialBlurTiltReveal (+ the glass pill backdrop in SalePromoCountdown); no cross-dissolve / whip / glitch / bounce / audio / cursor / dashed chrome in any WP51 comp', () => {
    for (const comp of WP51_COMPS) {
      const source = code(read(`remotion/src/motion/compositions/templates/${comp}.tsx`));
      expect(source, comp).not.toMatch(/useAudio|<Audio|<Html5Audio|dashed|cursor|bounce|overshoot|glitch|whip|boxShadow|textShadow|drop-shadow|light.?leak/i);
      expect(source, comp).not.toMatch(/\btransition\s*:/);
      const blurs = source.replace(/blur\(\$\{SALE_BACKDROP_BLUR_PX\}px\)/g, '').match(/blur\(/gi) ?? [];
      if (comp === 'SpatialBlurTiltReveal') expect(blurs.length, comp).toBeGreaterThan(0);
      else expect(blurs, comp).toEqual([]);
      if (comp !== 'SalePromoCountdown') expect(source, comp).not.toMatch(/backdrop/i);
    }
    // the cut in clip_23 is a plain conditional (no dissolve), the wheel's colour cut is an index lookup
    expect(code(read('remotion/src/motion/compositions/templates/SalePromoCountdown.tsx'))).toMatch(/frame\.titleCard \?/);
    expect(code(read('remotion/src/lib/motionTemplateTiming.ts'))).not.toMatch(/\bopacity\b|blur\(|boxShadow|bounce|overshoot/i);
  });

  it('live colour: every WP51 comp (and TypewriterPoster) reads ground / accent from props - the demo blues / navy / gradients are defaults only', () => {
    const wants: Record<string, RegExp[]> = {
      ChatConversationBubbles: [/hexOr\(accent\)/, /hexOr\(ground\)/],
      SalePromoCountdown: [/hexOr\(accent\)/, /hexOr\(ground\)/],
      TrackingCollapseHeadline: [/hexOr\(accent\)/, /hexOr\(ground\)/],
      SpatialBlurTiltReveal: [/hexOr\(accent\)/, /hexOr\(ground\)/],
      ColorWordWheel: [/hexOr/, /colors/],
    };
    for (const [comp, patterns] of Object.entries(wants)) {
      const source = code(read(`remotion/src/motion/compositions/templates/${comp}.tsx`));
      for (const pattern of patterns) expect(source, comp).toMatch(pattern);
    }
    const typewriter = code(read('remotion/src/motion/compositions/templates/TypewriterPoster.tsx'));
    expect(typewriter).toMatch(/accent && HEX\.test\(accent\)/);
    expect(typewriter).toMatch(/ground && HEX\.test\(ground\)/);
  });

  it('flag + lanes: only POLISH_MOTION_TEMPLATES gates the stage (no new flag, no new skill lane); the WP51 ids sit inside the existing four skills', () => {
    expect(Object.keys(env).filter(key => /^POLISH_(CLIP|MOTION_TEMPLATE|TEMPLATE)/.test(key))).toEqual(['POLISH_MOTION_TEMPLATES']);
    expect(Object.keys(SKILL_MOTION_TEMPLATE_ALLOWLIST).sort()).toEqual([...SKILLS].sort());
    for (const id of WP51_IDS) expect(SKILLS.some(skill => SKILL_MOTION_TEMPLATE_ALLOWLIST[skill].includes(id)), id).toBe(true);
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.faceless).not.toContain('clip_22_chat_conversation');
    expect(SKILL_MOTION_TEMPLATE_ALLOWLIST.newsroom_mg).not.toContain('clip_22_chat_conversation');
  });
});

describe('WP51 proof outputs (after npm run preview:wp51)', () => {
  it('preview script, entry, npm script and the proof artefacts exist; preview:wp45 - 50 are still wired', () => {
    expect(existsSync(join(repo, 'remotion/scripts/wp51-preview.mjs'))).toBe(true);
    expect(existsSync(join(repo, 'remotion/scripts/wp51/entry.tsx'))).toBe(true);
    const pkg = read('remotion/package.json');
    for (const n of [45, 46, 47, 48, 50, 51]) expect(pkg).toMatch(new RegExp(`"preview:wp${n}": "node scripts/wp${n}-preview\\.mjs"`));
    for (const file of ['wp51-motion-templates.mp4', 'wp51-contact-sheet.jpg', 'wp51-plan.json', 'wp51-measured.json', 'WP51_MOTION_TEMPLATES.md']) {
      expect(existsSync(join(repo, 'remotion/out/phase36-readiness', file)), file).toBe(true);
    }
    expect(existsSync(join(repo, 'remotion/out/phase36-readiness/wp51-strip'))).toBe(true);
  });

  it('the measured proof is the five WP51 templates, silent, paused live, all opaque full_screen, and as long as the five back to back', () => {
    const measured = JSON.parse(read('remotion/out/phase36-readiness/wp51-measured.json'));
    expect(measured.templates.map((t: {templateId: string}) => t.templateId)).toEqual([...WP51_IDS]);
    expect(measured.templates.map((t: {compositionId: string}) => t.compositionId)).toEqual([...WP51_COMPS]);
    expect(measured.templates.every((t: {placement: string; ownsFrame: boolean}) => t.placement === 'full_screen' && t.ownsFrame)).toBe(true);
    expect(measured.sfx).toMatch(/none/);
    expect(measured.live).toBe('PAUSED');
    expect(measured.allowlists).toEqual(JSON.parse(JSON.stringify(SKILL_MOTION_TEMPLATE_ALLOWLIST)));
    expect(JSON.stringify(measured.bind)).not.toMatch(/buildmago|spatial audio|hello monday|what's up/i);
    const total = MOTION_TEMPLATE_CATALOG.filter(t => (WP51_IDS as readonly string[]).includes(t.id)).reduce((sum, t) => sum + Math.round(t.durationSec * 30) / 30, 0);
    expect(Number(measured.video.format.duration)).toBeGreaterThan(total - 0.2);
    expect(Number(measured.video.format.duration)).toBeLessThan(total + 0.2);
  });
});
