/**
 * WP4V source-text tests: the three hard-coded fontWeight 900 values in DynamicCaptionRenderer.tsx are now 800, the heaviest weight the caption fonts load. The renderer imports Remotion, so it is
 * read as text; the request table and metadata come from the pure fontRequests module and node_modules. No render, no Chromium, no network. The four unsafe suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {CAPTION_FONT_REQUESTS, CAPTION_FONT_WEIGHTS} from '../../../remotion/src/styles/fontRequests.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const renderer = stripComments(read('remotion/src/captions/DynamicCaptionRenderer.tsx'));
const section = (name: string, next: string) => renderer.slice(renderer.indexOf(`function ${name}(`), renderer.indexOf(`function ${next}(`));

describe('DynamicCaptionRenderer.tsx weights', () => {
  it('has no fontWeight: 900 left', () => {
    expect(renderer).not.toMatch(/fontWeight:\s*900/);
    expect(renderer).not.toMatch(/\b900\b/);
  });
  it('the three templates that used 900 now set 800: the slam word, the kinetic-01 main word and the aarit word', () => {
    expect(section('SlamWord', 'MovingPillCaptions')).toContain('fontWeight: 800,');
    expect(section('Kinetic01Captions', 'AaritCaptions')).toContain('fontWeight: 800,');
    expect(section('AaritWord', 'SoftAiCaptions')).toContain('fontWeight: 800,');
    for (const [name, next] of [['SlamWord', 'MovingPillCaptions'], ['Kinetic01Captions', 'AaritCaptions'], ['AaritWord', 'SoftAiCaptions']] as const) {
      expect(section(name, next).match(/fontWeight:\s*800,/g), name).toHaveLength(1);
    }
  });
  it('the literal fontWeight: 800 count is four: those three, plus the one the simple-one-word centered word already had', () => {
    expect(renderer.match(/fontWeight:\s*800,/g)).toHaveLength(4);
    expect(section('CenteredWord', 'Kinetic01Captions').match(/fontWeight:\s*800,/g)).toHaveLength(1);
  });
  it('every other weight in the file is unchanged: the 700s, 500, 400 and fontWeightFor', () => {
    expect(renderer.match(/fontWeight:\s*700,/g)).toHaveLength(2);
    expect(renderer).toContain('fontWeight: active ? 700 : 500,');
    expect(renderer).toContain('fontWeight: active ? 800 : 400,');
    expect(renderer).toContain("fontWeight: fontWeightFor(language, 'sans'),");
  });
  it('800 is the heaviest weight the caption fonts can be asked for', () => {
    expect(Math.max(...CAPTION_FONT_WEIGHTS.map(Number))).toBe(800);
    for (const key of Object.keys(CAPTION_FONT_REQUESTS) as Array<keyof typeof CAPTION_FONT_REQUESTS>) {
      for (const weight of CAPTION_FONT_REQUESTS[key].weights) expect(Number(weight)).toBeLessThanOrEqual(800);
    }
    expect(CAPTION_FONT_REQUESTS.inter.weights).toContain('800');
  });
});

describe('what is not touched', () => {
  it('KineticCaptions, HookTitle, the package-theme branch and the font request table are unchanged', () => {
    expect(renderer).toContain("import {CaptionTheme} from 'remotion-captions-themes';");
    expect(renderer).toContain('fontSize={customizationOptions?.fontSize ?? PACKAGE_THEME_DEFAULT_FONT_SIZE}');
    expect(read('remotion/src/styles/fontRequests.ts')).toContain("inter: {weights: ['400', '700', '800'], subsets: ['latin']},");
    const fonts = stripComments(read('remotion/src/styles/fonts.ts'));
    expect(fonts).toContain('return 800;');
    expect(fonts).toContain("return kind === 'impact' ? 400 : 800;");
    expect(fonts).toContain('return (load as LoadWith)(CAPTION_FONT_STYLE');
  });
  it('the widths and the rail flag from WP4I / WP4J are as they were', () => {
    expect([...renderer.matchAll(/captionMaxWidthFrac\(0\.86, railClear\)/g)]).toHaveLength(4);
    expect([...renderer.matchAll(/captionMaxWidthFrac\(0\.88, railClear\)/g)]).toHaveLength(1);
    expect([...renderer.matchAll(/captionMaxWidthPercent\(0\.88, railClear\)/g)]).toHaveLength(2);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
