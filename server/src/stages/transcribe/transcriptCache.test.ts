/**
 * Transcription cache correctness (post-integration fix). Proves cache hits WITHOUT any provider call: `fetch` is a counting stub (and the suite's offline guard refuses a real
 * provider host anyway). Covers: the key separates audio / model / language / request schema; a hit needs no API key; one provider call for two transcriptions of the same
 * audio; a changed input or configuration is a miss; corrupt / old-format / wrong-key / malformed entries are misses (invalidation).
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {
  TRANSCRIPT_CACHE_SCHEMA,
  fileSha256,
  readCachedTranscription,
  transcribeAudio,
  transcriptCacheId,
  writeCachedTranscription,
  type TranscriptionResult,
} from './groqTranscribe.ts';

const e = env as unknown as {GROQ_API_KEY: string; GROQ_MODEL: string};
const saved = {key: e.GROQ_API_KEY, model: e.GROQ_MODEL};
let dir = '';
let audio = '';

const RESULT: TranscriptionResult = {
  words: [{text: 'Never', start: 0, end: 0.28}, {text: 'ever', start: 0.28, end: 0.7}],
  transcript: 'Never ever',
  detectedLanguage: 'English',
  audioDurationSec: 1,
  estimatedCostUsd: 0,
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-cache-test-'));
  audio = path.join(dir, 'speech.ogg');
  fs.writeFileSync(audio, Buffer.from('opus-bytes-of-one-video'));
  e.GROQ_MODEL = 'whisper-large-v3-turbo';
});
afterEach(() => {
  e.GROQ_API_KEY = saved.key;
  e.GROQ_MODEL = saved.model;
  vi.unstubAllGlobals();
  fs.rmSync(dir, {recursive: true, force: true});
});

const countingFetch = (body: unknown) => {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
  });
  vi.stubGlobal('fetch', fn);
  return calls;
};

describe('transcription cache key', () => {
  it('separates audio bytes, model, language and the request schema', async () => {
    const hash = await fileSha256(audio);
    const base = transcriptCacheId(hash, 'whisper-large-v3-turbo', 'auto');
    expect(base.startsWith(`${TRANSCRIPT_CACHE_SCHEMA}:${hash}:`)).toBe(true);
    expect(base).toContain('verbose_json;word+segment');
    expect(transcriptCacheId(hash, 'whisper-large-v3', 'auto')).not.toBe(base);
    expect(transcriptCacheId(hash, 'whisper-large-v3-turbo', 'en')).not.toBe(base);
    expect(transcriptCacheId(createHash('sha256').update('other').digest('hex'), 'whisper-large-v3-turbo', 'auto')).not.toBe(base);
  });
});

describe('transcribeAudio uses the cache before any provider request', () => {
  it('a cached transcription is returned with NO key and NO fetch', async () => {
    e.GROQ_API_KEY = '';
    const calls = countingFetch({});
    writeCachedTranscription(dir, transcriptCacheId(await fileSha256(audio), 'whisper-large-v3-turbo', 'auto'), RESULT);
    const out = await transcribeAudio({audioPath: audio, audioBytes: 23, languageCode: 'auto', durationSec: 1, cacheDir: dir});
    expect(out).toEqual(RESULT);
    expect(calls).toHaveLength(0);
  });

  it('two transcriptions of the same audio make exactly ONE provider request', async () => {
    e.GROQ_API_KEY = 'test-key-not-real';
    const calls = countingFetch({text: 'Never ever', language: 'english', duration: 1, words: [{word: 'Never', start: 0, end: 0.28}, {word: 'ever', start: 0.28, end: 0.7}]});
    const first = await transcribeAudio({audioPath: audio, audioBytes: 23, languageCode: 'auto', durationSec: 1, cacheDir: dir});
    const second = await transcribeAudio({audioPath: audio, audioBytes: 23, languageCode: 'auto', durationSec: 1, cacheDir: dir});
    expect(calls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first.words.map(w => w.text)).toEqual(['Never', 'ever']);
  });

  it('changed audio, model or language is a miss: without a key it fails before any fetch', async () => {
    e.GROQ_API_KEY = '';
    const calls = countingFetch({});
    writeCachedTranscription(dir, transcriptCacheId(await fileSha256(audio), 'whisper-large-v3-turbo', 'auto'), RESULT);
    await expect(transcribeAudio({audioPath: audio, audioBytes: 23, languageCode: 'en', durationSec: 1, cacheDir: dir})).rejects.toThrow(/not configured/);
    e.GROQ_MODEL = 'whisper-large-v3';
    await expect(transcribeAudio({audioPath: audio, audioBytes: 23, languageCode: 'auto', durationSec: 1, cacheDir: dir})).rejects.toThrow(/not configured/);
    e.GROQ_MODEL = 'whisper-large-v3-turbo';
    fs.writeFileSync(audio, Buffer.from('different-audio'));
    await expect(transcribeAudio({audioPath: audio, audioBytes: 15, languageCode: 'auto', durationSec: 1, cacheDir: dir})).rejects.toThrow(/not configured/);
    expect(calls).toHaveLength(0);
  });
});

describe('invalidation: unusable entries are misses, never partial reuse', () => {
  const fileFor = (id: string) => path.join(dir, `${createHash('sha256').update(id).digest('hex')}.json`);

  it('corrupt JSON, the pre-envelope format, an entry written for another key, and malformed word times', async () => {
    const id = transcriptCacheId(await fileSha256(audio), 'whisper-large-v3-turbo', 'auto');
    fs.writeFileSync(fileFor(id), '{not json');
    expect(readCachedTranscription(dir, id)).toBeNull();
    fs.writeFileSync(fileFor(id), JSON.stringify(RESULT)); // v1 files held the bare result
    expect(readCachedTranscription(dir, id)).toBeNull();
    fs.writeFileSync(fileFor(id), JSON.stringify({schema: TRANSCRIPT_CACHE_SCHEMA, id: `${id}-other`, result: RESULT}));
    expect(readCachedTranscription(dir, id)).toBeNull();
    fs.writeFileSync(fileFor(id), JSON.stringify({schema: TRANSCRIPT_CACHE_SCHEMA, id, result: {...RESULT, words: [{text: 'x', start: 1, end: 0.5}]}}));
    expect(readCachedTranscription(dir, id)).toBeNull();
    fs.writeFileSync(fileFor(id), JSON.stringify({schema: 'v1', id, result: RESULT}));
    expect(readCachedTranscription(dir, id)).toBeNull();
    writeCachedTranscription(dir, id, RESULT);
    expect(readCachedTranscription(dir, id)).toEqual(RESULT);
  });
});
