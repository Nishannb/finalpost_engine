/**
 * WP41: LIME L->R WIPE HIGHLIGHT (Skill B, `explainer-grammar.yaml` `highlight`): a lime #BFFF00 bar wipes left-to-right BEHIND the key phrase on a screenshot / article plate while the REST of the plate
 * dims to ~0.28 opacity. PURE (no React, no imports). Rects are fractions of the plate (x, y, w, h in 0..1); a phrase that wraps over several lines is several rects, wiped in reading order as ONE sweep
 * (the speed is the same on every line: each rect gets a share of the sweep proportional to its width).
 */

export const LIME_HIGHLIGHT_COLOR = '#BFFF00';
export const LIME_HIGHLIGHT = {
  color: LIME_HIGHLIGHT_COLOR,
  /** The rest of the plate drops to this opacity (grammar `dim_rest_to`). */
  dimTo: 0.28,
  /** Frames the dim takes to land (starts on the highlight's first frame). */
  dimFrames: 5,
  /** Frames the whole L->R sweep takes. */
  wipeFrames: 12,
  /** Frames the wipe waits after the dim has started (so the eye sees the page dim, then the bar sweep). */
  wipeDelayFrames: 2,
  /** The bar is a touch bigger than the phrase box (fractions of the plate): breathing room for the ink. */
  padX: 0.012,
  padY: 0.004,
} as const;

export type HighlightRect = {x: number; y: number; w: number; h: number};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Opacity of the REST of the plate: 1 before the highlight, `dimTo` once the dim has landed (linear over `dimFrames`). `frame` = frames since the highlight started. */
export function limeDimOpacity(frame: number, dimTo: number = LIME_HIGHLIGHT.dimTo, dimFrames: number = LIME_HIGHLIGHT.dimFrames): number {
  if (frame <= 0) return 1;
  const t = clamp01(frame / Math.max(1, dimFrames));
  return 1 + (dimTo - 1) * t;
}

/** Overall wipe progress 0..1 (eased), starting `wipeDelayFrames` after the highlight started. */
export function limeWipeProgress(frame: number, wipeFrames: number = LIME_HIGHLIGHT.wipeFrames, delayFrames: number = LIME_HIGHLIGHT.wipeDelayFrames): number {
  return easeOutCubic(clamp01((frame - delayFrames) / Math.max(1, wipeFrames)));
}

/** The padded bar rect for a phrase rect (clamped into the plate). */
export function limeBarRect(rect: HighlightRect, padX: number = LIME_HIGHLIGHT.padX, padY: number = LIME_HIGHLIGHT.padY): HighlightRect {
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  return {x, y, w: Math.min(1 - x, rect.w + 2 * padX), h: Math.min(1 - y, rect.h + 2 * padY)};
}

/**
 * One sweep over several rects (reading order): the fraction 0..1 of each rect that is covered at overall progress `progress`. Widths are the weights, so a short last line does not rush.
 * A single rect is just `[progress]`. Always monotone in `progress`; a rect is full before the next one starts.
 */
export function limeRectFractions(rects: readonly HighlightRect[], progress: number): number[] {
  const total = rects.reduce((acc, rect) => acc + Math.max(0, rect.w), 0);
  if (total <= 0) return rects.map(() => 0);
  let before = 0;
  return rects.map(rect => {
    const share = Math.max(0, rect.w) / total;
    const fraction = clamp01((clamp01(progress) - before) / share);
    before += share;
    return fraction;
  });
}

/** Frame (since the highlight started) at which the wipe is complete. */
export function limeWipeDoneFrame(wipeFrames: number = LIME_HIGHLIGHT.wipeFrames, delayFrames: number = LIME_HIGHLIGHT.wipeDelayFrames): number {
  return delayFrames + wipeFrames;
}
