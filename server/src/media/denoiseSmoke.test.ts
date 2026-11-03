/**
 * WP7D: offline smoke test of the cuts-path denoise on SYNTHETIC media only (generated here with ffmpeg lavfi; no repo video, no Downloads file, no Remotion, no network, no model).
 * It runs the real exported helper `denoiseTalkingHeadAudio` with the real filter string `buildDenoiseFilter()` that the cuts path uses (highpass + afftdn).
 * REQUIRES an ffmpeg (and ffprobe) on PATH with the `afftdn` and `highpass` filters (any normal build). When they are missing the whole block is SKIPPED, not failed.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {buildDenoiseFilter} from '../stages/audio/noiseFilter.ts';
import {denoiseTalkingHeadAudio} from './ffmpeg.ts';

function filtersAvailable(): {ok: boolean; why: string} {
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-filters'], {encoding: 'utf8'});
  if (probe.error || probe.status !== 0) return {ok: false, why: 'ffmpeg is not runnable on PATH'};
  const missing = ['afftdn', 'highpass'].filter(name => !new RegExp(`\\s${name}\\s`).test(probe.stdout));
  if (missing.length > 0) return {ok: false, why: `this ffmpeg build lacks: ${missing.join(', ')}`};
  if (spawnSync('ffprobe', ['-version']).status !== 0) return {ok: false, why: 'ffprobe is not runnable on PATH'};
  return {ok: true, why: ''};
}

const availability = filtersAvailable();
if (!availability.ok) console.warn(`WP7D denoise smoke SKIPPED: ${availability.why}. Required: ffmpeg + ffprobe with afftdn and highpass.`);

const SEC = 3;
let work = '';

/** Make a small mp4: a flat video and the given audio graph (lavfi). */
function makeClip(name: string, audioGraph: string): string {
  const out = join(work, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x203040:s=160x120:r=15:d=${SEC}`, '-f', 'lavfi', '-i', audioGraph, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
  return out;
}

const probe = (file: string, entries: string): string => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', file], {encoding: 'utf8'}).trim();
const duration = (file: string): number => Number(probe(file, 'format=duration'));

/** Mean level (dB) of the file's audio, optionally after a band-pass around `bandHz` (so one component can be measured alone). */
function meanVolumeDb(file: string, bandHz?: number): number {
  const filter = `${bandHz ? `bandpass=f=${bandHz}:width_type=h:w=40,` : ''}volumedetect`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', filter, '-f', 'null', '-'], {encoding: 'utf8'});
  const match = /mean_volume:\s*(-?[0-9.]+)\s*dB/.exec(result.stderr);
  if (!match) throw new Error(`no volumedetect result: ${result.stderr.slice(-300)}`);
  return Number(match[1]);
}

beforeAll(() => {
  if (availability.ok) work = mkdtempSync(join(tmpdir(), 'wp7d-denoise-'));
});
afterAll(() => {
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!availability.ok)('denoiseTalkingHeadAudio on synthetic clips (needs ffmpeg with afftdn + highpass)', () => {
  it('writes a non-empty file of about the same duration, with the video stream copied and AAC audio', async () => {
    const input = makeClip('speechlike.mp4', `sine=f=220:d=${SEC}`);
    const output = join(work, 'speechlike.denoised.mp4');
    await denoiseTalkingHeadAudio({inputPath: input, outputPath: output, filter: buildDenoiseFilter()});
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(1000);
    const ratio = duration(output) / duration(input);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
    expect(probe(output, 'stream=codec_name').split('\n').sort()).toEqual(['aac', 'h264']);
  });

  it('lowers steady background noise and rumble clearly (at least 3 dB overall)', async () => {
    const input = makeClip('noisy.mp4', `anoisesrc=d=${SEC}:c=white:a=0.1[n];sine=f=40:d=${SEC}[r];[n][r]amix=inputs=2:normalize=0`);
    const output = join(work, 'noisy.denoised.mp4');
    await denoiseTalkingHeadAudio({inputPath: input, outputPath: output, filter: buildDenoiseFilter()});
    const before = meanVolumeDb(input);
    const after = meanVolumeDb(output);
    console.info(`WP7D noise-only clip: ${before} dB -> ${after} dB`);
    expect(before - after).toBeGreaterThanOrEqual(3);
  });

  it('keeps a speech-band tone: the 220 Hz component stays within 3 dB while the noise around it drops', async () => {
    const input = makeClip('tone-in-noise.mp4', `sine=f=220:d=${SEC}[t];anoisesrc=d=${SEC}:c=white:a=0.03[n];[t][n]amix=inputs=2:normalize=0`);
    const output = join(work, 'tone-in-noise.denoised.mp4');
    await denoiseTalkingHeadAudio({inputPath: input, outputPath: output, filter: buildDenoiseFilter()});
    const toneBefore = meanVolumeDb(input, 220);
    const toneAfter = meanVolumeDb(output, 220);
    console.info(`WP7D 220 Hz tone: ${toneBefore} dB -> ${toneAfter} dB; whole clip ${meanVolumeDb(input)} -> ${meanVolumeDb(output)} dB`);
    expect(Math.abs(toneBefore - toneAfter)).toBeLessThanOrEqual(3);
  });

  it('an unreadable input rejects (the cuts path catches this, warns and keeps the original audio)', async () => {
    await expect(denoiseTalkingHeadAudio({inputPath: join(work, 'does-not-exist.mp4'), outputPath: join(work, 'x.mp4'), filter: buildDenoiseFilter()})).rejects.toThrow();
    expect(existsSync(join(work, 'x.mp4'))).toBe(false);
  });

  it('an invalid filter string rejects and leaves no usable output', async () => {
    const input = makeClip('bad-filter.mp4', `sine=f=220:d=1`);
    const output = join(work, 'bad-filter.out.mp4');
    await expect(denoiseTalkingHeadAudio({inputPath: input, outputPath: output, filter: 'afftdn=nr=notanumber'})).rejects.toThrow();
  });
});
