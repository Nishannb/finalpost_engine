/**
 * The end of a placed bed: full level until `endSec - fadeSec`, a straight fade to 0 at `endSec`, silence after.
 * Pure. The result is always between 0 and 1: placement can only make the bed quieter, never louder (docs/audio/VOICE_FIRST.md).
 * server/src/stages/music/placement.ts decides endSec and the fade (0.12 button, 0.4 hold-and-fade); this file only evaluates them.
 */
export function placementGainAt(timeSec: number, endSec: number | undefined, fadeSec: number | undefined): number {
  if (endSec === undefined || !Number.isFinite(endSec)) return 1;
  const fade = Math.max(0.001, fadeSec ?? 0.4);
  if (timeSec >= endSec) return 0;
  const fadeStart = endSec - fade;
  if (timeSec <= fadeStart) return 1;
  return Math.min(1, Math.max(0, (endSec - timeSec) / fade));
}
