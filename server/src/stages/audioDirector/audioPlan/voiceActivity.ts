/**
 * Measured voice activity for SFX placement (pure). The creator's own audio decides where speech is NOT: ASR word times on dense speech are
 * contiguous (one word's end is the next word's start), so they cannot show the real micro-pauses between words. This map can.
 *
 * Input: frame levels (dBFS, RMS per `frameSec`) of the creator's voice in the OUTPUT timeline. A frame is silent only when it is BOTH
 *   - at least VOICE_ACTIVITY.minBelowSpeechDb under the voice's own p95 frame level (never call anything within 25 dB of the speech "silence"), and
 *   - at or below max(p95 - 35 dB, noise floor (p5) + 6 dB) (a quiet room uses the 35 dB rule; a noisy room uses its floor plus 6 dB).
 * Silent runs shorter than `minSilenceSec` are discarded (they are inside speech: stop closures, short dips).
 * The result is used ONLY to forbid placements: no silence map means no acoustic placement at all (fail safe).
 */

export const VOICE_ACTIVITY = Object.freeze({
  frameSec: 0.01,
  belowP95Db: 35,
  aboveFloorDb: 6,
  minBelowSpeechDb: 25,
  minSilenceSec: 0.08,
});

export type VoiceActivityMap = {
  source: 'measured';
  frameSec: number;
  speechP95Dbfs: number;
  noiseFloorDbfs: number;
  thresholdDbfs: number;
  /** Silent intervals in OUTPUT seconds, sorted, non-overlapping. */
  silences: Array<[number, number]>;
};

const percentile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Frame levels (dBFS) in output order -> the silence map. Null when there is no usable signal (all frames silent or too few frames). */
export function voiceActivityFromFrames(framesDb: readonly number[], frameSec = VOICE_ACTIVITY.frameSec): VoiceActivityMap | null {
  const finite = framesDb.filter(Number.isFinite);
  if (finite.length < 50) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  const floor = percentile(sorted, 0.05);
  if (p95 - floor < VOICE_ACTIVITY.minBelowSpeechDb) return null; // no clear speech/silence contrast: nothing can be proven silent
  const threshold = Math.min(p95 - VOICE_ACTIVITY.minBelowSpeechDb, Math.max(p95 - VOICE_ACTIVITY.belowP95Db, floor + VOICE_ACTIVITY.aboveFloorDb));
  const silences: Array<[number, number]> = [];
  let runStart = -1;
  for (let i = 0; i <= framesDb.length; i += 1) {
    const silent = i < framesDb.length && Number.isFinite(framesDb[i]!) && framesDb[i]! <= threshold;
    if (silent && runStart < 0) runStart = i;
    if (!silent && runStart >= 0) {
      if ((i - runStart) * frameSec >= VOICE_ACTIVITY.minSilenceSec - 1e-9) silences.push([round3(runStart * frameSec), round3(i * frameSec)]);
      runStart = -1;
    }
  }
  return {source: 'measured', frameSec, speechP95Dbfs: Math.round(p95 * 10) / 10, noiseFloorDbfs: Math.round(floor * 10) / 10, thresholdDbfs: Math.round(threshold * 10) / 10, silences};
}

/** The silence containing [fromSec, toSec] entirely, if any. */
export function containingSilence(silences: ReadonlyArray<readonly [number, number]>, fromSec: number, toSec: number): readonly [number, number] | null {
  for (const silence of silences) if (silence[0] <= fromSec + 1e-9 && silence[1] >= toSec - 1e-9) return silence;
  return null;
}
