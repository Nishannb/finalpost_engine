/**
 * Builds the Edit Event Sheet from a stored blueprint. Pure and deterministic: no I/O, no clock, no randomness, no model.
 *
 * Rules:
 *  - Every top-level field, and every key of the nested event structures, must be classified (fieldCoverage.ts); anything unclassified throws.
 *  - Only output-time visual tracks become events. Nothing is converted between time domains.
 *  - An event the renderer would not draw is EXCLUDED with a `not_rendered:*` reason (renderModel.ts mirrors the renderer). Where drawing depends
 *    on render-time state, the event is kept with `visibility.status = 'conditional'` and the conditions listed. Nothing is claimed visible on a guess.
 *  - Bad timing (missing, non-finite, outside [0, outputDurationSec] with one frame of tolerance, reversed) is excluded, never clamped.
 *  - Impact times exist only where a renderer rule establishes them. Start is never used as a stand-in.
 *
 * Event ids (globally unique; asserted):
 *  - stored ids, escaped so they can contain no `%`, `~`, `:` or `@`:   `kin:{id}` (kinetic event), `kinflash:{parent id}`, `gfx:{id}`.
 *  - everything else, time-based:                                        `{prefix}@{milliseconds}`, e.g. `zoom@12400`, `kin@1000`, `kinflash@1000`.
 *  - collisions (same base id): ordered by type + canonical JSON of the stored item, then `~2`, `~3` … appended. A base never contains `~`, so a
 *    suffixed id can never equal another base. Identical items keep distinct ids and `duplicateOf` names the first.
 */

import {canonicalJson, timingHash, visualContentHash} from './hash.ts';
import {blockExitFrame, kineticLineFacts} from './kineticLines.ts';
import {assertFullyClassified, assertNestedClassified, BLUEPRINT_FIELD_RULES, EXTRA_FIELD_RULES, type FieldRule} from './fieldCoverage.ts';
import {
  compositionFrames,
  firstPeakFrame,
  generatedSweepStrength,
  hidesBroll,
  isExplainerMedia,
  EXPLAINER_PICTURE_OWNING_OVERLAYS,
  proceduralStrength,
  proceduralStyleOf,
  resolveRenderStyle,
  secToFrame,
  subjectStageStatus,
  transitionDrawStatus,
  type KeepSegmentLike,
  type RenderStyleInput,
  type ResolvedRenderStyle,
  type StageStatus,
} from './renderModel.ts';
import {
  EVENT_SHEET_VERSION,
  type CoverageEntry,
  type EditEventSheet,
  type EventAttrValue,
  type EventType,
  type ExcludedEvent,
  type ExclusionReason,
  type Impact,
  type ImpactUnavailable,
  type NarrativeAvailability,
  type OutputFrames,
  type OutputInstant,
  type OutputTime,
  type SheetEvent,
  type SpeechWord,
  type Visibility,
} from './types.ts';

export class InvalidBlueprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBlueprintError';
  }
}

export type BuildEventSheetOptions = {
  /** The render style the edit will be rendered with. Omitted flags take the full-edit defaults and are listed in `renderStyle.assumedFlags`. */
  renderStyle?: RenderStyleInput;
  /**
   * Visual Event Sound Design: also emit word-level `kinetic_line` / `kinetic_exit` events from the Kinetic keyframes (eventSheet/kineticLines.ts).
   * Absent or false = the sheet is exactly as before (every existing caller).
   */
  kineticLines?: boolean;
};

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round3 = (value: number) => Math.round(value * 1000) / 1000 + 0; // + 0 turns -0 into 0
const TEXT_MAX = 80;

/** A saved replay envelope ({videoId, blueprint, ...}) or a bare blueprint. */
export function unwrapSavedBlueprint(json: unknown): Obj {
  if (isObj(json) && isObj(json.blueprint) && 'savedAt' in json) return json.blueprint;
  if (isObj(json)) return json;
  throw new InvalidBlueprintError('Blueprint JSON is not an object.');
}

type Candidate = {
  type: EventType;
  source: string;
  sourceIndex: number;
  time: OutputTime;
  frames: OutputFrames | null;
  anchor: OutputInstant | null;
  impact: Impact | null;
  impactUnavailable: ImpactUnavailable | null;
  visibility: Visibility;
  attrs: Record<string, EventAttrValue>;
  /** Stored-id namespace (`kin`, `kinflash`, `gfx`) and the stored id; null = a time-based id. */
  stored: {namespace: 'kin' | 'kinflash' | 'gfx'; id: string} | null;
  /** The instant a time-based id is built from (the stored start or anchor, before any frame rounding). */
  idSec: number;
  /** The raw item, for duplicate detection and collision ordering. */
  content: unknown;
};

const TIME_PREFIX: Record<EventType, string> = {
  kinetic_line: 'kline',
  kinetic_exit: 'kexit',
  cut: 'cut',
  zoom: 'zoom',
  broll: 'broll',
  depth_overlay: 'depth',
  inset_reveal: 'inset',
  visual_overlay: 'overlay',
  transition: 'transition',
  motion_graphic: 'mg',
  media_container: 'container',
  frame_inset: 'frame_inset',
  semantic_emphasis: 'emphasis',
  generated_graphic: 'gfx',
  behind_subject_text: 'behind_text',
  grade_beat: 'grade',
  impact_flash: 'flash',
  impact_sat_pop: 'sat_pop',
  impact_punch_in: 'punch_in',
  impact_bw_span: 'bw',
  explainer_layout: 'explainer_layout',
  explainer_claim: 'claim',
  newsroom_layout: 'newsroom_layout',
  hook_title: 'hook',
  opening_treatment: 'opening',
  kinetic_event: 'kin',
  kinetic_flash: 'kinflash',
  kinetic_gap_caption: 'kin_caption',
  stage_span: 'stage_span',
  stage_accent: 'stage_accent',
  stage_cutaway: 'stage_cutaway',
};

/** Stored ids may contain anything; escape the id grammar's own characters so a stored id can never look like a suffix or another namespace. */
export const escapeStoredId = (id: string): string => id.replace(/[%~:@]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

function pickAttrs(item: Obj, keys: readonly string[]): Record<string, EventAttrValue> {
  const attrs: Record<string, EventAttrValue> = {};
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string') attrs[key] = value.length > TEXT_MAX ? value.slice(0, TEXT_MAX) : value;
    else if (typeof value === 'number' && Number.isFinite(value)) attrs[key] = value;
    else if (typeof value === 'boolean') attrs[key] = value;
  }
  return attrs;
}

const visible = (): Visibility => ({status: 'visible', conditions: [], hiddenDuring: []});
const conditional = (...conditions: string[]): Visibility => ({status: 'conditional', conditions: [...conditions].sort(), hiddenDuring: []});

type Ctx = {
  bp: Obj;
  fps: number;
  durationSec: number;
  durationFrames: number;
  tolSec: number;
  style: ResolvedRenderStyle;
  stage: StageStatus;
  explainerOn: boolean;
  /** Visual overlays the renderer draws in the free picture (ShortVideo.tsx:97-100). Empty when B-roll is off or the stage owns the pictures. */
  drawnOverlays: Obj[];
  candidates: Candidate[];
  excluded: ExcludedEvent[];
};

function exclude(ctx: Ctx, source: string, sourceIndex: number | null, reason: ExclusionReason, detail: string) {
  ctx.excluded.push({source, sourceIndex, reason, detail});
}

/** Validates a span in output seconds. Returns false (and records why) when the event must be excluded. */
function validSpan(ctx: Ctx, source: string, index: number, start: number | null, end: number | null, endExpected: boolean): boolean {
  if (start === null || (endExpected && end === null)) {
    exclude(ctx, source, index, 'non_finite_time', 'start or end is missing or not a finite number');
    return false;
  }
  if (start < -1e-6 || start > ctx.durationSec + ctx.tolSec) {
    exclude(ctx, source, index, 'start_out_of_range', `start ${start} outside [0, ${ctx.durationSec}]`);
    return false;
  }
  if (end !== null && end < start - 1e-6) {
    exclude(ctx, source, index, 'end_before_start', `end ${end} < start ${start}`);
    return false;
  }
  if (end !== null && end > ctx.durationSec + ctx.tolSec) {
    exclude(ctx, source, index, 'end_out_of_range', `end ${end} > duration ${ctx.durationSec}`);
    return false;
  }
  return true;
}

function arrayOf(ctx: Ctx, value: unknown, source: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    exclude(ctx, source, null, 'malformed_track', `expected an array, got ${typeof value}`);
    return [];
  }
  return value;
}

const outTime = (startSec: number, endSec: number | null): OutputTime => ({domain: 'output', startSec: round3(startSec), endSec: endSec === null ? null : round3(endSec)});
const instant = (sec: number): OutputInstant => ({domain: 'output', sec: round3(sec)});
const frameImpact = (frame: number, fps: number, source: Impact['source']): Impact => ({time: instant(frame / fps), frame, source});

type Gate = {reason: ExclusionReason; detail: string} | null;

type SpanSpec = {
  source: string;
  type: EventType;
  startKey: string;
  endKey?: string;
  framesKey?: string;
  attrs: readonly string[];
  /** Whole-track render gate. */
  gate?: (ctx: Ctx) => Gate;
  /** Per-item visibility (or an exclusion). */
  visibility?: (ctx: Ctx, item: Obj, start: number, end: number | null) => Visibility | Gate;
  /** Per-item frame placement and impact. */
  placement?: (ctx: Ctx, item: Obj, start: number) => {frames?: OutputFrames; impact?: Impact};
  extraAttrs?: (item: Obj) => Record<string, EventAttrValue>;
  storedId?: (item: Obj) => {namespace: 'gfx'; id: string} | null;
};

const isGate = (value: Visibility | Gate): value is NonNullable<Gate> => value !== null && 'reason' in value;

function extractSpans(ctx: Ctx, items: unknown[], spec: SpanSpec) {
  const gate = spec.gate?.(ctx) ?? null;
  items.forEach((raw, index) => {
    if (!isObj(raw)) {
      exclude(ctx, spec.source, index, 'malformed_item', 'item is not an object');
      return;
    }
    const start = num(raw[spec.startKey]);
    let end: number | null = null;
    let endExpected = false;
    if (spec.endKey) {
      endExpected = true;
      end = num(raw[spec.endKey]);
    } else if (spec.framesKey) {
      endExpected = true;
      const frames = num(raw[spec.framesKey]);
      end = start !== null && frames !== null ? secToFrame(start, ctx.fps) / ctx.fps + frames / ctx.fps : null;
    }
    if (!validSpan(ctx, spec.source, index, start, end, endExpected)) return;
    if (gate) {
      exclude(ctx, spec.source, index, gate.reason, gate.detail);
      return;
    }
    const vis = spec.visibility ? spec.visibility(ctx, raw, start as number, end) : visible();
    if (isGate(vis)) {
      exclude(ctx, spec.source, index, vis.reason, vis.detail);
      return;
    }
    const placed = spec.placement ? spec.placement(ctx, raw, start as number) : {};
    // A frame-placed event is shown on whole frames: its time is its frames.
    const time = placed.frames ? outTime(placed.frames.startFrame / ctx.fps, placed.frames.endFrameExclusive === null ? null : placed.frames.endFrameExclusive / ctx.fps) : outTime(start as number, end);
    ctx.candidates.push({
      type: spec.type,
      source: spec.source,
      sourceIndex: index,
      time,
      frames: placed.frames ?? null,
      anchor: null,
      impact: placed.impact ?? null,
      impactUnavailable: placed.impact ? null : 'not_established_for_type',
      visibility: (vis as Visibility | null) ?? visible(),
      attrs: {...pickAttrs(raw, spec.attrs), ...(spec.extraAttrs ? spec.extraAttrs(raw) : {})},
      stored: spec.storedId?.(raw) ?? null,
      idSec: start as number,
      content: raw,
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Render gates (each mirrors a line of remotion/src/ShortVideo.tsx)
// ---------------------------------------------------------------------------------------------------------------------------------

const brollGate = (ctx: Ctx): Gate => (ctx.style.brollEnabled ? null : {reason: 'not_rendered:broll_disabled', detail: 'style.brollEnabled is false'});

/** ShortVideo.tsx:96 stageOwnsPictures. Definite for active / degraded stages; a condition when matteIntervals leave it undecided. */
function stageOwnership(ctx: Ctx): 'owns' | 'may_own' | 'no' {
  if (ctx.stage.kind === 'active' || ctx.stage.kind === 'degraded') return 'owns';
  if (ctx.stage.kind === 'active_unless_no_matte_coverage') return 'may_own';
  return 'no';
}

/** Overlap of [start, end) with the given windows, merged and clipped. */
function overlaps(start: number, end: number, windows: ReadonlyArray<{start: number; end: number}>): Array<{start: number; end: number}> {
  const cut = windows
    .map(window => ({start: Math.max(start, window.start), end: Math.min(end, window.end)}))
    .filter(window => window.end - window.start > 1e-6)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{start: number; end: number}> = [];
  for (const window of cut) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end + 1e-9) last.end = Math.max(last.end, window.end);
    else merged.push({...window});
  }
  return merged;
}

function overlayWindows(overlays: readonly Obj[], keep: (overlay: Obj) => boolean): Array<{start: number; end: number}> {
  return overlays.filter(keep).flatMap(overlay => {
    const start = num(overlay.start);
    const end = num(overlay.end);
    return start !== null && end !== null && end > start ? [{start, end}] : [];
  });
}

/** ShortVideo.tsx:403 BRollTrack: style.brollEnabled && !stageOwnsPictures && !split && !cutout && !explainerOn. */
function brollVisibility(ctx: Ctx, _item: Obj, start: number, end: number | null): Visibility | Gate {
  const own = stageOwnership(ctx);
  if (own === 'owns') return {reason: 'not_rendered:stage_owns_pictures', detail: 'an active or degraded Subject Stage owns the pictures (ShortVideo.tsx:96)'};
  if (ctx.explainerOn) return {reason: 'not_rendered:explainer_owns_pictures', detail: 'an explainer layout track composes the picture (ShortVideo.tsx:93-94, 403)'};
  const hidden = overlaps(start, end ?? start, overlayWindows(ctx.drawnOverlays, hidesBroll));
  const hiddenSec = hidden.reduce((sum, window) => sum + window.end - window.start, 0);
  if (end !== null && end - start > 1e-6 && hiddenSec >= end - start - 1e-6) return {reason: 'not_rendered:broll_hidden_by_split_or_cutout', detail: 'a split (with media) or cutout overlay covers the whole clip'};
  const conditions = own === 'may_own' ? ['subject_stage_may_own_pictures:matte_interval_coverage'] : [];
  if (hidden.length > 0) return {status: 'partially_hidden', conditions, hiddenDuring: hidden.map(window => outTime(window.start, window.end))};
  return conditions.length > 0 ? conditional(...conditions) : visible();
}

/** ShortVideo.tsx:97-100: overlays are drawn when B-roll is on and the stage does not own the pictures; with an explainer track, explainer media and picture-owning layouts move into the layouts. */
function overlayVisibility(ctx: Ctx, item: Obj): Visibility | Gate {
  const own = stageOwnership(ctx);
  if (own === 'owns') return {reason: 'not_rendered:stage_owns_pictures', detail: 'an active or degraded Subject Stage owns the pictures (ShortVideo.tsx:96-97)'};
  const conditions: string[] = [];
  if (own === 'may_own') conditions.push('subject_stage_may_own_pictures:matte_interval_coverage');
  if (ctx.explainerOn && (isExplainerMedia(item) || EXPLAINER_PICTURE_OWNING_OVERLAYS.includes(String(item.layout)))) conditions.push('drawn_only_through_explainer_layout');
  return conditions.length > 0 ? conditional(...conditions) : visible();
}

/** The classic stack (depth overlays, inset reveals, text behind subject, media containers) is replaced while a split / composite / cutout / explainer layout takes the picture. */
function classicStackVisibility(ctx: Ctx, _item: Obj, start: number, end: number | null): Visibility | Gate {
  const owners = overlayWindows(ctx.drawnOverlays, overlay => (['split', 'composite'].includes(String(overlay.layout)) && Boolean(overlay.assetUrl)) || overlay.layout === 'cutout');
  const conditions: string[] = [];
  if (overlaps(start, end ?? start + 1e-3, owners).length > 0) conditions.push('classic_stack_replaced_while_split_composite_or_cutout');
  if (ctx.explainerOn) conditions.push('explainer_layout_decides_picture');
  const generatedSplits = arrayOrEmpty(ctx.bp.generatedGraphics).filter(graphic => isObj(graphic.placement) && graphic.placement.mode === 'split_screen');
  if (ctx.style.generatedGraphicsEnabled && overlaps(start, end ?? start + 1e-3, overlayWindows(generatedSplits, () => true)).length > 0) conditions.push('generated_split_may_replace_picture');
  return conditions.length > 0 ? conditional(...conditions) : visible();
}

const arrayOrEmpty = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter(isObj) : []);

/** Frame placement of a Sequence-mounted event: from = secToFrame(start), the event's own frame count. */
const sequenceFrames = (ctx: Ctx, start: number, lengthFrames: number): OutputFrames => {
  const from = secToFrame(start, ctx.fps);
  return {domain: 'output_frames', fps: ctx.fps, startFrame: from, endFrameExclusive: from + lengthFrames, storedEnd: null};
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------------------------------------------------------------

function extractCuts(ctx: Ctx) {
  const segments = arrayOf(ctx, ctx.bp.keepSegments, 'keepSegments');
  segments.forEach((raw, index) => {
    if (index === 0) return;
    if (!isObj(raw)) {
      exclude(ctx, 'keepSegments', index, 'malformed_item', 'segment is not an object');
      return;
    }
    const prev = segments[index - 1];
    const at = num(raw.outputStart);
    if (!validSpan(ctx, 'keepSegments', index, at, null, false)) return;
    const prevEnd = isObj(prev) ? num(prev.sourceEnd) : null;
    const thisStart = num(raw.sourceStart);
    if (prevEnd !== null && thisStart !== null && Math.abs(thisStart - prevEnd) <= 1e-3) {
      exclude(ctx, 'keepSegments', index, 'contiguous_segments', 'continues the previous segment without a jump in the source');
      return;
    }
    const frame = secToFrame(at as number, ctx.fps); // timeline.ts segmentFrames: from = secToFrame(outputStart)
    ctx.candidates.push({
      type: 'cut',
      source: 'keepSegments',
      sourceIndex: index,
      time: outTime(at as number, null),
      frames: {domain: 'output_frames', fps: ctx.fps, startFrame: frame, endFrameExclusive: null, storedEnd: null},
      anchor: null,
      impact: frameImpact(frame, ctx.fps, 'hard_cut'),
      impactUnavailable: null,
      visibility: visible(),
      attrs: {segmentIndex: index},
      stored: null,
      idSec: at as number,
      content: raw,
    });
  });
}

function extractTransitions(ctx: Ctx) {
  const items = arrayOf(ctx, ctx.bp.transitions, 'transitions');
  const valid: Array<{index: number; item: Obj}> = [];
  items.forEach((raw, index) => {
    if (!isObj(raw)) {
      exclude(ctx, 'transitions', index, 'malformed_item', 'item is not an object');
      return;
    }
    if (!validSpan(ctx, 'transitions', index, num(raw.at), null, false)) return;
    valid.push({index, item: raw});
  });
  if (!ctx.style.brollEnabled) {
    for (const {index} of valid) exclude(ctx, 'transitions', index, 'not_rendered:broll_disabled', 'style.brollEnabled is false (ShortVideo.tsx:493)');
    return;
  }
  // The renderer de-duplicates over ALL clips it is given, so status is computed on the whole stored track.
  const status = transitionDrawStatus(items.map(item => (isObj(item) ? (item as never) : {at: Number.NaN, duration: 0})), ctx.fps, ctx.durationFrames);
  for (const {index, item} of valid) {
    const state = status[index]!;
    const at = item.at as number;
    if (!state.drawn) {
      const reason: ExclusionReason = state.reason === 'not_drawable' ? 'not_rendered:transition_not_drawable' : state.reason === 'invalid_window' ? 'not_rendered:transition_invalid_window' : 'not_rendered:transition_same_cut_as_earlier';
      exclude(ctx, 'transitions', index, reason, state.reason);
      continue;
    }
    const procedural = item.assetUrl ? null : proceduralStyleOf(typeof item.keyword === 'string' ? item.keyword : undefined);
    if (procedural === 'hard_cut') {
      exclude(ctx, 'transitions', index, 'not_rendered:hard_cut_marker_draws_nothing', 'procedural hard_cut draws no overlay (proceduralTransition.ts)');
      continue;
    }
    const {from, durationInFrames} = state;
    let impact: Impact | null = null;
    let unavailable: ImpactUnavailable | null = null;
    if (item.assetUrl) unavailable = 'asset_content_dependent';
    else {
      const peak = procedural ? firstPeakFrame(durationInFrames, frame => proceduralStrength(procedural, frame, durationInFrames)) : firstPeakFrame(durationInFrames, frame => generatedSweepStrength(frame, durationInFrames));
      if (peak === null) unavailable = 'degenerate_window';
      else impact = frameImpact(from + peak, ctx.fps, procedural ? 'transition_procedural_peak' : 'transition_generated_sweep_peak');
    }
    ctx.candidates.push({
      type: 'transition',
      source: 'transitions',
      sourceIndex: index,
      time: outTime(from / ctx.fps, (from + durationInFrames) / ctx.fps),
      frames: {domain: 'output_frames', fps: ctx.fps, startFrame: from, endFrameExclusive: from + durationInFrames, storedEnd: null},
      anchor: instant(at),
      impact,
      impactUnavailable: unavailable,
      visibility: visible(),
      attrs: {...pickAttrs(item, ['keyword', 'duration', 'blend', 'provider']), drawnAs: item.assetUrl ? 'asset' : procedural ? `procedural:${procedural}` : 'generated_sweep'},
      stored: null,
      idSec: at,
      content: item,
    });
  }
}

function extractImpactFx(ctx: Ctx) {
  const fx = ctx.bp.impactFx;
  if (fx === undefined || fx === null) return;
  if (!isObj(fx)) {
    exclude(ctx, 'impactFx', null, 'malformed_track', 'impactFx is not an object');
    return;
  }
  const gate = (): Gate => (ctx.style.brollEnabled ? null : {reason: 'not_rendered:broll_disabled', detail: 'style.brollEnabled is false (ShortVideo.tsx:214, 497)'});
  // lib/impactFx.ts: every event starts at frame round(startSec * fps) and lasts `frames` frames.
  const framed = (impactSource: Impact['source'] | null) => (c: Ctx, item: Obj, start: number) => {
    const frames = sequenceFrames(c, start, Math.max(1, Math.round(num(item.frames) ?? 1)));
    return {frames, ...(impactSource ? {impact: frameImpact(frames.startFrame, c.fps, impactSource)} : {})};
  };
  extractSpans(ctx, arrayOf(ctx, fx.flashes, 'impactFx.flashes'), {source: 'impactFx.flashes', type: 'impact_flash', startKey: 'startSec', framesKey: 'frames', attrs: ['frames', 'reason'], gate, placement: framed('impact_fx_flash')});
  extractSpans(ctx, arrayOf(ctx, fx.satPops, 'impactFx.satPops'), {source: 'impactFx.satPops', type: 'impact_sat_pop', startKey: 'startSec', framesKey: 'frames', attrs: ['frames'], gate, placement: framed(null)});
  extractSpans(ctx, arrayOf(ctx, fx.punchIns, 'impactFx.punchIns'), {source: 'impactFx.punchIns', type: 'impact_punch_in', startKey: 'startSec', endKey: 'endSec', attrs: ['rampFrames', 'scale'], gate});
  extractSpans(ctx, arrayOf(ctx, fx.bwSpans, 'impactFx.bwSpans'), {source: 'impactFx.bwSpans', type: 'impact_bw_span', startKey: 'startSec', endKey: 'endSec', attrs: [], gate});
}

/** ShortVideo.tsx:117-118 and 532-546 (hook), 524-529 (opening). */
function extractHookAndOpening(ctx: Ctx) {
  const bp = ctx.bp;
  if (bp.hookTitle !== undefined && bp.hookTitle !== null && typeof bp.hookTitle !== 'string') exclude(ctx, 'hookTitle', null, 'malformed_track', 'hookTitle is not a string');
  const title = typeof bp.hookTitle === 'string' ? bp.hookTitle : '';
  // HookTitle.tsx:59 draws nothing for a blank title, so a whitespace-only title is no event at all.
  if (title.trim()) {
    // Exactly the renderer's expressions, coercions included.
    const hookDurationSec = Math.max(1.2, (bp.hookDurationSec as number) || 3);
    const hookStartSec = Math.max(0, (bp.hookStartSec as number) || 0);
    if (!Number.isFinite(hookDurationSec) || !Number.isFinite(hookStartSec)) {
      exclude(ctx, 'hookTitle', 0, 'non_finite_time', 'hook timing is not finite after the renderer defaults');
    } else if (bp.openingTreatment) {
      exclude(ctx, 'hookTitle', 0, 'not_rendered:opening_replaces_hook', 'an art-directed opening replaces the hook title (ShortVideo.tsx:538)');
    } else {
      const frames = sequenceFrames(ctx, hookStartSec, Math.max(1, Math.round(hookDurationSec * ctx.fps)));
      const start = frames.startFrame / ctx.fps;
      const end = (frames.endFrameExclusive as number) / ctx.fps;
      if (validSpan(ctx, 'hookTitle', 0, start, end, true)) {
        ctx.candidates.push({
          type: 'hook_title',
          source: 'hookTitle',
          sourceIndex: 0,
          time: outTime(start, end),
          frames,
          anchor: null,
          impact: null,
          impactUnavailable: 'not_established_for_type',
          visibility: visible(),
          attrs: {text: title.trim().slice(0, TEXT_MAX), effectiveStartSec: round3(hookStartSec), effectiveDurationSec: round3(hookDurationSec)},
          stored: null,
          idSec: hookStartSec,
          content: {title, hookStartSec, hookDurationSec},
        });
      }
    }
  }
  const opening = bp.openingTreatment;
  if (opening === undefined || opening === null) return;
  if (!isObj(opening)) {
    exclude(ctx, 'openingTreatment', null, 'malformed_track', 'openingTreatment is not an object');
    return;
  }
  // blueprintSchema.ts openingTreatmentSchema: startSec default 0, durationSec default 3 (applied when the field is absent).
  const startSec = opening.startSec === undefined ? 0 : num(opening.startSec);
  const durationSec = opening.durationSec === undefined ? 3 : num(opening.durationSec);
  if (startSec === null || durationSec === null) {
    exclude(ctx, 'openingTreatment', 0, 'non_finite_time', 'startSec or durationSec is not a finite number');
    return;
  }
  const frames = sequenceFrames(ctx, startSec, Math.max(1, Math.round(durationSec * ctx.fps)));
  const start = frames.startFrame / ctx.fps;
  const end = (frames.endFrameExclusive as number) / ctx.fps;
  if (!validSpan(ctx, 'openingTreatment', 0, start, end, true)) return;
  ctx.candidates.push({
    type: 'opening_treatment',
    source: 'openingTreatment',
    sourceIndex: 0,
    time: outTime(start, end),
    frames,
    anchor: null,
    impact: null,
    impactUnavailable: 'not_established_for_type',
    visibility: visible(),
    attrs: {...pickAttrs(opening, ['kind', 'text']), effectiveStartSec: round3(startSec), effectiveDurationSec: round3(durationSec)},
    stored: null,
    idSec: startSec,
    content: opening,
  });
}

function extractSubjectStage(ctx: Ctx) {
  const stage = ctx.bp.subjectStage;
  if (stage === undefined || stage === null) return;
  if (!isObj(stage)) {
    exclude(ctx, 'subjectStage', null, 'malformed_track', 'subjectStage is not an object');
    return;
  }
  const status = ctx.stage;
  let gate: Gate = null;
  if (status.kind === 'not_owner') gate = {reason: status.reason === 'kinetic_owns_person_layer' ? 'not_rendered:kinetic_owns_person_layer' : 'not_rendered:subject_foreground_owns_person_layer', detail: 'ShortVideo.tsx:199 ignores the Subject Stage'};
  else if (status.kind === 'inactive') gate = {reason: `not_rendered:stage_inactive_${status.reason}` as ExclusionReason, detail: `stageCompositing: ${status.reason}`};
  const base: string[] = status.kind === 'degraded' ? [] : ['subject_stage_matte_fetched_at_render'];
  if (status.kind === 'active_unless_no_matte_coverage') base.push('subject_stage_matte_interval_coverage');
  const layered = status.kind === 'degraded'
    ? ['degraded_render_draws_only_matte_independent_elements']
    : ['stage_layer_drawn_only_while_person_foreground_covers_frame'];
  const gateFn = () => gate;
  const sub = (key: string) => arrayOf(ctx, stage[key], `subjectStage.${key}`);
  extractSpans(ctx, sub('spans'), {source: 'subjectStage.spans', type: 'stage_span', startKey: 'start', endKey: 'end', attrs: ['stage', 'enter'], gate: gateFn, visibility: () => conditional(...base, ...layered)});
  extractSpans(ctx, sub('accents'), {source: 'subjectStage.accents', type: 'stage_accent', startKey: 'start', endKey: 'end', attrs: ['kind', 'slot'], gate: gateFn, visibility: () => conditional(...base, ...layered)});
  // Cutaways are drawn by SubjectStageFront in both the active and the degraded render.
  extractSpans(ctx, sub('cutaways'), {source: 'subjectStage.cutaways', type: 'stage_cutaway', startKey: 'start', endKey: 'end', attrs: ['mediaKind', 'enter', 'exit'], gate: gateFn, visibility: () => (base.length > 0 ? conditional(...base) : visible())});
}

function extractKinetic(ctx: Ctx) {
  const spec = ctx.bp.kinetic;
  if (spec === undefined || spec === null) return;
  if (!isObj(spec)) {
    exclude(ctx, 'kinetic', null, 'malformed_track', 'kinetic is not an object');
    return;
  }
  const specFps = num(spec.fps);
  if (specFps === null || Math.abs(specFps - ctx.fps) > 1e-9) {
    exclude(ctx, 'kinetic', null, 'kinetic_fps_mismatch', `kinetic fps ${String(spec.fps)} != blueprint fps ${ctx.fps}; frame domain ambiguous`);
    return;
  }
  const expectedFrames = Math.ceil(ctx.durationSec * ctx.fps - 1e-9);
  const specFrames = num(spec.durationInFrames);
  if (specFrames === null || Math.abs(specFrames - expectedFrames) > 1) {
    exclude(ctx, 'kinetic', null, 'kinetic_duration_mismatch', `durationInFrames ${String(spec.durationInFrames)} != ceil(outputDurationSec * fps) ${expectedFrames}; frames may not be output frames`);
    return;
  }
  const fps = ctx.fps;
  const intFrame = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null);
  const events = arrayOf(ctx, spec.events, 'kinetic.events');
  events.forEach((raw, index) => {
    if (!isObj(raw)) {
      exclude(ctx, 'kinetic.events', index, 'malformed_item', 'event is not an object');
      return;
    }
    if (raw.fps !== undefined && (num(raw.fps) === null || Math.abs((raw.fps as number) - fps) > 1e-9)) {
      exclude(ctx, 'kinetic.events', index, 'kinetic_fps_mismatch', `event fps ${String(raw.fps)} != ${fps}`);
      return;
    }
    const storedId = typeof raw.id === 'string' && raw.id ? raw.id : null;
    const inFrame = intFrame(raw.inFrame);
    const outFrame = intFrame(raw.outFrame);
    if (inFrame === null || outFrame === null) exclude(ctx, 'kinetic.events', index, 'non_finite_time', 'inFrame / outFrame missing or not integers');
    // KineticTrack.tsx:55 draws while inFrame <= frame <= outFrame: outFrame is INCLUSIVE, so the event stops being shown at outFrame + 1,
    // or at the end of the composition, whichever comes first (a frame past the composition is never rendered).
    else if (inFrame >= ctx.durationFrames) exclude(ctx, 'kinetic.events', index, 'start_out_of_range', `inFrame ${inFrame} >= composition frames ${ctx.durationFrames}`);
    else if (validSpan(ctx, 'kinetic.events', index, inFrame / fps, Math.min(outFrame + 1, ctx.durationFrames) / fps, true)) {
      const endEx = Math.min(outFrame + 1, ctx.durationFrames);
      const lines = Array.isArray(raw.lines) ? raw.lines.filter(isObj) : [];
      const text = lines.map(line => (typeof line.text === 'string' ? line.text : '')).filter(Boolean).join(' ');
      const range = Array.isArray(raw.wordRange) ? raw.wordRange : [];
      ctx.candidates.push({
        type: 'kinetic_event',
        source: 'kinetic.events',
        sourceIndex: index,
        time: outTime(inFrame / fps, endEx / fps),
        frames: {domain: 'output_frames', fps, startFrame: inFrame, endFrameExclusive: endEx, storedEnd: {field: 'outFrame', value: outFrame, convention: 'inclusive'}},
        anchor: null,
        impact: null,
        // The block pose (keyframes) and per-word frames exist, but no renderer rule names an arrival frame; none is invented.
        impactUnavailable: 'not_established_for_type',
        visibility: visible(),
        attrs: {
          ...pickAttrs(raw, ['preset', 'presetResolved', 'layering', 'style', 'exit']),
          ...(text ? {text: text.slice(0, TEXT_MAX)} : {}),
          ...(num(range[0]) !== null ? {wordStart: range[0] as number} : {}),
          ...(num(range[1]) !== null ? {wordEnd: range[1] as number} : {}),
          ...(endEx < outFrame + 1 ? {clippedToCompositionEnd: true} : {}),
        },
        stored: storedId ? {namespace: 'kin', id: storedId} : null,
        idSec: inFrame / fps,
        content: raw,
      });
    }
    // The light leak is drawn on the front layer for every event, independent of the event's own window (KineticTrack.tsx:102, LightLeak 14-22).
    if (isObj(raw.flash)) {
      const flash = raw.flash;
      const startFrame = intFrame(flash.startFrame);
      const opacities = Array.isArray(flash.opacities) ? flash.opacities.map(value => (typeof value === 'number' && Number.isFinite(value) ? value : 0)) : null;
      if (startFrame === null || opacities === null) {
        exclude(ctx, 'kinetic.events.flash', index, 'non_finite_time', 'flash startFrame / opacities missing');
        return;
      }
      const drawn = opacities.map((value, offset) => ({value, offset})).filter(item => item.value > 0.001);
      if (drawn.length === 0) {
        exclude(ctx, 'kinetic.events.flash', index, 'not_rendered:kinetic_flash_all_transparent', 'every opacity <= 0.001');
        return;
      }
      const first = drawn[0]!.offset;
      const last = Math.min(drawn[drawn.length - 1]!.offset, ctx.durationFrames - 1 - startFrame);
      if (startFrame + first >= ctx.durationFrames) {
        exclude(ctx, 'kinetic.events.flash', index, 'start_out_of_range', 'flash starts after the composition ends');
        return;
      }
      const peak = drawn.filter(item => item.offset <= last).reduce((best, item) => (item.value > best.value + 1e-12 ? item : best), drawn[0]!).offset;
      if (!validSpan(ctx, 'kinetic.events.flash', index, (startFrame + first) / fps, (startFrame + last + 1) / fps, true)) return;
      ctx.candidates.push({
        type: 'kinetic_flash',
        source: 'kinetic.events.flash',
        sourceIndex: index,
        time: outTime((startFrame + first) / fps, (startFrame + last + 1) / fps),
        frames: {domain: 'output_frames', fps, startFrame: startFrame + first, endFrameExclusive: startFrame + last + 1, storedEnd: {field: 'startFrame + opacities.length', value: startFrame + opacities.length, convention: 'exclusive'}},
        anchor: null,
        impact: frameImpact(startFrame + peak, fps, 'kinetic_flash_peak_opacity'),
        impactUnavailable: null,
        visibility: visible(),
        attrs: pickAttrs(flash, ['color']),
        stored: storedId ? {namespace: 'kinflash', id: storedId} : null,
        idSec: (startFrame + first) / fps,
        content: flash,
      });
    }
  });
  arrayOf(ctx, spec.captions, 'kinetic.captions').forEach((raw, index) => {
    if (!isObj(raw)) {
      exclude(ctx, 'kinetic.captions', index, 'malformed_item', 'caption is not an object');
      return;
    }
    const inFrame = intFrame(raw.inFrame);
    const outFrame = intFrame(raw.outFrame);
    if (inFrame === null || outFrame === null) {
      exclude(ctx, 'kinetic.captions', index, 'non_finite_time', 'inFrame / outFrame missing or not integers');
      return;
    }
    // KineticTrack.tsx:26 draws while inFrame <= frame < outFrame: outFrame is EXCLUSIVE (and never past the composition).
    if (inFrame >= ctx.durationFrames) {
      exclude(ctx, 'kinetic.captions', index, 'start_out_of_range', `inFrame ${inFrame} >= composition frames ${ctx.durationFrames}`);
      return;
    }
    const capEnd = Math.min(outFrame, ctx.durationFrames);
    if (!validSpan(ctx, 'kinetic.captions', index, inFrame / fps, capEnd / fps, true)) return;
    ctx.candidates.push({
      type: 'kinetic_gap_caption',
      source: 'kinetic.captions',
      sourceIndex: index,
      time: outTime(inFrame / fps, capEnd / fps),
      frames: {domain: 'output_frames', fps, startFrame: inFrame, endFrameExclusive: capEnd, storedEnd: {field: 'outFrame', value: outFrame, convention: 'exclusive'}},
      anchor: null,
      impact: null,
      impactUnavailable: 'not_established_for_type',
      visibility: visible(),
      attrs: pickAttrs(raw, ['text', 'wordIdx']),
      stored: null,
      idSec: inFrame / fps,
      content: raw,
    });
  });
}

function extractExplainer(ctx: Ctx) {
  const layoutGate = (c: Ctx): Gate => (c.style.brollEnabled ? null : {reason: 'not_rendered:broll_disabled', detail: 'the explainer track is read only when style.brollEnabled (ShortVideo.tsx:93)'});
  const track = arrayOf(ctx, ctx.bp.explainerLayoutTrack, 'explainerLayoutTrack');
  const firstStart = Math.min(...track.filter(isObj).map(span => num(span.start) ?? Infinity));
  extractSpans(ctx, track, {
    source: 'explainerLayoutTrack',
    type: 'explainer_layout',
    startKey: 'start',
    endKey: 'end',
    attrs: ['layout'],
    gate: layoutGate,
    // explainerMount.ts activeExplainerSpanAt: a span takes over at frame round(start * fps), a hard cut. The first span is shown from frame 0, so it has no cut of its own.
    placement: (c, _item, start) => (start > firstStart ? {impact: frameImpact(Math.round(start * c.fps), c.fps, 'layout_hard_cut')} : {}),
  });
  extractSpans(ctx, arrayOf(ctx, ctx.bp.explainerClaimBeats, 'explainerClaimBeats'), {
    source: 'explainerClaimBeats',
    type: 'explainer_claim',
    startKey: 'start',
    endKey: 'end',
    attrs: ['phrase', 'phraseStart', 'phraseEnd', 'kind'],
    gate: c => (c.explainerOn ? null : {reason: 'not_rendered:explainer_off', detail: 'claim beats are drawn only inside an explainer layout span (ShortVideo.tsx:309)'}),
    visibility: () => conditional('drawn_only_inside_a_matching_explainer_span'),
  });
}

function extractGeneratedGraphics(ctx: Ctx) {
  extractSpans(ctx, arrayOf(ctx, ctx.bp.generatedGraphics, 'generatedGraphics'), {
    source: 'generatedGraphics',
    type: 'generated_graphic',
    startKey: 'start',
    endKey: 'end',
    attrs: [],
    gate: c => (c.style.generatedGraphicsEnabled ? null : {reason: 'not_rendered:generated_graphics_disabled', detail: 'style.generatedGraphicsEnabled is false (ShortVideo.tsx:104)'}),
    // ShortVideo.tsx:420: drawn only when the compiled module loads at render time.
    visibility: () => conditional('graphic_module_loads_at_render'),
    extraAttrs: item => {
      const attrs: Record<string, EventAttrValue> = {};
      if (isObj(item.placement) && typeof item.placement.mode === 'string') attrs.placementMode = item.placement.mode;
      if (isObj(item.props) && typeof item.props.recipeId === 'string') attrs.recipeId = item.props.recipeId;
      return attrs;
    },
    storedId: item => (typeof item.id === 'string' && item.id ? {namespace: 'gfx', id: item.id} : null),
  });
}

const SIMPLE_SPANS: readonly SpanSpec[] = [
  {source: 'zoomTriggers', type: 'zoom', startKey: 'start', endKey: 'end', attrs: ['scale', 'sentenceIndex'], gate: c => (c.style.zoomEnabled ? null : {reason: 'not_rendered:zoom_disabled', detail: 'style.zoomEnabled is false (ShortVideo.tsx:232)'})},
  {source: 'brollClips', type: 'broll', startKey: 'start', endKey: 'end', attrs: ['keyword', 'provider'], gate: brollGate, visibility: brollVisibility},
  {source: 'depthOverlays', type: 'depth_overlay', startKey: 'start', endKey: 'end', attrs: ['type', 'keyword', 'mediaKind'], gate: brollGate, visibility: classicStackVisibility},
  {source: 'insetReveals', type: 'inset_reveal', startKey: 'start', endKey: 'end', attrs: ['type', 'keyword'], visibility: classicStackVisibility},
  {source: 'visualOverlays', type: 'visual_overlay', startKey: 'start', endKey: 'end', attrs: ['layout', 'mediaKind', 'keyword', 'overlayText'], gate: brollGate, visibility: overlayVisibility},
  {source: 'motionGraphics', type: 'motion_graphic', startKey: 'start', endKey: 'end', attrs: ['role', 'shape', 'entrance', 'text']},
  {source: 'mediaContainers', type: 'media_container', startKey: 'start', endKey: 'end', attrs: ['mode', 'transitionSec'], visibility: classicStackVisibility},
  {source: 'frameInsets', type: 'frame_inset', startKey: 'start', endKey: 'end', attrs: ['transitionSec', 'scale']},
  {source: 'semanticEmphasis', type: 'semantic_emphasis', startKey: 'start', endKey: 'end', attrs: ['text', 'treatment', 'weight']},
  {source: 'behindSubjectTexts', type: 'behind_subject_text', startKey: 'start', endKey: 'end', attrs: ['text', 'reveal'], visibility: classicStackVisibility},
  {source: 'gradeBeats', type: 'grade_beat', startKey: 'startSec', endKey: 'endSec', attrs: []},
  {source: 'newsroomLayoutTrack', type: 'newsroom_layout', startKey: 'start', endKey: 'end', attrs: ['layout'], gate: () => ({reason: 'not_rendered:no_renderer_reads_track', detail: 'no remotion/src file reads newsroomLayoutTrack'})},
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------------------------------------------

function assignIds(candidates: Candidate[]): SheetEvent[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const base = candidate.stored ? `${candidate.stored.namespace}:${escapeStoredId(candidate.stored.id)}` : `${TIME_PREFIX[candidate.type]}@${Math.round(candidate.idSec * 1000)}`;
    const group = groups.get(base) ?? [];
    group.push(candidate);
    groups.set(base, group);
  }
  const events: SheetEvent[] = [];
  for (const [base, group] of groups) {
    const keyed = group.map(candidate => ({candidate, key: `${candidate.type}|${canonicalJson(candidate.content)}`}));
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const firstIdByKey = new Map<string, string>();
    keyed.forEach(({candidate, key}, index) => {
      const id = index === 0 ? base : `${base}~${index + 1}`;
      const duplicateOf = firstIdByKey.get(key) ?? null;
      if (!duplicateOf) firstIdByKey.set(key, id);
      events.push({
        id,
        type: candidate.type,
        source: candidate.source,
        sourceIndex: candidate.sourceIndex,
        time: candidate.time,
        frames: candidate.frames,
        anchor: candidate.anchor,
        impact: candidate.impact,
        impactUnavailable: candidate.impactUnavailable,
        visibility: candidate.visibility,
        attrs: candidate.attrs,
        duplicateOf,
      });
    });
  }
  events.sort((a, b) => a.time.startSec - b.time.startSec || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) throw new Error(`Event Sheet invariant broken: duplicate event id ${event.id}`);
    seen.add(event.id);
  }
  return events;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Speech, narrative, coverage
// ---------------------------------------------------------------------------------------------------------------------------------

function extractSpeech(bp: Obj, durationSec: number, tolSec: number): {words: SpeechWord[]; excluded: ExcludedEvent[]} {
  const words: SpeechWord[] = [];
  const excluded: ExcludedEvent[] = [];
  const raw = bp.captionWords;
  if (raw === undefined || raw === null) return {words, excluded};
  if (!Array.isArray(raw)) return {words, excluded: [{source: 'captionWords', sourceIndex: null, reason: 'malformed_track', detail: 'expected an array'}]};
  raw.forEach((word, index) => {
    if (!isObj(word) || typeof word.text !== 'string') {
      excluded.push({source: 'captionWords', sourceIndex: index, reason: 'malformed_item', detail: 'word is not {text, start, end}'});
      return;
    }
    const start = num(word.start);
    const end = num(word.end);
    if (start === null || end === null) {
      excluded.push({source: 'captionWords', sourceIndex: index, reason: 'non_finite_time', detail: 'start or end not finite'});
      return;
    }
    if (start < -1e-6 || start > durationSec + tolSec || end > durationSec + tolSec || end < start - 1e-6) {
      excluded.push({source: 'captionWords', sourceIndex: index, reason: start > durationSec + tolSec || start < -1e-6 ? 'start_out_of_range' : end < start ? 'end_before_start' : 'end_out_of_range', detail: `${start}..${end} vs duration ${durationSec}`});
      return;
    }
    words.push({id: `w${index}`, text: word.text, time: outTime(start, end), sentenceIndex: num(word.sentenceIndex)});
  });
  return {words, excluded};
}

const STORY_KEYS = ['content_type', 'tone', 'emotional_arc', 'hook', 'beats', 'existing_cta', 'core_message', 'audience', 'promise', 'pacing'];

/** Availability of persisted story-analyst output (server type DirectorStageArtifact.output: unknown). Never parsed or validated beyond its shape here. */
export function narrativeAvailability(bp: Obj): NarrativeAvailability {
  const base = {path: 'directorReport.stages.story.output' as const, promptVersion: null as string | null, keys: [] as string[]};
  const report = bp.directorReport;
  if (report === undefined || report === null) return {...base, status: 'absent', detail: 'no directorReport'};
  if (!isObj(report)) return {...base, status: 'malformed', detail: 'directorReport is not an object'};
  if (report.stages === undefined || report.stages === null) return {...base, status: 'absent', detail: 'directorReport has no stages'};
  if (!isObj(report.stages)) return {...base, status: 'malformed', detail: 'directorReport.stages is not an object'};
  const story = report.stages.story;
  if (story === undefined || story === null) return {...base, status: 'absent', detail: 'no story stage (Director v2 did not run story analysis)'};
  if (!isObj(story)) return {...base, status: 'malformed', detail: 'stages.story is not an object'};
  const promptVersion = typeof story.promptVersion === 'string' ? story.promptVersion : null;
  const output = story.output;
  if (output === undefined) return {...base, promptVersion, status: 'absent', detail: 'story stage has no output'};
  if (output === null) return {...base, promptVersion, status: 'empty', detail: 'output is null'};
  if (!isObj(output)) return {...base, promptVersion, status: 'malformed', detail: `output is ${Array.isArray(output) ? 'an array' : typeof output}`};
  const keys = Object.keys(output).sort();
  if (keys.length === 0) return {...base, promptVersion, keys, status: 'empty', detail: 'output is {} (test stubs write this)'};
  if (!keys.some(key => STORY_KEYS.includes(key))) return {...base, promptVersion, keys, status: 'malformed', detail: 'output has none of the expected story-analyst keys'};
  return {...base, promptVersion, keys, status: 'available', detail: 'present; not parsed here'};
}

function coverageOf(bp: Obj): CoverageEntry[] {
  const rules: Array<[string, FieldRule]> = [...Object.entries(BLUEPRINT_FIELD_RULES as Record<string, FieldRule>), ...Object.entries(EXTRA_FIELD_RULES)];
  return rules
    .map(([field, rule]) => ({field, class: rule.class, role: rule.role, present: bp[field] !== undefined}))
    .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------------------------

function parseSegments(value: unknown): KeepSegmentLike[] | null {
  if (!Array.isArray(value)) return null;
  const segments: KeepSegmentLike[] = [];
  for (const item of value) {
    if (!isObj(item)) return null;
    const sourceStart = num(item.sourceStart);
    const sourceEnd = num(item.sourceEnd);
    const outputStart = num(item.outputStart);
    if (sourceStart === null || sourceEnd === null || outputStart === null) return null;
    segments.push({sourceStart, sourceEnd, outputStart});
  }
  return segments;
}

export function buildEventSheet(input: unknown, options: BuildEventSheetOptions = {}): EditEventSheet {
  const bp = unwrapSavedBlueprint(input);
  assertFullyClassified(bp);
  assertNestedClassified(bp);
  const fps = num(bp.fps);
  const durationSec = num(bp.outputDurationSec);
  if (fps === null || fps <= 0) throw new InvalidBlueprintError(`fps must be a positive finite number, got ${String(bp.fps)}`);
  if (durationSec === null || durationSec < 0) throw new InvalidBlueprintError(`outputDurationSec must be a finite number >= 0, got ${String(bp.outputDurationSec)}`);
  const style = resolveRenderStyle(options.renderStyle);
  const segments = parseSegments(bp.keepSegments) ?? [];
  if (!style.trimEnabled) {
    // ShortVideo.tsx resolveSegments: with trim off the composition plays the whole source once. Output-time tracks then match the rendered clock
    // only if the edit did not trim anything; otherwise every timestamp would be wrong, so the sheet refuses instead of guessing.
    const sourceSec = num(bp.sourceDurationSec);
    const untrimmed = segments.length <= 1 && (segments[0]?.sourceStart ?? 0) <= 1e-3 && (segments[0]?.outputStart ?? 0) <= 1e-3 && sourceSec !== null && Math.abs(sourceSec - durationSec) <= 1 / fps;
    if (!untrimmed) throw new InvalidBlueprintError('renderStyle.trimEnabled is false but the blueprint is trimmed: its output-time tracks do not match the rendered clock.');
  }
  const durationFrames = compositionFrames(segments, durationSec, fps);
  const stage = subjectStageStatus(bp);
  const explainerOn = style.brollEnabled && Array.isArray(bp.explainerLayoutTrack) && bp.explainerLayoutTrack.length > 0;
  const stageOwns = stage.kind === 'active' || stage.kind === 'degraded';
  const allOverlays = style.brollEnabled && !stageOwns ? arrayOrEmpty(bp.visualOverlays) : [];
  const drawnOverlays = explainerOn ? allOverlays.filter(overlay => !isExplainerMedia(overlay) && !EXPLAINER_PICTURE_OWNING_OVERLAYS.includes(String(overlay.layout))) : allOverlays;
  const tolSec = 1 / fps + 1e-6;
  const ctx: Ctx = {bp, fps, durationSec, durationFrames, tolSec, style, stage, explainerOn, drawnOverlays, candidates: [], excluded: []};

  extractCuts(ctx);
  if (!style.trimEnabled) for (const candidate of ctx.candidates.filter(item => item.type === 'cut')) exclude(ctx, 'keepSegments', candidate.sourceIndex, 'not_rendered:trim_disabled', 'style.trimEnabled is false');
  if (!style.trimEnabled) ctx.candidates = ctx.candidates.filter(item => item.type !== 'cut');
  for (const spec of SIMPLE_SPANS) extractSpans(ctx, arrayOf(ctx, bp[spec.source], spec.source), spec);
  extractTransitions(ctx);
  extractGeneratedGraphics(ctx);
  extractImpactFx(ctx);
  extractExplainer(ctx);
  extractHookAndOpening(ctx);
  extractSubjectStage(ctx);
  extractKinetic(ctx);
  if (options.kineticLines === true) extractKineticLines(ctx);

  const events = assignIds(ctx.candidates);
  const excluded = [...ctx.excluded].sort(
    (a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) || (a.sourceIndex ?? -1) - (b.sourceIndex ?? -1) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  );
  const speech = extractSpeech(bp, durationSec, tolSec);
  const renderStyle = {trimEnabled: style.trimEnabled, brollEnabled: style.brollEnabled, zoomEnabled: style.zoomEnabled, generatedGraphicsEnabled: style.generatedGraphicsEnabled, source: style.source, assumedFlags: [...style.assumedFlags]};
  const core = {version: EVENT_SHEET_VERSION, fps, durationSec: round3(durationSec), durationFrames, renderStyle, events, speech};
  return {
    version: EVENT_SHEET_VERSION,
    blueprintId: typeof bp.blueprintId === 'string' ? bp.blueprintId : null,
    timingHash: timingHash(core),
    visualContentHash: visualContentHash(bp, renderStyle),
    fps,
    durationSec: round3(durationSec),
    durationFrames,
    renderStyle,
    sourceHasAudio: typeof bp.sourceHasAudio === 'boolean' ? bp.sourceHasAudio : null,
    events,
    excluded,
    speech,
    narrative: narrativeAvailability(bp),
    coverage: coverageOf(bp),
  };
}


/** Opt-in word-level Kinetic events (see eventSheet/kineticLines.ts). Only for stored kinetic events that produced a drawn kinetic_event. */
function extractKineticLines(ctx: Ctx) {
  const spec = isObj(ctx.bp.kinetic) ? ctx.bp.kinetic : null;
  if (!spec || !Array.isArray(spec.events)) return;
  const fps = ctx.fps;
  const width = num(ctx.bp.width) ?? 1080;
  const drawn = ctx.candidates.filter(candidate => candidate.type === 'kinetic_event');
  for (const parent of drawn) {
    const raw = spec.events[parent.sourceIndex];
    if (!isObj(raw) || !parent.frames || parent.frames.endFrameExclusive === null) continue;
    const inFrame = parent.frames.startFrame;
    const lastDrawn = parent.frames.endFrameExclusive - 1;
    const parentId = typeof raw.id === 'string' && raw.id ? raw.id : null;
    const style = typeof raw.style === 'string' ? raw.style : null;
    for (const fact of kineticLineFacts(raw, inFrame, lastDrawn, width)) {
      ctx.candidates.push({
        type: 'kinetic_line',
        source: 'kinetic.events.lines',
        sourceIndex: parent.sourceIndex,
        time: outTime(fact.firstVisibleFrame / fps, (lastDrawn + 1) / fps),
        frames: {domain: 'output_frames', fps, startFrame: fact.firstVisibleFrame, endFrameExclusive: lastDrawn + 1, storedEnd: null},
        anchor: null,
        impact: frameImpact(fact.landingFrame, fps, 'kinetic_line_landing'),
        impactUnavailable: null,
        visibility: visible(),
        attrs: {
          role: fact.role,
          anim: fact.anim,
          ...(fact.text ? {text: fact.text.slice(0, TEXT_MAX)} : {}),
          ...(style ? {style} : {}),
          direction: fact.motion.direction,
          intensity: fact.motion.intensity,
          arrivalFrames: fact.motion.arrivalFrames,
          overshoot: fact.motion.overshoot,
          speechSec: round3(fact.speechFrame / fps),
          fontPx: fact.fontPx,
          uppercase: fact.uppercase,
          lineIndex: fact.lineIndex,
        },
        stored: parentId ? {namespace: 'kin', id: `${parentId}.w${fact.lineIndex}`} : null,
        idSec: fact.landingFrame / fps,
        content: {parent: parentId, line: fact.lineIndex, landing: fact.landingFrame},
      });
      if (fact.exitFrame !== null) {
        ctx.candidates.push({
          type: 'kinetic_exit',
          source: 'kinetic.events.lines.exit',
          sourceIndex: parent.sourceIndex,
          time: outTime(fact.exitFrame / fps, (lastDrawn + 1) / fps),
          frames: {domain: 'output_frames', fps, startFrame: fact.exitFrame, endFrameExclusive: lastDrawn + 1, storedEnd: null},
          anchor: null,
          impact: frameImpact(fact.exitFrame, fps, 'kinetic_exit_start'),
          impactUnavailable: null,
          visibility: visible(),
          attrs: {scope: 'word', exit: 'X2', role: fact.role, ...(fact.text ? {text: fact.text.slice(0, TEXT_MAX)} : {})},
          stored: parentId ? {namespace: 'kin', id: `${parentId}.w${fact.lineIndex}.exit`} : null,
          idSec: fact.exitFrame / fps,
          content: {parent: parentId, line: fact.lineIndex, exit: fact.exitFrame},
        });
      }
    }
    const blockExit = blockExitFrame(raw, inFrame, lastDrawn);
    if (blockExit !== null) {
      ctx.candidates.push({
        type: 'kinetic_exit',
        source: 'kinetic.events.exit',
        sourceIndex: parent.sourceIndex,
        time: outTime(blockExit / fps, (lastDrawn + 1) / fps),
        frames: {domain: 'output_frames', fps, startFrame: blockExit, endFrameExclusive: lastDrawn + 1, storedEnd: null},
        anchor: null,
        impact: frameImpact(blockExit, fps, 'kinetic_exit_start'),
        impactUnavailable: null,
        visibility: visible(),
        attrs: {scope: 'block', exit: typeof raw.exit === 'string' ? raw.exit : 'unknown', ...(parent.attrs.text !== undefined ? {text: parent.attrs.text} : {})},
        stored: parentId ? {namespace: 'kin', id: `${parentId}.exit`} : null,
        idSec: blockExit / fps,
        content: {parent: parentId, exit: blockExit},
      });
    }
  }
}
