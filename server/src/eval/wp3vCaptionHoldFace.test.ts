/**
 * WP3V pure tests: the 6-frame caption hold applies only when the split captions stay in the bottom safe band (creator on TOP, media on the bottom). With the creator on the bottom the split
 * caption frame is the top half, so the hold would draw the plate over a still-full-frame face: those splits keep the instant switch on the split's own frames. captionSplit.ts is pure;
 * ShortVideo.tsx (Remotion) is read as text. No render, FFmpeg, Chromium, network or model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {captionSplitAt, captionsForBrollSplit} from '../../../remotion/src/lib/captionSplit.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const FPS = 30;
const DURATION = 300;
const hold = {holdFrames: 6, fps: FPS, durationFrames: DURATION};
const layout = {position: 'bottom' as const, bottomFrac: 0.2, frameTopFrac: 0, frameHeightFrac: 1};

describe('the geometry that decides it', () => {
  it('creator on top: captions stay in the bottom half (frame untouched, plate below the seam)', () => {
    const result = captionsForBrollSplit(layout, 'top', 1920);
    expect(result.layout.frameTopFrac).toBe(0);
    expect(result.layout.frameHeightFrac).toBe(1);
    expect(result.plate.top).toBeGreaterThanOrEqual(1920 * 0.5);
  });
  it('creator on the bottom: the caption frame is the top half and the plate is above the seam, over where the full-frame face would be', () => {
    const result = captionsForBrollSplit(layout, 'bottom', 1920);
    expect(result.layout.frameHeightFrac).toBe(0.5);
    expect(result.plate.top + result.plate.height).toBeLessThanOrEqual(1920 * 0.5);
  });
});

describe('who gets the hold', () => {
  it('speaker on top: held 6 frames before and after', () => {
    const top = [{start: 2, end: 4, speakerSide: 'top'}];
    expect(captionSplitAt(top, 53, hold)).toBeUndefined();
    expect(captionSplitAt(top, 54, hold)).toBe(top[0]);
    expect(captionSplitAt(top, 125, hold)).toBe(top[0]);
    expect(captionSplitAt(top, 126, hold)).toBeUndefined();
  });
  it('speaker on the bottom: no hold on either side, but the split frames keep the instant rule', () => {
    const bottom = [{start: 2, end: 4, speakerSide: 'bottom'}];
    for (const frame of [54, 59, 120, 125]) expect(captionSplitAt(bottom, frame, hold)).toBeUndefined();
    expect(captionSplitAt(bottom, 60, hold)).toBe(bottom[0]);
    expect(captionSplitAt(bottom, 119, hold)).toBe(bottom[0]);
    expect(captionSplitAt(bottom, 120, hold)).toBeUndefined();
  });
  it('an unset or unknown side is read as bottom (the renderer\'s own rule), so it gets no hold', () => {
    for (const side of [undefined, '', 'left', 'TOP'] as never[]) {
      const one = [{start: 2, end: 4, speakerSide: side}];
      expect(captionSplitAt(one, 57, hold)).toBeUndefined();
      expect(captionSplitAt(one, 122, hold)).toBeUndefined();
      expect(captionSplitAt(one, 60, hold)).toBe(one[0]);
    }
    expect(captionSplitAt([{start: 2, end: 4}], 57, hold)).toBeUndefined();
  });
  it('a split at time 0 with the speaker on top still clamps: active from frame 0, held to frame 65', () => {
    const first = [{start: 0, end: 2, speakerSide: 'top'}];
    expect(captionSplitAt(first, 0, hold)).toBe(first[0]);
    expect(captionSplitAt(first, 65, hold)).toBe(first[0]);
    expect(captionSplitAt(first, 66, hold)).toBeUndefined();
  });
  it('a split at time 0 with the speaker on the bottom: instant on its own frames, nothing else', () => {
    const first = [{start: 0, end: 2, speakerSide: 'bottom'}];
    expect(captionSplitAt(first, 0, hold)).toBe(first[0]);
    expect(captionSplitAt(first, 59, hold)).toBe(first[0]);
    expect(captionSplitAt(first, 60, hold)).toBeUndefined();
  });
  it('a top split ending on the last frame is held to the end; a bottom one is not', () => {
    const top = [{start: 8, end: 10, speakerSide: 'top'}];
    const bottom = [{start: 8, end: 10, speakerSide: 'bottom'}];
    expect(captionSplitAt(top, 234, hold)).toBe(top[0]);
    expect(captionSplitAt(top, 300, hold)).toBeUndefined();
    expect(captionSplitAt(bottom, 234, hold)).toBeUndefined();
    expect(captionSplitAt(bottom, 240, hold)).toBe(bottom[0]);
  });
  it('a bottom-speaker split next to a top-speaker split never lends its side to the held frames', () => {
    const mixed = [{start: 2, end: 4, speakerSide: 'bottom'}, {start: 4.5, end: 6, speakerSide: 'top'}];
    expect(captionSplitAt(mixed, 123, hold)).toBeUndefined(); // 3 frames after the bottom split, 12 before the top one: no hold
    expect(captionSplitAt(mixed, 130, hold)).toBe(mixed[1]); // 5 frames before the top split: held
  });
});

describe('wiring (source text)', () => {
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  const lib = stripComments(read('remotion/src/lib/captionSplit.ts'));
  it('the filter is in the pure function, before the window test, and compares to the string top', () => {
    const at = lib.indexOf("if (split.speakerSide !== 'top') continue;");
    expect(at).toBeGreaterThan(lib.indexOf('for (const split of splits)'));
    expect(at).toBeLessThan(lib.indexOf('captionSplitHoldWindow(split, holdFrames, fps, durationFrames)', at));
  });
  it('the renderer still reads a missing side as bottom, so a split without a side is never held', () => {
    expect(video).toContain("split.speakerSide === 'top' ? 'top' : 'bottom'");
  });
  it('the renderer still holds only on the mvp path and does not move the split or the words', () => {
    expect(video).toContain('legibleCaptions && !split && !generatedSplit && style.brollEnabled');
    expect(video).toContain("activeOverlayLayoutAt(overlays, 'split', timeSec)");
    expect(video).toContain('legibleCaptions && captionSplit ? captionsForBrollSplit(');
    expect(video).not.toMatch(/transcriptData=\{[^}]*(holdSplit|captionSplit)/);
  });
});
