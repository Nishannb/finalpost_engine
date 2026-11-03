/**
 * WP54 craft timing for the L2 comps (PURE: no React, no remotion import, so server tests can pin it). Mirrors server/src/stages/broll/motionCraftStandards.ts (a test keeps the numbers equal).
 * Source: iart-ai/motion-design-skills (MIT) documentation recipes, translated to Remotion — no engine vendored.
 */
export type Bezier = readonly [number, number, number, number];

export const ENTER_EASE_OUT: Bezier = [0.16, 1, 0.3, 1];
export const EXIT_EASE_IN: Bezier = [0.7, 0, 0.84, 0];
export const MOVE_IN_OUT: Bezier = [0.65, 0, 0.35, 1];
export const PLAYFUL_OVERSHOOT: Bezier = [0.34, 1.56, 0.64, 1];

/** CSS-style cubic-bezier (x1,y1,x2,y2) evaluated at progress t in 0..1 (Newton + bisection fallback). */
export function bezierAt(curve: Bezier, t: number): number {
  const [x1, y1, x2, y2] = curve;
  const x = Math.min(1, Math.max(0, t));
  if (x === 0 || x === 1) return x;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(s) - x;
    if (Math.abs(err) < 1e-6) return sampleY(s);
    const d = slopeX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 24; i++) {
    const v = sampleX(s);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return sampleY(s);
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Progress 0..1 of `t` inside [from, from + dur]. */
export const phase = (t: number, from: number, dur: number): number => (dur <= 0 ? (t >= from ? 1 : 0) : clamp01((t - from) / dur));

/** Eased progress of `t` inside [from, from + dur] on a craft curve. */
export const eased = (curve: Bezier, t: number, from: number, dur: number): number => bezierAt(curve, phase(t, from, dur));

export const STAGGER_MIN_SEC = 0.02;
export const STAGGER_MAX_SEC = 0.08;
export const STAGGER_GROUP_CAP_SEC = 0.8;

export function staggerStep(count: number): number {
  if (count <= 1) return 0;
  return Math.min(STAGGER_MAX_SEC, Math.max(STAGGER_MIN_SEC, STAGGER_GROUP_CAP_SEC / (count - 1)));
}

/** WP54 type templates share one skeleton: enter (ui band), hold, exit (shorter than the enter). Base seconds. */
export const TYPE_ENTER_SEC = 0.4;
export const TYPE_EXIT_SEC = 0.28;

export const WORD_REVEAL_BASE_SEC = 2.4;
export const LINE_MASK_BASE_SEC = 2.2;
export const CHAR_STAGGER_BASE_SEC = 2.0;
export const WEIGHT_MORPH_BASE_SEC = 2.4;
export const CHAR_STAGGER_MAX_CHARS = 24;
/** Inter ships these static weights (remotion/src/motion/fonts.ts). */
export const MORPH_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;

/** 0 = fully hidden, 1 = fully shown, for one item of a staggered group at beat time `t` (sec) in a beat of `durSec`. */
export function itemReveal(t: number, durSec: number, index: number, count: number, enterSec = TYPE_ENTER_SEC): {enter: number; exit: number} {
  const step = staggerStep(count);
  const enter = eased(ENTER_EASE_OUT, t, 0.12 + index * step, enterSec);
  const exitStart = Math.max(0.6, durSec - TYPE_EXIT_SEC);
  const exit = eased(EXIT_EASE_IN, t, exitStart + index * step * 0.5, TYPE_EXIT_SEC);
  return {enter, exit};
}

/** Weight (400..900 step) at progress p; the discrete step is the nearest shipped Inter weight. */
export function morphWeight(p: number): number {
  const target = 400 + clamp01(p) * 500;
  return MORPH_WEIGHTS.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best));
}

/** Price count: eased value from `from` to `to` (hero band), rounded to cents when either side has a fraction. */
export function priceCount(p: number, from: number, to: number): number {
  const v = from + (to - from) * clamp01(p);
  const fractional = !Number.isInteger(from) || !Number.isInteger(to);
  return fractional ? Math.round(v * 100) / 100 : Math.round(v);
}
