/**
 * Output frame rate of an edit. Post-integration fix: every edit used to be forced to 30 fps (config/env.ts OUTPUT_FPS), so a 24 fps source was resampled to 30 (one
 * duplicated frame every 4 source frames, and frame-to-time conversions on a grid the footage does not have).
 *
 *   OUTPUT_FPS_MODE=source (default): keep the source rate when it is an ordinary video rate (23.5..30.5 fps: 23.976, 24, 25, 29.97, 30). Anything else is converted to 30
 *                                      with a recorded reason: unknown / variable rate (probe gave no usable value), below 23.5, or above 30.5 (50 / 60 fps: a 30 fps
 *                                      deliverable halves render work and is the shorts standard).
 *   OUTPUT_FPS_MODE=fixed30          : the previous behaviour, always 30.
 *
 * Stored blueprints carry their own fps and render exactly as before. Pure.
 */
export type OutputFpsMode = 'source' | 'fixed30';

export const LEGACY_OUTPUT_FPS = 30;
export const SOURCE_FPS_MIN = 23.5;
export const SOURCE_FPS_MAX = 30.5;

export type OutputFpsDecision = {fps: number; reason: 'source' | 'fixed30' | 'converted:unknown_rate' | 'converted:below_range' | 'converted:above_range'};

export function parseOutputFpsMode(raw: string | undefined): OutputFpsMode {
  return (raw ?? '').trim().toLowerCase() === 'fixed30' ? 'fixed30' : 'source';
}

export function resolveOutputFps(sourceFps: number | null | undefined, mode: OutputFpsMode): OutputFpsDecision {
  if (mode === 'fixed30') return {fps: LEGACY_OUTPUT_FPS, reason: 'fixed30'};
  if (typeof sourceFps !== 'number' || !Number.isFinite(sourceFps) || sourceFps <= 0) return {fps: LEGACY_OUTPUT_FPS, reason: 'converted:unknown_rate'};
  if (sourceFps < SOURCE_FPS_MIN) return {fps: LEGACY_OUTPUT_FPS, reason: 'converted:below_range'};
  if (sourceFps > SOURCE_FPS_MAX) return {fps: LEGACY_OUTPUT_FPS, reason: 'converted:above_range'};
  // three decimals keep 23.976 / 29.97 (NTSC rates) within ~1e-6 of the true rational rate: no audible / visible drift over a short
  return {fps: Math.round(sourceFps * 1000) / 1000, reason: 'source'};
}
