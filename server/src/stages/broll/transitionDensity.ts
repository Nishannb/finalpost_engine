/**
 * WP16: TRANSITION DENSITY. The Metromedia reference changes the picture every ~0.5-2.5 s; a polish edit with two or three transitions in 30 s reads as a talking head with text plates. This module sets a
 * density FLOOR for the polish path and fills the missing transitions with procedural kinds (no stock asset), rotated, spaced, and placed on meaningful times. PURE: no env, no I/O, no model.
 *
 * Numbers (documented, tested):
 *  - floor: one procedural transition per `POLISH_TRANSITION_SEC_PER` = 2.5 s (WP22; was 3.5 s), rounded, at least 2 and at most 18 (a 19 s open wants 8, a 30 s piece 12, a 45 s piece 18); clips under 8 s want none.
 *  - minimum gap between two transitions: `POLISH_TRANSITION_MIN_GAP_SEC` = 0.8 s (WP22; was 0.9 s) (so a whip never stacks on a flash).
 *  - WP22 FORCED CUTS (`forcedCuts`): the end of a flash card and the mid-run pops of a long logo cloud get a transition within 0.35 s whether or not the floor is met; and when the floor is still not met and no anchor fits, a GAP-FILL transition goes in the middle of the largest gap.
 *  - keep `POLISH_TRANSITION_EDGE_SEC` = 1.0 s from the first and last frame.
 *
 * Where they go (priority order): (1) at a LABELED-ASSET SLOT BOUNDARY (the start or end of a logo / person / product / screenshot window), so when the creator's upload later fills the slot it gets a clean entrance
 * cut; (2) at an existing media cut (a B-roll / split / cutaway start); (3) at a sentence start. A time STRICTLY INSIDE a slot window is used only as a last resort. Largest gap first. The kind rotates through the
 * polish rotation and never repeats the kind of the transition next to it.
 */
import type {TransitionClip} from '../../types/blueprint.ts';
import {POLISH_TRANSITION_ROTATION} from './transitionPlan.ts';

export const POLISH_TRANSITION_SEC_PER = 2.5;
export const POLISH_TRANSITION_MIN_GAP_SEC = 0.8;
/** A forced cut is satisfied by an existing transition within this many seconds. */
export const FORCED_CUT_TOLERANCE_SEC = 0.35;
export const POLISH_TRANSITION_EDGE_SEC = 1;
/** WP33: the share of transitions that are plain hard cuts while the VO cut grammar is active (editref: transitions.default hard_cut, share_pct 85). */
export const POLISH_HARD_CUT_SHARE = 0.85;
const MIN_DURATION_FOR_FLOOR_SEC = 8;
/** Within this many seconds of a slot boundary a time counts as ON the boundary. */
const BOUNDARY_TOLERANCE_SEC = 0.35;

/** The target number of procedural transitions for a polish clip of `durationSec` (0 for clips under 8 s). */
export function minProceduralTransitions(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_FOR_FLOOR_SEC) return 0;
  return Math.min(18, Math.max(2, Math.round(durationSec / POLISH_TRANSITION_SEC_PER)));
}

export type Window = {start: number; end: number};
type Existing = {at: number; keyword?: string};

export type DensityInput = {
  durationSec: number;
  existing: readonly Existing[];
  /** Output-time starts of spoken sentences (the fallback anchor). */
  sentenceStarts: readonly number[];
  /** Output-time starts of existing media cuts (B-roll / split / cutaway / container starts). */
  cutTimes?: readonly number[];
  /** Labeled-asset slot windows (`assetBrief.slots` startSec / endSec): their boundaries are preferred anchors, their insides are avoided. */
  assetSlotWindows?: readonly Window[];
  /** Windows a transition must not start in (e.g. a punch-in zoom: the assembler manifest keeps transitions and zooms apart). */
  avoidWindows?: readonly Window[];
  minGapSec?: number;
  /** WP22: times that need a transition within `FORCED_CUT_TOLERANCE_SEC` (the end of a flash card, mid-run pops of a long logo cloud). Added first, even above the floor. */
  forcedCuts?: readonly number[];
  /** The floor; defaults to `minProceduralTransitions(durationSec)`. */
  target?: number;
  /** WP33: the cut times of the VO cut grammar (one per 1-3 word caption group). Preferred anchors for the floor, ranked above a bare sentence start and below a real media cut. */
  voCutTimes?: readonly number[];
  /** WP33: the VO cut grammar is active: the transition kind is a plain hard cut ~85 % of the time; whips / flashes / zooms stay accents (at most `1 - POLISH_HARD_CUT_SHARE` of the transitions). */
  preferHardCut?: boolean;
};

export type DensityResult = {
  added: Array<{at: number; keyword: string; anchor: 'asset_boundary' | 'cut' | 'vo_cut' | 'sentence' | 'mid_slot' | 'forced_cut' | 'gap_fill'}>;
  target: number;
  /** Existing + added. */
  total: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

export function ensurePolishTransitionDensity(input: DensityInput): DensityResult {
  const target = input.target ?? minProceduralTransitions(input.durationSec);
  const minGap = input.minGapSec ?? POLISH_TRANSITION_MIN_GAP_SEC;
  const edge = POLISH_TRANSITION_EDGE_SEC;
  const slots = input.assetSlotWindows ?? [];
  const avoid = input.avoidWindows ?? [];
  const placed: Array<{at: number; keyword?: string}> = input.existing.map(item => ({at: item.at, keyword: item.keyword}));
  const added: DensityResult['added'] = [];
  if (input.durationSec < MIN_DURATION_FOR_FLOOR_SEC) return {added, target, total: placed.length};
  const rotated = (index: number, at: number): string => {
    const sorted = [...placed].sort((a, b) => a.at - b.at);
    const before = [...sorted].reverse().find(item => item.at < at)?.keyword;
    const after = sorted.find(item => item.at > at)?.keyword;
    for (let step = 0; step < POLISH_TRANSITION_ROTATION.length; step += 1) {
      const keyword = POLISH_TRANSITION_ROTATION[(index + step) % POLISH_TRANSITION_ROTATION.length]!;
      if (keyword !== before && keyword !== after) return keyword;
    }
    return POLISH_TRANSITION_ROTATION[index % POLISH_TRANSITION_ROTATION.length]!;
  };
  // WP33: with the VO cut grammar active the default transition is a hard cut; the rotation's whips / flashes / zooms are an accent only while they stay within 1 - 85 % of ALL transitions placed so far.
  const keywordFor = (index: number, at: number): string => {
    const accent = rotated(index, at);
    if (!input.preferHardCut) return accent;
    const accents = placed.filter(item => item.keyword !== undefined && item.keyword !== 'hard cut').length;
    return accent !== 'hard cut' && (accents + 1) / (placed.length + 1) <= 1 - POLISH_HARD_CUT_SHARE ? accent : 'hard cut';
  };
  // WP22: forced cuts first (a flash card must be followed by a cut, a long logo run must pop mid-way)
  for (const time of [...(input.forcedCuts ?? [])].sort((a, b) => a - b)) {
    if (!Number.isFinite(time) || time < 0 || time > input.durationSec - 0.3) continue;
    if (placed.some(item => Math.abs(item.at - time) <= FORCED_CUT_TOLERANCE_SEC)) continue;
    const at = round(Math.min(input.durationSec - 0.3, time + 0.05));
    const keyword = keywordFor(placed.length, at);
    placed.push({at, keyword});
    added.push({at, keyword, anchor: 'forced_cut'});
  }
  if (target <= placed.length) {
    added.sort((a, b) => a.at - b.at);
    return {added, target, total: placed.length};
  }

  const boundaryTimes = slots.flatMap(slot => [slot.start, slot.end]);
  const insideSlot = (time: number) => slots.some(slot => time > slot.start + BOUNDARY_TOLERANCE_SEC && time < slot.end - BOUNDARY_TOLERANCE_SEC);
  type Candidate = {at: number; anchor: DensityResult['added'][number]['anchor']; rank: number};
  const candidates: Candidate[] = [];
  const consider = (times: readonly number[], anchor: Candidate['anchor'], rank: number) => {
    for (const time of times) if (Number.isFinite(time) && time >= edge && time <= input.durationSec - edge) candidates.push({at: round(time), anchor, rank});
  };
  consider(boundaryTimes, 'asset_boundary', 3);
  consider(input.cutTimes ?? [], 'cut', 2);
  consider(input.voCutTimes ?? [], 'vo_cut', 1.5);
  consider(input.sentenceStarts, 'sentence', 1);
  // a cut or sentence start strictly inside a slot window is demoted to the last-resort tier
  const usable = candidates
    .filter(candidate => !avoid.some(window => candidate.at >= window.start && candidate.at < window.end))
    .map(candidate => (candidate.anchor !== 'asset_boundary' && insideSlot(candidate.at) ? {...candidate, anchor: 'mid_slot' as const, rank: 0} : candidate));

  const keywordAt = keywordFor;

  while (placed.length < target) {
    const times = [0, ...placed.map(item => item.at).sort((a, b) => a - b), input.durationSec];
    const gaps = times.slice(1).map((end, index) => ({start: times[index]!, end})).sort((a, b) => b.end - b.start - (a.end - a.start));
    let pick: Candidate | undefined;
    for (const gap of gaps) {
      const middle = (gap.start + gap.end) / 2;
      const fits = usable.filter(candidate => candidate.at - gap.start >= minGap && gap.end - candidate.at >= minGap && placed.every(item => Math.abs(item.at - candidate.at) >= minGap));
      // best tier first; inside a tier, the nearest to the middle of the gap
      pick = fits.sort((a, b) => b.rank - a.rank || Math.abs(a.at - middle) - Math.abs(b.at - middle))[0];
      if (pick) break;
    }
    if (!pick) {
      // WP22: no anchor fits any gap: put a gap-fill transition in the middle of the largest gap that can hold one
      const gap = gaps.find(item => item.end - item.start >= 2 * minGap + 0.2 && item.start + (item.end - item.start) / 2 >= edge && item.start + (item.end - item.start) / 2 <= input.durationSec - edge && !avoid.some(window => (item.start + item.end) / 2 >= window.start && (item.start + item.end) / 2 < window.end));
      if (!gap) break;
      pick = {at: round((gap.start + gap.end) / 2), anchor: 'gap_fill', rank: -1};
    }
    const keyword = keywordAt(placed.length, pick.at);
    placed.push({at: pick.at, keyword});
    added.push({at: pick.at, keyword, anchor: pick.anchor});
  }
  added.sort((a, b) => a.at - b.at);
  return {added, target, total: placed.length};
}

/** The sentence starts of a timed word list (a sentence ends at . ? ! or a pause of 0.8 s). Output time. */
export function sentenceStartsOf(words: ReadonlyArray<{text: string; start: number; end: number}>): number[] {
  const starts: number[] = [];
  let open = true;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (open) {
      starts.push(word.start);
      open = false;
    }
    const next = words[index + 1];
    if (/[.?!]["')”’]*$/.test(word.text) || (next && next.start - word.end >= 0.8)) open = true;
  }
  return starts;
}

/** A TransitionClip for a density-added transition (procedural: no asset, `renderGenerated`). */
export function densityTransitionClip(item: {at: number; keyword: string}, index: number): TransitionClip {
  return {
    at: item.at,
    duration: item.keyword === 'smash zoom' ? 0.4 : 0.38,
    keyword: item.keyword,
    assetUrl: '',
    blend: index % 2 === 0 ? 'screen' : 'lighten',
    provider: 'generated',
    providerId: 0,
    width: 1080,
    height: 1920,
    credit: '',
    creditUrl: '',
    renderGenerated: true,
  };
}
