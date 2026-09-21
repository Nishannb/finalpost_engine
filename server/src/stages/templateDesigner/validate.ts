/**
 * Never execute a raw model EditSpec. Clamp numbers, drop unknown ops, fill gaps.
 */

import {CAPTION_ANIMATIONS, CAPTION_TEMPLATES} from '../../types/blueprint.ts';
import type {CaptionAnimation, CaptionTemplateId} from '../../types/blueprint.ts';
import {
  CAPTION_GROUPINGS,
  CAPTION_IN_TYPES,
  EDIT_SPEC_VERSION,
  EMPHASIS_TRIGGERS,
  FONT_CATEGORIES,
  TEXT_CASES,
  type CaptionGrouping,
  type CaptionInType,
  type EditSpec,
  type EmphasisTriggerType,
  type FontCategory,
  type TextCase,
} from '../../types/editSpec.ts';

export type EditSpecValidation = {
  spec: EditSpec;
  warnings: string[];
};

const IN_TO_ANIMATION: Record<CaptionInType, CaptionAnimation> = {
  pop: 'pop',
  fade: 'highlight',
  slide: 'scale',
  karaoke: 'karaoke',
  bounce: 'bounce',
  typewriter: 'type',
  none: 'highlight',
};

const IN_TO_TEMPLATE: Partial<Record<CaptionInType, CaptionTemplateId>> = {
  karaoke: 'karaoke',
  bounce: 'hustle',
  typewriter: 'aarit',
  pop: 'pop',
};

export function sanitizeTemplateName(raw: unknown, fallback: string): string {
  const cleaned = String(raw ?? '')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  if (cleaned.length >= 2) {
    return cleaned;
  }
  const backup = fallback.replace(/\s+/g, ' ').trim().slice(0, 40);
  return backup.length >= 2 ? backup : 'Caption look';
}

export function defaultEditSpec(partial?: Partial<EditSpec>): EditSpec {
  return {
    version: EDIT_SPEC_VERSION,
    canvas: {aspectRatio: '9:16'},
    name: 'Caption look',
    overallStyle: 'Talking-head captions with word emphasis',
    caption: {
      template: 'karaoke',
      grouping: 'word',
      position: {x: 0.5, y: 0.82, confidence: 0.5},
      fontCategory: 'condensed-bold',
      case: 'uppercase',
      size: 0.09,
      tracking: -0.02,
      textColor: '#FFFFFF',
      highlightColor: '#F5B942',
      box: false,
      boxColor: null,
      animation: 'karaoke',
      confidence: 0.5,
    },
    emphasis: {
      trigger: {type: 'emphasis_word', importance: 'high'},
      action: {textScale: 1.12, colorChange: true, cameraZoom: 1.06},
    },
    animations: {
      captionIn: {type: 'karaoke', durationMs: 180, intensity: 0.75, confidence: 0.5},
      captionOut: {type: 'fade', durationMs: 100, confidence: 0.4},
    },
    camera: {
      emphasisZoom: {enabled: false, scale: 1.08, durationMs: 220},
    },
    confidence: 0.5,
    ...partial,
  };
}

export function validateEditSpec(raw: unknown): EditSpecValidation {
  const warnings: string[] = [];
  const record =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const captionRaw =
    record.caption && typeof record.caption === 'object'
      ? (record.caption as Record<string, unknown>)
      : {};
  const posRaw =
    captionRaw.position && typeof captionRaw.position === 'object'
      ? (captionRaw.position as Record<string, unknown>)
      : {};
  const emphasisRaw =
    record.emphasis && typeof record.emphasis === 'object'
      ? (record.emphasis as Record<string, unknown>)
      : {};
  const triggerRaw =
    emphasisRaw.trigger && typeof emphasisRaw.trigger === 'object'
      ? (emphasisRaw.trigger as Record<string, unknown>)
      : {};
  const actionRaw =
    emphasisRaw.action && typeof emphasisRaw.action === 'object'
      ? (emphasisRaw.action as Record<string, unknown>)
      : {};
  const animRaw =
    record.animations && typeof record.animations === 'object'
      ? (record.animations as Record<string, unknown>)
      : {};
  const inRaw =
    animRaw.captionIn && typeof animRaw.captionIn === 'object'
      ? (animRaw.captionIn as Record<string, unknown>)
      : {};
  const outRaw =
    animRaw.captionOut && typeof animRaw.captionOut === 'object'
      ? (animRaw.captionOut as Record<string, unknown>)
      : {};
  const cameraRaw =
    record.camera && typeof record.camera === 'object'
      ? (record.camera as Record<string, unknown>)
      : {};
  const zoomRaw =
    cameraRaw.emphasisZoom && typeof cameraRaw.emphasisZoom === 'object'
      ? (cameraRaw.emphasisZoom as Record<string, unknown>)
      : {};

  const template = enumOr(
    String(captionRaw.template ?? ''),
    CAPTION_TEMPLATES,
    'karaoke',
    warnings,
    'caption.template',
  ) as CaptionTemplateId;
  const grouping = enumOr(
    String(captionRaw.grouping ?? captionRaw.wordReveal ?? 'word'),
    CAPTION_GROUPINGS,
    'word',
    warnings,
    'caption.grouping',
  ) as CaptionGrouping;
  const inType = enumOr(
    String(inRaw.type ?? ''),
    CAPTION_IN_TYPES,
    'karaoke',
    warnings,
    'animations.captionIn.type',
  ) as CaptionInType;
  let animation = enumOr(
    String(captionRaw.animation ?? ''),
    CAPTION_ANIMATIONS,
    IN_TO_ANIMATION[inType],
    warnings,
    'caption.animation',
  ) as CaptionAnimation;
  if (!captionRaw.animation && IN_TO_ANIMATION[inType]) {
    animation = IN_TO_ANIMATION[inType];
  }

  let resolvedTemplate = template;
  if (
    (!captionRaw.template || captionRaw.template === 'karaoke') &&
    IN_TO_TEMPLATE[inType]
  ) {
    resolvedTemplate = IN_TO_TEMPLATE[inType] as CaptionTemplateId;
  }

  const x = clamp(Number(posRaw.x ?? 0.5), 0, 1, 0.5);
  const y = clamp(Number(posRaw.y ?? 0.82), 0, 1, 0.82);
  const size = clamp(Number(captionRaw.size ?? 0.09), 0.04, 0.16, 0.09);
  const textScale = clamp(Number(actionRaw.textScale ?? 1.12), 0.5, 3, 1.12);
  const cameraZoom = clamp(Number(actionRaw.cameraZoom ?? 1.06), 0.5, 3, 1.06);
  const zoomScale = clamp(Number(zoomRaw.scale ?? cameraZoom), 0.5, 3, 1.08);
  const inMs = clamp(Number(inRaw.durationMs ?? 180), 40, 800, 180);
  const outMs = clamp(Number(outRaw.durationMs ?? 100), 0, 600, 100);
  const zoomMs = clamp(Number(zoomRaw.durationMs ?? 220), 80, 1200, 220);
  const confidence = clamp(Number(record.confidence ?? 0.6), 0, 1, 0.6);

  const overallStyle =
    String(record.overallStyle ?? record.overall_style ?? '')
      .trim()
      .slice(0, 280) || defaultEditSpec().overallStyle;
  const spec = defaultEditSpec({
    name: sanitizeTemplateName(
      record.name ?? record.templateName ?? record.template_name,
      overallStyle.split(/[.,]/)[0] || 'Caption look',
    ),
    overallStyle,
    caption: {
      template: resolvedTemplate,
      grouping,
      position: {
        x,
        y,
        confidence: optionalConfidence(posRaw.confidence),
      },
      fontCategory: enumOr(
        String(captionRaw.fontCategory ?? captionRaw.font_category ?? ''),
        FONT_CATEGORIES,
        'condensed-bold',
        warnings,
        'caption.fontCategory',
      ) as FontCategory,
      case: enumOr(
        String(captionRaw.case ?? ''),
        TEXT_CASES,
        'uppercase',
        warnings,
        'caption.case',
      ) as TextCase,
      size,
      tracking: clamp(Number(captionRaw.tracking ?? -0.02), -0.12, 0.12, -0.02),
      textColor: hex(String(captionRaw.textColor ?? captionRaw.text_color ?? ''), '#FFFFFF'),
      highlightColor: hex(
        String(captionRaw.highlightColor ?? captionRaw.highlight_color ?? ''),
        '#F5B942',
      ),
      box: captionRaw.box === true,
      boxColor:
        captionRaw.box === true
          ? hex(String(captionRaw.boxColor ?? captionRaw.box_color ?? '#111111'), '#111111')
          : null,
      animation,
      confidence: optionalConfidence(captionRaw.confidence),
    },
    emphasis: {
      trigger: {
        type: enumOr(
          String(triggerRaw.type ?? 'emphasis_word'),
          EMPHASIS_TRIGGERS,
          'emphasis_word',
          warnings,
          'emphasis.trigger.type',
        ) as EmphasisTriggerType,
        importance: importance(triggerRaw.importance),
      },
      action: {
        textScale,
        colorChange: actionRaw.colorChange !== false,
        cameraZoom,
      },
    },
    animations: {
      captionIn: {
        type: inType,
        durationMs: Math.round(inMs),
        intensity: clamp(Number(inRaw.intensity ?? 0.75), 0, 1, 0.75),
        confidence: optionalConfidence(inRaw.confidence),
      },
      captionOut: {
        type: String(outRaw.type ?? 'fade') === 'none' ? 'none' : 'fade',
        durationMs: Math.round(outMs),
        confidence: optionalConfidence(outRaw.confidence),
      },
    },
    camera: {
      emphasisZoom: {
        enabled: zoomRaw.enabled === true || cameraZoom > 1.02,
        scale: zoomScale,
        durationMs: Math.round(zoomMs),
      },
    },
    confidence,
    modelUsed: String(record.modelUsed ?? '').trim() || undefined,
  });

  return {spec, warnings};
}

function enumOr<T extends string>(
  raw: string,
  allowed: readonly T[],
  fallback: T,
  warnings: string[],
  field: string,
): T {
  const value = raw.trim().toLowerCase() as T;
  if (allowed.includes(value)) {
    return value;
  }
  if (raw.trim()) {
    warnings.push(`${field}: unsupported "${raw.trim()}"; used ${fallback}`);
  }
  return fallback;
}

function importance(raw: unknown): 'high' | 'medium' | 'low' {
  const value = String(raw ?? 'high').trim().toLowerCase();
  if (value === 'medium' || value === 'low' || value === 'high') {
    return value;
  }
  return 'high';
}

function optionalConfidence(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, n));
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function hex(value: string, fallback: string): string {
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
