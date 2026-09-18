/**
 * Caption presets, kept numerically identical to the app's
 * `src/lib/captionTemplateStyles.ts`.
 *
 * Sizes are stored as a fraction of a 393 pt phone preview width and scaled by
 * the render width at draw time, so what the creator sees in the live preview is
 * what the Lambda burns — no separate "render sizing" to drift out of sync.
 */

import type {CaptionTemplateId} from '../blueprintSchema';

/** Width of the RN preview surface the presets were authored against. */
const PREVIEW_WIDTH_PT = 393;

export type CaptionAnimation =
  | 'highlight'
  | 'karaoke'
  | 'scale'
  | 'bounce'
  | 'box';

export type CaptionTemplate = {
  id: CaptionTemplateId;
  label: string;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  backgroundColor: string | null;
  /** Authored in preview points; convert with `captionFontSize`. */
  fontSizePt: number;
  outlineWidthPt: number;
  maxWidthFrac: number;
  animation: CaptionAnimation;
  /** Impact-style faces suit the loud presets; the rest read better in Inter. */
  weight: 'impact' | 'sans';
  uppercase: boolean;
};

export const CAPTION_TEMPLATES: Record<CaptionTemplateId, CaptionTemplate> = {
  hormozi: {
    id: 'hormozi',
    label: 'Hormozi',
    primaryColor: '#FFFFFF',
    highlightColor: '#00FFFF',
    outlineColor: '#000000',
    backgroundColor: null,
    fontSizePt: 34,
    outlineWidthPt: 5,
    maxWidthFrac: 0.9,
    animation: 'highlight',
    weight: 'impact',
    uppercase: true,
  },
  mrbeast: {
    id: 'mrbeast',
    label: 'MrBeast',
    primaryColor: '#FFFF00',
    highlightColor: '#FF6600',
    outlineColor: '#000000',
    backgroundColor: null,
    fontSizePt: 38,
    outlineWidthPt: 8,
    maxWidthFrac: 0.92,
    animation: 'highlight',
    weight: 'impact',
    uppercase: true,
  },
  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    primaryColor: '#FFFFFF',
    highlightColor: '#0080FF',
    outlineColor: '#000000',
    backgroundColor: null,
    fontSizePt: 34,
    outlineWidthPt: 4,
    maxWidthFrac: 0.9,
    animation: 'karaoke',
    weight: 'impact',
    uppercase: false,
  },
  classic: {
    id: 'classic',
    label: 'Classic',
    primaryColor: '#FFFFFF',
    highlightColor: '#FFFF00',
    outlineColor: '#000000',
    backgroundColor: null,
    fontSizePt: 34,
    outlineWidthPt: 6,
    maxWidthFrac: 0.88,
    animation: 'highlight',
    weight: 'impact',
    uppercase: true,
  },
  box: {
    id: 'box',
    label: 'Box',
    primaryColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    outlineColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.72)',
    fontSizePt: 32,
    outlineWidthPt: 0,
    maxWidthFrac: 0.84,
    animation: 'box',
    weight: 'sans',
    uppercase: false,
  },
  bounce: {
    id: 'bounce',
    label: 'Bounce',
    primaryColor: '#00FF88',
    highlightColor: '#FF00FF',
    outlineColor: '#000000',
    backgroundColor: null,
    fontSizePt: 36,
    outlineWidthPt: 5,
    maxWidthFrac: 0.9,
    animation: 'bounce',
    weight: 'impact',
    uppercase: true,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    primaryColor: '#FFFFFF',
    highlightColor: '#F5F5F5',
    outlineColor: '#000000',
    backgroundColor: null,
    fontSizePt: 32,
    outlineWidthPt: 4,
    maxWidthFrac: 0.86,
    animation: 'scale',
    weight: 'sans',
    uppercase: false,
  },
};

export function captionTemplateFor(id: string): CaptionTemplate {
  return (
    CAPTION_TEMPLATES[id as CaptionTemplateId] ?? CAPTION_TEMPLATES.hormozi
  );
}

export function scaleFromPreview(valuePt: number, renderWidth: number): number {
  return (valuePt / PREVIEW_WIDTH_PT) * renderWidth;
}
