/**
 * WP4D pure tests: outline-style captions on full-frame footage get the dark band a split already has. remotion/src/lib/captionSplit.ts is pure (a type import only); ShortVideo.tsx (Remotion)
 * is read as text. No render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {BOX_PAINTING_TEMPLATES, captionBackingPlate, captionsForBrollSplit, PLATE_HEIGHT_FRAC} from '../../../remotion/src/lib/captionSplit.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const H = 1920;
const layout = {position: 'bottom' as const, bottomFrac: 0.18, frameTopFrac: 0, frameHeightFrac: 1};
const plate = (over: Partial<Parameters<typeof captionBackingPlate>[0]> = {}) =>
  captionBackingPlate({template: 'kinetic-01', packageTheme: false, boxColor: null, splitPlateShowing: false, layout, canvasHeight: H, ...over});

describe('an outline template gets a band in the lower half', () => {
  it('ends just below the caption bottom edge, is PLATE_HEIGHT_FRAC tall, and stays in the lower half', () => {
    const band = plate()!;
    const bottom = H * (1 - 0.18);
    expect(band.top + band.height).toBeCloseTo(bottom + H * 0.03, 6);
    expect(band.height).toBeCloseTo(H * PLATE_HEIGHT_FRAC + H * 0.03, 6);
    expect(band.top).toBeGreaterThanOrEqual(H / 2);
    expect(band.top + band.height).toBeLessThanOrEqual(H);
  });
  it('is the same geometry the top-speaker split plate uses at the same bottom edge', () => {
    const split = captionsForBrollSplit(layout, 'top', H).plate;
    const band = plate()!;
    expect(band.top).toBeCloseTo(split.top, 6);
    expect(band.height).toBeCloseTo(split.height, 6);
  });
  it('follows bottomFrac and never rises above the middle of the frame, nor leaves the canvas', () => {
    for (const bottomFrac of [0.06, 0.14, 0.18, 0.34, 0.45]) {
      const band = plate({layout: {...layout, bottomFrac}})!;
      expect(band.top).toBeGreaterThanOrEqual(H / 2);
      expect(band.top + band.height).toBeLessThanOrEqual(H);
      expect(band.height).toBeGreaterThan(0);
    }
    const low = plate({layout: {...layout, bottomFrac: 0.06}})!;
    const high = plate({layout: {...layout, bottomFrac: 0.34}})!;
    expect(low.top).toBeGreaterThan(high.top);
  });
  it('works for lower_third and for other outline/utility templates, and when no template is named', () => {
    expect(plate({layout: {...layout, position: 'lower_third'}})).not.toBeNull();
    for (const template of ['pop', 'karaoke', 'hustle', 'beast', 'hormozi', 'mrbeast', 'classic', 'bounce', 'minimal', 'clean', 'subtitle', 'kinetic-slam', undefined, null]) expect(plate({template}), String(template)).not.toBeNull();
  });
});

describe('templates that already paint a box get no band', () => {
  it('box, grape and basic', () => {
    expect([...BOX_PAINTING_TEMPLATES].sort()).toEqual(['basic', 'box', 'grape']);
    for (const template of ['box', 'grape', 'basic']) expect(plate({template}), template).toBeNull();
  });
  it('a package theme (the caller says so), including grape-theme', () => {
    for (const template of ['pop-theme', 'grape-theme', 'karaoke-theme', 'kinetic-01-theme']) expect(plate({template, packageTheme: true}), template).toBeNull();
  });
  it('a blueprint that gives a box colour (the template paints a per-line box)', () => {
    expect(plate({boxColor: 'rgba(0,0,0,0.72)'})).toBeNull();
    expect(plate({boxColor: ''})).not.toBeNull();
  });
});

describe('no second band, no band where the captions are not', () => {
  it('a split that already has a plate gets no second one', () => {
    expect(plate({splitPlateShowing: true})).toBeNull();
    const split = captionsForBrollSplit(layout, 'bottom', H);
    expect(plate({splitPlateShowing: Boolean(split), layout: split.layout})).toBeNull();
  });
  it('a generated split is left to its own docking', () => {
    expect(plate({generatedSplitShowing: true})).toBeNull();
  });
  it('a docked caption frame (inset reveal / generated split frame) gets none', () => {
    expect(plate({layout: {...layout, frameTopFrac: 0.2, frameHeightFrac: 0.8}})).toBeNull();
    expect(plate({layout: {...layout, frameHeightFrac: 0.5}})).toBeNull();
  });
  it('captions at the top or centre get none', () => {
    expect(plate({layout: {...layout, position: 'top'}})).toBeNull();
    expect(plate({layout: {...layout, position: 'center'}})).toBeNull();
  });
  it('bad numbers get none and do not throw', () => {
    for (const bottomFrac of [NaN, -0.1, 0.5, 0.9]) expect(plate({layout: {...layout, bottomFrac}})).toBeNull();
    expect(plate({canvasHeight: 0})).toBeNull();
    expect(plate({canvasHeight: NaN})).toBeNull();
  });
});

describe('ShortVideo uses it (source text)', () => {
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  const lib = stripComments(read('remotion/src/lib/captionSplit.ts'));
  it('the decision comes from captionBackingPlate, only for blueprints with legibility.captions and words', () => {
    expect(video).toContain("import {captionBackingPlate, captionBackingPlateEnabled, captionPlateLineActive, captionPlateLines, captionSplitAt, captionsForBrollSplit, openingHidesCaptions} from './lib/captionSplit';"); // WP4F: the plate follows the caption line
    expect(video.match(/captionBackingPlate\(/g)).toHaveLength(1);
    expect(video).toContain('legibleCaptions && captionBackingPlateEnabled(legibleCaptions) && blueprint.captionWords.length > 0 && captionPlateLineActive(plateLines, timeSec)\n      ? captionBackingPlate({'); // WP4F: only while a caption line is on screen; WP8G: and only with the explicit opt-in
    expect(video).toContain('packageTheme: isPackageCaptionThemeId(captionTemplateId),');
    expect(video).toContain('boxColor: blueprint.captionDirection?.boxColor,');
    expect(video).toContain('splitPlateShowing: Boolean(splitCaptions),');
    expect(video).toContain('generatedSplitShowing: Boolean(generatedSplit),');
    expect(video).toContain('layout: captionLayout,');
  });
  it('the band is drawn once, with the split plate colour, and the split plate wins when both exist', () => {
    expect(video).toContain('(splitCaptions?.plate ?? backingPlate)');
    expect(video.match(/backgroundColor: legibleCaptions\.splitBoxColor,/g)).toHaveLength(1);
  });
  it('the words get the existing split text and highlight colours, and keep their own position, size and timing', () => {
    expect(video).toContain('backingPlate && legibleCaptions\n                  ? legibleCaptions.splitTextColor');
    expect(video).toContain('(splitCaptions || backingPlate) && legibleCaptions ? legibleCaptions.splitHighlightColor');
    expect(video).toContain('transcriptData={blueprint.captionWords}');
    expect(video).not.toMatch(/captionWords\s*=|transcriptData=\{[^}]*backingPlate/);
    expect(video).toContain('captionBottomFrac: captionLayout.bottomFrac,'); // the caption layout is not changed by the band
  });
  it('a blueprint without legibility.captions never reaches the band', () => {
    const at = video.indexOf('const backingPlate =');
    expect(video.slice(at, at + 120)).toContain('legibleCaptions &&');
    expect(video).toContain('const legibleCaptions = blueprint.legibility?.captions;');
  });
  it('the helper is pure and the split plate geometry is untouched', () => {
    // WP4F: types plus the pure timeline helpers (groupCaptionLines, activeLineAt)
    expect([...lib.matchAll(/^import .*$/gm)].map(match => match[0])).toEqual([
      "import type {CaptionWord} from '../blueprintSchema';",
      "import type {CaptionBand} from '../generated/placement';",
      "import {activeLineAt, groupCaptionLines, type CaptionLine} from './timeline';",
    ]);
    expect(lib).toContain('export const PLATE_HEIGHT_FRAC = 0.22;');
    expect(lib).toContain('const end = Math.min(canvasHeight, bottom + canvasHeight * 0.03);');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
