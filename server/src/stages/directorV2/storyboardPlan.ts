/**
 * Which frames the v2 perception pack samples, as pure functions of the output duration.
 *
 * `legacy*` reproduces the behaviour that shipped before the visual-context work, exactly, so it can be pinned by a
 * golden test and so the default path stays unchanged. The coverage-based planner lives in `visualContext.ts`
 * and is used only behind `VISUAL_CONTEXT_V2`.
 */

/** Frames the Director calls actually receive (`geminiClient.frameParts` default limit). */
export const LEGACY_FRAME_SEND_LIMIT = 8;

/** Output-time seconds of the storyboard stills: 0.4 s, then every 1.5 s, at most 10. */
export function legacyStoryboardTimes(durationSec: number): number[] {
  const step = 1.5;
  const count = Math.min(10, Math.max(2, Math.ceil(durationSec / step)));
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    times.push(Math.min(durationSec - 0.15, 0.4 + i * step));
  }
  return times;
}

/** Output-time seconds at which the three speaker-occupancy slices are measured. */
export function legacyOccupancySliceTimes(durationSec: number): number[] {
  return [0.4, durationSec * 0.45, Math.max(0.6, durationSec - 0.6)];
}
