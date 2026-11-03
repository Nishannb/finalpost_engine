/**
 * Placement → pixel region. The blueprint never carries pixels for a graphic;
 * Remotion owns the split ratio, box rounding and canvas size, and the graphic
 * is simply told the width/height of the region it was given.
 */

import type {GeneratedGraphic, GeneratedGraphicPlacement} from '../blueprintSchema';

/** Share of the frame height the TOP region of a split occupies. */
export const GENERATED_SPLIT_RATIO = 0.5;

export type PixelRegion = {x: number; y: number; width: number; height: number};

export function regionFor(
  placement: GeneratedGraphicPlacement,
  canvasWidth: number,
  canvasHeight: number,
): PixelRegion {
  switch (placement.mode) {
    case 'full_screen':
      return {x: 0, y: 0, width: canvasWidth, height: canvasHeight};
    case 'split_screen': {
      const topHeight = Math.round(canvasHeight * GENERATED_SPLIT_RATIO);
      return placement.graphicSide === 'top'
        ? {x: 0, y: 0, width: canvasWidth, height: topHeight}
        : {x: 0, y: topHeight, width: canvasWidth, height: canvasHeight - topHeight};
    }
    case 'overlay':
    case 'pip': {
      const box = placement.box ?? {x: 0, y: 0, w: 1, h: 1};
      const x = Math.round(box.x * canvasWidth);
      const y = Math.round(box.y * canvasHeight);
      return {
        x,
        y,
        width: Math.max(1, Math.min(canvasWidth - x, Math.round(box.w * canvasWidth))),
        height: Math.max(1, Math.min(canvasHeight - y, Math.round(box.h * canvasHeight))),
      };
    }
  }
}

/** The split graphic active at `timeSec`, if any (split changes the base layout, so ShortVideo needs it). */
export function activeGeneratedSplitAt(
  graphics: GeneratedGraphic[],
  timeSec: number,
): GeneratedGraphic | undefined {
  return graphics.find(
    graphic =>
      graphic.placement.mode === 'split_screen' &&
      timeSec >= graphic.start &&
      timeSec < graphic.end,
  );
}

/** Vertical span (frame px) the captions occupy, or null when there are none. */
export type CaptionBand = {top: number; bottom: number};

/**
 * Conservative caption band from the caption direction ShortVideo already
 * resolves (position + bottomFrac). Two lines of large caption text ≈ 13% of
 * the frame height.
 */
export function captionBandFor(
  position: 'bottom' | 'lower_third' | 'center' | 'top' | undefined,
  bottomFrac: number,
  canvasHeight: number,
): CaptionBand {
  const band = canvasHeight * 0.13;
  if (position === 'top') {
    return {top: canvasHeight * 0.12, bottom: canvasHeight * 0.12 + band};
  }
  if (position === 'center') {
    return {top: (canvasHeight - band) / 2, bottom: (canvasHeight + band) / 2};
  }
  const bottom = canvasHeight * (1 - bottomFrac);
  return {top: bottom - band, bottom};
}

/** The caption-layout fields ShortVideo resolves (a subset of CaptionLayoutState). */
type CaptionPlacement = {
  position: 'bottom' | 'lower_third' | 'center' | 'top';
  bottomFrac: number;
  frameTopFrac: number;
  frameHeightFrac: number;
};

/** Caption offset above the seam when docked into the speaker half (the renderers' minimum). */
const DOCKED_CAPTION_BOTTOM_FRAC = 0.08;

/**
 * Captions while a generated graphic holds half of a split. They always move
 * into the speaker's half, at its bottom edge:
 * - graphic BOTTOM: bottom / lower-third / centre captions would land in (or
 *   straddle) the graphic's panel and squeeze its safe area, so they dock into
 *   the top (speaker) half just above the seam, the same frame mechanism the
 *   inset reveal uses;
 * - graphic TOP: the speaker's face fills the bottom half, where default
 *   captions (~20% up) would sit on it, so they drop to the frame's bottom edge
 *   (centre captions, which would sit on the seam, too).
 * Top captions are left alone (they sit over the speaker for bottom graphics
 * and the graphic's safe area handles them for top graphics), as is every
 * non-generated layout.
 */
export function captionsForGeneratedSplit<T extends CaptionPlacement>(
  layout: T,
  split: GeneratedGraphic | undefined,
  canvasHeight: number,
): {layout: T; band: CaptionBand} {
  const side = split?.placement.mode === 'split_screen' ? split.placement.graphicSide : undefined;
  if (!side || layout.position === 'top') {
    return {layout, band: captionBandFor(layout.position, layout.bottomFrac, canvasHeight)};
  }
  if (side === 'top') {
    const docked = {...layout, position: 'bottom' as const, bottomFrac: DOCKED_CAPTION_BOTTOM_FRAC};
    return {layout: docked, band: captionBandFor('bottom', DOCKED_CAPTION_BOTTOM_FRAC, canvasHeight)};
  }
  const frameHeightFrac = GENERATED_SPLIT_RATIO;
  const seam = Math.round(canvasHeight * frameHeightFrac);
  return {
    layout: {...layout, position: 'bottom', bottomFrac: DOCKED_CAPTION_BOTTOM_FRAC, frameTopFrac: 0, frameHeightFrac},
    // Conservative: package themes offset by a share of the docked frame, kinetic ones by a share of the canvas.
    band: {
      top: seam - canvasHeight * (DOCKED_CAPTION_BOTTOM_FRAC + 0.13),
      bottom: seam - canvasHeight * frameHeightFrac * DOCKED_CAPTION_BOTTOM_FRAC,
    },
  };
}

export type RegionSafeArea = {top: number; right: number; bottom: number; left: number};

/**
 * Insets (px, relative to the region) a graphic should keep important content
 * out of: a small margin, platform UI where the region touches the top/bottom
 * of the frame, and the caption band where it crosses the region.
 */
export function safeAreaFor(
  region: PixelRegion,
  canvasHeight: number,
  captionBand: CaptionBand | null,
): RegionSafeArea {
  const base = Math.round(Math.min(region.width, region.height) * 0.04);
  const side = Math.max(base, Math.round(region.width * 0.05));
  let top = base;
  let bottom = base;
  if (region.y <= 0) {
    top = Math.max(top, Math.round(canvasHeight * 0.06));
  }
  const regionBottom = region.y + region.height;
  if (regionBottom >= canvasHeight) {
    bottom = Math.max(bottom, Math.round(canvasHeight * 0.08));
  }
  if (captionBand) {
    const overlaps = captionBand.bottom > region.y && captionBand.top < regionBottom;
    if (overlaps) {
      const roomAbove = captionBand.top - region.y;
      const roomBelow = regionBottom - captionBand.bottom;
      if (roomAbove >= roomBelow) {
        bottom = Math.max(bottom, Math.round(regionBottom - captionBand.top));
      } else {
        top = Math.max(top, Math.round(captionBand.bottom - region.y));
      }
    }
  }
  // Never leave less than 30% of the region for content.
  const maxVertical = region.height * 0.7;
  if (top + bottom > maxVertical) {
    const scale = maxVertical / (top + bottom);
    top = Math.round(top * scale);
    bottom = Math.round(bottom * scale);
  }
  return {top, right: side, bottom, left: side};
}
