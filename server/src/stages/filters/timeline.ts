/**
 * Source→output time mapping for a trimmed timeline.
 *
 * Once silence is cut, every other artifact (captions, zooms, B-roll) must be
 * expressed in output time or it will drift further out of sync with each cut.
 * This module is the single place that conversion happens.
 */

import type {KeepSegment, TimeRange} from '../../types/blueprint.ts';

export type Timeline = {
  keepSegments: KeepSegment[];
  outputDurationSec: number;
  /** Output time for a source instant, or null if it falls inside a cut. */
  mapSourceToOutput: (sourceSec: number) => number | null;
  /** Same, but snaps instants inside a cut to the nearest surviving edge. */
  mapSourceToOutputClamped: (sourceSec: number) => number;
};

const EPSILON = 1e-6;

export function buildTimeline(keepSegments: KeepSegment[]): Timeline {
  const segments = [...keepSegments].sort((a, b) => a.sourceStart - b.sourceStart);
  const last = segments.at(-1);
  const outputDurationSec = last
    ? last.outputStart + (last.sourceEnd - last.sourceStart)
    : 0;

  const indexFor = (sourceSec: number): number => {
    let low = 0;
    let high = segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = segments[mid]!;
      if (sourceSec < segment.sourceStart - EPSILON) {
        high = mid - 1;
      } else if (sourceSec > segment.sourceEnd + EPSILON) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  };

  const mapSourceToOutput = (sourceSec: number): number | null => {
    const index = indexFor(sourceSec);
    if (index < 0) {
      return null;
    }
    const segment = segments[index]!;
    return segment.outputStart + (sourceSec - segment.sourceStart);
  };

  const mapSourceToOutputClamped = (sourceSec: number): number => {
    const direct = mapSourceToOutput(sourceSec);
    if (direct !== null) {
      return clamp(direct, 0, outputDurationSec);
    }
    // Instants inside a cut collapse onto the seam, which is simultaneously the
    // previous segment's output end and the next segment's output start — the
    // cut removed everything between them.
    let seam = 0;
    for (const segment of segments) {
      if (segment.sourceStart >= sourceSec) {
        break;
      }
      if (segment.sourceEnd <= sourceSec) {
        seam = segment.outputStart + (segment.sourceEnd - segment.sourceStart);
      }
    }
    return clamp(seam, 0, outputDurationSec);
  };

  return {
    keepSegments: segments,
    outputDurationSec,
    mapSourceToOutput,
    mapSourceToOutputClamped,
  };
}

/** Full-length passthrough timeline used when trimming is disabled. */
export function identityTimeline(durationSec: number): Timeline {
  return buildTimeline([
    {sourceStart: 0, sourceEnd: Math.max(0, durationSec), outputStart: 0},
  ]);
}

/** Invert kept segments back into the cut ranges, for blueprint diagnostics. */
export function exclusionsFromKeepSegments(
  keepSegments: KeepSegment[],
  sourceDurationSec: number,
): TimeRange[] {
  const segments = [...keepSegments].sort((a, b) => a.sourceStart - b.sourceStart);
  const exclusions: TimeRange[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.sourceStart > cursor + EPSILON) {
      exclusions.push({start: round(cursor), end: round(segment.sourceStart)});
    }
    cursor = Math.max(cursor, segment.sourceEnd);
  }
  if (sourceDurationSec > cursor + EPSILON) {
    exclusions.push({start: round(cursor), end: round(sourceDurationSec)});
  }
  return exclusions;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
