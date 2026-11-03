/**
 * WP4M pure tests: a generated-graphic load that does not settle within the timeout is skipped like a failed one. remotion/src/generated/loadFold.ts is pure (no import); loader.ts (Remotion,
 * React) is read as text. The timeout is injected (a few milliseconds here); nothing is fetched, no socket, no render, no Chromium.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it, vi} from 'vitest';

import {fetchVerifyEvaluate, GRAPHIC_FETCH_TIMEOUT_MS, settleGraphicLoads, withTimeout} from '../../../remotion/src/generated/loadFold.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const graphic = (url: string, sha256: string) => ({module: {url, sha256}});
const never = () => new Promise<never>(() => undefined);
const later = <T,>(value: T, ms: number) => new Promise<T>(resolveLater => setTimeout(() => resolveLater(value), ms));

describe('the default', () => {
  it('is 10 seconds', () => {
    expect(GRAPHIC_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});

describe('withTimeout', () => {
  it('passes a fast result through, and a fast rejection through', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'x')).resolves.toBe('ok');
    await expect(withTimeout(Promise.reject(new Error('nope')), 50, 'x')).rejects.toThrow('nope');
  });
  it('rejects with a timeout error when the promise never settles (a few ms, not 10 s)', async () => {
    const started = Date.now();
    await expect(withTimeout(never(), 15, 'Generated graphic u')).rejects.toThrow('Generated graphic u timed out after 15 ms');
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('a result that arrives after the timeout is ignored and does not surface as an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const slowFail = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('late failure')), 40));
    await expect(withTimeout(slowFail, 10, 'x')).rejects.toThrow(/timed out/);
    await later(null, 80);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
  it('clears its timer when the promise settles first', async () => {
    vi.useFakeTimers();
    try {
      const done = withTimeout(Promise.resolve(1), 10_000, 'x');
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a non-positive or non-finite timeout means no timeout (the promise itself)', async () => {
    const p = Promise.resolve(3);
    for (const timeoutMs of [0, -1, NaN, Infinity]) expect(withTimeout(p, timeoutMs, 'x')).toBe(p);
  });
});

describe('settleGraphicLoads with a timeout', () => {
  it('a module that never settles is a skip; a module that loads is still used', async () => {
    const load = (url: string) => (url === 'hang' ? never() : Promise.resolve(`component:${url}`));
    const result = await settleGraphicLoads([graphic('good', 'h1'), graphic('hang', 'h2')], load, {timeoutMs: 15});
    expect(result.components).toEqual({h1: 'component:good'});
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({sha256: 'h2', url: 'hang'});
    expect(result.failures[0]!.reason).toMatch(/timed out after 15 ms/);
  });
  it('if every fetch times out, the result is an empty map (the render goes on with no generated graphics)', async () => {
    const result = await settleGraphicLoads([graphic('a', '1'), graphic('b', '2')], never, {timeoutMs: 10});
    expect(result.components).toEqual({});
    expect(result.failures.map(item => item.sha256)).toEqual(['1', '2']);
  });
  it('the waits run together, so several hung modules cost one timeout, not the sum', async () => {
    const started = Date.now();
    await settleGraphicLoads([graphic('a', '1'), graphic('b', '2'), graphic('c', '3'), graphic('d', '4')], never, {timeoutMs: 40});
    expect(Date.now() - started).toBeLessThan(160);
  });
  it('a slow module that answers inside the timeout is kept', async () => {
    const result = await settleGraphicLoads([graphic('slow', 'h')], url => later(`component:${url}`, 10), {timeoutMs: 200});
    expect(result.components).toEqual({h: 'component:slow'});
  });
  it('a module that answers after the timeout is a skip, and its late component is not used', async () => {
    const result = await settleGraphicLoads([graphic('slow', 'h')], url => later(`component:${url}`, 60), {timeoutMs: 10});
    expect(result.components).toEqual({});
    await later(null, 80);
    expect(result.components).toEqual({});
  });
  it('an ordinary failure is still a skip with its own reason (not a timeout)', async () => {
    const result = await settleGraphicLoads([graphic('x', 'h')], async () => { throw new Error('fetch failed (404)'); }, {timeoutMs: 50});
    expect(result.failures[0]!.reason).toBe('fetch failed (404)');
  });
  it('without options the default timeout applies (not waited here: a fast module settles at once)', async () => {
    const result = await settleGraphicLoads([graphic('x', 'h')], async () => 'ok');
    expect(result.components).toEqual({h: 'ok'});
  });
});

describe('a hash mismatch is still not rendered', () => {
  it('through the same path: it is a rejection (a skip), and the code is never evaluated', async () => {
    const evaluate = vi.fn(() => () => null);
    const load = (url: string, sha256: string) => fetchVerifyEvaluate({fetchText: async () => 'tampered code', evaluate}, url, sha256);
    const result = await settleGraphicLoads([graphic('u', 'a'.repeat(64))], load, {timeoutMs: 50});
    expect(result.components).toEqual({});
    expect(result.failures[0]!.reason).toMatch(/hash mismatch/);
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('the loader (source text)', () => {
  const loader = stripComments(read('remotion/src/generated/loader.ts'));
  const pure = stripComments(read('remotion/src/generated/loadFold.ts'));
  it('uses the timeout fold with the 10 s constant', () => {
    expect(loader).toContain('GRAPHIC_FETCH_TIMEOUT_MS');
    expect(loader).toContain('await settleGraphicLoads(graphics, loadGeneratedGraphic, {timeoutMs: GRAPHIC_FETCH_TIMEOUT_MS});');
    expect(pure).toContain('export const GRAPHIC_FETCH_TIMEOUT_MS = 10_000;');
  });
  it('still releases the render in a finally, never cancels it, and does not raise Remotion\'s delayRender timeout', () => {
    expect(loader).toContain('.finally(() => continueRender(handle));');
    expect(loader.match(/continueRender\(/g)).toHaveLength(1);
    expect(loader).not.toContain('cancelRender');
    expect(loader).toContain("delayRender('Loading generated motion graphics')");
    expect(loader).not.toMatch(/timeoutInMilliseconds/);
  });
  it('a timeout is folded, not thrown: the timeout is applied inside settleGraphicLoads, which never rejects', () => {
    const settle = pure.slice(pure.indexOf('export async function settleGraphicLoads'));
    expect(settle).toContain('withTimeout((async () => load(url, sha256))(), timeoutMs,');
    expect(settle).toContain('reason => ({status: \'rejected\', reason}) as const');
  });
  it('the split lookup from WP4L is kept', () => {
    expect(stripComments(read('remotion/src/ShortVideo.tsx'))).toContain('activeGeneratedSplitAt(graphicsWithComponents(generatedGraphics, graphicComponents), timeSec)');
  });
  it('the pure module has no imports, and no network or Remotion API is used by the tests\' module', () => {
    expect([...pure.matchAll(/^import .*$/gm)]).toEqual([]);
    expect(pure).not.toMatch(/\bfetch\(|XMLHttpRequest|require\(/);
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
