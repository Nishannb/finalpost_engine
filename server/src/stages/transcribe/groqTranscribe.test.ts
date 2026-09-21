import {mkdirSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  fileSha256,
  readCachedTranscription,
  transcriptCacheId,
  writeCachedTranscription,
  type TranscriptionResult,
} from './groqTranscribe.ts';

describe('transcript cache by file hash', () => {
  it('hashes file bytes, not path', async () => {
    const dir = path.join(os.tmpdir(), `asr-hash-${Date.now()}`);
    mkdirSync(dir, {recursive: true});
    const a = path.join(dir, 'a.ogg');
    const b = path.join(dir, 'b.ogg');
    writeFileSync(a, Buffer.from('same-bytes'));
    writeFileSync(b, Buffer.from('same-bytes'));
    const other = path.join(dir, 'c.ogg');
    writeFileSync(other, Buffer.from('other-bytes'));
    expect(await fileSha256(a)).toBe(await fileSha256(b));
    expect(await fileSha256(a)).not.toBe(await fileSha256(other));
  });

  it('returns the cached transcription for the same hash+model+language', async () => {
    const dir = path.join(os.tmpdir(), `asr-cache-${Date.now()}`);
    mkdirSync(dir, {recursive: true});
    const audio = path.join(dir, 'speech.ogg');
    writeFileSync(audio, Buffer.from('clip-bytes'));
    const hash = await fileSha256(audio);
    const id = transcriptCacheId(hash, 'whisper-large-v3-turbo', 'auto');
    const stored: TranscriptionResult = {
      words: [{text: 'hello', start: 0, end: 0.4}],
      transcript: 'hello',
      detectedLanguage: 'en',
      audioDurationSec: 1,
      estimatedCostUsd: 0,
    };
    writeCachedTranscription(dir, id, stored);
    expect(readCachedTranscription(dir, id)).toEqual(stored);
    expect(
      readCachedTranscription(dir, transcriptCacheId(hash, 'whisper-large-v3-turbo', 'hi')),
    ).toBeNull();
  });
});
