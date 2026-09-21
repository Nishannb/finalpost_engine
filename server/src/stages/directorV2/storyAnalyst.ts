import {callDirectorModel, frameParts} from './geminiClient.ts';
import {
  fillTemplate,
  loadPromptFile,
  STAGE1_PROMPT_VERSION,
} from './promptLoader.ts';
import {BEAT_ROLES, CONTENT_TYPES, CTA_ACTIONS, PACING_TARGETS, SPEAKER_PRESENCE, STAGE1_RESPONSE_SCHEMA, VISUAL_POTENTIAL} from './schemas.ts';
import type {BeatRole, PerceptionPack, StoryAnalysis, StoryBeat} from './types.ts';
import {formatAudioFacts, formatFrameLabels, formatWordIdTranscript} from './perception.ts';

export async function analyzeStory(pack: PerceptionPack): Promise<StoryAnalysis> {
  const frames = await frameParts(pack.storyboard.map(frame => frame.path));
  const system = loadPromptFile(STAGE1_PROMPT_VERSION);
  const user = fillStage1User(pack);
  const first = await callDirectorModel({
    system,
    label: 'Director v2 story analyst',
    responseSchema: STAGE1_RESPONSE_SCHEMA,
    temperature: 0.3,
    thinkingBudget: 4096,
    parts: [...frames, {text: user}],
  });
  let story = parseStory(first.json, first.estimatedCostUsd, pack, {
    promptVersion: STAGE1_PROMPT_VERSION,
    inputHash: first.inputHash,
  });
  const errors = beatCoverageErrors(story.beats, pack);
  if (errors.length === 0) {
    return story;
  }

  const repaired = await callDirectorModel({
    system,
    label: 'Director v2 story analyst repair',
    responseSchema: STAGE1_RESPONSE_SCHEMA,
    temperature: 0.2,
    thinkingBudget: 2048,
    parts: [
      ...frames,
      {
        text:
          `${user}\n\nVALIDATION ERRORS — fix only these, then return the full JSON:\n` +
          errors.map(item => `- ${item}`).join('\n'),
      },
    ],
  });
  story = parseStory(repaired.json, first.estimatedCostUsd + repaired.estimatedCostUsd, pack, {
    promptVersion: STAGE1_PROMPT_VERSION,
    inputHash: first.inputHash,
  });
  if (beatCoverageErrors(story.beats, pack).length === 0) {
    return story;
  }
  return {
    ...story,
    beats: sentenceBeats(pack),
  };
}

export function fillStage1User(pack: PerceptionPack, template?: string): string {
  const source = template ?? loadPromptFile('stage1_story_analyst.user.v1');
  return fillTemplate(source, {
    OUTPUT_DURATION_SEC: pack.outputDurationSec.toFixed(1),
    LANGUAGE: pack.language || 'en',
    'CREATOR_PROFILE_OR_"none"': pack.creatorProfile.trim() || 'none',
    PAUSES_AND_ENERGY_PEAKS_AND_EMPHASIZED_WORDS: formatAudioFacts(pack),
    WORD_ID_TRANSCRIPT: formatWordIdTranscript(pack),
    'FRAME_LABELS + IMAGES': formatFrameLabels(pack),
  });
}

export function parseStory(
  raw: unknown,
  estimatedCostUsd: number,
  pack: PerceptionPack,
  meta: {promptVersion: string; inputHash: string} = {
    promptVersion: STAGE1_PROMPT_VERSION,
    inputHash: '',
  },
): StoryAnalysis {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ids = new Set(pack.words.map(word => word.id));
  const hookRaw = record.hook && typeof record.hook === 'object'
    ? (record.hook as Record<string, unknown>)
    : {};
  const coldRaw = hookRaw.cold_open && typeof hookRaw.cold_open === 'object'
    ? (hookRaw.cold_open as Record<string, unknown>)
    : {};
  const ctaRaw = record.existing_cta && typeof record.existing_cta === 'object'
    ? (record.existing_cta as Record<string, unknown>)
    : {};
  const opening = pack.words[0];
  const openingEnd = pack.words.find(word => word.end >= (opening?.start ?? 0) + 2) ?? pack.words.at(-1);

  const beats: StoryBeat[] = [];
  const rows = Array.isArray(record.beats) ? record.beats : [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const item = row as Record<string, unknown>;
    const startWordId = String(item.start_word_id ?? item.startWordId ?? '');
    const endWordId = String(item.end_word_id ?? item.endWordId ?? '');
    if (!ids.has(startWordId) || !ids.has(endWordId)) {
      continue;
    }
    const role = coerceEnum(item.role, BEAT_ROLES) ?? 'claim';
    const presence = coerceEnum(item.speaker_presence, SPEAKER_PRESENCE) ?? 'preferred';
    const onScreen = String(item.what_is_on_screen ?? item.visual_now ?? item.visualNow ?? 'unknown');
    beats.push({
      id: String(item.id ?? `b${index + 1}`),
      startWordId,
      endWordId,
      role,
      importance: clampInt(item.importance, 1, 5, 3),
      energy: clampInt(item.energy, 1, 5, 3),
      whatIsOnScreen: onScreen,
      viewerNeed: String(item.viewer_need ?? item.viewerNeed ?? ''),
      speakerPresence: presence,
      visualPotential: coerceEnum(item.visual_potential, VISUAL_POTENTIAL) ?? 'light',
      visualNow: onScreen,
      speakerOnScreen: presence !== 'optional',
    });
  }

  const arcRows = Array.isArray(record.emotional_arc) ? record.emotional_arc : [];
  const emotionalArc = arcRows.flatMap(row => {
    if (!row || typeof row !== 'object') {
      return [];
    }
    const item = row as Record<string, unknown>;
    const startWordId = String(item.start_word_id ?? '');
    const endWordId = String(item.end_word_id ?? '');
    if (!ids.has(startWordId) || !ids.has(endWordId)) {
      return [];
    }
    return [{
      phase: String(item.phase ?? ''),
      startWordId,
      endWordId,
      feeling: String(item.feeling ?? ''),
    }];
  });

  const hookStart = ids.has(String(hookRaw.start_word_id ?? ''))
    ? String(hookRaw.start_word_id)
    : opening?.id ?? 'w0';
  const hookEnd = ids.has(String(hookRaw.end_word_id ?? ''))
    ? String(hookRaw.end_word_id)
    : openingEnd?.id ?? hookStart;
  const coldStart = ids.has(String(coldRaw.start_word_id ?? ''))
    ? String(coldRaw.start_word_id)
    : hookStart;
  const coldEnd = ids.has(String(coldRaw.end_word_id ?? ''))
    ? String(coldRaw.end_word_id)
    : hookEnd;

  const pacing = (Array.isArray(record.pacing) ? record.pacing : []).flatMap(row => {
    if (!row || typeof row !== 'object') {
      return [];
    }
    const item = row as Record<string, unknown>;
    const beatIds = Array.isArray(item.beat_ids) ? item.beat_ids.map(value => String(value)) : [];
    return [{
      beatIds,
      target: coerceEnum(item.target, PACING_TARGETS) ?? 'medium',
      why: String(item.why ?? ''),
    }];
  });

  return {
    contentType: coerceEnum(record.content_type, CONTENT_TYPES) ?? 'other',
    audience: String(record.audience ?? ''),
    promise: String(record.promise ?? ''),
    tone: String(record.tone ?? ''),
    emotionalArc,
    hook: {
      startWordId: hookStart,
      endWordId: hookEnd,
      stoppingPower: clampInt(hookRaw.stopping_power, 1, 5, 3),
      weakness: String(hookRaw.weakness ?? ''),
      coldOpen: {
        recommended: coldRaw.recommended === true,
        startWordId: coldStart,
        endWordId: coldEnd,
        reason: String(coldRaw.reason ?? ''),
      },
    },
    coreMessage: String(record.core_message ?? record.coreMessage ?? ''),
    beats,
    existingCta: {
      present: ctaRaw.present === true,
      startWordId: ids.has(String(ctaRaw.start_word_id ?? '')) ? String(ctaRaw.start_word_id) : '',
      endWordId: ids.has(String(ctaRaw.end_word_id ?? '')) ? String(ctaRaw.end_word_id) : '',
      action: coerceEnum(ctaRaw.action, CTA_ACTIONS) ?? 'other',
      keyword: String(ctaRaw.keyword ?? ''),
      suggested: ctaRaw.suggested === true,
      suggestedBeatId: String(ctaRaw.suggested_beat_id ?? ''),
      suggestedSpokenLine: String(ctaRaw.suggested_spoken_line ?? ''),
    },
    pacing,
    risks: Array.isArray(record.risks) ? record.risks.map(value => String(value)) : [],
    estimatedCostUsd,
    promptVersion: meta.promptVersion,
    inputHash: meta.inputHash,
    raw,
  };
}

export function beatCoverageErrors(beats: StoryBeat[], pack: PerceptionPack): string[] {
  const errors: string[] = [];
  if (pack.words.length === 0) {
    return ['transcript has no words'];
  }
  if (beats.length === 0) {
    return ['no beats'];
  }
  const index = new Map(pack.words.map((word, i) => [word.id, i]));
  for (const beat of beats) {
    if (!index.has(beat.startWordId)) {
      errors.push(`${beat.id} unknown start_word_id ${beat.startWordId}`);
    }
    if (!index.has(beat.endWordId)) {
      errors.push(`${beat.id} unknown end_word_id ${beat.endWordId}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  const sorted = [...beats].sort(
    (a, b) => (index.get(a.startWordId) ?? 0) - (index.get(b.startWordId) ?? 0),
  );
  if (sorted[0]!.startWordId !== pack.words[0]!.id) {
    errors.push(`beats must start at ${pack.words[0]!.id}`);
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const start = index.get(sorted[i]!.startWordId)!;
    const end = index.get(sorted[i]!.endWordId)!;
    if (end < start) {
      errors.push(`${sorted[i]!.id} end is before start`);
    }
    if (i > 0) {
      const prevEnd = index.get(sorted[i - 1]!.endWordId)!;
      if (start !== prevEnd + 1) {
        errors.push(`${sorted[i]!.id} does not continue from ${sorted[i - 1]!.id} (gap or overlap)`);
      }
    }
  }
  if (sorted.at(-1)!.endWordId !== pack.words.at(-1)!.id) {
    errors.push(`beats must end at ${pack.words.at(-1)!.id}`);
  }
  return errors;
}

export function sentenceBeats(pack: PerceptionPack): StoryBeat[] {
  const groups = pack.sentences.length > 0
    ? pack.sentences
    : [{
        id: 's0',
        wordIds: pack.words.map(word => word.id),
        start: pack.words[0]?.start ?? 0,
        end: pack.words.at(-1)?.end ?? 0,
        text: pack.transcript,
      }];
  return groups.map((sentence, index) => {
    const role: BeatRole =
      index === 0 ? 'hook' : index === groups.length - 1 ? 'cta' : 'claim';
    return {
      id: `b${index + 1}`,
      startWordId: sentence.wordIds[0] ?? pack.words[0]?.id ?? 'w0',
      endWordId: sentence.wordIds.at(-1) ?? pack.words.at(-1)?.id ?? 'w0',
      role,
      importance: index === 0 ? 5 : 3,
      energy: 3,
      whatIsOnScreen: 'unknown',
      viewerNeed: sentence.text.slice(0, 80),
      speakerPresence: 'preferred' as const,
      visualPotential: 'light' as const,
      visualNow: 'unknown',
      speakerOnScreen: true,
    };
  });
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function coerceEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  const value = String(raw ?? '').trim();
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
