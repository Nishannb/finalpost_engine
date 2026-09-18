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
  'hormozi',
  'mrbeast',
  'karaoke',
  'classic',
  'box',
  'bounce',
  'minimal',
] as const;
export type CaptionTemplateId = (typeof CAPTION_TEMPLATES)[number];

export const OVERLAY_TEXT_STYLES = ['outline', 'bar', 'chip', 'poster', 'stack'] as const;
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
};

export const VISUAL_OVERLAY_LAYOUTS = [
  'cutaway',
  'composite',
  'pip',
  'sticker',
  'lockup',
  'chip',
  'banner',
  'split',
  'stat',
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

export const MEDIA_CONTAINER_MODES = ['inset', 'card', 'rounded_window'] as const;
export type MediaContainerMode = (typeof MEDIA_CONTAINER_MODES)[number];

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
};

export const EMPHASIS_TREATMENTS = [
  'scale',
  'color',
  'highlight_shape',
  'pop',
  'underline',
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
};

export const VISUAL_MEDIA_KINDS = ['video', 'image', 'text'] as const;
export type VisualMediaKind = (typeof VISUAL_MEDIA_KINDS)[number];

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
};

export type BlueprintStats = {
  wordCount: number;
  sentenceCount: number;
  silenceCutCount: number;
  silenceRemovedSec: number;
  zoomTriggerCount: number;
  brollClipCount: number;
  visualOverlayCount: number;
  splitCount: number;
  transitionCount: number;
  motionGraphicCount: number;
  mediaContainerCount: number;
  semanticEmphasisCount: number;
  hasHookTitle: boolean;
  /** Wall-clock ms per stage, for latency budgeting. */
  timings: Record<string, number>;
  /** Estimated USD spent producing this blueprint (ASR + LLM). */
  estimatedCostUsd: number;
  warnings: string[];
};

export type TimelineBlueprint = {
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
  /** Punchy title burned over the opening ~3 seconds. */
  hookTitle: string;
  hookSubtitle: string;
  hookDurationSec: number;
  /** Visual treatment for the opening hook — varies per video. */
  hookStyle: HookStyle;
  visualOverlays: VisualOverlay[];
  transitions: TransitionClip[];
  /** Motion-graphic titles / callouts with entrance choreography. */
  motionGraphics: MotionGraphic[];
  /** Full-bleed → inset/card canvas transforms. */
  mediaContainers: MediaContainerMoment[];
  /** Speech-synced semantic emphasis beats. */
  semanticEmphasis: SemanticEmphasis[];
  captionDirection: CaptionDirection;
  /** Optional .cube LUT id from ai-video-engine/luts (basename without extension). */
  colorGradeLut: string;
  /** AI-ranked LUT ids (max 3) for on-device suggestion chips. */
  suggestedLutIds: string[];
  /** Best LUT id to apply; empty = natural / no grade. */
  preferredLutId: string;
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
