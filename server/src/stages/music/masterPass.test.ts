import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';

import {masterPassEnabled} from './flags.ts';
import {buildPass2Filter, masterPass, parseLoudnormJson} from './masterPass.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('masterPassEnabled', () => {
  it('is on by default and off only for 0', () => {
    expect(masterPassEnabled({})).toBe(true);
    expect(masterPassEnabled({MUSIC_MASTER_PASS: ''})).toBe(true);
    expect(masterPassEnabled({MUSIC_MASTER_PASS: '1'})).toBe(true);
    expect(masterPassEnabled({MUSIC_MASTER_PASS: '0'})).toBe(false);
  });
});

describe('loudnorm json', () => {
  it('parses the trailing block and builds pass 2', () => {
    const stderr = 'noise\n[Parsed_loudnorm_0 @ 0x1]\n{\n"input_i" : "-30.10",\n"input_tp" : "-12.00",\n"input_lra" : "0.50",\n"input_thresh" : "-40.60",\n"target_offset" : "0.1"\n}\n';
    const m = parseLoudnormJson(stderr);
    expect(m).toEqual({inputI: -30.1, inputTp: -12, inputLra: 0.5, inputThresh: -40.6});
    expect(buildPass2Filter(m)).toBe('loudnorm=I=-14:TP=-1:LRA=11:measured_I=-30.1:measured_TP=-12:measured_LRA=0.5:measured_thresh=-40.6:linear=true');
  });
  it('throws without json', () => {
    expect(() => parseLoudnormJson('nothing')).toThrow();
  });
});

describe.skipIf(!hasFfmpeg)('masterPass (ffmpeg)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-pass-'));
  afterAll(() => fs.rmSync(dir, {recursive: true, force: true}));

  it('normalizes loudness and keeps the video stream', async () => {
    const file = path.join(dir, 'in.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=48000', '-af', 'volume=-24dB', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    const result = await masterPass(file);
    expect(result.beforeLufs).not.toBeNull();
    expect(Math.abs((result.afterLufs as number) + 14)).toBeLessThanOrEqual(1);
    expect(result.afterTruePeak as number).toBeLessThanOrEqual(-0.5);
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', file]).toString();
    expect(probe).toContain('h264');
    expect(probe).toContain('video');
    expect(probe).toContain('aac');
    expect(fs.readdirSync(dir)).toEqual(['in.mp4']);
  }, 60000);

  it('leaves the original in place when the pass fails', async () => {
    const file = path.join(dir, 'bad.mp4');
    fs.writeFileSync(file, 'not media');
    await expect(masterPass(file)).rejects.toThrow(Error);
    expect(fs.readFileSync(file, 'utf8')).toBe('not media');
  }, 30000);
});
