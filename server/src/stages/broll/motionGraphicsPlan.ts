/**
 * Parse + fallback helpers for motion-graphics director fields.
 * Mechanisms over templates — appearance is always a parameter.
 */

import type {
  EmphasisTreatment,
  EmphasisWeight,
  MediaContainerMode,
  MediaContainerMoment,
  MotionAnchor,
  MotionEntrance,
  MotionExit,
  MotionGraphic,
  MotionRole,
  MotionShape,
  SemanticEmphasis,
} from '../../types/blueprint.ts';
import {
  EMPHASIS_TREATMENTS,
  EMPHASIS_WEIGHTS,
  MEDIA_CONTAINER_MODES,
  MOTION_ANCHORS,
  MOTION_ENTRANCES,
  MOTION_EXITS,
  MOTION_ROLES,
  MOTION_SHAPES,
} from '../../types/blueprint.ts';
import {keyPhrasesFromTranscript} from './visualQuery.ts';

export type DirectedMotionPlan = {
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  semanticEmphasis: SemanticEmphasis[];
};

export function parseMotionPlanFromDirector(
  record: Record<string, unknown>,
  durationSec: number,
  transcript: string,
): DirectedMotionPlan {
  const motionGraphics = parseMotionGraphics(
    record.motion_graphics ?? record.motionGraphics,
    durationSec,
  );
  const mediaContainers = parseMediaContainers(
    record.media_containers ?? record.mediaContainers,
    durationSec,
  );
  const semanticEmphasis = parseSemanticEmphasis(
    record.semantic_emphasis ?? record.semanticEmphasis,
    durationSec,
  );

  return ensureMotionCoverage({
    motionGraphics,
    mediaContainers,
    semanticEmphasis,
    durationSec,
    transcript,
  });
}

export function fallbackMotionPlan(input: {
  transcript: string;
  durationSec: number;
  hookTitle: string;
}): DirectedMotionPlan {
  const span = Math.max(8, input.durationSec);
  const phrases = keyPhrasesFromTranscript(input.transcript, 3);
  const primary = (phrases[0] || input.hookTitle || 'WATCH THIS')
    .slice(0, 28)
    .toUpperCase();
  const numberHit = input.transcript.match(
    /\b(\d+%|\$[\d,.]+[kKmMbB]?|£[\d,.]+[kKmMbB]?|\d+\s*(weeks?|days?|hours?))\b/,
  );

  const motionGraphics: MotionGraphic[] = [
    {
      start: Math.min(4.2, span * 0.22),
      end: Math.min(6.4, span * 0.35),
      text: primary,
      role: 'primary',
      shape: 'underline',
      accentColor: '#FACC15',
      textColor: '#FFFFFF',
      anchor: 'center',
      entrance: 'spring_up',
      exit: 'fade',
      fontScale: 1.15,
      italic: true,
    },
  ];

  const mediaContainers: MediaContainerMoment[] = [
    {
      start: Math.min(7.5, span * 0.42),
      end: Math.min(11.5, span * 0.62),
      mode: 'inset',
      canvasColor: '#F8FAFC',
      cornerRadius: 40,
      scale: 0.76,
      transitionSec: 0.55,
      canvasTitle: (phrases[1] || phrases[0] || '').slice(0, 32),
      canvasTitleColor: '#0F172A',
    },
  ];

  const semanticEmphasis: SemanticEmphasis[] = [];
  if (numberHit?.[1]) {
    const at = Math.min(span * 0.55, span - 2.5);
    semanticEmphasis.push({
      start: at,
      end: at + 1.8,
      text: numberHit[1],
      weight: 'primary',
      treatment: 'scale',
      accentColor: '#FACC15',
    });
  } else if (phrases[2]) {
    const at = Math.min(span * 0.58, span - 2.2);
    semanticEmphasis.push({
      start: at,
      end: at + 1.6,
      text: phrases[2].slice(0, 24),
      weight: 'secondary',
      treatment: 'underline',
      accentColor: '#4ADE80',
    });
  }

  return {motionGraphics, mediaContainers, semanticEmphasis};
}

function ensureMotionCoverage(input: {
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  semanticEmphasis: SemanticEmphasis[];
  durationSec: number;
  transcript: string;
}): DirectedMotionPlan {
  const fallback = fallbackMotionPlan({
    transcript: input.transcript,
    durationSec: input.durationSec,
    hookTitle: '',
  });
  return {
    motionGraphics:
      input.motionGraphics.length > 0
        ? input.motionGraphics
        : fallback.motionGraphics,
    mediaContainers:
      input.mediaContainers.length > 0
        ? input.mediaContainers
        : input.durationSec > 14
          ? fallback.mediaContainers
          : [],
    semanticEmphasis:
      input.semanticEmphasis.length > 0
        ? input.semanticEmphasis
        : fallback.semanticEmphasis,
  };
}

function parseMotionGraphics(
  raw: unknown,
  durationSec: number,
): MotionGraphic[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MotionGraphic[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const start = Number(item.start ?? item.timestamp);
    const end = Number(item.end ?? start + 2.2);
    const text = String(item.text ?? item.overlay_text ?? '')
      .trim()
      .slice(0, 48);
    if (!text || !Number.isFinite(start) || start < 0 || start > durationSec) {
      continue;
    }
    const safeEnd = Math.min(
      durationSec,
      Math.max(start + 0.8, Number.isFinite(end) ? end : start + 2.2),
    );
    out.push({
      start,
      end: safeEnd,
      text,
      role: coerceEnum(item.role, MOTION_ROLES, 'primary'),
      shape: coerceEnum(item.shape, MOTION_SHAPES, 'underline'),
      accentColor: sanitizeHex(String(item.accent_color ?? item.accentColor ?? ''), '#FACC15'),
      textColor: sanitizeHex(String(item.text_color ?? item.textColor ?? ''), '#FFFFFF'),
      anchor: coerceEnum(item.anchor, MOTION_ANCHORS, 'center'),
      entrance: coerceEnum(item.entrance, MOTION_ENTRANCES, 'spring_up'),
      exit: coerceEnum(item.exit, MOTION_EXITS, 'fade'),
      fontScale: clamp(Number(item.font_scale ?? item.fontScale ?? 1), 0.7, 1.8),
      italic: Boolean(item.italic ?? true),
    });
  }
  return out.slice(0, 6);
}

function parseMediaContainers(
  raw: unknown,
  durationSec: number,
): MediaContainerMoment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MediaContainerMoment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const start = Number(item.start ?? item.timestamp);
    const end = Number(item.end ?? start + 3.5);
    if (!Number.isFinite(start) || start < 3 || start > durationSec) {
      continue;
    }
    const safeEnd = Math.min(
      durationSec,
      Math.max(start + 1.5, Number.isFinite(end) ? end : start + 3.5),
    );
    out.push({
      start,
      end: safeEnd,
      mode: coerceEnum(item.mode, MEDIA_CONTAINER_MODES, 'inset'),
      canvasColor: sanitizeHex(
        String(item.canvas_color ?? item.canvasColor ?? ''),
        '#F8FAFC',
      ),
      cornerRadius: clamp(Number(item.corner_radius ?? item.cornerRadius ?? 36), 12, 64),
      scale: clamp(Number(item.scale ?? 0.78), 0.55, 0.92),
      transitionSec: clamp(
        Number(item.transition_sec ?? item.transitionSec ?? 0.55),
        0.25,
        1.2,
      ),
      canvasTitle: String(item.canvas_title ?? item.canvasTitle ?? '')
        .trim()
        .slice(0, 40),
      canvasTitleColor: sanitizeHex(
        String(item.canvas_title_color ?? item.canvasTitleColor ?? ''),
        '#0F172A',
      ),
    });
  }
  return out.slice(0, 3);
}

function parseSemanticEmphasis(
  raw: unknown,
  durationSec: number,
): SemanticEmphasis[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SemanticEmphasis[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const start = Number(item.start ?? item.timestamp);
    const end = Number(item.end ?? start + 1.6);
    const text = String(item.text ?? '')
      .trim()
      .slice(0, 32);
    if (!text || !Number.isFinite(start) || start < 0 || start > durationSec) {
      continue;
    }
    out.push({
      start,
      end: Math.min(
        durationSec,
        Math.max(start + 0.6, Number.isFinite(end) ? end : start + 1.6),
      ),
      text,
      weight: coerceEnum(item.weight, EMPHASIS_WEIGHTS, 'primary'),
      treatment: coerceEnum(item.treatment, EMPHASIS_TREATMENTS, 'scale'),
      accentColor: sanitizeHex(
        String(item.accent_color ?? item.accentColor ?? ''),
        '#FACC15',
      ),
    });
  }
  return out.slice(0, 5);
}

function coerceEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase() as T;
  return (allowed as readonly string[]).includes(value) ? value : fallback;
}

function sanitizeHex(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const expanded = trimmed
      .slice(1)
      .split('')
      .map(ch => ch + ch)
      .join('');
    return `#${expanded}`.toUpperCase();
  }
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}
