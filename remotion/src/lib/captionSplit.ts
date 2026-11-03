/**
 * WP2B: where captions go while a B-roll split is on screen, for blueprints that carry `legibility.captions` (the `mvp` product profile). Pure.
 *
 * A split gives the creator one half and the related media the other. Default captions sit ~14-30% up from the bottom, which is where the creator's chin and neck are when
 * the creator holds the BOTTOM half. So captions move onto the related-media half (the free half):
 *  - creator BOTTOM (media on top): the caption frame is the top half, captions at its bottom edge just above the seam (same frame mechanism the inset reveal and the
 *    generated-graphic split already use);
 *  - creator TOP (media on the bottom): the bottom half is already the free half; captions stay at the frame's bottom edge.
 * Either way they sit on a media plate, so the caller draws the dark band `plate` behind EVERY template (the package themes and the utility templates ignore `boxColor`,
 * so a per-line box alone would leave them without a measured background). Without `legibility.captions` none of this is called and nothing changes.
 */
import type {CaptionWord} from '../blueprintSchema';
import type {CaptionBand} from '../generated/placement';
import {activeLineAt, groupCaptionLines, type CaptionLine} from './timeline';

/** Share of the frame height the top region of a split occupies (the seam at full progress; same value as GENERATED_SPLIT_RATIO). */
export const SPLIT_SEAM_FRAC = 0.5;
/** Caption offset above the seam, as a share of the docked frame. */
export const PLATE_CAPTION_BOTTOM_FRAC = 0.08;
/** Height of the dark band as a share of the canvas: it must cover the conservative caption band (13% plus the offset above the seam) and two lines of the largest allowed caption (100 px at fontScale 1.4). */
export const PLATE_HEIGHT_FRAC = 0.22;

/** Vertical extent (canvas px) of the dark band behind the captions; it never leaves the media half. */
export type CaptionPlate = {top: number; height: number};

type CaptionPlacement = {
  position: 'bottom' | 'lower_third' | 'center' | 'top';
  bottomFrac: number;
  frameTopFrac: number;
  frameHeightFrac: number;
};

export function captionsForBrollSplit<T extends CaptionPlacement>(
  layout: T,
  speakerSide: 'top' | 'bottom',
  canvasHeight: number,
): {layout: T; band: CaptionBand; plate: CaptionPlate} {
  if (speakerSide === 'top') {
    const bottomFrac = Math.min(layout.bottomFrac, 0.18);
    const bottom = canvasHeight * (1 - bottomFrac);
    const top = Math.max(canvasHeight * SPLIT_SEAM_FRAC, bottom - canvasHeight * PLATE_HEIGHT_FRAC);
    const end = Math.min(canvasHeight, bottom + canvasHeight * 0.03);
    return {layout: {...layout, position: 'bottom', bottomFrac}, band: {top: bottom - canvasHeight * 0.13, bottom}, plate: {top, height: end - top}};
  }
  const seam = Math.round(canvasHeight * SPLIT_SEAM_FRAC);
  const end = seam - canvasHeight * 0.005;
  const top = Math.max(0, end - canvasHeight * PLATE_HEIGHT_FRAC);
  return {
    layout: {...layout, position: 'bottom', bottomFrac: PLATE_CAPTION_BOTTOM_FRAC, frameTopFrac: 0, frameHeightFrac: SPLIT_SEAM_FRAC},
    band: {top: seam - canvasHeight * (PLATE_CAPTION_BOTTOM_FRAC + 0.13), bottom: seam - canvasHeight * SPLIT_SEAM_FRAC * PLATE_CAPTION_BOTTOM_FRAC},
    plate: {top, height: end - top},
  };
}

/** WP3U: frames the split caption placement (dark plate and caption position) is held before a B-roll split starts and after it ends (`mvp` blueprints only, via `legibility.captions.splitHoldFrames`). */
export const CAPTION_SPLIT_HOLD_FRAMES = 6;

type HoldSplit = {start: number; end: number; speakerSide?: string};

/**
 * WP3U: the first frame and the end frame (exclusive) of the window in which the split caption placement applies for a split that is on screen from `start` to `end`
 * (seconds): the split's own frames, `holdFrames` before it and `holdFrames` after it, clamped to the video (`0` .. `durationFrames`). A split at time 0 has no hold before
 * it, a split that ends on the last frame no hold after it. The split itself is not moved; only the caption placement uses this window. Pure.
 */
export function captionSplitHoldWindow(
  split: {start: number; end: number},
  holdFrames: number,
  fps: number,
  durationFrames: number,
): {fromFrame: number; toFrame: number} {
  const hold = Math.max(0, Math.floor(holdFrames));
  return {
    fromFrame: Math.max(0, Math.ceil(split.start * fps - hold - 1e-6)),
    toFrame: Math.min(durationFrames, Math.ceil(split.end * fps + hold - 1e-6)),
  };
}

/**
 * WP3U: the split whose caption placement is in force at `frame`: the split on screen at this frame (the renderer's own rule, `start <= t < end`), else a split whose hold
 * window contains the frame (WP3V: only splits whose `speakerSide` is `'top'`). With no usable `fps`, no whole `holdFrames` above zero or no usable `durationFrames` there is NO hold (the instant switch). Pure.
 */
export function captionSplitAt<T extends HoldSplit>(
  splits: readonly T[],
  frame: number,
  options: {holdFrames?: number; fps?: number; durationFrames?: number},
): T | undefined {
  const {holdFrames, fps, durationFrames} = options;
  if (!fps || !Number.isFinite(fps) || fps <= 0) return undefined;
  const time = frame / fps;
  const instant = splits.find(split => time >= split.start && time < split.end);
  if (instant) return instant;
  if (!holdFrames || !Number.isFinite(holdFrames) || holdFrames <= 0) return undefined;
  if (durationFrames === undefined || !Number.isFinite(durationFrames) || durationFrames <= 0) return undefined;
  let best: T | undefined;
  let bestGap = Infinity;
  for (const split of splits) {
    // WP3V: only a split with the creator on TOP is held (its captions stay in the bottom safe band). With the creator on the bottom (or an unset side, which the renderer reads as bottom)
    // the split caption frame is the top half, which would draw the plate over a still-full-frame face: those splits keep the instant switch.
    if (split.speakerSide !== 'top') continue;
    const window = captionSplitHoldWindow(split, holdFrames, fps, durationFrames);
    if (frame < window.fromFrame || frame >= window.toFrame) continue;
    const gap = Math.min(Math.abs(frame - split.start * fps), Math.abs(frame - split.end * fps));
    if (gap < bestGap) {
      best = split;
      bestGap = gap;
    }
  }
  return best;
}

/** WP4D: templates that already paint their own box behind the words (the utility `box`, `grape` and `basic`); package themes are passed in separately by the caller. */
export const BOX_PAINTING_TEMPLATES: readonly string[] = ['box', 'grape', 'basic'];

/** WP4D: share of the canvas the backing plate may extend below the caption's bottom edge (the same 3% the top-speaker split plate uses). */
export const BACKING_PLATE_OVERHANG_FRAC = 0.03;

/**
 * WP4D: the dark band behind captions on full-frame footage, for blueprints that carry `legibility.captions` (the caller passes nothing otherwise). Outline-style templates (`boxColor`
 * null, and the utility templates that ignore a box colour) put white text straight on the footage; a split already gets the plate from `captionsForBrollSplit`.
 *
 * Returns null (no band) when: the template already paints a box (`box`, `grape`, `basic`, or a package theme: `packageTheme`), the blueprint gives a box colour (the template paints a
 * per-line box), a split plate is already showing, a generated split is showing (it docks captions its own way), the caption frame is not the full canvas (inset reveal), the captions are not
 * at the bottom (`center` / `top`), or the band would not fit in the lower half. Otherwise the band ends at the caption's bottom edge (`bottomFrac`) plus a small overhang, is
 * `PLATE_HEIGHT_FRAC` of the canvas tall, and never rises above the middle of the frame. Words and their timing are not touched. Pure.
 */
export function captionBackingPlate(input: {
  template?: string | null;
  packageTheme: boolean;
  boxColor?: string | null;
  splitPlateShowing: boolean;
  generatedSplitShowing?: boolean;
  layout: CaptionPlacement;
  canvasHeight: number;
}): CaptionPlate | null {
  const {layout, canvasHeight} = input;
  if (input.splitPlateShowing || input.generatedSplitShowing || input.packageTheme) return null;
  if (input.template && BOX_PAINTING_TEMPLATES.includes(input.template)) return null;
  if (input.boxColor) return null;
  if (layout.frameTopFrac !== 0 || layout.frameHeightFrac !== 1) return null;
  if (layout.position !== 'bottom' && layout.position !== 'lower_third') return null;
  if (!Number.isFinite(layout.bottomFrac) || !Number.isFinite(canvasHeight) || canvasHeight <= 0 || layout.bottomFrac < 0 || layout.bottomFrac >= 0.5) return null;
  const bottom = canvasHeight * (1 - layout.bottomFrac);
  const end = Math.min(canvasHeight, bottom + canvasHeight * BACKING_PLATE_OVERHANG_FRAC);
  const top = Math.max(canvasHeight * SPLIT_SEAM_FRAC, bottom - canvasHeight * PLATE_HEIGHT_FRAC);
  return end > top ? {top, height: end - top} : null;
}

/**
 * WP8G: the full-width backing plate on talking-head footage is OFF by default. Only a blueprint that says `legibility.captions.backingPlate === true` gets it; absent, false or any other value
 * means no band (outline / shadow / the template's own tight per-line box keep the captions readable). A genuine split layout's own plate (`captionsForBrollSplit`) is not governed by this.
 * Pure.
 */
export function captionBackingPlateEnabled(captions: {backingPlate?: unknown} | null | undefined): boolean {
  return captions?.backingPlate === true;
}

/**
 * WP4F: the caption lines the backing plate follows: the renderer's own grouping (`groupCaptionLines`) with `maxWords: 5` and every other default, the grouping the kinetic caption
 * templates use. Computed once per blueprint by the caller. Pure.
 */
export function captionPlateLines(words: CaptionWord[]): CaptionLine[] {
  return groupCaptionLines(words, {maxWords: 5});
}

/**
 * WP4F: is a caption line on screen at `timeSec`? True exactly when the renderer's `activeLineAt` (default hold, not copied here) returns a line, so the backing plate stays up across the
 * gaps inside a line and through the hold after its last word, and is down when there is no line (and for an empty list). Pure.
 */
export function captionPlateLineActive(lines: readonly CaptionLine[], timeSec: number): boolean {
  return activeLineAt(lines as CaptionLine[], timeSec) !== null;
}

/**
 * WP4K: the art-directed opening treatment covers the frame for `startSec <= time < startSec + durationSec`; the caption layer and the backing/split plate must not paint over it. True while an
 * opening is on screen at `timeSec`; false with no opening, before it starts and from its end on (the captions and plate then return exactly as before). Pure.
 */
export function openingHidesCaptions(opening: {startSec?: number; durationSec: number} | null | undefined, timeSec: number): boolean {
  if (!opening) return false;
  const start = opening.startSec ?? 0;
  return timeSec >= start && timeSec < start + opening.durationSec;
}

/** WP11A: true while `timeSec` is inside one of the ranges a text-carrying graphic mutes the captions for (start inclusive, end exclusive). Pure. */
export function captionsMutedAt(ranges: ReadonlyArray<{startSec: number; endSec: number}> | null | undefined, timeSec: number): boolean {
  return (ranges ?? []).some(range => timeSec >= range.startSec && timeSec < range.endSec);
}
