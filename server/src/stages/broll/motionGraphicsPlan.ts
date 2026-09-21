/**
 * Parse + fallback helpers for motion-graphics director fields.
 * Mechanisms over templates — appearance is always a parameter.
 */

import type {
  FrameInset,
  MediaContainerMoment,
  MotionGraphic,
  SemanticEmphasis,
  VisualAnchor,
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
  VISUAL_ANCHORS,
} from '../../types/blueprint.ts';
import {holdFromPhrase} from './speechAlign.ts';
import {isHugeSpokenNumber, parseSpokenMagnitude} from './fastCounter.ts';
import {keyPhrasesFromTranscript} from './visualQuery.ts';

export {parseSpokenMagnitude} from './fastCounter.ts';

export type DirectedMotionPlan = {
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  frameInsets: FrameInset[];
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
  const frameInsets = parseFrameInsets(
    record.frame_insets ?? record.frameInsets,
    durationSec,
  );
  const semanticEmphasis = parseSemanticEmphasis(
    record.semantic_emphasis ?? record.semanticEmphasis,
    durationSec,
  );

  return ensureMotionCoverage({
    motionGraphics,
    mediaContainers,
    frameInsets,
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
  const numberHit = [...input.transcript.matchAll(
    /\b([$€£])?(\d[\d,.]*)(\s*(?:billion|million|thousand)|[kKmMbB%])\b/gi,
  )].map(match => match[0])
    .find(token => {
      const parsed = parseSpokenMagnitude(token);
      return Boolean(parsed && isHugeSpokenNumber(parsed));
    });

  const firstStart = Math.min(4.2, span * 0.18);
  const firstHold = holdFromPhrase(primary, 2.2);
  const secondText = (phrases[1] || primary).slice(0, 24).toUpperCase();
  const secondHold = holdFromPhrase(secondText, 1.8);
  const secondStart = Math.min(Math.max(firstStart + firstHold + 1.2, span * 0.52), span - secondHold);
  const motionGraphics: MotionGraphic[] = [
    {
      start: firstStart,
      end: Math.min(span, firstStart + firstHold),
      text: primary,
      role: 'primary',
      shape: 'block',
      accentColor: '#FACC15',
      textColor: '#FFFFFF',
      anchor: 'top_right',
      entrance: 'type_stagger',
      exit: 'spring_out',
      fontScale: 1.18,
      italic: false,
    },
    {
      start: secondStart,
      end: Math.min(span, secondStart + secondHold),
      text: secondText,
      role: 'secondary',
      shape: 'pill',
      accentColor: '#22D3EE',
      textColor: '#0F172A',
      anchor: 'top_left',
      entrance: 'scale_pop',
      exit: 'slide_away',
      fontScale: 0.98,
      italic: false,
    },
  ];

  const mediaContainers: MediaContainerMoment[] = [];
  const frameInsets: FrameInset[] = [];

  const semanticEmphasis: SemanticEmphasis[] = [];
  if (numberHit) {
    const at = Math.min(span * 0.55, span - 3.2);
    const magnitude = parseSpokenMagnitude(numberHit);
    const huge = Boolean(magnitude && isHugeSpokenNumber(magnitude));
    semanticEmphasis.push({
      start: at,
      end: at + 2.8,
      text: numberHit,
      weight: 'primary',
      treatment: huge ? 'count' : 'scale',
      accentColor: '#FACC15',
      anchor: 'top_right',
      countFrom: huge ? magnitude?.countFrom : undefined,
      countTo: huge ? magnitude?.countTo : undefined,
      countSuffix: huge ? magnitude?.suffix : undefined,
    });
  } else if (phrases[2]) {
    const at = Math.min(span * 0.58, span - 3.0);
    semanticEmphasis.push({
      start: at,
      end: at + 2.6,
      text: phrases[2].slice(0, 24),
      weight: 'secondary',
      treatment: 'type_reveal',
      accentColor: '#4ADE80',
      anchor: 'top_left',
    });
  }

  return {motionGraphics, mediaContainers, frameInsets, semanticEmphasis};
}

function ensureMotionCoverage(input: {
  motionGraphics: MotionGraphic[];
  mediaContainers: MediaContainerMoment[];
  frameInsets: FrameInset[];
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
    mediaContainers: input.mediaContainers,
    frameInsets: input.frameInsets,
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
    const role = coerceEnum(item.role, MOTION_ROLES, 'primary');
    const text = String(item.text ?? item.overlay_text ?? '')
      .trim()
      .slice(0, 48);
    const hold = holdFromPhrase(text, role === 'primary' ? 2.2 : 1.6);
    const end = Number(item.end ?? start + hold);
    if (!text || !Number.isFinite(start) || start < 0 || start > durationSec) {
      continue;
    }
    const requested = Number.isFinite(end) ? end : start + hold;
    const safeEnd = Math.min(durationSec, Math.max(start + 0.9, requested));
    out.push({
      start,
      end: safeEnd,
      text,
      role,
      shape: coerceEnum(item.shape, MOTION_SHAPES, 'block'),
      accentColor: sanitizeHex(String(item.accent_color ?? item.accentColor ?? ''), '#FACC15'),
      textColor: sanitizeHex(String(item.text_color ?? item.textColor ?? ''), '#FFFFFF'),
      anchor: coerceEnum(item.anchor, MOTION_ANCHORS, 'top_right'),
      entrance: coerceEnum(item.entrance, MOTION_ENTRANCES, 'type_stagger'),
      exit: coerceEnum(item.exit, MOTION_EXITS, 'spring_out'),
      fontScale: clamp(Number(item.font_scale ?? item.fontScale ?? 1), 0.7, 1.8),
      italic: Boolean(item.italic ?? true),
    });
  }
  return out.slice(0, 10);
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
    const end = Number(item.end ?? start + 4.5);
    if (!Number.isFinite(start) || start < 3 || start > durationSec) {
      continue;
    }
    const safeEnd = Math.min(
      durationSec,
      Math.max(start + 4, Number.isFinite(end) ? end : start + 4.5),
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
      scale: clamp(Number(item.scale ?? 0.62), 0.22, 0.78),
      transitionSec: clamp(
        Number(item.transition_sec ?? item.transitionSec ?? 1),
        0.85,
        1.25,
      ),
      canvasTitle: String(item.canvas_title ?? item.canvasTitle ?? '')
        .trim()
        .slice(0, 40),
      canvasTitleColor: sanitizeHex(
        String(item.canvas_title_color ?? item.canvasTitleColor ?? ''),
        '#0F172A',
      ),
      pipAnchor: coercePipAnchor(item.pip_anchor ?? item.pipAnchor),
    });
  }
  return out.slice(0, 3);
}

function parseFrameInsets(raw: unknown, durationSec: number): FrameInset[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: FrameInset[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const start = Number(item.start ?? item.timestamp);
    const end = Number(item.end ?? start + 4.2);
    if (!Number.isFinite(start) || start < 2.2 || start > durationSec) {
      continue;
    }
    const safeEnd = Math.min(
      durationSec,
      Math.max(start + 3.8, Number.isFinite(end) ? end : start + 4.2),
    );
    out.push({
      start,
      end: safeEnd,
      scale: clamp(Number(item.scale ?? 0.86), 0.7, 0.94),
      marginColor: sanitizeHex(
        String(item.margin_color ?? item.marginColor ?? item.canvas_color ?? ''),
        '#000000',
      ),
      cornerRadius: clamp(Number(item.corner_radius ?? item.cornerRadius ?? 18), 0, 48),
      transitionSec: clamp(
        Number(item.transition_sec ?? item.transitionSec ?? 0.9),
        0.55,
        1.4,
      ),
    });
  }
  return out.slice(0, 2);
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
    const end = Number(item.end ?? start + 2.6);
    const text = String(item.text ?? '')
      .trim()
      .slice(0, 32);
    if (!text || !Number.isFinite(start) || start < 0 || start > durationSec) {
      continue;
    }
    const magnitude = parseSpokenMagnitude(text);
    const treatment = coerceEnum(item.treatment, EMPHASIS_TREATMENTS, 'scale');
    out.push({
      start,
      end: Math.min(
        durationSec,
        Math.max(start + 2.4, Number.isFinite(end) ? end : start + 2.6),
      ),
      text,
      weight: coerceEnum(item.weight, EMPHASIS_WEIGHTS, 'primary'),
      treatment:
        treatment === 'highlight_shape' && magnitude ? 'count' : treatment,
      accentColor: sanitizeHex(
        String(item.accent_color ?? item.accentColor ?? ''),
        '#FACC15',
      ),
      anchor: coercePipAnchor(item.anchor) ?? undefined,
      countFrom: Number.isFinite(Number(item.count_from ?? item.countFrom))
        ? Number(item.count_from ?? item.countFrom)
        : magnitude?.countFrom,
      countTo: Number.isFinite(Number(item.count_to ?? item.countTo))
        ? Number(item.count_to ?? item.countTo)
        : magnitude?.countTo,
      countSuffix: String(item.count_suffix ?? item.countSuffix ?? magnitude?.suffix ?? '')
        .trim()
        .slice(0, 16),
    });
  }
  return out.slice(0, 5);
}

function coercePipAnchor(raw: unknown): VisualAnchor | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if ((VISUAL_ANCHORS as readonly string[]).includes(value)) {
    return value as VisualAnchor;
  }
  return undefined;
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
