/**
 * WP4E pure tests (the per-word plate rule was replaced by the caption-line rule in WP4F; what remains here is the unchanged band and the supersession check). remotion/src/lib/captionSplit.ts is pure (a type import only); ShortVideo.tsx and
 * DynamicCaptionRenderer.tsx (Remotion) are read as text. No render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {captionBackingPlate} from '../../../remotion/src/lib/captionSplit.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('the band itself is unchanged', () => {
  const H = 1920;
  const layout = {position: 'bottom' as const, bottomFrac: 0.18, frameTopFrac: 0, frameHeightFrac: 1};
  it('geometry and the template rules are those of WP4D', () => {
    const band = captionBackingPlate({template: 'kinetic-01', packageTheme: false, boxColor: null, splitPlateShowing: false, layout, canvasHeight: H})!;
    expect(band.top + band.height).toBeCloseTo(H * 0.82 + H * 0.03, 6);
    expect(band.height).toBeCloseTo(H * 0.22 + H * 0.03, 6);
    for (const template of ['box', 'grape', 'basic']) expect(captionBackingPlate({template, packageTheme: false, splitPlateShowing: false, layout, canvasHeight: H})).toBeNull();
    expect(captionBackingPlate({template: 'pop-theme', packageTheme: true, splitPlateShowing: false, layout, canvasHeight: H})).toBeNull();
    expect(captionBackingPlate({template: 'kinetic-01', packageTheme: false, splitPlateShowing: true, layout, canvasHeight: H})).toBeNull();
  });
});

describe('superseded by WP4F (source text)', () => {
  it('the per-word helper is gone: the plate now follows the caption line, so it no longer blinks between words', () => {
    expect(stripComments(read('remotion/src/lib/captionSplit.ts'))).not.toContain('captionWordActiveAt');
    expect(stripComments(read('remotion/src/ShortVideo.tsx'))).not.toContain('captionWordActiveAt');
    expect(stripComments(read('remotion/src/ShortVideo.tsx'))).toContain('captionPlateLineActive(plateLines, timeSec)');
  });
  it('the inclusive word rule of the renderer is still the renderer\'s own', () => {
    expect(stripComments(read('remotion/src/captions/DynamicCaptionRenderer.tsx'))).toContain('timeSec >= word.start && timeSec <= word.end');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
