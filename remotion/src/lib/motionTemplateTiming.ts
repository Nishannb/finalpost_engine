/**
 * WP45 Layer-2 motion-template timing + geometry. PURE (no React, no remotion import) so the server tests can pin it.
 * Grammar: remotion/out/phase36-readiness/motion-template-primitives.yaml (CLIP_01..04 = WP45, CLIP_05..08 = WP46, CLIP_09..12 = WP47, CLIP_13..16 = WP48, CLIP_17..21 = WP50, CLIP_22..26 = WP51). Every template is a TIMELINE of ops
 * (a primitive id, or a named helper op) in BASE seconds; a beat shorter than the template compresses the timeline, a longer one extends the final hold.
 * Forbidden everywhere: motion blur, glow, grain, glitch, opacity cross-fades (reveals are masks / windows / edge wipes; the only hard cut is clip_03's camera_jump_cut).
 */

export type TemplateKey =
  | 'clip_01_grid_morph'
  | 'clip_02_slit_carousel'
  | 'clip_03_bento_camera'
  | 'clip_04_stacked_cards'
  | 'clip_05_config_brand_loop'
  | 'clip_06_blur_word_carousel'
  | 'clip_07_ios_notification'
  | 'clip_08_nested_rect_title'
  | 'clip_09_acme_fruit_swap'
  | 'clip_10_morph_stretch'
  | 'clip_11_menu_slide'
  | 'clip_12_editorial_inset'
  | 'clip_13_heritage_poster'
  | 'clip_14_silk_legacy'
  | 'clip_15_glass_testimonial'
  | 'clip_16_portrait_push'
  | 'clip_17_photo_stack_collapse'
  | 'clip_18_photo_stack_reveal'
  | 'clip_19_two_up_stack'
  | 'clip_20_never_done_slit'
  | 'clip_21_typewriter'
  | 'clip_22_chat_conversation'
  | 'clip_23_sale_promo'
  | 'clip_24_color_word_wheel'
  | 'clip_25_tracking_collapse'
  | 'clip_26_spatial_blur_tilt';

export type TemplateOp = {
  id: string;
  /** The catalog primitive this op is (null for helper ops: logo_fill, hold, contract, settle, exit). */
  primitive: string | null;
  from: number;
  to: number;
};

const op = (id: string, primitive: string | null, from: number, to: number): TemplateOp => ({id, primitive, from, to});

/** CLIP_01: 4.9 s. The 1.8 s payoff hold is the last op and is never shortened by the ops above it. */
export const GRID_MORPH_BASE_SEC = 4.9;
export const GRID_MORPH_TIMELINE: readonly TemplateOp[] = [
  op('tile_wipe_grow', 'tile_wipe_grow', 0, 0.7),
  op('logo_fill', null, 0.5, 1.0),
  op('tile_merge_expand', 'tile_merge_expand', 1.0, 1.6),
  op('color_flood_swap', 'color_flood_swap', 1.5, 2.25),
  op('window_reveal', 'window_reveal', 2.3, 3.1),
  op('hold', null, 3.1, 4.9),
];

/** CLIP_02: 6.97 s, loop friendly (net carousel advance is 0: advance 1 slot, then back). */
export const SLIT_CAROUSEL_BASE_SEC = 6.97;
export const SLIT_CAROUSEL_TIMELINE: readonly TemplateOp[] = [
  op('window_reveal', 'window_reveal', 0, 0.5),
  op('slot_carousel_advance', 'slot_carousel_advance', 0.6, 1.9),
  op('hold', null, 1.9, 2.6),
  op('panel_accordion_expand', 'panel_accordion_expand', 2.6, 3.5),
  op('hold', null, 3.5, 4.4),
  op('accordion_contract', 'panel_accordion_expand', 4.4, 5.3),
  op('slot_carousel_advance_back', 'slot_carousel_advance', 5.4, 6.7),
  op('hold', null, 6.7, 6.97),
];

/** CLIP_03: 5.87 s. creep -> HARD jump cut -> ease zoom in -> hold -> ease zoom out -> settle. */
export const BENTO_CAMERA_BASE_SEC = 5.87;
export const BENTO_CAMERA_TIMELINE: readonly TemplateOp[] = [
  op('camera_creep', 'camera_creep', 0, 1.7),
  op('camera_jump_cut', 'camera_jump_cut', 1.7, 1.7),
  op('camera_ease_zoom', 'camera_ease_zoom', 1.7, 3.1),
  op('hold', null, 3.1, 3.9),
  op('camera_ease_zoom_out', 'camera_ease_zoom', 3.9, 5.2),
  op('settle', null, 5.2, 5.87),
];

/** CLIP_04: 2.32 s, one card swap every 1.03 s (0.38 s transition + 0.65 s hold). The swap repeats for any length. */
export const STACK_BASE_SEC = 2.32;
export const STACK_CYCLE_SEC = 1.03;
export const STACK_TRANSITION_SEC = 0.38;
export const STACK_FIRST_HOLD_SEC = 0.5;
export const STACK_TIMELINE: readonly TemplateOp[] = [
  op('hold', null, 0, STACK_FIRST_HOLD_SEC),
  op('card_stack_advance', 'card_stack_advance', STACK_FIRST_HOLD_SEC, STACK_FIRST_HOLD_SEC + STACK_TRANSITION_SEC),
  op('hold', null, STACK_FIRST_HOLD_SEC + STACK_TRANSITION_SEC, STACK_FIRST_HOLD_SEC + STACK_CYCLE_SEC),
  op('card_stack_advance', 'card_stack_advance', STACK_FIRST_HOLD_SEC + STACK_CYCLE_SEC, STACK_FIRST_HOLD_SEC + STACK_CYCLE_SEC + STACK_TRANSITION_SEC),
  op('hold', null, STACK_FIRST_HOLD_SEC + STACK_CYCLE_SEC + STACK_TRANSITION_SEC, STACK_BASE_SEC),
];

// ---------------------------------------------------------------------------- WP46 timelines (CLIP_05..08)

/** CLIP_05: 7.63 s seamless loop. Hard cut on a 1.5 s grid across 5 scenes; the mask outline morphs around each cut; three stickers live on their own clock. The CONFIG wordmark never animates. */
export const CONFIG_BRAND_LOOP_BASE_SEC = 7.63;
export const CONFIG_CUT_GRID_SEC = 1.5;
export const CONFIG_SCENE_COUNT = 5;
export const CONFIG_MORPH_LEAD_SEC = 0.15;
export const CONFIG_MORPH_SETTLE_SEC = 0.4;
export const CONFIG_STICKER_POP_SEC = 0.8;
export const CONFIG_STICKER_EXIT_SEC = 0.2;
export const CONFIG_STICKER_ROTATE_DEG = 45;
export type ConfigStickerId = 'flower' | 'disc_diamond' | 'ship_tag';
/** Independent lifecycles: each window pops in at `from`, holds, and starts shrinking at `to`. Every sticker is absent at both ends of the loop and absent for a stretch mid-loop. */
export const CONFIG_STICKER_WINDOWS: Readonly<Record<ConfigStickerId, ReadonlyArray<{from: number; to: number}>>> = {
  flower: [{from: 0.2, to: 3.3}, {from: 5.0, to: 7.35}],
  disc_diamond: [{from: 1.0, to: 4.4}, {from: 6.2, to: 7.35}],
  ship_tag: [{from: 0.6, to: 2.6}, {from: 3.9, to: 7.35}],
};
export const CONFIG_BRAND_LOOP_TIMELINE: readonly TemplateOp[] = [
  op('hard_cut_on_grid', 'hard_cut_on_grid', 0, CONFIG_BRAND_LOOP_BASE_SEC),
  op('mask_morph_loop_in', 'mask_morph', 0, CONFIG_MORPH_SETTLE_SEC),
  ...[1, 2, 3, 4].map(j => op(`mask_morph_${j}`, 'mask_morph', j * CONFIG_CUT_GRID_SEC - CONFIG_MORPH_LEAD_SEC, j * CONFIG_CUT_GRID_SEC + CONFIG_MORPH_SETTLE_SEC)),
  op('mask_morph_loop_out', 'mask_morph', CONFIG_BRAND_LOOP_BASE_SEC - CONFIG_MORPH_LEAD_SEC, CONFIG_BRAND_LOOP_BASE_SEC),
  ...(Object.keys(CONFIG_STICKER_WINDOWS) as ConfigStickerId[]).flatMap(id =>
    CONFIG_STICKER_WINDOWS[id].map((win, n) => op(`sticker_${id}_${n + 1}`, 'sticker_pop', win.from, win.to + CONFIG_STICKER_EXIT_SEC)),
  ),
  op('wordmark_static', null, 0, CONFIG_BRAND_LOOP_BASE_SEC),
];

/** CLIP_06: 3.67 s. Lead hold, then four eased one-slot steps on a 0.73 s period (0.42 s move + 0.31 s hold), then the final hold. A longer beat extends the final hold. */
export const BLUR_CAROUSEL_BASE_SEC = 3.67;
export const BLUR_STEP_SEC = 0.73;
export const BLUR_MOVE_SEC = 0.42;
export const BLUR_HOLD_SEC = 0.31;
export const BLUR_LEAD_HOLD_SEC = 0.31;
export const BLUR_MOVES = 4;
const blurMoveStart = (k: number): number => BLUR_LEAD_HOLD_SEC + k * BLUR_STEP_SEC;
export const BLUR_CAROUSEL_TIMELINE: readonly TemplateOp[] = [
  op('lead_hold', null, 0, BLUR_LEAD_HOLD_SEC),
  ...Array.from({length: BLUR_MOVES}, (_, k) => op(`blur_carousel_${k + 1}`, 'blur_carousel', blurMoveStart(k), blurMoveStart(k) + BLUR_MOVE_SEC)),
  op('hold', null, blurMoveStart(BLUR_MOVES - 1) + BLUR_MOVE_SEC, BLUR_CAROUSEL_BASE_SEC),
];

/** CLIP_07: 2.02 s overlay. The banner never moves; only the cursor changes: arrow -> open hand at 0.83 s -> hidden at 1.67 s. No catalog primitive (helper ops only). */
export const IOS_NOTIFICATION_BASE_SEC = 2.02;
export const IOS_HAND_AT_SEC = 0.83;
export const IOS_CURSOR_HIDE_SEC = 1.67;
export const IOS_NOTIFICATION_TIMELINE: readonly TemplateOp[] = [
  op('cursor_arrow', null, 0, IOS_HAND_AT_SEC),
  op('cursor_hand', null, IOS_HAND_AT_SEC, IOS_CURSOR_HIDE_SEC),
  op('hold', null, IOS_CURSOR_HIDE_SEC, IOS_NOTIFICATION_BASE_SEC),
];

/** CLIP_08: 6.15 s. 0.83 s the end-state title is held, then a HARD cut to pale blue and six nested rects grow from the exact centre (ease-in, overlapping), then two parallel typewriter lines at 37 cps, then the hold. */
export const NESTED_RECT_BASE_SEC = 6.15;
export const NESTED_CUT_SEC = 0.83;
export const NESTED_TYPE_START_SEC = 3.95;
export const NESTED_TYPE_CPS = 37;
export const NESTED_DEFAULT_LINES: readonly [string, string] = ['Brand Guideline\u2014Version 0.1', 'Presentation Template'];
export type NestedLayerId = 'navy_arcs' | 'cream' | 'navy_grid' | 'pink' | 'navy_diamonds' | 'photo';
/** Bottom -> top. Each layer starts growing 0.4 s after the previous one (overlap) and takes 0.8 s (the photo 0.9 s). */
export const NESTED_LAYERS: ReadonlyArray<{id: NestedLayerId; from: number; to: number}> = [
  {id: 'navy_arcs', from: 0.95, to: 1.75},
  {id: 'cream', from: 1.35, to: 2.15},
  {id: 'navy_grid', from: 1.75, to: 2.55},
  {id: 'pink', from: 2.15, to: 2.95},
  {id: 'navy_diamonds', from: 2.55, to: 3.35},
  {id: 'photo', from: 2.95, to: 3.85},
];
export const NESTED_RECT_TIMELINE: readonly TemplateOp[] = [
  op('end_state_hold', null, 0, NESTED_CUT_SEC),
  op('cut_to_pale_blue', null, NESTED_CUT_SEC, NESTED_CUT_SEC),
  ...NESTED_LAYERS.map(layer => op(`nested_rect_${layer.id}`, 'nested_rect_wipe', layer.from, layer.to)),
  op('typewriter_line_1', 'typewriter_reveal', NESTED_TYPE_START_SEC, NESTED_TYPE_START_SEC + NESTED_DEFAULT_LINES[0].length / NESTED_TYPE_CPS),
  op('typewriter_line_2', 'typewriter_reveal', NESTED_TYPE_START_SEC, NESTED_TYPE_START_SEC + NESTED_DEFAULT_LINES[1].length / NESTED_TYPE_CPS),
  op('hold', null, NESTED_TYPE_START_SEC + NESTED_DEFAULT_LINES[0].length / NESTED_TYPE_CPS, NESTED_RECT_BASE_SEC),
];

// ---------------------------------------------------------------------------- WP47 timelines (CLIP_09..12 = analysis Part 2 "Clips 5-8", the ACME set)

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** CLIP_09: 3.83 s seamless loop. Five HARD colour-field cuts (burst - rest - emphasis); each scene fixes the word scale; four scenes swap one glyph for a fruit that settles from 1.6x over 0.4 s with a ~15 degree turn. */
export const ACME_BASE_SEC = 3.83;
export const ACME_SCENE_SEC: readonly number[] = [0.43, 0.57, 1.5, 0.9, 0.43];
export const ACME_FRUIT_SETTLE_SEC = 0.4;
export const ACME_FRUIT_FROM_SCALE = 1.6;
export const ACME_FRUIT_ROTATE_DEG = 15;
export const ACME_DEFAULT_WORD = 'ACME';
export type AcmeFruit = 'apple' | 'grapes' | 'banana' | 'peach';
export const ACME_CREAM = '#FCD2AA';
/** Per scene: flat ground, word ink, word width as a fraction of the artboard width, and the fruit + the glyph index it replaces (null = the plain wordmark). */
export const ACME_SCENES: ReadonlyArray<{bg: string; ink: string; scale: number; fruit: AcmeFruit | null; glyph: number | null}> = [
  {bg: '#C1F150', ink: '#000000', scale: 0.58, fruit: 'apple', glyph: 2},
  {bg: '#FA3400', ink: ACME_CREAM, scale: 0.58, fruit: 'grapes', glyph: 3},
  {bg: '#959686', ink: '#000000', scale: 0.22, fruit: null, glyph: null},
  {bg: '#FA3400', ink: ACME_CREAM, scale: 1.2, fruit: 'banana', glyph: 0},
  {bg: '#0E307D', ink: ACME_CREAM, scale: 0.58, fruit: 'peach', glyph: 1},
];
/** Start second of scene `index` (cumulative scene lengths). */
export const acmeSceneStart = (index: number): number => round6(ACME_SCENE_SEC.slice(0, index).reduce((sum, sec) => sum + sec, 0));
export const ACME_BRAND_LOOP_TIMELINE: readonly TemplateOp[] = [
  ...ACME_SCENES.map((_, i) => op(`color_field_cut_${i + 1}`, 'color_field_cut', acmeSceneStart(i), acmeSceneStart(i))),
  ...ACME_SCENES.flatMap((scene, i) => (scene.fruit ? [op(`letter_swap_${scene.fruit}`, 'letter_swap', acmeSceneStart(i), acmeSceneStart(i) + ACME_FRUIT_SETTLE_SEC)] : [])),
];

/** CLIP_10: 2.30 s seamless loop. Bubbly word -> vertical_stretch (0.53 s, 0.45 s long, held) -> HARD cut to the plain sans at 1.37 s -> per-letter font_morph plain -> bubbly from 1.67 s, left to right. */
export const MORPH_BASE_SEC = 2.3;
export const MORPH_DEFAULT_TEXT = 'MORPH';
export const MORPH_COLORS = {cyan: '#00B1FC', ground: '#11102A'} as const;
export const MORPH_STRETCH_FROM_SEC = 0.53;
export const MORPH_STRETCH_SEC = 0.45;
export const MORPH_CUT_SEC = 1.37;
export const MORPH_LETTER_FROM_SEC = 1.67;
export const MORPH_LETTER_SEC = 0.18;
export const MORPH_LETTER_STAGGER_SEC = 0.17;
export const MORPH_STRETCH_X = 1.8;
export const MORPH_STRETCH_Y = 3.8;
/** Word width as a fraction of the 16:10 artboard width. */
export const MORPH_WIDTH = {bubbly: 0.53, plain: 0.25} as const;
/** The nominal 0.17 s stagger, tightened only as far as needed so that EVERY letter finishes its morph before the loop point. */
export const morphLetterStagger = (count: number): number => (count <= 1 ? 0 : Math.min(MORPH_LETTER_STAGGER_SEC, (MORPH_BASE_SEC - MORPH_LETTER_FROM_SEC - MORPH_LETTER_SEC) / (count - 1)));
export const MORPH_STRETCH_TO_SEC = round6(MORPH_STRETCH_FROM_SEC + MORPH_STRETCH_SEC);
export const MORPH_FONT_TIMELINE: readonly TemplateOp[] = [
  op('hold', null, 0, MORPH_STRETCH_FROM_SEC),
  op('vertical_stretch', 'vertical_stretch', MORPH_STRETCH_FROM_SEC, MORPH_STRETCH_TO_SEC),
  op('stretch_hold', null, MORPH_STRETCH_TO_SEC, MORPH_CUT_SEC),
  op('cut_to_plain', null, MORPH_CUT_SEC, MORPH_CUT_SEC),
  op('plain_hold', null, MORPH_CUT_SEC, MORPH_LETTER_FROM_SEC),
  ...Array.from({length: MORPH_DEFAULT_TEXT.length}, (_, i) =>
    op(`font_morph_${i + 1}`, 'font_morph', round6(MORPH_LETTER_FROM_SEC + i * morphLetterStagger(MORPH_DEFAULT_TEXT.length)), round6(MORPH_LETTER_FROM_SEC + i * morphLetterStagger(MORPH_DEFAULT_TEXT.length) + MORPH_LETTER_SEC)),
  ),
];

/** CLIP_11: 6.80 s seamless-ish loop, four poster slides on a 1.70 s beat (0.85 s slide + 0.85 s hold). The clip opens MID-slide of the first item (the loop point is a hard cut from the resting end card into it). */
export const MENU_BASE_SEC = 6.8;
export const MENU_PERIOD_SEC = 1.7;
export const MENU_SLIDE_SEC = 0.85;
export const MENU_SLIDE_COUNT = 4;
/** The main move is 0.6 s of the 0.85 s slide; the last 0.25 s is the slight settle. */
export const MENU_MAIN_SEC = 0.6;
export const MENU_SETTLE_AMOUNT = 0.03;
/** Slide progress (0..1) of the first item at t = 0: the loop re-enters mid-slide. */
export const MENU_ENTRY_PROGRESS = 0.35;
export const MENU_PHOTO_LEAD_SEC = 0.1;
export const MENU_LINE2_LAG_SEC = 0.08;
export const MENU_COLORS = {ground: '#0A1186', ink: '#FFFFFF'} as const;
export const MENU_FOOTER = {baseline: 0.93, size: 0.026, left: ['WEEKDAY 7AM-3PM', 'WEEKEND 8AM-4PM'], right: ['123 MAIN', 'STREET']} as const;
export type MenuStandIn = 'club' | 'greens' | 'grill' | 'none';
export const MENU_DEFAULT_SLIDES: ReadonlyArray<{headline: readonly [string, string]; standIn: MenuStandIn}> = [
  {headline: ['BACON', 'CLUB'], standIn: 'club'},
  {headline: ['HAM &', 'GREENS'], standIn: 'greens'},
  {headline: ['GRILL', 'CHEESE'], standIn: 'grill'},
  {headline: ['ACME', 'BAKERY'], standIn: 'none'},
];
/** Start second of slide `k`'s move (the first starts before 0: the clip opens mid-slide). */
export const menuSlideStart = (k: number): number => round6(k * MENU_PERIOD_SEC - MENU_ENTRY_PROGRESS * MENU_SLIDE_SEC);
export const MENU_SLIDE_TIMELINE: readonly TemplateOp[] = [
  ...Array.from({length: MENU_SLIDE_COUNT}, (_, k) => op(`slide_${k + 1}`, 'slide_carousel', Math.max(0, menuSlideStart(k)), round6(menuSlideStart(k) + MENU_SLIDE_SEC))),
  op('footer_static', 'microtext_frame', 0, MENU_BASE_SEC),
  op('hold', null, round6(menuSlideStart(MENU_SLIDE_COUNT - 1) + MENU_SLIDE_SEC), MENU_BASE_SEC),
];

/** CLIP_12: 5.30 s seamless loop on white. Inset photo -> grows to full bleed under fixed text (text auto-contrasts) -> HARD cut to white at 3.20 s -> headline lines reveal through a horizontal mask (0.10 s stagger, 0.35 s each) -> hold -> AC | ME split and the photo returns from a dot to the inset. */
export const EDITORIAL_BASE_SEC = 5.3;
export const EDITORIAL_COLORS = {ground: '#FDFDFD', ink: '#0B0B0B', onPhoto: '#FFFFFF'} as const;
export const EDITORIAL_DEFAULT_LINES: readonly string[] = ['Ancient', 'Heritage', 'Modern', 'Elegance'];
export const EDITORIAL_GROW_FROM_SEC = 0.4;
export const EDITORIAL_GROW_SEC = 0.9;
export const EDITORIAL_SETTLE_END_SEC = 1.95;
export const EDITORIAL_CUT_SEC = 3.2;
export const EDITORIAL_LINE_STAGGER_SEC = 0.1;
export const EDITORIAL_LINE_SEC = 0.35;
export const EDITORIAL_LINE_EXIT_SEC = 0.25;
export const EDITORIAL_SPLIT_FROM_SEC = 4.35;
export const EDITORIAL_SPLIT_SEC = 0.85;
/** Rects are fractions of the 4:5 artboard (centre-based inset). */
export type NormRect = {x: number; y: number; w: number; h: number};
export const EDITORIAL_INSET_SIZE = {w: 0.2, h: 0.32} as const;
export const EDITORIAL_MICRO = {top: ['PARIS | MILAN', 'ACME', 'EST.1992'], bottom: 'FW25'} as const;
const editorialLineFrom = (i: number): number => round6(EDITORIAL_CUT_SEC + i * EDITORIAL_LINE_STAGGER_SEC);
export const EDITORIAL_INSET_TIMELINE: readonly TemplateOp[] = [
  op('inset_hold', null, 0, EDITORIAL_GROW_FROM_SEC),
  op('photo_grow', 'inset_to_fullbleed', EDITORIAL_GROW_FROM_SEC, round6(EDITORIAL_GROW_FROM_SEC + EDITORIAL_GROW_SEC)),
  op('photo_settle', null, round6(EDITORIAL_GROW_FROM_SEC + EDITORIAL_GROW_SEC), EDITORIAL_SETTLE_END_SEC),
  op('fullbleed_hold', null, EDITORIAL_SETTLE_END_SEC, EDITORIAL_CUT_SEC),
  op('cut_to_white', null, EDITORIAL_CUT_SEC, EDITORIAL_CUT_SEC),
  ...EDITORIAL_DEFAULT_LINES.map((_, i) => op(`line_mask_reveal_${i + 1}`, 'line_mask_reveal', editorialLineFrom(i), round6(editorialLineFrom(i) + EDITORIAL_LINE_SEC))),
  op('text_hold', null, round6(editorialLineFrom(EDITORIAL_DEFAULT_LINES.length - 1) + EDITORIAL_LINE_SEC), EDITORIAL_SPLIT_FROM_SEC),
  op('line_mask_exit', 'line_mask_reveal', EDITORIAL_SPLIT_FROM_SEC, round6(EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_LINE_EXIT_SEC)),
  op('split_and_photo_return', 'inset_to_fullbleed', EDITORIAL_SPLIT_FROM_SEC, round6(EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_SPLIT_SEC)),
  op('microtext_static', 'microtext_frame', 0, EDITORIAL_BASE_SEC),
  op('hold', null, round6(EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_SPLIT_SEC), EDITORIAL_BASE_SEC),
];

// ---------------------------------------------------------------------------- WP48 timelines (CLIP_13..16 / layout C1-C4)

/**
 * CLIP_13 (C1): 6.90 s loop on white.
 * Capture note: the offline recording often started mid-loop on the finished poster; the LIVE beat MUST open on the full-bleed / zoom-out (photo + micro only), then markers, then headline — the finished poster is the END hold.
 * Demo micro (PARIS|MILAN / ACME / …) is proof-shell only; live polish binds video copy and sets hideMicro.
 */
export const HERITAGE_BASE_SEC = 6.9;
export const HERITAGE_COLORS = {ground: '#FFFFFF', ink: '#0B0B0B', onPhoto: '#FFFFFF'} as const;
export const HERITAGE_DEFAULT_LINES: readonly string[] = ['WHERE', 'HERITAGE', '&', 'DEVOTION', 'MEETS', 'ELEGANCE'];
export const HERITAGE_DEFAULT_MARK = 'A°';
export const HERITAGE_MICRO = {top: ['PARIS | MILAN', 'ACME', 'EST. 1999'], bottom: 'PR23'} as const;
/** t=0 opens on full-bleed (no headline); shrink → markers → lines → marquee → long poster hold → hard cut back to full-bleed. */
export const HERITAGE_FLASH_SEC = 0.25;
export const HERITAGE_SHRINK_FROM_SEC = 0.25;
export const HERITAGE_SHRINK_TO_SEC = 0.65;
export const HERITAGE_CONVERGE_TO_SEC = 1.15;
export const HERITAGE_LINES_FROM_SEC = 1.15;
export const HERITAGE_LINE_STAGGER_SEC = 0.07;
export const HERITAGE_LINE_SEC = 0.4;
export const HERITAGE_HOLD_FROM_SEC = 2.05;
export const HERITAGE_MARQUEE_FROM_SEC = 2.65;
export const HERITAGE_MARQUEE_TO_SEC = 3.05;
export const HERITAGE_LOOP_CUT_SEC = 6.65;
export const HERITAGE_LOOP_FLASH_SEC = 0.25;
/** @deprecated use HERITAGE_FLASH_SEC; kept as alias so older pins compile during the shift. */
export const HERITAGE_CUT_SEC = HERITAGE_FLASH_SEC;
/** The thumb: 25% of the artboard width, 3:4, centred 40% from the top. */
export const HERITAGE_THUMB_W = 0.25;
const heritageLineFrom = (i: number): number => round6(HERITAGE_LINES_FROM_SEC + i * HERITAGE_LINE_STAGGER_SEC);
export const HERITAGE_POSTER_TIMELINE: readonly TemplateOp[] = [
  op('cut_fullbleed', 'hard_cut_fullbleed', 0, HERITAGE_SHRINK_FROM_SEC),
  op('photo_shrink', 'scale_thumb_expand', HERITAGE_SHRINK_FROM_SEC, HERITAGE_SHRINK_TO_SEC),
  op('corner_marker_converge', 'corner_marker_converge', HERITAGE_SHRINK_TO_SEC, HERITAGE_CONVERGE_TO_SEC),
  ...HERITAGE_DEFAULT_LINES.map((_, i) => op(`line_mask_reveal_${i + 1}`, 'line_mask_reveal', heritageLineFrom(i), round6(heritageLineFrom(i) + HERITAGE_LINE_SEC))),
  op('text_hold', null, HERITAGE_HOLD_FROM_SEC, HERITAGE_MARQUEE_FROM_SEC),
  op('text_marquee_y', 'text_marquee_y', HERITAGE_MARQUEE_FROM_SEC, HERITAGE_MARQUEE_TO_SEC),
  op('poster_hold', null, HERITAGE_MARQUEE_TO_SEC, HERITAGE_LOOP_CUT_SEC),
  op('loop_cut_fullbleed', 'hard_cut_fullbleed', HERITAGE_LOOP_CUT_SEC, HERITAGE_BASE_SEC),
  op('microtext_static', 'microtext_frame', 0, HERITAGE_BASE_SEC),
];

/** CLIP_14 (C2): 3.05 s seamless loop on white. Thumb between headline and body -> expo-out to cover (4% white inset) while the type clears -> giant wordmark behind the subject -> HARD cut -> blank white beat (micro only) -> thumb + body return and the 3 lines rise (== t 0). */
export const SILK_BASE_SEC = 3.05;
export const SILK_COLORS = {ground: '#FFFFFF', ink: '#0B0B0B', onPhoto: '#FFFFFF'} as const;
export const SILK_DEFAULT_LINES: readonly string[] = ['SINCE—1972', 'A LEGACY', 'WOVEN IN SILK'];
export const SILK_DEFAULT_WORDMARK = 'ACME';
export const SILK_DEFAULT_BODY: readonly string[] = ['FIVE GENERATIONS OF WEAVERS,', 'ONE UNBROKEN THREAD OF SILK'];
export const SILK_MICRO = {top: ['PARIS | MILAN', 'ACME', 'EST. 1972']} as const;
export const SILK_GROW_FROM_SEC = 1.0;
export const SILK_GROW_TO_SEC = 1.9;
export const SILK_CLEAR_SEC = 0.3;
export const SILK_WORDMARK_FROM_SEC = 1.2;
export const SILK_WORDMARK_REVEAL_SEC = 0.5;
export const SILK_BLANK_FROM_SEC = 2.3;
export const SILK_BLANK_TO_SEC = 2.6;
export const SILK_LINES_FROM_SEC = 2.6;
export const SILK_LINE_STAGGER_SEC = 0.09;
export const SILK_LINE_SEC = 0.27;
/** The thumb: 18% of the artboard width, 3:4, centred at the artboard middle; the cover keeps a 4% (of width) white inset. */
export const SILK_THUMB_W = 0.18;
export const SILK_COVER_INSET = 0.04;
const silkLineFrom = (i: number): number => round6(SILK_LINES_FROM_SEC + i * SILK_LINE_STAGGER_SEC);
export const SILK_COVER_TIMELINE: readonly TemplateOp[] = [
  op('poster_hold', null, 0, SILK_GROW_FROM_SEC),
  op('photo_grow', 'scale_thumb_expand', SILK_GROW_FROM_SEC, SILK_GROW_TO_SEC),
  op('wordmark_behind_subject', 'text_behind_subject', SILK_WORDMARK_FROM_SEC, SILK_BLANK_FROM_SEC),
  op('cover_hold', null, SILK_GROW_TO_SEC, SILK_BLANK_FROM_SEC),
  op('cut_to_blank', 'hard_cut_fullbleed', SILK_BLANK_FROM_SEC, SILK_BLANK_FROM_SEC),
  op('blank_beat_white', 'blank_beat_white', SILK_BLANK_FROM_SEC, SILK_BLANK_TO_SEC),
  ...SILK_DEFAULT_LINES.map((_, i) => op(`line_mask_reveal_${i + 1}`, 'line_mask_reveal', silkLineFrom(i), round6(silkLineFrom(i) + SILK_LINE_SEC))),
  op('microtext_static', 'microtext_frame', 0, SILK_BASE_SEC),
];

/**
 * CLIP_15 (C3): 3.93 s loop.
 * Capture note: the offline recording often opened on the finished readable card; the LIVE beat MUST open mid-morph (frosted card, content blurred, no icons) and only land the readable testimonial at the END hold.
 * Demo Mango / quote / author are proof-shell only; live polish binds video copy.
 */
export const GLASS_BASE_SEC = 3.93;
export const GLASS_SNAP_SEC = 0.15;
export const GLASS_SETTLE_SEC = 0.4;
export const GLASS_BLUR_IN_SEC = 0.5;
export const GLASS_ICON_FADE_SEC = 0.2;
export const GLASS_SNAP_SCALE = 2;
export const GLASS_BLUR_PX = 12;
export const GLASS_BACKDROP_BLUR_PX = 24;
/** Card rect (fractions of the 16:10 frame) and corner radius (fraction of the card height). */
export const GLASS_CARD_RECT = {x: 0.1, y: 0.38, w: 0.5, h: 0.37} as const;
export const GLASS_CARD_RADIUS = 0.14;
export const GLASS_DEFAULT_WORDMARK = 'Mango';
export const GLASS_DEFAULT_QUOTE = 'Absolutely love how it feels. Worth every single moment.';
export const GLASS_DEFAULT_AUTHOR = 'Mara Ellis';
export const GLASS_DEFAULT_ROLE = 'Creative Director';
/** Snap starts at t=0 (no opening readable hold). */
export const GLASS_SNAP_FROM_SEC = 0;
const GLASS_SNAP_TO_SEC = round6(GLASS_SNAP_FROM_SEC + GLASS_SNAP_SEC);
const GLASS_SETTLE_TO_SEC = round6(GLASS_SNAP_TO_SEC + GLASS_SETTLE_SEC);
const GLASS_BLUR_IN_TO_SEC = round6(GLASS_SETTLE_TO_SEC + GLASS_BLUR_IN_SEC);
export const GLASS_ICON_FROM_SEC = GLASS_BLUR_IN_TO_SEC;
export const GLASS_ICON_TO_SEC = round6(GLASS_ICON_FROM_SEC + GLASS_ICON_FADE_SEC);
/** @deprecated opening readable hold removed; alias kept for older call sites. */
export const GLASS_HOLD_SEC = 0;
export const GLASS_TESTIMONIAL_TIMELINE: readonly TemplateOp[] = [
  op('scale_snap', 'glass_card_morph', GLASS_SNAP_FROM_SEC, GLASS_SNAP_TO_SEC),
  op('settle', 'glass_card_morph', GLASS_SNAP_TO_SEC, GLASS_SETTLE_TO_SEC),
  op('blur_in_text', 'glass_card_morph', GLASS_SETTLE_TO_SEC, GLASS_BLUR_IN_TO_SEC),
  op('icons_fade', 'glass_card_morph', GLASS_ICON_FROM_SEC, GLASS_ICON_TO_SEC),
  op('hold_readable', null, GLASS_ICON_TO_SEC, GLASS_BASE_SEC),
];

/** CLIP_16 (C4): 4.35 s loop on white. Hold A (1.5% micro zoom) -> push up to B (1.0 s) -> hold B -> push up to C (1.05 s) -> hard wrap to A. */
export const PUSH_BASE_SEC = 4.35;
export const PUSH_HOLD_A_SEC = 0.9;
export const PUSH_MOVE_1_SEC = 1.0;
export const PUSH_HOLD_B_SEC = 1.3;
export const PUSH_MOVE_2_SEC = 1.05;
export const PUSH_GAP = 0.075;
export const PUSH_OUT_SCALE = 0.94;
export const PUSH_IN_SCALE_FROM = 0.9;
export const PUSH_MICRO_ZOOM = 0.015;
export const PUSH_COUNT = 3;
/** Card size as fractions of the 4:5 artboard (white border all round). */
export const PUSH_CARD = {w: 0.86, h: 0.88} as const;
export const PUSH_COLORS = {ground: '#FFFFFF'} as const;
export const PUSH_STILL_TONES: ReadonlyArray<{ground: string; figure: string; sun: string}> = [
  {ground: '#B7BCC4', figure: '#2A2E35', sun: '#E9EDF2'},
  {ground: '#1F7A7A', figure: '#0B2B2E', sun: '#9FE0D8'},
  {ground: '#0B0B16', figure: '#1B1236', sun: '#C6FF3D'},
];
const PUSH_MOVE_1_FROM_SEC = PUSH_HOLD_A_SEC;
const PUSH_MOVE_1_TO_SEC = round6(PUSH_MOVE_1_FROM_SEC + PUSH_MOVE_1_SEC);
const PUSH_MOVE_2_FROM_SEC = round6(PUSH_MOVE_1_TO_SEC + PUSH_HOLD_B_SEC);
const PUSH_MOVE_2_TO_SEC = round6(PUSH_MOVE_2_FROM_SEC + PUSH_MOVE_2_SEC);
export const PORTRAIT_PUSH_TIMELINE: readonly TemplateOp[] = [
  op('hold_a', null, 0, PUSH_MOVE_1_FROM_SEC),
  op('push_a_to_b', 'vertical_push', PUSH_MOVE_1_FROM_SEC, PUSH_MOVE_1_TO_SEC),
  op('hold_b', null, PUSH_MOVE_1_TO_SEC, PUSH_MOVE_2_FROM_SEC),
  op('push_b_to_c', 'vertical_push', PUSH_MOVE_2_FROM_SEC, PUSH_MOVE_2_TO_SEC),
  op('hold_c', null, PUSH_MOVE_2_TO_SEC, PUSH_BASE_SEC),
];

// ---------------------------------------------------------------------------- WP50 timelines (CLIP_17..21 = analysis Part 4 "capture clips 13-17")

/** CLIP_17: 1.37 s, #FDFDFD, 9:16. Hold, then stack_collapse_y: each rectangular photo's visible height closes to a hairline through a clip mask (ease-in, content ANCHORED - never scaled), near-blank. */
export const STACK_COLLAPSE_BASE_SEC = 1.37;
export const STACK_COLLAPSE_FROM_SEC = 0.87;
export const STACK_COLLAPSE_TO_SEC = 1.33;
export const STACK_COLLAPSE_END_HEIGHT = 0.005;
export const PHOTO_STACK_COLORS = {ground: '#FDFDFD'} as const;
export const PHOTO_STACK_TONES: ReadonlyArray<{ground: string; figure: string; sun: string}> = [
  {ground: '#F4A6C0', figure: '#7A2E4D', sun: '#FFE3EC'},
  {ground: '#9DB8F2', figure: '#1C2F6B', sun: '#EAF0FF'},
  {ground: '#F2C48D', figure: '#6B3A12', sun: '#FFF1DC'},
];
/** Normalised to the full 9:16 frame: hero photo full width on top, a narrower card centred below (gutter ~10% H). */
export const STACK_COLLAPSE_RECTS: readonly NormRect[] = [
  {x: 0, y: 0, w: 1, h: 0.5},
  {x: 0.17, y: 0.61, w: 0.66, h: 0.29},
];
export const STACK_COLLAPSE_TIMELINE: readonly TemplateOp[] = [
  op('hold', null, 0, STACK_COLLAPSE_FROM_SEC),
  op('stack_collapse_y', 'stack_collapse_y', STACK_COLLAPSE_FROM_SEC, STACK_COLLAPSE_TO_SEC),
  op('near_blank', null, STACK_COLLAPSE_TO_SEC, STACK_COLLAPSE_BASE_SEC),
];

/** CLIP_18: 2.42 s. Starts blank (no payoff flash), then mask_reveal_y (top-anchored, ease-out, stagger 0 / 0 / 0.15 s), then hold the revealed stack. */
export const STACK_REVEAL_BASE_SEC = 2.42;
export const STACK_REVEAL_BLANK_TO_SEC = 0.3;
export const STACK_REVEAL_ITEM_SEC = 0.5;
export const STACK_REVEAL_STAGGER_SEC: readonly number[] = [0, 0, 0.15];
export const STACK_REVEAL_HOLD_FROM_SEC = round6(STACK_REVEAL_BLANK_TO_SEC + 0.15 + STACK_REVEAL_ITEM_SEC);
export const STACK_REVEAL_RECTS: readonly NormRect[] = [
  {x: 0.14, y: 0.12, w: 0.72, h: 0.23},
  {x: 0.14, y: 0.39, w: 0.72, h: 0.23},
  {x: 0.14, y: 0.66, w: 0.72, h: 0.23},
];
export const STACK_REVEAL_TIMELINE: readonly TemplateOp[] = [
  op('blank_beat_white', 'blank_beat_white', 0, STACK_REVEAL_BLANK_TO_SEC),
  ...STACK_REVEAL_STAGGER_SEC.map((stagger, i) => op(`mask_reveal_y_${i + 1}`, 'mask_reveal_y', round6(STACK_REVEAL_BLANK_TO_SEC + stagger), round6(STACK_REVEAL_BLANK_TO_SEC + stagger + STACK_REVEAL_ITEM_SEC))),
  op('hold_end', null, STACK_REVEAL_HOLD_FROM_SEC, STACK_REVEAL_BASE_SEC),
];

/** CLIP_19: two_up_stack_inset. Hold two inset cards, then slide_apart_x on exit (top left / bottom right). */
export const TWO_UP_BASE_SEC = 2.0;
export const TWO_UP_EXIT_FROM_SEC = 1.5;
export const TWO_UP_EXIT_TO_SEC = 2.0;
export const TWO_UP_RECTS: readonly NormRect[] = [
  {x: 0.05, y: 0.03, w: 0.9, h: 0.455},
  {x: 0.05, y: 0.515, w: 0.9, h: 0.455},
];
export const TWO_UP_TIMELINE: readonly TemplateOp[] = [
  op('hold', null, 0, TWO_UP_EXIT_FROM_SEC),
  op('slide_apart_x', 'slide_apart_x', TWO_UP_EXIT_FROM_SEC, TWO_UP_EXIT_TO_SEC),
];

/** CLIP_20: 2.38 s, #000000, 4:5. Starts on black (no payoff flash) -> centred block pops in pairs -> hold -> slit opens between lines 2/3 into state A, then holds the payoff. */
export const NEVER_DONE_BASE_SEC = 2.38;
export const NEVER_DONE_BLACK_TO_SEC = 0.14;
export const NEVER_DONE_POP_FROM_SEC = 0.14;
export const NEVER_DONE_POP_SEC = 0.08;
export const NEVER_DONE_POP_STAGGER_SEC = 0.08;
export const NEVER_DONE_POP_TO_SEC = 0.3;
export const NEVER_DONE_SLIT_FROM_SEC = 0.92;
export const NEVER_DONE_STATE_A_FROM_SEC = 1.35;
export const NEVER_DONE_COLORS = {ground: '#000000', ink: '#F2F2F2'} as const;
export const NEVER_DONE_DEFAULT_LINES: readonly [string, string, string, string] = ['We', 'are', 'never', 'done.'];
export const NEVER_DONE_DEFAULT_WORDMARK = 'acme™';
/** Headline line centres (fractions of the artboard height): spread in state A, a tight centred block while on black. */
export const NEVER_DONE_Y_SPREAD: readonly number[] = [0.09, 0.21, 0.79, 0.91];
export const NEVER_DONE_Y_BLOCK: readonly number[] = [0.32, 0.44, 0.56, 0.68];
export const NEVER_DONE_TIMELINE: readonly TemplateOp[] = [
  op('black_frame_reset', 'black_frame_reset', 0, NEVER_DONE_BLACK_TO_SEC),
  op('line_mask_reveal_1', 'line_mask_reveal', NEVER_DONE_POP_FROM_SEC, round6(NEVER_DONE_POP_FROM_SEC + NEVER_DONE_POP_SEC)),
  op('line_mask_reveal_2', 'line_mask_reveal', round6(NEVER_DONE_POP_FROM_SEC + NEVER_DONE_POP_STAGGER_SEC), NEVER_DONE_POP_TO_SEC),
  op('block_hold', null, NEVER_DONE_POP_TO_SEC, NEVER_DONE_SLIT_FROM_SEC),
  op('slit_reveal', 'slit_reveal', NEVER_DONE_SLIT_FROM_SEC, NEVER_DONE_STATE_A_FROM_SEC),
  op('state_a_hold', null, NEVER_DONE_STATE_A_FROM_SEC, NEVER_DONE_BASE_SEC),
];

/** CLIP_21: 5.03 s typewriter poster (lines are placeholders; demo copy only in the proof shell). Type with caret; bar tracks line 1 then widens; block rises; replaceable mark fades in / rotates / fill→outline. */
export const TYPEWRITER_BASE_SEC = 5.03;
export const TYPEWRITER_COLORS = {ground: '#003BD6', ink: '#B1DDFF'} as const;
export const TYPEWRITER_DEFAULT_LINES: readonly string[] = ['Title', 'Subtitle here', '◔ Details'];
/** Per line: type start (s) and the cps the capture used; a longer live line speeds up so it still lands in the same window (`typewriterCps`). */
export const TYPEWRITER_LINE_START_SEC: readonly number[] = [0.23, 1.33, 2.0];
export const TYPEWRITER_LINE_CPS: readonly number[] = [10, 20, 14];
export const TYPEWRITER_LINE_WINDOW_SEC: readonly number[] = [1.0, 0.65, 0.57];
export const TYPEWRITER_BAR_EXPAND_FROM_SEC = 1.33;
export const TYPEWRITER_BAR_EXPAND_TO_SEC = 1.83;
export const TYPEWRITER_BAR_FULL_W = 0.93;
export const TYPEWRITER_BLOCK_FROM_SEC = 1.33;
export const TYPEWRITER_BLOCK_TO_SEC = 3.0;
export const TYPEWRITER_BLOCK_Y_FROM = 0.49;
export const TYPEWRITER_BLOCK_Y_TO = 0.07;
export const TYPEWRITER_MARK_IN_FROM_SEC = 1.83;
export const TYPEWRITER_MARK_IN_TO_SEC = 2.4;
export const TYPEWRITER_MARK_OUTLINE_FROM_SEC = 4.17;
export const TYPEWRITER_MARK_OUTLINE_TO_SEC = 4.67;
export const TYPEWRITER_TIMELINE: readonly TemplateOp[] = [
  op('typewriter_line_1', 'typewriter_with_caret', TYPEWRITER_LINE_START_SEC[0]!, round6(TYPEWRITER_LINE_START_SEC[0]! + TYPEWRITER_LINE_WINDOW_SEC[0]!)),
  op('typewriter_line_2', 'typewriter_with_caret', TYPEWRITER_LINE_START_SEC[1]!, round6(TYPEWRITER_LINE_START_SEC[1]! + TYPEWRITER_LINE_WINDOW_SEC[1]!)),
  op('typewriter_line_3', 'typewriter_with_caret', TYPEWRITER_LINE_START_SEC[2]!, round6(TYPEWRITER_LINE_START_SEC[2]! + TYPEWRITER_LINE_WINDOW_SEC[2]!)),
  op('block_rise', null, TYPEWRITER_BLOCK_FROM_SEC, TYPEWRITER_BLOCK_TO_SEC),
  op('mark_fade_in', 'tone_on_tone_3d', TYPEWRITER_MARK_IN_FROM_SEC, TYPEWRITER_MARK_IN_TO_SEC),
  op('mark_rotate', 'tone_on_tone_3d', TYPEWRITER_MARK_IN_TO_SEC, TYPEWRITER_MARK_OUTLINE_FROM_SEC),
  op('mark_fill_to_outline', 'tone_on_tone_3d', TYPEWRITER_MARK_OUTLINE_FROM_SEC, TYPEWRITER_MARK_OUTLINE_TO_SEC),
  op('hold', null, TYPEWRITER_MARK_OUTLINE_TO_SEC, TYPEWRITER_BASE_SEC),
];

/** @deprecated Prefer TYPEWRITER_* — kept as aliases while older proofs settle. */
export const LIVESTREAM_BASE_SEC = TYPEWRITER_BASE_SEC;
export const LIVESTREAM_COLORS = TYPEWRITER_COLORS;
export const LIVESTREAM_DEFAULT_LINES = TYPEWRITER_DEFAULT_LINES;
export const LIVESTREAM_LINE_START_SEC = TYPEWRITER_LINE_START_SEC;
export const LIVESTREAM_LINE_CPS = TYPEWRITER_LINE_CPS;
export const LIVESTREAM_LINE_WINDOW_SEC = TYPEWRITER_LINE_WINDOW_SEC;
export const LIVESTREAM_BAR_EXPAND_FROM_SEC = TYPEWRITER_BAR_EXPAND_FROM_SEC;
export const LIVESTREAM_BAR_EXPAND_TO_SEC = TYPEWRITER_BAR_EXPAND_TO_SEC;
export const LIVESTREAM_BAR_FULL_W = TYPEWRITER_BAR_FULL_W;
export const LIVESTREAM_BLOCK_FROM_SEC = TYPEWRITER_BLOCK_FROM_SEC;
export const LIVESTREAM_BLOCK_TO_SEC = TYPEWRITER_BLOCK_TO_SEC;
export const LIVESTREAM_BLOCK_Y_FROM = TYPEWRITER_BLOCK_Y_FROM;
export const LIVESTREAM_BLOCK_Y_TO = TYPEWRITER_BLOCK_Y_TO;
export const LIVESTREAM_MARK_IN_FROM_SEC = TYPEWRITER_MARK_IN_FROM_SEC;
export const LIVESTREAM_MARK_IN_TO_SEC = TYPEWRITER_MARK_IN_TO_SEC;
export const LIVESTREAM_MARK_OUTLINE_FROM_SEC = TYPEWRITER_MARK_OUTLINE_FROM_SEC;
export const LIVESTREAM_MARK_OUTLINE_TO_SEC = TYPEWRITER_MARK_OUTLINE_TO_SEC;
export const LIVESTREAM_TIMELINE = TYPEWRITER_TIMELINE;

// ---------------------------------------------------------------------------- WP51 timelines (CLIP_22..26 = Batch B screen-recording templates B1..B5)

/** CLIP_22 (B1): 10.25 s loop. Message cycle = typing indicator (1.2 s, 3-dot pulse 0.5 s) -> empty pill 0.1 s -> expand 0.25 s expo-out -> word_rise_reveal (125 ms/word, 5 px rise, 160 ms fade). The bubble is at its FINAL blank size before the first word (no reflow). */
export const CHAT_BASE_SEC = 10.25;
export const CHAT_CYCLE_START_SEC: readonly number[] = [0, 2.4, 5.6, 8.6];
export const CHAT_INDICATOR_SEC = 1.2;
export const CHAT_DOT_PULSE_SEC = 0.5;
export const CHAT_PILL_HOLD_SEC = 0.1;
export const CHAT_EXPAND_SEC = 0.25;
export const CHAT_WORD_SEC = 0.125;
export const CHAT_WORD_FADE_SEC = 0.16;
export const CHAT_WORD_RISE_PX = 5;
export type ChatSide = 'left' | 'right';
export type ChatMessage = {side: ChatSide; text: string; indicatorOnly?: boolean};
/** Demo shell (proof only): the first message is preexisting at t=0; the rest play one per cycle slot. The last is indicator-only (the loop tail). */
export const CHAT_DEMO_MESSAGES: readonly ChatMessage[] = [
  {side: 'left', text: "Hey, what's up?"},
  {side: 'right', text: 'Just finished the new motion pack. Want a look?'},
  {side: 'left', text: 'Yes please, send it over.'},
  {side: 'right', text: 'Sent. Tell me what you think!'},
  {side: 'left', text: '', indicatorOnly: true},
];
export const CHAT_COLORS = {ground: '#FDFDFD', grey: '#D9D9D9', greyInk: '#333333', blue: '#1A73F5', blueInk: '#FFFFFF'} as const;
export const CHAT_MAX_WIDTH = {left: 0.48, right: 0.58} as const;
export const CHAT_SIDE_INSET = 0.03;
export const CHAT_MAX_CYCLES = CHAT_CYCLE_START_SEC.length;
const chatCycleEnd = (index: number): number => (index === CHAT_MAX_CYCLES - 1 ? CHAT_BASE_SEC : round6(CHAT_CYCLE_START_SEC[index]! + CHAT_INDICATOR_SEC));
export const CHAT_CONVERSATION_TIMELINE: readonly TemplateOp[] = [
  ...CHAT_CYCLE_START_SEC.map((from, k) => op(`typing_indicator_${k + 1}`, 'typing_indicator', from, chatCycleEnd(k))),
  ...CHAT_CYCLE_START_SEC.slice(0, 3).map((from, k) => op(`bubble_expand_${k + 1}`, null, round6(from + CHAT_INDICATOR_SEC + CHAT_PILL_HOLD_SEC), round6(from + CHAT_INDICATOR_SEC + CHAT_PILL_HOLD_SEC + CHAT_EXPAND_SEC))),
  ...CHAT_CYCLE_START_SEC.slice(0, 3).map((from, k) => op(`word_rise_${k + 1}`, 'word_rise_reveal', round6(from + CHAT_INDICATOR_SEC + CHAT_PILL_HOLD_SEC + CHAT_EXPAND_SEC), round6(from + CHAT_INDICATOR_SEC + CHAT_PILL_HOLD_SEC + CHAT_EXPAND_SEC + 8 * CHAT_WORD_SEC))),
];

/** CLIP_23 (B2): 2.87 s, non-loop. Title card 0-0.32 -> HARD cut to the plate; clock ring docks (expo-out ~1 s from 0.32); two masked slide-ups; glass CTA pill fade+scale; footer micro from 0.32 (hidden when personalized). */
export const SALE_BASE_SEC = 2.87;
export const SALE_CUT_SEC = 0.32;
export const SALE_DOCK_FROM_SEC = 0.32;
export const SALE_DOCK_TO_SEC = 1.32;
export const SALE_LINE2_FROM_SEC = 1.45;
export const SALE_LINE1_FROM_SEC = 1.55;
export const SALE_LINE_SEC = 0.4;
export const SALE_PILL_FROM_SEC = 2.0;
export const SALE_PILL_TO_SEC = 2.3;
export const SALE_PILL_SCALE_FROM = 0.9;
export const SALE_BACKDROP_BLUR_PX = 18;
export const SALE_DOCK_FROM = {x: 0.58, y: 0.42, w: 0.12} as const;
export const SALE_DOCK_TO = {x: 0.25, y: 0.49, w: 0.05} as const;
export const SALE_BOARD_ASPECT = 4 / 5;
export const SALE_COLORS = {ground: '#0B0E26', ink: '#FFFFFF', plate: '#C98A5B'} as const;
export const SALE_DEFAULT_TITLE = 'Sale: 30% Off';
export const SALE_DEFAULT_LINES: readonly [string, string] = ['Offer ends in', 'Two days'];
export const SALE_DEFAULT_CTA = 'Start free trial';
export const SALE_DEFAULT_FOOTER: readonly [string, string] = ['buildmago', 'hello@buildmago.com'];
export const SALE_PROMO_TIMELINE: readonly TemplateOp[] = [
  op('title_card', null, 0, SALE_CUT_SEC),
  op('hard_cut_to_plate', null, SALE_CUT_SEC, SALE_CUT_SEC),
  op('clock_dock', 'icon_dock', SALE_DOCK_FROM_SEC, SALE_DOCK_TO_SEC),
  op('line_2_slide_up', 'masked_slide_up', SALE_LINE2_FROM_SEC, round6(SALE_LINE2_FROM_SEC + SALE_LINE_SEC)),
  op('line_1_slide_up', 'masked_slide_up', SALE_LINE1_FROM_SEC, round6(SALE_LINE1_FROM_SEC + SALE_LINE_SEC)),
  op('cta_pill', 'glass_pill', SALE_PILL_FROM_SEC, SALE_PILL_TO_SEC),
  op('hold', null, SALE_PILL_TO_SEC, SALE_BASE_SEC),
];

/** CLIP_24 (B3): 4.38 s loop. A word wheel scrolls one row per ~1.4 s beat (220 ms ease-out) and the background HARD-cuts to the next colour on the landing. */
export const WHEEL_BASE_SEC = 4.38;
export const WHEEL_LANDING_SEC: readonly number[] = [0, 1.4, 2.8, 4.2];
export const WHEEL_SCROLL_SEC = 0.22;
export const WHEEL_VISIBLE = 6;
export const WHEEL_DEFAULT_WORDS: readonly string[] = ['Orange', 'Blue', 'Yellow', 'Green', 'Black', 'Grey', 'Purple'];
export const WHEEL_DEFAULT_COLORS: readonly string[] = ['#E0AE10', '#A8C520', '#1A1A1A', '#9A9CB8'];
export const WHEEL_NEIGHBOUR_OPACITY: readonly number[] = [1, 0.25, 0.15, 0.06];
export const COLOR_WHEEL_TIMELINE: readonly TemplateOp[] = [
  ...WHEEL_LANDING_SEC.slice(1).map((land, k) => op(`wheel_scroll_${k + 1}`, 'word_wheel', round6(land - WHEEL_SCROLL_SEC), land)),
  ...WHEEL_LANDING_SEC.slice(1).map((land, k) => op(`color_cut_${k + 1}`, 'hard_color_cut', land, land)),
  op('hold', null, WHEEL_LANDING_SEC[3]!, WHEEL_BASE_SEC),
];

/** CLIP_25 (B4): 1.21 s. ALL-CAPS lines type in (char 67 ms) while the tracking collapses 0.7 em -> 0 over 280 ms and the line slides from a 12% indent to the left edge. */
export const TRACKING_BASE_SEC = 1.21;
export const TRACKING_LINE_START_SEC: readonly number[] = [0, 0.33, 0.63, 0.88];
export const TRACKING_CHAR_SEC = 0.067;
export const TRACKING_MIN_CHAR_SEC = 0.015;
export const TRACKING_COLLAPSE_SEC = 0.28;
export const TRACKING_FROM_EM = 0.7;
export const TRACKING_INDENT = 0.12;
export const TRACKING_HOLD_FROM_SEC = 1.01;
export const TRACKING_DEFAULT_LINES: readonly string[] = ['HELLO', 'MONDAY', 'GOODBYE', 'WEEKEND'];
export const TRACKING_COLORS = {page: '#EEEEF0', cardFrom: '#2B9BFF', cardTo: '#8CCBFF', ink: '#FFFFFF'} as const;
export const TRACKING_CARD_INSET = {x: 0.03, y: 0.14} as const;
/** Seconds per typed character for line `index` of `chars` letters: the capture's 67 ms, tightened so the line still lands before the hold. */
export const trackingCharSec = (index: number, chars: number): number =>
  Math.min(TRACKING_CHAR_SEC, Math.max(TRACKING_MIN_CHAR_SEC, (TRACKING_HOLD_FROM_SEC - (TRACKING_LINE_START_SEC[index] ?? 0)) / Math.max(1, chars)));
export const TRACKING_COLLAPSE_TIMELINE: readonly TemplateOp[] = [
  ...TRACKING_DEFAULT_LINES.map((line, k) => op(`tracking_line_${k + 1}`, 'letter_typing_tracking', TRACKING_LINE_START_SEC[k]!, round6(TRACKING_LINE_START_SEC[k]! + Array.from(line).length * trackingCharSec(k, Array.from(line).length)))),
  op('hold', null, TRACKING_HOLD_FROM_SEC, TRACKING_BASE_SEC),
];

/** CLIP_26 (B5): 1.61 s, bg #06070C. Text enters blurred (36 px), tilted -11 deg, 0.2 opacity at (35%, 25%) -> sharp, upright, centred over 0.7 s expo-out; then scale 1 -> 0.93 over the hold. Concentric squircle rings grow 3 -> 7. BLUR is the signature of this template only. */
export const SPATIAL_BASE_SEC = 1.61;
export const SPATIAL_IN_SEC = 0.7;
export const SPATIAL_BLUR_FROM_PX = 36;
export const SPATIAL_ROTATE_FROM_DEG = -11;
export const SPATIAL_FADE_FROM = 0.2;
export const SPATIAL_FROM_POS = {x: 0.35, y: 0.25} as const;
export const SPATIAL_SCALE_FROM_SEC = 1.0;
export const SPATIAL_SCALE_TO = 0.93;
export const SPATIAL_BOARD_ASPECT = 16 / 10;
export const SPATIAL_RING_SPACING = 0.065;
export const SPATIAL_RING_BIRTH_SEC: readonly number[] = [0, 0, 0, 0.4, 0.65, 0.9, 1.15];
export const SPATIAL_RING_FADE_SEC = 0.25;
export const SPATIAL_COLORS = {ground: '#06070C', ring: '#2A3AA8', ink: '#FFFFFF'} as const;
export const SPATIAL_DEFAULT_LINES: readonly [string, string] = ['Available in', 'Spatial Audio'];
export const SPATIAL_BLUR_TILT_TIMELINE: readonly TemplateOp[] = [
  op('blur_rotate_in', 'blur_rotate_in', 0, SPATIAL_IN_SEC),
  op('rings_expand', null, 0, SPATIAL_BASE_SEC),
  op('scale_settle', null, SPATIAL_SCALE_FROM_SEC, SPATIAL_BASE_SEC),
];

export const MOTION_TEMPLATE_TIMELINES: Readonly<Record<TemplateKey, {baseSec: number; ops: readonly TemplateOp[]}>> = {
  clip_01_grid_morph: {baseSec: GRID_MORPH_BASE_SEC, ops: GRID_MORPH_TIMELINE},
  clip_02_slit_carousel: {baseSec: SLIT_CAROUSEL_BASE_SEC, ops: SLIT_CAROUSEL_TIMELINE},
  clip_03_bento_camera: {baseSec: BENTO_CAMERA_BASE_SEC, ops: BENTO_CAMERA_TIMELINE},
  clip_04_stacked_cards: {baseSec: STACK_BASE_SEC, ops: STACK_TIMELINE},
  clip_05_config_brand_loop: {baseSec: CONFIG_BRAND_LOOP_BASE_SEC, ops: CONFIG_BRAND_LOOP_TIMELINE},
  clip_06_blur_word_carousel: {baseSec: BLUR_CAROUSEL_BASE_SEC, ops: BLUR_CAROUSEL_TIMELINE},
  clip_07_ios_notification: {baseSec: IOS_NOTIFICATION_BASE_SEC, ops: IOS_NOTIFICATION_TIMELINE},
  clip_08_nested_rect_title: {baseSec: NESTED_RECT_BASE_SEC, ops: NESTED_RECT_TIMELINE},
  clip_09_acme_fruit_swap: {baseSec: ACME_BASE_SEC, ops: ACME_BRAND_LOOP_TIMELINE},
  clip_10_morph_stretch: {baseSec: MORPH_BASE_SEC, ops: MORPH_FONT_TIMELINE},
  clip_11_menu_slide: {baseSec: MENU_BASE_SEC, ops: MENU_SLIDE_TIMELINE},
  clip_12_editorial_inset: {baseSec: EDITORIAL_BASE_SEC, ops: EDITORIAL_INSET_TIMELINE},
  clip_13_heritage_poster: {baseSec: HERITAGE_BASE_SEC, ops: HERITAGE_POSTER_TIMELINE},
  clip_14_silk_legacy: {baseSec: SILK_BASE_SEC, ops: SILK_COVER_TIMELINE},
  clip_15_glass_testimonial: {baseSec: GLASS_BASE_SEC, ops: GLASS_TESTIMONIAL_TIMELINE},
  clip_16_portrait_push: {baseSec: PUSH_BASE_SEC, ops: PORTRAIT_PUSH_TIMELINE},
  clip_17_photo_stack_collapse: {baseSec: STACK_COLLAPSE_BASE_SEC, ops: STACK_COLLAPSE_TIMELINE},
  clip_18_photo_stack_reveal: {baseSec: STACK_REVEAL_BASE_SEC, ops: STACK_REVEAL_TIMELINE},
  clip_19_two_up_stack: {baseSec: TWO_UP_BASE_SEC, ops: TWO_UP_TIMELINE},
  clip_20_never_done_slit: {baseSec: NEVER_DONE_BASE_SEC, ops: NEVER_DONE_TIMELINE},
  clip_21_typewriter: {baseSec: TYPEWRITER_BASE_SEC, ops: TYPEWRITER_TIMELINE},
  clip_22_chat_conversation: {baseSec: CHAT_BASE_SEC, ops: CHAT_CONVERSATION_TIMELINE},
  clip_23_sale_promo: {baseSec: SALE_BASE_SEC, ops: SALE_PROMO_TIMELINE},
  clip_24_color_word_wheel: {baseSec: WHEEL_BASE_SEC, ops: COLOR_WHEEL_TIMELINE},
  clip_25_tracking_collapse: {baseSec: TRACKING_BASE_SEC, ops: TRACKING_COLLAPSE_TIMELINE},
  clip_26_spatial_blur_tilt: {baseSec: SPATIAL_BASE_SEC, ops: SPATIAL_BLUR_TILT_TIMELINE},
};

// ---------------------------------------------------------------------------- easing + helpers

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
export const easeOutExpo = (t: number): number => (clamp01(t) >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)));
export const easeOutQuart = (t: number): number => 1 - Math.pow(1 - clamp01(t), 4);
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Exponential-decay ease (fast start, long tail): the camera push / pull-back feel. */
export const easeExpDecay = (t: number, k = 4): number => (1 - Math.exp(-k * clamp01(t))) / (1 - Math.exp(-k));

/** Progress 0..1 of `timeSec` through [from, to] (a zero-length op is a step at `from`). */
export function spanProgress(timeSec: number, from: number, to: number): number {
  if (to <= from) return timeSec >= from ? 1 : 0;
  return clamp01((timeSec - from) / (to - from));
}

/** Compress a timeline when the beat is shorter than the template; a longer beat keeps scale 1 (the last hold extends). */
export function templateScale(durationSec: number, baseSec: number): number {
  return durationSec >= baseSec ? 1 : Math.max(0.25, durationSec / baseSec);
}

/** The `nth` op with this id (default the first), or undefined. */
export function findOp(ops: readonly TemplateOp[], id: string, nth = 0): TemplateOp | undefined {
  return ops.filter(row => row.id === id)[nth];
}

/** Progress (0..1, linear) of an op at timeline time `timeSec`. */
export function opProgress(ops: readonly TemplateOp[], id: string, timeSec: number, nth = 0): number {
  const row = findOp(ops, id, nth);
  return row ? spanProgress(timeSec, row.from, row.to) : 0;
}

/** Staggered per-element progress inside an op: element starts `delay` s after the op starts and takes `dur` s. */
export function staggered(timeSec: number, opFrom: number, delay: number, dur: number): number {
  return clamp01((timeSec - opFrom - delay) / Math.max(0.001, dur));
}

/** Largest rect of `aspect` (w / h) that fits (contain) in width x height, centred. */
export function fitContain(aspect: number, width: number, height: number): {x: number; y: number; w: number; h: number} {
  let w = width;
  let h = w / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  return {x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w: Math.round(w), h: Math.round(h)};
}

// ---------------------------------------------------------------------------- CLIP_01 grid mosaic

export const GRID_COLORS = {cream: '#F4F2EE', blue: '#4F7CFA', beige: '#D2C9B7', red: '#FD5D42', ink: '#1B1B22'} as const;
/** 4x4 tile map: A = accent block (the centre 2x2, merged later), B = beige tile, . = bare cream. */
export const GRID_TILE_MAP: readonly string[] = ['B.B.', '.AAB', 'BAA.', '.B.B'];
/** The 4:5 artboard the 4x4 grid sits in. */
export const GRID_ARTBOARD_ASPECT = 4 / 5;

/** Merge rect (in cell units) of the accent block at merge progress `p` (x edges first, y edges 0.12 later): 2x2 centre -> the whole 4x4. */
export function gridMergeRect(p: number): {x0: number; y0: number; x1: number; y1: number} {
  const ex = easeOutCubic(p);
  const ey = easeOutCubic(clamp01((p - 0.2) / 0.8));
  return {x0: mix(1, 0, ex), x1: mix(3, 4, ex), y0: mix(1, 0, ey), y1: mix(3, 4, ey)};
}

// ---------------------------------------------------------------------------- CLIP_02 slit carousel

export const SLIT_ACID = '#EAF826';
export const SLIT_ACCORDION_FACTOR = 3.25;
export const SLIT_STAGGER_SEC = 0.025;
export const SLIT_ASPECT = 4 / 3;
export const SLIT_VISIBLE_SLOTS = 5;

/** Carousel advance (in slots, 0..1) of ring item `index` at timeline time t: 0 -> 1 over the advance op (staggered), then 1 -> 0 over the back op (staggered the other way). */
export function slitAdvance(timeSec: number, index: number, slots = SLIT_VISIBLE_SLOTS): number {
  const fwd = findOp(SLIT_CAROUSEL_TIMELINE, 'slot_carousel_advance')!;
  const back = findOp(SLIT_CAROUSEL_TIMELINE, 'slot_carousel_advance_back')!;
  const stagger = SLIT_STAGGER_SEC;
  const span = (row: TemplateOp) => row.to - row.from - stagger * slots;
  const a = easeOutCubic(staggered(timeSec, fwd.from, index * stagger, span(fwd)));
  const b = easeOutCubic(staggered(timeSec, back.from, (slots - index) * stagger, span(back)));
  return a - b;
}

/** 0..1 accordion openness at timeline time t (expand, then contract). */
export function slitAccordion(timeSec: number): number {
  return easeInOutCubic(opProgress(SLIT_CAROUSEL_TIMELINE, 'panel_accordion_expand', timeSec)) - easeInOutCubic(opProgress(SLIT_CAROUSEL_TIMELINE, 'accordion_contract', timeSec));
}

/** Which ring item expands: the item whose content is `focusIndex` and whose resting slot after the advance (item - 1) is nearest the strip centre. */
export function slitFocusItem(panelCount: number, focusIndex: number, slots = SLIT_VISIBLE_SLOTS): number {
  const wanted = ((focusIndex % panelCount) + panelCount) % panelCount;
  const centre = (slots - 1) / 2;
  let best = 1;
  let bestDist = Infinity;
  for (let item = 0; item <= slots; item++) {
    if (item % panelCount !== wanted) continue;
    const dist = Math.abs(item - 1 - centre);
    if (dist < bestDist) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------- CLIP_03 bento camera

export const BENTO_COLORS = {yellow: '#F6D743', green: '#3E8F5A', sage: '#B9C4A7', white: '#F4F4EF', black: '#121212'} as const;
export const BENTO_PALETTE_ORDER: readonly (keyof typeof BENTO_COLORS)[] = ['white', 'sage', 'black', 'yellow', 'sage', 'white', 'green', 'black', 'white', 'sage', 'black', 'yellow'];

export type BentoKind = 'ui' | 'photo';
export type BentoRect = {x: number; y: number; w: number; h: number};

/** A justified wall: `count` cards in rows that each fill the full width; row heights and card widths vary (a bento, not a uniform grid). Deterministic. */
export function bentoLayout(kinds: readonly BentoKind[], width: number, height: number, gap: number): BentoRect[] {
  const count = Math.max(1, kinds.length);
  const rows = Math.min(5, Math.max(3, Math.round(count / 3)));
  const perRow: number[] = Array.from({length: rows}, (_, i) => Math.floor(count / rows) + (i < count % rows ? 1 : 0));
  const rowWeights = [1.15, 0.85, 1.2, 0.9, 1.0].slice(0, rows);
  const rowWeightSum = rowWeights.reduce((a, b) => a + b, 0);
  const usableH = height - gap * (rows + 1);
  const rects: BentoRect[] = [];
  let at = 0;
  let y = gap;
  for (let r = 0; r < rows; r++) {
    const h = (usableH * rowWeights[r]!) / rowWeightSum;
    const n = perRow[r]!;
    const weights = Array.from({length: n}, (_, i) => {
      const kind = kinds[at + i] ?? 'ui';
      return (kind === 'photo' ? 1.45 : 1) * (1 + 0.18 * (((r + i) % 3) - 1));
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    const usableW = width - gap * (n + 1);
    let x = gap;
    for (let i = 0; i < n; i++) {
      const w = (usableW * weights[i]!) / sum;
      rects.push({x, y, w, h});
      x += w + gap;
    }
    at += n;
    y += h + gap;
  }
  return rects;
}

export type BentoCamera = {scale: number; fx: number; fy: number; /** true on the one frame range after the hard cut (informational) */ cut: boolean};

/**
 * The camera at timeline time t over a wall of `width` x `height` (focus point in wall px). creep -> HARD jump -> exp-decay ease zoom to the focus card -> hold -> eased pull-back -> settle.
 * No rotation, no blur. The scale never drops below 1 (the wall always covers the frame).
 */
export function bentoCamera(timeSec: number, wall: {width: number; height: number}, focus: BentoRect): BentoCamera {
  const cx = wall.width / 2;
  const cy = wall.height / 2;
  const fcx = focus.x + focus.w / 2;
  const fcy = focus.y + focus.h / 2;
  const target = Math.min(3.4, Math.max(1.8, (wall.width * 0.8) / Math.max(1, focus.w)));
  const jumpScale = 1.45;
  const jumpFx = mix(cx, fcx, 0.45);
  const jumpFy = mix(cy, fcy, 0.45);
  const creep = findOp(BENTO_CAMERA_TIMELINE, 'camera_creep')!;
  const jump = findOp(BENTO_CAMERA_TIMELINE, 'camera_jump_cut')!;
  const zin = findOp(BENTO_CAMERA_TIMELINE, 'camera_ease_zoom')!;
  const zout = findOp(BENTO_CAMERA_TIMELINE, 'camera_ease_zoom_out')!;
  const settle = findOp(BENTO_CAMERA_TIMELINE, 'settle')!;
  if (timeSec < jump.from) return {scale: mix(1, 1.1, spanProgress(timeSec, creep.from, creep.to)), fx: cx, fy: cy, cut: false}; // near-linear creep
  if (timeSec < zout.from) {
    const p = easeExpDecay(spanProgress(timeSec, zin.from, zin.to));
    return {scale: mix(jumpScale, target, p), fx: mix(jumpFx, fcx, p), fy: mix(jumpFy, fcy, p), cut: timeSec >= jump.from};
  }
  if (timeSec < settle.from) {
    const p = easeInOutCubic(spanProgress(timeSec, zout.from, zout.to));
    return {scale: mix(target, 1, p), fx: mix(fcx, cx, p), fy: mix(fcy, cy, p), cut: false};
  }
  return {scale: mix(1, 1.015, easeOutCubic(spanProgress(timeSec, settle.from, settle.to))), fx: cx, fy: cy, cut: false};
}

/** CSS translate (px) that puts wall point (fx, fy) at the frame centre at `scale`, clamped so the wall never leaves a gap at the frame edge. */
export function bentoTranslate(camera: Pick<BentoCamera, 'scale' | 'fx' | 'fy'>, frame: {width: number; height: number}): {tx: number; ty: number} {
  const rawX = frame.width / 2 - camera.fx * camera.scale;
  const rawY = frame.height / 2 - camera.fy * camera.scale;
  const minX = frame.width - frame.width * camera.scale;
  const minY = frame.height - frame.height * camera.scale;
  return {tx: Math.min(0, Math.max(minX, rawX)), ty: Math.min(0, Math.max(minY, rawY))};
}

// ---------------------------------------------------------------------------- CLIP_04 stacked cards

export const STACK_TONES: readonly string[] = ['#EDEDED', '#C9C9C9', '#9E9E9E', '#6E6E6E', '#454545', '#2B2B2B'];

/** Completed card swaps + the in-flight swap's linear progress at timeline time t (swaps repeat every STACK_CYCLE_SEC from STACK_FIRST_HOLD_SEC). */
export function stackState(timeSec: number): {completed: number; progress: number} {
  if (timeSec < STACK_FIRST_HOLD_SEC) return {completed: 0, progress: 0};
  const since = timeSec - STACK_FIRST_HOLD_SEC;
  const index = Math.floor(since / STACK_CYCLE_SEC);
  const local = since - index * STACK_CYCLE_SEC;
  if (local < STACK_TRANSITION_SEC) return {completed: index, progress: local / STACK_TRANSITION_SEC};
  return {completed: index + 1, progress: 0};
}

/** Outgoing tilt (deg): 3..5, alternating side per swap. */
export function stackTiltDeg(swapIndex: number): number {
  return (3 + (swapIndex % 3)) * (swapIndex % 2 === 0 ? 1 : -1);
}

// ---------------------------------------------------------------------------- CLIP_05 config brand loop

export const CONFIG_COLORS = {black: '#000000', white: '#FFFFFF', magenta: '#E6007E', yellow: '#FFD400', blue: '#2F5BFF'} as const;
/** Flat placeholder grounds / figures for the five scenes when no photo `src` is given. */
export const CONFIG_SCENE_TONES: ReadonlyArray<{ground: string; figure: string; sun: string}> = [
  {ground: '#F2B6C8', figure: '#2A1B3D', sun: '#FFD400'},
  {ground: '#B9D8F2', figure: '#14213D', sun: '#FF6B35'},
  {ground: '#F6E3A1', figure: '#3A2E1F', sun: '#E6007E'},
  {ground: '#C4E3C1', figure: '#1B2D24', sun: '#2F5BFF'},
  {ground: '#E2C7F0', figure: '#2B1E3A', sun: '#FFD400'},
];
export const CONFIG_MASK_SHAPES = ['clover_circles', 'blob_with_inset_window', 'figure_8', 'rounded_stack', 'notched_square'] as const;
export const CONFIG_MASK_SAMPLES = 72;

const superellipse = (theta: number, n: number): number => Math.pow(Math.pow(Math.abs(Math.cos(theta)), n) + Math.pow(Math.abs(Math.sin(theta)), n), -1 / n);

/** Raw polar radius of mask shape `index` at angle `theta` (before normalising). */
function rawMaskRadius(index: number, theta: number): number {
  switch (index % CONFIG_SCENE_COUNT) {
    case 0: // clover of circles: four round lobes
      return 0.8 + 0.2 * Math.cos(4 * theta);
    case 1: // soft blob (the inset window of the reference is approximated by the plain blob)
      return 0.86 + 0.07 * Math.sin(3 * theta + 0.6) + 0.05 * Math.cos(2 * theta + 1.1);
    case 2: // figure 8: two lobes pinched in the middle
      return 0.38 + 0.62 * Math.pow(Math.abs(Math.cos(theta)), 0.7);
    case 3: // rounded stack: a rounded rectangle
      return superellipse(theta, 5);
    default: // notched square: a squarish shape with a bite out of the lower-right corner
      return superellipse(theta, 8) * (1 - 0.3 * Math.exp(-Math.pow((theta - Math.PI / 4) / 0.2, 2)));
  }
}

/** Normalised radii (CONFIG_MASK_SAMPLES samples, angle i / N * 2pi) of mask shape `index`: the shape fits the unit square (max |x| or |y| = 1). Equal topology, so shapes interpolate sample by sample. */
export function configMaskRadii(index: number): number[] {
  const raw = Array.from({length: CONFIG_MASK_SAMPLES}, (_, i) => {
    const theta = (i / CONFIG_MASK_SAMPLES) * Math.PI * 2;
    return {theta, r: rawMaskRadius(index, theta)};
  });
  const peak = Math.max(...raw.map(({theta, r}) => Math.max(Math.abs(r * Math.cos(theta)), Math.abs(r * Math.sin(theta)))));
  return raw.map(({r}) => r / peak);
}

/** Loop-local seconds in [0, base). */
export const configLoopTime = (timeSec: number): number => {
  const wrapped = timeSec % CONFIG_BRAND_LOOP_BASE_SEC; // no `+ base` for a positive time: it would perturb exact grid times (1.5 -> 1.4999999999999991)
  return wrapped < 0 ? wrapped + CONFIG_BRAND_LOOP_BASE_SEC : wrapped;
};

/** Scene shown at loop time t: a HARD cut every 1.5 s (A..E; E holds to the loop point). */
export function configScene(timeSec: number): number {
  return Math.min(CONFIG_SCENE_COUNT - 1, Math.floor(configLoopTime(timeSec) / CONFIG_CUT_GRID_SEC));
}

/** The mask morph at loop time t: shape `from` -> `to`, eased progress `p`. It starts 0.15 s before each cut and settles 0.4 s after; the loop point is a cut too (shape E -> A), wrapped so the loop is seamless. */
export function configMask(timeSec: number): {from: number; to: number; p: number} {
  const t = configLoopTime(timeSec);
  for (let j = 0; j < CONFIG_SCENE_COUNT; j++) {
    let rel = t - j * CONFIG_CUT_GRID_SEC;
    if (j === 0 && rel > CONFIG_BRAND_LOOP_BASE_SEC / 2) rel -= CONFIG_BRAND_LOOP_BASE_SEC;
    if (rel >= -CONFIG_MORPH_LEAD_SEC && rel <= CONFIG_MORPH_SETTLE_SEC) {
      return {from: (j + CONFIG_SCENE_COUNT - 1) % CONFIG_SCENE_COUNT, to: j, p: easeInOutCubic((rel + CONFIG_MORPH_LEAD_SEC) / (CONFIG_MORPH_LEAD_SEC + CONFIG_MORPH_SETTLE_SEC))};
    }
  }
  const scene = configScene(t);
  return {from: scene, to: scene, p: 0};
}

/** Interpolated normalised radii of the mask at loop time t. */
export function configMaskRadiiAt(timeSec: number): number[] {
  const state = configMask(timeSec);
  const a = configMaskRadii(state.from);
  if (state.from === state.to || state.p <= 0) return a;
  const b = configMaskRadii(state.to);
  return a.map((r, i) => mix(r, b[i]!, state.p));
}

/** SVG / CSS path (px, relative to a w x h box) of normalised radii. */
export function configMaskPath(radii: readonly number[], w: number, h: number): string {
  const n = radii.length;
  const pts = radii.map((r, i) => {
    const theta = (i / n) * Math.PI * 2;
    return `${(w / 2 + r * Math.cos(theta) * (w / 2)).toFixed(1)} ${(h / 2 + r * Math.sin(theta) * (h / 2)).toFixed(1)}`;
  });
  return `M${pts.join(' L')} Z`;
}

/** A sticker at loop time t: null while absent, else its scale (a dot -> 1 over 0.8 s ease-out, 1 -> a dot over 0.2 s) and rotation (45 deg -> 0 while popping in). */
export function configStickerState(id: ConfigStickerId, timeSec: number): {scale: number; rotateDeg: number} | null {
  const t = configLoopTime(timeSec);
  const dot = 0.08;
  for (const win of CONFIG_STICKER_WINDOWS[id]) {
    if (t >= win.from && t < win.from + CONFIG_STICKER_POP_SEC) {
      const e = easeOutCubic((t - win.from) / CONFIG_STICKER_POP_SEC);
      return {scale: mix(dot, 1, e), rotateDeg: CONFIG_STICKER_ROTATE_DEG * (1 - e)};
    }
    if (t >= win.from + CONFIG_STICKER_POP_SEC && t < win.to) return {scale: 1, rotateDeg: 0};
    if (t >= win.to && t < win.to + CONFIG_STICKER_EXIT_SEC) return {scale: mix(1, dot, (t - win.to) / CONFIG_STICKER_EXIT_SEC), rotateDeg: 0};
  }
  return null;
}

// ---------------------------------------------------------------------------- CLIP_06 blur word carousel

export const BLUR_DEFAULT_WORDS: readonly string[] = ['Blur Effect', 'Moments', 'Pulse', 'Essence', 'Memories', 'Motion', 'Emotion', 'Direction', 'Jitter'];
export const BLUR_COLORS = {active: '#FFFFFF', neighbor: '#8A8A8A', ground: '#000000'} as const;
export const BLUR_LAYOUT = {arrowX: 0.17, textX: 0.23, activeY: 0.57, slotPitch: 0.23} as const;
export const BLUR_TILT_MOVING_DEG = -8;
export const BLUR_TILT_HOLD_DEG = -1;
/** Distance-from-active anchors: [blur px at 1080p-ish reference, strength 0..1, scale]. d >= 3 holds the last. */
const BLUR_ANCHORS: ReadonlyArray<{blurPx: number; strength: number; scale: number}> = [
  {blurPx: 0, strength: 1, scale: 1},
  {blurPx: 1.5, strength: 0.6, scale: 0.88},
  {blurPx: 5, strength: 0.35, scale: 0.88},
  {blurPx: 10, strength: 0.2, scale: 0.88},
];

/** Carousel position in slots (0 = the first word is active) at timeline time t: each of the four moves is an eased one-slot step. */
export function blurCarouselPos(timeSec: number): number {
  let pos = 0;
  for (let k = 0; k < BLUR_MOVES; k++) pos += easeInOutCubic(spanProgress(timeSec, blurMoveStart(k), blurMoveStart(k) + BLUR_MOVE_SEC));
  return pos;
}

/** 0..1 bump while a move is in flight (0 on every hold): drives the stack tilt. */
export function blurMoveBump(timeSec: number): number {
  for (let k = 0; k < BLUR_MOVES; k++) {
    const from = blurMoveStart(k);
    if (timeSec >= from && timeSec <= from + BLUR_MOVE_SEC) return Math.sin(Math.PI * spanProgress(timeSec, from, from + BLUR_MOVE_SEC));
  }
  return 0;
}

/** The whole-stack tilt (deg): about -1 on a hold, about -8 at the middle of a move. */
export function blurTiltDeg(timeSec: number): number {
  return mix(BLUR_TILT_HOLD_DEG, BLUR_TILT_MOVING_DEG, blurMoveBump(timeSec));
}

const grayHex = (level: number): string => {
  const v = Math.round(level).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`.toUpperCase();
};

/** Row style at distance `d` (slots, continuous) from the active slot: white / sharp / full size at 0, grey with progressive blur, fading strength and 0.88 scale further out. */
export function blurRowStyle(distance: number): {blurPx: number; strength: number; scale: number; color: string} {
  const d = Math.min(3, Math.abs(distance));
  const i = Math.min(2, Math.floor(d));
  const a = BLUR_ANCHORS[i]!;
  const b = BLUR_ANCHORS[i + 1]!;
  const f = d - i;
  return {
    blurPx: mix(a.blurPx, b.blurPx, f),
    strength: mix(a.strength, b.strength, f),
    scale: mix(a.scale, b.scale, f),
    color: grayHex(mix(0xff, 0x8a, Math.min(1, d))),
  };
}

// ---------------------------------------------------------------------------- CLIP_07 iOS notification

export const IOS_BANNER = {radius: 20, w: 0.55, h: 0.16, top: 0.06, fill: '#E1E1E1'} as const;
export const IOS_CURSOR_AT: readonly [number, number] = [0.52, 0.7];

/** Cursor glyph at timeline time t: the arrow, then the open hand from 0.83 s, hidden from 1.67 s. */
export function iosCursorState(timeSec: number): 'arrow' | 'hand' | 'hidden' {
  if (timeSec >= IOS_CURSOR_HIDE_SEC) return 'hidden';
  return timeSec >= IOS_HAND_AT_SEC ? 'hand' : 'arrow';
}

// ---------------------------------------------------------------------------- CLIP_08 nested rect title

export const NESTED_COLORS = {paleBlue: '#ABCDEE', navy: '#12112B', cream: '#F4FCD4', pink: '#F89BFA', lightBlue: '#8FC1F5', blue: '#2F5BFF'} as const;

/** Scale (0..1) of nested layer `index` at timeline time T: grows from the exact centre, ease-in. */
export function nestedRectScale(timeSec: number, index: number): number {
  const layer = NESTED_LAYERS[index]!;
  return easeInCubic(spanProgress(timeSec, layer.from, layer.to));
}

/** Characters of a `total`-long line typed by timeline time T (no caret). */
export function typewriterChars(timeSec: number, startSec: number, cps: number, total: number): number {
  return Math.max(0, Math.min(total, Math.floor((timeSec - startSec) * cps)));
}

// ---------------------------------------------------------------------------- CLIP_09 ACME fruit letter swap

/** The scene shown at timeline time t: a HARD cut at each scene start (the last scene holds if the beat runs long). */
export function acmeSceneIndex(timeSec: number): number {
  let index = 0;
  for (let i = 0; i < ACME_SCENES.length; i++) if (timeSec >= acmeSceneStart(i)) index = i;
  return index;
}

/** The fruit standing in for a glyph at timeline time t: it settles from 1.6x to 1x over 0.4 s (ease-out) while turning ~15 degrees to upright. Null on the plain-wordmark scene. */
export function acmeFruitState(timeSec: number): {fruit: AcmeFruit; glyph: number; scale: number; rotateDeg: number} | null {
  const index = acmeSceneIndex(timeSec);
  const scene = ACME_SCENES[index]!;
  if (!scene.fruit || scene.glyph === null) return null;
  const e = easeOutCubic((timeSec - acmeSceneStart(index)) / ACME_FRUIT_SETTLE_SEC);
  return {fruit: scene.fruit, glyph: scene.glyph, scale: mix(ACME_FRUIT_FROM_SCALE, 1, e), rotateDeg: ACME_FRUIT_ROTATE_DEG * (1 - e)};
}

// ---------------------------------------------------------------------------- CLIP_10 morph font stretch

export type MorphFrame = {
  /** Non-uniform scale of the whole word (1, 1 outside the stretch). */
  sx: number;
  sy: number;
  /** Per-letter morph 0 (plain sans) .. 1 (bubbly display). All 1 before the hard cut. */
  letters: number[];
};

/** The word at timeline time t for a `count`-letter word. bubbly -> stretch (eased, held) -> HARD cut (plain, unstretched) -> per-letter morph, left to right. */
export function morphFrame(timeSec: number, count: number): MorphFrame {
  const n = Math.max(1, count);
  if (timeSec < MORPH_CUT_SEC) {
    const e = easeInOutCubic(spanProgress(timeSec, MORPH_STRETCH_FROM_SEC, MORPH_STRETCH_TO_SEC));
    return {sx: mix(1, MORPH_STRETCH_X, e), sy: mix(1, MORPH_STRETCH_Y, e), letters: Array.from({length: n}, () => 1)};
  }
  const stagger = morphLetterStagger(n);
  return {sx: 1, sy: 1, letters: Array.from({length: n}, (_, i) => spanProgress(timeSec, MORPH_LETTER_FROM_SEC + i * stagger, MORPH_LETTER_FROM_SEC + i * stagger + MORPH_LETTER_SEC))};
}

// ---------------------------------------------------------------------------- CLIP_11 menu slide poster

/** 0 -> 1 over one 0.85 s slide: ease-in-out for the first 0.6 s (to 1.03), then a 0.25 s ease-out settle back to 1. */
export function menuEase(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const main = MENU_MAIN_SEC / MENU_SLIDE_SEC;
  if (progress < main) return easeInOutCubic(progress / main) * (1 + MENU_SETTLE_AMOUNT);
  return 1 + MENU_SETTLE_AMOUNT * (1 - easeOutCubic((progress - main) / (1 - main)));
}

/** The carousel position in slides at timeline time t (+ an element's own time shift): -0.5 at the clip start (mid-slide into the first item), `count - 1` once the last slide has settled. */
export function menuPosition(timeSec: number, shiftSec = 0, count = MENU_SLIDE_COUNT): number {
  let pos = -1;
  for (let k = 0; k < count; k++) pos += menuEase((timeSec + shiftSec - menuSlideStart(k)) / MENU_SLIDE_SEC);
  return pos;
}

/** Carousel positions of the three layers of a slide: the photo leads the headline by 0.10 s, the second headline line lags the first by 0.08 s. */
export function menuLayerPositions(timeSec: number, count = MENU_SLIDE_COUNT): {photo: number; line1: number; line2: number} {
  return {photo: menuPosition(timeSec, MENU_PHOTO_LEAD_SEC, count), line1: menuPosition(timeSec, 0, count), line2: menuPosition(timeSec, -MENU_LINE2_LAG_SEC, count)};
}

// ---------------------------------------------------------------------------- CLIP_12 editorial inset poster

const insetRect = (): NormRect => ({x: 0.5 - EDITORIAL_INSET_SIZE.w / 2, y: 0.5 - EDITORIAL_INSET_SIZE.h / 2, w: EDITORIAL_INSET_SIZE.w, h: EDITORIAL_INSET_SIZE.h});
const lerpRect = (a: NormRect, b: NormRect, t: number): NormRect => ({x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), w: mix(a.w, b.w, t), h: mix(a.h, b.h, t)});

/** The photo at timeline time t (fractions of the artboard), or null while it is hidden (the white phase). Inset -> full bleed (ease-out + settle), HARD cut away at 3.20 s, then dot -> inset. */
export function editorialPhotoRect(timeSec: number): NormRect | null {
  if (timeSec < EDITORIAL_CUT_SEC) return lerpRect(insetRect(), {x: 0, y: 0, w: 1, h: 1}, easeOutQuart(spanProgress(timeSec, EDITORIAL_GROW_FROM_SEC, EDITORIAL_SETTLE_END_SEC)));
  if (timeSec < EDITORIAL_SPLIT_FROM_SEC) return null;
  const dot: NormRect = {x: 0.496, y: 0.4965, w: 0.008, h: 0.007};
  return lerpRect(dot, insetRect(), easeOutCubic(spanProgress(timeSec, EDITORIAL_SPLIT_FROM_SEC, EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_SPLIT_SEC)));
}

/** 0 = AC and ME joined (the white phase), 1 = split wide enough for the inset photo between them. */
export function editorialSplit(timeSec: number): number {
  if (timeSec < EDITORIAL_CUT_SEC) return 1;
  if (timeSec < EDITORIAL_SPLIT_FROM_SEC) return 0;
  return easeOutCubic(spanProgress(timeSec, EDITORIAL_SPLIT_FROM_SEC, EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_SPLIT_SEC));
}

/** Headline line `index` at timeline time t: hidden, or its offset through the mask window in line heights (+1 = below the window, 0 = shown, -1 = above it). */
export function editorialLineOffset(timeSec: number, index: number): number | null {
  if (timeSec < EDITORIAL_CUT_SEC || timeSec >= EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_LINE_EXIT_SEC) return null;
  if (timeSec >= EDITORIAL_SPLIT_FROM_SEC) return -easeOutCubic(spanProgress(timeSec, EDITORIAL_SPLIT_FROM_SEC, EDITORIAL_SPLIT_FROM_SEC + EDITORIAL_LINE_EXIT_SEC));
  const from = EDITORIAL_CUT_SEC + index * EDITORIAL_LINE_STAGGER_SEC;
  return 1 - easeOutCubic(spanProgress(timeSec, from, from + EDITORIAL_LINE_SEC));
}


// ---------------------------------------------------------------------------- CLIP_13 heritage devotion poster

const HERITAGE_FULL: NormRect = {x: 0, y: 0, w: 1, h: 1};
/** Thumb rect as fractions of a 4:5 artboard (3:4 photo, 25% of the width, centred 40% from the top). */
export const HERITAGE_THUMB: NormRect = (() => {
  const h = (HERITAGE_THUMB_W * (4 / 3)) / (5 / 4);
  return {x: 0.5 - HERITAGE_THUMB_W / 2, y: 0.4 - h / 2, w: HERITAGE_THUMB_W, h};
})();

/** The photo at timeline time t: opens FULL BLEED, expo-out shrinks to the thumb, stays thumb through the poster hold, HARD loop cut back to full bleed. Always a rectangle. */
export function heritagePhotoRect(timeSec: number): NormRect {
  if (timeSec < HERITAGE_SHRINK_FROM_SEC) return HERITAGE_FULL;
  if (timeSec < HERITAGE_SHRINK_TO_SEC) return lerpRect(HERITAGE_FULL, HERITAGE_THUMB, easeOutExpo(spanProgress(timeSec, HERITAGE_SHRINK_FROM_SEC, HERITAGE_SHRINK_TO_SEC)));
  if (timeSec < HERITAGE_LOOP_CUT_SEC) return HERITAGE_THUMB;
  return HERITAGE_FULL;
}

/** True while the photo covers the whole artboard (open flash + loop cut): headline cleared, only micro text shows. */
export const heritageFlash = (timeSec: number): boolean =>
  timeSec < HERITAGE_SHRINK_FROM_SEC || timeSec >= HERITAGE_LOOP_CUT_SEC;

/** Headline line `index`: null through the open flash + shrink; rises through a mask; holds; marquee; cleared again on the loop cut. Never shown at t=0. */
export function heritageLineOffset(timeSec: number, index: number): number | null {
  if (timeSec < HERITAGE_LINES_FROM_SEC || timeSec >= HERITAGE_LOOP_CUT_SEC) return null;
  if (timeSec < HERITAGE_HOLD_FROM_SEC) {
    const from = HERITAGE_LINES_FROM_SEC + index * HERITAGE_LINE_STAGGER_SEC;
    return 1 - easeOutCubic(spanProgress(timeSec, from, from + HERITAGE_LINE_SEC));
  }
  if (timeSec < HERITAGE_MARQUEE_FROM_SEC) return 0;
  if (timeSec >= HERITAGE_MARQUEE_TO_SEC) return 0;
  const p = spanProgress(timeSec, HERITAGE_MARQUEE_FROM_SEC, HERITAGE_MARQUEE_TO_SEC);
  return p < 0.5 ? -easeInCubic(p * 2) : 1 - easeOutCubic((p - 0.5) * 2);
}

/** The four corner squares: absent on full-bleed; converge board→thumb after shrink; then open toward the headline block. */
export function heritageMarkerStage(timeSec: number): number | null {
  if (timeSec < HERITAGE_SHRINK_TO_SEC || timeSec >= HERITAGE_LOOP_CUT_SEC) return null;
  if (timeSec < HERITAGE_CONVERGE_TO_SEC) return easeOutCubic(spanProgress(timeSec, HERITAGE_SHRINK_TO_SEC, HERITAGE_CONVERGE_TO_SEC));
  return 1 + easeOutCubic(spanProgress(timeSec, HERITAGE_LINES_FROM_SEC + 0.2, HERITAGE_LINES_FROM_SEC + 0.6));
}

// ---------------------------------------------------------------------------- CLIP_14 silk legacy cover

export const SILK_THUMB: NormRect = (() => {
  const h = (SILK_THUMB_W * (4 / 3)) / (5 / 4);
  return {x: 0.5 - SILK_THUMB_W / 2, y: 0.5 - h / 2, w: SILK_THUMB_W, h};
})();
export const SILK_COVER: NormRect = {x: SILK_COVER_INSET, y: (SILK_COVER_INSET * 4) / 5, w: 1 - 2 * SILK_COVER_INSET, h: 1 - (2 * SILK_COVER_INSET * 4) / 5};

/** The photo at timeline time t: thumb -> expo-out cover (4% inset), HARD cut to nothing on the blank beat, thumb again from the rise (so the loop seam is exact). */
export function silkPhotoRect(timeSec: number): NormRect | null {
  if (timeSec >= SILK_LINES_FROM_SEC) return SILK_THUMB;
  if (timeSec >= SILK_BLANK_FROM_SEC) return null;
  return lerpRect(SILK_THUMB, SILK_COVER, easeOutExpo(spanProgress(timeSec, SILK_GROW_FROM_SEC, SILK_GROW_TO_SEC)));
}

/** Headline line `index` at timeline time t: null while cleared. Rises through a mask at the loop end (2.6 s, 90 ms stagger), is shown through the first second, and exits upward as the photo grows. */
export function silkLineOffset(timeSec: number, index: number): number | null {
  if (timeSec >= SILK_BLANK_FROM_SEC && timeSec < SILK_LINES_FROM_SEC) return null;
  if (timeSec >= SILK_LINES_FROM_SEC) {
    const from = SILK_LINES_FROM_SEC + index * SILK_LINE_STAGGER_SEC;
    return 1 - easeOutCubic(spanProgress(timeSec, from, from + SILK_LINE_SEC));
  }
  if (timeSec < SILK_GROW_FROM_SEC) return 0;
  const from = SILK_GROW_FROM_SEC + index * 0.04;
  const p = spanProgress(timeSec, from, from + SILK_CLEAR_SEC);
  return p >= 1 ? null : -easeOutCubic(p);
}

/** The body copy: shown with the thumb, exits downward as the photo grows, hidden on the blank beat and the rise, back with the thumb at the loop end. */
export function silkBodyOffset(timeSec: number): number | null {
  if (timeSec >= SILK_BLANK_FROM_SEC && timeSec < SILK_LINES_FROM_SEC) return null;
  if (timeSec >= SILK_LINES_FROM_SEC) return 0;
  if (timeSec < SILK_GROW_FROM_SEC) return 0;
  const p = spanProgress(timeSec, SILK_GROW_FROM_SEC, SILK_GROW_FROM_SEC + SILK_CLEAR_SEC);
  return p >= 1 ? null : easeOutCubic(p);
}

/** The in-image wordmark's offset through its window (+1 below, 0 shown) or null: revealed 1.2-1.7 s, kept until the cut. */
export function silkWordmarkOffset(timeSec: number): number | null {
  if (timeSec < SILK_WORDMARK_FROM_SEC || timeSec >= SILK_BLANK_FROM_SEC) return null;
  return 1 - easeOutCubic(spanProgress(timeSec, SILK_WORDMARK_FROM_SEC, SILK_WORDMARK_FROM_SEC + SILK_WORDMARK_REVEAL_SEC));
}

// ---------------------------------------------------------------------------- CLIP_15 glass testimonial morph

export type GlassFrame = {
  /** Card scale about its anchor (1 on a hold, GLASS_SNAP_SCALE at the snap peak). */
  scale: number;
  /** 0 = the card sits at its home rect, 1 = centred in the frame (where the 2x card fits). */
  centre: number;
  /** Blur (px) on the card's content (text, icons). */
  contentBlurPx: number;
  /** Opacity of avatar + heart (hidden from the snap, faded back in last). */
  iconOpacity: number;
};

/** The card at timeline time t: opens mid-morph (snap from 1→2x, content already blurring) → settle → blur-in → icons → long readable hold. Never opens on the finished testimonial. */
export function glassFrame(timeSec: number): GlassFrame {
  const snapTo = GLASS_SNAP_TO_SEC;
  const settleTo = GLASS_SETTLE_TO_SEC;
  const blurTo = GLASS_BLUR_IN_TO_SEC;
  if (timeSec < snapTo) {
    const e = easeOutCubic(spanProgress(timeSec, GLASS_SNAP_FROM_SEC, snapTo));
    return {scale: mix(1, GLASS_SNAP_SCALE, e), centre: e, contentBlurPx: mix(GLASS_BLUR_PX * 0.55, GLASS_BLUR_PX, e), iconOpacity: 0};
  }
  if (timeSec < settleTo) {
    const settle = easeOutExpo(spanProgress(timeSec, snapTo, settleTo));
    return {scale: mix(GLASS_SNAP_SCALE, 1, settle), centre: 1 - settle, contentBlurPx: GLASS_BLUR_PX, iconOpacity: 0};
  }
  if (timeSec < blurTo) {
    const clear = easeOutCubic(spanProgress(timeSec, settleTo, blurTo));
    return {scale: 1, centre: 0, contentBlurPx: GLASS_BLUR_PX * (1 - clear), iconOpacity: 0};
  }
  return {scale: 1, centre: 0, contentBlurPx: 0, iconOpacity: spanProgress(timeSec, GLASS_ICON_FROM_SEC, GLASS_ICON_TO_SEC)};
}

// ---------------------------------------------------------------------------- CLIP_16 portrait push carousel

export type PushState = {
  /** Index of the card leaving (or holding) and the one entering (same while holding). */
  from: number;
  to: number;
  /** Eased push progress 0..1 (0 on every hold). */
  e: number;
  /** Scale of the holding / leaving card (micro zoom during holds, easing to PUSH_OUT_SCALE through a push). */
  outScale: number;
  /** Scale of the entering card (PUSH_IN_SCALE_FROM -> 1). */
  inScale: number;
};

const PUSH_M1_FROM = PUSH_HOLD_A_SEC;
const PUSH_M1_TO = PUSH_HOLD_A_SEC + PUSH_MOVE_1_SEC;
const PUSH_M2_FROM = PUSH_M1_TO + PUSH_HOLD_B_SEC;
const PUSH_M2_TO = PUSH_M2_FROM + PUSH_MOVE_2_SEC;

/** The deck at timeline time t. */
export function pushState(timeSec: number): PushState {
  const zoomEnd = 1 + PUSH_MICRO_ZOOM;
  if (timeSec < PUSH_M1_FROM) return {from: 0, to: 0, e: 0, outScale: 1 + PUSH_MICRO_ZOOM * spanProgress(timeSec, 0, PUSH_M1_FROM), inScale: 1};
  if (timeSec < PUSH_M1_TO) {
    const e = easeInOutCubic(spanProgress(timeSec, PUSH_M1_FROM, PUSH_M1_TO));
    return {from: 0, to: 1, e, outScale: mix(zoomEnd, PUSH_OUT_SCALE, e), inScale: mix(PUSH_IN_SCALE_FROM, 1, e)};
  }
  if (timeSec < PUSH_M2_FROM) return {from: 1, to: 1, e: 0, outScale: 1 + PUSH_MICRO_ZOOM * spanProgress(timeSec, PUSH_M1_TO, PUSH_M2_FROM), inScale: 1};
  if (timeSec < PUSH_M2_TO) {
    const e = easeInOutCubic(spanProgress(timeSec, PUSH_M2_FROM, PUSH_M2_TO));
    return {from: 1, to: 2, e, outScale: mix(zoomEnd, PUSH_OUT_SCALE, e), inScale: mix(PUSH_IN_SCALE_FROM, 1, e)};
  }
  return {from: 2, to: 2, e: 0, outScale: 1, inScale: 1};
}

/** Vertical centre travel (in card heights) between the leaving card (at the artboard centre when e = 0) and the entering one: lets the gap stay >= the 7.5% white gap at every e. */
export const pushTravel = (cardH: number, boardH: number): number => cardH * 0.5 * (1 + PUSH_OUT_SCALE) + PUSH_GAP * boardH;

// ---------------------------------------------------------------------------- WP50 CLIP_17..21 state functions

/** CLIP_17: visible-height fraction of every photo at timeline time t (1 on the hold, STACK_COLLAPSE_END_HEIGHT at the end; ease-in). Each photo's window closes about its own centre; the pixels never scale. */
export function stackCollapseHeight(timeSec: number): number {
  return mix(1, STACK_COLLAPSE_END_HEIGHT, easeInCubic(spanProgress(timeSec, STACK_COLLAPSE_FROM_SEC, STACK_COLLAPSE_TO_SEC)));
}

/** CLIP_18: cards stay fully opaque; the blank + mask handle visibility. */
export function stackRevealOpacity(_timeSec: number, _index: number): number {
  return 1;
}

/** CLIP_18: revealed height fraction of card `index` (top-anchored wipe, ease-out; 0 during the opening blank). */
export function stackRevealHeight(timeSec: number, index: number): number {
  if (timeSec < STACK_REVEAL_BLANK_TO_SEC) return 0;
  const from = STACK_REVEAL_BLANK_TO_SEC + (STACK_REVEAL_STAGGER_SEC[index] ?? 0);
  return easeOutCubic(spanProgress(timeSec, from, from + STACK_REVEAL_ITEM_SEC));
}

/** CLIP_19: 0 on the hold, 1 when both cards have slid fully off (top left / bottom right). */
export function twoUpExit(timeSec: number): number {
  return easeInCubic(spanProgress(timeSec, TWO_UP_EXIT_FROM_SEC, TWO_UP_EXIT_TO_SEC));
}

export type NeverDoneFrame = {
  /** Pure black frame (nothing else drawn). */
  black: boolean;
  /** Headline line centres (fractions of the artboard height). */
  lineY: readonly number[];
  /** Mask progress 0..1 per headline line (0 = hidden below its mask). */
  lineReveal: readonly number[];
  /** Photo window height as a fraction of the artboard (opens from the centre; 0 = no photo, 1 = full cover). */
  window: number;
};

/** CLIP_20 at timeline time t (starts black, ends on state A). */
export function neverDoneFrame(timeSec: number): NeverDoneFrame {
  const shown = [1, 1, 1, 1];
  if (timeSec < NEVER_DONE_POP_FROM_SEC) return {black: true, lineY: NEVER_DONE_Y_BLOCK, lineReveal: [0, 0, 0, 0], window: 0};
  if (timeSec < NEVER_DONE_SLIT_FROM_SEC) {
    const pair = (k: number) => easeOutCubic(spanProgress(timeSec, NEVER_DONE_POP_FROM_SEC + k * NEVER_DONE_POP_STAGGER_SEC, NEVER_DONE_POP_FROM_SEC + k * NEVER_DONE_POP_STAGGER_SEC + NEVER_DONE_POP_SEC));
    return {black: false, lineY: NEVER_DONE_Y_BLOCK, lineReveal: [pair(0), pair(0), pair(1), pair(1)], window: 0};
  }
  if (timeSec < NEVER_DONE_STATE_A_FROM_SEC) {
    const e = easeOutCubic(spanProgress(timeSec, NEVER_DONE_SLIT_FROM_SEC, NEVER_DONE_STATE_A_FROM_SEC));
    return {black: false, lineY: NEVER_DONE_Y_BLOCK.map((y, i) => mix(y, NEVER_DONE_Y_SPREAD[i]!, e)), lineReveal: shown, window: e};
  }
  return {black: false, lineY: NEVER_DONE_Y_SPREAD, lineReveal: shown, window: 1};
}

/** CLIP_21: cps for a live line so it still finishes inside the capture's window. */
export function typewriterCps(index: number, length: number): number {
  return Math.max(TYPEWRITER_LINE_CPS[index] ?? 14, length / (TYPEWRITER_LINE_WINDOW_SEC[index] ?? 0.6));
}

/** CLIP_21: block top (fraction of frame height) at timeline time t. */
export function typewriterBlockY(timeSec: number): number {
  return mix(TYPEWRITER_BLOCK_Y_FROM, TYPEWRITER_BLOCK_Y_TO, easeOutCubic(spanProgress(timeSec, TYPEWRITER_BLOCK_FROM_SEC, TYPEWRITER_BLOCK_TO_SEC)));
}

/** CLIP_21: bar expansion 0 (as wide as the typed line 1) .. 1 (TYPEWRITER_BAR_FULL_W of the frame). */
export function typewriterBarExpand(timeSec: number): number {
  return easeOutCubic(spanProgress(timeSec, TYPEWRITER_BAR_EXPAND_FROM_SEC, TYPEWRITER_BAR_EXPAND_TO_SEC));
}

/** CLIP_21: mark at timeline time t: fade-in, outline 0..1, rotation deg. */
export function typewriterMark(timeSec: number): {fadeIn: number; outline: number; rotateDeg: number} {
  return {
    fadeIn: spanProgress(timeSec, TYPEWRITER_MARK_IN_FROM_SEC, TYPEWRITER_MARK_IN_TO_SEC),
    outline: spanProgress(timeSec, TYPEWRITER_MARK_OUTLINE_FROM_SEC, TYPEWRITER_MARK_OUTLINE_TO_SEC),
    rotateDeg: -35 + (timeSec - TYPEWRITER_MARK_IN_FROM_SEC) * 60,
  };
}

/** @deprecated Prefer typewriterCps / typewriterBlockY / typewriterBarExpand / typewriterMark. */
export const livestreamCps = typewriterCps;
export const livestreamBlockY = typewriterBlockY;
export const livestreamBarExpand = typewriterBarExpand;
export const livestreamMark = typewriterMark;

// ---------------------------------------------------------------------------- WP51 CLIP_22..26 state functions

export type ChatBubbleFrame = {
  phase: 'hidden' | 'indicator' | 'pill' | 'expand' | 'words' | 'done';
  /** Opacity of each of the three indicator dots (0.35..1, 0.5 s pulse, 1/3 phase apart). */
  dots: readonly [number, number, number];
  /** 0 = indicator-sized pill .. 1 = final blank size. */
  expand: number;
  /** Per word: opacity 0..1 and rise offset in px (0 once settled). */
  words: ReadonlyArray<{fade: number; rise: number}>;
};

/** CLIP_22: state of the message that plays in cycle slot `slot` (0..3) at timeline time t. `wordCount` words rise one by one (125 ms apart). */
export function chatBubbleFrame(timeSec: number, slot: number, wordCount: number, indicatorOnly = false): ChatBubbleFrame {
  const start = CHAT_CYCLE_START_SEC[slot] ?? CHAT_BASE_SEC;
  const pillFrom = start + CHAT_INDICATOR_SEC;
  const expandFrom = pillFrom + CHAT_PILL_HOLD_SEC;
  const wordsFrom = expandFrom + CHAT_EXPAND_SEC;
  const none = Array.from({length: wordCount}, () => ({fade: 0, rise: 0}));
  const pulse = (k: number): number => 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(2 * Math.PI * ((timeSec - start) / CHAT_DOT_PULSE_SEC - k / 3)));
  const dots = [pulse(0), pulse(1), pulse(2)] as const;
  if (timeSec < start) return {phase: 'hidden', dots, expand: 0, words: none};
  if (indicatorOnly || timeSec < pillFrom) return {phase: 'indicator', dots, expand: 0, words: none};
  if (timeSec < expandFrom) return {phase: 'pill', dots, expand: 0, words: none};
  const expand = easeOutExpo(spanProgress(timeSec, expandFrom, wordsFrom));
  if (timeSec < wordsFrom) return {phase: 'expand', dots, expand, words: none};
  const words = Array.from({length: wordCount}, (_, k) => {
    const p = spanProgress(timeSec, wordsFrom + k * CHAT_WORD_SEC, wordsFrom + k * CHAT_WORD_SEC + CHAT_WORD_FADE_SEC);
    return {fade: p, rise: CHAT_WORD_RISE_PX * (1 - easeOutCubic(p))};
  });
  return {phase: timeSec >= wordsFrom + wordCount * CHAT_WORD_SEC + CHAT_WORD_FADE_SEC ? 'done' : 'words', dots, expand: 1, words};
}

export type SaleFrame = {
  /** True while the navy title card is up (0 .. SALE_CUT_SEC); the cut is a HARD cut (no dissolve). */
  titleCard: boolean;
  /** The clock ring: centre (fractions of the board) and width (fraction of board width). */
  dock: {x: number; y: number; w: number};
  /** Masked slide-up progress 0..1 of line 1 / line 2. */
  line1: number;
  line2: number;
  /** CTA pill fade 0..1 and scale 0.9..1. */
  pill: {fade: number; scale: number};
};

/** CLIP_23 at timeline time t. */
export function saleFrame(timeSec: number): SaleFrame {
  const dockE = easeOutExpo(spanProgress(timeSec, SALE_DOCK_FROM_SEC, SALE_DOCK_TO_SEC));
  const pill = spanProgress(timeSec, SALE_PILL_FROM_SEC, SALE_PILL_TO_SEC);
  return {
    titleCard: timeSec < SALE_CUT_SEC,
    dock: {x: mix(SALE_DOCK_FROM.x, SALE_DOCK_TO.x, dockE), y: mix(SALE_DOCK_FROM.y, SALE_DOCK_TO.y, dockE), w: mix(SALE_DOCK_FROM.w, SALE_DOCK_TO.w, dockE)},
    line1: easeOutExpo(spanProgress(timeSec, SALE_LINE1_FROM_SEC, SALE_LINE1_FROM_SEC + SALE_LINE_SEC)),
    line2: easeOutExpo(spanProgress(timeSec, SALE_LINE2_FROM_SEC, SALE_LINE2_FROM_SEC + SALE_LINE_SEC)),
    pill: {fade: easeOutCubic(pill), scale: mix(SALE_PILL_SCALE_FROM, 1, easeOutCubic(pill))},
  };
}

/** CLIP_24: the landing index (0 = the first beat) whose colour is on screen at timeline time t, for `landings` beats (a HARD cut exactly on each landing). */
export function wheelColorIndex(timeSec: number, landings = WHEEL_LANDING_SEC.length): number {
  let index = 0;
  for (let k = 1; k < Math.min(landings, WHEEL_LANDING_SEC.length); k += 1) if (timeSec >= WHEEL_LANDING_SEC[k]! - 1e-9) index = k;
  return index;
}

/** CLIP_24: fractional word-row position at timeline time t, given the first selected row `start` and `steps` scrolls (each 220 ms ease-out ending on its landing). */
export function wheelPosition(timeSec: number, start: number, steps: number): number {
  let pos = start;
  for (let k = 1; k <= Math.min(steps, WHEEL_LANDING_SEC.length - 1); k += 1) pos += easeOutCubic(spanProgress(timeSec, WHEEL_LANDING_SEC[k]! - WHEEL_SCROLL_SEC, WHEEL_LANDING_SEC[k]!));
  return pos;
}

/** CLIP_24: opacity of a wheel row `distance` rows from the selected one (white centre, 0.25 / 0.15 neighbours, fading out). */
export function wheelRowOpacity(distance: number): number {
  const d = Math.min(Math.abs(distance), WHEEL_NEIGHBOUR_OPACITY.length - 1);
  const lo = Math.floor(d);
  const hi = Math.min(lo + 1, WHEEL_NEIGHBOUR_OPACITY.length - 1);
  return mix(WHEEL_NEIGHBOUR_OPACITY[lo]!, WHEEL_NEIGHBOUR_OPACITY[hi]!, d - lo);
}

export type TrackingLineFrame = {
  /** Characters typed so far. */
  typed: number;
  /** Letter-spacing in em (0.7 -> 0). */
  trackingEm: number;
  /** Left indent as a fraction of the card's inner width (0.12 -> 0). */
  indent: number;
};

/** CLIP_25: state of line `index` (`chars` letters) at timeline time t. Before its start the line is not drawn (typed = 0). */
export function trackingLineFrame(timeSec: number, index: number, chars: number): TrackingLineFrame {
  const start = TRACKING_LINE_START_SEC[index] ?? TRACKING_HOLD_FROM_SEC;
  if (timeSec < start) return {typed: 0, trackingEm: TRACKING_FROM_EM, indent: TRACKING_INDENT};
  const per = trackingCharSec(index, chars);
  const typed = Math.min(chars, Math.floor((timeSec - start) / per + 1e-9) + 1);
  const e = easeOutCubic(spanProgress(timeSec, start, start + TRACKING_COLLAPSE_SEC));
  return {typed, trackingEm: mix(TRACKING_FROM_EM, 0, e), indent: mix(TRACKING_INDENT, 0, e)};
}

export type SpatialFrame = {
  /** Gaussian blur in px (36 -> 0). */
  blurPx: number;
  rotateDeg: number;
  fade: number;
  /** Text centre as fractions of the board. */
  x: number;
  y: number;
  /** 1 -> 0.93 over the hold. */
  scale: number;
};

/** CLIP_26 at timeline time t. */
export function spatialFrame(timeSec: number): SpatialFrame {
  const e = easeOutExpo(spanProgress(timeSec, 0, SPATIAL_IN_SEC));
  return {
    blurPx: mix(SPATIAL_BLUR_FROM_PX, 0, e),
    rotateDeg: mix(SPATIAL_ROTATE_FROM_DEG, 0, e),
    fade: mix(SPATIAL_FADE_FROM, 1, e),
    x: mix(SPATIAL_FROM_POS.x, 0.5, e),
    y: mix(SPATIAL_FROM_POS.y, 0.5, e),
    scale: mix(1, SPATIAL_SCALE_TO, easeInOutCubic(spanProgress(timeSec, SPATIAL_SCALE_FROM_SEC, SPATIAL_BASE_SEC))),
  };
}

/** CLIP_26: ring count visible at timeline time t (3 at the start -> 7). */
export function spatialRingCount(timeSec: number): number {
  return SPATIAL_RING_BIRTH_SEC.filter(birth => timeSec >= birth).length;
}
