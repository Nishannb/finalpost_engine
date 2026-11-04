/**
 * Placement: where on the video the bed starts and ends. A pure function of the bed's MEASURED meta (downbeats, energy map, lift) and the video.
 *
 * Start: frame 0 of the video lands on a bed downbeat. The offset is chosen from the downbeats only, scored by
 *   3.0 x the lift landing within +-1 beat of the hook (decays to 0 at 4 beats), 1.5 x correlation of the bed's energy with the video's intensity,
 *   0.5 x a quiet intro-like bar in the first 1.5 s, 0.2 x the track covering the whole video without a hand-off.
 * A candidate must cover the video or hand off cleanly to the loop body. The hand-off is on a bar line.
 * End: the last bar line at or before the video end; a 120 ms fade from there and silence after. More than 1.5 s early: hold to the end and fade over 400 ms.
 *
 * Voice-first: this module outputs times and a fade length. It cannot raise a level, and the ducking envelope (video time) is untouched.
 */

import type {AudioDesign} from '../../types/blueprint.ts';
import type {BedPlacementMeta} from './placementMeta.ts';

export const PLACEMENT_WEIGHTS = {lift: 3, correlation: 1.5, quietIntro: 0.5, coverage: 0.2} as const; // strong, medium, a preference, a small bonus
const MAX_WEIGHT = 3 + 1.5 + 0.5 + 0.2;
export const LIFT_FULL_BEATS = 1;
export const LIFT_ZERO_BEATS = 4;
export const INTRO_WINDOW_SEC = 1.5;
export const MIN_REMAINING_SEC = 6;
export const BUTTON_FADE_SEC = 0.12;
export const HOLD_FADE_SEC = 0.4;
export const BUTTON_MAX_EARLY_SEC = 1.5;

export type PlacementInput = {
  bed: BedPlacementMeta | null | undefined;
  durationSec: number;
  hookAtSec: number;
  /** Per-second 0..1 video intensity (intensity.ts). */
  intensity: ReadonlyArray<number>;
  /** Fallback beat length source when the bed has no bar length. */
  bpm?: number;
};

export type Placement = {
  startOffsetSec: number;
  /** Video time at which the music is silent from. Button: the last bar line + the fade. Hold-fade: the video end. */
  endSec: number;
  endType: 'button' | 'hold-fade';
  endFadeSec: number;
  /** Video time where the loop body takes over from the full bed (a bar line). Null when the full bed covers the video. */
  loopFromSec: number | null;
  /** 0..1, or null when there was no meta to score. */
  score: number | null;
  startsOnDownbeat: boolean;
  liftAtVideoSec: number | null;
  liftErrBeats: number | null;
  /** Bar lines and beats in VIDEO time, for SFX snapping. Not stored on the blueprint. */
  barLinesSec: number[];
  beatsSec: number[];
  reason: 'placed' | 'no_meta' | 'no_valid_start';
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const meanA = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const meanB = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i]! - meanA) * (b[i]! - meanB);
    varA += (a[i]! - meanA) ** 2;
    varB += (b[i]! - meanB) ** 2;
  }
  return varA < 1e-9 || varB < 1e-9 ? null : cov / Math.sqrt(varA * varB);
}

/** Index of the last downbeat at or before `time` (-1 before the first). */
function barIndexAt(downbeats: readonly number[], time: number): number {
  let lo = 0;
  let hi = downbeats.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (downbeats[mid]! <= time + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function energyAt(bed: BedPlacementMeta, time: number): number {
  const map = bed.energyMap;
  if (map.length === 0) return 0;
  const index = barIndexAt(bed.downbeatTimes, time);
  if (index < 0) return map[0]!;
  if (index >= map.length) {
    const tail = map.slice(-4);
    return tail.reduce((x, y) => x + y, 0) / tail.length; // past the measured bars the loop body is steady
  }
  return map[index]!;
}

export function placementBarLen(bed: BedPlacementMeta, bpm?: number): number {
  if (bed.barSec && bed.barSec > 0) return bed.barSec;
  const d = bed.downbeatTimes;
  if (d.length >= 2) return (d[d.length - 1]! - d[0]!) / (d.length - 1);
  return bpm && bpm > 0 ? (4 * 60) / bpm : 2;
}

type Candidate = {offset: number; score: number; handoff: boolean; liftAt: number | null; liftErrBeats: number | null};

export function placeMusic(input: PlacementInput): Placement {
  const duration = Math.max(0, input.durationSec);
  const bed = input.bed;
  const hold = (reason: Placement['reason']): Placement => ({
    startOffsetSec: 0,
    endSec: round3(duration),
    endType: 'hold-fade',
    endFadeSec: HOLD_FADE_SEC,
    loopFromSec: null,
    score: null,
    startsOnDownbeat: false,
    liftAtVideoSec: null,
    liftErrBeats: null,
    barLinesSec: [],
    beatsSec: [],
    reason,
  });
  if (!bed || bed.downbeatTimes.length < 2 || !bed.fullDurationSec || duration <= 0) return hold('no_meta');

  const fullDur = bed.fullDurationSec;
  const barLen = placementBarLen(bed, input.bpm);
  const beatLen = barLen / 4;
  const loopBar = bed.hasLoop && bed.loopDurationSec && bed.loopBars && bed.loopBars > 0 ? bed.loopDurationSec / bed.loopBars : barLen;
  const loopOk = bed.hasLoop && Boolean(bed.loopDurationSec);
  const candidates: Candidate[] = [];
  for (const d of bed.downbeatTimes) {
    const remaining = fullDur - d;
    if (remaining < Math.min(MIN_REMAINING_SEC, duration)) continue;
    const covers = remaining >= duration - 1e-6;
    if (!covers && !loopOk) continue;
    // Lift.
    let liftAt: number | null = null;
    let liftErrBeats: number | null = null;
    let liftScore = 0;
    if (bed.liftSec !== null && bed.liftSec >= d) {
      liftAt = bed.liftSec - d;
      liftErrBeats = Math.abs(liftAt - input.hookAtSec) / beatLen;
      liftScore = liftErrBeats <= LIFT_FULL_BEATS ? 1 : Math.max(0, 1 - (liftErrBeats - LIFT_FULL_BEATS) / (LIFT_ZERO_BEATS - LIFT_FULL_BEATS));
    }
    // Correlation of bed energy with video intensity, per second.
    const seconds = Math.min(input.intensity.length, Math.ceil(duration));
    const bedEnergy = Array.from({length: seconds}, (_, t) => energyAt(bed, d + t + 0.5));
    const r = pearson(bedEnergy, input.intensity.slice(0, seconds) as number[]);
    const corrScore = r === null ? 0.5 : (r + 1) / 2;
    // Quiet, intro-like bar(s) under the first 1.5 s.
    const introBars = bed.downbeatTimes
      .map((t, index) => ({t, index}))
      .filter(({t, index}) => t < d + INTRO_WINDOW_SEC && (bed.downbeatTimes[index + 1] ?? fullDur) > d)
      .map(({index}) => bed.energyMap[index] ?? 0);
    const introEnergy = introBars.length > 0 ? introBars.reduce((x, y) => x + y, 0) / introBars.length : energyAt(bed, d);
    const quiet = Math.min(1, Math.max(0, 1 - introEnergy));
    const score =
      PLACEMENT_WEIGHTS.lift * liftScore + PLACEMENT_WEIGHTS.correlation * corrScore + PLACEMENT_WEIGHTS.quietIntro * quiet + (covers ? PLACEMENT_WEIGHTS.coverage : 0);
    candidates.push({offset: d, score, handoff: !covers, liftAt, liftErrBeats});
  }
  if (candidates.length === 0) {
    // The bed cannot cover the video and has no loop: start at the first downbeat and let the music end with the file.
    const first = bed.downbeatTimes[0]!;
    const available = Math.max(0, fullDur - first);
    const grid = bed.downbeatTimes.map(t => t - first).filter(t => t >= 0 && t <= Math.min(duration, available));
    return {
      ...hold('no_valid_start'),
      startOffsetSec: round3(first),
      startsOnDownbeat: true,
      endSec: round3(Math.min(duration, available)),
      barLinesSec: grid.map(round3),
      beatsSec: beatsFrom(grid, beatLen, Math.min(duration, available)),
    };
  }
  // Highest score; ties go to the earlier downbeat.
  const best = candidates.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a));
  const offset = best.offset;

  // Bar lines in video time.
  const fullEnd = fullDur - offset;
  const fromFull = bed.downbeatTimes.map(t => t - offset).filter(t => t >= -1e-9 && t <= Math.min(duration, fullEnd) + 1e-9);
  let loopFrom: number | null = null;
  const lines = [...fromFull];
  if (best.handoff) {
    // The loop takes over on the last bar line of the full bed, so the hand-off is on the grid.
    loopFrom = fromFull.length > 0 ? fromFull[fromFull.length - 1]! : fullEnd;
    for (let t = loopFrom + loopBar; t <= duration + 1e-9; t += loopBar) lines.push(t);
  }
  const barLines = lines.map(round3);
  const last = barLines.filter(t => t <= duration + 1e-9).at(-1);
  let endType: Placement['endType'] = 'hold-fade';
  let endSec = duration;
  let endFade = HOLD_FADE_SEC;
  if (last !== undefined && duration - last <= BUTTON_MAX_EARLY_SEC) {
    endType = 'button';
    endFade = BUTTON_FADE_SEC;
    endSec = Math.min(duration, last + BUTTON_FADE_SEC);
  }
  return {
    startOffsetSec: round3(offset),
    endSec: round3(endSec),
    endType,
    endFadeSec: endFade,
    loopFromSec: loopFrom === null ? null : round3(loopFrom),
    score: round3(best.score / MAX_WEIGHT),
    startsOnDownbeat: true,
    liftAtVideoSec: best.liftAt === null ? null : round3(best.liftAt),
    liftErrBeats: best.liftErrBeats === null ? null : round3(best.liftErrBeats),
    barLinesSec: barLines,
    beatsSec: beatsFrom(barLines, beatLen, duration),
    reason: 'placed',
  };
}

/** Four beats per bar line, up to `limit`. */
function beatsFrom(barLines: readonly number[], beatLen: number, limit: number): number[] {
  const beats: number[] = [];
  barLines.forEach((line, index) => {
    const next = barLines[index + 1];
    const len = next !== undefined ? (next - line) / 4 : beatLen;
    for (let k = 0; k < 4; k += 1) {
      const t = line + k * len;
      if (t <= limit + 1e-9) beats.push(round3(t));
    }
  });
  return beats;
}

/** The only AudioDesign fields placement writes. Nothing here is a gain: the duck envelope and every level are untouched. */
export function placementFields(placement: Placement): Pick<AudioDesign, 'musicStartOffsetSec' | 'musicEndSec' | 'musicEndFadeSec' | 'musicEndType' | 'musicLoopFromSec' | 'musicPlacementScore'> {
  return {
    musicStartOffsetSec: placement.startOffsetSec,
    musicEndSec: placement.endSec,
    musicEndFadeSec: placement.endFadeSec,
    musicEndType: placement.endType,
    ...(placement.loopFromSec !== null ? {musicLoopFromSec: placement.loopFromSec} : {}),
    ...(placement.score !== null ? {musicPlacementScore: placement.score} : {}),
  };
}

export function withPlacement(audio: AudioDesign, placement: Placement): AudioDesign {
  return {...audio, ...placementFields(placement)};
}
