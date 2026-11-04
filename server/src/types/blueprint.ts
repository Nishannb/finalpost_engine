/**
 * Timeline Blueprint — the single contract between the AI layer (this server),
 * the mobile preview, and the Remotion renderer.
 *
 * Time bases matter and are encoded in field names:
 *  - `source*` fields are seconds in the original uploaded file.
 *  - everything else is seconds in the OUTPUT timeline (after silence cuts),
 *    which is what the player and the renderer draw against.
 */

export const SUPPORTED_LANGUAGES = ['en', 'es', 'hi', 'ta', 'ne', 'auto'] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const CAPTION_TEMPLATES = [
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
export type CaptionTemplateId = (typeof CAPTION_TEMPLATES)[number];

export const OVERLAY_TEXT_STYLES = ['outline', 'bar', 'chip', 'poster', 'stack', 'bubble'] as const;
export type OverlayTextStyle = (typeof OVERLAY_TEXT_STYLES)[number];

export const LAYOUT_STYLES = ['fullscreen', 'podcastSplit'] as const;
export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

/** One word with ASR timings, in source time. */
export type WordToken = {
  text: string;
  start: number;
  end: number;
};

/** Word remapped onto the output timeline, used for caption rendering. */
export type CaptionWord = {
  text: string;
  start: number;
  end: number;
  /** Index of the sentence this word belongs to (drives line grouping). */
  sentenceIndex: number;
};

export type TimeRange = {
  start: number;
  end: number;
};

/**
 * A slice of the source that survives silence removal.
 * `outputStart` is where it lands on the output timeline.
 */
export type KeepSegment = {
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
};

export type ZoomTrigger = {
  /** Output-time window the punch-in covers. */
  start: number;
  end: number;
  scale: number;
  /**
   * Optional point to zoom toward, normalized to the frame: x 0 = left edge, 1 = right edge; y 0 = top, 1 = bottom.
   * Absent: the legacy punch-in about 50% / 32%. The renderer keeps this point on screen and recentres it as far as
   * the frame edges allow.
   */
  focus?: {x: number; y: number};
  /** Sentence the zoom belongs to, for debugging blueprints. */
  sentenceIndex: number;
};

export type BRollClip = {
  /** Output-time window the overlay occupies. */
  start: number;
  end: number;
  keyword: string;
  assetUrl: string;
  provider: 'pexels' | 'pixabay' | 'user';
  providerId: number;
  /** WP3B (mvp profile only): the supplied creator asset id (`ub_<n>`) this placement shows. Recording only. */
  userBrollId?: string;
  width: number;
  height: number;
  /** Attribution — stock licence requires crediting the author when shown. */
  credit: string;
  creditUrl: string;
  durationSec?: number;
};

export const DEPTH_OVERLAY_DIRECTIONS = ['up', 'down'] as const;
export type DepthOverlayDirection = (typeof DEPTH_OVERLAY_DIRECTIONS)[number];

export const DEPTH_OVERLAY_FITS = ['fit', 'fill'] as const;
export type DepthOverlayFit = (typeof DEPTH_OVERLAY_FITS)[number];

export const DEPTH_OVERLAY_EASINGS = [
  'linear',
  'easeOutCubic',
  'easeInOutCubic',
  'easeOutQuad',
  'easeInCubic',
] as const;
export type DepthOverlayEasing = (typeof DEPTH_OVERLAY_EASINGS)[number];

export type DepthOverlayParams = {
  region: {y: number; height: number; fit: DepthOverlayFit};
  opacity: number;
  edgeMask: {feather: number; rounded: boolean};
  blendMode: 'normal';
  animation: {
    direction: DepthOverlayDirection;
    duration: number;
    easing: DepthOverlayEasing;
    exit: boolean;
  };
};

/**
 * Behind-subject overlay. Separate from B-roll: the speaker stays on screen
 * and the asset sits behind them in the upper half.
 *
 * `{ type: "depth_overlay", assetId, start, end, params }` — older blueprints
 * omit this array.
 */
export type DepthOverlayClip = {
  type: 'depth_overlay';
  assetId: string;
  assetUrl: string;
  mediaKind: 'video' | 'image';
  start: number;
  end: number;
  params: DepthOverlayParams;
  reason?: string;
  keyword?: string;
  provider?: 'pexels' | 'pixabay' | 'generated' | 'user';
  width?: number;
  height?: number;
};

export type TimeRemapSegment = {
  kind: 'media' | 'pause';
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
  rate: number;
};

export type DeliveryOperation = {
  id: string;
  op:
    | 'trim_silence'
    | 'trim_filler'
    | 'insert_pause'
    | 'speed_ramp'
    | 'gain_automation'
    | 'dynamics_chain'
    | 'music_ducking';
  start: number;
  end: number;
  params: Record<string, unknown>;
  reason: string;
};

export type DeliveryShapingClip = {
  type: 'delivery_shaping';
  start: number;
  end: number;
  intensity: 'subtle' | 'balanced' | 'energetic';
  preset: 'natural' | 'punchy' | 'podcast';
  seed?: number;
  useLlmEmphasis: boolean;
  ops: DeliveryOperation[];
  timeRemap: {
    sourceDurationSec: number;
    outputDurationSec: number;
    crossfadeSec: number;
    segments: TimeRemapSegment[];
  };
  acoustic: Array<{
    sentenceIndex: number;
    start: number;
    end: number;
    pitchMeanHz: number;
    pitchVariance: number;
    energyMeanDb: number;
    energyVariance: number;
    wordsPerSec: number;
    monotonyScore: number;
    naturalPauseAfterMs: number;
  }>;
  loudnessBefore?: {integratedLufs: number; truePeakDbtp: number};
  loudnessAfter?: {integratedLufs: number; truePeakDbtp: number};
  summary: {
    timeRemovedSec: number;
    timeAddedSec: number;
    averageSpeed: number;
    operationCount: number;
  };
  reason: string;
};

export const INSET_REVEAL_VARIANTS = ['simple', 'motion_graphic'] as const;
export type InsetRevealVariant = (typeof INSET_REVEAL_VARIANTS)[number];

export const INSET_BACKGROUND_TYPES = ['solid', 'gradient', 'loop', 'template'] as const;
export type InsetBackgroundType = (typeof INSET_BACKGROUND_TYPES)[number];

export const INSET_EASINGS = [
  'linear',
  'easeInOutCubic',
  'easeOutCubic',
  'easeInCubic',
  'easeOutQuad',
  'spring',
] as const;
export type InsetEasing = (typeof INSET_EASINGS)[number];

export type InsetBackground = {
  type: InsetBackgroundType;
  value: string;
};

export type InsetGraphic = {
  templateId: 'stat_callout' | 'keyword_title';
  text?: string;
  data?: Record<string, string | number>;
  enterOffset: number;
  exitOffset: number;
};

export type InsetRevealParams = {
  insetScale: number;
  topMargin: number;
  cornerRadius: number;
  shadow: boolean;
  transitionIn: {duration: number};
  transitionOut: {duration: number};
  easing: InsetEasing;
  background: InsetBackground;
  captions: {enabled: boolean; position: 'below_video'; maxLines: number};
  variant: InsetRevealVariant;
  graphic?: InsetGraphic;
};

/**
 * Inset Scale Reveal. Separate from B-roll and depth_overlay: the whole
 * talking-head frame shrinks into a card over a colored background, captions
 * sit below, then it restores to full frame.
 *
 * `{ type: "inset_reveal", start, end, params }` — older blueprints omit this array.
 */
export type InsetRevealClip = {
  type: 'inset_reveal';
  start: number;
  end: number;
  params: InsetRevealParams;
  reason?: string;
};

export const VISUAL_OVERLAY_LAYOUTS = [
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
] as const;
export type VisualOverlayLayout = (typeof VISUAL_OVERLAY_LAYOUTS)[number];

export const VISUAL_ANCHORS = [
  'top',
  'top_left',
  'top_right',
  'bottom',
  'bottom_left',
  'bottom_right',
] as const;
export type VisualAnchor = (typeof VISUAL_ANCHORS)[number];

export const CAPTION_POSITIONS = [
  'bottom',
  'lower_third',
  'center',
  'top',
] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export const HOOK_STYLES = [
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
] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

export const CAPTION_ANIMATIONS = [
  'highlight',
  'karaoke',
  'scale',
  'bounce',
  'box',
  'pop',
  'type',
] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

/** AI-chosen caption treatment for this specific video. */
export type CaptionDirection = {
  position: CaptionPosition;
  bottomFrac: number;
  textColor: string;
  highlightColor: string;
  /** Null means no bounding box — just outlined type. */
  boxColor: string | null;
  /** Kinetic preset the director picked for this clip. */
  template: CaptionTemplateId;
  /** Relative type size vs the template (~0.7–1.4). */
  fontScale?: number;
  /** WP32: most words a caption line shows at once (default 3). Polish bare type uses 2: fewer, bigger words, chest-band energy. */
  maxWords?: number;
  animation?: CaptionAnimation;
  uppercase?: boolean;
  /** WP13C: type treatment (polish looks): stroke colour / width (em), no coloured glow, and the active word as plain fill or as ink on a marker bar. Absent = the template's own. */
  strokeColor?: string;
  strokeWidthEm?: number;
  glow?: boolean;
  activeStyle?: 'fill' | 'marker';
  activeInk?: string;
  /** WP34: `word_by_word_accumulate` = the Metromedia accumulate caption grammar (see remotion/src/lib/accumulateCaptions.ts). Absent = the template's own captions. */
  mode?: 'word_by_word_accumulate' | 'chunk_swap';
  /** WP34: output-time cut seconds (VO cut grammar); the accumulate line hard-clears on the first cut after it starts. */
  cutTimes?: number[];
  /** WP34: font size as a percent of the composition height (grammar 7). */
  sizePctFrameH?: number;
  /** WP34: vertical centre of the line, fraction of the composition height (grammar 0.42-0.50). */
  centerYFrac?: number;
  /** WP38: classic talking-head polish only: accumulate line centre while a face is on screen (0.55-0.60). Absent = `centerYFrac`. */
  faceSafeYFrac?: number;
  /** WP34: the only words besides figures drawn in caps (the CTA keyword). */
  capsWords?: string[];
  /** WP41: Explainer (Skill B) `chunk_swap` captions: caption centre y (fraction of the frame height) per layout span (B seam 0.50, A / C / D 0.75). */
  yTrack?: Array<{start: number; end: number; yFrac: number}>;
};

export type TransitionClip = {
  /** Output time the wipe/burn covers (usually a frame change). */
  at: number;
  duration: number;
  keyword: string;
  assetUrl: string;
  blend: 'screen' | 'overlay' | 'lighten';
  provider: 'pexels' | 'pixabay' | 'generated';
  providerId: number;
  width: number;
  height: number;
  credit: string;
  creditUrl: string;
  /**
   * Draw this asset-less transition as the generated light sweep. Absent/false (legacy blueprints): TransitionTrack
   * skips clips that have no assetUrl, exactly as before.
   */
  renderGenerated?: boolean;
};

/**
 * Motion-graphics primitives — content-agnostic visual mechanisms the Director
 * composes creatively. Appearance (colors, copy) is a parameter, not the primitive.
 */

export const MOTION_ENTRANCES = [
  'spring_up',
  'slide_left',
  'slide_right',
  'scale_pop',
  'fade_blur',
  'type_stagger',
  'mask_wipe',
  'highlight_type',
  'slide_from_edge',
] as const;
export type MotionEntrance = (typeof MOTION_ENTRANCES)[number];

export const MOTION_EXITS = ['fade', 'spring_out', 'slide_away'] as const;
export type MotionExit = (typeof MOTION_EXITS)[number];

export const MOTION_SHAPES = [
  'none',
  'underline',
  'pill',
  'bar',
  'block',
  'outline_box',
  'bubble',
] as const;
export type MotionShape = (typeof MOTION_SHAPES)[number];

export const MOTION_ROLES = ['primary', 'secondary', 'accent'] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];

export const MOTION_ANCHORS = [
  'top',
  'top_left',
  'top_right',
  'center',
  'bottom',
  'bottom_left',
  'bottom_right',
] as const;
export type MotionAnchor = (typeof MOTION_ANCHORS)[number];

/**
 * Where a design value came from (Phase 28, Step 1a). Metadata only: nothing reads it to change a decision yet.
 *  - director: the Director model explicitly supplied a valid value for this field (an explicit #000000 is `director`).
 *  - profile:  derived from a content profile (the classifier's theme), not chosen by the Director.
 *  - default:  a parser / compiler / planner constant filled in because the field was absent or unusable.
 *  - fallback: produced by a deterministic fallback path that replaced a missing or empty Director output.
 * An ABSENT entry means "unknown" (for example after a stage that rebuilt the object without carrying the metadata) and must never
 * be read as `director`.
 */
export const PROVENANCE_STATES = ['director', 'profile', 'default', 'fallback'] as const;
export type Provenance = (typeof PROVENANCE_STATES)[number];
/** Field name -> origin of that field's value. */
export type ProvenanceMap = Partial<Record<string, Provenance>>;
/**
 * Carried on the object under a NON-ENUMERABLE symbol key: it never serialises (blueprints, goldens, dumps and Remotion props are
 * unchanged), is invisible to `toEqual`, and is dropped by object spread, so every stage that rebuilds an object must carry it
 * explicitly (see lib/provenance.ts). `Symbol.for` makes the key identical across modules.
 */
export const PROVENANCE: unique symbol = Symbol.for('finalpost.provenance');

/**
 * WP3B (mvp profile only): facts the offline rubric scorer could not otherwise read. Recording only; no renderer or planner decision reads it.
 *  - plannerMinGapSec: the spacing the editorial gate enforced between one cutaway's end and the next one's start in THIS run (`cutawayMinGapSec(listMode)`).
 *  - hookTitlePolicy: HOOK_TITLE_POLICY as it was when the plan was made.
 */
export type ScorerEvidence = {
  version: 1;
  plannerMinGapSec: number;
  plannerMinGapAppliesTo: 'cutaway_clips';
  hookTitlePolicy: 'placeholder' | 'optional';
};

/** WP2B: where the hook title is drawn, as numbers the renderer applies as-is (fractions of the canvas width/height). */
export type HookFit = {
  sizeFrac: number;
  widthFrac: number;
  topFrac: number;
  heightFrac: number;
  lines: number;
  inkColor: string;
  accentColor: string;
  plateColor: string;
  /** False when no band above the head region could hold even one floor-size line; the hook is then drawn at the safe top and the case is reported. */
  clearBand: boolean;
  shortened: boolean;
};

/** WP2B: optional legibility instructions written only by the `mvp` product profile. Absent = the renderer behaves exactly as before. */
export type LegibilitySpec = {
  version: 1;
  hook?: HookFit;
  captions: {
    avoidSplitFace: true;
    /** Per-line box for templates that honour a box colour (rgba, translucent). */
    splitBoxColor: string;
    splitTextColor: string;
    /** Highlight / active-word colour, raised to >= 4.5:1 against the WORST-CASE plate (the translucent plate over white footage). */
    splitHighlightColor: string;
    /** Opaque hex of the plate: the band drawn behind every template in the media half, and the pill of the grape package theme. */
    splitPlateColor: string;
    /** WP3U: frames the split caption placement is held before a B-roll split starts and after it ends, at the blueprint fps. Absent = the old instant switch. */
    splitHoldFrames?: number;
    /** WP8G: opt-in only. The full-width caption band on talking-head footage (WP4D) is off unless this is exactly true. No writer sets it; a split layout's own plate is unaffected. */
    backingPlate?: boolean;
  };
};

/** Stylish typography + adaptive graphic shape (graphic-backed type). */
export type MotionGraphic = {
  start: number;
  end: number;
  text: string;
  [PROVENANCE]?: ProvenanceMap;
  role: MotionRole;
  shape: MotionShape;
  accentColor: string;
  textColor: string;
  anchor: MotionAnchor;
  entrance: MotionEntrance;
  exit: MotionExit;
  /** Relative type scale (~0.7–1.8). */
  fontScale: number;
  italic?: boolean;
};

export const OVERLAY_TREATMENTS = [
  'card',
  'scroll',
  'suspense',
  'focus',
  'stack',
  'float',
  'wipe',
  'slideshow',
] as const;
export type OverlayTreatment = (typeof OVERLAY_TREATMENTS)[number];

export type FocusRegion = {
  /** Normalized 0–1 box on the asset. */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
};

export const MEDIA_CONTAINER_MODES = [
  'inset',
  'card',
  'rounded_window',
  'pip_corner',
] as const;
export type MediaContainerMode = (typeof MEDIA_CONTAINER_MODES)[number];

export const VISUAL_WEIGHTS = ['accent', 'hero'] as const;
export type VisualWeight = (typeof VISUAL_WEIGHTS)[number];

/**
 * Animates talking-head from full-bleed into a contained media object while
 * revealing a canvas (layout as an animatable property).
 */
export type MediaContainerMoment = {
  start: number;
  end: number;
  mode: MediaContainerMode;
  [PROVENANCE]?: ProvenanceMap;
  canvasColor: string;
  /** WP12C: 'blur_self' = a blurred, dimmed copy of the picture behind the sharp window; default 'solid'. */
  canvasStyle?: 'solid' | 'blur_self';
  cornerRadius: number;
  /** Final media scale inside the frame (0.55–0.92). */
  scale: number;
  /** Seconds to animate full → contained. */
  transitionSec: number;
  canvasTitle?: string;
  canvasTitleColor?: string;
  /** Corner for pip_corner when the leftover canvas has real assets. */
  pipAnchor?: VisualAnchor;
};

/**
 * Shrink the whole 9:16 picture to reveal a thick colored margin, then restore.
 * Distinct from media_container: no leftover canvas content, just a frame inset.
 */
export type FrameInset = {
  start: number;
  end: number;
  [PROVENANCE]?: ProvenanceMap;
  /** Final picture scale (0.70–0.94). Director chooses how far to retract. */
  scale: number;
  marginColor: string;
  cornerRadius?: number;
  transitionSec?: number;
};

export const EMPHASIS_TREATMENTS = [
  'scale',
  'color',
  'highlight_shape',
  'pop',
  'underline',
  'count',
  'type_reveal',
] as const;
export type EmphasisTreatment = (typeof EMPHASIS_TREATMENTS)[number];

export const EMPHASIS_WEIGHTS = ['primary', 'secondary'] as const;
export type EmphasisWeight = (typeof EMPHASIS_WEIGHTS)[number];

/** Speech-synced semantic visual weight for a short phrase/number. */
/** Frame-relative box (0–1); Remotion turns it into pixels. */
export type NormalizedBox = {x: number; y: number; w: number; h: number};

/**
 * How a generated motion graphic participates in the frame. Never pixels:
 * the split ratio and box rounding belong to Remotion.
 */
export type GeneratedGraphicPlacement =
  | {mode: 'full_screen'}
  /** Top/bottom only; the talking head takes the other half. */
  | {mode: 'split_screen'; graphicSide: 'top' | 'bottom'}
  /** Transparent layer over the picture; whole frame when box is omitted. */
  | {mode: 'overlay'; box?: NormalizedBox}
  | {mode: 'pip'; box: NormalizedBox};

/**
 * Generated motion graphic: a compiled Remotion component (CommonJS module,
 * content-addressed in R2) drawn live in the timeline. Separate from B-roll.
 */
export type GeneratedGraphic = {
  id: string;
  start: number;
  end: number;
  placement: GeneratedGraphicPlacement;
  module: {url: string; sha256: string};
  /** Passed to the graphic as-is (content, theme, safeArea, assets, …). */
  props?: Record<string, unknown>;
  /** The Director's request, kept for traceability. Not read by the renderer. */
  brief?: {kind?: string; purpose?: string; visualIntent?: string};
};

export type SemanticEmphasis = {
  start: number;
  end: number;
  text: string;
  [PROVENANCE]?: ProvenanceMap;
  weight: EmphasisWeight;
  treatment: EmphasisTreatment;
  accentColor: string;
  /** Occupancy-legal corner; never mid-face. */
  anchor?: VisualAnchor;
  /** Optional fill override when the plate would swallow white type. */
  textColor?: string;
  countFrom?: number;
  countTo?: number;
  countSuffix?: string;
};

export const VISUAL_MEDIA_KINDS = ['video', 'image', 'text'] as const;
export type VisualMediaKind = (typeof VISUAL_MEDIA_KINDS)[number];

export type OverlaySlide = {
  assetUrl: string;
  provider: 'pexels' | 'pixabay' | 'generated' | 'user' | 'klipy';
  providerId: number;
  /** WP3B (mvp profile only): the supplied creator asset id (`ub_<n>`). Recording only. */
  userBrollId?: string;
  width: number;
  height: number;
  credit: string;
  creditUrl: string;
};

/**
 * Designed graphic on top of (or behind) the speaker.
 *
 * `composite` is AI background compositing: a full-frame image/video plate
 * with the talking head inset in a card. `pip` / `stat` / `banner` sit on top.
 * Full-screen video cutaways still live on `brollClips`.
 */
export type VisualOverlay = {
  start: number;
  end: number;
  layout: VisualOverlayLayout;
  mediaKind: VisualMediaKind;
  /** Corner/edge so graphics never sit on the speaker's face. */
  anchor: VisualAnchor;
  keyword: string;
  overlayText: string;
  assetUrl: string;
  provider: 'pexels' | 'pixabay' | 'generated' | 'user' | 'klipy';
  providerId: number;
  /** WP3B (mvp profile only): the supplied creator asset id (`ub_<n>`). Recording only. */
  userBrollId?: string;
  /** WP19: image_story motion recipe for the card entrance (logo_slam, sticker_pop, still_push_in, card_tilt_in). */
  recipeId?: string;
  width: number;
  height: number;
  credit: string;
  creditUrl: string;
  /** White/cream on a bar by default — never a loud fill over the face. */
  accentColor: string;
  textStyle: OverlayTextStyle;
  /**
   * For layout=split only: which half holds the talking-head creator.
   * Related B-roll fills the other half. Face framing must keep the creator whole.
   */
  speakerSide?: 'top' | 'bottom';
  /** How the asset moves in — card spring, scroll, suspense blur, document focus. */
  treatment?: OverlayTreatment;
  cornerRadius?: number;
  glow?: boolean;
  focusRegion?: FocusRegion | null;
  scrollAxis?: 'y' | 'x' | 'none';
  staggerIndex?: number;
  /** accent = small corner card; hero = large while speaker is in PiP. */
  visualWeight?: VisualWeight;
  /** Related stills for the slideshow edit tool (overlay card or split half). */
  slides?: OverlaySlide[];
  /** The only slideshow transition the renderer implements (crossfade with a per-slide Ken Burns zoom). */
  slideTransition?: 'crossfade';
  /** Source clip length for split video: play this only after enter finishes. */
  assetDurationSec?: number;
  id?: string;
  beatId?: string;
  intent?: string;
  source?: ElementSource;
  locked?: boolean;
  createdByPass?: string;
  startWordId?: string;
  endWordId?: string;
};

export const ELEMENT_SOURCES = ['ai', 'user'] as const;
export type ElementSource = (typeof ELEMENT_SOURCES)[number];

export const TRACK_KINDS = [
  'broll',
  'overlay',
  'depth_overlay',
  'inset_reveal',
  'delivery_shaping',
  'motion',
  'emphasis',
  'transition',
  'caption',
  'audio',
  'custom',
] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export type BlueprintElementMeta = {
  id: string;
  beatId?: string;
  intent?: string;
  source?: ElementSource;
  locked?: boolean;
  createdByPass?: string;
  startWordId?: string;
  endWordId?: string;
};

export type VisualTrack = {
  id: string;
  kind: TrackKind;
  zIndex: number;
  elements: Array<Record<string, unknown>>;
};

export type BlueprintCta = {
  wordRange: {startWordId: string; endWordId: string};
  keyword: string;
  onScreenPrompt: string;
  dmReplyDraft: string;
  followUpDraft: string;
  suggested?: boolean;
  spokenLine?: string;
};

export type AudioDesign = {
  musicMood?: string;
  /** WP27: HTTPS (or Remotion-resolvable) URL of a licensed bed; omit = silent bed track. */
  musicUrl?: string;
  musicGain?: number;
  duckedGain?: number;
  ducking?: boolean;
  /** Which resolver arm supplied musicUrl. Absent on blueprints written before generated beds. */
  musicSource?: 'licensed' | 'generated';
  musicBpm?: number;
  /** Generated beds: full bed played once (falls back to musicUrl). */
  musicFullUrl?: string;
  /** Generated beds: bar-aligned loop body, played after the full bed on long timelines. */
  musicLoopUrl?: string;
  /** VO-carved twin of the full bed (MUSIC_CARVED_TWIN, default off). Absent → single-file playback. */
  musicCarvedUrl?: string;
  /** Length of the full bed in seconds; where the loop file starts. */
  musicFullDurationSec?: number;
  /** How the bed was obtained, for the music.summary log. Absent on older blueprints. */
  musicProvenance?: {
    source: 'licensed' | 'generated' | 'pool';
    mood?: string;
    costUsd?: number;
    cacheKey?: string;
    /** Set when the bed is a fallback (a pool bed used because generation failed). */
    fallbackReason?: string;
  };
  /** Speech-gated integrated loudness of the creator audio (LUFS). Absent on older blueprints. */
  voLufs?: number;
  /** Generated-bed envelope. Absent → MusicBedTrack keeps the legacy 0.18/0.04 gate. */
  duck?: {
    preset: 'talking' | 'default' | 'legacy_brief';
    speechDb: number;
    pauseDb: number;
    openDb: number;
    attackSec: number;
    holdSec: number;
    releaseSec: number;
    /** Attack look-ahead in seconds. Absent on older blueprints (= 0, unchanged curve). */
    leadSec?: number;
    phrases: Array<{start: number; end: number}>;
    durationSec: number;
    voLufs?: number;
    bedLufs?: number;
  };
  sfx: Array<{atWordId: string; kind: string; intent: string}>;
  /** Output-time hits resolved for the renderer (north-star). */
  hits?: Array<{
    at: number;
    kind: 'whoosh' | 'hit' | 'pop';
    volume?: number;
    reason?: string;
    src?: string;
    /** Catalog hits: the file's length in seconds, so the Sequence is not cut at the built-in 0.45 s. */
    durationSec?: number;
  }>;
};

export const NORTH_STAR_DISPLAY_FONTS = [
  'bebas',
  'oswald',
  'playfair',
  'space_grotesk',
] as const;
export type NorthStarDisplayFont = (typeof NORTH_STAR_DISPLAY_FONTS)[number];

export const NORTH_STAR_MOTION_PRESETS = [
  'kinetic',
  'editorial',
  'modular',
  'documentary',
] as const;
export type NorthStarMotionPreset = (typeof NORTH_STAR_MOTION_PRESETS)[number];

/**
 * One coherent design system for the whole edit (`blueprint.northStarDesign`). Despite the name it is shared infrastructure, not a
 * North Star feature: the North Star pass builds it, and the content-profile path (`designFromProfile`) builds it too. It is absent when
 * neither ran, and the renderer then keeps its own defaults. Prefer the neutral alias `DesignTokens` in code that only reads it.
 */
export type NorthStarDesign = {
  enabled: true;
  [PROVENANCE]?: ProvenanceMap;
  contentType:
    | 'educational_tips'
    | 'story'
    | 'sales_pitch'
    | 'opinion'
    | 'tutorial'
    | 'announcement'
    | 'testimonial'
    | 'comedy'
    | 'other';
  displayFont: NorthStarDisplayFont;
  primaryColor: string;
  secondaryColor: string;
  inkColor: string;
  surfaceColor: string;
  motionPreset: NorthStarMotionPreset;
  cornerRadius: number;
  density: 'restrained' | 'balanced' | 'expressive';
};

/**
 * Neutral name for `NorthStarDesign` (Phase 30, Step 2). A pure type alias: same type, same JSON key (`northStarDesign`), no runtime
 * effect. Shared readers use this name; the North Star pass keeps `NorthStarDesign`. Renaming the key, adding a second field, and retiring
 * the old name are separate decisions (they change persisted blueprints).
 */
export type DesignTokens = NorthStarDesign;

export type CustomSceneLayer = {
  id: string;
  type: 'text' | 'shape' | 'image' | 'video' | 'speaker';
  text?: string;
  fill?: string;
  assetSlot?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enter?: string;
  exit?: string;
};

export type CustomScene = {
  id: string;
  beatId?: string;
  intent?: string;
  startWordId: string;
  endWordId: string;
  layers: CustomSceneLayer[];
};

export type DirectorViolation = {
  code: string;
  elementId?: string;
  reason: string;
};

export type DirectorStageArtifact = {
  promptVersion: string;
  inputHash: string;
  output?: unknown;
  costUsd: number;
  latencyMs: number;
  promptTokens?: number;
  candidateTokens?: number;
  model?: string;
};

export type DirectorRunReport = {
  source: 'director_v2' | 'fallback' | 'legacy';
  passes: number;
  violations: DirectorViolation[];
  coercions: string[];
  drops: string[];
  assembler?: import('../lib/assembler/types.ts').AssemblerReport;
  perStageCostUsd: Record<string, number>;
  perStageLatencyMs: Record<string, number>;
  promptVersions?: Record<string, string>;
  inputHashes?: Record<string, string>;
  stages?: Record<string, DirectorStageArtifact>;
};

export type BlueprintStats = {
  wordCount: number;
  sentenceCount: number;
  silenceCutCount: number;
  silenceRemovedSec: number;
  zoomTriggerCount: number;
  brollClipCount: number;
  depthOverlayCount?: number;
  insetRevealCount?: number;
  deliveryOperationCount?: number;
  visualOverlayCount: number;
  splitCount: number;
  transitionCount: number;
  motionGraphicCount: number;
  mediaContainerCount: number;
  frameInsetCount?: number;
  semanticEmphasisCount: number;
  hasHookTitle: boolean;
  /** Wall-clock ms per stage, for latency budgeting. */
  timings: Record<string, number>;
  /** Estimated USD spent producing this blueprint (ASR + LLM). */
  estimatedCostUsd: number;
  warnings: string[];
  /** One explicit outcome per planned cutaway, from the edit ledger (pipeline evidence; not proof of rendered frames). */
  editOutcomes?: import('../lib/cutawayOutcomes.ts').EditOutcomeReport;
  perStageCostUsd?: Record<string, number>;
  perStageLatencyMs?: Record<string, number>;
  /** Present when generated motion graphics ran. */
  generatedGraphicCount?: number;
  /** Per-provider USD, present when generated motion graphics ran. */
  costBreakdownUsd?: {
    transcription: number;
    /** Every Gemini call: Director/B-roll, layout critique, motion-graphics direction. */
    gemini: number;
    /** Of which the motion-graphics direction call. */
    geminiMotionDirector: number;
    /** Claude motion-graphics worker (all attempts). */
    claude: number;
  };
};

export type TimelineBlueprint = {
  schemaVersion?: number;
  blueprintId: string;
  createdAt: string;
  videoUrl: string;
  languageCode: LanguageCode;
  detectedLanguage: string;
  fps: number;
  width: number;
  height: number;
  sourceDurationSec: number;
  outputDurationSec: number;
  /** Raw ASR word map, source time — kept so the client can re-derive anything. */
  words: WordToken[];
  /** Words remapped to output time; what captions actually render from. */
  captionWords: CaptionWord[];
  transcript: string;
  trimExclusions: TimeRange[];
  keepSegments: KeepSegment[];
  zoomTriggers: ZoomTrigger[];
  brollClips: BRollClip[];
  /** Behind-subject overlays. Omitted/empty on older projects. */
  depthOverlays?: DepthOverlayClip[];
  /** Inset Scale Reveal clips. Omitted/empty on older projects. */
  insetReveals?: InsetRevealClip[];
  /** Non-destructive audio/pacing decisions and their shared source↔output map. */
  deliveryShaping?: DeliveryShapingClip;
  /** Original source URL when `videoUrl` points at a shaped preview proxy. */
  originalVideoUrl?: string;
  /** Punchy title burned over the opening ~3 seconds. */
  hookTitle: string;
  hookSubtitle: string;
  hookDurationSec: number;
  /** When the hook appears, in output seconds. Defaults to 0. */
  hookStartSec?: number;
  /** Visual treatment for the opening hook — varies per video. */
  hookStyle: HookStyle;
  /** Occupancy-chosen corner so the hook never sits on the speaker. */
  hookAnchor: VisualAnchor;
  visualOverlays: VisualOverlay[];
  transitions: TransitionClip[];
  /** Motion-graphic titles / callouts with entrance choreography. */
  motionGraphics: MotionGraphic[];
  /** Full-bleed → inset/card canvas transforms. */
  mediaContainers: MediaContainerMoment[];
  /** Shrink the picture to a colored margin, then restore. */
  frameInsets: FrameInset[];
  /** Speech-synced semantic emphasis beats. */
  semanticEmphasis: SemanticEmphasis[];
  generatedGraphics?: GeneratedGraphic[];
  /** WP13B: black-and-white grade-flip beats on the talking head (a pacing reset). */
  gradeBeats?: Array<{startSec: number; endSec: number}>;
  /** WP35: Metromedia impact FX (overexpose flashes, saturation glow pops, money punch-ins, black-and-white spans). Polish only (POLISH_IMPACT_FX). */
  impactFx?: {
    flashes: Array<{startSec: number; frames: number; reason: 'hook_word' | 'major_reveal'}>;
    satPops: Array<{startSec: number; frames: number}>;
    punchIns: Array<{startSec: number; endSec: number; rampFrames: number; scale: number}>;
    bwSpans: Array<{startSec: number; endSec: number}>;
  };
  /** WP42: Skill B (Explainer) layout track (hard-cut spans that tile the runtime). Written only when polish + POLISH_EXPLAINER_SKILL resolves to the explainer skill; absent = the classic picture. */
  explainerLayoutTrack?: Array<{start: number; end: number; layout: 'explainer_a' | 'explainer_b' | 'explainer_c' | 'explainer_d'}>;
  /** WP42: Skill B claim beats: the article plate on layout B + the lime wipe on `phrase` (phraseStart / phraseEnd are speech times). `context` = the spoken line shown on the plate. */
  explainerClaimBeats?: Array<{start: number; end: number; phrase: string; phraseStart: number; phraseEnd: number; kind?: string; context?: string}>;
  /**
   * WP44: content-aware edit palette (accent + ground). Skill reference colours are preferred defaults, not locks.
   * Skill B preferred = edu lime on paper; Skill D preferred = signal red on near-black. Picker: stages/broll/editPalette.ts.
   */
  editPalette?: {
    id: string;
    accent: string;
    ground: string;
    groundDot: string;
    groundStyle: 'paper_dot' | 'ink_black' | 'soft_gray' | 'none';
    text: string;
    inkOnAccent: string;
    reason: string;
  };
  /** WP44: Skill D (newsroom MG) layout track — plan + warnings in WP44; full ShortVideo mount is follow-up. */
  newsroomLayoutTrack?: Array<{start: number; end: number; layout: 'newsroom_gfx' | 'newsroom_card' | 'newsroom_host' | 'newsroom_expert'}>;
  /** WP11A: ranges the caption layer is muted for (a text-carrying graphic owns the words). */
  captionMuteRanges?: Array<{startSec: number; endSec: number}>;
  /** Text between the footage and the speaker's alpha matte. Present only when a real matte exists. */
  behindSubjectTexts?: import('../stages/textTreatment/textTreatment.ts').BehindSubjectEntry[];
  /** WP55 phase 2: person-only alpha video (same timebase as `videoUrl`, played through the keep segments) drawn ABOVE kinetic environmental type during `spans` (output seconds). Range-limited: transparent elsewhere. */
  subjectForeground?: {videoUrl: string; spans: Array<{start: number; end: number}>};
  /** Kinetic typography RenderSpec (stages/kinetic); absent = no kinetic track. Composition frames == source frames (no trim). */
  kinetic?: import('../stages/kinetic/schema.ts').RenderSpec;
  /** SUBJECT STAGE (style `subject_stage`): stages BEHIND the person (S1 plate, S2 card, S3 ghost scroll, S4 neutral + accents) and S5 IN FRONT of her. Output seconds. Absent = nothing is drawn. Mirrors remotion `subjectStageSchema`. */
  subjectStage?: {
    version: 1;
    styleId: 'subject_stage';
    matteUrl: string;
    bg: {blurPx: number; dimPct: number};
    spans: Array<{
      start: number;
      end: number;
      stage: 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
      asset?: {url?: string; kind: 'image' | 'video' | 'native'; nativeKind?: 'plate' | 'quote_card' | 'result_page'; text?: string; lines?: string[]};
      opacity?: number;
      motion: {kind: 'none' | 'slow_push' | 'auto_scroll' | 'slide_up_front'; pctPerSec?: number; scalePct?: number};
      placement?: {xPct: number; yPct: number; wPct: number; hPct?: number};
      enter: 'hard_cut' | 'flash_cut' | 'slide_up_front';
      wash?: 'warm' | 'none';
    }>;
    accents: Array<{start: number; end: number; kind: 'pop_in' | 'drop_in_tilt' | 'text_stack'; lines?: string[]; lineStarts?: number[]; slot: number}>;
  };
  /** Art-directed opening (replaces the standard hook title). Opt-in; see stages/openingPlan. */
  openingTreatment?: import('../stages/openingPlan/openingPlan.ts').OpeningTreatmentSpec;
  /** Person-key so the creator can stand over B-roll. */
  speakerCutout?: {
    available: boolean;
    keyColor: string;
    similarity: number;
    blend: number;
    videoUrl?: string;
    speaker?: {x: number; y: number; w: number; h: number};
  };
  captionDirection: CaptionDirection;
  /** WP2B: legibility instructions (mvp profile only). */
  legibility?: LegibilitySpec;
  /** WP3B: evidence for the offline scorer (mvp profile only). */
  evidence?: ScorerEvidence;
  /** WP3F (mvp profile only): `hasAudio` of the ingest probe of the source. Recording only; the render checks use it to require audio in the output. */
  sourceHasAudio?: boolean;
  /** Optional .cube LUT id from ai-video-engine/luts (basename without extension). */
  colorGradeLut: string;
  /** AI-ranked LUT names from the catalog (max 10). Neutral is not included. */
  suggestedLutIds: string[];
  /** Best catalog LUT name; empty = Neutral / no grade. */
  preferredLutId: string;
  tracks?: VisualTrack[];
  cta?: BlueprintCta;
  audioDesign?: AudioDesign;
  /** Present only for the opt-in --north-star pipeline. */
  /** Legacy key for the shared design object; still written during the compatibility window (dual-write). */
  northStarDesign?: NorthStarDesign;
  /** Preferred key for the shared design object (Phase 31). Written together with `northStarDesign` while both are supported; wins when both are valid. */
  designTokens?: DesignTokens;
  editThesis?: string;
  customScenes?: CustomScene[];
  /**
   * WP15: after speech cleanup, labeled slots the app should ask the creator to upload
   * (logo / person / product / screenshot). Renderer ignores this; the client binds uploads by `id`.
   */
  assetBrief?: import('../stages/broll/labeledAssetBrief.ts').LabeledAssetBrief;
  /** WP26: `awaiting_assets` while a required labeled slot is still needed (the app shows the checklist and re-submits with bindings before rendering); `ready` otherwise. Present whenever `assetBrief` is. */
  editReadiness?: import('../stages/broll/labeledAssetBrief.ts').EditReadiness;
  directorReport?: DirectorRunReport;
  assembler?: import('../lib/assembler/types.ts').AssemblerReport;
  stats: BlueprintStats;
};

/** Style choices the user makes on-device; only these change between burns. */
export type RenderStyle = {
  captionTemplate: CaptionTemplateId;
  layoutStyle: LayoutStyle;
  /** 0–1 distance from the bottom of the frame to the caption baseline. */
  captionBottomFrac: number;
  /** 0–1 horizontal center of the caption block. */
  captionCenterXFrac: number;
  brollEnabled: boolean;
  zoomEnabled: boolean;
  trimEnabled: boolean;
  /** Overrides blueprint LUT when set; empty string means no grade. */
  colorGradeLut: string;
  /** false renders no generated motion graphics. Absent = enabled. */
  generatedGraphicsEnabled?: boolean;
};

/** Exact shape passed to the Remotion composition as input props. */
export type RemotionInputProps = {
  blueprint: TimelineBlueprint;
  style: RenderStyle;
};

export type AnalysisStage =
  | 'queued'
  | 'downloading'
  | 'transcribing'
  | 'filtering'
  | 'sourcing_broll'
  | 'done'
  | 'failed';

export type AnalysisJob = {
  analysisJobId: string;
  userId: string;
  videoUrl: string;
  languageCode: LanguageCode;
  status: AnalysisStage;
  progress: number;
  createdAt: string;
  updatedAt: string;
  cached: boolean;
  /** WP3X: the product edit profile this job ran under. Server-owned (set from server configuration; no request field can set it). */
  editProfile?: 'legacy' | 'mvp' | 'cuts' | 'polish';
  /** WP3X: whether generated graphics ran: `off` (flag off), `on` (the motion stage was allowed to run) or `skipped_budget` (requested, then disabled for a missing/refused Claude budget). Absent until the pipeline has decided, and for a cached blueprint. Server-owned. */
  graphics?: 'off' | 'on' | 'skipped_budget' | 'library_only';
  blueprint?: TimelineBlueprint;
  errorCode?: string;
  errorMessage?: string;
};

export type RenderJobStatus =
  | 'queued'
  | 'rendering'
  | 'done'
  | 'failed';

export type RenderJob = {
  renderJobId: string;
  blueprintId: string;
  userId: string;
  status: RenderJobStatus;
  progress: number;
  style: RenderStyle;
  outputDurationSec: number;
  createdAt: string;
  updatedAt: string;
  /** Remotion Lambda handles, needed to poll progress. */
  bucketName?: string;
  lambdaRenderId?: string;
  outputUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  estimatedCostUsd?: number;
  /** WP3F: non-fatal notes about the render check (for example `render_audio_unchecked`). Absent when there are none. */
  warnings?: string[];
};

export type CaptionsEditStatus =
  | 'awaiting_upload'
  | 'analyzing'
  | 'rendering'
  | 'done'
  | 'failed';

/** Server-owned captions job: phone PUTs source, engine analyzes + burns. */
export type CaptionsEditJob = {
  editJobId: string;
  userId: string;
  status: CaptionsEditStatus;
  progress: number;
  sourceKey: string;
  sourcePublicUrl: string;
  languageCode: LanguageCode;
  captionTemplate: CaptionTemplateId;
  /** CaptionKit preset id. Captions-only burns this instead of Remotion. */
  captionPreset?: string;
  captionStyleGuide?: Record<string, unknown> | null;
  /**
   * `captions` = burn captions only (no A-roll cuts).
   * `teleprompter_clean` = silence/filler/cough + script retakes, then captions.
   */
  mode?: 'captions' | 'teleprompter_clean';
  /** Teleprompter script for retake detection (teleprompter_clean). */
  scriptText?: string;
  createdAt: string;
  updatedAt: string;
  analysisJobId?: string;
  renderJobId?: string;
  outputUrl?: string;
  outputDurationSec?: number;
  errorCode?: string;
  errorMessage?: string;
};
