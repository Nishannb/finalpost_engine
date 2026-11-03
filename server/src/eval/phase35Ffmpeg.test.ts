/**
 * Isolated regression test for the one default-path change in Phase 35: `extractSpeakerCutout` must hand ffmpeg a lowercase `0x` colour prefix.
 * Real ffmpeg on a 1 s synthetic clip (plain green backdrop). With the old code (`0X2FBF71`) ffmpeg 9.0.1 rejects the colour and this fails.
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, describe, expect, it} from 'vitest';

import {env} from '../config/env.ts';
import {extractSpeakerCutout} from '../media/ffmpeg.ts';

const work = mkdtempSync(join(tmpdir(), 'p35-ffmpeg-'));
afterAll(() => rmSync(work, {recursive: true, force: true}));

describe('extractSpeakerCutout chromakey colour', () => {
  it('produces a non-empty alpha WebM for a #RRGGBB key colour (ffmpeg needs a lowercase 0x prefix)', async () => {
    const clip = join(work, 'in.mp4');
    execFileSync(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2FBF71:s=160x288:d=1:r=10,drawbox=x=40:y=100:w=80:h=150:color=0xC98A6B:t=fill', '-pix_fmt', 'yuv420p', clip]);
    const out = await extractSpeakerCutout({inputPath: clip, outputPath: join(work, 'out.webm'), keyColor: '#2FBF71', similarity: 0.16, blend: 0.06});
    expect(statSync(out).size).toBeGreaterThan(100);
    const pixFmt = execFileSync(env.FFMPEG_PATH.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out]).toString().trim();
    expect(pixFmt).toContain('vp9');
  }, 30_000);
});
