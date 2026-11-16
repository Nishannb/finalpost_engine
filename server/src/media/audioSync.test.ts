/**
 * Audio synchronisation (post-integration fix), with real local ffmpeg on synthetic click tracks. No network.
 *   - the WP7A denoise step keeps every click at its source sample (the FFT denoiser's latency is measured and trimmed) and keeps the duration;
 *   - the Remotion latency correction drops exactly the measured leading samples.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {env} from '../config/env.ts';
import {buildDenoiseFilter} from '../stages/audio/noiseFilter.ts';
import {REMOTION_OUTPUT_AUDIO_LATENCY_SAMPLES_48K, correctRemotionAudioLatency, latencyTrimFilter, remotionLatencySamples} from '../stages/render/remotionAudioSync.ts';
import {denoiseTalkingHeadAudio, measureAudioFilterLatencySamples} from './ffmpeg.ts';

const SR = 48000;
let dir = '';

/** mono float PCM of a file's audio at 48 kHz */
const pcm = (file: string): Float32Array => {
  const buf = execFileSync(env.FFMPEG_PATH, ['-v', 'error', '-i', file, '-map', '0:a', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {maxBuffer: 1 << 26});
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
};
/** best lag (samples) of b against a around `at` (0.5 s window, search +-300 samples): cross-correlation, not peak picking (a click is smeared by the denoiser) */
const lagSamples = (a: Float32Array, b: Float32Array, at: number): number => {
  const n = SR / 2;
  let best = 0;
  let bestC = -Infinity;
  for (let lag = -300; lag <= 300; lag += 1) {
    let c = 0;
    for (let i = 0; i < n; i += 1) c += a[at + i]! * (b[at + i + lag] ?? 0);
    if (c > bestC) {
      bestC = c;
      best = lag;
    }
  }
  return best;
};
/** sample index of the loudest sample in each 1 s window */
const clicks = (a: Float32Array, n: number): number[] =>
  Array.from({length: n}, (_, k) => {
    let best = k * SR;
    for (let i = k * SR; i < Math.min(a.length, k * SR + SR / 2); i += 1) if (Math.abs(a[i]!) > Math.abs(a[best]!)) best = i;
    return best;
  });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-sync-test-'));
  // 4 s: a 2 ms click each second over quiet noise (the denoiser needs a noise floor to track), video so the -c:v copy path is exercised
  execFileSync(env.FFMPEG_PATH, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.002),0.9,0)+0.002*(random(0)-0.5)':s=${SR}:d=4`, '-f', 'lavfi', '-i', 'color=c=gray:s=160x284:r=24:d=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', path.join(dir, 'clicks.mp4')]);
});
afterAll(() => fs.rmSync(dir, {recursive: true, force: true}));

describe('denoise keeps the speech where it was', () => {
  it('the filter chain latency is measured (afftdn delays its output)', async () => {
    const latency = await measureAudioFilterLatencySamples(buildDenoiseFilter(), SR);
    expect(latency).toBeGreaterThan(0);
    expect(latency).toBeLessThan(SR * 0.2);
  });
  it('after denoise every click is within 1 ms of its source position, and the duration is kept', async () => {
    const src = path.join(dir, 'clicks.mp4');
    const out = path.join(dir, 'den.mp4');
    const {latencySamples} = await denoiseTalkingHeadAudio({inputPath: src, outputPath: out, filter: buildDenoiseFilter()});
    expect(latencySamples).toBeGreaterThan(0);
    const a = pcm(src);
    const b = pcm(out);
    for (const at of [Math.round(0.8 * SR), Math.round(1.8 * SR), Math.round(2.8 * SR)]) expect(Math.abs(lagSamples(a, b, at)), `window @${at}`).toBeLessThanOrEqual(SR / 1000);
    expect(Math.abs(b.length - a.length)).toBeLessThanOrEqual(SR / 100);
  });
});

describe('Remotion output latency correction', () => {
  it('scales the measured 2048-sample latency with the sample rate; the override wins; 0 disables', () => {
    expect(REMOTION_OUTPUT_AUDIO_LATENCY_SAMPLES_48K).toBe(2048);
    expect(remotionLatencySamples(48000, undefined)).toBe(2048);
    expect(remotionLatencySamples(44100, undefined)).toBe(1882);
    expect(remotionLatencySamples(48000, '1024')).toBe(1024);
    expect(remotionLatencySamples(48000, '0')).toBe(0);
    expect(latencyTrimFilter(2048)).toBe('atrim=start_sample=2048,asetpts=PTS-STARTPTS');
  });
  it('a file whose audio is 2048 samples late comes back aligned and 2048 samples shorter', async () => {
    const late = path.join(dir, 'late.mp4');
    execFileSync(env.FFMPEG_PATH, ['-v', 'error', '-y', '-i', path.join(dir, 'clicks.mp4'), '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-af', `adelay=${REMOTION_OUTPUT_AUDIO_LATENCY_SAMPLES_48K}S:all=1`, '-c:a', 'aac', '-b:a', '192k', late]);
    const src = pcm(path.join(dir, 'clicks.mp4'));
    const before = clicks(pcm(late), 3);
    const r = await correctRemotionAudioLatency(late);
    expect(r).toMatchObject({applied: true, samples: 2048, sampleRate: SR});
    const fixed = pcm(late);
    const after = clicks(fixed, 3);
    for (let k = 0; k < 3; k += 1) expect(Math.abs(before[k]! - 2048 - after[k]!), `click ${k}`).toBeLessThanOrEqual(2);
    for (const at of [Math.round(0.8 * SR), Math.round(1.8 * SR)]) expect(Math.abs(lagSamples(src, fixed, at)), `vs source @${at}`).toBeLessThanOrEqual(SR / 1000);
  });
});
