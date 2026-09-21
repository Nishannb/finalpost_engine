import {
  buildTimeRemap,
  type TimeRemap,
  type TimingOperation,
} from './timeRemap.ts';

export const DELIVERY_SHAPING_TYPE = 'delivery_shaping' as const;
export const DELIVERY_INTENSITIES = ['subtle', 'balanced', 'energetic'] as const;
export type DeliveryIntensity = (typeof DELIVERY_INTENSITIES)[number];
export const DELIVERY_PRESETS = ['natural', 'punchy', 'podcast'] as const;
export type DeliveryPreset = (typeof DELIVERY_PRESETS)[number];
export const DELIVERY_OPS = [
  'trim_silence',
  'trim_filler',
  'insert_pause',
  'speed_ramp',
  'gain_automation',
  'dynamics_chain',
  'music_ducking',
] as const;
export type DeliveryOpName = (typeof DELIVERY_OPS)[number];

export type DeliveryOperation = {
  id: string;
  op: DeliveryOpName;
  start: number;
  end: number;
  params: Record<string, unknown>;
  reason: string;
};

export type AcousticSentence = {
  sentenceIndex: number;
  start: number;
  end: number;
  pitchMeanHz: number;
  pitchVariance: number;
  energyMeanDb: number;
  energyVariance: number;
  wordsPerSec: number;
  monotonyScore: number;
  naturalPauseAfterMs: number;
};

export type LoudnessStats = {
  integratedLufs: number;
  truePeakDbtp: number;
};

export type DeliveryShapingClip = {
  type: typeof DELIVERY_SHAPING_TYPE;
  start: number;
  end: number;
  intensity: DeliveryIntensity;
  preset: DeliveryPreset;
  seed?: number;
  useLlmEmphasis: boolean;
  ops: DeliveryOperation[];
  timeRemap: TimeRemap;
  acoustic: AcousticSentence[];
  loudnessBefore?: LoudnessStats;
  loudnessAfter?: LoudnessStats;
  summary: {
    timeRemovedSec: number;
    timeAddedSec: number;
    averageSpeed: number;
    operationCount: number;
  };
  reason: string;
};

export type DeliveryViolation = {
  code: string;
  operationId?: string;
  reason: string;
};

export type DeliveryValidationResult = {
  ops: DeliveryOperation[];
  timeRemap: TimeRemap;
  violations: DeliveryViolation[];
  coercions: string[];
  drops: string[];
  summary: DeliveryShapingClip['summary'];
};

export const DEFAULT_FILLERS = [
  'um',
  'uh',
  'uhm',
  'erm',
  'hmm',
  'you know',
  'i mean',
];

export const DELIVERY_PRESET_PARAMS: Record<
  DeliveryPreset,
  {
    targetLufs: number;
    compressorThresholdDb: number;
    compressorRatio: number;
    highPassHz: number;
    presenceDb: number;
    deesserAmount: number;
    limiterDbtp: number;
  }
> = {
  natural: {
    targetLufs: -14,
    compressorThresholdDb: -20,
    compressorRatio: 2.2,
    highPassHz: 80,
    presenceDb: 1.2,
    deesserAmount: 0.25,
    limiterDbtp: -1.2,
  },
  punchy: {
    targetLufs: -14,
    compressorThresholdDb: -22,
    compressorRatio: 3.2,
    highPassHz: 80,
    presenceDb: 2,
    deesserAmount: 0.35,
    limiterDbtp: -1.2,
  },
  podcast: {
    targetLufs: -16,
    compressorThresholdDb: -21,
    compressorRatio: 2.8,
    highPassHz: 75,
    presenceDb: 1.5,
    deesserAmount: 0.4,
    limiterDbtp: -1.2,
  },
};

const MAX_SPEED_SHARE = 0.3;
const MAX_TRIM_SHARE = 0.25;
const MIN_PAUSE_GAP_SEC = 3;
const MAX_PAUSES_PER_MINUTE = 6;
const EPSILON = 1e-6;

export function validateDeliveryOperations(input: {
  ops: DeliveryOperation[];
  sourceDurationSec: number;
  words: Array<{start: number; end: number; speakerId?: string}>;
  speakerChanges?: number[];
  musicPresent?: boolean;
  crossfadeMs?: number;
}): DeliveryValidationResult {
  const duration = Math.max(0.1, input.sourceDurationSec);
  const violations: DeliveryViolation[] = [];
  const coercions: string[] = [];
  const drops: string[] = [];
  const kept: DeliveryOperation[] = [];
  let trimmedSec = 0;
  let speedSec = 0;
  let fillerRemovals = 0;
  let pauseCount = 0;
  let lastPauseAt = -Infinity;
  const maxPauses = Math.max(1, Math.floor((duration / 60) * MAX_PAUSES_PER_MINUTE));

  for (const raw of [...input.ops].sort((a, b) => a.start - b.start)) {
    const id = raw.id || `${raw.op}_${kept.length}`;
    let start = clamp(raw.start, 0, duration);
    let end = clamp(raw.end, start, duration);
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end)) {
      drop('delivery_invalid_window', id, 'Operation has a non-finite time');
      continue;
    }
    if (crossesSpeakerChange(start, end, input.speakerChanges ?? [])) {
      drop('delivery_speaker_change', id, 'Operation crosses a speaker change');
      continue;
    }

    if (raw.op === 'trim_silence' || raw.op === 'trim_filler') {
      if (raw.op === 'trim_filler') {
        const maxPerMinute = Math.round(
          clamp(numberParam(raw.params.maxRemovalsPerMinute, 8), 1, 20),
        );
        const maxFillers = Math.max(
          1,
          Math.floor((duration / 60) * maxPerMinute),
        );
        if (fillerRemovals >= maxFillers) {
          drop(
            'delivery_filler_count',
            id,
            `Filler removal cap is ${maxFillers}`,
          );
          continue;
        }
      }
      const snapped = snapCutRange(start, end, input.words);
      if (!snapped) {
        drop('delivery_mid_word', id, 'Trim would cut inside a spoken word');
        continue;
      }
      start = snapped.start;
      end = snapped.end;
      const keepMs =
        raw.op === 'trim_filler'
          ? 0
          : clamp(numberParam(raw.params.keepMs, 150), 50, 400);
      const removable = Math.max(0, end - start - keepMs / 1000);
      if (removable <= 0.02) {
        drop('delivery_trim_too_small', id, 'Trim leaves no removable pause');
        continue;
      }
      if ((trimmedSec + removable) / duration > MAX_TRIM_SHARE + EPSILON) {
        drop('delivery_trim_share', id, 'Would remove more than 25% of runtime');
        continue;
      }
      const trimStart = start + keepMs / 2000;
      const trimEnd = end - keepMs / 2000;
      trimmedSec += trimEnd - trimStart;
      if (raw.op === 'trim_filler') {
        fillerRemovals += 1;
      }
      kept.push({
        ...raw,
        id,
        start: trimStart,
        end: trimEnd,
        params: {
          ...raw.params,
          minSilenceMs: clamp(numberParam(raw.params.minSilenceMs, 400), 200, 2_500),
          keepMs,
          silenceThresholdDb: clamp(
            numberParam(raw.params.silenceThresholdDb, -42),
            -60,
            -24,
          ),
          ...(raw.op === 'trim_filler'
            ? {
                fillerList: stringArrayParam(raw.params.fillerList, DEFAULT_FILLERS),
                maxRemovalsPerMinute: Math.round(
                  clamp(numberParam(raw.params.maxRemovalsPerMinute, 8), 1, 20),
                ),
              }
            : {}),
        },
      });
      continue;
    }

    if (raw.op === 'insert_pause') {
      const at = nearestBoundary(
        raw.params.position === 'before_word' ? start : end,
        input.words,
      );
      if (at === null) {
        drop('delivery_pause_mid_word', id, 'Pause is not on a word boundary');
        continue;
      }
      if (pauseCount >= maxPauses) {
        drop('delivery_pause_count', id, `Pause cap is ${maxPauses}`);
        continue;
      }
      if (at - lastPauseAt < MIN_PAUSE_GAP_SEC) {
        drop('delivery_pause_spacing', id, 'Pauses must be at least 3s apart');
        continue;
      }
      if (
        kept.some(
          op =>
            op.op === 'speed_ramp' &&
            overlapsPoint(at, op.start, op.end),
        )
      ) {
        drop(
          'delivery_incompatible_stack',
          id,
          'Inserted pause overlaps a speed ramp',
        );
        continue;
      }
      const durationMs = clamp(numberParam(raw.params.durationMs, 300), 200, 500);
      const position = ['before_word', 'after_word', 'sentence_end'].includes(
        String(raw.params.position),
      )
        ? String(raw.params.position)
        : 'after_word';
      kept.push({
        ...raw,
        id,
        start: at,
        end: at,
        params: {
          ...raw.params,
          position,
          durationMs,
          fill: raw.params.fill === 'silence' ? 'silence' : 'room_tone',
        },
      });
      pauseCount += 1;
      lastPauseAt = at;
      continue;
    }

    if (raw.op === 'speed_ramp') {
      const snapped = snapSpokenRange(start, end, input.words);
      if (!snapped || snapped.end - snapped.start < 0.25) {
        drop('delivery_speed_window', id, 'Speed ramp needs a clean spoken range');
        continue;
      }
      start = snapped.start;
      end = snapped.end;
      if (kept.some(op => op.op === 'insert_pause' && overlapsPoint(op.start, start, end))) {
        drop('delivery_incompatible_stack', id, 'Speed ramp overlaps an inserted pause');
        continue;
      }
      const span = end - start;
      if ((speedSec + span) / duration > MAX_SPEED_SHARE + EPSILON) {
        drop('delivery_speed_share', id, 'Would speed-alter more than 30% of runtime');
        continue;
      }
      speedSec += span;
      kept.push({
        ...raw,
        id,
        start,
        end,
        params: {
          ...raw.params,
          rate: clamp(numberParam(raw.params.rate, 1), 0.85, 1.12),
          rampInMs: clamp(numberParam(raw.params.rampInMs, 120), 40, 300),
          rampOutMs: clamp(numberParam(raw.params.rampOutMs, 120), 40, 300),
        },
      });
      continue;
    }

    if (raw.op === 'gain_automation') {
      const snapped = snapSpokenRange(start, end, input.words);
      if (!snapped) {
        drop('delivery_gain_window', id, 'Gain range does not cover spoken words');
        continue;
      }
      kept.push({
        ...raw,
        id,
        start: snapped.start,
        end: snapped.end,
        params: {
          ...raw.params,
          gainDb: clamp(numberParam(raw.params.gainDb, 0), -4, 4),
          attackMs: clamp(numberParam(raw.params.attackMs, 30), 5, 500),
          releaseMs: clamp(numberParam(raw.params.releaseMs, 120), 10, 1_000),
        },
      });
      continue;
    }

    if (raw.op === 'dynamics_chain') {
      const preset = isPreset(raw.params.preset)
        ? raw.params.preset
        : 'natural';
      kept.push({
        ...raw,
        id,
        start: 0,
        end: duration,
        params: {
          ...DELIVERY_PRESET_PARAMS[preset],
          ...raw.params,
          preset,
          targetLufs: clamp(numberParam(raw.params.targetLufs, -14), -18, -12),
          limiterDbtp: Math.min(-1.2, numberParam(raw.params.limiterDbtp, -1.2)),
        },
      });
      continue;
    }

    if (raw.op === 'music_ducking') {
      if (!input.musicPresent) {
        drops.push(`drop:${id}:no_music`);
        continue;
      }
      kept.push({
        ...raw,
        id,
        start: 0,
        end: duration,
        params: {
          ...raw.params,
          duckDb: clamp(numberParam(raw.params.duckDb, -12), -24, -3),
          attackMs: clamp(numberParam(raw.params.attackMs, 40), 5, 300),
          releaseMs: clamp(numberParam(raw.params.releaseMs, 320), 50, 1_500),
        },
      });
    }
  }

  const timingOps = kept.flatMap(toTimingOperation);
  const timeRemap = buildTimeRemap({
    sourceDurationSec: duration,
    ops: timingOps,
    crossfadeMs: input.crossfadeMs,
  });
  const timeAddedSec = kept
    .filter(op => op.op === 'insert_pause')
    .reduce((sum, op) => sum + numberParam(op.params.durationMs, 0) / 1000, 0);
  const mediaSource = timeRemap.segments
    .filter(segment => segment.kind === 'media')
    .reduce((sum, segment) => sum + segment.sourceEnd - segment.sourceStart, 0);
  const mediaOutput = timeRemap.segments
    .filter(segment => segment.kind === 'media')
    .reduce((sum, segment) => sum + segment.outputEnd - segment.outputStart, 0);

  return {
    ops: kept,
    timeRemap,
    violations,
    coercions,
    drops,
    summary: {
      timeRemovedSec: round(trimmedSec),
      timeAddedSec: round(timeAddedSec),
      averageSpeed: round(mediaOutput > 0 ? mediaSource / mediaOutput : 1, 4),
      operationCount: kept.length,
    },
  };

  function drop(code: string, operationId: string, reason: string) {
    violations.push({code, operationId, reason});
    drops.push(`drop:${operationId}:${code}`);
  }
}

function toTimingOperation(op: DeliveryOperation): TimingOperation[] {
  if (op.op === 'trim_silence' || op.op === 'trim_filler') {
    return [{op: op.op, start: op.start, end: op.end}];
  }
  if (op.op === 'insert_pause') {
    return [
      {
        op: 'insert_pause',
        start: op.start,
        end: op.end,
        params: {
          position: String(op.params.position) as
            | 'before_word'
            | 'after_word'
            | 'sentence_end',
          durationMs: numberParam(op.params.durationMs, 300),
        },
      },
    ];
  }
  if (op.op === 'speed_ramp') {
    return [
      {
        op: 'speed_ramp',
        start: op.start,
        end: op.end,
        params: {
          rate: numberParam(op.params.rate, 1),
          rampInMs: numberParam(op.params.rampInMs, 120),
          rampOutMs: numberParam(op.params.rampOutMs, 120),
        },
      },
    ];
  }
  return [];
}

function snapCutRange(
  start: number,
  end: number,
  words: Array<{start: number; end: number}>,
): {start: number; end: number} | null {
  if (words.some(word => start > word.start + EPSILON && start < word.end - EPSILON)) {
    return null;
  }
  if (words.some(word => end > word.start + EPSILON && end < word.end - EPSILON)) {
    return null;
  }
  return end > start ? {start, end} : null;
}

function snapSpokenRange(
  start: number,
  end: number,
  words: Array<{start: number; end: number}>,
): {start: number; end: number} | null {
  const inside = words.filter(word => word.end > start && word.start < end);
  if (inside.length === 0) {
    return null;
  }
  return {start: inside[0]!.start, end: inside.at(-1)!.end};
}

function nearestBoundary(
  target: number,
  words: Array<{start: number; end: number}>,
): number | null {
  const boundaries = words.flatMap(word => [word.start, word.end]);
  let best: number | null = null;
  let distance = 0.12;
  for (const edge of boundaries) {
    const next = Math.abs(edge - target);
    if (next <= distance) {
      best = edge;
      distance = next;
    }
  }
  return best;
}

function crossesSpeakerChange(start: number, end: number, changes: number[]): boolean {
  return changes.some(at => at > start + EPSILON && at < end - EPSILON);
}

function overlapsPoint(point: number, start: number, end: number): boolean {
  return point >= start - EPSILON && point <= end + EPSILON;
}

function numberParam(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArrayParam(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, 40);
}

function isPreset(value: unknown): value is DeliveryPreset {
  return (DELIVERY_PRESETS as readonly unknown[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
