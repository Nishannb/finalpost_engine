import type {VisualOverlay} from '../blueprintSchema';

export const SPLIT_ENTER_SEC = 1.45;
export const SPLIT_EXIT_SEC = 1.35;
export const SPLIT_MIN_STILL_SEC = 4;

/** Seconds the related half stays fully on after enter, before exit. */
export function splitPlaySec(overlay: VisualOverlay): number {
  const hold = Math.max(0.8, overlay.end - overlay.start);
  const budget = hold - SPLIT_ENTER_SEC - SPLIT_EXIT_SEC;
  const clip = overlay.assetDurationSec ?? 0;
  if (overlay.mediaKind === 'video' && clip >= 0.4) {
    return Math.max(0.4, Math.min(clip, Math.max(0.4, budget)));
  }
  return Math.max(SPLIT_MIN_STILL_SEC, budget);
}

export function splitExitStartsAt(overlay: VisualOverlay): number {
  return SPLIT_ENTER_SEC + splitPlaySec(overlay);
}

/**
 * 2026-11-27 (Kinetic B-roll, `overlay.kineticMotion`): the enter / exit fit INSIDE the window. The legacy timing needs ~6.8 s
 * (1.45 s in, >= 4 s held, 1.35 s out); a Kinetic B-roll window is 1.5-3.5 s, so it ended before its exit began and the split vanished
 * in one frame. Here the seam slides in over ~22% of the window and slides back out over the last ~22%, finishing on the last frame.
 * Without the flag: the legacy numbers, unchanged.
 */
export function splitTiming(overlay: VisualOverlay): {enter: number; exitAt: number; exit: number} {
  if (!overlay.kineticMotion) return {enter: SPLIT_ENTER_SEC, exitAt: splitExitStartsAt(overlay), exit: SPLIT_EXIT_SEC};
  const dur = Math.max(0.6, overlay.end - overlay.start);
  const enter = Math.min(0.6, Math.max(0.3, dur * 0.22));
  const exit = Math.min(0.55, Math.max(0.28, dur * 0.22));
  return {enter, exitAt: Math.max(enter, dur - exit), exit};
}

/** at most this share of the asset's long side is cropped to fill the media half */
export const KINETIC_MAX_CROP = 0.28;

/** Drawn size of a Kinetic split asset in a `boxW` x `boxH` half: cover, unless that would crop more than KINETIC_MAX_CROP; then the largest size that crops exactly that much. */
export function kineticPlateSize(assetW: number | undefined, assetH: number | undefined, boxW: number, boxH: number): {w: number; h: number} {
  const w = assetW && assetW > 0 ? assetW : 16;
  const h = assetH && assetH > 0 ? assetH : 9;
  const contain = Math.min(boxW / w, boxH / h);
  const cover = Math.max(boxW / w, boxH / h);
  const scale = Math.min(cover, contain / (1 - KINETIC_MAX_CROP));
  return {w: Math.round(w * scale), h: Math.round(h * scale)};
}
