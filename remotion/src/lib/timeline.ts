/**
 * Frame math shared by every track.
 *
 * Blueprints are expressed in seconds because the AI stages are fps-agnostic;
 * everything Remotion draws is in frames, and this is the only place converting.
 */

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

export function activeLineAt(
  lines: CaptionLine[],
  timeSec: number,
  holdSec = 0.12,
): CaptionLine | null {
  for (const line of lines) {
    if (timeSec >= line.start && timeSec <= line.end + holdSec) {
      return line;
    }
  }
  return null;
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
  let scale = 1;
  for (const trigger of triggers) {
    if (timeSec < trigger.start || timeSec > trigger.end) {
      continue;
    }
    const inT = easeInOut(clamp01((timeSec - trigger.start) / Math.max(0.05, inRampSec)));
    const outT = easeInOutCubic(clamp01((trigger.end - timeSec) / Math.max(0.05, outRampSec)));
    const envelope = Math.min(inT, outT);
    scale = Math.max(scale, 1 + (trigger.scale - 1) * envelope);
  }
  return scale;
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
