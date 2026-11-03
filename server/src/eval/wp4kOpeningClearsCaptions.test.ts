/**
 * WP4K pure tests: while the art-directed opening treatment is on screen the caption layer and the plate are not drawn. remotion/src/lib/captionSplit.ts is pure; ShortVideo.tsx (Remotion)
 * is read as text. No render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {openingHidesCaptions} from '../../../remotion/src/lib/captionSplit.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const opening = {startSec: 1, durationSec: 3};

describe('openingHidesCaptions', () => {
  it('hides them during the opening: startSec <= time < startSec + durationSec', () => {
    for (const time of [1, 1.01, 2.5, 3.999]) expect(openingHidesCaptions(opening, time), String(time)).toBe(true);
  });
  it('shows them just after it ends (the end instant is already outside) and before it starts', () => {
    expect(openingHidesCaptions(opening, 4)).toBe(false);
    expect(openingHidesCaptions(opening, 4.01)).toBe(false);
    expect(openingHidesCaptions(opening, 0.999)).toBe(false);
    expect(openingHidesCaptions(opening, 0)).toBe(false);
    expect(openingHidesCaptions(opening, 30)).toBe(false);
  });
  it('no opening shows them', () => {
    for (const time of [0, 1, 2.5, 100]) {
      expect(openingHidesCaptions(undefined, time)).toBe(false);
      expect(openingHidesCaptions(null, time)).toBe(false);
    }
  });
  it('an opening at time 0 (startSec missing or 0) hides from the first frame', () => {
    expect(openingHidesCaptions({durationSec: 2}, 0)).toBe(true);
    expect(openingHidesCaptions({startSec: 0, durationSec: 2}, 1.99)).toBe(true);
    expect(openingHidesCaptions({startSec: 0, durationSec: 2}, 2)).toBe(false);
  });
  it('inputs are not mutated and the result is deterministic', () => {
    const frozen = Object.freeze({startSec: 1, durationSec: 3});
    expect(openingHidesCaptions(frozen, 2)).toBe(true);
    expect(openingHidesCaptions(frozen, 2)).toBe(true);
  });
});

describe('ShortVideo uses it for both the captions and the plate (source text)', () => {
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  it('one call, from the blueprint\'s openingTreatment and the current time', () => {
    expect(video.match(/openingHidesCaptions\(/g)).toHaveLength(1);
    expect(video).toContain('const openingShowing = openingHidesCaptions(blueprint.openingTreatment, timeSec);');
    expect(video).toContain('const timeSec = frame / fps;');
  });
  it('the plate div is gated by it', () => {
    expect(video).toContain('{!openingShowing && legibleCaptions && blueprint.captionWords.length > 0 && (splitCaptions?.plate ?? backingPlate) ? (');
  });
  it('the caption layer is gated by it and is otherwise rendered exactly as before', () => {
    const at = video.indexOf('{!openingShowing ? (');
    expect(at).toBeGreaterThan(video.indexOf('(splitCaptions?.plate ?? backingPlate)!.height'));
    const layer = video.slice(at, video.indexOf(') : null}', video.indexOf('<DynamicCaptionRenderer', at)) + ') : null}'.length);
    expect(layer).toContain('<DynamicCaptionRenderer');
    expect(layer).toContain('railClear={Boolean(legibleCaptions)}');
    expect(layer).toContain('transcriptData={blueprint.captionWords}');
    expect(layer).toContain('captionBottomFrac: captionLayout.bottomFrac,');
    expect(video.match(/<DynamicCaptionRenderer/g)).toHaveLength(1);
  });
  it('the opening, the hook and the caption words are untouched', () => {
    expect(video).toContain('from={secToFrame(blueprint.openingTreatment.startSec, fps)}');
    expect(video).toContain('durationInFrames={Math.max(1, Math.round(blueprint.openingTreatment.durationSec * fps))}>');
    expect(video).toContain("title={blueprint.openingTreatment ? '' : blueprint.hookTitle}");
    expect(video).not.toMatch(/captionWords\s*=/);
  });
  it('the helper is pure and the plate, rail and hold logic are untouched', () => {
    const lib = stripComments(read('remotion/src/lib/captionSplit.ts'));
    expect([...lib.matchAll(/^import .*$/gm)]).toHaveLength(3);
    expect(video).toContain('captionPlateLineActive(plateLines, timeSec)');
    expect(video).toContain('railClear={Boolean(legibleCaptions)}');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
