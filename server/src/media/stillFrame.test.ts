/**
 * 2026-11-26 production root cause: every creator photo failed "Could not extract a still frame". `-ss 0.00` before `-i` on a single-image
 * .jpg makes ffmpeg drop its only frame (exit 0, no file). Real ffmpeg, real files.
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {env} from '../config/env.ts';
import {extractStillJpeg} from './ffmpeg.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'still-'));
const make = (name: string, extra: string[] = []) => {
  const out = path.join(dir, name);
  execFileSync(env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1200x900', '-frames:v', '1', ...extra, out]);
  return out;
};

describe('extractStillJpeg on creator photos', () => {
  it('a .jpg photo yields a still (frame 0, no seek)', async () => {
    const out = path.join(dir, 'a.jpg');
    await extractStillJpeg(make('photo.jpg'), out, 0);
    expect(statSync(out).size).toBeGreaterThan(1000);
  });

  it('png and an extensionless still work too', async () => {
    for (const [name, extra] of [['p.png', []], ['noext', ['-f', 'mjpeg']]] as const) {
      const out = path.join(dir, `${name}.out.jpg`);
      await extractStillJpeg(make(name, [...extra]), out, 0);
      expect(statSync(out).size).toBeGreaterThan(1000);
    }
  });

  it('a video still at a time > 0 still seeks', async () => {
    const video = path.join(dir, 'v.mp4');
    execFileSync(env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=3', '-pix_fmt', 'yuv420p', video]);
    const out = path.join(dir, 'v.jpg');
    await extractStillJpeg(video, out, 1.5);
    expect(statSync(out).size).toBeGreaterThan(500);
  });
});
