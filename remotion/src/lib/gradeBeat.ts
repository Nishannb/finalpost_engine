/**
 * WP13B: GRADE-FLIP FACE BEATS. A short black-and-white moment on the talking head (1.2-2.5 s), a pacing reset like the Metromedia grade flips. Painted as a plain CSS `filter` on the base video track
 * (a filter on the video element itself, so it renders the same on every path). Pure: no React, no Remotion.
 */
export type GradeBeat = {startSec: number; endSec: number};

/** Seconds to ramp the grade in and out at the edges of a beat. */
export const GRADE_RAMP_SEC = 0.2;

/** 0 (colour) .. 1 (black and white) at `tSec`: ramps in over `GRADE_RAMP_SEC`, holds, ramps out. Overlapping beats take the strongest. */
export function gradeAmountAt(beats: readonly GradeBeat[] | null | undefined, tSec: number): number {
  let best = 0;
  for (const beat of beats ?? []) {
    if (!(beat.endSec > beat.startSec) || tSec < beat.startSec || tSec >= beat.endSec) continue;
    const ramp = Math.min(GRADE_RAMP_SEC, (beat.endSec - beat.startSec) / 2);
    const amount = Math.min(1, (tSec - beat.startSec) / ramp, (beat.endSec - tSec) / ramp);
    best = Math.max(best, amount);
  }
  return Math.round(best * 1000) / 1000;
}

/** The CSS filter for the base video at `tSec`, or undefined when no grade is active (so the element is untouched). */
export function gradeFilterAt(beats: readonly GradeBeat[] | null | undefined, tSec: number): string | undefined {
  const amount = gradeAmountAt(beats, tSec);
  return amount > 0 ? `grayscale(${amount}) contrast(${Math.round((1 + 0.18 * amount) * 1000) / 1000})` : undefined;
}
