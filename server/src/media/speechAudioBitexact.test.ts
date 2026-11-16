/**
 * The transcription cache is keyed by the sha256 of the extracted speech audio, so the same source must give the same bytes on every run
 * (ffmpeg's Ogg muxer otherwise picks a random serial number and the cache never hits: every edit of the same video re-paid Groq).
 * Local ffmpeg only (synthetic lavfi source), no network.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {env} from '../config/env.ts';
import {extractSpeechAudio} from './ffmpeg.ts';

let dir = '';
let source = '';

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-bitexact-'));
  source = path.join(dir, 'src.mp4');
  execFileSync(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=3', '-shortest', '-c:a', 'aac', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
});
afterAll(async () => {
  await fs.rm(dir, {recursive: true, force: true});
});

const sha = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');

describe('extractSpeechAudio is deterministic (transcription cache key)', () => {
  it('the same source gives byte-identical audio on every run', async () => {
    const a = await extractSpeechAudio(source, path.join(dir, 'a.ogg'));
    const b = await extractSpeechAudio(source, path.join(dir, 'b.ogg'));
    expect(a.bytes).toBeGreaterThan(0);
    expect(await sha(a.path)).toBe(await sha(b.path));
  });
});
