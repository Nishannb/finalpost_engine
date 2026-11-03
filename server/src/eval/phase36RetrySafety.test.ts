/**
 * Phase 36 retry-safety: a Gemini TIMEOUT must not cause an unaccounted second paid request in a strict (experiment) run. Mocked `fetch` only, no network.
 *
 * `callDirectorModel` used to answer an `upstream_timeout` with a second request that differs in body (thinking switched off), which the spend guard's
 * identical-body rule cannot see. In a strict run (`runWithBillingGuard`) it now gives up instead; outside a strict run nothing changed.
 */
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {runWithBillingGuard} from '../lib/billingGuard.ts';
import {createSpendGuard} from '../lib/spendGuard.ts';
import {callDirectorModel} from '../stages/directorV2/geminiClient.ts';

const e = env as unknown as Record<string, unknown>;
const saved = e.GEMINI_API_KEY;
const GEMINI = 'generativelanguage.googleapis.com';

type Hit = {url: string; body: any};
let hits: Hit[] = [];
/** Per-request behaviour, consumed in order; the last entry repeats. */
let script: Array<'timeout' | 'ok' | '402' | '500'> = [];

const okBody = () => JSON.stringify({candidates: [{content: {parts: [{text: '{"ok":true}'}]}}], usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 20}});
const stub = async (url: string | URL, init?: {body?: unknown; signal?: AbortSignal}): Promise<Response> => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  hits.push({url: String(url), body});
  const step = script[Math.min(hits.length - 1, script.length - 1)];
  if (step === 'timeout') {
    // Hang until the caller's AbortController fires, exactly like a real stalled request.
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))));
  }
  if (step === '402') return new Response(JSON.stringify({error: {code: 402, message: 'Your prepayment credits are depleted.'}}), {status: 402});
  if (step === '500') return new Response(JSON.stringify({error: {code: 500, message: 'upstream error'}}), {status: 500});
  return new Response(okBody(), {status: 200});
};

let seq = 0;
/** Every call gets a unique prompt so only RETRIES (not distinct calls) could ever repeat a body. */
const call = (extra: {thinkingBudget?: number} = {}) =>
  callDirectorModel({system: 'sys', parts: [{text: `prompt ${(seq += 1)}`}], responseSchema: {type: 'OBJECT'}, label: 'retry-safety test', timeoutMs: 60, ...extra});
const thrown = (promise: Promise<unknown>) => promise.then(() => null, error => error as {code?: string; message: string});

beforeAll(() => {
  e.GEMINI_API_KEY = 'offline';
  vi.stubGlobal('fetch', stub);
});
afterAll(() => {
  vi.unstubAllGlobals();
  e.GEMINI_API_KEY = saved;
});
afterEach(() => {
  hits = [];
  script = [];
  vi.stubGlobal('fetch', stub);
});

const thinkingOf = (hit: Hit) => hit.body.generationConfig?.thinkingConfig?.thinkingBudget;

describe('Gemini timeout retry in callDirectorModel', () => {
  it('NON-strict behaviour is unchanged: a timeout is retried once with thinking switched off (a different body), and the retry succeeds', async () => {
    script = ['timeout', 'ok'];
    const result = await call();
    expect(result).toBeDefined();
    expect(hits).toHaveLength(2);
    expect(thinkingOf(hits[0]!)).toBe(4096);
    expect(thinkingOf(hits[1]!)).toBeUndefined(); // thinking off
    expect(JSON.stringify(hits[0]!.body)).not.toBe(JSON.stringify(hits[1]!.body)); // different body: the identical-body rule cannot see it
  });

  it('STRICT: a timeout sends exactly ONE request, no thinking-off retry and no model fallback, and the error is the timeout', async () => {
    script = ['timeout', 'ok', 'ok'];
    const error = await thrown(runWithBillingGuard(() => call()));
    expect(error?.code).toBe('upstream_timeout');
    expect(hits).toHaveLength(1);
  });

  it('STRICT with the spend guard: one forwarded request, the request counter shows 1, nothing is refused because nothing further was attempted', async () => {
    const guard = createSpendGuard({fetchImpl: stub as never, geminiCapUsd: 0.05, maxRequestsPerHost: {[GEMINI]: 10}});
    vi.stubGlobal('fetch', guard.fetch);
    script = ['timeout', 'ok', 'ok'];
    const error = await thrown(runWithBillingGuard(() => call()));
    expect(error?.code).toBe('upstream_timeout');
    expect(guard.report().requestsPerHost[GEMINI]).toBe(1);
    expect(guard.report().refused).toEqual([]);
    expect(hits).toHaveLength(1);
  });

  it('non-strict WITH the guard: the thinking-off retry is a real, counted request (so the request cap bounds it)', async () => {
    const guard = createSpendGuard({fetchImpl: stub as never, geminiCapUsd: 0.05, maxRequestsPerHost: {[GEMINI]: 1}});
    vi.stubGlobal('fetch', guard.fetch);
    script = ['timeout', 'ok'];
    await thrown(call()); // cap of 1: the retry is refused (host_cap), not silently sent
    expect(hits).toHaveLength(1);
    expect(guard.report().refused.map(item => item.reason)).toContain('host_cap');
  });

  it('a call that already has thinking off (the content profile) never had a timeout retry, and still does not: one request in either mode', async () => {
    script = ['timeout', 'ok'];
    const strict = await thrown(runWithBillingGuard(() => call({thinkingBudget: 0})));
    expect(strict?.code).toBe('upstream_timeout');
    expect(hits).toHaveLength(1);
  });
});

describe('the budget in a strict experiment', () => {
  const guarded = (caps = 10) => {
    const guard = createSpendGuard({fetchImpl: stub as never, geminiCapUsd: 0.05, maxRequestsPerHost: {[GEMINI]: caps}});
    vi.stubGlobal('fetch', guard.fetch);
    return guard;
  };

  it('the five expected Gemini requests (content profile, occupancy, Director, layout, motion Director) all pass under the unchanged cap of 10', async () => {
    const guard = guarded(10);
    script = ['ok'];
    for (let i = 0; i < 5; i += 1) await runWithBillingGuard(() => call());
    expect(hits).toHaveLength(5);
    expect(guard.report().requestsPerHost[GEMINI]).toBe(5);
    expect(guard.report().refused).toEqual([]);
  });

  it('the cap blocks any request that is not budgeted: with 5 allowed, a sixth distinct request is refused and never sent', async () => {
    const guard = guarded(5);
    script = ['ok'];
    for (let i = 0; i < 5; i += 1) await call();
    const error = await thrown(call());
    expect(error).not.toBeNull();
    expect(hits).toHaveLength(5);
    expect(guard.report().refused.map(item => item.reason)).toContain('host_cap');
  });

  it('a 402 still stops every later provider call: the next call (different body, any host) is refused as billing_stop and not sent', async () => {
    const guard = guarded(10);
    script = ['402'];
    const first = await thrown(runWithBillingGuard(() => call()));
    expect(first).not.toBeNull();
    const sentAfter402 = hits.length;
    script = ['ok'];
    const second = await thrown(runWithBillingGuard(() => call()));
    expect(second).not.toBeNull();
    expect(hits).toHaveLength(sentAfter402); // nothing new reached the provider
    expect(guard.report().billingStop).toMatch(/HTTP 402/);
    expect(guard.report().refused.map(item => item.reason)).toContain('billing_stop');
    const claude = await thrown(guard.fetch('https://api.anthropic.com/v1/messages', {method: 'POST', body: '{"x":1}'}));
    expect((claude as unknown as {code?: string}).code).toBe('billing_stop');
  });
});
