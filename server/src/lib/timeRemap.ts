/**
 * Shared piecewise source ↔ output timeline.
 *
 * Duration-changing delivery operations are compiled here once. Captions,
 * visual placements, markers, audio and video all consume this same map.
 */

export type TimeRemapSegment = {
  kind: 'media' | 'pause';
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
  /** Source seconds consumed per output second. 0 for an inserted pause. */
  rate: number;
};

export type TimeRemap = {
  sourceDurationSec: number;
  outputDurationSec: number;
  crossfadeSec: number;
  segments: TimeRemapSegment[];
};

export type TimingOperation =
  | {op: 'trim_silence' | 'trim_filler'; start: number; end: number}
  | {
      op: 'insert_pause';
      start: number;
      end: number;
      params: {position: 'before_word' | 'after_word' | 'sentence_end'; durationMs: number};
    }
  | {
      op: 'speed_ramp';
      start: number;
      end: number;
      params: {rate: number; rampInMs: number; rampOutMs: number};
    };

const EPSILON = 1e-6;

export function buildTimeRemap(input: {
  sourceDurationSec: number;
  ops: TimingOperation[];
  crossfadeMs?: number;
}): TimeRemap {
  const sourceDurationSec = Math.max(0, input.sourceDurationSec);
  const crossfadeSec = clamp(input.crossfadeMs ?? 10, 5, 20) / 1000;
  const trims = mergeRanges(
    input.ops
      .filter(
        (op): op is Extract<TimingOperation, {op: 'trim_silence' | 'trim_filler'}> =>
          op.op === 'trim_silence' || op.op === 'trim_filler',
      )
      .map(op => ({
        start: clamp(op.start, 0, sourceDurationSec),
        end: clamp(op.end, 0, sourceDurationSec),
      }))
      .filter(range => range.end > range.start + EPSILON),
  );
  const speeds = input.ops.filter(
    (op): op is Extract<TimingOperation, {op: 'speed_ramp'}> =>
      op.op === 'speed_ramp',
  );
  const pauses = input.ops
    .filter(
      (op): op is Extract<TimingOperation, {op: 'insert_pause'}> =>
        op.op === 'insert_pause',
    )
    .map(op => ({
      at: clamp(
        op.params.position === 'before_word' ? op.start : op.end,
        0,
        sourceDurationSec,
      ),
      duration: clamp(op.params.durationMs, 200, 500) / 1000,
    }))
    .sort((a, b) => a.at - b.at);

  const boundaries = new Set<number>([0, sourceDurationSec]);
  for (const range of trims) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  for (const speed of speeds) {
    boundaries.add(clamp(speed.start, 0, sourceDurationSec));
    boundaries.add(clamp(speed.end, 0, sourceDurationSec));
    addRampBoundaries(boundaries, speed, sourceDurationSec);
  }
  for (const pause of pauses) {
    boundaries.add(pause.at);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const raw: Array<Omit<TimeRemapSegment, 'outputStart' | 'outputEnd'>> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const sourceStart = points[index]!;
    const sourceEnd = points[index + 1]!;
    if (sourceEnd <= sourceStart + EPSILON) {
      continue;
    }
    const mid = (sourceStart + sourceEnd) / 2;
    if (trims.some(range => mid >= range.start && mid < range.end)) {
      continue;
    }
    const speed = speeds.find(op => mid >= op.start && mid < op.end);
    const rate = speed ? effectiveRampRate(speed, mid) : 1;
    raw.push({kind: 'media', sourceStart, sourceEnd, rate});
    for (const pause of pauses.filter(item => Math.abs(item.at - sourceEnd) < EPSILON)) {
      raw.push({
        kind: 'pause',
        sourceStart: pause.at,
        sourceEnd: pause.at,
        rate: 0,
        duration: pause.duration,
      } as Omit<TimeRemapSegment, 'outputStart' | 'outputEnd'> & {
        duration: number;
      });
    }
  }
  for (const pause of pauses.filter(item => Math.abs(item.at) < EPSILON)) {
    raw.unshift({
      kind: 'pause',
      sourceStart: 0,
      sourceEnd: 0,
      rate: 0,
      duration: pause.duration,
    } as Omit<TimeRemapSegment, 'outputStart' | 'outputEnd'> & {
      duration: number;
    });
  }

  const segments: TimeRemapSegment[] = [];
  let cursor = 0;
  for (const [index, segment] of raw.entries()) {
    const previous = raw[index - 1];
    const isEditBoundary =
      previous !== undefined &&
      (previous.kind === 'pause' ||
        segment.kind === 'pause' ||
        Math.abs(previous.sourceEnd - segment.sourceStart) > EPSILON);
    const overlap = isEditBoundary ? Math.min(crossfadeSec, cursor) : 0;
    const outputStart = Math.max(0, cursor - overlap);
    const duration =
      segment.kind === 'pause'
        ? Number((segment as typeof segment & {duration?: number}).duration ?? 0)
        : (segment.sourceEnd - segment.sourceStart) / Math.max(0.01, segment.rate);
    const outputEnd = outputStart + duration;
    segments.push({...segment, outputStart, outputEnd});
    cursor = outputEnd;
  }

  return {
    sourceDurationSec,
    outputDurationSec: round(cursor),
    crossfadeSec,
    segments: segments.map(segment => ({
      ...segment,
      sourceStart: round(segment.sourceStart),
      sourceEnd: round(segment.sourceEnd),
      outputStart: round(segment.outputStart),
      outputEnd: round(segment.outputEnd),
      rate: round(segment.rate, 5),
    })),
  };
}

function addRampBoundaries(
  target: Set<number>,
  op: Extract<TimingOperation, {op: 'speed_ramp'}>,
  duration: number,
): void {
  const from = clamp(op.start, 0, duration);
  const to = clamp(op.end, from, duration);
  const rampIn = clamp(op.params.rampInMs, 0, 500) / 1000;
  const rampOut = clamp(op.params.rampOutMs, 0, 500) / 1000;
  const step = 0.04;
  for (let t = from + step; t < Math.min(to, from + rampIn); t += step) {
    target.add(t);
  }
  for (let t = Math.max(from, to - rampOut); t < to; t += step) {
    target.add(t);
  }
}

function effectiveRampRate(
  op: Extract<TimingOperation, {op: 'speed_ramp'}>,
  at: number,
): number {
  const target = clamp(op.params.rate, 0.85, 1.12);
  const rampIn = Math.max(0.001, op.params.rampInMs / 1000);
  const rampOut = Math.max(0.001, op.params.rampOutMs / 1000);
  const enter = smoothstep(clamp((at - op.start) / rampIn, 0, 1));
  const exit = smoothstep(clamp((op.end - at) / rampOut, 0, 1));
  const envelope = Math.min(enter, exit);
  return 1 + (target - 1) * envelope;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function mapSourceToOutput(
  map: TimeRemap,
  sourceSec: number,
): number | null {
  const segment = map.segments.find(
    item =>
      item.kind === 'media' &&
      sourceSec >= item.sourceStart - EPSILON &&
      sourceSec <= item.sourceEnd + EPSILON,
  );
  if (!segment) {
    return null;
  }
  return clamp(
    segment.outputStart + (sourceSec - segment.sourceStart) / segment.rate,
    segment.outputStart,
    segment.outputEnd,
  );
}

export function mapSourceToOutputClamped(
  map: TimeRemap,
  sourceSec: number,
): number {
  const direct = mapSourceToOutput(map, sourceSec);
  if (direct !== null) {
    return direct;
  }
  const media = map.segments.filter(segment => segment.kind === 'media');
  if (media.length === 0) {
    return 0;
  }
  let best = media[0]!;
  let bestDistance = Infinity;
  let edge: 'start' | 'end' = 'start';
  for (const segment of media) {
    const startDistance = Math.abs(sourceSec - segment.sourceStart);
    if (startDistance < bestDistance) {
      best = segment;
      bestDistance = startDistance;
      edge = 'start';
    }
    const endDistance = Math.abs(sourceSec - segment.sourceEnd);
    if (endDistance < bestDistance) {
      best = segment;
      bestDistance = endDistance;
      edge = 'end';
    }
  }
  return edge === 'start' ? best.outputStart : best.outputEnd;
}

export function mapOutputToSource(
  map: TimeRemap,
  outputSec: number,
): number {
  const candidates = map.segments.filter(
    segment =>
      outputSec >= segment.outputStart - EPSILON &&
      outputSec <= segment.outputEnd + EPSILON,
  );
  const segment =
    candidates.find(item => item.kind === 'media') ??
    candidates[0] ??
    map.segments.at(-1);
  if (!segment) {
    return 0;
  }
  if (segment.kind === 'pause') {
    return segment.sourceStart;
  }
  return clamp(
    segment.sourceStart + (outputSec - segment.outputStart) * segment.rate,
    segment.sourceStart,
    segment.sourceEnd,
  );
}

export function remapWords<T extends {start: number; end: number}>(
  words: T[],
  map: TimeRemap,
): T[] {
  return words.flatMap(word => {
    const start = mapSourceToOutput(map, word.start);
    const end = mapSourceToOutput(map, word.end);
    if (start === null || end === null || end <= start + EPSILON) {
      return [];
    }
    return [{...word, start: round(start), end: round(Math.max(start + 0.04, end))}];
  });
}

export function remapRange(
  map: TimeRemap,
  range: {start: number; end: number},
): {start: number; end: number} | null {
  const start = mapSourceToOutputClamped(map, range.start);
  const end = mapSourceToOutputClamped(map, range.end);
  return end > start + EPSILON ? {start: round(start), end: round(end)} : null;
}

function mergeRanges(ranges: Array<{start: number; end: number}>) {
  const out: Array<{start: number; end: number}> = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = out.at(-1);
    if (previous && range.start <= previous.end + EPSILON) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      out.push({...range});
    }
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
