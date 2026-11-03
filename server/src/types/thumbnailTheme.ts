/**
 * Creator thumbnail brand kit — colors, typography, mood + freeform notes.
 * Kept in sync with mobile `src/lib/thumbnailTheme.ts`.
 */

export const THUMBNAIL_MOODS = [
  'hype',
  'clean',
  'educational',
  'sales',
  'story',
] as const;

export type ThumbnailMood = (typeof THUMBNAIL_MOODS)[number];

export const THUMBNAIL_TYPE_STYLES = [
  'sans-impact',
  'rounded',
  'editorial',
] as const;

export type ThumbnailTypeStyle = (typeof THUMBNAIL_TYPE_STYLES)[number];

export const THUMBNAIL_HEADLINE_WEIGHTS = [
  'black',
  'bold',
  'semibold',
] as const;

export type ThumbnailHeadlineWeight =
  (typeof THUMBNAIL_HEADLINE_WEIGHTS)[number];

export const THUMBNAIL_TEXT_CASES = ['upper', 'title', 'sentence'] as const;

export type ThumbnailTextCase = (typeof THUMBNAIL_TEXT_CASES)[number];

export type ThumbnailPalette = {
  primary: string;
  accent: string;
  background: string;
  text: string;
  outline?: string;
};

export type ThumbnailTypography = {
  headlineWeight: ThumbnailHeadlineWeight;
  case: ThumbnailTextCase;
  style: ThumbnailTypeStyle;
  outline: boolean;
  shadow: boolean;
};

export type ThumbnailTheme = {
  version: 1;
  mood: ThumbnailMood;
  palette: ThumbnailPalette;
  typography: ThumbnailTypography;
  visualMotifs: string[];
  /** Textual description of the look for generation prompts. */
  styleNotes: string;
  referenceImageUrls: string[];
  curatedDemoId?: string | null;
  learnedAt?: string;
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function asHex(raw: unknown, fallback: string): string {
  const value = String(raw ?? '').trim();
  return HEX.test(value) ? value : fallback;
}

function asMood(raw: unknown): ThumbnailMood {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (THUMBNAIL_MOODS as readonly string[]).includes(value)
    ? (value as ThumbnailMood)
    : 'hype';
}

function asTypeStyle(raw: unknown): ThumbnailTypeStyle {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (THUMBNAIL_TYPE_STYLES as readonly string[]).includes(value)
    ? (value as ThumbnailTypeStyle)
    : 'sans-impact';
}

function asWeight(raw: unknown): ThumbnailHeadlineWeight {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (THUMBNAIL_HEADLINE_WEIGHTS as readonly string[]).includes(value)
    ? (value as ThumbnailHeadlineWeight)
    : 'black';
}

function asCase(raw: unknown): ThumbnailTextCase {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (THUMBNAIL_TEXT_CASES as readonly string[]).includes(value)
    ? (value as ThumbnailTextCase)
    : 'upper';
}

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);
}

export function defaultThumbnailTheme(
  partial?: Partial<ThumbnailTheme>,
): ThumbnailTheme {
  return {
    version: 1,
    mood: partial?.mood ?? 'hype',
    palette: {
      primary: partial?.palette?.primary ?? '#FFFFFF',
      accent: partial?.palette?.accent ?? '#FACC15',
      background: partial?.palette?.background ?? '#0A0A0A',
      text: partial?.palette?.text ?? '#FFFFFF',
      outline: partial?.palette?.outline,
    },
    typography: {
      headlineWeight: partial?.typography?.headlineWeight ?? 'black',
      case: partial?.typography?.case ?? 'upper',
      style: partial?.typography?.style ?? 'sans-impact',
      outline: partial?.typography?.outline ?? true,
      shadow: partial?.typography?.shadow ?? true,
    },
    visualMotifs: partial?.visualMotifs?.length
      ? partial.visualMotifs.slice(0, 8)
      : ['face + bold short headline', 'high contrast'],
    styleNotes:
      partial?.styleNotes?.trim() ||
      'Match brand colors, typography weight, and mood. Vary layout per video — do not clone a fixed composition.',
    referenceImageUrls: partial?.referenceImageUrls?.length
      ? partial.referenceImageUrls.filter(Boolean).slice(0, 6)
      : [],
    curatedDemoId: partial?.curatedDemoId ?? null,
    learnedAt: partial?.learnedAt ?? new Date().toISOString(),
  };
}

export function coerceThumbnailTheme(raw: unknown): ThumbnailTheme | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const paletteRaw =
    record.palette && typeof record.palette === 'object'
      ? (record.palette as Record<string, unknown>)
      : {};
  const typeRaw =
    record.typography && typeof record.typography === 'object'
      ? (record.typography as Record<string, unknown>)
      : {};
  const motifs = asStringList(record.visualMotifs ?? record.visual_motifs);
  const refs = asStringList(
    record.referenceImageUrls ?? record.reference_image_urls,
  );
  const curated = String(
    record.curatedDemoId ?? record.curated_demo_id ?? '',
  ).trim();
  const notes = String(
    record.styleNotes ?? record.style_notes ?? record.description ?? '',
  ).trim();

  return defaultThumbnailTheme({
    mood: asMood(record.mood),
    palette: {
      primary: asHex(paletteRaw.primary, '#FFFFFF'),
      accent: asHex(paletteRaw.accent, '#FACC15'),
      background: asHex(paletteRaw.background, '#0A0A0A'),
      text: asHex(paletteRaw.text, '#FFFFFF'),
      outline: paletteRaw.outline
        ? asHex(paletteRaw.outline, '#000000')
        : undefined,
    },
    typography: {
      headlineWeight: asWeight(
        typeRaw.headlineWeight ?? typeRaw.headline_weight,
      ),
      case: asCase(typeRaw.case),
      style: asTypeStyle(typeRaw.style),
      outline: Boolean(typeRaw.outline == null ? true : typeRaw.outline),
      shadow: Boolean(typeRaw.shadow == null ? true : typeRaw.shadow),
    },
    visualMotifs: motifs,
    styleNotes: notes,
    referenceImageUrls: refs,
    curatedDemoId: curated || null,
    learnedAt:
      String(record.learnedAt ?? record.learned_at ?? '').trim() || undefined,
  });
}
