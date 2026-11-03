/**
 * Readability for text-BEHIND-subject (matte occlusion).
 *
 * A matte can put type through the person, but a big STATIC word behind a head is unreadable. Policy:
 *  - small / beside words (word pop) never go behind the person
 *  - big environmental heroes go behind the person as a MARQUEE: the word is fit INSIDE the Shorts safe rect (never cut by the frame edge) and shifts within it behind the head;
 *    the whole word never has to be clear at once (remotion/src/motion/heroSweep.ts, which the comp, the binder and this planner gate all share)
 *  - demote to headroom (type above the face) only when there is no usable gutter at all: the subject box fills the frame, or both side gutters are tiny. A long word is NOT a reason to demote.
 */
import {heroSweepFeasible, headBandExtent, SWEEP_MAX_SUBJECT_WIDTH_FRAC, SWEEP_MIN_GUTTER_FRAC, SWEEP_SUBJECT_PAD_FRAC, SHORTS_SAFE} from './heroSweep.ts';

export type SubjectBoxFrac = {x: number; y: number; w: number; h: number};

/**
 * Whether a talking-head box leaves a usable clear gutter beside the head for a scrolling word: the box must not fill the frame, and at least one side gutter (frame margin .. head band + pad) must be >= 8 % of the
 * frame width. Pure. Invalid / missing boxes refuse occlusion (safer: headroom).
 */
export function matteOcclusionReadable(box: SubjectBoxFrac | undefined | null): boolean {
  if (!box) return false;
  if (!(box.w > 0 && box.h > 0)) return false;
  if (box.w >= SWEEP_MAX_SUBJECT_WIDTH_FRAC) return false;
  const band = headBandExtent(box);
  const left = band.x0 - SWEEP_SUBJECT_PAD_FRAC - SHORTS_SAFE.leftFrac;
  const right = 1 - SHORTS_SAFE.rightFrac - (band.x1 + SWEEP_SUBJECT_PAD_FRAC);
  return Math.max(left, right) >= SWEEP_MIN_GUTTER_FRAC;
}

/**
 * How a hero beat should use the matte. `sweep` = occlude with the scrolling marquee so every glyph is clear for part of the beat. `headroom` = do not occlude (type stays above the face).
 * With `text` the full plan is run (a word whose glyphs can never be clear is refused); without it only the box is judged.
 */
export function matteHeroRevealMode(box: SubjectBoxFrac | undefined | null, text?: {text: string; lead?: string}): 'sweep' | 'headroom' {
  if (!matteOcclusionReadable(box)) return 'headroom';
  if (!text) return 'sweep';
  return heroSweepFeasible(box, text.text) ? 'sweep' : 'headroom';
}
