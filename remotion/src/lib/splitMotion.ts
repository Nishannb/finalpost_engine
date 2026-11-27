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


/**
 * 2026-11-28 (owner): every Kinetic split (`kineticMotion`, or the 11-26 `fitWidth` split that predates the flag) draws its asset once and sharp, never over a
 * blurred copy of itself, and never puts a dark caption plate or caption box over it.
 */
export function isKineticSplitOverlay(overlay: Pick<VisualOverlay, 'kineticMotion' | 'fitWidth'>): boolean {
  return Boolean(overlay.kineticMotion || overlay.fitWidth);
}

/** where the speaker's head top lands in the frame during a framed Kinetic split: just under the caption band that sits under the seam */
export const KINETIC_SPLIT_HEAD_TARGET_FRAC = 0.625;

/**
 * object-position of the speaker footage in the bottom half of a Kinetic split, from the measured head top (`speakerHeadTopFrac`, a frame fraction of the
 * 9:16 footage). The footage covers the half by width (scaled height = the frame height), so the vertical offset is chosen to put the head top at
 * KINETIC_SPLIT_HEAD_TARGET_FRAC: face and chin inside the half instead of the fixed crop that cut at the chin. Clamped to the footage. Pure.
 */
export function kineticSplitSpeakerPosition(headTopFrac: number, height: number): string {
  const feather = Math.max(40, height * 0.075);
  const bottomTop = height * 0.5 - feather * 0.55;
  const bottomH = height - bottomTop;
  const travel = height - bottomH;
  if (travel <= 0) return '50% 0%';
  const offset = headTopFrac * height - (KINETIC_SPLIT_HEAD_TARGET_FRAC * height - bottomTop);
  const p = Math.min(1, Math.max(0, offset / travel));
  return `50% ${Math.round(p * 10000) / 100}%`;
}

/**
 * 2026-11-28 (owner): a creator asset is ALWAYS shown whole: contain, never cover. The earlier plate (kineticPlateSize: up to 28% of the long side cropped,
 * plus a 1.00 -> 1.04 push) and the cover cutaway (plus a 1.00 -> 1.08 Ken Burns) cut the edges of screenshots and photos. Pure.
 */
export function kineticFitSize(assetW: number | undefined, assetH: number | undefined, boxW: number, boxH: number): {w: number; h: number} {
  const w = assetW && assetW > 0 ? assetW : 16;
  const h = assetH && assetH > 0 ? assetH : 9;
  const scale = Math.min(boxW / w, boxH / h);
  return {w: Math.floor(w * scale), h: Math.floor(h * scale)};
}

/** Settle-in motion that never exceeds the fitted size (so nothing is ever cropped): 0.97 -> 1.00 over the first 60% of the window, then held. */
export const KINETIC_FIT_SETTLE_FROM = 0.97;
export function kineticFitScale(localFrame: number, durationFrames: number): number {
  const t = Math.min(1, Math.max(0, localFrame / Math.max(1, durationFrames * 0.6)));
  const eased = 1 - Math.pow(1 - t, 3);
  return KINETIC_FIT_SETTLE_FROM + (1 - KINETIC_FIT_SETTLE_FROM) * eased;
}

/** The media half's safe box for a split (speaker below): the top half minus the seam feather, so the asset's lower edge is never faded by the seam mask. */
export function kineticSplitMediaBox(width: number, height: number): {w: number; h: number} {
  const feather = Math.max(40, height * 0.075);
  return {w: width, h: Math.round(height * 0.5 + feather * 0.55 - feather)};
}
