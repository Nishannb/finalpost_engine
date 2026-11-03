/**
 * WP40: EXPLAINER PACING PLANNER (Skill B: talking-head + diagram reel, `explainer-grammar.yaml` / editref.md Skill B). PURE: a duration (+ optional word timestamps) in, a hard-cut sequence of layouts out.
 * No env, no I/O, no model, no randomness. NOT the Metromedia hyper-cut (ASL 0.85 s, WP33): medium pace, hard cuts only, median ~3.5-4 s.
 *
 * Layouts (stable ids, mirrored by `remotion/src/lib/explainerLayouts.ts`; a test asserts parity):
 *   explainer_a  full-frame talking head          (role talking_head / cta)
 *   explainer_b  split: b-roll top, speaker below (role hook)
 *   explainer_c  full-frame b-roll on white + light-gray dot grid (role diagram)
 *   explainer_d  full-frame dark cutaway          (role cutaway; final third only)
 * Pattern (grammar): B hook -> A / C alternating -> a late D -> A cta.
 * Bounds (s): hook B 2-4 · A 3-8 (grammar TH 3-11) · C 2-4 (b-roll 2-4) · D 3-7 · CTA A 3-10.5 (hard cap 11). Cuts snap to the nearest sentence end / pause within 1 s when every bound still holds.
 * Silence trimming (> 0.3 s) is the cut stage's job, not this planner's.
 *
 * The skill switch (`resolvePolishSkill`): Skill A (faceless), Skill D (newsroom MG), Skill B (explainer) are mutually exclusive.
 * Priority: faceless > newsroom_mg > explainer > default. Lower skills warn when skipped.
 */

export type ExplainerLayoutId = 'explainer_a' | 'explainer_b' | 'explainer_c' | 'explainer_d';
export type ExplainerRole = 'hook' | 'talking_head' | 'diagram' | 'cutaway' | 'cta';
export type ExplainerWord = {text: string; start: number; end: number};
export type ExplainerSegment = {start: number; end: number; layout: ExplainerLayoutId; role: ExplainerRole};

export const EXPLAINER_LAYOUT_IDS: readonly ExplainerLayoutId[] = ['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d'];

type Bounds = {lo: number; hi: number};
export const EXPLAINER_BOUNDS: Readonly<Record<ExplainerRole, Bounds>> = {
  hook: {lo: 2, hi: 4},
  talking_head: {lo: 3, hi: 8},
  diagram: {lo: 2, hi: 4},
  cutaway: {lo: 3, hi: 7},
  cta: {lo: 3, hi: 10.5},
};
export const EXPLAINER_HOOK_SEC = 3.5;
export const EXPLAINER_MIN_SEGMENT_SEC = 2;
export const EXPLAINER_MAX_SEGMENT_SEC = 11;
/** Shorter than this a full cycle cannot fit: the planner returns one talking-head segment and warns. */
export const EXPLAINER_MIN_DURATION_SEC = 14;
export const EXPLAINER_SNAP_SEC = 1;
const TH_TARGETS = [4.5, 3.5, 6, 4, 5] as const;
const DIAGRAM_TARGETS = [3, 2.5, 3.5, 3, 2.5] as const;
const CUTAWAY_TARGET_SEC = 4.5;

export const LAYOUT_OF_ROLE: Readonly<Record<ExplainerRole, ExplainerLayoutId>> = {
  hook: 'explainer_b',
  talking_head: 'explainer_a',
  diagram: 'explainer_c',
  cutaway: 'explainer_d',
  cta: 'explainer_a',
};

export type ExplainerPacing = {
  segments: ExplainerSegment[];
  /** Cut times (the start of every segment after the first). */
  cuts: number[];
  stats: {segmentCount: number; cutCount: number; meanSec: number; medianSec: number; minSec: number; maxSec: number; byLayout: Record<ExplainerLayoutId, number>; snapped: number};
  warnings: string[];
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Natural places for a hard cut: the end of a sentence, else the middle of a >= 0.3 s pause. Sorted. */
export function explainerBoundaries(words: readonly ExplainerWord[] | undefined, durationSec: number): number[] {
  if (!words || words.length === 0) return [];
  const out: number[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = words[index + 1];
    if (/[.!?]["')\]]*$/.test(word.text.trim())) out.push(next ? Math.min(word.end + 0.05, (word.end + next.start) / 2 + 0.05) : word.end);
    else if (next && next.start - word.end >= 0.3) out.push((word.end + next.start) / 2);
  }
  return out.filter(time => time > 0 && time < durationSec).sort((a, b) => a - b);
}

/** Scale `targets` (clamped to each segment's bounds) so they sum to `total`; bisection on one factor. */
function fitLengths(targets: readonly number[], bounds: readonly Bounds[], total: number): number[] {
  const at = (k: number) => targets.map((target, index) => clamp(target * k, bounds[index]!.lo, bounds[index]!.hi));
  const sum = (values: readonly number[]) => values.reduce((acc, value) => acc + value, 0);
  let lo = 0.01;
  let hi = 100;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    if (sum(at(mid)) < total) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}

export function planExplainerPacing(input: {durationSec: number; words?: readonly ExplainerWord[]}): ExplainerPacing {
  const duration = round3(Math.max(0, input.durationSec));
  const empty = (segments: ExplainerSegment[], warnings: string[]): ExplainerPacing => finish(segments, warnings, 0);

  if (duration < EXPLAINER_MIN_DURATION_SEC) {
    const only: ExplainerSegment[] = duration > 0 ? [{start: 0, end: duration, layout: 'explainer_a', role: 'talking_head'}] : [];
    return empty(only, [`polish_pace:explainer_short_clip:${duration}`]);
  }

  const warnings: string[] = [];
  const ctaLen = clamp(duration * 0.07, 3.5, EXPLAINER_BOUNDS.cta.hi);
  const ctaStart = duration - ctaLen;
  // D only in the final third, directly before the CTA.
  const finalThird = (duration * 2) / 3;
  const dLen = Math.min(CUTAWAY_TARGET_SEC, ctaStart - finalThird, EXPLAINER_BOUNDS.cutaway.hi);
  const hasD = dLen >= EXPLAINER_BOUNDS.cutaway.lo - 1e-9;
  if (!hasD) warnings.push('polish_pace:explainer_no_cutaway');
  const dStart = hasD ? ctaStart - dLen : ctaStart;
  const hookEnd = EXPLAINER_HOOK_SEC;
  const span = dStart - hookEnd;

  // body: A, C, A, C, ... A (odd count, ends on a talking head so D / the CTA never follows a diagram)
  const bodyRoles = (count: number): ExplainerRole[] => Array.from({length: count}, (_, index) => (index % 2 === 0 ? 'talking_head' : 'diagram'));
  const targetOf = (role: ExplainerRole, index: number) => (role === 'talking_head' ? TH_TARGETS[(index >> 1) % TH_TARGETS.length]! : DIAGRAM_TARGETS[(index >> 1) % DIAGRAM_TARGETS.length]!);
  let best: {roles: ExplainerRole[]; targets: number[]; gap: number} | null = null;
  for (let count = 1; count <= 61; count += 2) {
    const roles = bodyRoles(count);
    const bounds = roles.map(role => EXPLAINER_BOUNDS[role]);
    const lo = bounds.reduce((acc, item) => acc + item.lo, 0);
    const hi = bounds.reduce((acc, item) => acc + item.hi, 0);
    if (span < lo - 1e-9 || span > hi + 1e-9) continue;
    const targets = roles.map((role, index) => targetOf(role, index));
    const gap = Math.abs(targets.reduce((acc, value) => acc + value, 0) - span);
    if (!best || gap < best.gap) best = {roles, targets, gap};
  }

  const segments: ExplainerSegment[] = [];
  const push = (start: number, end: number, role: ExplainerRole) => segments.push({start: round3(start), end: round3(end), layout: LAYOUT_OF_ROLE[role], role});
  let cursor = 0;
  if (!best) {
    // the span is too small for a talking head (< 3 s): the hook / CTA absorb it.
    const extra = Math.max(0, span);
    push(0, hookEnd, 'hook');
    cursor = hookEnd;
    if (hasD) {
      push(cursor, dStart + extra, 'cutaway');
      cursor = dStart + extra;
    }
    push(cursor, duration, 'cta');
  } else {
    push(0, hookEnd, 'hook');
    cursor = hookEnd;
    const lengths = fitLengths(best.targets, best.roles.map(role => EXPLAINER_BOUNDS[role]), span);
    best.roles.forEach((role, index) => {
      push(cursor, cursor + lengths[index]!, role);
      cursor += lengths[index]!;
    });
    if (hasD) {
      push(cursor, ctaStart, 'cutaway');
      cursor = ctaStart;
    }
    push(cursor, duration, 'cta');
  }
  // close float drift: segments tile [0, duration] exactly
  segments.forEach((segment, index) => {
    segment.start = index === 0 ? 0 : segments[index - 1]!.end;
  });
  segments[segments.length - 1]!.end = duration;

  // snap each cut to the nearest sentence end / pause when every bound still holds (left to right)
  const boundaries = explainerBoundaries(input.words, duration);
  let snapped = 0;
  if (boundaries.length > 0) {
    for (let index = 1; index < segments.length; index += 1) {
      const left = segments[index - 1]!;
      const right = segments[index]!;
      const lb = EXPLAINER_BOUNDS[left.role];
      const rb = EXPLAINER_BOUNDS[right.role];
      const minCut = Math.max(left.start + lb.lo, right.end - rb.hi, right.role === 'cutaway' ? finalThird : 0);
      const maxCut = Math.min(left.start + lb.hi, right.end - rb.lo);
      let pick: number | null = null;
      for (const time of boundaries) {
        if (Math.abs(time - left.end) > EXPLAINER_SNAP_SEC || time < minCut || time > maxCut) continue;
        if (pick === null || Math.abs(time - left.end) < Math.abs(pick - left.end)) pick = time;
      }
      if (pick !== null && Math.abs(pick - left.end) > 1e-6) {
        left.end = round3(pick);
        right.start = round3(pick);
        snapped += 1;
      }
    }
  }
  return finish(segments, warnings, snapped);
}

function finish(segments: ExplainerSegment[], warnings: string[], snapped: number): ExplainerPacing {
  const lengths = segments.map(segment => segment.end - segment.start);
  const byLayout: Record<ExplainerLayoutId, number> = {explainer_a: 0, explainer_b: 0, explainer_c: 0, explainer_d: 0};
  for (const segment of segments) byLayout[segment.layout] += 1;
  const cuts = segments.slice(1).map(segment => segment.start);
  const mean = lengths.length ? lengths.reduce((acc, value) => acc + value, 0) / lengths.length : 0;
  return {
    segments,
    cuts,
    stats: {
      segmentCount: segments.length,
      cutCount: cuts.length,
      meanSec: round3(mean),
      medianSec: round3(median(lengths)),
      minSec: round3(lengths.length ? Math.min(...lengths) : 0),
      maxSec: round3(lengths.length ? Math.max(...lengths) : 0),
      byLayout,
      snapped,
    },
    warnings: [...warnings, `polish_pace:explainer_cuts:${cuts.length}`],
  };
}

export type PolishSkill = 'default' | 'faceless' | 'explainer' | 'newsroom_mg';
/**
 * Mutual exclusion across polish lanes. Priority: faceless (A) > newsroom_mg (D) > explainer (B) > default.
 * Skills C (textual MG) is an overlay flag and is not part of this lane switch.
 */
export function resolvePolishSkill(flags: {
  faceless: boolean;
  explainer: boolean;
  newsroom?: boolean;
}): {skill: PolishSkill; warnings: string[]} {
  const warnings: string[] = [];
  if (flags.faceless) {
    if (flags.explainer) warnings.push('polish_pace:explainer_skipped:faceless_wins');
    if (flags.newsroom) warnings.push('polish_pace:newsroom_skipped:faceless_wins');
    return {skill: 'faceless', warnings};
  }
  if (flags.newsroom) {
    if (flags.explainer) warnings.push('polish_pace:explainer_skipped:newsroom_wins');
    return {skill: 'newsroom_mg', warnings};
  }
  if (flags.explainer) return {skill: 'explainer', warnings: []};
  return {skill: 'default', warnings: []};
}
