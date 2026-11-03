/**
 * Runtime schema for the composition's input props.
 *
 * This intentionally duplicates the server's `types/blueprint.ts`: because the
 * payload arrives over the wire into a Lambda, validating it here turns a
 * malformed blueprint into a clear schema error instead of a black MP4. It also
 * gives Remotion Studio editable controls for the whole timeline.
 */

import {renderSpecSchema} from './kinetic/spec';
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
  // Plans saved before per-zoom scale carry the configured default (1.25); the engine only emits 1.05–1.6.
  scale: z.number().min(1).max(2),
  focus: z.object({x: z.number().min(0).max(1), y: z.number().min(0).max(1)}).optional(),
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

/**
 * Text between the footage and the speaker. Renders ONLY when a real foreground matte (an alpha video of the speaker) exists and the engine verified it;
 * with no matte the track draws nothing and the plan must carry a fallback instead. Never a pretend-depth effect.
 */
export const behindSubjectTextSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string().min(1).max(60),
  /** Vertical centre of the text block, as a fraction of the frame height. */
  centerY: z.number().min(0.08).max(0.92).default(0.3),
  /** Text block width as a fraction of the frame width. */
  widthFrac: z.number().min(0.4).max(0.96).default(0.9),
  heightFrac: z.number().min(0.08).max(0.5).default(0.2),
  color: z.string().default('#FFFFFF'),
  strokeColor: z.string().optional(),
  font: z.enum(['display', 'body']).default('display'),
  curvature: z.number().min(-1).max(1).default(0),
  reveal: z.enum(['none', 'fade', 'chars', 'sweep']).default('fade'),
  reason: z.string().optional().default(''),
});

/**
 * The art-directed opening: one short phrase, designed for timestamp zero. Fully legible on the very first frame (the animation only adds an accent
 * sweep, a settle and an exit), so a paused first frame is already a finished composition. `plan` carries the Director's reasoning for the ledger.
 * Replaces the standard hook title when present.
 */
export const explainerLayoutSpanSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  layout: z.enum(['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d']),
});

export const explainerClaimBeatSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  /** The key phrase that gets the lime wipe (a number / amount beats a name). */
  phrase: z.string(),
  phraseStart: z.number().min(0),
  phraseEnd: z.number().min(0),
  kind: z.string().optional(),
  /** The spoken line around the phrase (the article plate's body text). */
  context: z.string().optional(),
});

export const impactFxSchema = z.object({
  flashes: z.array(z.object({startSec: z.number().min(0), frames: z.number().int().min(1).max(2), reason: z.enum(['hook_word', 'major_reveal'])})).default([]),
  satPops: z.array(z.object({startSec: z.number().min(0), frames: z.number().int().min(2).max(4)})).default([]),
  punchIns: z.array(z.object({startSec: z.number().min(0), endSec: z.number().min(0), rampFrames: z.number().int().min(6).max(8), scale: z.number().min(1).max(1.1)})).default([]),
  bwSpans: z.array(z.object({startSec: z.number().min(0), endSec: z.number().min(0)})).default([]),
});

export const openingTreatmentSchema = z.object({
  text: z.string().min(1).max(40),
  kind: z.enum(['plain', 'curved', 'layered', 'mask_reveal']).default('plain'),
  /** mask_reveal: [lead, rest]. `lead` is fully visible from frame 0; `rest` is revealed through the `textReveal` clip animation (the text itself is masked). */
  lines: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  textReveal: z.enum(['wipe-right', 'wipe-left', 'wipe-up', 'wipe-down', 'iris', 'slit']).optional(),
  curve: z
    .object({
      shape: z.enum(['arc', 'circle', 'path']).default('arc'),
      curvature: z.number().min(-1).max(1).default(0.35),
      direction: z.enum(['clockwise', 'counterclockwise']).default('clockwise'),
      rotationDeg: z.number().min(-30).max(30).default(0),
    })
    .optional(),
  /** Plain titles only: the animation of the accent bar under the text (the text itself is not masked). */
  accentReveal: z.enum(['wipe-right', 'wipe-left', 'wipe-up', 'wipe-down', 'iris', 'slit']).optional(),
  centerY: z.number().min(0.06).max(0.9).default(0.14),
  widthFrac: z.number().min(0.4).max(0.96).default(0.86),
  heightFrac: z.number().min(0.06).max(0.4).default(0.16),
  align: z.enum(['left', 'center', 'right']).default('center'),
  font: z.enum(['display', 'body']).default('display'),
  weight: z.number().min(400).max(900).default(900),
  textColor: z.string().default('#FFFFFF'),
  accentColor: z.string().default('#FACC15'),
  strokeColor: z.string().optional(),
  panel: z.object({color: z.string(), opacity: z.number().min(0).max(1)}).optional(),
  startSec: z.number().default(0),
  durationSec: z.number().min(1).max(6).default(3),
  plan: z.record(z.string(), z.string()).default({}),
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
    userBrollId: z.string().optional(),
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
  // The planner and the renderer's motion both clamp these to 0.55–1.2 s (default 0.9); the schema must accept that range.
  transitionIn: z
    .object({duration: z.number().min(0.25).max(1.2).default(0.4)})
    .default({duration: 0.4}),
  transitionOut: z
    .object({duration: z.number().min(0.25).max(1.2).default(0.4)})
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
  userBrollId: z.string().optional(),
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
  provider: z.enum(['pexels', 'pixabay', 'generated', 'user', 'klipy']),
  providerId: z.number(),
  userBrollId: z.string().optional(),
  width: z.number(),
  height: z.number(),
  credit: z.string(),
  creditUrl: z.string(),
  /** WP19: image_story motion recipe for the card entrance (logo_slam, sticker_pop, still_push_in, card_tilt_in). */
  recipeId: z.string().optional(),
  /** WP42: planner tag. `explainer_b` / `explainer_c` / `explainer_d` = the media of that Skill B layout span (ShortVideo draws it inside the layout, never as a free overlay). Absent on everything else. */
  intent: z.string().optional(),
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
        provider: z.enum(['pexels', 'pixabay', 'generated', 'user', 'klipy']),
        providerId: z.number(),
        userBrollId: z.string().optional(),
        width: z.number(),
        height: z.number(),
        credit: z.string(),
        creditUrl: z.string(),
      }),
    )
    .optional()
    .default([]),
  // SlideshowPlate has exactly one behaviour: slides crossfade, each with a slow Ken Burns zoom. The schema used to also
  // accept 'ken_burns', which no producer emits and no renderer path distinguishes, so it was accepted and ignored.
  slideTransition: z.literal('crossfade').optional().default('crossfade'),
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
  renderGenerated: z.boolean().optional(),
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
  /** WP12C: 'blur_self' paints a blurred, dimmed copy of the picture behind the sharp window (the framed talking-head pacing beat); 'solid' (default) the flat canvas colour. */
  canvasStyle: z.enum(['solid', 'blur_self']).default('solid'),
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

/** Frame-relative box (0–1). Remotion turns it into pixels. */
export const normalizedBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

/**
 * How a generated graphic participates in the frame. Never pixels: the split
 * ratio and box rounding belong to Remotion, so new modes can be added later.
 */
export const generatedGraphicPlacementSchema = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('full_screen')}),
  z.object({
    mode: z.literal('split_screen'),
    /** Top/bottom only. The talking head takes the other half. */
    graphicSide: z.enum(['top', 'bottom']),
  }),
  z.object({
    mode: z.literal('overlay'),
    /** Transparent layer over the picture; whole frame when omitted. */
    box: normalizedBoxSchema.optional(),
  }),
  z.object({mode: z.literal('pip'), box: normalizedBoxSchema}),
]);

export const generatedGraphicSchema = z
  .object({
    id: z.string(),
    start: z.number(),
    end: z.number(),
    placement: generatedGraphicPlacementSchema,
    /** Compiled CommonJS module, content-addressed (R2 URL or prefetched path). */
    module: z.object({
      url: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    /** Passed to the graphic as-is (content, theme, safeArea, assets, …). */
    props: z.record(z.string(), z.unknown()).default({}),
    /** The Director's request, kept for traceability. Not read by the renderer. */
    brief: z
      .object({
        kind: z.string().optional(),
        purpose: z.string().optional(),
        visualIntent: z.string().optional(),
      })
      .optional(),
  })
  .describe(
    'Generated motion graphic: a runtime-loaded Remotion component drawn live in the timeline. Separate from B-roll.',
  );

export const captionDirectionSchema = z.object({
  position: z.enum(['bottom', 'lower_third', 'center', 'top']),
  bottomFrac: z.number(),
  textColor: z.string().optional(),
  highlightColor: z.string().optional(),
  boxColor: z.string().nullable().optional(),
  template: captionTemplateSchema.optional(),
  fontScale: z.number().optional(),
  /** WP32: most words a caption line shows at once (default 3); polish bare type uses 2. */
  maxWords: z.number().int().min(1).max(6).optional(),
  animation: z
    .enum(['highlight', 'karaoke', 'scale', 'bounce', 'box', 'pop', 'type'])
    .optional(),
  uppercase: z.boolean().optional(),
  /** WP13C: type treatment from the short-form look (see server shortFormLook.ts). */
  strokeColor: z.string().optional(),
  strokeWidthEm: z.number().optional(),
  glow: z.boolean().optional(),
  activeStyle: z.enum(['fill', 'marker']).optional(),
  activeInk: z.string().optional(),
  /**
   * WP34: `word_by_word_accumulate` = the Metromedia caption grammar: words build up in spoken order (blur-fade in, 4 frames), the line hard-clears on the next cut, <= 4 words, ~7 % of the
   * composition height, centred at y 42-50 %, sentence case, white with a soft shadow, no pill. Absent = the template's own (replace / karaoke) captions, exactly as before.
   */
  mode: z.enum(['word_by_word_accumulate', 'chunk_swap']).optional(),
  /** WP34: output-time seconds of the cuts (VO cut grammar); a line never straddles one and clears on the first cut after it starts. */
  cutTimes: z.array(z.number()).max(4000).optional(),
  /** WP34: font size as a percent of the composition height (grammar 7). */
  sizePctFrameH: z.number().min(3).max(12).optional(),
  /** WP34: vertical centre of the line as a fraction of the composition height (grammar 0.42-0.50). */
  centerYFrac: z.number().min(0.42).max(0.5).optional(),
  /** WP38: classic talking-head polish only: the accumulate line centre when a face is on screen (fraction of the height, 0.55-0.60). Absent = `centerYFrac` (the WP34 band). */
  faceSafeYFrac: z.number().min(0.55).max(0.6).optional(),
  /** WP34: the ONLY words (besides figures) drawn in caps: the CTA keyword. */
  capsWords: z.array(z.string()).max(40).optional(),
  /**
   * WP41: the Explainer (Skill B) chunk-swap mode shares `mode` (`'chunk_swap'`: 1-3 word chunks that REPLACE each other, thick black stroke, no accumulate / karaoke). `cutTimes` keeps a chunk from
   * straddling a layout cut and `sizePctFrameH` / `maxWords` / `capsWords` keep their meaning; `yTrack` is the caption centre y by layout span (B seam 0.50, A / C / D 0.75), which `centerYFrac`'s
   * accumulate-only band cannot express.
   */
  yTrack: z.array(z.object({start: z.number(), end: z.number(), yFrac: z.number().min(0.05).max(0.95)})).max(400).optional(),
});

/**
 * The shared design object (`DesignTokens`). The same shape is used by the legacy key (`northStarDesign`, strict as before) and by the new key
 * (`designTokens`, lenient: an unusable value reads as absent instead of failing the whole parse). NOTE: a render does not apply this schema to its
 * input props (measured in Phase 31), so `resolveDesignTokens` in lib/designTokens.ts is the real validation.
 */
export const designTokensSchema = z.object({
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
});

/**
 * SUBJECT STAGE (style `subject_stage`, Phase 2 contract): the speaker (RVM matte) is a fixed identity layer; every span below describes the stage BEHIND her (S1 full plate, S2 opaque card, S3 ghost scroll,
 * S4 neutral + accents) or, for S5, a layer IN FRONT of her. Output-time seconds. Optional: absent = nothing is drawn and ShortVideo is unchanged.
 */
export const subjectStageIdSchema = z.enum(['S1', 'S2', 'S3', 'S4', 'S5']);
export const subjectStageAssetSchema = z.object({
  /** https URL (image / video). Omitted for a native generated asset. */
  url: z.string().optional(),
  kind: z.enum(['image', 'video', 'native']),
  /** native assets only: the generated plate / quote card / tall result page. */
  nativeKind: z.enum(['plate', 'quote_card', 'result_page']).optional(),
  /** quote_card text. */
  text: z.string().max(280).optional(),
  /** result_page lines (a tall page of stacked lines drawn from the transcript's own words). */
  lines: z.array(z.string().max(120)).max(24).optional(),
});
export const subjectStageMotionSchema = z.object({
  kind: z.enum(['none', 'slow_push', 'auto_scroll', 'slide_up_front']),
  /** auto_scroll speed, percent of the frame height per second (spec 15-20). */
  pctPerSec: z.number().min(0).max(60).optional(),
  /** slow_push total scale gain in percent (spec 4-6). */
  scalePct: z.number().min(0).max(20).optional(),
});
export const subjectStageSpanSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    stage: subjectStageIdSchema,
    asset: subjectStageAssetSchema.optional(),
    /** behind-layer opacity override (S3 default 0.5). */
    opacity: z.number().min(0).max(1).optional(),
    motion: subjectStageMotionSchema.default({kind: 'none'}),
    /** S2 card box (percent of the frame): x centre, y top, width, height. */
    placement: z.object({xPct: z.number(), yPct: z.number(), wPct: z.number().min(5).max(100), hPct: z.number().min(5).max(100).optional()}).optional(),
    enter: z.enum(['hard_cut', 'flash_cut', 'slide_up_front']).default('hard_cut'),
    wash: z.enum(['warm', 'none']).optional(),
  })
  .refine(span => span.end > span.start, {message: 'subjectStage span must end after it starts'});
export const subjectStageAccentSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    kind: z.enum(['pop_in', 'drop_in_tilt', 'text_stack']),
    lines: z.array(z.string().max(60)).max(6).optional(),
    /** seconds since `start` at which each line of a text_stack is appended (the next keyword). */
    lineStarts: z.array(z.number().min(0)).max(6).optional(),
    /** stable slot (0 top-left, 1 top-right, 2 top-centre) so a repeated accent keeps its place. */
    slot: z.number().int().min(0).max(2).default(0),
  })
  .refine(accent => accent.end > accent.start, {message: 'subjectStage accent must end after it starts'});
export const subjectStageSchema = z.object({
  version: z.literal(1),
  styleId: z.literal('subject_stage'),
  /** person-only alpha video (RVM VP9 yuva WebM), same timebase as the source, played through the keep segments. */
  matteUrl: z.string(),
  /** room treatment under the person: DIM only (15-20 %). blurPx is accepted for back-compat but the renderer never applies spatial blur under the cutout (it creates a double-body ghost). */
  bg: z.object({blurPx: z.number().min(0).max(40), dimPct: z.number().min(0).max(60)}).default({blurPx: 0, dimPct: 18}),
  spans: z.array(subjectStageSpanSchema).default([]),
  accents: z.array(subjectStageAccentSchema).default([]),
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
  behindSubjectTexts: z.array(behindSubjectTextSchema).default([]),
  openingTreatment: openingTreatmentSchema.optional(),
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
  generatedGraphics: z.array(generatedGraphicSchema).default([]),
  /** WP11A: time ranges the caption layer is muted for (a graphic owns the spoken words there). Restored after each range. */
  /** WP13B: black-and-white grade-flip beats on the talking head (a pacing reset). */
  gradeBeats: z.array(z.object({startSec: z.number(), endSec: z.number()})).default([]),
  /** WP35: Metromedia impact FX: overexpose flashes (1-2 f), saturation glow pops (2-4 f), money punch-ins (1.10 over 6-8 f) and black-and-white grade spans. Absent = none. */
  impactFx: impactFxSchema.optional(),
  /** WP42: Skill B (Explainer) layout track: hard-cut spans A / B / C / D that tile the runtime (explainerLayouts.ts). Absent = the classic picture stack, untouched. */
  explainerLayoutTrack: z.array(explainerLayoutSpanSchema).optional(),
  /** WP42: Skill B claim beats (a spoken number / name over a plain talking head): the article plate on layout B + the lime wipe on the key phrase. */
  explainerClaimBeats: z.array(explainerClaimBeatSchema).optional(),
  /** WP44: content-aware edit palette (accent/ground). Preferred skill colours are defaults, not locks. */
  editPalette: z
    .object({
      id: z.string(),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      ground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      groundDot: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      groundStyle: z.enum(['paper_dot', 'ink_black', 'soft_gray', 'none']),
      text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      inkOnAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      reason: z.string(),
    })
    .optional(),
  /** WP44: Skill D newsroom MG layout track (plan first; mount follow-up). */
  newsroomLayoutTrack: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        layout: z.enum(['newsroom_gfx', 'newsroom_card', 'newsroom_host', 'newsroom_expert']),
      }),
    )
    .optional(),
  captionMuteRanges: z.array(z.object({startSec: z.number(), endSec: z.number()})).default([]),
  // WP55 phase 2: person foreground above kinetic environmental type (output-time spans); optional, absent = nothing is drawn
  subjectForeground: z.object({videoUrl: z.string(), spans: z.array(z.object({start: z.number(), end: z.number()}))}).optional(),
  // KINETIC TYPE (3D kinetic typography engine): a solved RenderSpec (frame-exact keyframes); optional, absent = nothing is drawn and the picture is unchanged
  kinetic: renderSpecSchema.optional(),
  // SUBJECT STAGE (style subject_stage): stages behind / in front of the person; optional, absent = nothing is drawn and the picture is unchanged
  subjectStage: subjectStageSchema.optional(),
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
  /** WP2B: legibility instructions written only by the `mvp` product profile. Absent = every renderer path below behaves exactly as before. */
  /** WP3F: whether the source had audio (mvp profile only). Recording only; nothing in the renderer reads it. */
  sourceHasAudio: z.boolean().optional(),
  /** WP3B: facts for the offline scorer (mvp profile only). Recording only; nothing in the renderer reads it. */
  evidence: z
    .object({
      version: z.literal(1),
      plannerMinGapSec: z.number(),
      plannerMinGapAppliesTo: z.literal('cutaway_clips'),
      hookTitlePolicy: z.enum(['placeholder', 'optional']),
    })
    .optional(),
  legibility: z
    .object({
      version: z.literal(1),
      hook: z
        .object({
          sizeFrac: z.number(),
          widthFrac: z.number(),
          topFrac: z.number(),
          heightFrac: z.number(),
          lines: z.number(),
          inkColor: z.string(),
          accentColor: z.string(),
          plateColor: z.string(),
          clearBand: z.boolean(),
          shortened: z.boolean(),
        })
        .optional(),
      captions: z.object({
        avoidSplitFace: z.literal(true),
        splitBoxColor: z.string(),
        splitTextColor: z.string(),
        splitHighlightColor: z.string(),
        splitPlateColor: z.string(),
        /** WP3U: frames the split caption placement is held before/after a B-roll split (blueprint fps). Absent = instant switch. */
        splitHoldFrames: z.number().int().min(0).optional(),
        /**
         * WP8G: opt-in ONLY. The full-width dark band behind outline-style captions on talking-head footage (WP4D) is OFF unless this is exactly true. Nothing in the engine writes it; a split
         * layout's own plate (`splitCaptions.plate`) is not controlled by it.
         */
        backingPlate: z.boolean().optional(),
      }),
    })
    .optional(),
  colorGradeLut: z.string().optional().default(''),
  audioDesign: z
    .object({
      musicMood: z.string().optional(),
      musicUrl: z.string().optional(),
      musicGain: z.number().optional(),
      duckedGain: z.number().optional(),
      ducking: z.boolean().optional(),
      musicSource: z.enum(['licensed', 'generated']).optional(),
      musicBpm: z.number().optional(),
      voLufs: z.number().optional(),
      duck: z.object({
        preset: z.enum(['talking', 'default', 'legacy_brief']),
        speechDb: z.number(),
        pauseDb: z.number(),
        openDb: z.number(),
        attackSec: z.number(),
        holdSec: z.number(),
        releaseSec: z.number(),
        phrases: z.array(z.object({start: z.number(), end: z.number()})),
        durationSec: z.number(),
        voLufs: z.number().optional(),
        bedLufs: z.number().optional(),
      }).optional(),
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
  northStarDesign: designTokensSchema.optional(),
  designTokens: designTokensSchema.optional().catch(undefined),
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
  /** false renders no generated motion graphics (the modules are not even fetched). Absent = enabled. */
  generatedGraphicsEnabled: z.boolean().optional(),
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
export type SubjectStage = z.infer<typeof subjectStageSchema>;
export type SubjectStageSpan = z.infer<typeof subjectStageSpanSchema>;
export type SubjectStageAccent = z.infer<typeof subjectStageAccentSchema>;
export type SubjectStageAsset = z.infer<typeof subjectStageAssetSchema>;
export type ImpactFxSpec = z.infer<typeof impactFxSchema>;
export type ExplainerLayoutSpan = z.infer<typeof explainerLayoutSpanSchema>;
export type ExplainerClaimBeat = z.infer<typeof explainerClaimBeatSchema>;
export type OpeningTreatmentSpec = z.infer<typeof openingTreatmentSchema>;
export type BehindSubjectText = z.infer<typeof behindSubjectTextSchema>;
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
export type GeneratedGraphic = z.infer<typeof generatedGraphicSchema>;
export type GeneratedGraphicPlacement = z.infer<typeof generatedGraphicPlacementSchema>;
export type CaptionDirection = z.infer<typeof captionDirectionSchema>;
export type NorthStarDesign = NonNullable<
  z.infer<typeof timelineBlueprintSchema>['northStarDesign']
>;

/** Neutral name for `NorthStarDesign` (Phase 30, Step 2): a pure type alias, same type and same JSON key. Shared readers use this name. */
export type DesignTokens = NorthStarDesign;
export type TimelineBlueprint = z.infer<typeof timelineBlueprintSchema>;
export type RenderStyle = z.infer<typeof renderStyleSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoPropsSchema>;
