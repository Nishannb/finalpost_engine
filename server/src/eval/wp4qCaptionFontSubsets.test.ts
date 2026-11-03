/**
 * WP4Q tests: the caption font families ask @remotion/google-fonts only for the style, weights and subsets the product uses, and everything requested exists in the installed metadata (a missing
 * weight or subset would throw and the guard would drop the whole family). remotion/src/styles/fontRequests.ts is pure; each family's `getInfo()` is read from node_modules (no fetch is made:
 * `getInfo` only returns metadata). fonts.ts (Remotion) is read as text. No render, no Chromium, no network.
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {CAPTION_FONT_REQUESTS, CAPTION_FONT_STYLE, CAPTION_FONT_WEIGHTS, type CaptionFontKey} from '../../../remotion/src/styles/fontRequests.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const requireFromRemotion = createRequire(resolve(ROOT, 'remotion/package.json'));

type Info = {fontFamily: string; subsets: string[]; fonts: Record<string, Record<string, Record<string, string>>>};
const FAMILIES: Record<CaptionFontKey, {module: string; name: string; loader: string}> = {
  anton: {module: 'Anton', name: 'Anton', loader: 'loadAnton'},
  bebas: {module: 'BebasNeue', name: 'Bebas Neue', loader: 'loadBebas'},
  inter: {module: 'Inter', name: 'Inter', loader: 'loadInter'},
  manrope: {module: 'Manrope', name: 'Manrope', loader: 'loadManrope'},
  tamil: {module: 'NotoSansTamil', name: 'Noto Sans Tamil', loader: 'loadTamil'},
  oswald: {module: 'Oswald', name: 'Oswald', loader: 'loadOswald'},
  playfair: {module: 'PlayfairDisplay', name: 'Playfair Display', loader: 'loadPlayfair'},
  poppins: {module: 'Poppins', name: 'Poppins', loader: 'loadPoppins'},
  spaceGrotesk: {module: 'SpaceGrotesk', name: 'Space Grotesk', loader: 'loadSpaceGrotesk'},
};
const infoOf = (key: CaptionFontKey): Info => requireFromRemotion(`@remotion/google-fonts/${FAMILIES[key].module}`).getInfo() as Info;
const keys = Object.keys(CAPTION_FONT_REQUESTS) as CaptionFontKey[];

describe('every requested weight and subset exists in that family\'s installed metadata', () => {
  for (const key of keys) {
    it(`${FAMILIES[key].name}`, () => {
      const info = infoOf(key);
      const normal = info.fonts[CAPTION_FONT_STYLE];
      expect(normal, 'style normal exists').toBeDefined();
      const request = CAPTION_FONT_REQUESTS[key];
      expect(request.weights.length).toBeGreaterThan(0);
      expect(request.subsets.length).toBeGreaterThan(0);
      for (const weight of request.weights) {
        expect(Object.keys(normal!), `${info.fontFamily} weight ${weight}`).toContain(weight);
        for (const subset of request.subsets) expect(Object.keys(normal![weight]!), `${info.fontFamily} ${weight} subset ${subset}`).toContain(subset);
      }
      for (const subset of request.subsets) expect(info.subsets, `${info.fontFamily} subset ${subset}`).toContain(subset);
    });
  }
  it('the loader\'s own fontFamily is the name the code expects (a successful load keeps it)', () => {
    for (const key of keys) expect(infoOf(key).fontFamily).toBe(FAMILIES[key].name);
  });
});

describe('what is requested', () => {
  it('only weights fontWeightFor can return (400, 700, 800), each family limited to what it ships', () => {
    expect([...CAPTION_FONT_WEIGHTS]).toEqual(['400', '700', '800']);
    for (const key of keys) {
      const info = infoOf(key);
      const shipped = Object.keys(info.fonts[CAPTION_FONT_STYLE]!);
      const expected = CAPTION_FONT_WEIGHTS.filter(weight => shipped.includes(weight));
      expect([...CAPTION_FONT_REQUESTS[key].weights], FAMILIES[key].name).toEqual(expected);
    }
  });
  it('Latin families get the latin subset; Noto Sans Tamil gets tamil and latin', () => {
    for (const key of keys) {
      const subsets = [...CAPTION_FONT_REQUESTS[key].subsets];
      expect(subsets).toEqual(key === 'tamil' ? ['tamil', 'latin'] : ['latin']);
    }
  });
  it('the style is normal (no italic file is fetched)', () => {
    expect(CAPTION_FONT_STYLE).toBe('normal');
  });
  it('the number of files fetched per family drops from every file to the requested ones', () => {
    let before = 0;
    let after = 0;
    for (const key of keys) {
      const info = infoOf(key);
      for (const style of Object.values(info.fonts)) for (const subsets of Object.values(style)) before += Object.keys(subsets).length;
      after += CAPTION_FONT_REQUESTS[key].weights.length * CAPTION_FONT_REQUESTS[key].subsets.length;
    }
    expect(after).toBeLessThan(before);
    expect(after).toBe(1 + 1 + 3 + 3 + 6 + 2 + 3 + 3 + 2);
    expect(before).toBeGreaterThan(200);
  });
});

describe('fonts.ts (source text)', () => {
  const fonts = stripComments(read('remotion/src/styles/fonts.ts'));
  it('every family goes through the request helper with its own key, and no loader is called bare', () => {
    for (const key of keys) {
      expect(fonts).toContain(`guardFace('${FAMILIES[key].name}', requested('${key}', ${FAMILIES[key].loader}), onFontFail);`);
    }
    expect(fonts.match(/guardFace\(/g)).toHaveLength(9);
    expect(fonts).not.toMatch(/guardFace\('[^']+', load\w+, onFontFail\)/);
    expect(fonts).toContain('return (load as LoadWith)(CAPTION_FONT_STYLE, {weights: [...request.weights], subsets: [...request.subsets]} as never);');
  });
  it('@remotion/google-fonts is still the loader, the guard and the fallback order are as before, and a working load keeps the loader\'s fontFamily', () => {
    for (const name of ['Anton', 'BebasNeue', 'Inter', 'Manrope', 'NotoSansTamil', 'Oswald', 'PlayfairDisplay', 'Poppins', 'SpaceGrotesk']) expect(fonts).toContain(`@remotion/google-fonts/${name}'`);
    expect(fonts).toContain('const FALLBACK_ORDER: readonly GuardedFace[] = [inter, anton, bebas, manrope, tamil, oswald, playfair, poppins, spaceGrotesk];');
    expect(fonts).toContain('const familyOf = (face: GuardedFace): string => chooseFontFamily(face, FALLBACK_ORDER);');
  });
  it('fontFamilyFor and fontWeightFor are unchanged', () => {
    const weight = fonts.slice(fonts.indexOf('export function fontWeightFor'), fonts.indexOf('export function hookDisplayFamily'));
    expect(weight).toContain('return 800;');
    expect(weight).toContain("design.displayFont === 'playfair' ? 700 : design.displayFont === 'bebas' ? 400 : 700");
    expect(weight).toContain("return kind === 'impact' ? 400 : 800;");
    expect(fonts).toContain("if (language === 'ta' && kind === 'sans') {\n    return familyOf(tamil);");
    expect(fonts).toContain("return kind === 'impact' ? familyOf(anton) : familyOf(inter);");
  });
  it('no font file was added and nothing was downloaded: the request module has no import and no network call', () => {
    const request = stripComments(read('remotion/src/styles/fontRequests.ts'));
    expect([...request.matchAll(/^import .*$/gm)]).toEqual([]);
    expect(request).not.toMatch(/fetch\(|XMLHttpRequest/);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
