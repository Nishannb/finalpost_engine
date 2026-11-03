/**
 * Phase 24: a deterministic fallback (no key, failing models, or a Director list the parser emptied) keeps the reason it happened.
 * Real planVisualDirection with a stubbed fetch. No network, no model.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {planVisualDirection} from './geminiDirector.ts';

const e = env as unknown as Record<string, unknown>;
const saved = {key: e.GEMINI_API_KEY};
const input = {transcript: 'Stop scrolling. Three small habits will change your mornings. One drink water. Two walk outside. Three write a goal.', sourceDurationSec: 30, momentCount: 3};
const gemini = (payload: unknown) => new Response(JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(payload)}]}}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}}), {status: 200});

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('unexpected network call');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  e.GEMINI_API_KEY = saved.key;
});

describe('fallbacks cannot hide why they happened (test 8)', () => {
  it('no Director key: the fallback says so', async () => {
    e.GEMINI_API_KEY = '';
    const direction = await planVisualDirection(input);
    expect(direction.source).toBe('fallback');
    expect(direction.fallbackReason).toBe('director_not_configured');
  });

  it('every model failing: the fallback carries the last error code and message', async () => {
    e.GEMINI_API_KEY = 'offline-test';
    vi.stubGlobal('fetch', async () => new Response('{"error":"boom"}', {status: 400}));
    const direction = await planVisualDirection(input);
    expect(direction.source).toBe('fallback');
    expect(direction.fallbackReason).toMatch(/^all_director_models_failed:[a-z_]+:/);
  });

  it('a Director list the parser emptied is replaced by the fallback list, and both facts are carried (rejections and substitutions)', async () => {
    e.GEMINI_API_KEY = 'offline-test';
    vi.stubGlobal('fetch', async () => gemini({
      hook_title: 'Three Small Habits Today',
      moments: [{timestamp: 8, search_keyword: 'sunset beach', layout: 'cutaway', media: 'video'}],
      zooms: [{timestamp: 2.2, duration: 1.4}, {timestamp: 29.7, duration: 1.4}],
    }));
    const direction = await planVisualDirection(input);
    expect(direction.source).toBe('gemini');
    expect(direction.fallbackReason).toBeUndefined();
    expect(direction.parseRejections!.map(item => item.code)).toEqual(['zoom_before_3.5s', 'zoom_within_0.8s_of_end']);
    expect(direction.fallbackSubstitutions).toContain('zooms');
    expect(direction.zooms.length).toBeGreaterThan(0);
  });

  it('a Director that supplies its own valid zooms substitutes nothing', async () => {
    e.GEMINI_API_KEY = 'offline-test';
    vi.stubGlobal('fetch', async () => gemini({hook_title: 'Three Small Habits Today', moments: [{timestamp: 8, search_keyword: 'sunset beach', layout: 'cutaway', media: 'video'}], zooms: [{timestamp: 10, duration: 1.4}]}));
    const direction = await planVisualDirection(input);
    expect(direction.fallbackSubstitutions ?? []).not.toContain('zooms');
    expect('parseRejections' in direction).toBe(false);
  });
});
