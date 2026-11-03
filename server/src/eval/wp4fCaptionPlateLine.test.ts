/**
 * WP4F pure tests: the caption backing plate follows the caption LINE (groupCaptionLines with maxWords 5, then activeLineAt with its default hold), not each word. remotion/src/lib/captionSplit.ts
 * and remotion/src/lib/timeline.ts are pure (type imports only); ShortVideo.tsx (Remotion) is read as text. No render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {captionBackingPlate, captionBackingPlateEnabled, captionPlateLineActive, captionPlateLines} from '../../../remotion/src/lib/captionSplit.ts';
import {activeLineAt, groupCaptionLines} from '../../../remotion/src/lib/timeline.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const word = (text: string, start: number, end: number, sentenceIndex = 0) => ({text, start, end, sentenceIndex}) as never;
const up = (words: ReturnType<typeof word>[], time: number) => captionPlateLineActive(captionPlateLines(words), time);

// "one two" then a pause, then "three": the default hold of activeLineAt is read from the function itself, never typed in the plate code.
const HOLD = (() => {
  const probe = [{words: [], start: 0, end: 10}];
  let low = 0;
  for (let step = 0.001; step < 2; step += 0.001) if (activeLineAt(probe as never, 10 + step) !== null) low = step;
  return low;
})();

describe('the hold is the renderer\'s default (read from activeLineAt)', () => {
  it('is about 0.12 s today; the tests below use it relative to the function, not as a copied number in the plate code', () => {
    expect(HOLD).toBeGreaterThan(0.1);
    expect(HOLD).toBeLessThan(0.14);
  });
});

describe('the plate follows the line', () => {
  const line = [word('one', 1.0, 1.3), word('two', 1.6, 1.9)]; // a 0.3 s gap inside one line
  it('a gap inside one line keeps the plate up', () => {
    expect(captionPlateLines(line)).toHaveLength(1);
    for (const time of [1.0, 1.15, 1.31, 1.45, 1.59, 1.6, 1.9]) expect(up(line, time), String(time)).toBe(true);
  });
  it('the plate stays up through the hold after the line\'s last word, and is down after it', () => {
    expect(up(line, 1.9 + HOLD - 0.005)).toBe(true);
    expect(up(line, 1.9 + HOLD + 0.01)).toBe(false);
  });
  it('is down before the first word', () => {
    expect(up(line, 0)).toBe(false);
    expect(up(line, 0.99)).toBe(false);
  });
  it('a pause long enough to start a new line drops the plate once the hold has passed, and it comes back with the next line', () => {
    const words = [...line, word('three', 3.0, 3.3)]; // 1.1 s pause > the 0.55 s break
    expect(captionPlateLines(words)).toHaveLength(2);
    expect(up(words, 1.9 + HOLD - 0.005)).toBe(true);
    expect(up(words, 2.0 + HOLD)).toBe(false);
    expect(up(words, 2.5)).toBe(false);
    expect(up(words, 2.99)).toBe(false);
    expect(up(words, 3.0)).toBe(true);
    expect(up(words, 3.3)).toBe(true);
  });
  it('a sentence change starts a new line, so a long enough gap after it drops the plate too', () => {
    const words = [word('a', 1.0, 1.2, 0), word('b', 1.3, 1.5, 1)];
    expect(captionPlateLines(words)).toHaveLength(2);
    expect(up(words, 1.25)).toBe(true); // the first line's hold covers the gap to the next line
  });
  it('an empty list keeps the plate down', () => {
    expect(captionPlateLines([])).toEqual([]);
    for (const time of [0, 1, 100]) expect(up([], time)).toBe(false);
  });
});

describe('through the two renderer functions, exactly', () => {
  const words = [word('a', 0.5, 0.8), word('b', 0.9, 1.2), word('c', 1.3, 1.6), word('d', 1.7, 2.0), word('e', 2.1, 2.4), word('f', 2.5, 2.8), word('g', 5.0, 5.3)];
  it('captionPlateLines is groupCaptionLines with maxWords 5 and the other defaults', () => {
    expect(captionPlateLines(words)).toEqual(groupCaptionLines(words, {maxWords: 5}));
    expect(captionPlateLines(words)[0]!.words).toHaveLength(5); // not the default 3, not 4
  });
  it('captionPlateLineActive is activeLineAt !== null at every probed time', () => {
    const lines = groupCaptionLines(words, {maxWords: 5});
    for (let time = 0; time <= 6; time += 0.01) expect(captionPlateLineActive(lines, time), time.toFixed(2)).toBe(activeLineAt(lines, time) !== null);
  });
});

describe('the band itself is unchanged', () => {
  const H = 1920;
  const layout = {position: 'bottom' as const, bottomFrac: 0.18, frameTopFrac: 0, frameHeightFrac: 1};
  it('geometry and template rules are those of WP4D', () => {
    const band = captionBackingPlate({template: 'kinetic-01', packageTheme: false, boxColor: null, splitPlateShowing: false, layout, canvasHeight: H})!;
    expect(band.top + band.height).toBeCloseTo(H * 0.82 + H * 0.03, 6);
    expect(band.height).toBeCloseTo(H * 0.22 + H * 0.03, 6);
    for (const template of ['box', 'grape', 'basic']) expect(captionBackingPlate({template, packageTheme: false, splitPlateShowing: false, layout, canvasHeight: H})).toBeNull();
    expect(captionBackingPlate({template: 'kinetic-01', packageTheme: false, splitPlateShowing: true, layout, canvasHeight: H})).toBeNull();
  });
});

describe('wiring (source text)', () => {
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  const lib = stripComments(read('remotion/src/lib/captionSplit.ts'));
  it('the plate code holds no copy of the hold, the gap or the span numbers', () => {
    const plate = lib.slice(lib.indexOf('export function captionPlateLines'));
    expect(plate).toContain('groupCaptionLines(words, {maxWords: 5})');
    expect(plate).toContain('activeLineAt(lines as CaptionLine[], timeSec) !== null');
    expect(plate).not.toMatch(/0\.12|0\.55|2\.4|holdSec|maxGapSec|maxSpanSec/);
  });
  it('ShortVideo computes the lines once per blueprint, only for blueprints with legibility.captions, and tests them with the current time', () => {
    expect(video).toContain("import {captionBackingPlate, captionBackingPlateEnabled, captionPlateLineActive, captionPlateLines, captionSplitAt, captionsForBrollSplit, openingHidesCaptions} from './lib/captionSplit';");
    expect(video).toContain('React.useMemo(\n    () => (blueprint.legibility?.captions ? captionPlateLines(blueprint.captionWords) : []),\n    [blueprint.legibility?.captions, blueprint.captionWords],');
    expect(video.match(/captionPlateLineActive\(/g)).toHaveLength(1);
    expect(video).toContain('legibleCaptions && captionBackingPlateEnabled(legibleCaptions) && blueprint.captionWords.length > 0 && captionPlateLineActive(plateLines, timeSec)\n      ? captionBackingPlate({'); // WP8G: opt-in only
    expect(video).not.toContain('captionWordActiveAt');
  });
  it('the split plate and its hold, the band arguments, the colours and the words are as before', () => {
    expect(video).toContain('(splitCaptions?.plate ?? backingPlate)');
    expect(video).toContain('splitPlateShowing: Boolean(splitCaptions),');
    expect(video).toContain('generatedSplitShowing: Boolean(generatedSplit),');
    expect(video).toContain('legibleCaptions && !split && !generatedSplit && style.brollEnabled');
    expect(video).toContain('backingPlate && legibleCaptions\n                  ? legibleCaptions.splitTextColor');
    expect(video).toContain('transcriptData={blueprint.captionWords}');
    expect(video).not.toMatch(/captionWords\s*=|transcriptData=\{[^}]*(plateLines|backingPlate)/);
  });
  it('the module imports only types and the pure timeline helpers', () => {
    expect([...read('remotion/src/lib/captionSplit.ts').matchAll(/^import .*$/gm)].map(match => match[0])).toEqual([
      "import type {CaptionWord} from '../blueprintSchema';",
      "import type {CaptionBand} from '../generated/placement';",
      "import {activeLineAt, groupCaptionLines, type CaptionLine} from './timeline';",
    ]);
    expect([...read('remotion/src/lib/timeline.ts').matchAll(/^import .*$/gm)].map(match => match[0])).toEqual(["import type {CaptionWord, KeepSegment, ZoomTrigger} from '../blueprintSchema';"]);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
