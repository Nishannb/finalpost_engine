/**
 * Learned caption look from one reference video the creator uploads.
 * Fed back to the director so future edits match their caption style.
 */

import {
  CAPTION_ANIMATIONS,
  CAPTION_POSITIONS,
  CAPTION_TEMPLATES,
  type CaptionAnimation,
  type CaptionDirection,
  type CaptionPosition,
  type CaptionTemplateId,
} from './blueprint.ts';

export type CaptionWordReveal = 'word' | 'phrase' | 'line';

export type CaptionStyleGuide = {
  version: 1;
  template: CaptionTemplateId;
  position: CaptionPosition;
  textColor: string;
  highlightColor: string;
  box: boolean;
  boxColor: string | null;
  fontScale: number;
  animation: CaptionAnimation;
  wordReveal: CaptionWordReveal;
  bottomFrac: number;
  uppercase: boolean;
  italic: boolean;
  /** Freeform director notes about this creator's caption craft. */
  notes: string;
  sourceVideoUrl?: string;
  learnedAt?: string;
};

const WORD_REVEALS: CaptionWordReveal[] = ['word', 'phrase', 'line'];

export function defaultCaptionStyleGuide(
  partial?: Partial<CaptionStyleGuide>,
): CaptionStyleGuide {
  return {
    version: 1,
    template: 'karaoke',
    position: 'bottom',
    textColor: '#FFFFFF',
    highlightColor: '#FFE14A',
    box: false,
    boxColor: null,
    fontScale: 1,
    animation: 'highlight',
    wordReveal: 'word',
    bottomFrac: 0.16,
    uppercase: true,
    italic: false,
    notes: '',
    ...partial,
  };
}

export function coerceCaptionStyleGuide(raw: unknown): CaptionStyleGuide | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const templateRaw = String(record.template ?? record.captionTemplate ?? '')
    .trim()
    .toLowerCase();
  const template = (CAPTION_TEMPLATES as readonly string[]).includes(templateRaw)
    ? (templateRaw as CaptionTemplateId)
    : 'karaoke';
  const positionRaw = String(record.position ?? '')
    .trim()
    .toLowerCase()
    .replace('-', '_');
  const position = (CAPTION_POSITIONS as readonly string[]).includes(positionRaw)
    ? (positionRaw as CaptionPosition)
    : 'bottom';
  const animationRaw = String(record.animation ?? '')
    .trim()
    .toLowerCase();
  const animation = (CAPTION_ANIMATIONS as readonly string[]).includes(animationRaw)
    ? (animationRaw as CaptionAnimation)
    : 'highlight';
  const revealRaw = String(record.wordReveal ?? record.word_reveal ?? 'word')
    .trim()
    .toLowerCase();
  const wordReveal = WORD_REVEALS.includes(revealRaw as CaptionWordReveal)
    ? (revealRaw as CaptionWordReveal)
    : 'word';
  const box =
    record.box === true ||
    Boolean(String(record.boxColor ?? record.box_color ?? '').trim());
  const boxColorRaw = String(record.boxColor ?? record.box_color ?? '').trim();
  const notes = String(record.notes ?? record.directorNotes ?? '')
    .trim()
    .slice(0, 1200);
  const guide = defaultCaptionStyleGuide({
    template,
    position,
    textColor: sanitizeHex(
      String(record.textColor ?? record.text_color ?? ''),
      '#FFFFFF',
    ),
    highlightColor: sanitizeHex(
      String(record.highlightColor ?? record.highlight_color ?? ''),
      '#FFE14A',
    ),
    box,
    boxColor: box
      ? sanitizeHex(boxColorRaw || '#111111', '#111111')
      : null,
    fontScale: clamp(Number(record.fontScale ?? record.font_scale ?? 1), 0.7, 1.4),
    animation,
    wordReveal,
    bottomFrac: clamp(
      Number(record.bottomFrac ?? record.bottom_frac ?? 0.16),
      0.04,
      0.28,
    ),
    uppercase: record.uppercase !== false,
    italic: record.italic === true,
    notes,
    sourceVideoUrl: String(record.sourceVideoUrl ?? record.source_video_url ?? '')
      .trim()
      .slice(0, 500) || undefined,
    learnedAt: String(record.learnedAt ?? record.learned_at ?? '').trim() || undefined,
  });
  return guide;
}

export function captionGuideToDirection(guide: CaptionStyleGuide): CaptionDirection {
  return {
    position: guide.position === 'center' ? 'bottom' : guide.position,
    bottomFrac: guide.bottomFrac,
    textColor: guide.textColor,
    highlightColor: guide.highlightColor,
    boxColor: guide.box ? guide.boxColor : null,
    template: guide.template,
    fontScale: guide.fontScale,
    animation: guide.animation,
    uppercase: guide.uppercase,
  };
}

export function formatCaptionGuideForDirector(guide: CaptionStyleGuide): string {
  return [
    'CREATOR_CAPTION_STYLE (honor this look on every future edit):',
    `template=${guide.template} position=${guide.position} animation=${guide.animation} word_reveal=${guide.wordReveal}`,
    `text=${guide.textColor} highlight=${guide.highlightColor} box=${guide.box ? guide.boxColor || '#111111' : 'none'}`,
    `font_scale=${guide.fontScale.toFixed(2)} uppercase=${guide.uppercase} italic=${guide.italic} bottom_frac=${guide.bottomFrac.toFixed(2)}`,
    guide.notes ? `notes: ${guide.notes}` : '',
    'Occupancy may nudge caption position so type does not cover the speaker or a legal overlay slot.',
  ]
    .filter(Boolean)
    .join('\n');
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
