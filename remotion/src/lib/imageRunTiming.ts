/**
 * WP36: per-still timing of a SEQUENCE image run. Pure frame math (no React / Remotion).
 *
 * A labeled-asset run splits its window EVENLY (`holdFrames`). The faceless documentary lane needs each still to hold exactly as long as its VO caption group (0.3-2.5 s, hard cut on the group boundary), so a run may
 * carry `holdsSec` (one hold per still, seconds). Boundaries are the rounded CUMULATIVE seconds, so frame drift never accumulates across a run. The last still always runs to the end of the graphic.
 */
export type ImageRunSlot = {from: number; hold: number};

const MIN_HOLD_FRAMES = 2;

export function imageRunSlots(input: {count: number; durationInFrames: number; fps: number; holdFrames: number; holdsSec?: readonly number[]}): ImageRunSlot[] {
  const {count, durationInFrames, fps, holdFrames} = input;
  const holds = input.holdsSec;
  if (!holds || holds.length < count || !holds.slice(0, count).every(value => Number.isFinite(value) && value > 0)) {
    return Array.from({length: count}, (_, index) => ({from: index * holdFrames, hold: holdFrames}));
  }
  const starts: number[] = [];
  let cumulativeSec = 0;
  let previous = -MIN_HOLD_FRAMES;
  for (let index = 0; index < count; index += 1) {
    const from = Math.max(index === 0 ? 0 : previous + MIN_HOLD_FRAMES, Math.round(cumulativeSec * fps));
    starts.push(from);
    previous = from;
    cumulativeSec += holds[index]!;
  }
  return starts.map((from, index) => {
    const next = index < count - 1 ? starts[index + 1]! : Math.max(from + holdFrames, durationInFrames);
    return {from, hold: Math.max(MIN_HOLD_FRAMES, next - from)};
  });
}

/** Per-still framing: true = a white-bordered card with the 3D fly-out exit; false = a full-bleed cover still with the push-in (WP39: 1.00 -> 1.04 / 1.06 / 1.08 by `motionSpeed`). Absent (or short) = every still follows the run-level props. */
export const isFramedItem = (framedItems: readonly boolean[] | undefined, index: number): boolean | undefined => (framedItems && index < framedItems.length ? framedItems[index] === true : undefined);

/**
 * WP39: the full-bleed push-in speed dial. The push is linear over the still's own hold (grammar `broll.stills_motion`), and `motionSpeed` only sets how far it travels:
 *   slow   1.00 -> 1.04   the DEFAULT (calm; default shots, breathing room, chapter-adjacent shots)
 *   normal 1.00 -> 1.06
 *   fast   1.00 -> 1.08   the WP36 push (money / hook / punch windows, when the context needs energy)
 * (WP36 pushed every still 1.00 -> 1.08, which read slightly fast on 0.4-1.0 s holds.)
 */
export type MotionSpeed = 'slow' | 'normal' | 'fast';
export const MOTION_SPEEDS: readonly MotionSpeed[] = ['slow', 'normal', 'fast'];
export const DEFAULT_MOTION_SPEED: MotionSpeed = 'slow';
export const BLEED_PUSH_FROM = 1;
export const BLEED_PUSH_TO_BY_SPEED: Readonly<Record<MotionSpeed, number>> = {slow: 1.04, normal: 1.06, fast: 1.08};
/** The WP36 end scale (= `fast`), kept for callers that pin the old push. */
export const BLEED_PUSH_TO = BLEED_PUSH_TO_BY_SPEED.fast;

export const isMotionSpeed = (value: unknown): value is MotionSpeed => typeof value === 'string' && (MOTION_SPEEDS as readonly string[]).includes(value);
/** Unknown / absent -> the calm default. */
export const resolveMotionSpeed = (value: unknown): MotionSpeed => (isMotionSpeed(value) ? value : DEFAULT_MOTION_SPEED);
/** Per-still speed: absent / short array / a malformed entry falls back to the run-level speed, then the calm default. */
export const motionSpeedAt = (perItem: readonly (MotionSpeed | undefined)[] | undefined, index: number, runLevel?: MotionSpeed): MotionSpeed => {
  const own = perItem && index < perItem.length ? perItem[index] : undefined;
  return isMotionSpeed(own) ? own : resolveMotionSpeed(runLevel);
};

export const bleedScaleAt = (frame: number, hold: number, speed?: MotionSpeed): number => {
  const t = Math.min(1, Math.max(0, frame / Math.max(1, hold)));
  const to = BLEED_PUSH_TO_BY_SPEED[resolveMotionSpeed(speed)];
  return Math.round((BLEED_PUSH_FROM + (to - BLEED_PUSH_FROM) * t) * 10000) / 10000;
};
