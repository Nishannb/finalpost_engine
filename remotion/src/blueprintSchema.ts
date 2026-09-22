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

export const depthOverlayParamsSchema = z.object({
  region: z
    .object({
      y: z.number().min(0).max(0.5).default(0),
      height: z.number().min(0.35).max(0.7).default(0.58),
      fit: z.enum(['fit', 'fill']).default('fill'),
    })
    .default({y: 0, height: 0.58, fit: 'fill'}),
  opacity: z.number().min(0.5).max(1).default(1),
  edgeMask: z
    .object({
      feather: z.number().min(0.15).max(0.25).default(0.22),
      rounded: z.boolean().default(false),
    })
    .default({feather: 0.22, rounded: false}),
  blendMode: z.enum(['normal']).default('normal'),
  animation: z
    .object({
      direction: z.enum(['up', 'down']).default('down'),
      duration: z.number().min(0.2).max(1.15).default(0.75),
      easing: z
        .enum([
          'linear',
          'easeOutCubic',
          'easeInOutCubic',
          'easeOutQuad',
          'easeInCubic',
        ])
        .default('easeInOutCubic'),
      exit: z.boolean().default(false),
    })
    .default({
      direction: 'down',
      duration: 0.75,
      easing: 'easeInOutCubic',
      exit: false,
    }),
});

export const depthOverlayClipSchema = z
  .object({
    type: z.literal('depth_overlay').default('depth_overlay'),
    assetId: z.string().describe('User asset id or stock key'),
    assetUrl: z.string(),
    mediaKind: z.enum(['video', 'image']).default('image'),
    start: z.number(),
    end: z.number(),
    params: depthOverlayParamsSchema,
    reason: z.string().optional().default(''),
    keyword: z.string().optional().default(''),
    provider: z.enum(['pexels', 'pixabay', 'generated', 'user']).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    durationSec: z.number().optional(),
  })
  .describe(
    'Behind-subject overlay: speaker stays on screen, asset sits behind them in the upper half. Not B-roll.',
  );

export const deliveryOperationSchema = z.object({
  id: z.string(),
  op: z.enum([
    'trim_silence',
    'trim_filler',
    'insert_pause',
    'speed_ramp',
    'gain_automation',
    'dynamics_chain',
    'music_ducking',
  ]),
  start: z.number(),
  end: z.number(),
  params: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().default(''),
});

export const timeRemapSegmentSchema = z.object({
  kind: z.enum(['media', 'pause']),
  sourceStart: z.number(),
  sourceEnd: z.number(),
  outputStart: z.number(),
  outputEnd: z.number(),
  rate: z.number(),
});

export const deliveryShapingSchema = z
  .object({
    type: z.literal('delivery_shaping').default('delivery_shaping'),
    start: z.number().default(0),
    end: z.number(),
    intensity: z.enum(['subtle', 'balanced', 'energetic']).default('subtle'),
    preset: z.enum(['natural', 'punchy', 'podcast']).default('natural'),
    seed: z.number().int().optional(),
    useLlmEmphasis: z.boolean().default(false),
    ops: z.array(deliveryOperationSchema).default([]),
    timeRemap: z.object({
      sourceDurationSec: z.number(),
      outputDurationSec: z.number(),
      crossfadeSec: z.number().min(0.005).max(0.02),
      segments: z.array(timeRemapSegmentSchema),
    }),
    acoustic: z
      .array(
        z.object({
          sentenceIndex: z.number().int().nonnegative(),
          start: z.number(),
          end: z.number(),
          pitchMeanHz: z.number(),
          pitchVariance: z.number(),
          energyMeanDb: z.number(),
          energyVariance: z.number(),
          wordsPerSec: z.number(),
          monotonyScore: z.number().min(0).max(1),
          naturalPauseAfterMs: z.number().nonnegative(),
        }),
      )
      .default([]),
    loudnessBefore: z
      .object({integratedLufs: z.number(), truePeakDbtp: z.number()})
      .optional(),
    loudnessAfter: z
      .object({integratedLufs: z.number(), truePeakDbtp: z.number()})
      .optional(),
    summary: z.object({
      timeRemovedSec: z.number(),
      timeAddedSec: z.number(),
      averageSpeed: z.number(),
      operationCount: z.number().int().nonnegative(),
    }),
    reason: z.string().default(''),
  })
  .describe(
    'Delivery Shaping metadata. The A/V proxy was generated from the original source using this deterministic operation list.',
  );

export const insetRevealParamsSchema = z.object({
  insetScale: z.number().min(0.55).max(0.85).default(0.68),
  topMargin: z.number().min(0.03).max(0.12).default(0.06),
  cornerRadius: z.number().min(12).max(56).default(32),
  shadow: z.boolean().default(true),
  transitionIn: z
    .object({duration: z.number().min(0.25).max(0.7).default(0.4)})
    .default({duration: 0.4}),
  transitionOut: z
    .object({duration: z.number().min(0.25).max(0.7).default(0.4)})
    .default({duration: 0.4}),
  easing: z
    .enum([
      'linear',
      'easeInOutCubic',
      'easeOutCubic',
      'easeInCubic',
      'easeOutQuad',
      'spring',
    ])
    .default('easeInOutCubic'),
  background: z
    .object({
      type: z.enum(['solid', 'gradient', 'loop', 'template']).default('solid'),
      value: z.string().default('#111827'),
    })
    .default({type: 'solid', value: '#111827'}),
  captions: z
    .object({
      enabled: z.boolean().default(true),
      position: z.literal('below_video').default('below_video'),
      maxLines: z.number().int().min(1).max(4).default(3),
    })
    .default({enabled: true, position: 'below_video', maxLines: 3}),
  variant: z.enum(['simple', 'motion_graphic']).default('simple'),
  graphic: z
    .object({
      templateId: z.enum(['stat_callout', 'keyword_title']).default('keyword_title'),
      text: z.string().optional().default(''),
      data: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      enterOffset: z.number().min(-0.35).max(0.35).default(-0.12),
      exitOffset: z.number().min(-0.35).max(0.35).default(0.12),
    })
    .optional(),
});

export const insetRevealClipSchema = z
  .object({
    type: z.literal('inset_reveal').default('inset_reveal'),
    start: z.number(),
    end: z.number(),
    params: insetRevealParamsSchema,
    reason: z.string().optional().default(''),
  })
  .describe(
    'Inset Scale Reveal: the talking-head shrinks into a card over a colored background with captions below, then restores. Not B-roll and not depth_overlay.',
  );

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
  durationSec: z.number().optional(),
});

export const visualOverlaySchema = z.object({
  start: z.number(),
  end: z.number(),
  layout: z.enum([
    'cutaway',
    'composite',
    'pip',
    'sticker',
    'card',
    'lockup',
    'chip',
    'banner',
    'split',
    'stat',
    'cutout',
    'bubble',
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
  textStyle: z.enum(['outline', 'bar', 'chip', 'poster', 'stack', 'bubble']).optional().default('bar'),
  speakerSide: z.enum(['top', 'bottom']).optional(),
  treatment: z
    .enum(['card', 'scroll', 'suspense', 'focus', 'stack', 'float', 'wipe', 'slideshow'])
    .optional()
    .default('card'),
  cornerRadius: z.number().optional().default(28),
  glow: z.boolean().optional().default(true),
  focusRegion: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      label: z.string().optional(),
    })
    .nullable()
    .optional(),
  scrollAxis: z.enum(['y', 'x', 'none']).optional().default('none'),
  staggerIndex: z.number().optional().default(0),
  visualWeight: z.enum(['accent', 'hero']).optional().default('accent'),
  slides: z
    .array(
      z.object({
        assetUrl: z.string(),
        provider: z.enum(['pexels', 'pixabay', 'generated', 'user']),
        providerId: z.number(),
        width: z.number(),
        height: z.number(),
        credit: z.string(),
        creditUrl: z.string(),
      }),
    )
    .optional()
    .default([]),
  slideTransition: z.enum(['crossfade', 'ken_burns']).optional().default('crossfade'),
  assetDurationSec: z.number().optional().default(0),
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
    .enum(['none', 'underline', 'pill', 'bar', 'block', 'outline_box', 'bubble'])
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
      'highlight_type',
      'slide_from_edge',
    ])
    .default('spring_up'),
  exit: z.enum(['fade', 'spring_out', 'slide_away']).default('fade'),
  fontScale: z.number().default(1),
  italic: z.boolean().optional().default(false),
});

export const mediaContainerSchema = z.object({
  start: z.number(),
  end: z.number(),
  mode: z.enum(['inset', 'card', 'rounded_window', 'pip_corner']).default('inset'),
  canvasColor: z.string().default('#111418'),
  cornerRadius: z.number().default(36),
  scale: z.number().default(0.62),
  transitionSec: z.number().default(1),
  canvasTitle: z.string().optional().default(''),
  canvasTitleColor: z.string().optional().default('#0F172A'),
  pipAnchor: z
    .enum(['top', 'top_left', 'top_right', 'bottom', 'bottom_left', 'bottom_right'])
    .optional(),
});

export const frameInsetSchema = z.object({
  start: z.number(),
  end: z.number(),
  /** Final picture scale (0.70–0.94). Director chooses how far to retract. */
  scale: z.number().default(0.86),
  marginColor: z.string().default('#000000'),
  cornerRadius: z.number().optional().default(18),
  transitionSec: z.number().optional().default(0.9),
});

export const semanticEmphasisSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  weight: z.enum(['primary', 'secondary']).default('primary'),
  treatment: z
    .enum(['scale', 'color', 'highlight_shape', 'pop', 'underline', 'count', 'type_reveal'])
    .default('scale'),
  accentColor: z.string().default('#FACC15'),
  anchor: z
    .enum(['top', 'top_left', 'top_right', 'bottom', 'bottom_left', 'bottom_right'])
    .optional()
    .default('top_right'),
  countFrom: z.number().optional(),
  countTo: z.number().optional(),
  countSuffix: z.string().optional().default(''),
  textColor: z.string().optional(),
});

export const captionDirectionSchema = z.object({
  position: z.enum(['bottom', 'lower_third', 'center', 'top']),
  bottomFrac: z.number(),
  textColor: z.string().optional(),
  highlightColor: z.string().optional(),
  boxColor: z.string().nullable().optional(),
  template: captionTemplateSchema.optional(),
  fontScale: z.number().optional(),
  animation: z
    .enum(['highlight', 'karaoke', 'scale', 'bounce', 'box', 'pop', 'type'])
    .optional(),
  uppercase: z.boolean().optional(),
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
  depthOverlays: z.array(depthOverlayClipSchema).default([]),
  insetReveals: z.array(insetRevealClipSchema).default([]),
  deliveryShaping: deliveryShapingSchema.optional(),
  originalVideoUrl: z.string().optional(),
  hookTitle: z.string().default(''),
  hookSubtitle: z.string().default(''),
  hookDurationSec: z.number().default(3),
  hookStartSec: z.number().optional().default(0),
  hookStyle: hookStyleSchema.optional().default('impact'),
  hookAnchor: z
    .enum(['top', 'top_left', 'top_right', 'bottom', 'bottom_left', 'bottom_right'])
    .optional()
    .default('top_right'),
  visualOverlays: z.array(visualOverlaySchema).default([]),
  transitions: z.array(transitionClipSchema).default([]),
  motionGraphics: z.array(motionGraphicSchema).default([]),
  mediaContainers: z.array(mediaContainerSchema).default([]),
  frameInsets: z.array(frameInsetSchema).default([]),
  semanticEmphasis: z.array(semanticEmphasisSchema).default([]),
  speakerCutout: z
    .object({
      available: z.boolean(),
      keyColor: z.string(),
      similarity: z.number(),
      blend: z.number(),
      videoUrl: z.string().optional(),
      speaker: z
        .object({
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
        })
        .optional(),
    })
    .optional(),
  captionDirection: captionDirectionSchema.optional(),
  colorGradeLut: z.string().optional().default(''),
  audioDesign: z
    .object({
      musicMood: z.string().optional(),
      ducking: z.boolean().optional(),
      sfx: z
        .array(
          z.object({
            atWordId: z.string(),
            kind: z.string(),
            intent: z.string(),
          }),
        )
        .optional()
        .default([]),
      hits: z
        .array(
          z.object({
            at: z.number(),
            kind: z.enum(['whoosh', 'hit', 'pop']),
            volume: z.number().optional(),
            reason: z.string().optional(),
          }),
        )
        .optional()
        .default([]),
    })
    .optional(),
  northStarDesign: z
    .object({
      enabled: z.literal(true),
      contentType: z.enum([
        'educational_tips',
        'story',
        'sales_pitch',
        'opinion',
        'tutorial',
        'announcement',
        'testimonial',
        'comedy',
        'other',
      ]),
      displayFont: z.enum(['bebas', 'oswald', 'playfair', 'space_grotesk']),
      primaryColor: z.string(),
      secondaryColor: z.string(),
      inkColor: z.string(),
      surfaceColor: z.string(),
      motionPreset: z.enum(['kinetic', 'editorial', 'modular', 'documentary']),
      cornerRadius: z.number(),
      density: z.enum(['restrained', 'balanced', 'expressive']),
    })
    .optional(),
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
export type DepthOverlayClip = z.infer<typeof depthOverlayClipSchema>;
export type DepthOverlayParams = z.infer<typeof depthOverlayParamsSchema>;
export type DeliveryOperation = z.infer<typeof deliveryOperationSchema>;
export type DeliveryShapingClip = z.infer<typeof deliveryShapingSchema>;
export type InsetRevealClip = z.infer<typeof insetRevealClipSchema>;
export type InsetRevealParams = z.infer<typeof insetRevealParamsSchema>;
export type VisualOverlay = z.infer<typeof visualOverlaySchema>;
export type VisualAnchor = VisualOverlay['anchor'];
export type TransitionClip = z.infer<typeof transitionClipSchema>;
export type MotionGraphic = z.infer<typeof motionGraphicSchema>;
export type MediaContainerMoment = z.infer<typeof mediaContainerSchema>;
export type FrameInset = z.infer<typeof frameInsetSchema>;
export type SemanticEmphasis = z.infer<typeof semanticEmphasisSchema>;
export type CaptionDirection = z.infer<typeof captionDirectionSchema>;
export type NorthStarDesign = NonNullable<
  z.infer<typeof timelineBlueprintSchema>['northStarDesign']
>;
export type TimelineBlueprint = z.infer<typeof timelineBlueprintSchema>;
export type RenderStyle = z.infer<typeof renderStyleSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoPropsSchema>;
