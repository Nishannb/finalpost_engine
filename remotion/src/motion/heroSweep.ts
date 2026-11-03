/**
 * Environmental-hero MARQUEE ("sweep") — oversized text behind the person that is still READABLE.
 *
 * SAFE-ZONE CONTRACT: the hero is NEVER clipped by the frame edge. Everything (the visible window `view`, the word, the vertical placement incl. the 1.14 scale overshoot) lives inside the Shorts safe rect
 * (SHORTS_SAFE below: 900x1400 inside 1080x1920 with a wider right rail). The word is fit so its WHOLE width is inside the safe width for the entire beat; the person may still hide letters (occlusion is fine), the
 * frame / safe edge may not cut one. The scroll below therefore only shifts a contained word within the safe window.
 *
 * (Historic note) A big static word behind a head is unreadable (the middle letters stay hidden for the whole beat) and shrinking it to fit a side gutter kills the point of a hero. So the word keeps its big size
 * (fit to ~94 % of the frame width, capped like any hero) and SCROLLS horizontally behind the person: letters enter from a clear side, travel behind the head and leave on the other side.
 *
 * Readability criterion (per GLYPH, not per word): every glyph must spend a contiguous stretch of the beat fully on screen and fully clear of the head-band occluder (left OR right gutter),
 * >= min(20 % of the beat, 0.35 s). The whole word never has to be clear at once, and overlap during the transit is intended. The motion is a hold, a linear scroll and a hold; the start / end rest
 * positions are SNAPPED so a letter boundary sits at the head edge (and at the frame margin), so a held frame never shows a letter half under the hair.
 *
 * Demotion (no occlusion, headroom layout) happens only when there is no usable gutter at all: the subject box fills the frame, or both gutters are < 8 % of the frame width.
 * A long word is NOT a reason to demote.
 *
 * Kept BYTE-IDENTICAL with server/src/stages/broll/heroSweep.ts (the server build cannot import the remotion tree; heroSweep.test.ts pins the two files together).
 * PURE (no React, no remotion, no env): the comp (`KineticTypeStory.tsx`), the template binder and the planner gate all use these same numbers, and tests exercise them directly.
 */

export type SweepBox = {x: number; y: number; w: number; h: number};

/** Same default the comp falls back to when the binder has no measured subject box (kineticType.DEFAULT_SUBJECT_BOX). */
export const HERO_DEFAULT_SUBJECT_BOX: SweepBox = {x: 0.3, y: 0.3, w: 0.4, h: 0.62};

/**
 * YouTube Shorts safe-zone reference: 900x1400 inside a 1080x1920 plate (thicker right rail for the UI, larger top / bottom chrome), as fractions of the frame. On 1080x1920 the inner rect is exactly x=60 y=250 w=900 h=1400.
 */
export const SHORTS_SAFE = {leftFrac: 60 / 1080, rightFrac: 120 / 1080, topFrac: 250 / 1920, bottomFrac: 270 / 1920} as const;
export type SafeRect = {left: number; right: number; top: number; bottom: number; w: number; h: number};
/** The Shorts safe rect (px) for a frame size. Pure. */
export function shortsSafeRect(width: number, height: number): SafeRect {
  const left = SHORTS_SAFE.leftFrac * width;
  const right = width - SHORTS_SAFE.rightFrac * width;
  const top = SHORTS_SAFE.topFrac * height;
  const bottom = height - SHORTS_SAFE.bottomFrac * height;
  return {left, right, top, bottom, w: right - left, h: bottom - top};
}
/** The hero's entrance scale overshoot (the comp scales 1.14 -> 1): vertical placement must hold the block at THIS scale inside the safe rect. */
export const HERO_SCALE_OVERSHOOT = 1.14;
/** Hero line height (em) of the hero face (Bebas Neue) and the ink cap height (em) used for the vertical fit. */
export const HERO_LINE_HEIGHT_EM = 0.86;

/**
 * Advance width (em) of one glyph of the HERO face (Bebas Neue 400, letter-spacing -0.01em), MEASURED in Chrome from remotion/public/fonts/bebas-neue-latin-400-normal.woff2 (font-kerning none). The tracking is
 * included in the advance, so the ink of the last glyph sits inside its box. Used by the hero layout / planner.
 */
export const HERO_GLYPH_ADVANCE_EM: Readonly<Record<string, number>> = {
  '0': 0.39, '1': 0.39, '2': 0.39, '3': 0.39, '4': 0.39, '5': 0.39, '6': 0.39, '7': 0.39, '8': 0.39, '9': 0.39,
  A: 0.391, B: 0.394, C: 0.373, D: 0.396, E: 0.353, F: 0.334, G: 0.381, H: 0.41, I: 0.182, J: 0.255, K: 0.404, L: 0.334, M: 0.528,
  N: 0.417, O: 0.39, P: 0.376, Q: 0.39, R: 0.393, S: 0.362, T: 0.354, U: 0.392, V: 0.372, W: 0.547, X: 0.396, Y: 0.384, Z: 0.352,
  '!': 0.2, '?': 0.353, '.': 0.178, ',': 0.178, "'": 0.178, '-': 0.26, '&': 0.407, $: 0.39, '%': 0.579, '+': 0.39, ':': 0.178, ' ': 0.15,
};
export const HERO_GLYPH_ADVANCE_DEFAULT_EM = 0.4;
export const HERO_LETTER_SPACING_EM = -0.01;
export const heroAdvanceEm = (ch: string): number => HERO_GLYPH_ADVANCE_EM[ch.toUpperCase()] ?? HERO_GLYPH_ADVANCE_DEFAULT_EM;

/**
 * Advance width (em) of one glyph of Inter 900 at letter-spacing -0.025em, MEASURED in Chrome from remotion/public/fonts/inter-latin-900-normal.woff2 (no kerning: the comp sets `font-kerning: none` so the
 * layout the planner reasons about is the layout that renders). Unknown glyphs use the default.
 */
export const GLYPH_ADVANCE_EM: Readonly<Record<string, number>> = {
  '0': 0.686, '1': 0.427, '2': 0.621, '3': 0.644, '4': 0.677, '5': 0.621, '6': 0.65, '7': 0.57, '8': 0.654, '9': 0.65,
  A: 0.77, B: 0.643, C: 0.723, D: 0.698, E: 0.588, F: 0.559, G: 0.729, H: 0.725, I: 0.266, J: 0.571, K: 0.734, L: 0.54, M: 0.931,
  N: 0.745, O: 0.75, P: 0.631, Q: 0.762, R: 0.643, S: 0.641, T: 0.662, U: 0.697, V: 0.77, W: 1.057, X: 0.761, Y: 0.75, Z: 0.669,
  '!': 0.356, '?': 0.576, '.': 0.348, ',': 0.348, "'": 0.347, '-': 0.45, '&': 0.67, $: 0.641, '%': 1.019, '+': 0.668, ':': 0.348, ' ': 0.174,
};
export const GLYPH_ADVANCE_DEFAULT_EM = 0.72;
export const glyphAdvanceEm = (ch: string): number => GLYPH_ADVANCE_EM[ch.toUpperCase()] ?? GLYPH_ADVANCE_DEFAULT_EM;
/** Per-glyph advances (em) of a line (code points). */
export const lineAdvancesEm = (line: string): number[] => Array.from(line).map(heroAdvanceEm);
export const lineWidthEm = (line: string): number => lineAdvancesEm(line).reduce((a, b) => a + b, 0);

/**
 * Largest hero font (px) such that the widest line (at the scale overshoot) AND the whole block (lines + lead allowance) fit inside the Shorts safe rect. Pure; shared by the planner and the comp.
 * `leadEm` = lead block height as a fraction of the font (0 without lead); `scale` = the largest scale the block is ever shown at.
 */
export function heroContainedFontPx(lines: readonly string[], width: number, height: number, maxFontPx: number, opts: {leadEm?: number; scale?: number} = {}): number {
  const safe = shortsSafeRect(width, height);
  const scale = opts.scale ?? 1;
  const widest = Math.max(0.01, ...lines.map(l => lineWidthEm(l.toUpperCase())));
  const blockEm = HERO_LINE_HEIGHT_EM * Math.max(1, lines.length) + (opts.leadEm ?? 0);
  return Math.min(maxFontPx, safe.w / (scale * widest), safe.h / (scale * blockEm));
}

/** Vertical centre (px) of a block of height `blockH` shown at up to `scale`, nudged from `wantY` so the scaled block stays inside the safe rect top / bottom. Pure. */
export function heroClampCenterY(wantY: number, blockH: number, height: number, width: number, scale = 1): number {
  const safe = shortsSafeRect(width, height);
  const half = (blockH * scale) / 2;
  return Math.min(safe.bottom - half, Math.max(safe.top + half, wantY));
}


/** Gap between a clear letter and the subject (also absorbs the head sitting a little off the box centre). */
export const SWEEP_SUBJECT_PAD_FRAC = 0.008;
/** No usable gutter: both side gutters (frame margin .. head band) are narrower than this fraction of the frame width. */
export const SWEEP_MIN_GUTTER_FRAC = 0.08;
/** A subject box this wide fills the frame (a close-up): the head band is not separable from it, so there is no gutter. */
export const SWEEP_MAX_SUBJECT_WIDTH_FRAC = 0.9;
/** The word must still be big: at least this fraction of the frame height. */
export const SWEEP_MIN_FONT_HEIGHT_FRAC = 0.06;
/**
 * The word sits at HEAD height, where the person is only as wide as the head, not as wide as the subject box (which includes shoulders and gesturing arms: on the proof clip the box is the full frame width
 * while the head measures 0.41 of it). The occluder is the box narrowed to a head band centred on the box: 62 % of the box width, at least 0.36 of the frame (never wider than the box), at most 0.46.
 */
export const SWEEP_HEAD_BAND = {frac: 0.62, minW: 0.36, maxW: 0.46} as const;
/** Per-glyph contiguous clear time required: min(this fraction of the beat, SWEEP_MIN_CLEAR_SEC). */
export const SWEEP_MIN_CLEAR_BEAT_FRAC = 0.2;
export const SWEEP_MIN_CLEAR_SEC = 0.35;
/** Plan selection accepts a per-glyph clear time down to this fraction of the target (the target is a "~" figure) when that buys the reading-order motion (start shows the first letters, end the last). */
export const SWEEP_TARGET_SLACK = 0.8;
/** Below this fraction of the beat a glyph is not readable at all: the plan is refused. */
export const SWEEP_ABS_MIN_CLEAR_FRAC = 0.08;
/** Assumed beat length when the caller does not know it (kinetic-led hero beats run 1.6 - 2.4 s). */
export const SWEEP_DEFAULT_BEAT_SEC = 2.4;
const SAMPLES = 48;
const HOLD_VARIANTS: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0.25],
  [0.2, 0.2],
  [0.12, 0.12],
  [0.2, 0.08],
  [0.08, 0.2],
];

export type SweepGlyph = {line: number; index: number; char: string; /** px from the block's left edge */ offset: number; /** px */ width: number};

export type HeroSweepPlan = {
  feasible: boolean;
  reason?: 'no_box' | 'subject_too_wide' | 'no_gutter' | 'font_too_small' | 'glyph_never_clear';
  fontPx: number;
  /** widest line, px */
  blockWidthPx: number;
  glyphs: SweepGlyph[];
  /** block left edge (px) while resting at the start / end of the beat */
  startLeft: number;
  endLeft: number;
  /** fractions of the beat spent resting at the start / end */
  holdA: number;
  holdB: number;
  /** the visible window (px): letters are clipped to it and must be fully inside it to count as clear */
  view: {from: number; to: number};
  /** the head-band occluder incl. pad (px) */
  occluder: {x0: number; x1: number};
  /** per glyph: longest contiguous clear stretch, fraction of the beat (same order as `glyphs`) */
  glyphClear: number[];
  minClearFrac: number;
  meanClearFrac: number;
  /** required per-glyph clear fraction for this beat length */
  targetClearFrac: number;
  meetsTarget: boolean;
  /** weighted count of letters cut at the two rest frames: 4 per letter half under the hair, 1 per letter half clipped by the view window (0 = clean rest frames) */
  restCuts: number;
};

const INFEASIBLE = (reason: HeroSweepPlan['reason']): HeroSweepPlan => ({
  feasible: false,
  reason,
  fontPx: 0,
  blockWidthPx: 0,
  glyphs: [],
  startLeft: 0,
  endLeft: 0,
  holdA: 0,
  holdB: 0,
  view: {from: 0, to: 0},
  occluder: {x0: 0, x1: 0},
  glyphClear: [],
  minClearFrac: 0,
  meanClearFrac: 0,
  targetClearFrac: SWEEP_MIN_CLEAR_BEAT_FRAC,
  meetsTarget: false,
  restCuts: 0,
});

/** The horizontal extent (fractions of the frame) of the person at the word's head-height band: the box narrowed to a head band. Pure. */
export function headBandExtent(box: SweepBox): {x0: number; x1: number} {
  const headW = Math.min(box.w, SWEEP_HEAD_BAND.maxW, Math.max(SWEEP_HEAD_BAND.minW, box.w * SWEEP_HEAD_BAND.frac));
  const cx = box.x + box.w / 2;
  return {x0: cx - headW / 2, x1: cx + headW / 2};
}

/** Displayed lines (<= 2 words, ALL CAPS) and lead length for a hero text. */
export function heroSweepSizeOf(text: string, lead?: string): {lines: string[]; leadChars: number} {
  const lines = text.trim().toUpperCase().split(/\s+/).filter(Boolean).slice(0, 2);
  return {lines: lines.length > 0 ? lines : ['BIGGER'], leadChars: lead ? Array.from(lead.trim()).length : 0};
}

/** Block left edge (px) at normalized beat time u (0..1): rest, linear scroll, rest. Pure. */
export function heroSweepLeftX(plan: Pick<HeroSweepPlan, 'startLeft' | 'endLeft' | 'holdA' | 'holdB'>, u: number): number {
  const a = plan.holdA;
  const b = 1 - plan.holdB;
  if (u <= a) return plan.startLeft;
  if (u >= b) return plan.endLeft;
  return plan.startLeft + (plan.endLeft - plan.startLeft) * ((u - a) / (b - a));
}

/** Whether a glyph at block-left `left` is fully inside the view window and fully clear of the occluder. */
const glyphClearAt = (left: number, g: {offset: number; width: number}, view: {from: number; to: number}, occ: {x0: number; x1: number}): boolean => {
  const l = left + g.offset;
  const r = l + g.width;
  return l >= view.from - 0.5 && r <= view.to + 0.5 && (r <= occ.x0 + 0.5 || l >= occ.x1 - 0.5);
};

/**
 * Glyphs CUT at this rest position, weighted: a letter half under the HEAD counts 4 (overlaps the head only partly with >= 25 % of its width visible beside it: the look the director rejected), a letter half
 * clipped by the VIEW window, or a stray fragment of one, counts 1 (4 % .. 99.5 % visible). A sliver beside the head (< 25 % visible) reads as the word going behind the head and is fine.
 */
const cutGlyphs = (left: number, glyphs: readonly SweepGlyph[], view: {from: number; to: number}, occ: {x0: number; x1: number}, pad: number): number => {
  const hx0 = occ.x0 + pad;
  const hx1 = occ.x1 - pad;
  let cut = 0;
  for (const g of glyphs) {
    const l = left + g.offset;
    const from = Math.max(l, view.from);
    const to = Math.min(l + g.width, view.to);
    if (to <= from) continue;
    const headOverlap = Math.max(0, Math.min(to, hx1) - Math.max(from, hx0));
    if (headOverlap > 0 && (to - from - headOverlap) / g.width >= 0.25) cut += 4;
    else if (headOverlap === 0 && (to - from) / g.width >= 0.04 && (to - from) / g.width < 0.995) cut += 1; // half-clipped letter, or a stray fragment, at the window edge
  }
  return cut;
};

/** Clear flags of every glyph at beat time u (used by tests and the proof report). */
export function glyphsClearAt(plan: HeroSweepPlan, u: number): boolean[] {
  const left = heroSweepLeftX(plan, u);
  return plan.glyphs.map(g => glyphClearAt(left, g, plan.view, plan.occluder));
}

const memo = new Map<string, HeroSweepPlan>();

export type HeroSweepInput = {
  box: SweepBox | undefined | null;
  /** displayed lines (1-2 words, any case) */
  lines: readonly string[];
  width: number;
  height: number;
  /** the biggest the hero may be (px); the comp's occluded cap */
  maxFontPx: number;
  /** the beat length (s) the clear-time requirement is judged against */
  beatSec?: number;
  /** lead block height as a fraction of the hero font (0 / omitted without a lead); keeps lead + hero inside the safe height */
  leadEm?: number;
  /** feasibility only (planner / binder gate): skip the rest-frame font refinement */
  fast?: boolean;
};

/** Plan the marquee for a subject box. Pure and deterministic (memoised). */
export function planHeroSweep(input: HeroSweepInput): HeroSweepPlan {
  const key = JSON.stringify([input.box, input.lines, input.width, input.height, Math.round(input.maxFontPx), input.beatSec ?? SWEEP_DEFAULT_BEAT_SEC, Boolean(input.fast), input.leadEm ?? 0]);
  const hit = memo.get(key);
  if (hit) return hit;
  const plan = computePlan(input);
  if (memo.size > 200) memo.clear();
  memo.set(key, plan);
  return plan;
}

function computePlan(input: HeroSweepInput): HeroSweepPlan {
  const {box, width, height} = input;
  if (!box || !(box.w > 0) || !(box.h > 0)) return INFEASIBLE('no_box');
  if (box.w >= SWEEP_MAX_SUBJECT_WIDTH_FRAC) return INFEASIBLE('subject_too_wide');
  const lines = input.lines.map(l => l.toUpperCase()).filter(Boolean);
  if (lines.length === 0) return INFEASIBLE('no_box');
  const beatSec = input.beatSec && input.beatSec > 0 ? input.beatSec : SWEEP_DEFAULT_BEAT_SEC;
  const target = Math.min(SWEEP_MIN_CLEAR_BEAT_FRAC, SWEEP_MIN_CLEAR_SEC / beatSec);

  const safe = shortsSafeRect(width, height);
  const view = {from: safe.left, to: safe.right};
  const band = headBandExtent(box);
  const pad = SWEEP_SUBJECT_PAD_FRAC * width;
  const occ = {x0: band.x0 * width - pad, x1: band.x1 * width + pad};
  const gutterL = Math.max(0, occ.x0 - view.from);
  const gutterR = Math.max(0, view.to - occ.x1);
  const gutterBig = Math.max(gutterL, gutterR);
  if (gutterBig < SWEEP_MIN_GUTTER_FRAC * width) return INFEASIBLE('no_gutter');

  // size: the big-hero fit (widest line to ~94 % of the frame), capped; but a single glyph must fit in the larger gutter or no letter could ever be clear
  const advLines = lines.map(lineAdvancesEm);
  const widestEm = Math.max(...advLines.map(a => a.reduce((x, y) => x + y, 0)));
  const widestGlyphEm = Math.max(...advLines.flat());
  // CONTAINED: the whole widest line fits the safe width (no glyph is ever cut by the safe / frame edge); a single glyph also fits the larger gutter
  const fontPx = Math.min(heroContainedFontPx(lines, width, height, input.maxFontPx, {leadEm: input.leadEm ?? 0}), (0.97 * gutterBig) / widestGlyphEm);
  if (!(fontPx >= SWEEP_MIN_FONT_HEIGHT_FRAC * height)) return INFEASIBLE('font_too_small');

  // The word keeps its big size unless a slightly smaller one lets the REST frames show no letter half under the hair (or half clipped): try the full size, then the sizes at which the letters hidden behind the head
  // exactly span the head band (both clear runs then end on a letter boundary), then a few plain steps down
  const sizes = input.fast ? [fontPx] : candidateFonts(fontPx, advLines[advLines.findIndex(a => a.reduce((x, y) => x + y, 0) === widestEm)]!, occ.x1 - occ.x0, [gutterL, gutterR]);
  // a SHORT word is huge at the full fit (its letters are as wide as a gutter, so only one fits at a time and none dwells long enough): shrink it step by step until the letters can pass through the gutters
  // (only when the sizes above did not already reach the target; a long word never gets here)
  const shrink = [0.85, 0.7, 0.58, 0.48];
  let chosen: ReturnType<typeof searchPlan> | undefined;
  let chosenRank = -Infinity;
  const tryFont = (size: number) => {
    if (!(size >= SWEEP_MIN_FONT_HEIGHT_FRAC * height)) return;
    const res = searchPlan({fontPx: size, lines, advLines, view, occ, pad, target});
    // reading order dominates (see searchPlan); among equals the bigger word wins
    const rank = res.best.rank + 3000 * (size / fontPx);
    if (!chosen || rank > chosenRank) {
      chosen = res;
      chosenRank = rank;
    }
  };
  for (const size of sizes) tryFont(size);
  // (no further shrinking: the hero stays big, letters behind the person are fine; only the 0.7x floor of candidateFonts trades size for a cleaner rest frame)
  void shrink;
  if (!chosen) return INFEASIBLE('font_too_small');
  const {best, glyphs, blockWidthPx} = chosen;
  const font = chosen.fontPx;
  // a letter the person covers for the whole beat is allowed (occlusion is the point of the effect); only a letter cut by the safe / frame edge is not, and the contained rests above rule that out
  return {
    feasible: true,
    fontPx: font,
    blockWidthPx,
    glyphs,
    startLeft: best.startLeft,
    endLeft: best.endLeft,
    holdA: best.holdA,
    holdB: best.holdB,
    view,
    occluder: occ,
    glyphClear: best.clear,
    minClearFrac: best.min,
    meanClearFrac: best.mean,
    targetClearFrac: target,
    meetsTarget: best.min >= target - 1e-9,
    restCuts: best.cuts,
  };
}

/** Font sizes to try, biggest first: the full fit, the sizes where a prefix / suffix fills a gutter exactly, the sizes where the hidden letters span the head band exactly, and plain steps down to 0.7. */
function candidateFonts(full: number, adv: readonly number[], hiddenSpanPx: number, gutters: readonly number[]): number[] {
  const cs: number[] = [0];
  adv.forEach(a => cs.push(cs[cs.length - 1]! + a));
  const total = cs[cs.length - 1]!;
  const aligned: number[] = [];
  const add = (f: number, lo: number) => {
    // just under the exact alignment (0.3 px) so the last letter of the run sits inside the gutter, not on its edge
    if (f - 0.3 < full - 0.5 && f - 0.3 >= full * lo) aligned.push(f - 0.3);
  };
  // sizes at which j leading letters exactly fill a gutter (a longer clear PREFIX at the start rest) or j trailing letters do (a longer clear SUFFIX at the end rest)
  for (let j = 1; j < adv.length; j += 1) {
    for (const g of gutters) {
      add(g / cs[j]!, 0.66);
      add(g / (total - cs[adv.length - j]!), 0.66);
    }
  }
  // sizes at which the letters hidden behind the head exactly span the head band (both clear runs end on a letter boundary)
  for (let j = 0; j < adv.length; j += 1) for (let k = j + 2; k < adv.length; k += 1) add(hiddenSpanPx / (cs[k]! - cs[j + 1]!), 0.82);
  // exact alignments first, then plain steps down to 0.7 (prefix / suffix alignments down to 0.66) where no alignment is within 1.5 px; biggest first, capped
  const kept: number[] = [];
  for (const f of [full, ...aligned.sort((a, b) => b - a), ...[0.95, 0.9, 0.85, 0.8, 0.75, 0.7].map(k => full * k)]) if (kept.every(k => Math.abs(k - f) >= 1.5)) kept.push(Math.round(f * 100) / 100);
  kept.sort((a, b) => b - a);
  return kept.slice(0, 14);
}

type Best = {startLeft: number; endLeft: number; holdA: number; holdB: number; clear: number[]; min: number; mean: number; meets: boolean; travel: number; prefix: number; suffix: number; dangling: number; cuts: number; rank: number};

/** Search the rest positions / hold variants for one font size. */
function searchPlan(p: {fontPx: number; lines: string[]; advLines: number[][]; view: {from: number; to: number}; occ: {x0: number; x1: number}; pad: number; target: number}): {fontPx: number; glyphs: SweepGlyph[]; blockWidthPx: number; best: Best} {
  const {fontPx, advLines, view, occ, pad, target} = p;
  const lines = p.lines;
  const glyphs: SweepGlyph[] = [];
  advLines.forEach((adv, li) => {
    let x = 0;
    adv.forEach((a, k) => {
      glyphs.push({line: li, index: k, char: Array.from(lines[li]!)[k]!, offset: x, width: a * fontPx});
      x += a * fontPx;
    });
  });
  const widestEm = Math.max(...advLines.map(a => a.reduce((x, y) => x + y, 0)));
  const blockWidthPx = widestEm * fontPx;

  // rest-position candidates: letter boundaries of the widest line snapped to the head edge and to the view edge, plus the plain alignments
  const widest = glyphs.filter(g => g.line === advLines.findIndex(a => a.reduce((x, y) => x + y, 0) === widestEm));
  const cand = new Set<number>([Math.round(view.from), Math.round(view.to - blockWidthPx)]);
  for (const g of widest) {
    cand.add(Math.round(occ.x0 - (g.offset + g.width)));
    cand.add(Math.round(occ.x1 - g.offset));
    cand.add(Math.round(view.from - g.offset));
    cand.add(Math.round(view.to - (g.offset + g.width)));
  }
  // CONTAINED rests only: the whole block stays inside the safe window at every frame (the scroll is linear between two contained rests), so no glyph is ever cut by the safe edge
  const lo = view.from;
  const hi = view.to - blockWidthPx;
  cand.add(Math.round(lo * 100) / 100);
  cand.add(Math.round(hi * 100) / 100);
  cand.add(Math.round(((lo + hi) / 2) * 100) / 100);
  const rests = [...cand].map(L => Math.min(hi, Math.max(lo, L))).filter((L, i, a) => a.indexOf(L) === i).sort((a, b) => a - b);

  // READING ORDER (dominates the objective): the start rest shows a contiguous clear PREFIX of the first line (as many leading letters as the gutter allows) and nothing else; the end rest shows a contiguous
  // clear SUFFIX and nothing else. A clear letter elsewhere at a rest (the word's ending showing while its beginning is on show, or the reverse) reads as a split word and is penalised, not rewarded.
  const line0 = glyphs.filter(g => g.line === 0);
  const clearRun = (left: number, from: 'start' | 'end'): {run: number; clear: number} => {
    const flags = line0.map(g => glyphClearAt(left, g, view, occ));
    let run = 0;
    if (from === 'start') while (run < flags.length && flags[run]) run += 1;
    else while (run < flags.length && flags[flags.length - 1 - run]) run += 1;
    return {run, clear: flags.filter(Boolean).length};
  };
  const startInfo = new Map<number, {run: number; clear: number}>();
  const endInfo = new Map<number, {run: number; clear: number}>();
  for (const L of rests) {
    startInfo.set(L, clearRun(L, 'start'));
    endInfo.set(L, clearRun(L, 'end'));
  }
  // only rests that show the first letter (start) / the last letter (end) are worth pairing, when there are any
  const starts = rests.filter(L => startInfo.get(L)!.run > 0);
  const ends = rests.filter(L => endInfo.get(L)!.run > 0);
  const startRests = starts.length > 0 ? starts : rests;
  const endRests = ends.length > 0 ? ends : rests;
  let best: Best | undefined;
  const clear = new Array<number>(glyphs.length);
  const run = new Array<number>(glyphs.length);
  for (const [holdA, holdB] of HOLD_VARIANTS) {
    for (const startLeft of startRests) {
      for (const endLeft of endRests) {
        if (endLeft === startLeft && rests.length > 1) continue;
        clear.fill(0);
        run.fill(0);
        for (let i = 0; i < SAMPLES; i += 1) {
          const left = heroSweepLeftX({startLeft, endLeft, holdA, holdB}, (i + 0.5) / SAMPLES);
          for (let g = 0; g < glyphs.length; g += 1) {
            if (glyphClearAt(left, glyphs[g]!, view, occ)) {
              run[g] = run[g]! + 1;
              if (run[g]! > clear[g]!) clear[g] = run[g]!;
            } else run[g] = 0;
          }
        }
        let min = SAMPLES;
        let sum = 0;
        for (let g = 0; g < glyphs.length; g += 1) {
          min = Math.min(min, clear[g]!);
          sum += clear[g]!;
        }
        const minF = min / SAMPLES;
        const meanF = sum / glyphs.length / SAMPLES;
        const meets = minF >= target * SWEEP_TARGET_SLACK - 1e-9;
        const travel = Math.abs(endLeft - startLeft);
        const cuts = cutGlyphs(startLeft, glyphs, view, occ, pad) + cutGlyphs(endLeft, glyphs, view, occ, pad);
        const si = startInfo.get(startLeft)!;
        const ei = endInfo.get(endLeft)!;
        const prefix = si.run;
        const suffix = ei.run;
        const dangling = si.clear - si.run + (ei.clear - ei.run);
        const rank = (meets ? 1e6 : minF * 1e4) + 1000 * (prefix + suffix) - 600 * dangling - 250 * cuts + 200 * (holdA + holdB) + 100 * meanF - travel * 1e-3;
        if (!best || rank > best.rank) best = {startLeft, endLeft, holdA, holdB, clear: clear.map(c => c / SAMPLES), min: minF, mean: meanF, meets, travel, prefix, suffix, dangling, cuts, rank};
      }
    }
  }
  return {fontPx, glyphs, blockWidthPx, best: best ?? ({startLeft: 0, endLeft: 0, holdA: 0.2, holdB: 0.2, clear: glyphs.map(() => 0), min: 0, mean: 0, meets: false, travel: 0, prefix: 0, suffix: 0, dangling: 0, cuts: 99, rank: -1e9} as Best)};
}

/**
 * Planning / binding gate in a fixed 9:16 reference frame (the engine renders vertical video): can a hero with this text scroll readably around this subject box?
 * The comp recomputes with the real frame size and demotes on its own if the real frame disagrees.
 */
export const SWEEP_REFERENCE_FRAME = {width: 720, height: 1280} as const;
export function heroSweepFeasible(box: SweepBox | undefined | null, text: string, beatSec?: number): boolean {
  const {width, height} = SWEEP_REFERENCE_FRAME;
  const {lines} = heroSweepSizeOf(text);
  return planHeroSweep({box, lines, width, height, maxFontPx: height * 0.27, fast: true, ...(beatSec !== undefined ? {beatSec} : {})}).feasible;
}

/** Advance width (px) of a word at a font size (uppercase advances; conservative for lowercase). */
export const wordWidthPx = (word: string, fontPx: number): number => Array.from(word).reduce((sum, ch) => sum + glyphAdvanceEm(ch), 0) * fontPx;

/** Word pop keeps a wider berth than the hero's clear margin: the pop's scale overshoot, descenders and the accent underline must stay clear of the silhouette too. */
export const WORD_POP_PAD_FRAC = 0.04;
/** Width allowance for the pop's scale overshoot (PLAYFUL_OVERSHOOT peaks a little over 1). */
export const WORD_POP_SCALE_ALLOWANCE = 1.12;

export type WordPopSlot = {side: 'left' | 'right' | 'top'; fontPx: number; /** the word's centre x (px) */ cx: number; /** the word's centre y (px) */ cy: number; /** free width (px) of the slot the word is centred in */ room: number; /** the word's rect (px) */ rect: {left: number; right: number; top: number; bottom: number}};

/**
 * Where a small word (word pop) goes so that its rect has ZERO overlap with the person: the gutters beside the HEAD BAND (+ pad) at head height, else the true headroom ABOVE the head top; null when neither fits
 * (the word is then not drawn rather than drawn through the face). Never behind anything: small type under a shoulder is unreadable. Pure.
 */
export function planWordPopSlot(input: {box: SweepBox; word: string; anchor?: 'left' | 'right' | 'top'; width: number; height: number; region: {left: number; top: number; w: number}; sideCapPx: number; topCapPx: number}): WordPopSlot | null {
  const {box, word, width, height, region} = input;
  const band = headBandExtent(box);
  const pad = WORD_POP_PAD_FRAC * width;
  const emWidth = wordWidthPx(word, 1) * WORD_POP_SCALE_ALLOWANCE;
  const minFont = height * 0.04;
  const leftRoom = band.x0 * width - pad - region.left;
  const rightRoom = width - region.left - (band.x1 * width + pad);
  const headroomRoom = box.y * height - pad - region.top;
  const make = (side: WordPopSlot['side'], fontPx: number, cx: number, room: number): WordPopSlot => {
    const w = emWidth * fontPx;
    const cy = side === 'top' ? box.y * height - pad - fontPx * 0.55 : Math.max(region.top + fontPx * 0.6, box.y * height + box.h * height * 0.11);
    return {side, fontPx, cx, cy, room, rect: {left: cx - w / 2, right: cx + w / 2, top: cy - fontPx * 0.6, bottom: cy + fontPx * 0.6}};
  };
  const slots = [
    {side: 'left' as const, fontPx: Math.min(input.sideCapPx, leftRoom / emWidth), cx: region.left + leftRoom / 2, room: leftRoom},
    {side: 'right' as const, fontPx: Math.min(input.sideCapPx, rightRoom / emWidth), cx: width - region.left - rightRoom / 2, room: rightRoom},
    {side: 'top' as const, fontPx: Math.min(input.topCapPx, region.w / emWidth, headroomRoom / 1.1), cx: width / 2, room: region.w},
  ].filter(slot => slot.room > 0 && slot.fontPx >= minFont);
  const want = input.anchor === 'right' ? 'right' : input.anchor === 'top' ? 'top' : 'left';
  const chosen = slots.find(slot => slot.side === want) ?? [...slots].sort((a, b) => b.fontPx - a.fontPx)[0];
  return chosen ? make(chosen.side, chosen.fontPx, chosen.cx, chosen.room) : null;
}
