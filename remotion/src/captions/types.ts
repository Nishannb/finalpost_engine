/**
 * Caption template contract for Remotion.
 *
 * `transcriptData` matches Whisper word JSON (seconds). The renderer never
 * walks the whole transcript into the tree — only the active page/token
 * is drawn, so preview stays frame-accurate.
 */

export const DYNAMIC_CAPTION_TEMPLATES = [
  'basic',
  'moving-pill',
  'pop',
  'karaoke',
  'hustle',
  'grape',
  'beast',
  'poppin',
  'aarit',
  'soft-ai',
  'gaming-stream',
  'simple-one-word',
  'kinetic-01',
  'kinetic-slam',
  'weight-shift',
  'editorial-emphasis',
  'pop-theme',
  'karaoke-theme',
  'hustle-theme',
  'grape-theme',
  'beast-theme',
  'poppin-theme',
  'aarit-theme',
  'soft-ai-theme',
  'gaming-stream-theme',
  'simple-one-word-theme',
  'kinetic-01-theme',
  'hormozi',
  'mrbeast',
  'classic',
  'box',
  'bounce',
  'minimal',
  'clean',
  'subtitle',
] as const;

export type DynamicCaptionTemplateId = (typeof DYNAMIC_CAPTION_TEMPLATES)[number];

export type WhisperTranscriptWord = {
  /** Spoken token. Whisper uses `word`; we also accept `text`. */
  word?: string;
  text?: string;
  /** Start time in seconds (Whisper JSON). */
  start: number;
  /** End time in seconds. */
  end: number;
};

export type CaptionCustomizationOptions = {
  fontSize?: number;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
};

export type DynamicCaptionRendererProps = {
  transcriptData: WhisperTranscriptWord[];
  selectedTemplate: DynamicCaptionTemplateId;
  customizationOptions?: CaptionCustomizationOptions;
  language?: 'en' | 'es' | 'hi' | 'ta' | 'ne' | 'auto';
};

export type CaptionTemplateCatalogItem = {
  id: DynamicCaptionTemplateId;
  label: string;
  hint: string;
  family: 'theme' | 'utility';
};
