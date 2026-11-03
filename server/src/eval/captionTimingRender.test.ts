/**
 * Phase 27 (opt-in: RENDER_TESTS=1): caption onset latency on ENCODED video. Flat dark source, six consecutive one-word captions with NO gap between
 * them (the shape of the real edit), the pipeline's captions-only look (karaoke template, `highlight` animation: the active word sits in a gold-bordered
 * pill). The frame where each pill first appears is compared with the word's start time. Before the fix every pill appeared 4 frames late.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

const RENDER = process.env.RENDER_TESTS === '1';
const REMOTION = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'remotion');
const W = 540;
const H = 960;
let work = '';

beforeAll(() => {
  if (!RENDER) return;
  work = mkdtempSync(join(tmpdir(), 'captiontiming-'));
  mkdirSync(join(work, 'public'));
});
afterAll(() => {
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!RENDER)('caption onset latency on encoded video (opt-in: RENDER_TESTS=1)', () => {
  it('every active-word pill appears within one frame of its word start, with no gap between words', async () => {
    const source = join(work, 'public', 'dark.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x1A2438:s=${W}x${H}:r=30:d=4`, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', '-c:a', 'aac', '-shortest', source]);
    const starts = [0.5, 0.9, 1.3, 1.8, 2.2, 2.7];
    const captionWords = starts.map((start, i) => ({text: ['Quiet', 'moments', 'speak', 'the', 'loudest', 'of'][i]!, start, end: (starts[i + 1] ?? 3.1), sentenceIndex: 0}));
    const blueprint = {
      blueprintId: 'timing', videoUrl: 'staticFile:dark.mp4', languageCode: 'en', fps: 30, width: W, height: H, sourceDurationSec: 4, outputDurationSec: 4, captionWords,
      keepSegments: [{sourceStart: 0, sourceEnd: 4, outputStart: 0}], zoomTriggers: [], brollClips: [],
      captionDirection: {position: 'bottom', bottomFrac: 0.16, textColor: '#FFFFFF', highlightColor: '#F5B942', boxColor: null, template: 'karaoke', animation: 'highlight', fontScale: 1},
    };
    const style = {captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.22, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''};
    const props = join(work, 'timing.props.json');
    const out = join(work, 'timing.out.mp4');
    writeFileSync(props, JSON.stringify({blueprint, style}));
    const run = spawnSync('npx', ['remotion', 'render', 'src/index.ts', 'ShortVideo', out, `--props=${props}`, '--log=error', '--timeout=120000', '--concurrency=1', `--public-dir=${join(work, 'public')}`], {cwd: REMOTION, encoding: 'utf8'});
    expect(run.status, run.stderr).toBe(0);
    const y0 = Math.floor(H * 0.6);
    const bandH = Math.floor(H * 0.3);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `crop=${W}:${bandH}:0:${y0}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 28});
    const frames = Math.floor(raw.length / (W * bandH * 3));
    // per frame: gold pixel count and the horizontal extent of the gold region (the pill is as wide as its word)
    const gold: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    for (let f = 0; f < frames; f += 1) {
      await new Promise<void>(resolveTick => setImmediate(resolveTick));
      let count = 0;
      let minX = W;
      let maxX = -1;
      const base = f * W * bandH * 3;
      for (let p = 0; p < W * bandH; p += 1) {
        const r = raw[base + p * 3]!;
        const g = raw[base + p * 3 + 1]!;
        const b = raw[base + p * 3 + 2]!;
        if (Math.abs(r - 245) < 28 && Math.abs(g - 185) < 28 && Math.abs(b - 66) < 28) {
          count += 1;
          const x = p % W;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      gold.push(count);
      left.push(minX);
      right.push(maxX);
    }
    // a word change is a pill appearing from nothing, or (with no gap between words) a step in the pill's edges that the spring pop never makes in one frame
    const onsets: number[] = [];
    for (let f = 1; f < frames; f += 1) {
      if (gold[f]! < 100) continue;
      const appeared = gold[f - 1]! < 40;
      const stepped = gold[f - 1]! >= 100 && (Math.abs(left[f]! - left[f - 1]!) > 25 || Math.abs(right[f]! - right[f - 1]!) > 25);
      if (appeared || stepped) onsets.push(f / 30);
    }
    expect(onsets.length).toBeGreaterThanOrEqual(starts.length - 1);
    for (const onset of onsets) {
      const nearest = starts.reduce((best, s) => (Math.abs(s - onset) < Math.abs(best - onset) ? s : best), starts[0]!);
      expect(onset - nearest, `pill at ${onset.toFixed(3)} s for the word starting ${nearest}`).toBeGreaterThanOrEqual(-1 / 30 - 1e-6);
      expect(onset - nearest, `pill at ${onset.toFixed(3)} s for the word starting ${nearest}`).toBeLessThanOrEqual(1 / 30 + 1e-6);
    }
  }, 300_000);
});
