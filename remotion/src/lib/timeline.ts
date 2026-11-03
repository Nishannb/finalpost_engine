/**
 * Frame math shared by every track.
 *
 * Blueprints are expressed in seconds because the AI stages are fps-agnostic;
 * everything Remotion draws is in frames, and this is the only place converting.
 */

import {proceduralStyleOf} from './proceduralTransition';
import type {CaptionWord, KeepSegment, ZoomTrigger} from '../blueprintSchema';

export function secToFrame(seconds: number, fps: number): number {
  return Math.round(Math.max(0, seconds) * fps);
}

export function framesBetween(
  startSec: number,
  endSec: number,
  fps: number,
): number {
  return Math.max(1, Math.round((endSec - startSec) * fps));
}

/** A group of words shown on screen together. */
export type CaptionLine = {
  words: CaptionWord[];
  start: number;
  end: number;
};

/**
 * Group words into short lines.
 *
 * One word at a time (as the RN preview does) reads well on a phone but flickers
 * in a burned export, so words are batched up to `maxWords`, breaking early on a
 * sentence change or a noticeable pause.
 */
export function groupCaptionLines(
  words: CaptionWord[],
  options: {maxWords?: number; maxGapSec?: number; maxSpanSec?: number} = {},
): CaptionLine[] {
  const maxWords = options.maxWords ?? 3;
  const maxGapSec = options.maxGapSec ?? 0.55;
  const maxSpanSec = options.maxSpanSec ?? 2.4;

  const lines: CaptionLine[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    lines.push({
      words: current,
      start: current[0]!.start,
      end: current.at(-1)!.end,
    });
    current = [];
  };

  for (const word of words) {
    const previous = current.at(-1);
    const breaks =
      previous !== undefined &&
      (current.length >= maxWords ||
        word.sentenceIndex !== previous.sentenceIndex ||
        word.start - previous.end > maxGapSec ||
        word.end - current[0]!.start > maxSpanSec);
    if (breaks) {
      flush();
    }
    current.push(word);
  }
  flush();

  return lines;
}

/**
 * The caption line to draw at `timeSec`: the line being spoken, kept on screen `holdSec` after its last word so it does not vanish the instant
 * the word ends. When the previous line's hold overlaps the NEXT line's start (consecutive words have no gap), both qualify and the one that
 * started most recently is the one being spoken. (Returning the first match instead kept the previous word up for the whole hold, so every
 * new caption appeared about `holdSec` + a frame late: 0.133 s median on the Phase 27 edit.)
 */
export function activeLineAt(
  lines: CaptionLine[],
  timeSec: number,
  holdSec = 0.12,
): CaptionLine | null {
  let found: CaptionLine | null = null;
  for (const line of lines) {
    if (timeSec >= line.start && timeSec <= line.end + holdSec) {
      found = line;
    }
  }
  return found;
}

/**
 * Zoom scale at a given output time, eased in and out.
 *
 * A hard cut to 1.25x looks like a glitch, so each trigger ramps in quickly
 * and eases out over a longer, smoother retract.
 */
export function zoomScaleAt(
  triggers: ZoomTrigger[],
  timeSec: number,
  inRampSec = 0.35,
  outRampSec = 1,
): number {
  return activeZoomAt(triggers, timeSec, inRampSec, outRampSec).scale;
}

/** The punch-in in effect at `timeSec`: its eased scale and the focus of the trigger that sets it, if any. */
export function activeZoomAt(
  triggers: ZoomTrigger[],
  timeSec: number,
  inRampSec = 0.35,
  outRampSec = 1,
): {scale: number; focus?: {x: number; y: number}} {
  let scale = 1;
  let focus: {x: number; y: number} | undefined;
  for (const trigger of triggers) {
    if (timeSec < trigger.start || timeSec > trigger.end) {
      continue;
    }
    const inT = easeInOut(clamp01((timeSec - trigger.start) / Math.max(0.05, inRampSec)));
    const outT = easeInOutCubic(clamp01((trigger.end - timeSec) / Math.max(0.05, outRampSec)));
    const envelope = Math.min(inT, outT);
    const candidate = 1 + (trigger.scale - 1) * envelope;
    if (candidate > scale) {
      scale = candidate;
      focus = trigger.focus;
    }
  }
  return focus ? {scale, focus} : {scale};
}

/** Legacy punch-in origin (where the zoom grows from when no focus is given). */
export const DEFAULT_ZOOM_ORIGIN = '50% 32%';

/**
 * CSS for the zoom wrapper.
 *
 * Without a focus: `scale(s)` about 50% 32% (unchanged from before focus existed).
 * With a focus (fx, fy in 0–1): the point is moved toward the middle of the frame as far as the edges allow,
 * so the picture still covers the whole frame. With the transform  p' = c + s·(p − f)  (normalized), the
 * frame stays covered iff  1 − s·(1 − f) ≤ c ≤ s·f ; c is the centre (0.5) clamped into that range, which also
 * keeps the focus on screen. At s = 1 the range collapses to c = f, i.e. no movement, so the ease-in is smooth.
 * Works for any width/height; the centring is in the frame's own proportions, so portrait and landscape behave alike.
 */
export function zoomStyleFor(
  zoom: {scale: number; focus?: {x: number; y: number}},
  width: number,
  height: number,
): {transform: string; transformOrigin: string} {
  if (!zoom.focus || zoom.scale <= 1) {
    return {transform: `scale(${zoom.scale})`, transformOrigin: DEFAULT_ZOOM_ORIGIN};
  }
  const {scale: s} = zoom;
  const centre = (f: number) => Math.min(s * f, Math.max(1 - s * (1 - f), 0.5));
  const tx = (centre(zoom.focus.x) - s * zoom.focus.x) * width;
  const ty = (centre(zoom.focus.y) - s * zoom.focus.y) * height;
  return {transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0'};
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Frame placement of each kept segment, derived ONCE so that the three quantities the renderer needs can never disagree.
 *
 * Before this, `VideoTrack` rounded three things independently: the Sequence start (`round(outputStart*fps)`), its length
 * (`round((sourceEnd-sourceStart)*fps)`) and its trim range (`round(sourceEnd*fps) - round(sourceStart*fps)`). They can differ by one frame:
 *   - length > trim range: the Sequence's last frame lies past `trimAfter` (exclusive) and `OffthreadVideo` draws nothing there -> black;
 *   - length != distance to the next Sequence's start: a one-frame black gap, or a one-frame overlap that hides the segment's last frame.
 *
 * Rules (all in frames; `natural` is the legacy length `framesBetween(sourceStart, sourceEnd)`):
 *   from        = secToFrame(outputStart)                      unchanged
 *   trimBefore  = secToFrame(sourceStart)                      unchanged
 *   length      = distance to the next segment's `from` when that differs from `natural` by at most one frame (a pure rounding
 *                 disagreement); otherwise `natural` (a real gap or overlap in the blueprint is not touched). The last segment is `natural`,
 *                 clamped so it never reads a frame that STARTS at or after its `sourceEnd` (a frame past the end of the footage has no picture).
 *   trimAfter   = trimBefore + length                          the clip is read for exactly the frames the Sequence shows
 * No source frame outside [sourceStart, sourceEnd] is added beyond that one-frame rounding, and nothing is frozen or repeated.
 */
export type SegmentFrames = {from: number; durationInFrames: number; trimBefore: number; trimAfter: number};

export function segmentFrames(segments: KeepSegment[], fps: number): SegmentFrames[] {
  return segments.map((segment, index) => {
    const from = secToFrame(segment.outputStart, fps);
    const trimBefore = secToFrame(segment.sourceStart, fps);
    const natural = framesBetween(segment.sourceStart, segment.sourceEnd, fps);
    const next = segments[index + 1];
    let durationInFrames = natural;
    if (!next) {
      // frames that start before sourceEnd: indices < ceil(sourceEnd*fps) (the epsilon keeps 3.4*30 = 102.00000000000001 from counting a frame)
      const available = Math.ceil(Math.max(0, segment.sourceEnd) * fps - 1e-6) - trimBefore;
      durationInFrames = Math.max(1, Math.min(natural, available));
    } else {
      const toNext = secToFrame(next.outputStart, fps) - from;
      if (toNext >= 1 && Math.abs(toNext - natural) <= 1) {
        durationInFrames = toNext;
      }
    }
    return {from, durationInFrames, trimBefore, trimAfter: trimBefore + durationInFrames};
  });
}

/**
 * Composition length: the legacy `ceil(seconds * fps)`, but never longer than the last Sequence ends. A composition frame no Sequence
 * covers has no picture (black); the legacy ceil created exactly one such frame whenever it rounded up past the last Sequence.
 * Never longer than before, so no overall duration grows.
 */
export function compositionFrames(segments: KeepSegment[], seconds: number, fps: number): number {
  const legacy = Math.max(1, Math.ceil(seconds * fps));
  if (segments.length === 0) {
    return legacy;
  }
  const placed = segmentFrames(segments, fps);
  const covered = Math.max(...placed.map(item => item.from + item.durationInFrames));
  return Math.max(1, Math.min(legacy, covered));
}

/** Segments to draw: the trimmed set, or one full-length pass when trim is off. */
export function resolveSegments(
  keepSegments: KeepSegment[],
  options: {trimEnabled: boolean; sourceDurationSec: number},
): KeepSegment[] {
  if (options.trimEnabled && keepSegments.length > 0) {
    return keepSegments;
  }
  return [
    {sourceStart: 0, sourceEnd: options.sourceDurationSec, outputStart: 0},
  ];
}

/** A transition is drawn from an asset, or (opt-in, `renderGenerated`) as the generated light sweep. */
export function transitionIsDrawable(clip: {assetUrl: string; renderGenerated?: boolean; keyword?: string}): boolean {
  // WP12C: a procedural style (hard cut, flash, whip blur, grade flip) needs no asset and no opt-in flag.
  return Boolean(clip.assetUrl) || clip.renderGenerated === true || proceduralStyleOf(clip.keyword) !== null;
}

/** Transitions closer than this are the same cut; only the first is drawn. */
export const TRANSITION_SAME_CUT_SEC = 0.5;

/**
 * Frames a transition occupies, clipped to the video. The sweep starts a third of the way before the cut so
 * it peaks on it. Returns null when the clip is unusable (non-finite or non-positive time, entirely outside
 * the video, or under 2 frames after clipping).
 */
export function transitionWindow(
  clip: {at: number; duration: number},
  fps: number,
  totalFrames: number,
): {from: number; durationInFrames: number} | null {
  if (!Number.isFinite(clip.at) || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.at < 0) {
    return null;
  }
  const from = secToFrame(Math.max(0, clip.at - clip.duration * 0.35), fps);
  if (from >= totalFrames) {
    return null;
  }
  const durationInFrames = Math.min(framesBetween(0, clip.duration, fps), totalFrames - from);
  return durationInFrames >= 2 ? {from, durationInFrames} : null;
}

/** The transitions to draw: drawable, valid, in time order, one per cut. */
export function drawableTransitions<T extends {at: number; duration: number; assetUrl: string; renderGenerated?: boolean; keyword?: string}>(
  clips: T[],
  fps: number,
  totalFrames: number,
): Array<{clip: T; from: number; durationInFrames: number}> {
  const out: Array<{clip: T; from: number; durationInFrames: number}> = [];
  for (const clip of [...clips].filter(transitionIsDrawable).sort((a, b) => a.at - b.at)) {
    const window = transitionWindow(clip, fps, totalFrames);
    // Asset transitions keep their legacy behaviour (never merged); only generated sweeps are de-duplicated per cut.
    const generated = !clip.assetUrl;
    if (!window || (generated && out.some(item => !item.clip.assetUrl && Math.abs(item.clip.at - clip.at) < TRANSITION_SAME_CUT_SEC))) {
      continue;
    }
    out.push({clip, ...window});
  }
  return out;
}
