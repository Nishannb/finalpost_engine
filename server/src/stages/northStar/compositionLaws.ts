import type {
  MotionAnchor,
  MotionGraphic,
  SemanticEmphasis,
  VisualAnchor,
  VisualOverlay,
} from '../../types/blueprint.ts';
import type {OccupancySlice} from '../directorV2/types.ts';
import {
  CAPTION_BAND,
  hookRectForAnchor,
  legalSlots,
  overlapArea,
  rectsOverlap,
  slotRectForAnchor,
  type NormRect,
  type Occupancy,
} from '../layout/occupancy.ts';

export type CompositionLawResult = {
  hookTitle: string;
  hookAnchor: VisualAnchor;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
  drops: string[];
  coercions: string[];
  suggestions: string[];
};

/**
 * Occupancy suggestions only. Never applied: moving after Validate is forbidden.
 */
export function enforceCompositionLaws(input: {
  hookTitle: string;
  hookAnchor: VisualAnchor;
  hookDurationSec: number;
  occupancySlices: OccupancySlice[];
  fallbackOccupancy: Occupancy;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
}): CompositionLawResult {
  const proposed = proposeCompositionLaws(input);
  return {
    hookTitle: input.hookTitle,
    hookAnchor: input.hookAnchor,
    overlays: input.overlays,
    motionGraphics: input.motionGraphics,
    semanticEmphasis: input.semanticEmphasis,
    drops: [],
    coercions: [],
    suggestions: [...proposed.drops, ...proposed.coercions],
  };
}

/**
 * Occupancy suggestions only. Never applied: moving after Validate is forbidden.
 */
function proposeCompositionLaws(input: {
  hookTitle: string;
  hookAnchor: VisualAnchor;
  hookDurationSec: number;
  occupancySlices: OccupancySlice[];
  fallbackOccupancy: Occupancy;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
}): CompositionLawResult {
  const drops: string[] = [];
  const coercions: string[] = [];
  const slices =
    input.occupancySlices.length > 0
      ? input.occupancySlices
      : [{atSec: 0, occupancy: input.fallbackOccupancy}];
  const guessed = occupancyIsGuessed(slices);

  const hook = safeHook(
    input.hookTitle,
    input.hookAnchor,
    input.hookDurationSec,
    slices,
    guessed,
  );
  if (!hook.title && input.hookTitle) {
    drops.push('hook:face_or_overflow');
  } else if (hook.anchor !== input.hookAnchor) {
    coercions.push(`hook:${input.hookAnchor}->${hook.anchor}`);
  }

  const overlays: VisualOverlay[] = [];
  for (const overlay of [...input.overlays].sort((a, b) => a.start - b.start)) {
    if (isFullFrameLayout(overlay.layout)) {
      overlays.push(overlay);
      continue;
    }
    if (!readableCopy(overlay.overlayText, overlay.end - overlay.start)) {
      drops.push(`overlay:${overlay.layout}:unreadable_hold`);
      continue;
    }
    const safe = safeVisualAnchor(
      overlay.anchor,
      overlay.start,
      overlay.end,
      slices,
      overlay.layout === 'card' ? 'card' : 'graphic',
      guessed,
    );
    if (!safe) {
      drops.push(`overlay:${overlay.layout}:face`);
      continue;
    }
    overlays.push(safe === overlay.anchor ? overlay : {...overlay, anchor: safe});
    if (safe !== overlay.anchor) {
      coercions.push(`overlay:${overlay.anchor}->${safe}`);
    }
  }

  const motionGraphics: MotionGraphic[] = [];
  for (const graphic of [...input.motionGraphics].sort((a, b) => a.start - b.start)) {
    const text = clipCopy(graphic.text, 6);
    if (!readableCopy(text, graphic.end - graphic.start)) {
      drops.push(`motion:${graphic.text.slice(0, 24)}:unreadable_hold`);
      continue;
    }
    const safe = safeMotionAnchor(
      graphic.anchor,
      graphic.start,
      graphic.end,
      slices,
      guessed,
    );
    if (!safe) {
      drops.push(`motion:${graphic.text.slice(0, 24)}:face`);
      continue;
    }
    motionGraphics.push({
      ...graphic,
      text,
      anchor: safe,
    });
    if (safe !== graphic.anchor) {
      coercions.push(`motion:${graphic.anchor}->${safe}`);
    }
  }

  const semanticEmphasis: SemanticEmphasis[] = [];
  for (const item of [...input.semanticEmphasis].sort((a, b) => a.start - b.start)) {
    const safe = safeVisualAnchor(
      item.anchor || 'top_right',
      item.start,
      item.end,
      slices,
      'emphasis',
      guessed,
    );
    if (!safe) {
      drops.push(`emphasis:${item.text.slice(0, 24)}:face`);
      continue;
    }
    semanticEmphasis.push({...item, anchor: safe});
  }

  return {
    hookTitle: hook.title,
    hookAnchor: hook.anchor,
    overlays,
    motionGraphics,
    semanticEmphasis,
    drops,
    coercions,
    suggestions: [...drops, ...coercions],
  };
}

function safeHook(
  title: string,
  preferred: VisualAnchor,
  end: number,
  slices: OccupancySlice[],
  guessed: boolean,
): {title: string; anchor: VisualAnchor} {
  const clipped = clipCopy(title, 7);
  const words = clipped.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return {title: '', anchor: preferred};
  }
  const occupancy = activeSlices(0, end, slices)[0]?.occupancy;
  if (!occupancy) {
    return {title: clipped, anchor: preferred};
  }
  const anchor = guessed
    ? leastOverlapAnchor(preferred, occupancy, 'hook')
    : firstSafeHookAnchor(preferred, end, slices) ?? leastOverlapAnchor(preferred, occupancy, 'hook');
  return {title: clipped, anchor};
}

function firstSafeHookAnchor(
  preferred: VisualAnchor,
  end: number,
  slices: OccupancySlice[],
): VisualAnchor | null {
  for (const anchor of orderedAnchors(preferred)) {
    const rect = hookRectForAnchor(anchor);
    const safe = activeSlices(0, end, slices).every(
      slice => overlapArea(rect, inflate(slice.occupancy.speaker, 0.03)) < 0.05,
    );
    if (safe && !rectsOverlap(rect, CAPTION_BAND, 0.01)) {
      return anchor;
    }
  }
  return null;
}

function safeMotionAnchor(
  preferred: MotionAnchor,
  start: number,
  end: number,
  slices: OccupancySlice[],
  guessed: boolean,
): MotionAnchor | null {
  const occupancy = activeSlices(start, end, slices)[0]?.occupancy;
  if (guessed && occupancy) {
    return leastOverlapAnchor(preferred === 'center' ? 'top_right' : preferred, occupancy, 'graphic');
  }
  const candidates: MotionAnchor[] = [
    preferred,
    ...orderedAnchors(preferred === 'center' ? 'top_right' : preferred),
  ];
  for (const anchor of [...new Set(candidates)]) {
    if (anchor === 'center') {
      continue;
    }
    const rect = slotRectForAnchor(anchor);
    if (safeAcross(rect, start, end, slices)) {
      return anchor;
    }
  }
  return occupancy
    ? leastOverlapAnchor(preferred === 'center' ? 'top_right' : preferred, occupancy, 'graphic')
    : 'top_right';
}

function safeVisualAnchor(
  preferred: VisualAnchor,
  start: number,
  end: number,
  slices: OccupancySlice[],
  kind: 'graphic' | 'card' | 'emphasis',
  guessed: boolean,
): VisualAnchor | null {
  const occupancy = activeSlices(start, end, slices)[0]?.occupancy;
  if (guessed && occupancy) {
    return leastOverlapAnchor(preferred, occupancy, 'graphic');
  }
  const candidates = orderedAnchors(preferred);
  for (const anchor of candidates) {
    const rect = slotRectForAnchor(anchor);
    const allowed = activeSlices(start, end, slices).every(slice => {
      const legal = legalSlots(slice.occupancy).some(
        slot =>
          slot.anchor === anchor &&
          (kind !== 'card' || slot.kind === 'card' || slot.kind === 'pip' || slot.kind === 'graphic'),
      );
      return (legal || legalSlots(slice.occupancy).length === 0) && safeAcrossOne(rect, slice.occupancy);
    });
    if (allowed) {
      return anchor;
    }
  }
  return occupancy ? leastOverlapAnchor(preferred, occupancy, 'graphic') : 'top_right';
}

function leastOverlapAnchor(
  preferred: VisualAnchor,
  occupancy: Occupancy,
  kind: 'hook' | 'graphic',
): VisualAnchor {
  let best: VisualAnchor = preferred;
  let bestOverlap = Number.POSITIVE_INFINITY;
  for (const anchor of orderedAnchors(best)) {
    const rect = kind === 'hook' ? hookRectForAnchor(anchor) : slotRectForAnchor(anchor);
    if (rectsOverlap(rect, CAPTION_BAND, 0.01) && kind !== 'hook') {
      continue;
    }
    const overlap = overlapArea(rect, occupancy.speaker);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = anchor;
    }
  }
  return best;
}

function occupancyIsGuessed(slices: OccupancySlice[]): boolean {
  return slices.length === 0 || slices.every(slice => slice.occupancy.source === 'fallback');
}

function safeAcross(
  rect: NormRect,
  start: number,
  end: number,
  slices: OccupancySlice[],
): boolean {
  return activeSlices(start, end, slices).every(slice =>
    safeAcrossOne(rect, slice.occupancy),
  );
}

function safeAcrossOne(rect: NormRect, occupancy: Occupancy): boolean {
  return (
    overlapArea(rect, inflate(occupancy.speaker, 0.02)) < 0.05 &&
    !rectsOverlap(rect, CAPTION_BAND, 0.005)
  );
}

function activeSlices(
  start: number,
  end: number,
  slices: OccupancySlice[],
): OccupancySlice[] {
  const active = slices.filter(slice => slice.atSec >= start && slice.atSec <= end);
  if (active.length > 0) {
    return active;
  }
  return [
    slices.reduce((best, slice) =>
      Math.abs(slice.atSec - start) < Math.abs(best.atSec - start) ? slice : best,
    ),
  ];
}

function orderedAnchors(preferred: VisualAnchor): VisualAnchor[] {
  const all: VisualAnchor[] = [
    preferred,
    'top_left',
    'top_right',
    'bottom_left',
    'bottom_right',
    'top',
    'bottom',
  ];
  return [...new Set(all)];
}

function clipCopy(text: string, maxWords: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function readableCopy(text: string, seconds: number): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words === 0 || seconds >= 0.45 + words * 0.22;
}

function isFullFrameLayout(layout: VisualOverlay['layout']): boolean {
  return layout === 'split' || layout === 'cutaway' || layout === 'cutout';
}

function inflate(rect: NormRect, pad: number): NormRect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  };
}
