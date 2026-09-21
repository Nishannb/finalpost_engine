/**
 * FinalPost EditSpec — reusable editing language for Remotion.
 *
 * The AI Template Designer describes WHAT the edit does.
 * Remotion executes HOW. Never treat this as generated code.
 */

import {
  CAPTION_ANIMATIONS,
  CAPTION_TEMPLATES,
  type CaptionAnimation,
  type CaptionTemplateId,
} from './blueprint.ts';

export const EDIT_SPEC_VERSION = '1.0' as const;

export const FONT_CATEGORIES = [
  'condensed-bold',
  'sans',
  'rounded',
  'neon',
  'impact',
] as const;
export type FontCategory = (typeof FONT_CATEGORIES)[number];

export const CAPTION_GROUPINGS = ['word', 'phrase', 'line'] as const;
export type CaptionGrouping = (typeof CAPTION_GROUPINGS)[number];

export const TEXT_CASES = ['uppercase', 'title', 'as-spoken'] as const;
export type TextCase = (typeof TEXT_CASES)[number];

export const CAPTION_IN_TYPES = [
  'pop',
  'fade',
  'slide',
  'karaoke',
  'bounce',
  'typewriter',
  'none',
] as const;
export type CaptionInType = (typeof CAPTION_IN_TYPES)[number];

export const EMPHASIS_TRIGGERS = [
  'emphasis_word',
  'hook',
  'cta',
  'number',
] as const;
export type EmphasisTriggerType = (typeof EMPHASIS_TRIGGERS)[number];

export type ConfidenceField<T> = T & {confidence?: number};

export type EditSpec = {
  version: typeof EDIT_SPEC_VERSION;
  canvas: {aspectRatio: '9:16'};
  /** Short catalog name the Designer gives this look. */
  name: string;
  overallStyle: string;
  caption: ConfidenceField<{
    template: CaptionTemplateId;
    grouping: CaptionGrouping;
    position: ConfidenceField<{x: number; y: number}>;
    fontCategory: FontCategory;
    case: TextCase;
    size: number;
    tracking: number;
    textColor: string;
    highlightColor: string;
    box: boolean;
    boxColor: string | null;
    animation: CaptionAnimation;
  }>;
  emphasis: {
    trigger: {type: EmphasisTriggerType; importance: 'high' | 'medium' | 'low'};
    action: {
      textScale: number;
      colorChange: boolean;
      cameraZoom: number;
    };
  };
  animations: {
    captionIn: ConfidenceField<{
      type: CaptionInType;
      durationMs: number;
      intensity: number;
    }>;
    captionOut: ConfidenceField<{type: 'fade' | 'none'; durationMs: number}>;
  };
  camera: {
    emphasisZoom: {
      enabled: boolean;
      scale: number;
      durationMs: number;
    };
  };
  confidence: number;
  modelUsed?: string;
};

export const ALLOWED_CAPTION_TEMPLATES = CAPTION_TEMPLATES;
export const ALLOWED_CAPTION_ANIMATIONS = CAPTION_ANIMATIONS;
