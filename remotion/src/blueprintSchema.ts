/**
 * Runtime schema for the composition's input props.
 *
 * This intentionally duplicates the server's `types/blueprint.ts`: because the
 * payload arrives over the wire into a Lambda, validating it here turns a
 * malformed blueprint into a clear schema error instead of a black MP4. It also
 * gives Remotion Studio editable controls for the whole timeline.
 */

import {z} from 'zod';

export const languageCodeSchema = z.enum(['en', 'es', 'hi', 'ta', 'ne', 'auto']);

export const captionTemplateSchema = z.enum([
  'hormozi',
  'mrbeast',
  'karaoke',
  'classic',
  'box',
  'bounce',
  'minimal',
]);

export const hookStyleSchema = z.enum([
  'impact',
  'boxed',
  'minimal',
  'bar',
  'stack',
  'outline',
  'rail',
  'poster',
  'underline',
  'duo',
]);

export const layoutStyleSchema = z.enum(['fullscreen', 'podcastSplit']);

export const wordTokenSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

export const captionWordSchema = wordTokenSchema.extend({
  sentenceIndex: z.number().int().nonnegative(),
});

export const keepSegmentSchema = z.object({
  sourceStart: z.number(),
  sourceEnd: z.number(),
  outputStart: z.number(),
});

export const zoomTriggerSchema = z.object({
  start: z.number(),
  end: z.number(),
  scale: z.number(),
  sentenceIndex: z.number().int().nonnegative(),
});

export const brollClipSchema = z.object({
  start: z.number(),
  end: z.number(),
  keyword: z.string(),
  assetUrl: z.string(),
  provider: z.enum(['pexels', 'pixabay', 'user']),
  providerId: z.number(),
  width: z.number(),
  height: z.number(),
  credit: z.string(),
  creditUrl: z.string(),
});

export const visualOverlaySchema = z.object({
  start: z.number(),
  end: z.number(),
  layout: z.enum([
    'cutaway',
    'composite',
    'pip',
    'sticker',
    'lockup',
    'chip',
    'banner',
    'split',
    'stat',
  ]),
  mediaKind: z.enum(['video', 'image', 'text']),
  anchor: z
    .enum(['top', 'top_left', 'top_right', 'bottom', 'bottom_left', 'bottom_right'])
    .default('top_right'),
  keyword: z.string(),
  overlayText: z.string(),
  assetUrl: z.string(),
  provider: z.enum(['pexels', 'pixabay', 'generated', 'user']),
  providerId: z.number(),
  width: z.number(),
  height: z.number(),
  credit: z.string(),
  creditUrl: z.string(),
  accentColor: z.string().optional().default('#FFFFFF'),
  textStyle: z.enum(['outline', 'bar', 'chip', 'poster', 'stack']).optional().default('bar'),
  speakerSide: z.enum(['top', 'bottom']).optional(),
});

export const transitionClipSchema = z.object({
  at: z.number(),
  duration: z.number(),
  keyword: z.string(),
  assetUrl: z.string(),
  blend: z.enum(['screen', 'overlay', 'lighten']),
  provider: z.enum(['pexels', 'pixabay', 'generated', 'user']),
  providerId: z.number(),
  width: z.number(),
  height: z.number(),
  credit: z.string(),
  creditUrl: z.string(),
});

export const motionGraphicSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  role: z.enum(['primary', 'secondary', 'accent']).default('primary'),
  shape: z
    .enum(['none', 'underline', 'pill', 'bar', 'block', 'outline_box'])
    .default('underline'),
  accentColor: z.string().default('#FACC15'),
  textColor: z.string().default('#FFFFFF'),
  anchor: z
    .enum([
      'top',
      'top_left',
      'top_right',
      'center',
      'bottom',
      'bottom_left',
      'bottom_right',
    ])
    .default('center'),
  entrance: z
    .enum([
      'spring_up',
      'slide_left',
      'slide_right',
      'scale_pop',
      'fade_blur',
      'type_stagger',
      'mask_wipe',
    ])
    .default('spring_up'),
  exit: z.enum(['fade', 'spring_out', 'slide_away']).default('fade'),
  fontScale: z.number().default(1),
  italic: z.boolean().optional().default(false),
});

export const mediaContainerSchema = z.object({
  start: z.number(),
  end: z.number(),
  mode: z.enum(['inset', 'card', 'rounded_window']).default('inset'),
  canvasColor: z.string().default('#FFFFFF'),
  cornerRadius: z.number().default(36),
  scale: z.number().default(0.78),
  transitionSec: z.number().default(0.55),
  canvasTitle: z.string().optional().default(''),
  canvasTitleColor: z.string().optional().default('#0F172A'),
});

export const semanticEmphasisSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  weight: z.enum(['primary', 'secondary']).default('primary'),
  treatment: z
    .enum(['scale', 'color', 'highlight_shape', 'pop', 'underline'])
    .default('scale'),
  accentColor: z.string().default('#FACC15'),
});

export const captionDirectionSchema = z.object({
  position: z.enum(['bottom', 'lower_third', 'center', 'top']),
  bottomFrac: z.number(),
  textColor: z.string(),
  highlightColor: z.string(),
  boxColor: z.string().nullable(),
  template: captionTemplateSchema.optional(),
});

export const timelineBlueprintSchema = z.object({
  blueprintId: z.string(),
  videoUrl: z.string(),
  languageCode: languageCodeSchema,
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  sourceDurationSec: z.number(),
  outputDurationSec: z.number(),
  captionWords: z.array(captionWordSchema),
  keepSegments: z.array(keepSegmentSchema),
  zoomTriggers: z.array(zoomTriggerSchema),
  brollClips: z.array(brollClipSchema),
  hookTitle: z.string().default(''),
  hookSubtitle: z.string().default(''),
  hookDurationSec: z.number().default(3),
  hookStyle: hookStyleSchema.optional().default('impact'),
  visualOverlays: z.array(visualOverlaySchema).default([]),
  transitions: z.array(transitionClipSchema).default([]),
  motionGraphics: z.array(motionGraphicSchema).default([]),
  mediaContainers: z.array(mediaContainerSchema).default([]),
  semanticEmphasis: z.array(semanticEmphasisSchema).default([]),
  captionDirection: captionDirectionSchema.optional(),
  colorGradeLut: z.string().optional().default(''),
});

export const renderStyleSchema = z.object({
  captionTemplate: captionTemplateSchema,
  layoutStyle: layoutStyleSchema,
  captionBottomFrac: z.number(),
  captionCenterXFrac: z.number(),
  brollEnabled: z.boolean(),
  zoomEnabled: z.boolean(),
  trimEnabled: z.boolean(),
  colorGradeLut: z.string().optional().default(''),
});

export const shortVideoPropsSchema = z.object({
  blueprint: timelineBlueprintSchema,
  style: renderStyleSchema,
});

export type LanguageCode = z.infer<typeof languageCodeSchema>;
export type CaptionTemplateId = z.infer<typeof captionTemplateSchema>;
export type HookStyle = z.infer<typeof hookStyleSchema>;
export type LayoutStyle = z.infer<typeof layoutStyleSchema>;
export type CaptionWord = z.infer<typeof captionWordSchema>;
export type KeepSegment = z.infer<typeof keepSegmentSchema>;
export type ZoomTrigger = z.infer<typeof zoomTriggerSchema>;
export type BRollClip = z.infer<typeof brollClipSchema>;
export type VisualOverlay = z.infer<typeof visualOverlaySchema>;
export type VisualAnchor = VisualOverlay['anchor'];
export type TransitionClip = z.infer<typeof transitionClipSchema>;
export type MotionGraphic = z.infer<typeof motionGraphicSchema>;
export type MediaContainerMoment = z.infer<typeof mediaContainerSchema>;
export type SemanticEmphasis = z.infer<typeof semanticEmphasisSchema>;
export type CaptionDirection = z.infer<typeof captionDirectionSchema>;
export type TimelineBlueprint = z.infer<typeof timelineBlueprintSchema>;
export type RenderStyle = z.infer<typeof renderStyleSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoPropsSchema>;
