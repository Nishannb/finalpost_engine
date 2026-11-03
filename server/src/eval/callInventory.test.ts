/**
 * Model-call inventory: a stale-proof guard plus fetch-level counting. `fetch` is replaced before any code runs, so the REAL
 * requestWithRetry / callDirectorModel / planVisualDirection / ... execute (retries and model-fallback loops included) while nothing
 * leaves the process. A request to an unexpected host fails the test. No model is called.
 */
import {mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {loadV1Fixtures} from './fixtures.ts';
import {CALL_INVENTORY, modelBackedEntries, TRANSPORT_AND_COVERED_FILES} from './callInventory.ts';

vi.mock('../media/ffmpeg.ts', async importOriginal => ({...(await importOriginal<typeof import('../media/ffmpeg.ts')>()), extractStillJpeg: async () => undefined}));

const SERVER_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NETWORK_PATTERN = /\brequestJson\s*[<(]|\brequestWithRetry\s*\(|\bfetch\s*\(|@anthropic-ai\/sdk|generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai/;
/** An inventory row may reach the network through a shared helper instead of calling it directly. */
const REACHES_NETWORK = new RegExp(`${NETWORK_PATTERN.source}|\\bcallDirectorModel\\s*\\(|\\bgenerateMotionGraphic\\s*\\(|\\banthropicGenerator\\s*\\(|\\bmeasureOccupancyAt\\s*\\(|\\brepairEdit\\s*\\(`);

const e = env as unknown as {GEMINI_API_KEY: string};
const originalKey = e.GEMINI_API_KEY;
const GOOGLE = 'https://generativelanguage.googleapis.com/';

type Seen = {url: string; body: string};
const seen: Seen[] = [];
let behave: (request: Seen) => Response | 'abort' = () => new Response('{}', {status: 200});

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const request = {url: String(url), body: typeof init?.body === 'string' ? init.body : ''};
    if (!request.url.startsWith(GOOGLE)) {
      throw new Error(`unexpected outbound request to ${request.url}: this test only allows the stubbed Gemini host`);
    }
    seen.push(request);
    const result = behave(request);
    if (result === 'abort') {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
    return result;
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  seen.length = 0;
  behave = () => new Response('{}', {status: 200});
  e.GEMINI_API_KEY = originalKey;
});

const geminiOk = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}}), {status: 200});
const boom = () => new Response('upstream error', {status: 500});
const stated = (id: string) => CALL_INVENTORY.find(entry => entry.id === id)!.maxHttpAttemptsPerLogicalCall;

describe('the inventory cannot silently go stale', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : [path];
    });
  const sources = walk(SERVER_SRC).filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts')).map(path => relative(SERVER_SRC, path));
  const networked = sources.filter(path => !path.startsWith('eval/') && NETWORK_PATTERN.test(readFileSync(join(SERVER_SRC, path), 'utf8')));
  const listed = new Set([...CALL_INVENTORY.map(entry => entry.file), ...TRANSPORT_AND_COVERED_FILES]);

  it('every source file that can make an outbound request is in the inventory (or is transport)', () => {
    expect(networked.filter(path => !listed.has(path))).toEqual([]);
  });

  it('every inventory file exists and still contains a network call (an entry for removed code is flagged)', () => {
    for (const entry of CALL_INVENTORY) {
      expect(sources, entry.file).toContain(entry.file);
      expect(REACHES_NETWORK.test(readFileSync(join(SERVER_SRC, entry.file), 'utf8')), `${entry.file} no longer makes or reaches a request`).toBe(true);
    }
  });

  it('entries are well formed: unique ids, a trigger and a fallback, and model-backed rows name a provider that is not "internal" or "stock"', () => {
    expect(new Set(CALL_INVENTORY.map(entry => entry.id)).size).toBe(CALL_INVENTORY.length);
    for (const entry of CALL_INVENTORY) {
      expect(entry.trigger.length, entry.id).toBeGreaterThan(10);
      expect(entry.fallback.length, entry.id).toBeGreaterThan(1);
      expect(entry.attemptsBasis.length, entry.id).toBeGreaterThan(5);
      if (entry.modelBacked) {
        expect(['internal', 'stock'], entry.id).not.toContain(entry.provider);
      } else {
        expect(['gemini', 'groq', 'anthropic', 'openrouter'], entry.id).not.toContain(entry.provider);
      }
    }
    expect(modelBackedEntries().length).toBeGreaterThan(15);
  });

  it('only the stages the pipeline runs on every video are unconditional; everything else names its trigger and flags', () => {
    const unconditional = CALL_INVENTORY.filter(entry => entry.modelBacked && entry.flags.length === 0);
    expect(unconditional).toEqual([]);
  });
});

describe('fetch-level counting of real retry and fallback paths (nothing is sent)', () => {
  it('the fetch stub is what the code under test calls: an unexpected host fails loudly instead of reaching the network', async () => {
    await expect(fetch('https://example.invalid/x')).rejects.toThrow(/unexpected outbound request/);
  });

  describe('callDirectorModel (v2 stages, content profile, motion director, delivery, North-Star gates)', () => {
    const call = async (model?: string) => {
      e.GEMINI_API_KEY = 'test-key-offline';
      const {callDirectorModel} = await import('../stages/directorV2/geminiClient.ts');
      return callDirectorModel({system: 's', parts: [{text: 'u'}], responseSchema: {type: 'OBJECT'}, label: 'inventory probe', ...(model ? {model} : {})});
    };

    it('success: 1 request', async () => {
      behave = () => geminiOk('{"ok":true}');
      await call();
      expect(seen).toHaveLength(1);
    });

    it('5xx on every attempt: 4 requests (2 models x 2 attempts) under the default configuration', async () => {
      behave = boom;
      await expect(call()).rejects.toThrow();
      expect(seen).toHaveLength(4);
      expect(stated('content_profile')).toBeGreaterThanOrEqual(seen.length);
      expect(new Set(seen.map(request => request.url.split('/models/')[1]!.split(':')[0])).size).toBe(2);
    }, 30_000);

    it('a timeout on every attempt: 3 requests. The first timeout turns thinking off for all later attempts, so only the FIRST model is retried', async () => {
      behave = () => 'abort';
      await expect(call()).rejects.toThrow();
      expect(seen).toHaveLength(3);
      expect(seen.filter(request => request.body.includes('thinkingConfig'))).toHaveLength(1);
      seen.length = 0;
      await expect(call('gemini-custom-model')).rejects.toThrow();
      expect(seen).toHaveLength(4);
    }, 30_000);

    it('the worst case: a timeout with thinking, then 5xx on every later attempt: 5 requests by default, 7 with a third model', async () => {
      behave = request => (request.body.includes('thinkingConfig') ? 'abort' : boom());
      await expect(call()).rejects.toThrow();
      expect(seen).toHaveLength(5);
      expect(stated('content_profile')).toBe(5);
      seen.length = 0;
      await expect(call('gemini-custom-model')).rejects.toThrow();
      expect(seen).toHaveLength(7);
    }, 60_000);

    it('5xx on every attempt with a third model: 6 requests', async () => {
      behave = boom;
      await expect(call('gemini-custom-model')).rejects.toThrow();
      expect(seen).toHaveLength(6);
    }, 30_000);

    it('a 200 reply with no text moves to the next model without a retry: 2 requests', async () => {
      behave = () => new Response(JSON.stringify({candidates: []}), {status: 200});
      await expect(call()).rejects.toThrow();
      expect(seen).toHaveLength(2);
    });

    it('every stage that goes through callDirectorModel states the measured default-configuration worst case (5), and says it is 7 with a third model', () => {
      for (const id of ['content_profile', 'delivery_director', 'v2_story_analyst', 'v2_creative_director', 'v2_repair', 'northstar_semantic_gate', 'northstar_proxy_critic', 'motion_director']) {
        const entry = CALL_INVENTORY.find(item => item.id === id)!;
        expect(entry.maxHttpAttemptsPerLogicalCall, id).toBe(5);
        expect(entry.attemptsBasis, id).toContain('worst case timeout-then-5xx 5 (3 models: 7)');
      }
    });
  });

  describe('v1 Director (planVisualDirection)', () => {
    const fixture = loadV1Fixtures()[0]!;
    const run = async () => {
      e.GEMINI_API_KEY = 'test-key-offline';
      const {planVisualDirection} = await import('../stages/broll/geminiDirector.ts');
      return planVisualDirection({transcript: fixture.transcript, sourceDurationSec: fixture.sourceDurationSec, momentCount: 3});
    };

    it('a valid saved reply: 1 request', async () => {
      behave = () => geminiOk(fixture.rawResponse);
      const direction = await run();
      expect(seen).toHaveLength(1);
      expect(direction.source).not.toBe('fallback');
    });

    it('5xx on every attempt: 4 requests (2 models x 2 attempts) and then the deterministic fallback', async () => {
      behave = boom;
      const direction = await run();
      expect(seen).toHaveLength(4);
      expect(stated('v1_director')).toBe(4);
      expect(direction.source).toBe('fallback');
    }, 30_000);

    it('an unparsable reply moves to the next model without retrying the first: 2 requests, then the fallback', async () => {
      behave = () => geminiOk('this is not json');
      const direction = await run();
      expect(seen).toHaveLength(2);
      expect(direction.source).toBe('fallback');
    });

    it('a parseable but EMPTY brief ({}) under the default placeholder policy is accepted after 1 request (the placeholder title makes the empty-brief guard unreachable)', async () => {
      behave = () => geminiOk('{}');
      const direction = await run();
      expect(seen).toHaveLength(1);
      expect(direction.hookTitle).toBe('WATCH THIS');
    });

    it('the same empty brief under HOOK_TITLE_POLICY=optional is rejected and costs a second model attempt: the policy can change the request count', async () => {
      const policy = env as unknown as {HOOK_TITLE_POLICY: string};
      const before = policy.HOOK_TITLE_POLICY;
      policy.HOOK_TITLE_POLICY = 'optional';
      try {
        behave = () => geminiOk('{}');
        const direction = await run();
        expect(seen).toHaveLength(2);
        expect(direction.source).toBe('fallback');
        expect(direction.hookTitle).toBe('');
      } finally {
        policy.HOOK_TITLE_POLICY = before;
      }
    });

    it('no key configured: 0 requests', async () => {
      e.GEMINI_API_KEY = '';
      const {planVisualDirection} = await import('../stages/broll/geminiDirector.ts');
      await planVisualDirection({transcript: fixture.transcript, sourceDurationSec: fixture.sourceDurationSec, momentCount: 3});
      expect(seen).toHaveLength(0);
    });
  });

  describe('content profile (a callDirectorModel wrapper)', () => {
    it('5xx: 4 requests, then null (callers behave as if no profile existed); empty transcript: 0 requests', async () => {
      e.GEMINI_API_KEY = 'test-key-offline';
      behave = boom;
      const {classifyContent} = await import('../stages/contentProfile/contentProfile.ts');
      expect(await classifyContent({transcript: 'Quiet moments speak.', durationSec: 30, languageCode: 'en'})).toBeNull();
      expect(seen).toHaveLength(4);
      seen.length = 0;
      expect(await classifyContent({transcript: '   ', durationSec: 30, languageCode: 'en'})).toBeNull();
      expect(seen).toHaveLength(0);
    }, 30_000);
  });

  describe('speaker occupancy detection (the measurement that makes live occupancy non-reproducible)', () => {
    let dir: string;
    let still: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'inventory-'));
      still = join(dir, 'still.jpg');
      writeFileSync(still, Buffer.from('not-a-jpeg'));
    });
    afterAll(() => rmSync(dir, {recursive: true, force: true}));

    it('a failing detector: 2 requests and a DEFAULT box labelled fallback; an unparsable reply: 1 request and the same fallback', async () => {
      e.GEMINI_API_KEY = 'test-key-offline';
      const {measureOccupancyAt} = await import('../stages/layout/occupancy.ts');
      behave = boom;
      const failed = await measureOccupancyAt({sourcePath: '/dev/null', durationSec: 20, stillPath: still, atSec: 5});
      expect(seen).toHaveLength(2);
      expect(failed.source).toBe('fallback');
      expect(stated('occupancy_primary')).toBe(2);
      expect(stated('occupancy_slices')).toBe(2);
      seen.length = 0;
      behave = () => geminiOk('not json');
      const garbled = await measureOccupancyAt({sourcePath: '/dev/null', durationSec: 20, stillPath: still, atSec: 5});
      expect(seen).toHaveLength(1);
      expect(garbled.source).toBe('fallback');
    }, 30_000);

    it('layout vision critique: 1 request even on a 5xx (retries:0), then geometric-only', async () => {
      e.GEMINI_API_KEY = 'test-key-offline';
      const {critiqueAndPatchLayout} = await import('../stages/layout/layoutCritique.ts');
      const {occupancyFromSpeaker} = await import('../stages/layout/occupancy.ts');
      behave = boom;
      const result = await critiqueAndPatchLayout({
        stillPath: still, occupancy: occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision'),
        plan: {hookTitle: '', hookAnchor: 'top_left', hookDurationSec: 0, caption: {} as never, motionGraphics: [], overlays: [], mediaContainers: [], semanticEmphasis: []},
      });
      expect(seen).toHaveLength(1);
      expect(stated('layout_vision_critique')).toBe(1);
      expect(result.source).toBe('geometric');
    });
  });
});

describe('Claude motion worker: the repair loop (an injected generator stands in for the SDK; no Anthropic request)', () => {
  const brief = {id: 'g_inventory', goal: 'Show a number', visualDescription: 'A counter', placement: 'pip', durationSeconds: 3, content: {label: 'Revenue', from: 2, to: 10}, box: {x: 0.55, y: 0.1, w: 0.4, h: 0.24}};
  const reply = (text: string, stopReason = 'end_turn') => ({text, stopReason, model: 'claude-sonnet-5-5', usage: {inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}});

  it('a reply that never contains valid code: 1 generate + MAX_REPAIR_ATTEMPTS repairs = 3 model calls, then the graphic is dropped', async () => {
    const {generateMotionGraphic, MAX_REPAIR_ATTEMPTS, MotionWorkerError} = await import('../motionWorker/worker.ts');
    const calls: number[] = [];
    const generator = async () => (calls.push(1), reply('no code block here'));
    await expect(generateMotionGraphic(brief, {generator, upload: async () => 'https://invalid/x.js', runtimeCheck: false})).rejects.toBeInstanceOf(MotionWorkerError);
    expect(calls).toHaveLength(1 + MAX_REPAIR_ATTEMPTS);
    expect(MAX_REPAIR_ATTEMPTS).toBe(2);
    expect(CALL_INVENTORY.find(entry => entry.id === 'motion_worker_claude')!.logicalCalls).toContain('3');
  });

  it('a refusal stops after 1 call; maxRepairAttempts:0 allows exactly 1', async () => {
    const {generateMotionGraphic, MotionWorkerError} = await import('../motionWorker/worker.ts');
    let refusals = 0;
    await expect(generateMotionGraphic(brief, {generator: async () => (refusals += 1, reply('', 'refusal')), upload: async () => 'https://invalid/x.js', runtimeCheck: false})).rejects.toBeInstanceOf(MotionWorkerError);
    expect(refusals).toBe(1);
    let single = 0;
    await expect(generateMotionGraphic(brief, {generator: async () => (single += 1, reply('nothing')), upload: async () => 'https://invalid/x.js', runtimeCheck: false, maxRepairAttempts: 0})).rejects.toBeInstanceOf(MotionWorkerError);
    expect(single).toBe(1);
  });

  it('the SDK\'s own retries are NOT observable here: the default client retries up to 2 times (read from the installed SDK), so HTTP attempts can exceed model calls by 3x', () => {
    const sdk = readFileSync(resolve(SERVER_SRC, '..', '..', 'node_modules', '@anthropic-ai', 'sdk', 'client.js'), 'utf8');
    expect(sdk).toMatch(/options\.maxRetries \?\? 2/);
    expect(CALL_INVENTORY.find(entry => entry.id === 'motion_worker_claude')!.countability).toBe('sdk_internal');
  });
});

describe('call paths that cannot be counted reliably yet', () => {
  it('lists the entries whose request count depends on content or on a vendor SDK, so no single per-run total can be stated', () => {
    const notBounded = CALL_INVENTORY.filter(entry => entry.modelBacked && (entry.countability === 'content_dependent' || entry.countability === 'sdk_internal')).map(entry => entry.id);
    expect(notBounded).toEqual(expect.arrayContaining(['user_asset_describe', 'northstar_semantic_gate', 'motion_worker_claude']));
  });
});
