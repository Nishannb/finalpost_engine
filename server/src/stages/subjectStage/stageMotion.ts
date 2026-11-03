/**
 * SUBJECT STAGE (style_id `subject_stage`): pure motion + layout math.
 *
 * The speaker (RVM cutout) is a fixed identity layer; every move below is applied to the layer BEHIND her (or, for S5, the one in FRONT). Nothing here ever animates the subject.
 * Stage states: S1 full plate (behind 100 %, bg replaced), S2 opaque card behind the head, S3 ghost scroll (behind ~0.5), S4 neutral + accents, S5 foreground takeover (in front of the subject).
 *
 * Kept BYTE-IDENTICAL with server/src/stages/subjectStage/stageMotion.ts (the server build cannot import the remotion tree; stageMotion.test.ts pins the two files together).
 * PURE: no React, no remotion, no env, no imports. All times are seconds, all angles degrees, all fractions of the frame unless a name says Px / Pct.
 */

export type StageId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export const STAGE_IDS: readonly StageId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

// ------------------------------------------------------------------------------------------------ spec ranges (single source of truth; the server config re-exports them)
/** Opacity of the layer behind the subject, per stage (S5 draws in FRONT of the subject). */
export const STAGE_BEHIND_OPACITY: Readonly<Record<StageId, number>> = {S1: 1, S2: 1, S3: 0.5, S4: 0, S5: 1};
/**
 * Stages that dim the original room under the cutout (S1 replaces the room with a plate).
 * Named STAGE_ROOM_BLUR for history; the treatment is DIM ONLY — see BG_BLUR_PX_RANGE.
 */
export const STAGE_ROOM_BLUR: Readonly<Record<StageId, boolean>> = {S1: false, S2: true, S3: true, S4: true, S5: true};

/**
 * Spatial CSS blur under an RVM cutout is FORBIDDEN: blur spreads the person outside the silhouette and creates a
 * "blur mirror" ghost behind the matte. Room separation is dim-only until a true background-only plate exists.
 * Range kept at [0,0] so planners/tests that still pass blurPx cannot reintroduce the ghost.
 */
export const BG_BLUR_PX_RANGE = [0, 0] as const;
export const BG_DIM_PCT_RANGE = [15, 20] as const;
export const BG_DEFAULT = {blurPx: 0, dimPct: 18} as const;

export const AUTO_SCROLL_PCT_H_PER_S_RANGE = [15, 20] as const;
export const AUTO_SCROLL_DEFAULT_PCT = 18;
export const AUTO_SCROLL_SEC_RANGE = [4, 6] as const;

export const SLOW_PUSH_PCT_RANGE = [4, 6] as const;
export const SLOW_PUSH_DEFAULT_PCT = 5;
export const SLOW_PUSH_SEC_RANGE = [3, 6] as const;

export const POP_IN_SEC_RANGE = [0.25, 0.3] as const;
export const DROP_IN_TILT_SEC_RANGE = [0.3, 0.5] as const;
export const FALL_TILT_OUT_SEC = 0.7;
export const SLIDE_UP_FRONT_SEC = 0.3;
/** S5 stays at least this long once it has slid in, and never longer than the cap (the takeover covers the face: hard-capped). */
export const SLIDE_UP_FRONT_MIN_HOLD_SEC = 1.5;
export const S5_MAX_DURATION_SEC = 3;
/** S5 is a FULL takeover: the asset covers the WHOLE frame, edge to edge (100 % width AND height; no card with margins, no strip of subject or room left). The slide-up animates in from below; the HOLD frame is full-bleed. */
export const S5_COVERAGE_PCT = 100;
export const FLASH_CUT_SEC_RANGE = [0.07, 0.1] as const;
export const FLASH_CUT_PEAK = 0.9;
export const TEXT_STACK_LINE_SEC = 0.25;
export const TEXT_EXIT_FOLLOW_SEC = 0.25;

/** S2 card: x centre / width and top bleed (percent of the frame). The subject's head covers the lower ~20-25 % of the card; the planner keeps the face clear. */
export const S2_PLACEMENT_DEFAULT = {xPct: 51, yPct: -2, wPct: 58, hPct: 46} as const;
export const S2_X_PCT_RANGE = [22, 80] as const;
/** Accent text lives in the top band (above the head, which starts at ~28 % of the frame height). */
export const ACCENT_BAND_TOP_FRAC = 0.06;
export const ACCENT_BAND_BOTTOM_FRAC = 0.28;

/** Abstract tokens only (no brand colours from any reference): a soft warm wash, a neutral dim, signal accents. */
export const STAGE_TOKENS = {
  warmWash: 'rgba(255, 214, 170, 0.22)',
  warmWashEdge: 'rgba(255, 236, 214, 0.0)',
  dim: '#000000',
  paper: '#F3F0EA',
  ink: '#1A1A1A',
  signal: '#3D4A5C',
  signalHot: '#C8442F',
} as const;

// ------------------------------------------------------------------------------------------------ small numeric helpers
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Progress 0..1 of `t` inside [from, from + dur]. */
export const phase = (t: number, from: number, dur: number): number => (dur <= 0 ? (t >= from ? 1 : 0) : clamp01((t - from) / dur));
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
/** Ease-out with a small overshoot (peaks ~1.07): the pop / drop entrances. */
export const easeOutBack = (t: number): number => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------------------------------------------ motions on the BEHIND layer
/**
 * auto_scroll: linear vertical scroll of a tall asset, ~15-20 % of the frame height per second over a 4-6 s stage. Returns the offset in px (move the content UP by this much). With `contentHeightPx`
 * the scroll stops at the end of the content (never scrolls past it).
 */
export function autoScrollOffsetPx(tSec: number, opts: {frameHeightPx: number; pctHPerSec?: number; contentHeightPx?: number}): number {
  const pct = clamp(opts.pctHPerSec ?? AUTO_SCROLL_DEFAULT_PCT, AUTO_SCROLL_PCT_H_PER_S_RANGE[0], AUTO_SCROLL_PCT_H_PER_S_RANGE[1]);
  const raw = Math.max(0, tSec) * (pct / 100) * opts.frameHeightPx;
  const max = opts.contentHeightPx !== undefined ? Math.max(0, opts.contentHeightPx - opts.frameHeightPx) : Infinity;
  return round3(Math.min(raw, max));
}

/** slow_push: scale 1 -> 1 + 4-6 % over 3-6 s, ease-out (the push settles instead of running to the cut). `stageSec` is the stage length. */
export function slowPushScale(tSec: number, stageSec: number, scalePct: number = SLOW_PUSH_DEFAULT_PCT): number {
  const pct = clamp(scalePct, SLOW_PUSH_PCT_RANGE[0], SLOW_PUSH_PCT_RANGE[1]);
  const dur = clamp(stageSec, SLOW_PUSH_SEC_RANGE[0], SLOW_PUSH_SEC_RANGE[1]);
  return round3(1 + (pct / 100) * easeOutCubic(phase(tSec, 0, dur)));
}

// ------------------------------------------------------------------------------------------------ accents (S4) — state of one small element
export type AccentState = {opacity: number; scale: number; /** fractions of the frame height, + = down */ translateYFrac: number; rotateDeg: number};
const HIDDEN: AccentState = {opacity: 0, scale: 1, translateYFrac: 0, rotateDeg: 0};

/** pop_in (250-300 ms): scale 0.6 -> 1 with a small overshoot, opacity ramps over the first 60 %. */
export function popInState(tSinceStart: number, durSec: number = 0.28): AccentState {
  if (tSinceStart < 0) return HIDDEN;
  const dur = clamp(durSec, POP_IN_SEC_RANGE[0], POP_IN_SEC_RANGE[1]);
  const p = phase(tSinceStart, 0, dur);
  return {opacity: round3(clamp01(p / 0.6)), scale: round3(lerp(0.6, 1, easeOutBack(p))), translateYFrac: 0, rotateDeg: 0};
}

/** drop_in_tilt (300-500 ms): drops from above the rest position while the tilt settles to `restTiltDeg`. */
export function dropInTiltState(tSinceStart: number, opts: {durSec?: number; restTiltDeg?: number} = {}): AccentState {
  if (tSinceStart < 0) return HIDDEN;
  const dur = clamp(opts.durSec ?? 0.4, DROP_IN_TILT_SEC_RANGE[0], DROP_IN_TILT_SEC_RANGE[1]);
  const rest = opts.restTiltDeg ?? -3;
  const p = phase(tSinceStart, 0, dur);
  const e = easeOutBack(p);
  return {opacity: round3(clamp01(p / 0.5)), scale: 1, translateYFrac: round3(lerp(-0.12, 0, e)), rotateDeg: round3(lerp(rest - 12, rest, e))};
}

/** fall_tilt_out (~700 ms): the element tips and falls away; hidden once finished. `tSinceExit` = seconds since the exit started. */
export function fallTiltOutState(tSinceExit: number, opts: {restTiltDeg?: number} = {}): AccentState {
  if (tSinceExit <= 0) return {opacity: 1, scale: 1, translateYFrac: 0, rotateDeg: opts.restTiltDeg ?? 0};
  const p = phase(tSinceExit, 0, FALL_TILT_OUT_SEC);
  if (p >= 1) return HIDDEN;
  const e = easeInCubic(p);
  const rest = opts.restTiltDeg ?? 0;
  return {opacity: round3(1 - clamp01((p - 0.35) / 0.65)), scale: 1, translateYFrac: round3(lerp(0, 0.22, e)), rotateDeg: round3(lerp(rest, rest + 14, e))};
}

/** One accent over its whole life: enters with `enter`, holds, then falls out over its last 700 ms (when `fallOut`). `t` is seconds since the accent started, `durSec` its length. */
export function accentState(kind: 'pop_in' | 'drop_in_tilt', t: number, durSec: number, fallOut = true): AccentState {
  const restTilt = kind === 'drop_in_tilt' ? -3 : 0;
  const entered = kind === 'pop_in' ? popInState(t) : dropInTiltState(t, {restTiltDeg: restTilt});
  if (!fallOut) return t >= durSec ? HIDDEN : entered;
  const exitStart = Math.max(0, durSec - FALL_TILT_OUT_SEC);
  if (t >= exitStart && t < durSec) return fallTiltOutState(t - exitStart, {restTiltDeg: restTilt});
  return t >= durSec ? HIDDEN : entered;
}

// ------------------------------------------------------------------------------------------------ text stack (S4): lines appended on the next keyword, slot continuity, exit follows the stage
export type StackLineState = {visible: boolean; opacity: number; /** em of the line's own height, + = down (the line settles up into place) */ translateYEm: number};

/**
 * One line of a text_stack. `lineStarts[i]` = seconds (since the stack started) at which line i is appended (the next keyword); lines already on screen stay (slot continuity: a line never moves
 * when the next one is appended). `stackSec` = how long the whole stack lives; during the last TEXT_EXIT_FOLLOW_SEC every line fades together (text_exit_follow).
 */
export function textStackLineState(t: number, lineStarts: readonly number[], index: number, stackSec: number): StackLineState {
  const start = lineStarts[index];
  if (start === undefined || t < start || t >= stackSec) return {visible: false, opacity: 0, translateYEm: 0.4};
  const p = easeOutCubic(phase(t, start, TEXT_STACK_LINE_SEC));
  const exit = 1 - easeInCubic(phase(t, stackSec - TEXT_EXIT_FOLLOW_SEC, TEXT_EXIT_FOLLOW_SEC));
  return {visible: true, opacity: round3(p * exit), translateYEm: round3(lerp(0.4, 0, p))};
}

/** Default append times for `n` lines inside a stack of `stackSec` seconds when the planner gave none: line 0 at 0, the rest spread over the first 70 %. */
export function defaultLineStarts(n: number, stackSec: number): number[] {
  if (n <= 0) return [];
  return Array.from({length: n}, (_, i) => (n === 1 ? 0 : round3((i / (n - 1)) * Math.max(0, stackSec * 0.7))));
}

/** Slot rectangles (fractions of the frame) for small S4 elements. Slots are stable: slot 0 top-left, 1 top-right, 2 top-centre (the stack). All inside the top accent band. */
export function accentSlotRect(slot: number): {left: number; top: number; width: number; height: number} {
  const top = ACCENT_BAND_TOP_FRAC;
  const height = ACCENT_BAND_BOTTOM_FRAC - ACCENT_BAND_TOP_FRAC;
  switch (((Math.round(slot) % 3) + 3) % 3) {
    case 0:
      return {left: 0.06, top, width: 0.4, height};
    case 1:
      return {left: 0.54, top, width: 0.4, height};
    default:
      return {left: 0.1, top, width: 0.8, height};
  }
}

// ------------------------------------------------------------------------------------------------ S5 front takeover + flash cut
export type SlideState = {/** fraction of the FRAME height the layer is still shifted down from its rest position (1 = fully off-screen below, 0 = covering the whole frame) */ offsetFrac: number; visible: boolean};

/**
 * slide_up_front (~300 ms): the full-frame front layer slides up from below the frame, then HOLDS (covering the whole frame) until the stage ends (>= 1.5 s, capped at S5_MAX_DURATION_SEC). `stageSec` is clamped to that cap; past it the layer is gone
 * (a hard cut out, no slide down).
 */
export function slideUpFrontState(t: number, stageSec: number): SlideState {
  const end = Math.min(stageSec, S5_MAX_DURATION_SEC);
  if (t < 0 || t >= end) return {offsetFrac: 1, visible: false};
  return {offsetFrac: round3(1 - easeOutCubic(phase(t, 0, SLIDE_UP_FRONT_SEC))), visible: true};
}

/** Whether a front stage of this length is allowed at all: it must be able to slide in AND hold. */
export const s5LengthOk = (stageSec: number): boolean => stageSec >= SLIDE_UP_FRONT_SEC + SLIDE_UP_FRONT_MIN_HOLD_SEC;

/** flash_cut: a 70-100 ms white pulse at a cut (fast up, slightly slower down). `tSinceCut` = seconds since the cut frame. 0 outside the pulse. */
export function flashCutOpacity(tSinceCut: number, durSec: number = 0.085): number {
  const dur = clamp(durSec, FLASH_CUT_SEC_RANGE[0], FLASH_CUT_SEC_RANGE[1]);
  if (tSinceCut < 0 || tSinceCut >= dur) return 0;
  const p = tSinceCut / dur;
  const tri = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
  return round3(FLASH_CUT_PEAK * clamp01(tri));
}

// ------------------------------------------------------------------------------------------------ background treatment (room dim — no spatial blur under the cutout)
/**
 * @deprecated Unused: spatial blur under the cutout was removed (blur-mirror ghost). Kept so old imports compile.
 */
export const ROOM_MATTE_PUNCH_SCALE = 1.06;

/**
 * CSS filter for the room under the cutout: DIM ONLY (`brightness`).
 * Never emits `blur()` — that spreads the person outside the RVM silhouette and shows a ghost behind the cutout.
 */
export function backdropFilterCss(bg?: {blurPx?: number; dimPct?: number}): string {
  void bg?.blurPx; // ignored on purpose (see BG_BLUR_PX_RANGE)
  const dim = clamp(bg?.dimPct ?? BG_DEFAULT.dimPct, BG_DIM_PCT_RANGE[0], BG_DIM_PCT_RANGE[1]);
  const b = Math.round((1 - dim / 100) * 1000) / 1000;
  return `brightness(${b})`;
}

/** Join two CSS filters. With nothing to add the first is returned UNCHANGED (undefined stays undefined): the no-op guarantee for blueprints without a stage. */
export function combineFilters(a: string | undefined, b: string | undefined): string | undefined {
  if (!b) return a;
  if (!a) return b;
  return `${a} ${b}`;
}

/** ghost S3: horizontal CSS mask that fades the ghost page out toward the subject (subject_side feather). `cxFrac`/`halfWFrac` = the subject's centre and half width (fractions of the frame width). */
export function ghostFeatherMask(cxFrac: number = 0.5, halfWFrac: number = 0.22): string {
  const inner = clamp(cxFrac - halfWFrac * 0.6, 0.02, 0.98);
  const innerR = clamp(cxFrac + halfWFrac * 0.6, 0.02, 0.98);
  const outer = clamp(cxFrac - halfWFrac * 1.5, 0, inner);
  const outerR = clamp(cxFrac + halfWFrac * 1.5, innerR, 1);
  const pct = (n: number) => `${round3(n * 100)}%`;
  return `linear-gradient(to right, #000 0%, #000 ${pct(outer)}, rgba(0,0,0,0.25) ${pct(inner)}, rgba(0,0,0,0.25) ${pct(innerR)}, #000 ${pct(outerR)}, #000 100%)`;
}

/** Soft warm wash drawn over the ghost page (a vertical gradient from the warm tone to transparent). */
export const warmWashGradient = (): string => `linear-gradient(to bottom, ${STAGE_TOKENS.warmWash} 0%, ${STAGE_TOKENS.warmWashEdge} 100%)`;

// ------------------------------------------------------------------------------------------------ span model helpers (structural types: the blueprint types satisfy them)
export type StageSpanLike = {start: number; end: number; stage: StageId};
export type StageLike = {matteUrl: string; bg?: {blurPx?: number; dimPct?: number}; spans: readonly StageSpanLike[]};

/** The span on screen at `t` (half-open [start, end)). */
export function stageSpanAt<T extends StageSpanLike>(spans: readonly T[] | undefined, t: number): T | undefined {
  return spans?.find(span => t >= span.start && t < span.end);
}

/** The room filter for the speaker video at `t`: the bg treatment while an S2-S5 span is on screen, undefined otherwise (also undefined for an absent stage). */
export function stageBackdropFilterAt(stage: StageLike | undefined, t: number): string | undefined {
  if (!stage) return undefined;
  const span = stageSpanAt(stage.spans, t);
  return span && STAGE_ROOM_BLUR[span.stage] ? backdropFilterCss(stage.bg) : undefined;
}

/** The person foreground the stage needs: the RVM matte over the union of its spans (touching / overlapping spans merge). Undefined for an absent / matte-less stage. */
export function foregroundFromStage(stage: StageLike | undefined): {videoUrl: string; spans: Array<{start: number; end: number}>} | undefined {
  if (!stage || !stage.matteUrl.trim() || stage.spans.length === 0) return undefined;
  const sorted = stage.spans.map(s => ({start: s.start, end: s.end})).filter(s => s.end > s.start).sort((x, y) => x.start - y.start);
  const merged: Array<{start: number; end: number}> = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + 1e-6) last.end = Math.max(last.end, span.end);
    else merged.push({...span});
  }
  return merged.length > 0 ? {videoUrl: stage.matteUrl.trim(), spans: merged} : undefined;
}
