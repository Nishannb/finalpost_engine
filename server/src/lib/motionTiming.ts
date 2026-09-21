/**
 * Shared motion clocks for split, zoom, and frame-inset.
 * Enter can stay punchy; retract must be a hold-then-smooth-out, never a snap.
 */

export const SPLIT_ENTER_SEC = 1.45;
export const SPLIT_EXIT_SEC = 1.35;
export const SPLIT_MIN_STILL_SEC = 4;
export const SPLIT_MAX_PLAY_SEC = 8;

export const ZOOM_IN_RAMP_SEC = 0.35;
export const ZOOM_OUT_RAMP_SEC = 1;

export const FRAME_INSET_ENTER_SEC = 0.9;
export const FRAME_INSET_EXIT_SEC = 0.9;
export const FRAME_INSET_MIN_STILL_SEC = 2.2;

export function splitStillSec(input: {
  speechSec: number;
  mediaKind: 'video' | 'image' | 'text';
  assetDurationSec?: number;
}): number {
  const clip = input.assetDurationSec ?? 0;
  if (input.mediaKind === 'video' && clip >= 0.4) {
    return Math.min(SPLIT_MAX_PLAY_SEC, Math.max(0.8, clip));
  }
  return Math.max(SPLIT_MIN_STILL_SEC, input.speechSec);
}

export function splitTotalSec(stillSec: number): number {
  return SPLIT_ENTER_SEC + Math.max(0.35, stillSec) + SPLIT_EXIT_SEC;
}

export function frameInsetTotalSec(stillSec: number): number {
  return (
    FRAME_INSET_ENTER_SEC +
    Math.max(FRAME_INSET_MIN_STILL_SEC, stillSec) +
    FRAME_INSET_EXIT_SEC
  );
}

/** Envelope 0–1: snappy zoom-in, slower smooth zoom-out. */
export function zoomEnvelope(
  timeSec: number,
  start: number,
  end: number,
  inRampSec = ZOOM_IN_RAMP_SEC,
  outRampSec = ZOOM_OUT_RAMP_SEC,
): number {
  if (timeSec < start || timeSec > end) {
    return 0;
  }
  const inT = easeInOut(clamp01((timeSec - start) / Math.max(0.05, inRampSec)));
  const outT = easeInOutCubic(clamp01((end - timeSec) / Math.max(0.05, outRampSec)));
  return Math.min(inT, outT);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
