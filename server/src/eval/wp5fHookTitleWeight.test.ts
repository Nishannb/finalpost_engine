/**
 * WP5F source-text tests: the one hard-coded fontWeight 600 in HookTitle.tsx is now 700. HookTitle imports Remotion, so it is read as text. No render, no Chromium, no network. The four unsafe
 * suites are not run.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {CAPTION_FONT_REQUESTS, CAPTION_FONT_WEIGHTS} from '../../../remotion/src/styles/fontRequests.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative: string) => readFileSync(resolve(ROOT, relative), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const hook = stripComments(read('remotion/src/components/HookTitle.tsx'));
const minimal = hook.slice(hook.indexOf('function MinimalTitle('), hook.indexOf('\nfunction ', hook.indexOf('function MinimalTitle(') + 10));

describe('HookTitle.tsx weights', () => {
  it('has no fontWeight: 600 left', () => {
    expect(hook).not.toMatch(/fontWeight:\s*600/);
  });
  it('the former site (the minimal title) is now fontWeight: 700, and it is the only weight literal that changed', () => {
    expect(minimal).toMatch(/fontWeight:\s*700,/);
    expect(minimal.match(/fontWeight:/g)).toHaveLength(1);
    // the whole file: five 700s that were already there plus this one, three 400s, one 800, three fontWeightFor calls
    expect(hook.match(/fontWeight:\s*700,/g)).toHaveLength(6);
    expect(hook.match(/fontWeight:\s*400,/g)).toHaveLength(3);
    expect(hook.match(/fontWeight:\s*800,/g)).toHaveLength(1);
    expect(hook.match(/fontWeight:\s*fontWeightFor\(/g)).toHaveLength(3);
  });
  it('every literal weight left in the file is one the caption fonts load (400, 700, 800)', () => {
    const weights = [...hook.matchAll(/fontWeight:\s*(\d+),/g)].map(match => match[1] as string);
    expect(weights.length).toBe(10);
    for (const weight of weights) expect(CAPTION_FONT_WEIGHTS as readonly string[], weight).toContain(weight);
  });
  it('700 is a weight every request row that ships it loads: it is in the table for each family except Anton and Bebas Neue (400 only)', () => {
    for (const key of Object.keys(CAPTION_FONT_REQUESTS) as Array<keyof typeof CAPTION_FONT_REQUESTS>) {
      const weights = CAPTION_FONT_REQUESTS[key].weights as readonly string[];
      if (key === 'anton' || key === 'bebas') expect(weights).toEqual(['400']);
      else expect(weights, key).toContain('700');
    }
  });
});

describe('what is not touched', () => {
  it('fontFamilyFor, fontWeightFor, hookDisplayFamily, the request table and DynamicCaptionRenderer are unchanged', () => {
    const fonts = stripComments(read('remotion/src/styles/fonts.ts'));
    expect(fonts).toContain('return 800;');
    expect(fonts).toContain("return kind === 'impact' ? 400 : 800;");
    expect(fonts).toContain('export function hookDisplayFamily(');
    expect(fonts).toContain("return familyOf(playfair);");
    expect(read('remotion/src/styles/fontRequests.ts')).toContain("inter: {weights: ['400', '700', '800'], subsets: ['latin']},");
    const renderer = stripComments(read('remotion/src/captions/DynamicCaptionRenderer.tsx'));
    expect(renderer).not.toMatch(/fontWeight:\s*900/);
    expect(renderer.match(/fontWeight:\s*800,/g)).toHaveLength(4);
  });
  it('the hook\'s other behaviour is untouched: the font family and size lines of the minimal title are as they were', () => {
    expect(minimal).toContain('fontFamily,\n          fontWeight: 700,\n          fontSize: titleSize,');
  });
  it('the defaults are unchanged', () => {
    const env = read('server/src/config/env.ts');
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE: str\('cuts'\)/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
