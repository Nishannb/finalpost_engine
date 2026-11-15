/**
 * Phase 4.5: turns TIMESTAMPED speaker boxes (what the pipeline really measures: Gemini Vision boxes with a time, never invented tracking) into the `motion` track of resolveSpeakerGeometry, under an explicit policy.
 * Pure. Boxes are SOURCE fractions (as the detector returns them); the cover crop and the punch-in zoom are applied afterwards by speakerGeometry.ts, so the renderer's transformations are untouched.
 *
 * Policy (every constant is a documented assumption, not a calibrated value; there is no tracker data to calibrate on):
 *  - only samples with source 'vision' and a valid box are used; a 'fallback' box is the default guess, not a measurement. Rejections are reported.
 *  - between two usable samples: LINEAR INTERPOLATION only when the gap <= maxInterpGapSec AND the largest edge displacement <= interpTolerance. Otherwise the box is the HULL (bounding union) of the two samples
 *    for the whole gap: it contains every linear path, and every path that stays between the two positions, so a sudden jump or an unobserved move cannot leave the head outside.
 *  - before the first / after the last sample the exact box is HELD for at most maxHoldSec. Beyond that the position is UNOBSERVED: the box is the hull of ALL usable samples with unobservedMargin added to the face region.
 *    Nothing is extrapolated indefinitely.
 * Known limit: the hull assumes the person stays between the two observed positions; a move outside both is not observable from two samples (reported as `unobservedFrames` / `hullFrames`).
 */
import type {Box} from './scene.ts';
import {validateSpeakerBox} from './speakerBox.ts';

export type TrackingSample = {atSec: number; box: unknown; source: string};
export type MotionPolicy = {maxInterpGapSec: number; interpTolerance: number; maxHoldSec: number; /** a hull over a gap longer than this, or across a cut, gets the unobserved margin instead of the small path margin */ longGapSec: number; unobservedMargin: {x: number; y: number}; /** margin on the face region for every span that is observed, held, interpolated or hulled (a smooth path between two samples bulges past the straight line / the hull: a 6 s sway sampled every 1 s overshoots by about 0.7% of the frame height). Default interpTolerance / 3. A heuristic measured on synthetic motion only, not a guarantee. */ pathMargin?: number; /** Phase 4.8 (M3, EVALUATED AND REJECTED as a default): credit the measured face-bottom slack (speakerGeometry FACE_BOTTOM_SLACK_OF_HEIGHT) against the bottom of every margin. On real frames it saves only ~1% of the frame AND it
   *  breaks face protection for a box observed 3% too HIGH (inside the declared budget: chin exposed by 22-32 px on instalive). Default false = symmetric margins; kept as an option only for the record. */ asymmetricBottom?: boolean};
export const DEFAULT_MOTION_POLICY: MotionPolicy = {maxInterpGapSec: 1.0, interpTolerance: 0.03, maxHoldSec: 0.5, longGapSec: 3.0, unobservedMargin: {x: 0.05, y: 0.04}, asymmetricBottom: false};
export type MotionMode = 'held' | 'interpolated' | 'hull' | 'unobserved';
export type MotionSpan = {fromFrame: number; toFrame: number; mode: MotionMode};
export type MotionReport = {
  offered: number; usable: number; rejected: Array<{atSec: number; reason: string}>;
  maxGapSec: number | null; spans: MotionSpan[];
  frames: Record<MotionMode, number>;
  /** frames not covered by an observation or an interpolation between observations (hull + unobserved): protection there is conservative, not measured */
  conservativeFraction: number;
};
/** `margin` (composition fractions) is applied by resolveSpeakerGeometry to the FACE region after the crop mapping (the face is the top 42% of the box, so inflating the person box would not enlarge the face rectangle as intended) */
export type MotionPoint = {frame: number; box: Box; margin?: {x: number; y: number; asymmetric?: boolean}; /** further boxes this point must protect (hull spans / unobserved): the face-aware hull is built by resolveSpeakerGeometry after the crop mapping */ cover?: Box[]};
export type MotionPlan = {motion: MotionPoint[]; report: MotionReport};

const hull = (a: Box, b: Box): Box => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h); return {x: x0, y: y0, w: x1 - x0, h: y1 - y0}; };
const edgeDisp = (a: Box, b: Box): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h));

/** null when there is no usable sample: the caller keeps the one static box (and should say so) */
export function planSpeakerMotion(input: {samples: readonly TrackingSample[]; fps: number; durationFrames: number; policy?: Partial<MotionPolicy>; /** output frames where the edit joins two source stretches (keep-segment starts): the position can jump there, so nothing is interpolated or held across one */ cutFrames?: readonly number[]}): MotionPlan | null {
  const pol: MotionPolicy = {...DEFAULT_MOTION_POLICY, ...(input.policy ?? {}), unobservedMargin: {...DEFAULT_MOTION_POLICY.unobservedMargin, ...(input.policy?.unobservedMargin ?? {})}};
  const {fps, durationFrames} = input;
  const rejected: Array<{atSec: number; reason: string}> = [];
  const usable: Array<{frame: number; box: Box}> = [];
  for (const s of input.samples) {
    if (!Number.isFinite(s.atSec) || s.atSec < 0 || s.atSec * fps > durationFrames) { rejected.push({atSec: s.atSec, reason: 'outside_timeline'}); continue; }
    if (s.source !== 'vision') { rejected.push({atSec: s.atSec, reason: 'not_measured'}); continue; }
    const box = validateSpeakerBox(s.box);
    if (!box) { rejected.push({atSec: s.atSec, reason: 'invalid_box'}); continue; }
    const frame = Math.round(s.atSec * fps);
    const dup = usable.find(u => u.frame === frame);
    if (dup) dup.box = hull(dup.box, box); else usable.push({frame, box});
  }
  usable.sort((a, b) => a.frame - b.frame);
  const report = (spans: MotionSpan[]): MotionReport => {
    const frames: Record<MotionMode, number> = {held: 0, interpolated: 0, hull: 0, unobserved: 0};
    for (const sp of spans) frames[sp.mode] += Math.max(0, sp.toFrame - sp.fromFrame + 1);
    const total = Math.max(1, frames.held + frames.interpolated + frames.hull + frames.unobserved);
    let maxGap: number | null = null; for (let i = 1; i < usable.length; i += 1) maxGap = Math.max(maxGap ?? 0, (usable[i]!.frame - usable[i - 1]!.frame) / fps);
    return {offered: input.samples.length, usable: usable.length, rejected, maxGapSec: maxGap, spans, frames, conservativeFraction: Math.round(((frames.hull + frames.unobserved) / total) * 1000) / 1000};
  };
  if (usable.length === 0) return null;

  const U = usable[0]!.box; // the unobserved span protects the face-aware hull of ALL usable boxes (`cover`), built after the crop mapping
  const H = Math.round(pol.maxHoldSec * fps), G = Math.round(pol.maxInterpGapSec * fps), LONG = Math.round(pol.longGapSec * fps);
  const pm = pol.pathMargin ?? pol.interpTolerance / 3, pathMargin = {x: pm, y: pm};
  const cuts = [...(input.cutFrames ?? [])].filter(c => c > 0).sort((a, b) => a - b);
  const cutBetween = (f0: number, f1: number) => cuts.some(c => c > f0 && c <= f1);
  // the largest speed ACTUALLY OBSERVED between two samples of the same shot (fraction of the frame per second): a held box grows its margin at that speed, so a fast mover is not assumed still
  let vmax = 0;
  for (let i = 1; i < usable.length; i += 1) { const p = usable[i - 1]!, q = usable[i]!; if (q.frame - p.frame <= G && !cutBetween(p.frame, q.frame)) vmax = Math.max(vmax, edgeDisp(p.box, q.box) / Math.max(1 / fps, (q.frame - p.frame) / fps)); }
  const grown = (frames: number) => { const g = pm + vmax * (frames / fps); return {x: g, y: g}; };
  type Piece = {f0: number; f1: number; b0: Box; b1: Box; mode: MotionMode; m0?: {x: number; y: number}; m1?: {x: number; y: number}; cover?: Box[]};
  const pieces: Piece[] = [];
  const first = usable[0]!, last = usable[usable.length - 1]!;
  const all = usable.map(u => u.box);
  const holdStart = Math.max(first.frame - H, ...cuts.filter(c => c <= first.frame), 0);
  const nextCut = cuts.find(c => c > last.frame);
  const holdEnd = Math.min(last.frame + H, durationFrames, nextCut !== undefined ? nextCut - 1 : durationFrames);
  if (holdStart > 0) pieces.push({f0: 0, f1: holdStart - 1, b0: U, b1: U, mode: 'unobserved', m0: pol.unobservedMargin, m1: pol.unobservedMargin, cover: all});
  pieces.push({f0: holdStart, f1: first.frame, b0: first.box, b1: first.box, mode: 'held', m0: grown(first.frame - holdStart), m1: pathMargin});
  for (let i = 1; i < usable.length; i += 1) {
    const p = usable[i - 1]!, q = usable[i]!, gap = q.frame - p.frame;
    if (gap <= G && !cutBetween(p.frame, q.frame) && edgeDisp(p.box, q.box) <= pol.interpTolerance) pieces.push({f0: p.frame + 1, f1: q.frame, b0: p.box, b1: q.box, mode: 'interpolated', m0: pathMargin, m1: pathMargin});
    else { const m = gap > LONG || cutBetween(p.frame, q.frame) ? pol.unobservedMargin : pathMargin; pieces.push({f0: p.frame + 1, f1: q.frame, b0: p.box, b1: p.box, mode: 'hull', m0: m, m1: m, cover: [q.box]}); }
  }
  pieces.push({f0: last.frame + 1, f1: holdEnd, b0: last.box, b1: last.box, mode: 'held', m0: pathMargin, m1: grown(holdEnd - last.frame)});
  if (holdEnd < durationFrames) pieces.push({f0: holdEnd + 1, f1: durationFrames, b0: U, b1: U, mode: 'unobserved', m0: pol.unobservedMargin, m1: pol.unobservedMargin, cover: all});
  const live = pieces.filter(p => p.f1 >= p.f0);
  const motion: MotionPoint[] = [];
  const asym = (m?: {x: number; y: number}) => (m ? {margin: pol.asymmetricBottom ? {...m, asymmetric: true} : m} : {});
  for (const p of live) { const c = p.cover ? {cover: p.cover} : {}; motion.push({frame: p.f0, box: p.b0, ...asym(p.m0), ...c}, {frame: p.f1, box: p.b1, ...asym(p.m1), ...c}); }
  return {motion, report: report(live.map(p => ({fromFrame: p.f0, toFrame: p.f1, mode: p.mode})))};
}
