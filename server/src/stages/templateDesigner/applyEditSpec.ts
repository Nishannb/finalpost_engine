/**
 * Map a validated EditSpec onto captionStyleGuide + render style.
 * Director is not involved — this is renderer input only.
 */

import {captionGuideToDirection, defaultCaptionStyleGuide} from '../../types/captionStyleGuide.ts';
import type {CaptionStyleGuide} from '../../types/captionStyleGuide.ts';
import type {CaptionDirection} from '../../types/blueprint.ts';
import type {EditSpec} from '../../types/editSpec.ts';

export function editSpecToCaptionStyleGuide(spec: EditSpec): CaptionStyleGuide {
  const y = spec.caption.position.y;
  const bottomFrac = clamp(1 - y, 0.04, 0.28);
  const position =
    bottomFrac <= 0.1 ? 'bottom' : bottomFrac >= 0.22 ? 'center' : 'lower_third';
  return defaultCaptionStyleGuide({
    template: spec.caption.template,
    position,
    textColor: spec.caption.textColor,
    highlightColor: spec.caption.highlightColor,
    box: spec.caption.box,
    boxColor: spec.caption.boxColor,
    fontScale: clamp(spec.caption.size / 0.09, 0.7, 1.4),
    animation: spec.caption.animation,
    wordReveal: spec.caption.grouping,
    bottomFrac,
    uppercase: spec.caption.case === 'uppercase',
    italic: false,
    notes: spec.overallStyle,
  });
}

export function editSpecToCaptionDirection(spec: EditSpec): CaptionDirection {
  return captionGuideToDirection(editSpecToCaptionStyleGuide(spec));
}

export function editSpecRenderHints(spec: EditSpec): {
  captionTemplate: EditSpec['caption']['template'];
  captionBottomFrac: number;
  captionCenterXFrac: number;
  zoomEnabled: boolean;
} {
  const guide = editSpecToCaptionStyleGuide(spec);
  return {
    captionTemplate: spec.caption.template,
    captionBottomFrac: guide.bottomFrac,
    captionCenterXFrac: clamp(spec.caption.position.x, 0.1, 0.9),
    zoomEnabled: spec.camera.emphasisZoom.enabled,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
