/**
 * Phase 25 (opt-in: RENDER_TESTS=1): the final-frame / seam defects, proven on ENCODED video. Builds a tiny frame-indexed source with ffmpeg
 * (every frame mid-gray, 12 squares at the top encode the frame index in binary), renders blueprints with the real Remotion composition
 * (`remotion render ShortVideo`, the same command shape `renderLocally` spawns), decodes EVERY output frame and checks which source frame
 * each one shows. A black frame is unambiguous because no source frame is ever black. No network, no model.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

const RENDER = process.env.RENDER_TESTS === '1';
const REMOTION = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'remotion');
const W = 270;
const H = 480;
let work = '';

const makeSource = (name: string, frames: number, audioSec: number) => {
  const file = join(work, 'public', name);
  const lum = "if(lt(Y,40)*gt(Y,4)*lt(X,264),255*mod(floor(N/pow(2,11-floor(X/22))),2),90)";
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `nullsrc=s=${W}x${H}:r=30,geq=lum='${lum}':cb=128:cr=128`, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${audioSec}`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-g', '1', '-c:a', 'aac', '-frames:v', String(frames), file]);
  return file;
};

type Decoded = {frames: number; black: number[]; index: Array<number | null>};
const render = async (name: string, source: string, outputDurationSec: number, segments: Array<[number, number, number]>): Promise<Decoded> => {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(work, 'public', source)]).toString());
  const blueprint = {
    blueprintId: name, videoUrl: `staticFile:${source}`, languageCode: 'en', fps: 30, width: W, height: H, sourceDurationSec: Math.round(Number(probe.format.duration) * 1000) / 1000,
    outputDurationSec, captionWords: [], keepSegments: segments.map(([sourceStart, sourceEnd, outputStart]) => ({sourceStart, sourceEnd, outputStart})), zoomTriggers: [], brollClips: [],
  };
  const style = {captionTemplate: 'clean', layoutStyle: 'fullscreen', captionBottomFrac: 0.22, captionCenterXFrac: 0.5, brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: ''};
  const props = join(work, `${name}.props.json`);
  const out = join(work, `${name}.mp4`);
  writeFileSync(props, JSON.stringify({blueprint, style}));
  const run = spawnSync('npx', ['remotion', 'render', 'src/index.ts', 'ShortVideo', out, `--props=${props}`, '--log=error', '--timeout=120000', '--concurrency=1', `--public-dir=${join(work, 'public')}`], {cwd: REMOTION, encoding: 'utf8'});
  expect(run.status, run.stderr).toBe(0);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: 1 << 28});
  const frames = Math.floor(raw.length / (W * H));
  const index: Array<number | null> = [];
  const black: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    await new Promise<void>(resolveTick => setImmediate(resolveTick)); // keep the vitest worker responsive during the decode loop
    const frame = raw.subarray(i * W * H, (i + 1) * W * H);
    let sum = 0;
    for (let p = 0; p < frame.length; p += 7) sum += frame[p]!;
    if (sum / Math.ceil(frame.length / 7) < 12) {
      black.push(i);
      index.push(null);
      continue;
    }
    let value = 0;
    for (let b = 0; b < 12; b += 1) value = value * 2 + (frame[22 * W + b * 22 + 12]! > 128 ? 1 : 0);
    index.push(value);
  }
  copyFileSync(out, join(work, `${name}.keep.mp4`));
  return {frames, black, index};
};

beforeAll(() => {
  if (!RENDER) return;
  work = mkdtempSync(join(tmpdir(), 'finalframe-'));
  mkdirSync(join(work, 'public'));
});
afterAll(() => {
  if (work) rmSync(work, {recursive: true, force: true});
});

describe.skipIf(!RENDER)('final frame and seams on encoded video (opt-in: RENDER_TESTS=1)', () => {
  it('C1: a trimmed final segment ends on its last intended source frame (index 102), not on a black frame', async () => {
    makeSource('s120.mp4', 120, 4.008);
    const result = await render('c1', 's120.mp4', 2.397, [[0.4, 1.9, 0], [2.5167, 3.4133, 1.5]]);
    expect(result.black).toEqual([]);
    expect(result.frames).toBe(72);
    expect(result.index.at(-1)).toBe(102);
    expect(result.index.at(-2)).toBe(101);
  }, 240_000);

  it('C6: the same when the source has exactly the frames needed (tight source, 103 frames)', async () => {
    makeSource('s103.mp4', 103, 3.442);
    const result = await render('c6', 's103.mp4', 2.397, [[0.4, 1.9, 0], [2.5167, 3.4133, 1.5]]);
    expect(result.black).toEqual([]);
    expect(result.index.at(-1)).toBe(102);
  }, 240_000);

  it('C2: a single full-length segment whose container is a few ms longer than the video has no frame without content', async () => {
    makeSource('s120b.mp4', 120, 4.008);
    const result = await render('c2', 's120b.mp4', 4.008, [[0, 4.008, 0]]);
    expect(result.black).toEqual([]);
    expect(result.frames).toBe(120);
    expect(result.index.at(-1)).toBe(119);
    expect(result.index.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
  }, 240_000);

  it('C3: a frame-aligned multi-segment composition is exactly what it was (source indices contiguous inside each segment)', async () => {
    makeSource('s120c.mp4', 120, 4.008);
    const result = await render('c3', 's120c.mp4', 3.0, [[0, 2.0, 0], [2.5, 3.5, 2.0]]);
    expect(result.black).toEqual([]);
    expect(result.frames).toBe(90);
    expect(result.index[59]).toBe(59);
    expect(result.index[60]).toBe(75);
    expect(result.index.at(-1)).toBe(104);
  }, 240_000);

  it('C4a: a rounding gap at a seam shows the segment\'s own next source frame instead of a black frame', async () => {
    makeSource('s120d.mp4', 120, 4.008);
    const result = await render('c4a', 's120d.mp4', 1.43, [[0, 0.3467, 0], [1.0, 1.1833, 0.3467], [2.0, 2.9, 0.53]]);
    expect(result.black).toEqual([]);
    expect(result.index.slice(8, 18)).toEqual([8, 9, 30, 31, 32, 33, 34, 35, 60, 61]);
  }, 240_000);

  it('C5: a 5-frame composition has 5 frames', async () => {
    makeSource('s60.mp4', 60, 2.008);
    const result = await render('c5', 's60.mp4', 0.173, [[0.2, 0.3733, 0]]);
    expect(result.black).toEqual([]);
    expect(result.frames).toBe(5);
    expect(result.index).toEqual([6, 7, 8, 9, 10]);
  }, 240_000);
});
