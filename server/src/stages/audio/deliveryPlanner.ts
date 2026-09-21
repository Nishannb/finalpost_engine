import {stageLogger} from '../../lib/logger.ts';
import {
  DEFAULT_FILLERS,
  validateDeliveryOperations,
  type AcousticSentence,
  type DeliveryIntensity,
  type DeliveryOperation,
  type DeliveryPreset,
  type DeliveryValidationResult,
} from '../../lib/deliveryShaping.ts';
import type {WordToken} from '../../types/blueprint.ts';
import {callDirectorModel} from '../directorV2/geminiClient.ts';
import {DELIVERY_SHAPING_DECISION_SCHEMA} from '../directorV2/schemas.ts';

const log = stageLogger('delivery-planner');

export type EmphasisMark = {
  wordIndexStart: number;
  wordIndexEnd: number;
  type: 'emphasis' | 'beat' | 'rush' | 'breath';
  reason: string;
};

const INTENSITY = {
  subtle: {gain: 1.8, slow: 0.94, rush: 1.04, pause: 240, frequency: 0.55},
  balanced: {gain: 2.5, slow: 0.92, rush: 1.06, pause: 320, frequency: 0.8},
  energetic: {gain: 3, slow: 0.89, rush: 1.08, pause: 400, frequency: 1},
} as const;

const CONTRAST = /^(but|however|instead|yet|although|except|actually)[,.:;!?]*$/i;
const LIST = /^(first|second|third|finally|next|one|two|three)[,.:;!?]*$/i;
const NUMBER = /(?:\d|percent|percentage|million|billion|thousand|hundred|%)/i;

export type DeliveryDirectorDecision = {
  intensity: DeliveryIntensity;
  preset: DeliveryPreset;
  useLlmEmphasis: boolean;
  ops?: DeliveryOperation[];
  reason: string;
};

export async function directDeliveryShaping(input: {
  words: WordToken[];
  acoustic: AcousticSentence[];
  durationSec: number;
  musicPresent: boolean;
  loudness: {integratedLufs: number; truePeakDbtp: number};
}): Promise<DeliveryDirectorDecision> {
  const prompt = [
    'Choose Delivery Shaping before any visual edits.',
    'It changes timing/loudness only; never changes voice identity.',
    'Prefer subtle. Use energetic only for very flat delivery.',
    'Do not use aggressive timing on singing, music-driven speech, or action-synced material.',
    `DURATION_SEC: ${input.durationSec}`,
    `MUSIC_PRESENT: ${input.musicPresent}`,
    `LOUDNESS: ${JSON.stringify(input.loudness)}`,
    `ACOUSTIC_SENTENCES: ${JSON.stringify(input.acoustic)}`,
    'TIMESTAMPED_WORDS:',
    input.words
      .map(
        (word, index) =>
          `${index} [${word.start.toFixed(2)}-${word.end.toFixed(2)}] ${word.text}`,
      )
      .join('\n'),
  ].join('\n');
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callDirectorModel({
        system:
          'You are the delivery preflight for a video editor. Return only a conservative structured decision. The deterministic planner and validator own execution.',
        label: `delivery director attempt ${attempt + 1}`,
        responseSchema: DELIVERY_SHAPING_DECISION_SCHEMA,
        temperature: 0.2,
        thinkingBudget: 1_500,
        timeoutMs: 75_000,
        parts: [{text: prompt.slice(0, 40_000)}],
      });
      const row = response.json as Record<string, unknown>;
      const intensity = String(row.intensity);
      if (!['subtle', 'balanced', 'energetic'].includes(intensity)) {
        throw new Error('invalid delivery intensity');
      }
      const presets =
        row.presets && typeof row.presets === 'object'
          ? (row.presets as Record<string, unknown>)
          : {};
      const preset = ['natural', 'punchy', 'podcast'].includes(
        String(presets.dynamics),
      )
        ? (String(presets.dynamics) as DeliveryPreset)
        : 'natural';
      return {
        intensity: intensity as DeliveryIntensity,
        preset,
        useLlmEmphasis: Boolean(row.useLlmEmphasis),
        ops: parseDirectorOps(row.ops),
        reason: String(row.reason ?? 'Director selected delivery shaping.').slice(
          0,
          500,
        ),
      };
    } catch (error) {
      lastError = error;
    }
  }
  log.warn({error: lastError}, 'delivery Director invalid; using balanced rules');
  return {
    intensity: 'balanced',
    preset: 'natural',
    useLlmEmphasis: false,
    reason: 'Director fallback: balanced deterministic rule planner.',
  };
}

export async function planDeliveryShaping(input: {
  words: WordToken[];
  sentences: Array<{start: number; end: number}>;
  acoustic: AcousticSentence[];
  sourceDurationSec: number;
  intensity?: DeliveryIntensity;
  preset?: DeliveryPreset;
  enabledOps?: string[];
  musicPresent?: boolean;
  useLlmEmphasis?: boolean;
  explicitOps?: DeliveryOperation[];
}): Promise<DeliveryValidationResult & {
  intensity: DeliveryIntensity;
  preset: DeliveryPreset;
  reason: string;
  marks: EmphasisMark[];
}> {
  const meanMonotony =
    input.acoustic.length > 0
      ? input.acoustic.reduce((sum, item) => sum + item.monotonyScore, 0) /
        input.acoustic.length
      : 0.5;
  const intensity =
    input.intensity ??
    (meanMonotony >= 0.82
      ? 'energetic'
      : meanMonotony >= 0.62
        ? 'balanced'
        : 'subtle');
  const preset = input.preset ?? (meanMonotony >= 0.72 ? 'punchy' : 'natural');
  const enabled = new Set(
    input.enabledOps ?? [
      'trim_silence',
      'trim_filler',
      'insert_pause',
      'speed_ramp',
      'gain_automation',
      'dynamics_chain',
      'music_ducking',
    ],
  );
  const marks = input.useLlmEmphasis
    ? await llmEmphasisMarks(input.words).catch(error => {
        log.warn({error}, 'LLM delivery marks failed; using rules + acoustics');
        return [];
      })
    : [];
  const generated = input.explicitOps?.length
    ? input.explicitOps
    : ruleBasedOperations({
        ...input,
        intensity,
        enabled,
        marks,
      });
  const validated = validateDeliveryOperations({
    ops: generated,
    sourceDurationSec: input.sourceDurationSec,
    words: input.words,
    musicPresent: input.musicPresent,
  });
  const reason =
    meanMonotony >= 0.62
      ? `Monotony score ${meanMonotony.toFixed(2)}: tighten low-energy stretches and emphasize key phrases.`
      : `Delivery is already varied (monotony ${meanMonotony.toFixed(2)}): use restrained cleanup and dynamics.`;
  log.info(
    {
      intensity,
      preset,
      reason,
      operations: validated.ops.map(op => ({
        id: op.id,
        op: op.op,
        start: op.start,
        end: op.end,
        reason: op.reason,
      })),
      summary: validated.summary,
      drops: validated.drops,
    },
    'delivery shaping planned',
  );
  return {...validated, intensity, preset, reason, marks};
}

function ruleBasedOperations(input: {
  words: WordToken[];
  sentences: Array<{start: number; end: number}>;
  acoustic: AcousticSentence[];
  sourceDurationSec: number;
  intensity: DeliveryIntensity;
  enabled: Set<string>;
  marks: EmphasisMark[];
}): DeliveryOperation[] {
  const scale = INTENSITY[input.intensity];
  const ops: DeliveryOperation[] = [];
  let id = 0;
  const add = (
    op: DeliveryOperation['op'],
    start: number,
    end: number,
    params: Record<string, unknown>,
    reason: string,
  ) => {
    if (!input.enabled.has(op)) {
      return;
    }
    ops.push({id: `delivery_${++id}`, op, start, end, params, reason});
  };

  for (let index = 0; index < input.words.length - 1; index += 1) {
    const word = input.words[index]!;
    const next = input.words[index + 1]!;
    const gap = next.start - word.end;
    if (gap >= 0.4) {
      add(
        'trim_silence',
        word.end,
        next.start,
        {minSilenceMs: 400, keepMs: 150, silenceThresholdDb: -42},
        `Tighten ${Math.round(gap * 1_000)}ms of dead air without removing the natural beat.`,
      );
    }
    const normalized = normalizeWord(word.text);
    if (DEFAULT_FILLERS.includes(normalized) && gap >= 0.04) {
      add(
        'trim_filler',
        word.start,
        word.end,
        {fillerList: DEFAULT_FILLERS, maxRemovalsPerMinute: 8, keepMs: 80},
        `Remove isolated filler “${normalized}”.`,
      );
    }
    const phrase = `${normalized} ${normalizeWord(next.text)}`;
    if (DEFAULT_FILLERS.includes(phrase)) {
      add(
        'trim_filler',
        word.start,
        next.end,
        {fillerList: DEFAULT_FILLERS, maxRemovalsPerMinute: 8, keepMs: 0},
        `Remove isolated filler phrase “${phrase}”.`,
      );
    }
  }

  input.sentences.forEach((sentence, sentenceIndex) => {
    const words = input.words
      .map((word, wordIndex) => ({...word, wordIndex}))
      .filter(word => word.end > sentence.start && word.start < sentence.end);
    if (words.length === 0) {
      return;
    }
    const acoustic = input.acoustic[sentenceIndex];
    const monotony = acoustic?.monotonyScore ?? 0.5;
    const flatEnough = monotony >= 0.55;
    const last = words.at(-1)!;
    const question = /\?$/.test(last.text);
    const key = words.find(word => NUMBER.test(word.text) || CONTRAST.test(word.text) || LIST.test(word.text));

    if (
      (question || Boolean(key)) &&
      (acoustic?.naturalPauseAfterMs ?? 0) < 180 &&
      flatEnough
    ) {
      add(
        'insert_pause',
        last.end,
        last.end,
        {
          position: 'sentence_end',
          durationMs: scale.pause,
          fill: 'room_tone',
        },
        question
          ? 'Add a deliberate beat after the question.'
          : 'Let the statistic/list point land before continuing.',
      );
    }

    if (key && flatEnough) {
      const keyStart = Math.max(0, key.wordIndex - 1);
      const keyEnd = Math.min(input.words.length - 1, key.wordIndex + 1);
      add(
        'speed_ramp',
        input.words[keyStart]!.start,
        input.words[keyEnd]!.end,
        {rate: scale.slow, rampInMs: 120, rampOutMs: 120},
        `Slow the key phrase around “${normalizeWord(key.text)}” so it registers.`,
      );
      add(
        'gain_automation',
        key.start,
        key.end,
        {gainDb: scale.gain, attackMs: 25, releaseMs: 140},
        `Lift “${normalizeWord(key.text)}” without changing voice character.`,
      );
    }

    const duration = sentence.end - sentence.start;
    if (
      flatEnough &&
      words.length >= 12 &&
      duration >= 4.5 &&
      !key &&
      monotony * scale.frequency >= 0.48
    ) {
      const middleStart = words[Math.floor(words.length * 0.2)]!;
      const middleEnd = words[Math.floor(words.length * 0.75)]!;
      add(
        'speed_ramp',
        middleStart.start,
        middleEnd.end,
        {rate: scale.rush, rampInMs: 120, rampOutMs: 120},
        'Move through a long low-information stretch with more momentum.',
      );
    }
  });

  for (const mark of input.marks) {
    const start = input.words[mark.wordIndexStart];
    const end = input.words[mark.wordIndexEnd];
    if (!start || !end) {
      continue;
    }
    if (mark.type === 'emphasis') {
      add(
        'gain_automation',
        start.start,
        end.end,
        {gainDb: scale.gain, attackMs: 25, releaseMs: 140},
        mark.reason,
      );
    } else if (mark.type === 'rush') {
      add(
        'speed_ramp',
        start.start,
        end.end,
        {rate: scale.rush, rampInMs: 120, rampOutMs: 120},
        mark.reason,
      );
    } else if (mark.type === 'beat' || mark.type === 'breath') {
      add(
        'insert_pause',
        end.end,
        end.end,
        {position: 'after_word', durationMs: scale.pause, fill: 'room_tone'},
        mark.reason,
      );
    }
  }

  add(
    'dynamics_chain',
    0,
    input.sourceDurationSec,
    {preset: input.intensity === 'energetic' ? 'punchy' : 'natural', targetLufs: -14},
    'Even out dynamics and normalize speech while preserving the speaker’s voice.',
  );
  return ops;
}

async function llmEmphasisMarks(words: WordToken[]): Promise<EmphasisMark[]> {
  const schema = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        wordIndexStart: {type: 'INTEGER'},
        wordIndexEnd: {type: 'INTEGER'},
        type: {
          type: 'STRING',
          enum: ['emphasis', 'beat', 'rush', 'breath'],
        },
        reason: {type: 'STRING'},
      },
      required: ['wordIndexStart', 'wordIndexEnd', 'type', 'reason'],
    },
  } as const;
  const transcript = words
    .map((word, index) => `${index} [${word.start.toFixed(2)}-${word.end.toFixed(2)}] ${word.text}`)
    .join('\n');
  const result = await callDirectorModel({
    system:
      'Mark delivery emphasis only. Do not rewrite speech. Return JSON only. Prefer few, high-value marks.',
    label: 'delivery emphasis marker',
    responseSchema: schema,
    temperature: 0.2,
    thinkingBudget: 1_024,
    timeoutMs: 60_000,
    parts: [{text: transcript.slice(0, 24_000)}],
  });
  if (!Array.isArray(result.json)) {
    return [];
  }
  return result.json.flatMap((row): EmphasisMark[] => {
    if (!row || typeof row !== 'object') {
      return [];
    }
    const item = row as Record<string, unknown>;
    const start = Math.round(Number(item.wordIndexStart));
    const end = Math.round(Number(item.wordIndexEnd));
    const type = String(item.type);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      end >= words.length ||
      !['emphasis', 'beat', 'rush', 'breath'].includes(type)
    ) {
      return [];
    }
    return [
      {
        wordIndexStart: start,
        wordIndexEnd: end,
        type: type as EmphasisMark['type'],
        reason: String(item.reason ?? '').slice(0, 240),
      },
    ];
  }).slice(0, 12);
}

function normalizeWord(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function parseDirectorOps(value: unknown): DeliveryOperation[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const parsed = value.flatMap((row, index): DeliveryOperation[] => {
    if (!row || typeof row !== 'object') {
      return [];
    }
    const item = row as Record<string, unknown>;
    const op = String(item.op);
    if (
      ![
        'trim_silence',
        'trim_filler',
        'insert_pause',
        'speed_ramp',
        'gain_automation',
        'dynamics_chain',
        'music_ducking',
      ].includes(op)
    ) {
      return [];
    }
    return [
      {
        id: `director_delivery_${index + 1}`,
        op: op as DeliveryOperation['op'],
        start: Number(item.start),
        end: Number(item.end),
        params:
          item.params && typeof item.params === 'object'
            ? (item.params as Record<string, unknown>)
            : {},
        reason: String(item.reason ?? 'Director-selected operation.').slice(0, 500),
      },
    ];
  });
  return parsed.length > 0 ? parsed : undefined;
}
