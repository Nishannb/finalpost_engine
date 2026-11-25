/**
 * Kinetic Composer: shared types. The composer is a separate planning layer on top of the Kinetic V2 contracts (RenderSpec, guardrails, compositor): it decides WHAT each moment of the
 * talk is (beats), HOW the whole video should feel (edit direction), WHICH composition draws each beat (variety controller) and then solves every composition deterministically into
 * RenderSpec events + scene elements. No model ever draws pixels or coordinates.
 */
import type {RenderEvent, SceneElement, FontKey, KineticWord} from '../schema.ts';
import type {ShotScene} from '../scene.ts';

export type BeatType = 'hook' | 'stat' | 'list' | 'contrast' | 'question' | 'cta' | 'warning' | 'claim' | 'definition' | 'story' | 'plain';
export const BEAT_TYPES: readonly BeatType[] = ['hook', 'stat', 'list', 'contrast', 'question', 'cta', 'warning', 'claim', 'definition', 'story', 'plain'];

export type StatInfo = {from: number; to: number; decimals: number; prefix: string; suffix: string; /** words the counter draws (the number + its unit words) */ wordIdx: number[]};

export type Beat = {
  id: string;
  idx: number;
  /** inclusive word indices */
  wordRange: [number, number];
  /** speech span (composition frames) */
  startFrame: number;
  endFrame: number;
  type: BeatType;
  /** 0..1: how loud this moment is in the talk */
  intensity: number;
  /** key word indices, strongest first (1..3) */
  keyIdx: number[];
  stat?: StatInfo;
  /** the spoken list marker ("First,", "Number one", "bonus") */
  listMarker?: {wordIdx: number[]; ordinal: number};
  /** the two words that oppose each other; `a` may belong to the previous beat */
  contrast?: {a: number; b: number};
  /** opening moment (first ~3.5 s) */
  hook: boolean;
  /** coverage split: this beat holds words a designed composition could not draw; it is set in the caption lane only */
  laneOnly?: boolean;
  sentenceIndex: number;
  endsSentence: boolean;
};

export const COMPOSITIONS = [
  'giantWord', 'wordSwap', 'lineWipe', 'sideStack', 'topHeadline', 'contrastSplit', 'counterStat', 'listItem', 'questionCard', 'calloutBar', 'markerHighlight', 'ctaCard', 'takeover', 'heroStack',
] as const;
export type CompositionName = (typeof COMPOSITIONS)[number] | 'captionLane' | 'matchCut';

export type Tone = 'hype' | 'educational' | 'business' | 'story' | 'calm';
export type Verb = 'rise' | 'pop' | 'slam' | 'whip' | 'drop' | 'mask' | 'track' | 'glitch' | 'zoomThrough' | 'flip' | 'spin' | 'blurIn' | 'cut' | 'slide';
export type ExitVerb = 'fade' | 'sink' | 'blurOut' | 'scaleOut' | 'whipOut' | 'lift' | 'cut' | 'slideOut';
export type ZoneKey = 'top' | 'chest' | 'low' | 'below' | 'left' | 'right' | 'full';
export type Align = 'left' | 'center' | 'right';
export type VoiceVariant = 'loud' | 'editorial' | 'clean' | 'gradient' | 'mixed';
export type PlateChoice = 'dim' | 'spotlight' | 'vignette' | 'wash' | 'blur' | null;

export type EditDirection = {
  source: 'director' | 'deterministic';
  reason?: string;
  tone: Tone;
  /** 0..1 overall energy */
  energy: number;
  /** compositions this video leans on (4..7), strongest first */
  toolkit: CompositionName[];
  /** composition -> weight (0..1.5) */
  weights: Partial<Record<CompositionName, number>>;
  /** entry verbs this video's heroes rotate through */
  verbs: Verb[];
  exits: ExitVerb[];
  /** target share of speech time owned by designed beats */
  designedShare: number;
  /** 0..1 how often a plate treatment may accompany a designed beat */
  plateRate: number;
  /** a seeded signature so two videos never share every choice */
  seed: number;
  /** a seeded per-video look: how this edit sets its blocks and accents (two videos on the same preset still read differently) */
  look: {alignBias: 'left' | 'center' | 'right' | 'mixed'; radius: number; accentMode: 'accent' | 'accent2' | 'alternate'; tiltBias: number};
  /** optional per-beat overrides from the Director (beat id -> composition / type) */
  beatTags?: Record<string, {type?: BeatType; composition?: CompositionName}>;
  /** Director's suggestion: beats whose key word should sit BEHIND the speaker (honoured only with a usable matte; the verifier still judges every placement) */
  behindBeats?: string[];
  /** Director's suggestion: the ONE narrative moment that deserves a text match cut (validated by matchCut.ts directorMatchCut; never forced) */
  matchCut?: {beatId: string; keyword: string; moment: 'openingHook' | 'chapterTransition' | 'evidenceMontage' | 'beforeReveal'; why: string};
  /** the Director's colour choice (a curated palette name from voice.ts PALETTES); absent / 'preset' = the caption preset's own colours */
  palette?: string;
};

export type Voice = {
  presetId: string | null;
  /** the identity / brand face (every running word) */
  primary: FontKey;
  primaryWeight: number;
  /** loud display face for heroes */
  display: FontKey;
  displayWeight: number;
  /** editorial accent face (serif / italic) */
  editorial: FontKey;
  /** condensed fallback for long hero words */
  condensed: FontKey;
  /** small connector face */
  small: FontKey;
  smallWeight: number;
  text: string;
  accent: string;
  accent2: string;
  ink: string;
  /** true / false / null = per variant */
  upper: boolean | null;
  outline: {color: string; px: number} | null;
  shadowColor: string;
};

export type Variant = {
  zone: ZoneKey;
  align: Align;
  /** entry of the key / hero words */
  enter: Verb;
  /** entry of the supporting words (a separate pool: support words must not all rise) */
  subEnter: Verb;
  exit: ExitVerb;
  voice: VoiceVariant;
  plate: PlateChoice;
  /** -1 | 1: side the words ENTER from (left / right) */
  dir: -1 | 1;
  /** -1 | 1: side the words LEAVE to (may differ from the entry side) */
  exitDir: -1 | 1;
  /** SLANT: perspective yaw (rotateY, deg) of the treatment, the type recedes into the frame / comes out of it; the solver reduces it until the projected block fits its free region */
  tilt: number;
  /** a little perspective pitch (rotateX, deg) with the slant */
  pitch?: number;
  /** a high-impact word placed BEHIND the speaker (only with a usable matte) */
  behind?: boolean;
};

/** `only`: the word indices this solve may draw (a reduced take of the beat when the full phrase does not fit; the rest is voiced) */
export type Slot = {beat: Beat; prev?: Beat; next?: Beat; composition: CompositionName; inFrame: number; outFrame: number; variant: Variant; only?: number[]};

export type SafeRect = {left: number; right: number; top: number; bottom: number; w: number; h: number};
export type PxRect = {left: number; top: number; right: number; bottom: number};

export type ComposeCtx = {
  W: number;
  H: number;
  fps: number;
  safe: SafeRect;
  scene: ShotScene;
  words: KineticWord[];
  voice: Voice;
  direction: EditDirection;
  durationFrames: number;
  /** plate luminance (0..1) of a composition-pixel region (a 16x16 grid of the speaker still when known, else the plate mean) */
  lumAt: (r: PxRect) => number;
  /** a usable person matte informs the scene: behind-the-speaker placement is legal (the verifier checks occlusion) */
  behindOk?: boolean;
};

export type Built = {
  events: RenderEvent[];
  scene: SceneElement[];
  /** word indices this composition draws (the counter / takeover included) */
  drawn: number[];
  zone: ZoneKey;
  notes: string[];
};
