/**
 * WP12C: PACING. A face-and-karaoke stretch that goes on too long reads as a slideshow of nothing. This module finds the stretches that carry no "leave-the-face" beat (a plate, a cutaway, a split, a framed
 * window or a transition) for longer than `MAX_FACE_STRETCH_SEC`, and proposes a lightweight reset in each: first a FRAMED WINDOW (the sharp talking head over a blurred, dimmed copy of itself, 1.5-3 s), then a
 * procedural TRANSITION (whip blur, flash, hard cut) at a sentence start. Never a text chip: a chip repeats the captions (WP11B). PURE: no env, no I/O, no model, nothing about the subject of the video.
 */
export const MAX_FACE_STRETCH_SEC = 6;
export const FRAMED_SEC = 2.2;
const TRANSITION_SEC = 0.4;
/** Pacing resets keep this far from the clip edges and from each other. */
const EDGE_SEC = 1;
const MIN_RESET_SPACING_SEC = 4;
/** Procedural styles used for the pacing transitions, in rotation. */
export const PACING_TRANSITION_STYLES = ['whip blur', 'smash zoom', 'hard cut', 'whip blur left', 'dip color', 'flash white', 'blur dissolve'] as const;

export type Span = {start: number; end: number};

/** The stretches (>= `maxGapSec`) between consecutive beats, edge to edge, over a clip of `durationSec`. Beats may overlap; the clip's first and last EDGE_SEC are not counted. */
export function faceStretches(beats: readonly Span[], durationSec: number, maxGapSec = MAX_FACE_STRETCH_SEC): Span[] {
  const sorted = [...beats].filter(beat => beat.end > beat.start).sort((a, b) => a.start - b.start);
  const stretches: Span[] = [];
  let cursor = EDGE_SEC;
  for (const beat of sorted) {
    if (beat.start - cursor > maxGapSec) stretches.push({start: cursor, end: beat.start});
    cursor = Math.max(cursor, beat.end);
  }
  if (durationSec - EDGE_SEC - cursor > maxGapSec) stretches.push({start: cursor, end: durationSec - EDGE_SEC});
  return stretches;
}

export const maxFramedWindows = (durationSec: number): number => Math.max(0, Math.min(2, Math.floor(durationSec / 20)));
/** WP16: raised from min(4, d/10) to min(8, d/6): a long face stretch gets more resets (the density floor in transitionDensity.ts fills the rest). */
export const maxPacingTransitions = (durationSec: number): number => Math.max(0, Math.min(8, Math.floor(durationSec / 6)));

export const GRADE_SEC = 1.8;
export const maxGradeBeats = (durationSec: number): number => Math.max(0, Math.min(2, Math.floor(durationSec / 20)));

export type ResetKind = 'framed_window' | 'grade_bw' | 'transition';
/** The reset kinds in rotation order: the least-used allowed kind goes next (ties: framed window, grade flip, transition). */
export const RESET_ROTATION: readonly ResetKind[] = ['framed_window', 'grade_bw', 'transition'];

export type PacingPlan = {
  framed: Span[];
  /** WP13B: black-and-white grade flips on the talking head. */
  grades: Span[];
  transitions: Array<Span & {style: (typeof PACING_TRANSITION_STYLES)[number]}>;
};

export function planPacing(input: {
  durationSec: number;
  beats: readonly Span[];
  /** Output-time starts of spoken sentences: a reset lands on one. */
  sentenceStarts: readonly number[];
  framedAllowed: boolean;
  transitionAllowed: boolean;
  /** WP13B: allow grade-flip face beats (default false: the caller opts in). */
  gradeAllowed?: boolean;
  maxGapSec?: number;
}): PacingPlan {
  const plan: PacingPlan = {framed: [], grades: [], transitions: []};
  const beats: Span[] = [...input.beats];
  const maxFramed = input.framedAllowed ? maxFramedWindows(input.durationSec) : 0;
  const maxGrades = input.gradeAllowed ? maxGradeBeats(input.durationSec) : 0;
  const maxTransitions = input.transitionAllowed ? maxPacingTransitions(input.durationSec) : 0;
  for (let round = 0; round < 8; round += 1) {
    // The longest stretch first; when it cannot take any allowed reset kind (no sentence start with room), the next-longest is tried.
    const stretches = faceStretches(beats, input.durationSec, input.maxGapSec).sort((a, b) => b.end - b.start - (a.end - a.start));
    if (stretches.length === 0) break;
    // WP13B: rotate the reset kinds (framed window -> grade flip -> procedural transition), the least-used allowed kind first, instead of "framed first, then transitions".
    const used: Record<ResetKind, number> = {framed_window: plan.framed.length, grade_bw: plan.grades.length, transition: plan.transitions.length};
    const caps: Record<ResetKind, number> = {framed_window: maxFramed, grade_bw: maxGrades, transition: maxTransitions};
    const lengths: Record<ResetKind, number> = {framed_window: FRAMED_SEC, grade_bw: GRADE_SEC, transition: TRANSITION_SEC};
    const order = RESET_ROTATION.filter(kind => used[kind] < caps[kind]).sort((a, b) => used[a] - used[b] || RESET_ROTATION.indexOf(a) - RESET_ROTATION.indexOf(b));
    let placed = false;
    for (const stretch of stretches) {
      const middle = (stretch.start + stretch.end) / 2;
      const resets = [...plan.framed, ...plan.grades, ...plan.transitions];
      const room = (start: number, length: number) =>
        start >= stretch.start + 1 &&
        start + length <= stretch.end - 0.5 &&
        beats.every(beat => Math.abs(beat.start - start) >= MIN_RESET_SPACING_SEC || beat.end < start - 0.01) &&
        resets.every(reset => Math.abs(reset.start - start) >= MIN_RESET_SPACING_SEC); // resets keep their distance from each other whatever their kind
      const anchor = (length: number) => [...input.sentenceStarts].filter(start => room(start, length)).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
      for (const kind of order) {
        const at = anchor(lengths[kind]);
        if (at === undefined) continue;
        const start = Math.round(at * 1000) / 1000;
        const end = Math.round((at + lengths[kind]) * 1000) / 1000;
        if (kind === 'framed_window') plan.framed.push({start, end});
        else if (kind === 'grade_bw') plan.grades.push({start, end});
        else plan.transitions.push({start, end, style: PACING_TRANSITION_STYLES[plan.transitions.length % PACING_TRANSITION_STYLES.length]!});
        beats.push({start, end});
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) break;
  }
  plan.framed.sort((a, b) => a.start - b.start);
  plan.grades.sort((a, b) => a.start - b.start);
  plan.transitions.sort((a, b) => a.start - b.start);
  return plan;
}
