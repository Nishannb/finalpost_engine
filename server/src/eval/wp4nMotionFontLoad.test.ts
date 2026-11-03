/**
 * WP4N pure tests: loading a motion font file never cancels the render. remotion/src/motion/fontLoad.ts is pure (it imports the pure withTimeout only); motion/fonts.ts (Remotion) and the
 * Remotion font package are read as text. The loader is injected; the limit is a few milliseconds; no browser, no network, no render.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it, vi} from 'vitest';

import {FONT_FILE_TIMEOUT_MS, loadFontFile, loadFontFiles, loadWithFontFace, type FontFileSpec} from '../../../remotion/src/motion/fontLoad.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const spec = (family: string, weight = '400', unicodeRange?: string): FontFileSpec => ({family, url: `fonts/${family}-${weight}.woff2`, weight, ...(unicodeRange ? {unicodeRange} : {})});
const never = () => new Promise<void>(() => undefined);

describe('one font file', () => {
  it('a success records the family and the file, and warns nothing', async () => {
    const registered: FontFileSpec[] = [];
    const warn = vi.fn();
    const result = await loadFontFile(spec('FP Inter', '700'), async s => { registered.push(s); }, {warn});
    expect(result).toEqual({spec: spec('FP Inter', '700'), ok: true});
    expect(registered).toEqual([spec('FP Inter', '700')]);
    expect(warn).not.toHaveBeenCalled();
  });
  it('a failure resolves (does not reject) with the reason and a warning', async () => {
    const warn = vi.fn();
    const result = await loadFontFile(spec('FP Bebas Neue'), async () => { throw new Error('Failed to load font (404)'); }, {warn});
    expect(result).toEqual({spec: spec('FP Bebas Neue'), ok: false, reason: 'Failed to load font (404)'});
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/FP Bebas Neue 400 .* not loaded; continuing: Failed to load font \(404\)/);
  });
  it('a synchronous throw and a non-Error rejection resolve too', async () => {
    const sync = (() => { throw new Error('sync'); }) as (s: FontFileSpec) => Promise<void>;
    expect((await loadFontFile(spec('A'), sync)).ok).toBe(false);
    expect(await loadFontFile(spec('A'), () => Promise.reject('plain string'))).toMatchObject({ok: false, reason: 'plain string'});
  });
  it('a file that never settles is abandoned after the limit and the function still resolves (a few ms, not 10 s)', async () => {
    const warn = vi.fn();
    const started = Date.now();
    const result = await loadFontFile(spec('FP Space Grotesk', '500'), never, {timeoutMs: 15, warn});
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.ok).toBe(false);
    expect((result as {reason: string}).reason).toMatch(/timed out after 15 ms/);
    expect(warn).toHaveBeenCalledOnce();
  });
  it('the default limit is 10 seconds', () => {
    expect(FONT_FILE_TIMEOUT_MS).toBe(10_000);
  });
  it('a file that answers after the limit is abandoned and its late failure is not an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const slowFail = () => new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('late')), 40));
    expect((await loadFontFile(spec('A'), slowFail, {timeoutMs: 10})).ok).toBe(false);
    await new Promise(done => setTimeout(done, 80));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('many files', () => {
  it('successes are kept and failures are listed; the whole call resolves', async () => {
    const specs = [spec('FP Inter', '400'), spec('FP Inter', '700'), spec('FP Bebas Neue'), spec('FP Noto Sans JP', '400', 'U+3000-303F')];
    const load = async (s: FontFileSpec) => {
      if (s.family === 'FP Bebas Neue') throw new Error('404');
      if (s.family === 'FP Noto Sans JP') return never();
    };
    const result = await loadFontFiles(specs, load, {timeoutMs: 15});
    expect(result.loaded.map(item => `${item.family}@${item.weight}`)).toEqual(['FP Inter@400', 'FP Inter@700']);
    expect(result.failed.map(item => item.spec.family)).toEqual(['FP Bebas Neue', 'FP Noto Sans JP']);
    expect(result.failed[1]!.reason).toMatch(/timed out/);
  });
  it('every file failing or timing out still resolves, with nothing loaded', async () => {
    const result = await loadFontFiles([spec('A'), spec('B')], never, {timeoutMs: 10});
    expect(result.loaded).toEqual([]);
    expect(result.failed).toHaveLength(2);
  });
  it('the waits run together: four hung files cost one timeout', async () => {
    const started = Date.now();
    await loadFontFiles([spec('A'), spec('B'), spec('C'), spec('D')], never, {timeoutMs: 40});
    expect(Date.now() - started).toBeLessThan(160);
  });
  it('no files resolves at once', async () => {
    expect(await loadFontFiles([], never)).toEqual({loaded: [], failed: []});
  });
});

describe('the real loader without a browser', () => {
  it('rejects (is caught by loadFontFile) when FontFace is not available, instead of throwing out of the module', async () => {
    await expect(loadWithFontFace(spec('A'))).rejects.toThrow(/FontFace is not available/);
    expect((await loadFontFile(spec('A'), loadWithFontFace)).ok).toBe(false);
  });
});

describe('motion/fonts.ts (source text)', () => {
  const fonts = stripComments(read('remotion/src/motion/fonts.ts'));
  const load = stripComments(read('remotion/src/motion/fontLoad.ts'));
  it('no longer imports @remotion/fonts or calls loadFont', () => {
    expect(fonts).not.toContain('@remotion/fonts');
    expect(fonts).not.toMatch(/\bloadFont\(/);
    expect(fonts).not.toMatch(/import \{[^}]*\bloadFont\b/);
  });
  it('does not call delayRender or cancelRender (neither in fonts.ts nor in the loader module)', () => {
    for (const text of [fonts, load]) {
      expect(text).not.toContain('delayRender');
      expect(text).not.toContain('cancelRender');
      expect(text).not.toContain('continueRender');
    }
  });
  it('registers through FontFace and document.fonts, with the family, url, weight and unicode range of each file', () => {
    expect(load).toContain("new FontFace(spec.family, `url('${spec.url}') format('woff2')`, {weight: spec.weight, unicodeRange: spec.unicodeRange});");
    expect(load).toContain('await font.load();');
    expect(load).toContain('.add(font)');
  });
  it('every file goes through loadFontFile with the real loader and a console warning', () => {
    expect(fonts).toContain('loadFontFile(spec, loadWithFontFace, {warn: message => console.warn(message)})');
    expect(fonts.match(/loadFile\(/g)).toHaveLength(2);
  });
  it('the same family names and the same files: nothing added or removed', () => {
    for (const family of ["'FP Inter'", "'FP Space Grotesk'", "'FP Bebas Neue'", "'FP Noto Sans Devanagari'", "'FP Noto Sans JP'"]) {
      expect(fonts.replace(/"/g, "'")).toContain(family.replace(/'/g, "'"));
    }
    expect(fonts).toContain('weights: [400, 500, 600, 700, 800, 900],');
    expect(fonts).toContain('weights: [500, 700],');
    expect(fonts).toContain('weights: [400],');
    expect(fonts).toContain('file: weight => `fonts/inter-latin-${weight}-normal.woff2`,');
    expect(fonts).toContain('file: weight => `fonts/space-grotesk-latin-${weight}-normal.woff2`,');
    expect(fonts).toContain('file: weight => `fonts/bebas-neue-latin-${weight}-normal.woff2`,');
    expect(fonts).toContain('file: weight => `fonts/noto-sans-devanagari-devanagari-${weight}-normal.woff2`,');
    expect(fonts).toContain('file: (weight: number) => `fonts/noto-jp/noto-sans-jp-${index}-${weight}-normal.woff2`,');
    expect(fonts).toContain('const SCRIPT_WEIGHTS = [400, 700];');
    expect(fonts).toContain("const DEVANAGARI_FAMILY = 'FP Noto Sans Devanagari';");
    expect(fonts).toContain("const JAPANESE_FAMILY = 'FP Noto Sans JP';");
  });
  it('the font files on disk are untouched in number: every file the specs name still exists', () => {
    for (const file of ['inter-latin-400-normal', 'inter-latin-900-normal', 'space-grotesk-latin-500-normal', 'space-grotesk-latin-700-normal', 'bebas-neue-latin-400-normal', 'noto-sans-devanagari-devanagari-400-normal', 'noto-sans-devanagari-devanagari-700-normal']) {
      expect(existsSync(resolve(ROOT, 'remotion/public/fonts', `${file}.woff2`)), file).toBe(true);
    }
  });
  it('the fonts module still exports the same API', () => {
    for (const name of ['export function fontFamily(', 'export function availableWeight(', 'export function loadMotionFonts(', 'export function textOf(', 'export type FontId']) expect(fonts).toContain(name);
  });
  it('the render is still released by the callers: the graphic loader keeps its continueRender path and its own font try/catch', () => {
    const loader = stripComments(read('remotion/src/generated/loader.ts'));
    expect(loader).toContain('.finally(() => continueRender(handle));');
    expect(loader).toContain('await loadMotionFonts(textOf(graphics.map(graphic => graphic.props)));');
    expect(loader).not.toContain('cancelRender');
    expect(loader).toContain('{timeoutMs: GRAPHIC_FETCH_TIMEOUT_MS}');
  });
  it('the pure module imports only the pure timeout helper', () => {
    expect([...load.matchAll(/^import .*$/gm)].map(match => match[0])).toEqual(["import {withTimeout} from '../generated/loadFold';"]);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
