/**
 * Deterministic compositor: AI chooses copy + timing; this module chooses
 * WHERE and HOW it animates. Illegal layouts (full-width bars on the speaker,
 * empty pip canvases, tiles on the caption band) are rewritten, never drawn.
 */

import {carryProvenance} from '../../lib/provenance.ts';
import type {
  CaptionDirection,
  HookStyle,
  MediaContainerMoment,
  MotionAnchor,
  MotionGraphic,
  SemanticEmphasis,
  VisualAnchor,
  VisualOverlay,
} from '../../types/blueprint.ts';
import {
  CAPTION_BAND,
  legalGraphicAnchor,
  legalHookAnchor,
  legalSlots,
  overlapArea,
  rectsOverlap,
  type Occupancy,
} from './occupancy.ts';
import {boxCountsAsFace, composerGraphicAnchorIsUnsafe, directorAnchorOrNeutral, pipSlotBlockedByBox, pipSlotClearOfBox, topCaptionAllowed, UNMEASURED_NEUTRAL_ANCHOR} from './unmeasuredSlots.ts';

export function composeBeautifulLayout(input: {
  occupancy: Occupancy;
  hookStyle: HookStyle;
  caption: CaptionDirection;
  motionGraphics: MotionGraphic[];
  overlays: VisualOverlay[];
  mediaContainers?: MediaContainerMoment[];
  semanticEmphasis?: SemanticEmphasis[];
}): {
  hookStyle: HookStyle;
  hookAnchor: VisualAnchor;
  caption: CaptionDirection;
  motionGraphics: MotionGraphic[];
  overlays: VisualOverlay[];
  mediaContainers: MediaContainerMoment[];
  semanticEmphasis: SemanticEmphasis[];
} {
  // WP3J: with no measured face the default box is not compared with any slot: the occupancy's own anchors are used as they are.
  const boxIsFace = boxCountsAsFace(input.occupancy);
  // WP3K: the occupancy's graphicAnchor / overlayAnchor / preferredSide come from the symmetric default box (always top_right / right), so they are not used for an unmeasured face.
  const graphicAnchor: MotionAnchor = boxIsFace ? legalGraphicAnchor(input.occupancy) : UNMEASURED_NEUTRAL_ANCHOR;
  const overlayAnchor: VisualAnchor = boxIsFace ? toVisualAnchor(graphicAnchor) : UNMEASURED_NEUTRAL_ANCHOR;
  const hookStyle = input.hookStyle;
  const mediaContainers = remapMediaContainers(
    input.mediaContainers ?? [],
    input.occupancy,
    input.overlays,
    input.motionGraphics,
  );

  return {
    hookStyle,
    hookAnchor: boxIsFace ? legalHookAnchor(input.occupancy) : UNMEASURED_NEUTRAL_ANCHOR,
    caption: lockedCaption(input.caption, input.occupancy),
    motionGraphics: remapMotionGraphics(input.motionGraphics, graphicAnchor, boxIsFace),
    overlays: remapOverlays(input.overlays, overlayAnchor, mediaContainers, boxIsFace),
    mediaContainers,
    semanticEmphasis: remapEmphasis(
      input.semanticEmphasis ?? [],
      overlayAnchor,
      boxIsFace,
    ),
  };
}

export function lockedCaption(
  caption: CaptionDirection,
  occupancy?: Occupancy,
): CaptionDirection {
  const topSafe =
    caption.position === 'top' &&
    (occupancy == null || topCaptionAllowed({boxIsFace: boxCountsAsFace(occupancy), speakerY: occupancy.speaker.y}));
  const position =
    caption.position === 'top'
      ? topSafe
        ? 'top'
        : 'bottom'
      : caption.position === 'center'
        ? 'center'
        : caption.position === 'lower_third'
          ? 'lower_third'
          : 'bottom';
  const bottomFrac =
    position === 'top'
      ? Math.min(0.22, Math.max(0.08, caption.bottomFrac || 0.12))
      : position === 'center'
        ? Math.min(0.52, Math.max(0.38, caption.bottomFrac || 0.45))
        : position === 'lower_third'
          ? Math.min(0.32, Math.max(0.2, caption.bottomFrac || 0.26))
          : Math.min(0.22, Math.max(0.08, caption.bottomFrac || 0.16));
  return {
    ...caption,
    position,
    bottomFrac,
    template: caption.template,
    animation: caption.animation,
    boxColor: caption.boxColor,
    textColor: caption.textColor || '#FFFFFF',
    highlightColor: caption.highlightColor || '#FFE14A',
    fontScale: caption.fontScale,
  };
}

function remapMotionGraphics(
  graphics: MotionGraphic[],
  anchor: MotionAnchor,
  boxIsFace = true,
): MotionGraphic[] {
  const remapped = graphics.map((graphic, index) => {
    const duration = Math.max(0.9, graphic.end - graphic.start);
    const start = graphic.start;
    const end = start + duration;
    const entrance =
      graphic.entrance === 'fade_blur' ? 'scale_pop' : graphic.entrance;
    const unsafe = composerGraphicAnchorIsUnsafe({boxIsFace, anchor: graphic.anchor});
    return carryProvenance(graphic, {
      ...graphic,
      start,
      end,
      anchor: unsafe ? (index % 2 === 0 ? anchor : opposite(anchor)) : graphic.anchor,
      entrance,
      exit: graphic.exit || 'spring_out',
      shape: graphic.shape === 'none' ? 'underline' : graphic.shape,
      fontScale: Math.min(graphic.role === 'primary' ? 0.82 : 0.72, graphic.fontScale || 1),
    });
  });
  return staggerPrimary(remapped);
}

function remapOverlays(
  overlays: VisualOverlay[],
  anchor: VisualAnchor,
  containers: MediaContainerMoment[],
  boxIsFace = true,
): VisualOverlay[] {
  const pipWindows = containers.filter(container => container.mode === 'pip_corner');
  return overlays.map(overlay => {
    const hero =
      overlay.visualWeight === 'hero' ||
      pipWindows.some(container => rangesOverlap(container, overlay));
    if (
      overlay.layout === 'cutaway' ||
      overlay.layout === 'split' ||
      overlay.layout === 'composite' ||
      overlay.layout === 'cutout' ||
      overlay.layout === 'bubble'
    ) {
      return overlay;
    }
    if (overlay.layout === 'card' || overlay.layout === 'pip' || overlay.layout === 'sticker') {
      const unsafe = boxIsFace && (overlay.anchor === 'top' || overlay.anchor === 'bottom'); // WP3K: an unmeasured face keeps the Director's anchor
      return {
        ...overlay,
        layout: 'card',
        treatment: overlay.treatment || 'card',
        glow: overlay.glow !== false,
        cornerRadius: overlay.cornerRadius || 28,
        anchor: unsafe ? (hero ? oppositeVisual(anchor) : anchor) : overlay.anchor,
        visualWeight: hero ? 'hero' : 'accent',
      };
    }
    if (overlay.layout === 'banner' || overlay.layout === 'stat') {
      return {
        ...overlay,
        layout: 'lockup',
        textStyle: 'stack',
        anchor: boxIsFace ? anchor : directorAnchorOrNeutral(overlay.anchor),
        mediaKind: overlay.mediaKind === 'video' ? 'text' : overlay.mediaKind,
        assetUrl: overlay.layout === 'banner' ? '' : overlay.assetUrl,
        visualWeight: 'accent',
      };
    }
    if (overlay.layout === 'lockup') {
      const unsafe = boxIsFace && (overlay.anchor === 'top' || overlay.anchor === 'bottom');
      return {
        ...overlay,
        textStyle: 'stack',
        anchor: unsafe ? anchor : overlay.anchor,
        visualWeight: 'accent',
      };
    }
    if (overlay.layout === 'chip') {
      return {
        ...overlay,
        anchor: boxIsFace && overlay.anchor === 'top' ? 'bottom_right' : overlay.anchor,
        visualWeight: 'accent',
      };
    }
    return overlay;
  });
}

function remapMediaContainers(
  containers: MediaContainerMoment[],
  occupancy: Occupancy,
  overlays: VisualOverlay[],
  graphics: MotionGraphic[],
): MediaContainerMoment[] {
  const pipAnchor = legalPipAnchor(occupancy);
  return containers.flatMap(container => {
    const transitionSec = clamp(
      container.transitionSec || 1,
      0.85,
      1.25,
    );
    if (container.mode !== 'pip_corner') {
      return [carryProvenance(container, {...container, transitionSec})];
    }
    if (!pipHasCanvasFill(container, overlays, graphics)) {
      return [];
    }
    if (!pipAnchor) {
      return [];
    }
    return [
      carryProvenance(container, {
        ...container,
        transitionSec,
        pipAnchor,
        scale: Math.min(0.3, Math.max(0.22, container.scale || 0.26)),
      }),
    ];
  });
}

export function pipHasCanvasFill(
  container: MediaContainerMoment,
  overlays: VisualOverlay[],
  graphics: MotionGraphic[],
): boolean {
  const overlayFill = overlays.some(
    overlay =>
      rangesOverlap(container, overlay) &&
      overlay.layout !== 'cutaway' &&
      overlay.layout !== 'split' &&
      Boolean(overlay.assetUrl || overlay.overlayText),
  );
  const graphicFill = graphics.some(graphic => rangesOverlap(container, graphic));
  return overlayFill || graphicFill;
}

function legalPipAnchor(occupancy: Occupancy): VisualAnchor | null {
  const pip = legalSlots(occupancy).filter(slot => slot.kind === 'pip');
  if (pip.length === 0) {
    return null;
  }
  // WP3K: preferredSide comes from the default box for an unmeasured face (always `right`), so no side is preferred then: the first usable slot in the list order is taken.
  const preferred = boxCountsAsFace(occupancy) ? (occupancy.preferredSide === 'right' ? 'bottom_left' : 'bottom_right') : null;
  const match = (preferred ? pip.find(slot => slot.anchor === preferred) : undefined) || pip[0];
  if (!match) {
    return null;
  }
  const boxIsFace = boxCountsAsFace(occupancy); // WP3J: false only for an mvp occupancy marked unmeasured
  if (rectsOverlap(match.rect, CAPTION_BAND) || pipSlotBlockedByBox({boxIsFace, overlapWithBox: overlapArea(match.rect, occupancy.speaker)})) {
    const safer = pip.find(
      slot =>
        !rectsOverlap(slot.rect, CAPTION_BAND) &&
        pipSlotClearOfBox({boxIsFace, overlapWithBox: overlapArea(slot.rect, occupancy.speaker)}),
    );
    return safer?.anchor ?? null;
  }
  return match.anchor;
}

function remapEmphasis(
  items: SemanticEmphasis[],
  anchor: VisualAnchor,
  boxIsFace = true,
): SemanticEmphasis[] {
  return items.map((item, index) => {
    // WP3K: an unmeasured face keeps every anchor the Director gave; only a missing anchor gets the neutral one (no alternating sides).
    const unsafe = boxIsFace ? !item.anchor || item.anchor === 'top' || item.anchor === 'bottom' : !item.anchor;
    const treatment =
      item.treatment === 'highlight_shape' ? 'type_reveal' : item.treatment;
    return carryProvenance(item, {
      ...item,
      treatment,
      anchor: unsafe ? (boxIsFace ? (index % 2 === 0 ? anchor : oppositeVisual(anchor)) : anchor) : item.anchor,
    });
  });
}

function rangesOverlap(
  a: {start: number; end: number},
  b: {start: number; end: number},
): boolean {
  return a.start < b.end && b.start < a.end;
}

function staggerPrimary(graphics: MotionGraphic[]): MotionGraphic[] {
  const sorted = [...graphics].sort((a, b) => a.start - b.start);
  let lastPrimaryEnd = 0;
  return sorted.map(graphic => {
    if (graphic.role !== 'primary') {
      return graphic;
    }
    let start = graphic.start;
    if (start < lastPrimaryEnd + 1.2) {
      start = lastPrimaryEnd + 1.2;
    }
    const duration = Math.max(0.9, graphic.end - graphic.start);
    lastPrimaryEnd = start + duration;
    return carryProvenance(graphic, {...graphic, start, end: start + duration});
  });
}

function opposite(anchor: MotionAnchor): MotionAnchor {
  if (anchor === 'top_left') {
    return 'top_right';
  }
  if (anchor === 'top_right') {
    return 'top_left';
  }
  if (anchor === 'bottom_left') {
    return 'bottom_right';
  }
  return 'bottom_left';
}

function oppositeVisual(anchor: VisualAnchor): VisualAnchor {
  if (anchor === 'top_left') {
    return 'top_right';
  }
  if (anchor === 'top_right') {
    return 'top_left';
  }
  if (anchor === 'bottom_left') {
    return 'bottom_right';
  }
  if (anchor === 'bottom_right') {
    return 'bottom_left';
  }
  return anchor === 'top' ? 'top_right' : 'bottom_right';
}

function toVisualAnchor(anchor: MotionAnchor): VisualAnchor {
  if (anchor === 'center' || anchor === 'top') {
    return 'top_right';
  }
  if (anchor === 'bottom') {
    return 'bottom_right';
  }
  return anchor;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}
