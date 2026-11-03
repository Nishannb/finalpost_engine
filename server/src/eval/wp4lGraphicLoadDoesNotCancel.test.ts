/**
 * WP4L pure tests: one generated graphic that fails to load must not cancel the render. remotion/src/generated/loadFold.ts is pure (no import); loader.ts and ShortVideo.tsx (Remotion, React)
 * are read as text. Stubs only: nothing is fetched, no render, no Chromium.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it, vi} from 'vitest';

import {fetchVerifyEvaluate, foldGraphicLoads, graphicsWithComponents, settleGraphicLoads, sha256Hex} from '../../../remotion/src/generated/loadFold.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const CODE_A = 'exports.default = function A() { return null; };';
const sha = (code: string) => createHash('sha256').update(code).digest('hex');
const graphic = (url: string, sha256: string) => ({module: {url, sha256}});

describe('sha256Hex', () => {
  it('matches the reference digest', async () => {
    expect(await sha256Hex(CODE_A)).toBe(sha(CODE_A));
    expect(await sha256Hex('')).toBe(sha(''));
  });
});

describe('fetchVerifyEvaluate', () => {
  const Component = () => null;
  it('returns the default export when the hash matches', async () => {
    const evaluate = vi.fn(() => Component);
    const result = await fetchVerifyEvaluate({fetchText: async () => CODE_A, evaluate}, 'u', sha(CODE_A));
    expect(result).toBe(Component);
    expect(evaluate).toHaveBeenCalledOnce();
  });
  it('a hash mismatch is a skip: it throws and the code is never evaluated', async () => {
    const evaluate = vi.fn(() => Component);
    await expect(fetchVerifyEvaluate({fetchText: async () => CODE_A + ' // tampered', evaluate}, 'u', sha(CODE_A))).rejects.toThrow(/hash mismatch/);
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('a failed fetch, an evaluation error and a missing default export all reject', async () => {
    await expect(fetchVerifyEvaluate({fetchText: async () => { throw new Error('fetch failed (404)'); }, evaluate: () => Component}, 'u', sha(CODE_A))).rejects.toThrow(/404/);
    await expect(fetchVerifyEvaluate({fetchText: async () => CODE_A, evaluate: () => { throw new Error('boom'); }}, 'u', sha(CODE_A))).rejects.toThrow(/boom/);
    await expect(fetchVerifyEvaluate({fetchText: async () => CODE_A, evaluate: () => ({})}, 'u', sha(CODE_A))).rejects.toThrow(/no default export/);
  });
});

describe('foldGraphicLoads', () => {
  const ok = (sha256: string, value: string) => ({sha256, url: `u-${sha256}`, result: {status: 'fulfilled', value} as PromiseSettledResult<string>});
  const bad = (sha256: string, reason: unknown) => ({sha256, url: `u-${sha256}`, result: {status: 'rejected', reason} as PromiseSettledResult<string>});
  it('one success and one failure keeps the success', () => {
    const folded = foldGraphicLoads([ok('a', 'A'), bad('b', new Error('hash mismatch'))]);
    expect(folded.components).toEqual({a: 'A'});
    expect(folded.failures).toEqual([{sha256: 'b', url: 'u-b', reason: 'hash mismatch'}]);
  });
  it('all failures yield an empty map', () => {
    const folded = foldGraphicLoads([bad('a', new Error('x')), bad('b', 'plain string')]);
    expect(folded.components).toEqual({});
    expect(folded.failures.map(item => item.reason)).toEqual(['x', 'plain string']);
  });
  it('no graphics yields an empty map and no failures; all successes keep every module', () => {
    expect(foldGraphicLoads([])).toEqual({components: {}, failures: []});
    expect(foldGraphicLoads([ok('a', 'A'), ok('b', 'B')]).components).toEqual({a: 'A', b: 'B'});
  });
});

describe('settleGraphicLoads (never rejects)', () => {
  it('a rejecting loader, a throwing loader and a good loader fold into the good one plus two failures', async () => {
    const load = async (url: string) => {
      if (url === 'bad-reject') throw new Error('Generated graphic hash mismatch');
      if (url === 'bad-sync') return Promise.reject(new TypeError('network'));
      return `component:${url}`;
    };
    const result = await settleGraphicLoads([graphic('good', 'h1'), graphic('bad-reject', 'h2'), graphic('bad-sync', 'h3')], load);
    expect(result.components).toEqual({h1: 'component:good'});
    expect(result.failures.map(item => item.sha256)).toEqual(['h2', 'h3']);
  });
  it('a loader that throws synchronously is still a failure, not an exception', async () => {
    const load = ((): Promise<string> => { throw new Error('sync throw'); }) as (url: string, sha: string) => Promise<string>;
    const result = await settleGraphicLoads([graphic('x', 'h')], load);
    expect(result).toEqual({components: {}, failures: [{sha256: 'h', url: 'x', reason: 'sync throw'}]});
  });
  it('every module failing resolves with an empty map', async () => {
    const result = await settleGraphicLoads([graphic('a', '1'), graphic('b', '2')], async () => { throw new Error('down'); });
    expect(result.components).toEqual({});
    expect(result.failures).toHaveLength(2);
  });
  it('the same module twice loads once per entry and keys by sha256', async () => {
    const result = await settleGraphicLoads([graphic('a', 'h'), graphic('a', 'h')], async url => url);
    expect(result.components).toEqual({h: 'a'});
  });
});

describe('graphicsWithComponents', () => {
  const graphics = [{id: 'a', module: {sha256: 'h1'}}, {id: 'b', module: {sha256: 'h2'}}];
  it('keeps only graphics whose component loaded; keeps all while loading (null)', () => {
    expect(graphicsWithComponents(graphics, {h1: () => null}).map(item => item.id)).toEqual(['a']);
    expect(graphicsWithComponents(graphics, {})).toEqual([]);
    expect(graphicsWithComponents(graphics, null)).toEqual(graphics);
  });
});

describe('the hook (source text)', () => {
  const loader = stripComments(read('remotion/src/generated/loader.ts'));
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  const pure = stripComments(read('remotion/src/generated/loadFold.ts'));
  it('cancelRender is no longer imported or called', () => {
    expect(loader).not.toContain('cancelRender');
  });
  it('the effect releases the render in a finally, after the components are set', () => {
    expect(loader).toContain('.finally(() => continueRender(handle));');
    expect(loader.match(/continueRender\(/g)).toHaveLength(1);
    const body = loader.slice(loader.indexOf('const load = async () => {'));
    expect(body.indexOf('setComponents(loaded);')).toBeLessThan(body.indexOf('.finally(() => continueRender(handle));'));
  });
  it('a load failure is folded, warned and skipped; the catch falls back to an empty map', () => {
    expect(loader).toContain('await settleGraphicLoads(graphics, loadGeneratedGraphic, {timeoutMs: GRAPHIC_FETCH_TIMEOUT_MS})'); // WP4M added the timeout
    expect(loader).toContain('console.warn(`[generated graphics] skipped');
    expect(loader).toContain('setComponents({});');
  });
  it('a loadMotionFonts rejection is warned and module loading still runs', () => {
    const fonts = loader.slice(loader.indexOf('try {'), loader.indexOf('await settleGraphicLoads'));
    expect(fonts).toContain('await loadMotionFonts(textOf(graphics.map(graphic => graphic.props)));');
    expect(fonts).toContain('console.warn(`[generated graphics] motion fonts failed to load; continuing');
    expect(fonts).toContain('} catch (error) {');
  });
  it('the hash is checked by the pure function before evaluation, and the loader no longer re-implements it', () => {
    expect(loader).toContain('fetchVerifyEvaluate<GraphicComponent>(');
    expect(loader).not.toContain('crypto.subtle');
    expect(pure.indexOf('actual !== sha256')).toBeLessThan(pure.indexOf('deps.evaluate(code, sha256)'));
  });
  it('the module map, the cache and the allowed require surface are unchanged', () => {
    expect(loader).toContain("'@finalpost/motion': Motion,");
    expect(loader).toContain('const moduleCache = new Map<string, Promise<GraphicComponent>>();');
    expect(loader).toContain('which is not allowed');
  });
  it('a generated split whose component did not load is not a split (the creator keeps the full frame)', () => {
    expect(video).toContain('activeGeneratedSplitAt(graphicsWithComponents(generatedGraphics, graphicComponents), timeSec)');
    expect(video).toContain("import {graphicsWithComponents} from './generated/loadFold';");
  });
  it('the pure module imports nothing', () => {
    expect([...pure.matchAll(/^import .*$/gm)]).toEqual([]);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
