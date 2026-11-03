/**
 * Visual context: what the Director has actually been shown, on which timeline, and what is unknown.
 * (Contract from remotion/out/phase12-design/03_VISUAL_CONTEXT_CONTRACT.md.)
 *
 * Pure functions only: no model call, no ffmpeg, no network. Everything here is exercised with deterministic fixtures.
 * Used only behind `VISUAL_CONTEXT_V2` (default off); the legacy sampling lives in `storyboardPlan.ts`.
 *
 * Principles:
 *  - A coordinate exists only if something observed it. Missing is `null`, never a default box.
 *  - Both the output time (what edits use) and the source time (what was decoded) are stored, never derived later.
 *  - The Director is told which spans it did NOT see.
 */

import type {KeepSegment} from '../../types/blueprint.ts';

export type NormBox = {x: number; y: number; w: number; h: number};

/** Seconds around a frame within which the picture is considered "observed". Beyond it the Director has no information. */
export const OBSERVATION_HORIZON_SEC = 2;
/** Frames are spread so that no span longer than this lies between two samples (a target, bounded by `maxFrames`). */
export const TARGET_FRAME_SPACING_SEC = 4;
export const MAX_COVERAGE_FRAMES = 10;

// ---- time mapping --------------------------------------------------------------------------------------------------

/**
 * Output-timeline seconds → seconds in the decoded source file, through the silence-trim keep segments.
 * `keepSegments` map source → output; this is their inverse (the existing `Timeline` only exposes the forward map).
 * An instant outside every segment clamps to the nearest segment edge. No segments: identity.
 */
export function outputToSourceSec(keepSegments: ReadonlyArray<Pick<KeepSegment, 'sourceStart' | 'sourceEnd' | 'outputStart'>>, outputSec: number): number {
  if (keepSegments.length === 0) {
    return outputSec;
  }
  const segments = [...keepSegments].sort((a, b) => a.outputStart - b.outputStart);
  // Segments are half-open [outputStart, outputEnd): the output instant where one segment ends is the FIRST frame of the
  // next, so at a cut boundary the later segment wins (the closed-interval version returned the last pre-cut instant,
  // a different picture from the frame the render shows at that time).
  for (const segment of segments) {
    const length = segment.sourceEnd - segment.sourceStart;
    if (outputSec >= segment.outputStart - 1e-9 && outputSec < segment.outputStart + length - 1e-9) {
      return segment.sourceStart + Math.max(outputSec - segment.outputStart, 0);
    }
  }
  if (outputSec < segments[0]!.outputStart) {
    return segments[0]!.sourceStart;
  }
  return segments.at(-1)!.sourceEnd;
}

// ---- frame selection -----------------------------------------------------------------------------------------------

/**
 * Output-time seconds to sample so the whole timeline is represented: the centres of `n` equal slices,
 * n = ceil(duration / TARGET_FRAME_SPACING_SEC) clamped to [2, maxFrames]. (The legacy plan sampled only the first
 * ~14 s and the Director received only the first 8 of those, i.e. 0.4–10.9 s.)
 */
export function coverageFrameTimes(durationSec: number, maxFrames = MAX_COVERAGE_FRAMES): number[] {
  if (!(durationSec > 0)) {
    return [];
  }
  const n = Math.min(maxFrames, Math.max(2, Math.ceil(durationSec / TARGET_FRAME_SPACING_SEC)));
  const edge = Math.min(0.2, durationSec / 4);
  return Array.from({length: n}, (_, i) => Math.min(durationSec - edge, Math.max(edge, ((i + 0.5) * durationSec) / n)));
}

export type Coverage = {
  /** Output times of the STILLS the Director is shown. Speaker-geometry measurements are NOT pictures and are not counted. */
  sampledOutputSec: number[];
  /** Output times at which a speaker box was measured (geometry only; the Director does not see these frames). */
  measuredOutputSec: number[];
  horizonSec: number;
  /** Spans of the output timeline farther than `horizonSec` from every frame: the Director has no visual information there. */
  unseen: Array<{start: number; end: number}>;
  /** Longest distance between two consecutive samples (including the edges). */
  maxGapSec: number;
};

export function buildCoverage(sampledOutputSec: number[], durationSec: number, horizonSec = OBSERVATION_HORIZON_SEC): Coverage {
  const times = [...sampledOutputSec].sort((a, b) => a - b);
  const seen: Array<{start: number; end: number}> = [];
  for (const t of times) {
    const start = Math.max(0, t - horizonSec);
    const end = Math.min(durationSec, t + horizonSec);
    const last = seen.at(-1);
    if (last && start <= last.end + 1e-9) {
      last.end = Math.max(last.end, end);
    } else {
      seen.push({start, end});
    }
  }
  const unseen: Array<{start: number; end: number}> = [];
  let cursor = 0;
  for (const span of seen) {
    if (span.start > cursor + 1e-9) {
      unseen.push({start: round(cursor), end: round(span.start)});
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < durationSec - 1e-9) {
    unseen.push({start: round(cursor), end: round(durationSec)});
  }
  const edges = [0, ...times, durationSec];
  let maxGap = 0;
  for (let i = 1; i < edges.length; i += 1) {
    maxGap = Math.max(maxGap, edges[i]! - edges[i - 1]!);
  }
  return {sampledOutputSec: times.map(round), measuredOutputSec: [], horizonSec, unseen, maxGapSec: round(maxGap)};
}

// ---- frame geometry ------------------------------------------------------------------------------------------------

/**
 * The part of a source frame that is visible in the composition when it is drawn with `objectFit: cover` into
 * `outW × outH` at `objectPosition` (fractions, default centre). Normalized to the source frame.
 * 9:16 into 9:16 → the whole frame {0,0,1,1}.
 */
export function coverContentRect(srcW: number, srcH: number, outW = 1080, outH = 1920, objectPosition: {x: number; y: number} = {x: 0.5, y: 0.5}): NormBox {
  if (!(srcW > 0 && srcH > 0 && outW > 0 && outH > 0)) {
    return {x: 0, y: 0, w: 1, h: 1};
  }
  const scale = Math.max(outW / srcW, outH / srcH);
  const w = Math.min(1, outW / (srcW * scale));
  const h = Math.min(1, outH / (srcH * scale));
  return {x: round4((1 - w) * objectPosition.x), y: round4((1 - h) * objectPosition.y), w: round4(w), h: round4(h)};
}

/**
 * A box in source-frame fractions → the rendered composition's fractions, clipped to what is visible.
 * Returns null when the box lies entirely outside the visible part; `clipped` is true when part of it was cut off.
 */
export function sourceBoxToRendered(box: NormBox, content: NormBox): {box: NormBox; clipped: boolean} | null {
  const x0 = Math.max(box.x, content.x);
  const y0 = Math.max(box.y, content.y);
  const x1 = Math.min(box.x + box.w, content.x + content.w);
  const y1 = Math.min(box.y + box.h, content.y + content.h);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  return {
    box: {x: round4((x0 - content.x) / content.w), y: round4((y0 - content.y) / content.h), w: round4((x1 - x0) / content.w), h: round4((y1 - y0) / content.h)},
    clipped: x0 > box.x + 1e-9 || y0 > box.y + 1e-9 || x1 < box.x + box.w - 1e-9 || y1 < box.y + box.h - 1e-9,
  };
}

// ---- the contract --------------------------------------------------------------------------------------------------

export type VisualFrame = {
  id: string;
  role: 'storyboard' | 'occupancy';
  /** Time on the final (silence-trimmed) output timeline: what edits use. */
  outputSec: number;
  /** Time in the decoded file (the delivery-shaped source). */
  sourceSec: number;
  timeMap: 'trim_inverse_v1' | 'identity';
  /** Pixel size of the frame as sent; unknown dimensions are null (never guessed). */
  sentWidthPx: number | null;
  sentHeightPx: number | null;
  /** The portion of the source frame visible in the composition. Full frame when the source is 9:16. */
  contentRect: NormBox;
};

export type VisualObservation = {
  frameId: string;
  kind: 'person' | 'face' | 'product' | 'screen' | 'document' | 'text' | 'object' | 'unknown';
  label: string | null;
  /** Fractions of the RENDERED frame, top-left origin. null = something is there but where is not known. */
  box: NormBox | null;
  /** null = the producer gave none. Never defaulted to 1. */
  confidence: number | null;
  provenance: 'occupancy_vision' | 'story_analyst' | 'user_asset_region' | 'heuristic' | 'human';
};

export type VisualContext = {
  version: 1;
  coordinateSpace: 'rendered_frame_normalized';
  frames: VisualFrame[];
  coverage: Coverage;
  observations: VisualObservation[];
};

export type OccupancyLike = {speaker: NormBox; source: 'vision' | 'fallback'};

export function buildVisualContext(input: {
  durationSec: number;
  keepSegments: ReadonlyArray<Pick<KeepSegment, 'sourceStart' | 'sourceEnd' | 'outputStart'>>;
  storyboardOutputSec: number[];
  /** Occupancy measurements WITH the time they were taken at (output seconds). */
  occupancy: Array<{outputSec: number; occupancy: OccupancyLike}>;
  sourceSize?: {width: number; height: number} | null;
  objectPosition?: {x: number; y: number};
  sentWidthPx?: number | null;
}): VisualContext {
  const content = input.sourceSize ? coverContentRect(input.sourceSize.width, input.sourceSize.height, 1080, 1920, input.objectPosition) : ({x: 0, y: 0, w: 1, h: 1} as NormBox);
  const identity = input.keepSegments.length === 0;
  const frame = (id: string, role: VisualFrame['role'], outputSec: number): VisualFrame => ({
    id,
    role,
    outputSec: round(outputSec),
    sourceSec: round(outputToSourceSec(input.keepSegments, outputSec)),
    timeMap: identity ? 'identity' : 'trim_inverse_v1',
    sentWidthPx: input.sentWidthPx ?? null,
    sentHeightPx: null,
    contentRect: content,
  });
  const frames: VisualFrame[] = [
    ...input.storyboardOutputSec.map((t, i) => frame(`s${String(i).padStart(2, '0')}`, 'storyboard', t)),
    ...input.occupancy.map((item, i) => frame(`o${String(i).padStart(2, '0')}`, 'occupancy', item.outputSec)),
  ];
  const observations: VisualObservation[] = [];
  input.occupancy.forEach((item, i) => {
    const id = `o${String(i).padStart(2, '0')}`;
    if (item.occupancy.source === 'vision') {
      const mapped = sourceBoxToRendered(item.occupancy.speaker, content);
      observations.push({frameId: id, kind: 'person', label: 'speaker (head and torso)', box: mapped?.box ?? null, confidence: null, provenance: 'occupancy_vision'});
    } else {
      // The fallback box is a fixed default, not an observation: report that a person is expected, with no location.
      observations.push({frameId: id, kind: 'person', label: 'speaker (location unknown: detection unavailable)', box: null, confidence: null, provenance: 'heuristic'});
    }
  });
  return {
    version: 1,
    coordinateSpace: 'rendered_frame_normalized',
    frames,
    // Coverage is about PICTURES shown. Occupancy frames contribute a measured box (observations), not something seen.
    coverage: {...buildCoverage(input.storyboardOutputSec, input.durationSec), measuredOutputSec: input.occupancy.map(item => round(item.outputSec)).sort((a, b) => a - b)},
    observations,
  };
}

/** Context for the default (v1) path: it measures ONE speaker box at one moment. `outputSec` is null if that moment was cut. */
export function visualContextFromSingleOccupancy(input: {
  durationSec: number;
  keepSegments: ReadonlyArray<Pick<KeepSegment, 'sourceStart' | 'sourceEnd' | 'outputStart'>>;
  sampleSourceSec: number;
  mapSourceToOutput: (sourceSec: number) => number | null;
  occupancy: OccupancyLike;
  sourceSize?: {width: number; height: number} | null;
}): VisualContext {
  const outputSec = input.mapSourceToOutput(input.sampleSourceSec);
  if (outputSec === null) {
    return {version: 1, coordinateSpace: 'rendered_frame_normalized', frames: [], coverage: buildCoverage([], input.durationSec), observations: []};
  }
  // The v1 Director is shown no picture at all; the single measured box is geometry only.
  return buildVisualContext({durationSec: input.durationSec, keepSegments: input.keepSegments, storyboardOutputSec: [], occupancy: [{outputSec, occupancy: input.occupancy}], sourceSize: input.sourceSize});
}

// ---- what the Director is told -------------------------------------------------------------------------------------

export function formatVisualContext(context: VisualContext): string {
  const span = (item: {start: number; end: number}) => `${item.start.toFixed(1)}–${item.end.toFixed(1)}s`;
  const h = context.coverage.horizonSec;
  const lines = ['VISUAL_CONTEXT (only what is listed here was observed; everything else is unknown)'];
  const storyboard = context.frames.filter(frame => frame.role === 'storyboard');
  lines.push(
    storyboard.length > 0
      ? `pictures shown (each is ONE still of its own instant): ${storyboard.map(frame => `${frame.outputSec.toFixed(1)}s`).join(', ')}`
      : 'pictures shown: none — you were given no images, so you know nothing about the picture',
  );
  if (storyboard.length > 0) {
    lines.push(
      context.coverage.unseen.length === 0
        ? `No span is farther than ±${h}s from a still. A still shows only its own instant: motion, gestures and cuts between stills are unknown.`
        : `NOT SHOWN (no still within ±${h}s): ${context.coverage.unseen.map(span).join(', ')}. What happens there is unknown. Even within ±${h}s of a still, only that instant is known; motion, gestures and cuts between stills are not.`,
    );
  }
  const people = context.observations.filter(obs => obs.kind === 'person');
  for (const obs of people) {
    const frame = context.frames.find(item => item.id === obs.frameId);
    const at = frame ? `@${frame.outputSec.toFixed(1)}s ` : '';
    lines.push(obs.box ? `speaker position measured ${at}box x=${obs.box.x.toFixed(2)} y=${obs.box.y.toFixed(2)} w=${obs.box.w.toFixed(2)} h=${obs.box.h.toFixed(2)} (detected at that instant only; confidence not given; unknown at other times)` : `speaker position ${at}unknown`);
  }
  lines.push('No face, product, screen or object locations are available. Do not give focus_x/focus_y for anything that is not a listed observation.');
  return lines.join('\n');
}

// ---- focus evidence ------------------------------------------------------------------------------------------------

/**
 * A still authorises a zoom focus only if it was taken within this many seconds of the zoom window. Deliberately tighter
 * than the coverage horizon: being within ±2 s of a still does not mean the subject is still where that still shows it.
 */
export const FOCUS_EVIDENCE_PAD_SEC = 1;
export const FOCUS_BOX_TOLERANCE = 0.08;
/** Boxes of the same kind that move more than this (fraction of the frame) within the window mean the subject moves. */
export const SUBJECT_MOVE_TOLERANCE = 0.15;

export type FocusDecision = {ok: true; observation: VisualObservation} | {ok: false; reason: 'focus_without_visual_evidence' | 'focus_outside_observed_subject' | 'focus_subject_moves'};

/**
 * May a zoom over [start, end] (output seconds) be aimed at `focus`? Only if a frame near the window carries an
 * observation with a known box that contains the focus point (within a small tolerance), and the subject does not
 * visibly move across the frames near the window. Nothing is inferred from the transcript.
 */
export function evaluateFocus(context: VisualContext | null | undefined, window: {start: number; end: number}, focus: {x: number; y: number}): FocusDecision {
  if (!context) {
    return {ok: false, reason: 'focus_without_visual_evidence'};
  }
  const pad = FOCUS_EVIDENCE_PAD_SEC;
  const near = new Set(context.frames.filter(frame => frame.outputSec >= window.start - pad && frame.outputSec <= window.end + pad).map(frame => frame.id));
  const candidates = context.observations.filter(obs => near.has(obs.frameId) && obs.box !== null && obs.kind !== 'unknown');
  if (candidates.length === 0) {
    return {ok: false, reason: 'focus_without_visual_evidence'};
  }
  const centre = (box: NormBox) => ({x: box.x + box.w / 2, y: box.y + box.h / 2});
  for (const kind of new Set(candidates.map(obs => obs.kind))) {
    const same = candidates.filter(obs => obs.kind === kind);
    const centres = same.map(obs => centre(obs.box!));
    const xs = centres.map(c => c.x);
    const ys = centres.map(c => c.y);
    if (Math.max(...xs) - Math.min(...xs) > SUBJECT_MOVE_TOLERANCE || Math.max(...ys) - Math.min(...ys) > SUBJECT_MOVE_TOLERANCE) {
      return {ok: false, reason: 'focus_subject_moves'};
    }
  }
  const hit = candidates.find(obs => {
    const b = obs.box!;
    return focus.x >= b.x - FOCUS_BOX_TOLERANCE && focus.x <= b.x + b.w + FOCUS_BOX_TOLERANCE && focus.y >= b.y - FOCUS_BOX_TOLERANCE && focus.y <= b.y + b.h + FOCUS_BOX_TOLERANCE;
  });
  return hit ? {ok: true, observation: hit} : {ok: false, reason: 'focus_outside_observed_subject'};
}

/** Seconds are reported to 10 ms; geometry keeps 4 decimals (2 decimals would distort a cropped landscape frame). */
const round = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 1e4) / 1e4;
