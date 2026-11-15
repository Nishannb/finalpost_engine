/**
 * Edit Event Sheet (AI Music Director): a factual, deterministic description of a finished visual edit.
 * It records WHAT the viewer sees and WHEN, in final output time. It makes no music or SFX decision.
 *
 * Time domains (docs/ai-music-director/PHASE_1_IMPLEMENTATION_READINESS.md section 3.3):
 *   original_source  T0: the uploaded file's own clock (transcription words, delivery acoustics, speech.ogg).
 *   shaped_source    T1: T0 after the optional delivery-shaping remap (blueprint.words, keepSegments.sourceStart/End, trimExclusions).
 *   output           T2: the finished edit's clock (captionWords, every visual track, kinetic frames).
 * The sheet only ever emits `output`. Nothing here converts between domains.
 *
 * Version history: 1 = Phase 1.1 (never consumed). 2 = Phase 1.2: renderer ownership and visibility, impact times, frame-end conventions,
 * globally unique namespaced ids, `timingHash` + `visualContentHash` replacing `blueprintHash`.
 */

export const EVENT_SHEET_VERSION = 2 as const;

export type TimeDomain = 'original_source' | 'shaped_source' | 'output';

/** A time span on the finished edit's clock. `endSec` is exclusive (the first moment the event is no longer shown); null = an instant. */
export type OutputTime = {
  domain: 'output';
  startSec: number;
  endSec: number | null;
};

export type OutputInstant = {domain: 'output'; sec: number};

/**
 * Frame-exact timing, present when the renderer places the event on whole frames. Output frames at `fps`.
 * `endFrameExclusive` is the first frame the event is no longer drawn. `storedEnd` records the blueprint's own end value and its convention, because
 * kinetic events are drawn THROUGH `outFrame` (inclusive, KineticTrack.tsx `frame > event.outFrame`) while gap captions stop AT it (exclusive, `frame >= c.outFrame`).
 */
export type OutputFrames = {
  domain: 'output_frames';
  fps: number;
  startFrame: number;
  endFrameExclusive: number | null;
  storedEnd: {field: string; value: number; convention: 'inclusive' | 'exclusive'} | null;
};

export type ImpactSource =
  | 'hard_cut'
  | 'layout_hard_cut'
  | 'impact_fx_flash'
  | 'kinetic_flash_peak_opacity'
  | 'transition_procedural_peak'
  | 'transition_generated_sweep_peak'
  | 'transition_hard_cut_anchor'
  | 'kinetic_line_landing'
  | 'kinetic_exit_start';

/** When the event's main perceptual impact occurs. Only present when a renderer rule establishes it; never a copy of `start` by default. */
export type Impact = {time: OutputInstant; frame: number | null; source: ImpactSource};

/** Why an event has no impact time. */
export type ImpactUnavailable =
  | 'not_established_for_type'
  | 'asset_content_dependent'
  | 'degenerate_window'
  | 'nothing_drawn';

/**
 * `visible`            the renderer draws it for its whole interval, given the recorded render style.
 * `conditional`        drawn only if a render-time or per-frame condition holds; the conditions are listed. Not a claim of visibility.
 * `partially_hidden`   drawn, except during `hiddenDuring` (another layer takes the picture).
 */
export type Visibility = {
  status: 'visible' | 'conditional' | 'partially_hidden';
  conditions: string[];
  hiddenDuring: OutputTime[];
};

export type EventType =
  | 'cut'
  | 'zoom'
  | 'broll'
  | 'depth_overlay'
  | 'inset_reveal'
  | 'visual_overlay'
  | 'transition'
  | 'motion_graphic'
  | 'media_container'
  | 'frame_inset'
  | 'semantic_emphasis'
  | 'generated_graphic'
  | 'behind_subject_text'
  | 'grade_beat'
  | 'impact_flash'
  | 'impact_sat_pop'
  | 'impact_punch_in'
  | 'impact_bw_span'
  | 'explainer_layout'
  | 'explainer_claim'
  | 'newsroom_layout'
  | 'hook_title'
  | 'opening_treatment'
  | 'kinetic_event'
  | 'kinetic_flash'
  | 'kinetic_gap_caption'
  /** Opt-in (buildEventSheet {kineticLines: true}): one drawn Kinetic word line, impact at its keyframe landing (eventSheet/kineticLines.ts). */
  | 'kinetic_line'
  /** Opt-in: the exit motion of a Kinetic word (X2 swap) or block (OUT-*), impact at the first non-rest exit frame. */
  | 'kinetic_exit'
  | 'stage_span'
  | 'stage_accent'
  | 'stage_cutaway';

export type EventAttrValue = string | number | boolean;

export type SheetEvent = {
  /** Globally unique within the sheet (see ids.ts rules in buildEventSheet.ts). */
  id: string;
  type: EventType;
  /** Blueprint field (and sub-path) the event came from, e.g. `kinetic.events`. */
  source: string;
  /** Position in that source array as stored. Informational; ids never depend on it. */
  sourceIndex: number;
  /** When the event is shown. For a transition this is its drawn window, not its anchor. */
  time: OutputTime;
  frames: OutputFrames | null;
  /** The blueprint's own reference instant when it differs from `time.startSec` (a transition's `at`). */
  anchor: OutputInstant | null;
  impact: Impact | null;
  impactUnavailable: ImpactUnavailable | null;
  visibility: Visibility;
  /** Small factual attributes copied from the blueprint (placement mode, keyword, text). Never a judgement. */
  attrs: Record<string, EventAttrValue>;
  /** Set when an identical event (same type, time and content) appears earlier in the same id group. */
  duplicateOf: string | null;
};

export type ExclusionReason =
  | 'malformed_track'
  | 'malformed_item'
  | 'non_finite_time'
  | 'start_out_of_range'
  | 'end_out_of_range'
  | 'end_before_start'
  | 'kinetic_fps_mismatch'
  | 'kinetic_duration_mismatch'
  /** Two keep segments that are contiguous in the source: the output plays straight through, so there is no visible cut. */
  | 'contiguous_segments'
  | 'not_rendered:trim_disabled'
  | 'not_rendered:broll_disabled'
  | 'not_rendered:zoom_disabled'
  | 'not_rendered:generated_graphics_disabled'
  | 'not_rendered:no_renderer_reads_track'
  | 'not_rendered:opening_replaces_hook'
  | 'not_rendered:kinetic_owns_person_layer'
  | 'not_rendered:subject_foreground_owns_person_layer'
  | 'not_rendered:stage_inactive_no_matte'
  | 'not_rendered:stage_inactive_invalid_matte'
  | 'not_rendered:stage_inactive_no_spans'
  | 'not_rendered:stage_owns_pictures'
  | 'not_rendered:explainer_owns_pictures'
  | 'not_rendered:explainer_off'
  | 'not_rendered:broll_hidden_by_split_or_cutout'
  | 'not_rendered:transition_not_drawable'
  | 'not_rendered:transition_invalid_window'
  | 'not_rendered:transition_same_cut_as_earlier'
  | 'not_rendered:hard_cut_marker_draws_nothing'
  | 'not_rendered:kinetic_flash_all_transparent';

export type ExcludedEvent = {source: string; sourceIndex: number | null; reason: ExclusionReason; detail: string};

export type SpeechWord = {
  /** `w{n}` = captionWords[n]. The Director v2 convention (stages/directorV2/perception.ts). */
  id: string;
  text: string;
  time: OutputTime;
  sentenceIndex: number | null;
};

export type NarrativeStatus = 'absent' | 'empty' | 'malformed' | 'available';

/**
 * Whether persisted story-analyst output exists at `directorReport.stages.story.output`. Not parsed here and never re-run; it only reports
 * availability, so the sheet stays usable without it.
 */
export type NarrativeAvailability = {
  status: NarrativeStatus;
  path: 'directorReport.stages.story.output';
  promptVersion: string | null;
  /** Top-level keys of the stored output (sorted), for diagnosis only. */
  keys: string[];
  detail: string;
};

export type FieldClass = 'included' | 'excluded' | 'metadata';

export type FieldRole = 'events' | 'speech' | 'narrative' | 'edit_facts';

export type CoverageEntry = {field: string; class: FieldClass; role: FieldRole | null; present: boolean};

export type SheetRenderStyle = {
  trimEnabled: boolean;
  brollEnabled: boolean;
  zoomEnabled: boolean;
  generatedGraphicsEnabled: boolean;
  /** `assumed_edit_default` = nothing was passed; the full-edit API defaults were used (renderModel.ts DEFAULT_EDIT_RENDER_STYLE). */
  source: 'provided' | 'assumed_edit_default';
  assumedFlags: string[];
};

export type EditEventSheet = {
  version: typeof EVENT_SHEET_VERSION;
  blueprintId: string | null;
  /** hash.ts: identity of exactly what a plan can anchor to (ids, times, frames, impacts, visibility, speech words). */
  timingHash: string;
  /** hash.ts: identity of the listed picture-content fields, media references included. Not every rendered pixel (see hash.ts coverage). */
  visualContentHash: string;
  fps: number;
  durationSec: number;
  /** Composition length in frames, as ShortVideo.tsx durationInFramesFor computes it for a trimmed render. */
  durationFrames: number;
  renderStyle: SheetRenderStyle;
  sourceHasAudio: boolean | null;
  events: SheetEvent[];
  excluded: ExcludedEvent[];
  speech: {words: SpeechWord[]; excluded: ExcludedEvent[]};
  narrative: NarrativeAvailability;
  coverage: CoverageEntry[];
};
