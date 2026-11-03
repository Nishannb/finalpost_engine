import type {
  AudioDesign,
  BlueprintCta,
  CaptionDirection,
  DirectorRunReport,
  HookStyle,
  OverlayTreatment,
  VisualAnchor,
  VisualOverlayLayout,
} from '../../types/blueprint.ts';
import type {Occupancy} from '../layout/occupancy.ts';
import type {
  BEAT_ROLES,
  CONTENT_TYPES,
  CTA_ACTIONS,
  ELEMENT_KINDS,
  PACING_TARGETS,
  SPEAKER_PRESENCE,
  VISUAL_POTENTIAL,
} from './schemas.ts';

export type BeatRole = (typeof BEAT_ROLES)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type DirectorElementKind = (typeof ELEMENT_KINDS)[number];
export type SpeakerPresence = (typeof SPEAKER_PRESENCE)[number];
export type VisualPotential = (typeof VISUAL_POTENTIAL)[number];
export type CtaAction = (typeof CTA_ACTIONS)[number];
export type PacingTarget = (typeof PACING_TARGETS)[number];

export type WordRef = {
  id: string;
  text: string;
  start: number;
  end: number;
  sentenceId: string;
};

export type SentenceRef = {
  id: string;
  wordIds: string[];
  start: number;
  end: number;
  text: string;
};

export type StoryboardFrame = {
  /** Output-timeline seconds (what the edit uses). */
  atSec: number;
  path: string;
  note?: string;
  /** Seconds in the decoded file; set only by the visual-context path (otherwise `atSec` was used for both). */
  sourceSec?: number;
};

export type OccupancySlice = {
  atSec: number;
  occupancy: Occupancy;
};

export type AudioFacts = {
  pauses: Array<{start: number; end: number}>;
  emphasisWordIds: string[];
  energyPeaks: Array<{atSec: number; score: number}>;
};

export type PerceptionPack = {
  words: WordRef[];
  sentences: SentenceRef[];
  storyboard: StoryboardFrame[];
  occupancySlices: OccupancySlice[];
  /** The measurements behind `occupancySlices` (which is a dense nearest-neighbour copy): when and whether detected. Both paths. */
  occupancyMeasurements?: Array<{atSec: number; source: 'vision' | 'fallback'}>;
  /** The measured slices themselves (the independent observations), both paths. `occupancySlices` is a dense copy of these. */
  occupancyMeasured?: OccupancySlice[];
  /** Present only when VISUAL_CONTEXT_V2 is on. */
  visualContext?: import('./visualContext.ts').VisualContext;
  /** The speaker boxes that were actually measured (VISUAL_CONTEXT_V2 only). `occupancySlices` is a dense copy of these. */
  measuredOccupancy?: OccupancySlice[];
  audio: AudioFacts;
  transcript: string;
  outputDurationSec: number;
  language: string;
  creatorProfile: string;
  speakerCutoutAvailable: boolean;
  speakerCutoutNote: string;
  userAssets: Array<{
    id: string;
    description: string;
    durationSec: number;
    kind?: string;
    width?: number;
    height?: number;
    tags?: string[];
  }>;
  captionStyleGuide?: Record<string, unknown> | null;
  requestedEdits?: string[] | null;
  themeColors?: string[];
};

export type StoryBeat = {
  id: string;
  startWordId: string;
  endWordId: string;
  role: BeatRole;
  importance: number;
  energy: number;
  whatIsOnScreen: string;
  viewerNeed: string;
  speakerPresence: SpeakerPresence;
  visualPotential: VisualPotential;
  visualNow: string;
  speakerOnScreen: boolean;
};

export type StoryAnalysis = {
  contentType: ContentType;
  audience: string;
  promise: string;
  tone: string;
  emotionalArc: Array<{
    phase: string;
    startWordId: string;
    endWordId: string;
    feeling: string;
  }>;
  hook: {
    startWordId: string;
    endWordId: string;
    stoppingPower: number;
    weakness: string;
    coldOpen: {
      recommended: boolean;
      startWordId: string;
      endWordId: string;
      reason: string;
    };
  };
  coreMessage: string;
  beats: StoryBeat[];
  existingCta: {
    present: boolean;
    startWordId: string;
    endWordId: string;
    action: CtaAction;
    keyword: string;
    suggested: boolean;
    suggestedBeatId: string;
    suggestedSpokenLine: string;
  };
  pacing: Array<{beatIds: string[]; target: PacingTarget; why: string}>;
  risks: string[];
  estimatedCostUsd: number;
  promptVersion: string;
  inputHash: string;
  raw: unknown;
};

export type WordRange = {
  startWordId: string;
  endWordId: string;
  preRollMs?: number;
  postRollMs?: number;
};

export type ElementParams = {
  treatment?: OverlayTreatment;
  shape?: string;
  fontScale?: number;
  italic?: boolean;
  countFrom?: number;
  countTo?: number;
  countSuffix?: string;
  zoomScale?: number;
  /** Zoom focus as the Director wrote it (normalized 0–1); validated when the zoom is resolved. */
  focusX?: number;
  focusY?: number;
  containerMode?: string;
  canvasColor?: string;
  marginColor?: string;
  cornerRadius?: number;
  transitionStyle?: string;
  transitionSec?: number;
  scale?: number;
  speakerSide?: 'top' | 'bottom';
  glow?: boolean;
  direction?: 'up' | 'down';
  opacity?: number;
  duration?: number;
  exit?: boolean;
  fit?: 'fit' | 'fill';
  feather?: number;
  variant?: 'simple' | 'motion_graphic';
  insetScale?: number;
  backgroundType?: string;
  backgroundValue?: string;
  graphicTemplateId?: string;
  /** WP55 phase 2: kinetic_text only. The KINETIC_TYPE_STORYTELLING template the Director chose for this phrase (KINETIC_TYPE_NAMES); honoured only when the family was offered. */
  typeTemplate?: string;
  /** WP55 phase 2: drawn accent for type_illustrated_emphasis (KINETIC_TYPE_MARKS). */
  typeMark?: string;
  graphicText?: string;
  enterOffset?: number;
  exitOffset?: number;
  captionsEnabled?: boolean;
  shadow?: boolean;
};

export type CreativeElement = {
  id: string;
  beatId: string;
  intent: string;
  kind: DirectorElementKind;
  wordRange: WordRange;
  slotId?: string;
  zIndex?: number;
  enter?: string;
  exit?: string;
  easing?: string;
  searchKeyword?: string;
  overlayText?: string;
  layout?: VisualOverlayLayout;
  treatment?: OverlayTreatment;
  anchor?: VisualAnchor;
  userBrollId?: string;
  accentColor?: string;
  textColor?: string;
  text?: string;
  queries?: string[];
  params?: ElementParams;
};

export type EditThesis = {
  look: string;
  rhythm: string;
  motionLanguage: string;
  colorStory: string;
  why: string;
};

export type CreativePlan = {
  /** WP8B: the Edit Look decision (only when looks were on for this run, i.e. the polish profile). */
  editLook?: import('./editLooks.ts').EditLookDecision;
  editThesis: string;
  editThesisParts: EditThesis;
  hookTitle: string;
  hookStyle: HookStyle;
  caption: CaptionDirection;
  preferredLutId: string;
  suggestedLutIds: string[];
  elements: CreativeElement[];
  cta?: BlueprintCta;
  sound?: AudioDesign;
  coldOpen?: {
    use: boolean;
    sourceStartWordId: string;
    sourceEndWordId: string;
    howItReturns: string;
  };
  selfReview?: {
    strongestChoice: string;
    riskiestChoice: string;
    whatIWouldCut: string[];
  };
  estimatedCostUsd: number;
  promptVersion: string;
  inputHash: string;
  raw: unknown;
};

export type CompiledElement = CreativeElement & {
  start: number;
  end: number;
};

export type CompilerResult = {
  elements: CompiledElement[];
  report: DirectorRunReport;
};

export type StageCallMeta = {
  promptVersion: string;
  inputHash: string;
  costUsd: number;
  latencyMs: number;
  promptTokens: number;
  candidateTokens: number;
  model: string;
};
