/**
 * Pure copy of the loop rule in remotion/src/components/MusicBedTrack.tsx
 * (LOOP_THRESHOLD_SEC and the `split` boolean). Keep the two in step.
 * The server must not import remotion, so the rule is duplicated here.
 */
export const LOOP_THRESHOLD_SEC = 58;

export type LoopBedSpec = {
  musicSource?: 'licensed' | 'generated';
  musicLoopUrl?: string;
  musicFullDurationSec?: number;
};

/** True when the timeline needs the looping body after the full bed. */
export function usesLoopBody(timelineSec: number, bed: LoopBedSpec): boolean {
  const split =
    bed.musicSource === 'generated' && Boolean(bed.musicLoopUrl) && (bed.musicFullDurationSec ?? 0) > 0;
  return split && timelineSec > LOOP_THRESHOLD_SEC;
}
