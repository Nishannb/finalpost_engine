/**
 * WP3U pure tests: the split caption placement (dark plate + position) is held 6 frames before a B-roll split starts and 6 after it ends, on the mvp legibility path only.
 * remotion/src/lib/captionSplit.ts is pure (a type import only); ShortVideo.tsx (Remotion), analyzeVideo.ts (logger) and the types are read as text. No render, FFmpeg, Chromium,
 * network or model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {captionSplitAt, captionSplitHoldWindow, CAPTION_SPLIT_HOLD_FRAMES} from '../../../remotion/src/lib/captionSplit.ts';
import {captionSplitHold, captionSplitSpec} from '../stages/broll/legibility.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const FPS = 30;
const DURATION = 300; // 10 s
const hold = {holdFrames: 6, fps: FPS, durationFrames: DURATION};
const split = (start: number, end: number, speakerSide: 'top' | 'bottom' = 'top') => ({start, end, speakerSide});

describe('the hold window', () => {
  it('is the split plus 6 frames each side', () => {
    expect(captionSplitHoldWindow({start: 2, end: 4}, 6, FPS, DURATION)).toEqual({fromFrame: 54, toFrame: 126});
    expect(CAPTION_SPLIT_HOLD_FRAMES).toBe(6);
  });
  it('a split at time 0 has no hold before it (clamped to frame 0)', () => {
    expect(captionSplitHoldWindow({start: 0, end: 2}, 6, FPS, DURATION)).toEqual({fromFrame: 0, toFrame: 66});
  });
  it('a split that ends on the last frame has no hold after it (clamped to the duration)', () => {
    expect(captionSplitHoldWindow({start: 8, end: 10}, 6, FPS, DURATION)).toEqual({fromFrame: 234, toFrame: 300});
  });
  it('zero hold gives exactly the split frames', () => {
    expect(captionSplitHoldWindow({start: 2, end: 4}, 0, FPS, DURATION)).toEqual({fromFrame: 60, toFrame: 120});
  });
});

describe('which split owns the caption placement at a frame', () => {
  const splits = [split(2, 4, 'top')];
  it('holds from 6 frames before the start to 6 frames after the end, and not one frame further', () => {
    expect(captionSplitAt(splits, 53, hold)).toBeUndefined();
    expect(captionSplitAt(splits, 54, hold)).toBe(splits[0]);
    expect(captionSplitAt(splits, 59, hold)).toBe(splits[0]);
    expect(captionSplitAt(splits, 60, hold)).toBe(splits[0]); // the split itself
    expect(captionSplitAt(splits, 119, hold)).toBe(splits[0]);
    expect(captionSplitAt(splits, 120, hold)).toBe(splits[0]); // first frame after the split: held
    expect(captionSplitAt(splits, 125, hold)).toBe(splits[0]);
    expect(captionSplitAt(splits, 126, hold)).toBeUndefined();
  });
  it('the split frames themselves are unchanged: the renderer rule start <= t < end', () => {
    const noHold = {holdFrames: 0, fps: FPS, durationFrames: DURATION};
    expect(captionSplitAt(splits, 59, noHold)).toBeUndefined();
    expect(captionSplitAt(splits, 60, noHold)).toBe(splits[0]);
    expect(captionSplitAt(splits, 119, noHold)).toBe(splits[0]);
    expect(captionSplitAt(splits, 120, noHold)).toBeUndefined();
  });
  it('a split at time 0 is active from frame 0 and holds to frame 65', () => {
    const first = [split(0, 2)];
    expect(captionSplitAt(first, 0, hold)).toBe(first[0]);
    expect(captionSplitAt(first, 65, hold)).toBe(first[0]);
    expect(captionSplitAt(first, 66, hold)).toBeUndefined();
  });
  it('a split that ends on the last frame holds through the last frame and the frame count is not exceeded', () => {
    const last = [split(8, 10)];
    expect(captionSplitAt(last, 233, hold)).toBeUndefined();
    expect(captionSplitAt(last, 234, hold)).toBe(last[0]);
    expect(captionSplitAt(last, 299, hold)).toBe(last[0]);
    expect(captionSplitAt(last, 300, hold)).toBeUndefined();
  });
  it('two close held splits pick the nearer one', () => {
    const two = [split(2, 4, 'top'), split(4.2, 6, 'top')];
    expect(captionSplitAt(two, 121, hold)).toBe(two[0]); // 1 frame after the first, 5 before the second
    expect(captionSplitAt(two, 124, hold)).toBe(two[1]); // 2 frames before the second
    expect(captionSplitAt(two, 126, hold)).toBe(two[1]); // the second split itself
  });
  it('no usable fps, no hold, or no duration: the instant switch, never a guess', () => {
    for (const bad of [undefined, 0, -30, NaN, Infinity]) {
      expect(captionSplitAt(splits, 56, {holdFrames: 6, fps: bad as never, durationFrames: DURATION})).toBeUndefined();
      expect(captionSplitAt(splits, 60, {holdFrames: 6, fps: bad as never, durationFrames: DURATION})).toBeUndefined();
    }
    expect(captionSplitAt(splits, 56, {fps: FPS, durationFrames: DURATION})).toBeUndefined();
    expect(captionSplitAt(splits, 56, {holdFrames: 0, fps: FPS, durationFrames: DURATION})).toBeUndefined();
    expect(captionSplitAt(splits, 56, {holdFrames: 6, fps: FPS})).toBeUndefined();
    expect(captionSplitAt(splits, 56, {holdFrames: 6, fps: FPS, durationFrames: 0})).toBeUndefined();
    expect(captionSplitAt([], 56, hold)).toBeUndefined();
  });
  it('does not mutate its inputs', () => {
    const frozen = Object.freeze([Object.freeze(split(2, 4))]);
    expect(() => captionSplitAt(frozen, 56, hold)).not.toThrow();
  });
});

describe('the writer', () => {
  it('writes 6 frames only for a usable blueprint fps, otherwise records caption_hold_skipped', () => {
    expect(captionSplitHold(30)).toEqual({frames: 6});
    expect(captionSplitHold(60)).toEqual({frames: 6});
    for (const bad of [undefined, null, 0, -1, NaN, Infinity, '30']) expect(captionSplitHold(bad)).toEqual({skipped: 'caption_hold_skipped'});
  });
  it('the split caption colours themselves are unchanged by the hold (no field is added by captionSplitSpec)', () => {
    expect(captionSplitSpec({highlightColor: '#FFD400'})).not.toHaveProperty('splitHoldFrames');
  });
});

describe('wiring (source text)', () => {
  const analyze = stripComments(read('server/src/pipeline/analyzeVideo.ts'));
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  const schema = read('remotion/src/blueprintSchema.ts');
  const types = read('server/src/types/blueprint.ts');
  it('the writer sets splitHoldFrames only inside the mvp legibility branch, from the blueprint fps constant, with the skip warning', () => {
    expect(analyze.match(/captionSplitHold\(/g)).toHaveLength(1);
    const at = analyze.indexOf('captionSplitHold(OUTPUT_FPS)');
    expect(at).toBeGreaterThan(analyze.indexOf('captionSplitSpec(broll.caption)'));
    expect(analyze.slice(analyze.lastIndexOf('if (legibility) {', at), at)).toContain('captionSplitSpec(broll.caption)');
    expect(analyze).toContain('warnings.push(`legibility:${hold.skipped}`)');
    expect(analyze.slice(at - 600, at + 500)).not.toMatch(/\.start\s*=|\.end\s*=|captionWords/);
  });
  it('the renderer holds only when legibility.captions exists, uses the blueprint fps, and leaves the split and the words alone', () => {
    expect(video).toContain('captionSplitAt(');
    expect(video).toContain('legibleCaptions && !split && !generatedSplit && style.brollEnabled');
    expect(video).toContain('holdFrames: legibleCaptions.splitHoldFrames, fps: blueprint.fps, durationFrames: durationInFrames');
    expect(video).toContain('const captionSplit = split ?? holdSplit;');
    expect(video).toContain('legibleCaptions && captionSplit ? captionsForBrollSplit(');
    // the split itself is still found by the unchanged exact-frame rule and every other use of `split` is untouched
    expect(video).toContain("activeOverlayLayoutAt(overlays, 'split', timeSec)");
    expect(video).not.toMatch(/transcriptData=\{[^}]*(holdSplit|captionSplit)/);
  });
  it('both blueprint types carry the optional field', () => {
    expect(schema).toContain('splitHoldFrames: z.number().int().min(0).optional()');
    expect(types).toContain('splitHoldFrames?: number;');
  });
  it('legacy and caption-only blueprints have no legibility, so the old instant switch is untouched', () => {
    expect(analyze).toContain("input.editProfile === 'mvp' && !captionsOnly");
    expect(analyze.match(/legibility = \{/g)!.length).toBeGreaterThan(0);
    expect(analyze).toContain('...(legibility ? {legibility} : {})');
  });
  it('the pure module imports only types and the pure timeline helpers', () => {
    const lib = stripComments(read('remotion/src/lib/captionSplit.ts'));
    // WP4F added the caption-line helpers (groupCaptionLines, activeLineAt) and a CaptionWord type
    expect([...lib.matchAll(/^import .*$/gm)].map(match => match[0])).toEqual([
      "import type {CaptionWord} from '../blueprintSchema';",
      "import type {CaptionBand} from '../generated/placement';",
      "import {activeLineAt, groupCaptionLines, type CaptionLine} from './timeline';",
    ]);
  });
});
