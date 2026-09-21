import type {CaptionDirection} from '../../types/blueprint.ts';

export type WordId = string;

export const FROZEN_TOOL_KINDS = [
  'karaoke_caption',
  'hook_title',
  'zoom',
  'cutaway',
  'inset_reveal',
  'motion_graphic',
  'lower_third',
  'callout_highlight',
  'transition',
  'depth_overlay',
] as const;

export type ToolKind = (typeof FROZEN_TOOL_KINDS)[number];

export type ToolLayer =
  | 'base'
  | 'video_overlay'
  | 'graphic_overlay'
  | 'caption'
  | 'audio';

export interface Word {
  id: WordId;
  text: string;
  start: number;
  end: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FootageCapabilities {
  speakerMask: 'available' | 'unavailable';
  occupancySource: 'detected' | 'fallback';
  safeRegions: Region[];
  captionBand: Region;
}

export interface Candidate {
  assetId: string;
  source: 'user' | 'stock';
  description: string;
  durationSec?: number;
  suitability?: number;
}

export interface PlanElement<P = Record<string, unknown>> {
  id: string;
  kind: string;
  anchor: {startWord: WordId; endWord: WordId};
  params: P;
  reason: string;
  priority?: number;
  source?: Record<string, unknown>;
}

export interface Plan {
  thesis: string;
  elements: PlanElement[];
  captions: CaptionDirection;
  hookTitle: string;
  hookStyle: string;
  coldOpen?: {startWord: WordId; endWord: WordId};
  discardedAssets: {assetId: string; reason: string}[];
  requestedEdits: string[];
}

export type RefusalCode =
  | 'needs_speaker_mask'
  | 'no_safe_region'
  | 'asset_missing'
  | 'asset_unsuitable'
  | 'overlap_conflict'
  | 'duration_out_of_range'
  | 'coverage_exceeded'
  | 'params_invalid'
  | 'unknown_kind'
  | 'render_failed';

export interface Refusal {
  elementId: string;
  code: RefusalCode;
  message: string;
  suggestion?: ToolKind | null;
}

export interface DecisionLogEntry {
  stage: string;
  code: string;
  elementId?: string;
  detail: string;
}

export interface MediaContext {
  durationSec: number;
  words: Word[];
  capabilities: FootageCapabilities;
  candidates: Candidate[];
}

export interface ScheduledElement extends PlanElement {
  resolved: {start: number; end: number; layer: number};
}

export interface Timeline {
  elements: ScheduledElement[];
}

export interface ElementDiff {
  id: string;
  kind: string;
  startWord?: WordId;
  endWord?: WordId;
  start?: number;
  end?: number;
}

export interface DiffReport {
  planned: number;
  shipped: number;
  matches: ElementDiff[];
  moved: ElementDiff[];
  dropped: Array<ElementDiff & {refusal: Refusal}>;
  added: ElementDiff[];
  overrides: DecisionLogEntry[];
}

export interface AssemblerReport {
  draftPlan: Plan;
  plan: Plan;
  scheduled: ScheduledElement[];
  refusals: Refusal[];
  log: DecisionLogEntry[];
  diff: DiffReport;
  sanity: string[];
  repairResolved: number;
  repairUnresolved: number;
}

export const ASSET_SUITABILITY_THRESHOLD = 0.35;
export const DEFAULT_USER_SUITABILITY = 0.5;
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;

export function isFrozenToolKind(kind: string): kind is ToolKind {
  return (FROZEN_TOOL_KINDS as readonly string[]).includes(kind);
}

export function parsePriority(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return undefined;
  }
  if (raw < PRIORITY_MIN || raw > PRIORITY_MAX) {
    return undefined;
  }
  return raw;
}
