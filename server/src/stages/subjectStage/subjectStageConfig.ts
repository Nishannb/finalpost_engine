/**
 * SUBJECT STAGE style bible (pure constants). Flag: env POLISH_SUBJECT_STAGE (default off; analyze does not read it until the wiring phase).
 *
 * The motion / bg ranges are re-exported from ./stageMotion.ts, which is byte-identical with the Remotion twin, so the planner and the renderer can never disagree about a range.
 * Everything here is macro structure from the grammar (layer logic, timing, shares); no fonts, brands, languages or icons from any reference.
 */
import {
  AUTO_SCROLL_PCT_H_PER_S_RANGE,
  AUTO_SCROLL_SEC_RANGE,
  BG_BLUR_PX_RANGE,
  BG_DEFAULT,
  BG_DIM_PCT_RANGE,
  DROP_IN_TILT_SEC_RANGE,
  FALL_TILT_OUT_SEC,
  FLASH_CUT_SEC_RANGE,
  POP_IN_SEC_RANGE,
  S2_PLACEMENT_DEFAULT,
  S2_X_PCT_RANGE,
  S5_COVERAGE_PCT,
  S5_MAX_DURATION_SEC,
  SLIDE_UP_FRONT_MIN_HOLD_SEC,
  SLIDE_UP_FRONT_SEC,
  SLOW_PUSH_PCT_RANGE,
  SLOW_PUSH_SEC_RANGE,
  STAGE_BEHIND_OPACITY,
  STAGE_IDS,
  STAGE_ROOM_BLUR,
  type StageId,
} from './stageMotion.ts';

export const SUBJECT_STAGE_STYLE_ID = 'subject_stage' as const;
export {STAGE_IDS, type StageId};

/** The five stage states and what each one draws. `behindOpacity` is the layer BEHIND the subject; S5 is the only layer IN FRONT of her. */
export const SUBJECT_STAGE_STATES = {
  S1: {name: 'full_plate', behindOpacity: STAGE_BEHIND_OPACITY.S1, bg: 'replaced', motion: ['native_video_or_static'], layer: 'behind'}, // a plate always carries the spoken headline (never blank)
  S2: {name: 'card_behind_head', behindOpacity: STAGE_BEHIND_OPACITY.S2, bg: 'room_blur_dim', motion: ['slow_push'], layer: 'behind'},
  S3: {name: 'ghost_scroll', behindOpacity: STAGE_BEHIND_OPACITY.S3, bg: 'room_blur_dim', motion: ['auto_scroll'], layer: 'behind'},
  S4: {name: 'neutral_accents', behindOpacity: STAGE_BEHIND_OPACITY.S4, bg: 'room_blur_dim', motion: ['pop_in', 'drop_in_tilt', 'text_stack_build', 'fall_tilt_out'], layer: 'behind'},
  S5: {name: 'foreground_takeover', behindOpacity: 0, bg: 'room_blur_dim', motion: ['slide_up_front'], layer: 'front'}, // covers the WHOLE frame, edge to edge
} as const;

/** Share of the runtime each stage should take over a long edit (targets, not caps). */
export const SUBJECT_STAGE_SHARES: Readonly<Record<StageId, number>> = {S1: 0.35, S2: 0.19, S3: 0.15, S4: 0.25, S5: 0.05};

/** Which speech intent selects which stage (the planner's lexical classifier will emit these intents). */
export const SUBJECT_STAGE_INTENTS = {
  context_or_setting: ['S1'],
  quoting_or_citing: ['S2'],
  search_or_many_sources: ['S3'],
  explanation_key_terms: ['S4'],
  official_or_final: ['S1', 'S5'],
  confirmation_or_verdict: ['S4'],
} as const satisfies Record<string, readonly StageId[]>;
export type SubjectStageIntent = keyof typeof SUBJECT_STAGE_INTENTS;

/** Rhythm: a stage is 3-7 s (never under 1.4 s), accents repeat every 1-2 s, heavy (asset) stages alternate with neutral ones. */
export const SUBJECT_STAGE_RHYTHM = {
  stageDurationSec: [3, 7] as const,
  minStageSec: 1.4,
  accentIntervalSec: [1, 2] as const,
  /** never the same stage twice in a row; at most this many asset-heavy stages (S1/S2/S3/S5) before an S4. */
  maxHeavyInARow: 2,
  /** keyword-driven accents / echo: at most one hit per this many seconds. */
  keywordMinIntervalSec: 1,
  /** at most one front takeover per video. */
  maxS5PerVideo: 1,
} as const;

export const SUBJECT_STAGE_TRANSITIONS = {default: 'hard_cut', topicJump: 'hard_cut+flash_cut', toS5: 'slide_up_front'} as const;

/** Room treatment under the cutout: dim 15-20 % only. Spatial blur is forbidden under the RVM cutout (blur-mirror ghost). */
export const SUBJECT_STAGE_BG = {blurPx: BG_BLUR_PX_RANGE, dimPct: BG_DIM_PCT_RANGE, default: BG_DEFAULT, mask: 'dim_only_under_cutout', roomBlurByStage: STAGE_ROOM_BLUR} as const;

/** Motion ranges, straight from the grammar. */
export const SUBJECT_STAGE_MOTION = {
  autoScrollPctHPerSec: AUTO_SCROLL_PCT_H_PER_S_RANGE,
  autoScrollSec: AUTO_SCROLL_SEC_RANGE,
  slowPushPct: SLOW_PUSH_PCT_RANGE,
  slowPushSec: SLOW_PUSH_SEC_RANGE,
  popInSec: POP_IN_SEC_RANGE,
  dropInTiltSec: DROP_IN_TILT_SEC_RANGE,
  fallTiltOutSec: FALL_TILT_OUT_SEC,
  slideUpFrontSec: SLIDE_UP_FRONT_SEC,
  slideUpFrontMinHoldSec: SLIDE_UP_FRONT_MIN_HOLD_SEC,
  flashCutSec: FLASH_CUT_SEC_RANGE,
} as const;

/** S2 card placement (percent of the frame) and S5 coverage / duration cap. */
export const SUBJECT_STAGE_PLACEMENT = {s2: S2_PLACEMENT_DEFAULT, s2XPctRange: S2_X_PCT_RANGE, s5CoveragePct: S5_COVERAGE_PCT, s5MaxDurationSec: S5_MAX_DURATION_SEC} as const;

/** Subject framing the planner assumes: head top ~28-30 % from the top, captions at ~76-80 % of the height. */
export const SUBJECT_STAGE_FRAMING = {headTopFrac: [0.28, 0.3] as const, captionTopFrac: [0.76, 0.8] as const} as const;

/** Matte budget for the style (locked default): the WHOLE run needs RVM, so mps / cuda always, CPU only for short videos. */
export const SUBJECT_STAGE_MATTE = {
  cpuMaxVideoSec: 45,
  fullDeviceValues: ['mps', 'cuda'] as const,
  /** hard ceiling for a whole-run RVM extraction even on a GPU device (analyze must not hold a job for tens of minutes); a keyable backdrop (chroma) or a provided cutout is not capped. */
  maxVideoSec: 120,
} as const;

/** Only these skills may run the style; faceless / explainer / newsroom lanes disable it. */
export const SUBJECT_STAGE_DISABLED_UNDER = ['faceless', 'explainer', 'newsroom'] as const;

/** Planner constants (Phase 3). Soft targets are marked as such; the hard rules are enforced and re-checked by `validateSubjectStagePlan`. */
export const SUBJECT_STAGE_PLANNER = {
  /** a stage shorter than this is never emitted (hard). */
  minStageSec: SUBJECT_STAGE_RHYTHM.minStageSec,
  /** preferred stage length (soft): cuts fall on sentence / topic boundaries and units are grown to at least `preferredMinSec`, never past `preferredMaxSec` unless a single sentence is longer (then it is split). */
  preferredMinSec: SUBJECT_STAGE_RHYTHM.stageDurationSec[0],
  preferredMaxSec: SUBJECT_STAGE_RHYTHM.stageDurationSec[1],
  /** a topic jump flashes only when the previous flash is at least this far back (a strobe guard). */
  flashMinGapSec: 4,
  /** accents: single accents live 1-2 s; a text_stack needs at least this long; nothing starts closer than this to the stage end. */
  accentMinSec: 1,
  accentMaxSec: 2,
  stackMinSec: 1.2,
  stackMaxLines: 4,
  /** S5 only for an official / final unit that starts at least this far into the video. */
  s5EarliestSec: 2,
  /** S3 result-page rows: fewer than this is reported (the scroll has little to scroll). */
  s3MinRows: 6,
  s3MaxRows: 12,
  /** quote card text cap (characters, at a word boundary). */
  quoteMaxChars: 140,
  /** videos shorter than this get no stage plan. */
  minVideoSec: 3,
  /** the behind layer is never visually empty for longer than this (short-form rule): a gap with no visible behind content (S1 / S2 / S3 with a real asset, S4 with an on-screen accent, S5) is illegal. Opening included. */
  behindGapMaxSec: 0.5,
  /** S1 native plate copy: a headline (and an optional subline) of the spoken unit, cut at a word. */
  plateHeadlineMax: 70,
  plateSublineMax: 80,
  /** an S4 accent may show its keyword this much (s) before it is spoken (the S4 stage always opens with an accent); longer anticipation is reported. */
  accentAnticipationWarnSec: 1,
} as const;
