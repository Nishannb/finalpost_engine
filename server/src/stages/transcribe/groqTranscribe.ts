/**
 * Stage A — multi-lingual speech extraction via Groq `whisper-large-v3-turbo`.
 *
 * Turbo is the whole cost story: $0.04 per audio hour at a ~216x realtime speed
 * factor, so a 5-minute clip transcribes in seconds for ~$0.0033. We always ask
 * for `verbose_json` + word granularity because every downstream filter (trim,
 * zoom, caption karaoke) is driven by word boundaries, not segments.
 */

import {createHash} from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  openAsBlob,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {LanguageCode, WordToken} from '../../types/blueprint.ts';
import {observe} from '../../lib/runObserver.ts';

const GROQ_TRANSCRIPTION_URL =
  'https://api.groq.com/openai/v1/audio/transcriptions';

/** Groq bills per audio hour; keep the rate here so cost math has one source. */
export const GROQ_USD_PER_AUDIO_HOUR = 0.04;

const log = stageLogger('stage-a-transcribe');

type GroqVerboseResponse = {
  text?: string;
  language?: string;
  duration?: number;
  words?: Array<{word?: string; text?: string; start?: number; end?: number}>;
  segments?: Array<{text?: string; start?: number; end?: number}>;
};

export type TranscriptionResult = {
  words: WordToken[];
  transcript: string;
  detectedLanguage: string;
  audioDurationSec: number;
  estimatedCostUsd: number;
};

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * Cache-key schema. Post-integration fix: the key used to be audio hash + model + language only, so a change to what we ASK Groq for (response format, timestamp
 * granularities) or to how the audio is extracted could silently reuse an incompatible entry. Bump TRANSCRIPT_CACHE_SCHEMA, or change the signature, on any such change.
 */
export const TRANSCRIPT_CACHE_SCHEMA = 'v2';
/** The request this module sends (see transcribeAudio) and the extraction profile of media/ffmpeg.ts extractSpeechAudio. Part of every key. */
export const TRANSCRIPT_REQUEST_SIGNATURE = 'verbose_json;word+segment;opus-16k-mono-24k-voip-bitexact';

export function transcriptCacheId(
  fileHash: string,
  model: string,
  language: string,
  /** Extra key part for audio that is not the plain speech track (Groq pre-compaction). Omitted = the original key, unchanged. */
  variant?: string,
): string {
  const base = `${TRANSCRIPT_CACHE_SCHEMA}:${fileHash}:${model}:${language}:${TRANSCRIPT_REQUEST_SIGNATURE}`;
  return variant ? `${base}:${variant}` : base;
}

export function defaultTranscriptCacheDir(): string {
  return path.join(os.tmpdir(), 'kinmel-asr-cache');
}

function cacheFilePath(cacheDir: string, id: string): string {
  const safe = createHash('sha256').update(id).digest('hex');
  return path.join(cacheDir, `${safe}.json`);
}

/** What a cache file holds: the full key it was written under, so a file is only ever used for exactly that key. */
type TranscriptCacheEnvelope = {schema: string; id: string; result: TranscriptionResult};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A cached result is usable only with a transcript string and words that all carry finite, ordered times. */
function validResult(result: unknown): result is TranscriptionResult {
  const r = result as Partial<TranscriptionResult> | null;
  return Boolean(r) && typeof r!.transcript === 'string' && Array.isArray(r!.words) && r!.words.every(w => typeof w?.text === 'string' && finite(w.start) && finite(w.end) && w.end >= w.start);
}

/** The cached result for `id`, or null: a missing, unreadable, older-schema, other-key or malformed file is a miss (invalidation), never a partial reuse. */
export function readCachedTranscription(
  cacheDir: string,
  id: string,
): TranscriptionResult | null {
  const file = cacheFilePath(cacheDir, id);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<TranscriptCacheEnvelope>;
    if (!parsed || parsed.schema !== TRANSCRIPT_CACHE_SCHEMA || parsed.id !== id || !validResult(parsed.result)) {
      return null;
    }
    return parsed.result;
  } catch {
    return null;
  }
}

export function writeCachedTranscription(
  cacheDir: string,
  id: string,
  result: TranscriptionResult,
): void {
  mkdirSync(cacheDir, {recursive: true});
  const envelope: TranscriptCacheEnvelope = {schema: TRANSCRIPT_CACHE_SCHEMA, id, result};
  writeFileSync(cacheFilePath(cacheDir, id), JSON.stringify(envelope));
}

export function transcriptionConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
}

export async function transcribeAudio(input: {
  audioPath: string;
  audioBytes: number;
  languageCode: LanguageCode | 'auto';
  durationSec: number;
  cacheDir?: string;
  /** See transcriptCacheId. Set only by stages/transcribe/precompact.ts; the cached result is on the compacted clock. */
  cacheVariant?: string;
}): Promise<TranscriptionResult> {
  const cacheDir = input.cacheDir ?? defaultTranscriptCacheDir();
  const fileHash = await fileSha256(input.audioPath);
  const cacheId = transcriptCacheId(fileHash, env.GROQ_MODEL, String(input.languageCode), input.cacheVariant);
  const cached = readCachedTranscription(cacheDir, cacheId);
  observe(() => ({type: 'transcription_cache', hit: Boolean(cached), audioSha256: fileHash, model: env.GROQ_MODEL}));
  if (cached) {
    log.info({hash: fileHash.slice(0, 12), model: env.GROQ_MODEL}, 'transcription cache hit');
    return cached;
  }

  if (!transcriptionConfigured()) {
    throw new EngineError(
      'not_configured',
      'Speech-to-text is not configured (GROQ_API_KEY missing)',
    );
  }

  const maxBytes = env.GROQ_MAX_UPLOAD_MB * 1024 * 1024;
  if (input.audioBytes > maxBytes) {
    throw new EngineError(
      'source_too_large',
      `Extracted audio is ${(input.audioBytes / 1024 / 1024).toFixed(1)} MB, ` +
        `above the ${env.GROQ_MAX_UPLOAD_MB} MB transcription limit`,
    );
  }

  const form = new FormData();
  form.append('file', await openAsBlob(input.audioPath), 'speech.ogg');
  form.append('model', env.GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  // Forcing `en` on Hindi/Hinglish speech makes Whisper translate to English.
  // `auto` omits the language field so ASR stays in the spoken language.
  if (input.languageCode && input.languageCode !== 'auto') {
    form.append('language', input.languageCode);
  }
  form.append('temperature', '0');

  const started = Date.now();
  const body = await requestJson<GroqVerboseResponse>(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    label: 'Groq transcription',
    failureCode: 'transcribe_failed',
    timeoutMs: 180_000,
    // ASR is billed per call: one retry only, and only for transient failures.
    retries: 1,
    headers: {Authorization: `Bearer ${env.GROQ_API_KEY}`},
    body: form,
  });

  const words = normalizeWords(body.words);
  const fallbackWords =
    words.length > 0 ? words : synthesizeWordsFromSegments(body.segments);

  if (fallbackWords.length === 0) {
    throw new EngineError(
      'no_speech_detected',
      'No speech was detected in this video',
    );
  }

  const audioDurationSec = Number(body.duration) || input.durationSec;
  const estimatedCostUsd =
    (audioDurationSec / 3600) * GROQ_USD_PER_AUDIO_HOUR;

  log.info(
    {
      ms: Date.now() - started,
      words: fallbackWords.length,
      source: words.length > 0 ? 'words' : 'segments',
      language: body.language,
    },
    'transcription complete',
  );

  const result: TranscriptionResult = {
    words: fallbackWords,
    transcript: (body.text ?? '').trim() || joinWords(fallbackWords),
    detectedLanguage: (body.language ?? input.languageCode).toString(),
    audioDurationSec,
    estimatedCostUsd,
  };
  writeCachedTranscription(cacheDir, cacheId, result);
  return result;
}

/**
 * Keep punctuation attached to the token.
 *
 * Stage B's zoom filter detects sentence ends by looking for `.`/`!`/`?`, so
 * stripping punctuation here would silently disable camera punch-ins. Caption
 * rendering strips it at draw time instead.
 */
function normalizeWords(
  raw: GroqVerboseResponse['words'],
): WordToken[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: WordToken[] = [];
  for (const row of raw) {
    const text = String(row?.word ?? row?.text ?? '').trim();
    if (!text) {
      continue;
    }
    const start = Number(row?.start);
    let end = Number(row?.end);
    if (!Number.isFinite(start)) {
      continue;
    }
    if (!Number.isFinite(end) || end < start) {
      end = start;
    }
    // ASR occasionally emits zero-width words; give them a visible minimum.
    if (end - start < 0.08) {
      end = start + 0.12;
    }
    const previous = out.at(-1);
    out.push({
      text,
      start: previous ? Math.max(start, previous.start) : Math.max(0, start),
      end,
    });
  }
  return out;
}

/** Char-weighted split of segment text when a provider omits word timings. */
function synthesizeWordsFromSegments(
  segments: GroqVerboseResponse['segments'],
): WordToken[] {
  if (!Array.isArray(segments)) {
    return [];
  }
  const out: WordToken[] = [];
  for (const segment of segments) {
    const text = String(segment?.text ?? '').trim();
    const start = Number(segment?.start);
    let end = Number(segment?.end);
    if (!text || !Number.isFinite(start)) {
      continue;
    }
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!Number.isFinite(end) || end <= start) {
      end = start + Math.max(0.4, 0.12 * tokens.length);
    }
    const totalChars = tokens.reduce((n, t) => n + t.length, 0) || 1;
    const span = end - start;
    let cursor = start;
    tokens.forEach((token, index) => {
      const isLast = index === tokens.length - 1;
      const tokenEnd = isLast
        ? end
        : Math.min(
            end - 0.05 * (tokens.length - index - 1),
            cursor + Math.max(0.08, span * (token.length / totalChars)),
          );
      out.push({text: token, start: cursor, end: Math.max(cursor + 0.08, tokenEnd)});
      cursor = tokenEnd;
    });
  }
  return out;
}

function joinWords(words: WordToken[]): string {
  return words
    .map(w => w.text)
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}
