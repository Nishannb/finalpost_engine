/**
 * WP3W pure tests: a font family that fails to load must not fail the render. remotion/src/styles/fontFallback.ts is pure (no import); the Google loaders are replaced by stubs, so nothing is
 * fetched. fonts.ts (which imports @remotion/google-fonts and starts the loads at import) and @remotion/google-fonts' base.js are read as text. No render, Chromium, FFmpeg, network or model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {chooseFontFamily, guardFace, LAST_RESORT_FAMILY, type LoadedFont} from '../../../remotion/src/styles/fontFallback.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const ok = (family: string): (() => LoadedFont) => () => ({fontFamily: family, waitUntilDone: () => Promise.resolve()});
const throws = (): LoadedFont => {
  throw new Error('weight: 400 subset: latin is not available');
};
const rejects = (): LoadedFont => ({fontFamily: 'Anton', waitUntilDone: () => Promise.reject(new Error('Failed to fetch'))});
const flush = () => new Promise(resolveTick => setTimeout(resolveTick, 0));

describe('a working load keeps today\'s family name', () => {
  it('returns the loader\'s own fontFamily for the face itself, whatever else exists', () => {
    const inter = guardFace('Inter', ok('Inter'));
    const anton = guardFace('Anton', ok('Anton'));
    expect(chooseFontFamily(anton, [inter, anton])).toBe('Anton');
    expect(chooseFontFamily(inter, [inter, anton])).toBe('Inter');
  });
  it('a stub with no waitUntilDone (the server-side loader) is fine', () => {
    expect(chooseFontFamily(guardFace('Inter', () => ({fontFamily: 'Inter'})), [])).toBe('Inter');
  });
});

describe('a synchronous throw loses that family only', () => {
  it('does not throw out of guardFace, reports once, and falls back to a loaded face', () => {
    const reports: string[] = [];
    const inter = guardFace('Inter', ok('Inter'));
    const tamil = guardFace('Noto Sans Tamil', throws, name => reports.push(name));
    expect(tamil.family).toBeUndefined();
    expect(reports).toEqual(['Noto Sans Tamil']);
    expect(chooseFontFamily(tamil, [inter, tamil])).toBe('Inter');
    expect(chooseFontFamily(inter, [inter, tamil])).toBe('Inter');
  });
  it('each family is independent: only the failed one changes', () => {
    const a = guardFace('Anton', throws);
    const b = guardFace('Bebas Neue', ok('Bebas Neue'));
    const c = guardFace('Oswald', ok('Oswald'));
    const order = [a, b, c];
    expect(chooseFontFamily(a, order)).toBe('Bebas Neue');
    expect(chooseFontFamily(b, order)).toBe('Bebas Neue');
    expect(chooseFontFamily(c, order)).toBe('Oswald');
  });
  it('a loader that returns no family counts as failed', () => {
    expect(guardFace('X', () => ({fontFamily: ''})).family).toBeUndefined();
    expect(guardFace('X', (() => undefined) as never).family).toBeUndefined();
  });
});

describe('a rejected fetch (waitUntilDone rejects) loses that family only', () => {
  it('is handled (no unhandled rejection), reported once, and the chooser then falls back', async () => {
    const reports: unknown[] = [];
    const inter = guardFace('Inter', ok('Inter'));
    const anton = guardFace('Anton', rejects, (name, error) => reports.push([name, String(error)]));
    expect(anton.family).toBe('Anton'); // not known to have failed until the fetch rejects
    await flush();
    expect(anton.family).toBeUndefined();
    expect(reports).toEqual([['Anton', 'Error: Failed to fetch']]);
    expect(chooseFontFamily(anton, [inter, anton])).toBe('Inter');
  });
  it('a sync throw and a later rejection are not both reported', async () => {
    let calls = 0;
    const face = guardFace('Y', () => { throw new Error('x'); }, () => { calls += 1; });
    await flush();
    expect(calls).toBe(1);
    expect(face.family).toBeUndefined();
  });
});

describe('nothing loaded', () => {
  it('uses sans-serif', () => {
    const a = guardFace('A', throws);
    const b = guardFace('B', throws);
    expect(chooseFontFamily(a, [a, b])).toBe(LAST_RESORT_FAMILY);
    expect(LAST_RESORT_FAMILY).toBe('sans-serif');
    expect(chooseFontFamily(a, [])).toBe('sans-serif');
  });
});

describe('wiring (source text)', () => {
  const fonts = stripComments(read('remotion/src/styles/fonts.ts'));
  const loaders = ['Anton', 'BebasNeue', 'Inter', 'Manrope', 'NotoSansTamil', 'Oswald', 'PlayfairDisplay', 'Poppins', 'SpaceGrotesk'];
  it('all nine loaders are still imported, and each is only ever called through guardFace', () => {
    for (const name of loaders) expect(fonts).toContain(`@remotion/google-fonts/${name}'`);
    expect(fonts.match(/guardFace\(/g)).toHaveLength(9);
    expect(fonts).not.toMatch(/=\s*load[A-Z]\w*\(\)/);
  });
  it('no code reads a raw loader fontFamily any more; every family goes through the chooser', () => {
    expect(fonts).not.toMatch(/\.fontFamily/);
    expect(fonts).toContain('chooseFontFamily(face, FALLBACK_ORDER)');
    expect(fonts.match(/familyOf\(/g)!.length).toBeGreaterThanOrEqual(15);
  });
  it('which family is chosen for a language/kind/design is unchanged (same branches, same faces)', () => {
    expect(fonts).toContain("if (language === 'ta' && kind === 'sans') {\n    return familyOf(tamil);");
    expect(fonts).toContain("if ((language === 'hi' || language === 'ne') && kind === 'sans') {");
    expect(fonts).toContain('return familyOf(inter);');
    expect(fonts).toContain("return kind === 'impact' ? familyOf(anton) : familyOf(inter);");
    expect(fonts).toContain("if (design.displayFont === 'bebas') {\n      return familyOf(bebas);");
    expect(fonts).toContain("if (design.displayFont === 'oswald') {\n      return familyOf(oswald);");
    expect(fonts).toContain("if (design.displayFont === 'playfair') {\n      return familyOf(playfair);");
    expect(fonts).toContain('return familyOf(spaceGrotesk);');
  });
  it('weights and sizes are not touched: fontWeightFor keeps its numbers', () => {
    const weight = fonts.slice(fonts.indexOf('export function fontWeightFor'), fonts.indexOf('export function hookDisplayFamily'));
    expect(weight).toContain('return 800;');
    expect(weight).toContain("design.displayFont === 'playfair' ? 700 : design.displayFont === 'bebas' ? 400 : 700");
    expect(weight).toContain("return kind === 'impact' ? 400 : 800;");
  });
  it('the fallback module imports nothing', () => {
    expect(stripComments(read('remotion/src/styles/fontFallback.ts'))).not.toMatch(/^import /m);
  });
  it('the facts about loadFont this relies on are in the library source: a sync throw for a missing weight/subset, an async rejection after retries, and a delayRender handle with a 60 s timeout', () => {
    const base = read('node_modules/@remotion/google-fonts/dist/cjs/base.js');
    expect(base).toContain('throw new Error(`The font ${meta.fontFamily} does not  have a weight');
    expect(base).toContain('if (attempts === 0) {\n                            throw err;');
    expect(base).toContain('waitUntilDone: () => Promise.all(promises)');
    expect(base).toContain('timeoutInMilliseconds: 60000');
    expect(base).toContain("typeof FontFace === 'undefined'");
  });
});
