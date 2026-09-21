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
