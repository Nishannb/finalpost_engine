/**
 * The loudness of the bed section that is playing at each moment of the video, for loudness-aware ducking (Phase 3.1). Pure.
 *
 * Gain at time t = (voLufs + offset) - bedLoudness(t). The static envelope assumes the bed sits at -16 LUFS everywhere; a real bed has quiet intros and loud
 * sections, so the gap to the voice moved with whatever section placement put under the speech. This builds the loudness the envelope should use:
 *   1. Which bed position plays at t: the full bed from the placement offset, then the loop body from the hand-off (a bar line), cycling.
 *   2. The per-bar LUFS at that position. Under speech the carved twin plays, so the full and carved loudness are mixed with the same weights the renderer uses.
 *   3. Smoothed over about one bar, then limited to LOUDNESS_SLEW_DB_PER_FRAME so the correction never jumps (at 30 fps).
 * duckEnvelope.ts turns it into a correction capped at +6 dB. Nothing here writes a gain.
 */

import {carvedGains, carvedMix} from './carvedMix.ts';
import {DUCK_ASSUMED_BED_LUFS, duckBaseDbAt, loudnessCorrectionDb, type BedLoudnessTrack, type DuckEnvelope} from './duckEnvelope.ts';
import type {BedPlacementMeta} from './placementMeta.ts';

export const LOUDNESS_STEP_SEC = 0.1;
/** The loudness the correction follows may move at most this much per 1/30 s frame. */
export const LOUDNESS_SLEW_DB_PER_FRAME = 0.4;
export const LOUDNESS_FPS = 30;

const round2 = (value: number) => Math.round(value * 100) / 100;

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

/** Loudness of the full bed (or its carved twin) at a bed position. Before the first bar: the first bar. Past the last: the last. */
function mapAt(downbeats: readonly number[], map: readonly number[], position: number): number {
  const index = Math.min(map.length - 1, Math.max(0, barIndexAt(downbeats, position)));
  return map[index]!;
}

export type BedLoudnessInput = {
  bed: BedPlacementMeta | null | undefined;
  /** Seconds into the bed that play at video frame 0 (placement). 0 with no placement. */
  startOffsetSec: number;
  /** Video time the loop body takes over, or null when the full bed covers the video. */
  loopFromSec: number | null;
  durationSec: number;
  /** The static envelope: its carved crossfade weights decide how much of the carved twin is playing. */
  duck: DuckEnvelope;
  /** True when the carved twin is part of the mix. */
  carved: boolean;
  stepSec?: number;
};

/** Null when the bed has no loudness map (an older bed): the duck then keeps the static gains. */
export function buildBedLoudnessTrack(input: BedLoudnessInput): BedLoudnessTrack | null {
  const bed = input.bed;
  const full = bed?.loudnessMap;
  if (!bed || !full || full.length === 0 || bed.downbeatTimes.length === 0 || input.durationSec <= 0) return null;
  const step = input.stepSec ?? LOUDNESS_STEP_SEC;
  const carvedMap = input.carved && bed.carvedLoudnessMap && bed.carvedLoudnessMap.length > 0 ? bed.carvedLoudnessMap : null;
  const loopMap = bed.loopLoudnessMap && bed.loopLoudnessMap.length > 0 ? bed.loopLoudnessMap : null;
  const loopDur = bed.loopDurationSec && bed.loopDurationSec > 0 ? bed.loopDurationSec : null;
  const n = Math.ceil(input.durationSec / step) + 1;
  const raw: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i * step;
    if (input.loopFromSec !== null && t >= input.loopFromSec && loopDur) {
      const position = (t - input.loopFromSec) % loopDur;
      if (loopMap) raw.push(loopMap[Math.min(loopMap.length - 1, Math.floor((position / loopDur) * loopMap.length))]!);
      else raw.push(bed.loopLufs ?? DUCK_ASSUMED_BED_LUFS);
      continue;
    }
    const position = input.startOffsetSec + t;
    const lFull = mapAt(bed.downbeatTimes, full, position);
    if (!carvedMap) {
      raw.push(lFull);
      continue;
    }
    // Same weights as MusicBedTrack: full = cos, carved = sin of the static crossfade; power-added.
    const mix = carvedMix(duckBaseDbAt(input.duck, t), input.duck.speechDb, input.duck.openDb, input.duck.pauseDb);
    const gains = carvedGains(mix);
    const lCarved = mapAt(bed.downbeatTimes, carvedMap, position);
    raw.push(10 * Math.log10(gains.full ** 2 * 10 ** (lFull / 10) + gains.carved ** 2 * 10 ** (lCarved / 10)));
  }
  // Smooth over about one bar (a box filter in dB), then limit the slew in both directions.
  const barSec = bed.barSec && bed.barSec > 0 ? bed.barSec : 2;
  const half = Math.max(1, Math.round(barSec / step / 2));
  const smooth = raw.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(raw.length - 1, i + half);
    let sum = 0;
    for (let k = from; k <= to; k += 1) sum += raw[k]!;
    return sum / (to - from + 1);
  });
  const maxStep = LOUDNESS_SLEW_DB_PER_FRAME * (step * LOUDNESS_FPS);
  const forward = [...smooth];
  for (let i = 1; i < forward.length; i += 1) forward[i] = Math.min(forward[i - 1]! + maxStep, Math.max(forward[i - 1]! - maxStep, forward[i]!));
  for (let i = forward.length - 2; i >= 0; i -= 1) forward[i] = Math.min(forward[i + 1]! + maxStep, Math.max(forward[i + 1]! - maxStep, forward[i]!));
  return {stepSec: step, lufs: forward.map(round2)};
}

/** Lowest and highest correction (dB) the track gives over the video, for the log. Null for an envelope with no track. */
export function loudnessCorrectionRange(duck: DuckEnvelope): {minDb: number; maxDb: number} | null {
  const track = duck.bedLoudness;
  if (!track || track.lufs.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < track.lufs.length; i += 1) {
    const c = loudnessCorrectionDb(duck, i * track.stepSec);
    min = Math.min(min, c);
    max = Math.max(max, c);
  }
  return {minDb: round2(min), maxDb: round2(max)};
}
