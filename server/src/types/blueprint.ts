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
  animation?: CaptionAnimation;
  uppercase?: boolean;
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

/** Stylish typography + adaptive graphic shape (graphic-backed type). */
export type MotionGraphic = {
  start: number;
  end: number;
  text: string;
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
  canvasColor: string;
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
export type SemanticEmphasis = {
  start: number;
  end: number;
  text: string;
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
  provider: 'pexels' | 'pixabay' | 'generated' | 'user';
  providerId: number;
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
  provider: 'pexels' | 'pixabay' | 'generated' | 'user';
  providerId: number;
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
  slideTransition?: 'crossfade' | 'ken_burns';
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
  ducking?: boolean;
  sfx: Array<{atWordId: string; kind: string; intent: string}>;
  /** Output-time hits resolved for the renderer (north-star). */
  hits?: Array<{
    at: number;
    kind: 'whoosh' | 'hit' | 'pop';
    volume?: number;
    reason?: string;
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
 * One coherent design system for the whole north-star edit. Normal edits omit
 * this object and therefore keep the existing renderer exactly as-is.
 */
export type NorthStarDesign = {
  enabled: true;
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
  perStageCostUsd?: Record<string, number>;
  perStageLatencyMs?: Record<string, number>;
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
  northStarDesign?: NorthStarDesign;
  editThesis?: string;
  customScenes?: CustomScene[];
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
