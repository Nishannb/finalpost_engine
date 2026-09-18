/**
 * Stage B.1 — Auto-Trim (silence + filler cleanup).
 *
 * Pure arithmetic over the ASR word map: long inter-word gaps and isolated
 * filler tokens become exclusion ranges. No GPU model, no second pass over the
 * media, and it shortens the output, which directly lowers Stage E render cost.
 */

import type {KeepSegment, TimeRange, WordToken} from '../../types/blueprint.ts';
import {round} from './timeline.ts';

export type AutoTrimOptions = {
  /** Gaps longer than this (seconds) are cut. */
  thresholdSec: number;
  /** Silence retained on each side of a cut so speech does not sound clipped. */
  paddingSec: number;
  sourceDurationSec: number;
  /** Drop um/uh-style fillers when they are short and isolated. */
  removeFillers?: boolean;
};

export type AutoTrimResult = {
  trimExclusions: TimeRange[];
  keepSegments: KeepSegment[];
  removedSec: number;
  /** Why we kept the original length, if a safety guard fired. */
  skipped?: 'no_words' | 'sparse_speech' | 'would_remove_too_much';
};

/** Cuts shorter than this are not worth the extra timeline seam. */
const MIN_CUT_SEC = 0.05;
/** Whisper on music/animation often returns 1–2 tokens; that map is not a silence timeline. */
const MIN_WORDS_TO_TRIM = 6;
/** Never throw away most of the source because ASR missed the speech. */
const MAX_REMOVAL_FRAC = 0.4;
const MIN_KEEP_FRAC = 0.55;
const MIN_KEEP_SEC = 3;

/** Safe fillers only — never "like" / "you know" (too often real speech). */
const FILLER_TOKEN =
  /^(um+|uh+|uhm+|erm+|hm+|hmm+|ah+|eh+|mm+|mhm+|huh|uhhuh|uh-huh)[,.!?]*$/i;

export function autoTrimSilence(
  words: WordToken[],
  options: AutoTrimOptions,
): AutoTrimResult {
  const duration = Math.max(0, options.sourceDurationSec);
  const intact = (): AutoTrimResult => ({
    trimExclusions: [],
    keepSegments: [{sourceStart: 0, sourceEnd: duration, outputStart: 0}],
    removedSec: 0,
  });

  if (words.length === 0 || duration <= 0) {
    return {...intact(), skipped: words.length === 0 ? 'no_words' : undefined};
  }
  if (words.length < MIN_WORDS_TO_TRIM) {
    return {...intact(), skipped: 'sparse_speech'};
  }

  const threshold = Math.max(0.05, options.thresholdSec);
  const padding = Math.max(0, options.paddingSec);
  const removeFillers = options.removeFillers !== false;

  const sorted = [...words].sort((a, b) => a.start - b.start);
  const first = sorted[0]!;
  const lastWord = sorted.at(-1)!;
  const exclusions: TimeRange[] = [];

  // Dead air before the first word has no preceding speech to protect, so it is
  // cut from zero rather than from `padding`.
  if (first.start > threshold) {
    pushCut(exclusions, 0, first.start - padding);
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    const gap = next.start - current.end;
    if (gap <= threshold) {
      continue;
    }
    pushCut(exclusions, current.end + padding, next.start - padding);
  }

  const tailGap = duration - lastWord.end;
  if (tailGap > threshold) {
    pushCut(exclusions, lastWord.end + padding, duration);
  }

  if (removeFillers) {
    for (let i = 0; i < sorted.length; i += 1) {
      const token = sorted[i]!;
      if (!isFillerToken(token.text)) {
        continue;
      }
      const span = token.end - token.start;
      if (span > 0.85) {
        continue;
      }
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const gapBefore = prev ? token.start - prev.end : 0.4;
      const gapAfter = next ? next.start - token.end : 0.4;
      // Only cut fillers that sit in a slight hesitation, not mid-phrase rush.
      if (gapBefore < 0.04 && gapAfter < 0.04) {
        continue;
      }
      const from = Math.max(
        prev ? prev.end + Math.min(padding, 0.06) : token.start,
        token.start - 0.02,
      );
      const to = Math.min(
        next ? next.start - Math.min(padding, 0.06) : token.end,
        token.end + 0.02,
      );
      pushCut(exclusions, from, to);
    }
  }

  const merged = mergeRanges(exclusions);
  const keepSegments = keepSegmentsFor(merged, duration);
  const removedSec = merged.reduce((total, range) => total + (range.end - range.start), 0);
  const keptSec = duration - removedSec;
  if (
    duration > 0 &&
    (removedSec / duration > MAX_REMOVAL_FRAC ||
      keptSec < Math.min(duration, Math.max(MIN_KEEP_SEC, duration * MIN_KEEP_FRAC)))
  ) {
    return {...intact(), skipped: 'would_remove_too_much'};
  }

  return {
    trimExclusions: merged.map(range => ({
      start: round(range.start),
      end: round(range.end),
    })),
    keepSegments,
    removedSec: round(removedSec),
  };
}

export function isFillerToken(raw: string): boolean {
  return FILLER_TOKEN.test(raw.trim());
}

function pushCut(target: TimeRange[], start: number, end: number): void {
  const from = Math.max(0, start);
  const to = Math.max(from, end);
  if (to - from >= MIN_CUT_SEC) {
    target.push({start: from, end: to});
  }
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({...range});
  }
  return merged;
}

/** Complement of the cut ranges, stamped with running output offsets. */
export function keepSegmentsFor(
  exclusions: TimeRange[],
  sourceDurationSec: number,
): KeepSegment[] {
  const segments: KeepSegment[] = [];
  let cursor = 0;
  let outputStart = 0;

  for (const range of mergeRanges(exclusions)) {
    if (range.start > cursor) {
      const sourceEnd = Math.min(range.start, sourceDurationSec);
      if (sourceEnd > cursor) {
        segments.push({
          sourceStart: round(cursor),
          sourceEnd: round(sourceEnd),
          outputStart: round(outputStart),
        });
        outputStart += sourceEnd - cursor;
      }
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < sourceDurationSec) {
    segments.push({
      sourceStart: round(cursor),
      sourceEnd: round(sourceDurationSec),
      outputStart: round(outputStart),
    });
  }

  if (segments.length === 0) {
    segments.push({sourceStart: 0, sourceEnd: sourceDurationSec, outputStart: 0});
  }
  return segments;
}
