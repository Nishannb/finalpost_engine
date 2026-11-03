/**
 * Phase 35 correction: an AI-directed run must stop on a terminal billing failure (or a Director fallback) instead of silently producing a
 * deterministic plan. Real analyzeVideo, `fetch` stubbed for the Groq and Gemini hosts only (nothing reaches the network, no paid call).
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {currentBillingBlock, looksLikeBillingFailure, noteBillingFailure, runWithBillingGuard} from '../lib/billingGuard.ts';
import {EngineError} from '../lib/errors.ts';

vi.mock('../storage/r2.ts', async importOriginal => ({...(await importOriginal<typeof import('../storage/r2.ts')>()), uploadSourceVideo: async () => ({publicUrl: 'staticFile:source.mp4', key: 'synthetic'})}));

const e = env as unknown as Record<string, unknown>;
const WORDS = Array.from({length: 22}, (_, i) => ({word: `word${i}.`, start: i * 0.5, end: i * 0.5 + 0.45}));
const ok = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}}), {status: 200});
const DIRECTOR = {topic: 't', hook_title: 'Silence Speaks', hook_style: 'minimal', moments: [{timestamp: 5, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}};

let work: string;
let video: string;
const saved: Record<string, unknown> = {};
const KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'CONTENT_PROFILE_ENABLED', 'OCCUPANCY_CONTEXT_V2', 'HOOK_TITLE_POLICY', 'DIRECTOR_V2', 'NORTH_STAR', 'VISUAL_CONTEXT_V2', 'MOTION_GRAPHICS_ENABLED'];
let geminiStatus = 200;
let geminiCalls = 0;
const originalTmp = process.env.TMPDIR;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'phase35-strict-'));
  process.env.TMPDIR = join(work, 'tmp');
  execFileSync('mkdir', ['-p', process.env.TMPDIR]);
  video = join(work, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  for (const key of KEYS) saved[key] = e[key];
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const host = new URL(String(url)).hostname;
    if (host === 'api.groq.com') {
      return new Response(JSON.stringify({text: WORDS.map(word => word.word).join(' '), language: 'en', duration: 12, words: WORDS}), {status: 200});
    }
    if (host !== 'generativelanguage.googleapis.com') throw new Error(`blocked outbound request to ${host}`);
    geminiCalls += 1;
    if (geminiStatus !== 200) {
      return new Response(JSON.stringify({error: {code: geminiStatus, message: geminiStatus === 402 ? 'Your prepayment credits are depleted.' : 'upstream error'}}), {status: geminiStatus});
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    if (body.includes('Vertical talking-head video frame')) return ok(JSON.stringify({x: 0.2, y: 0.1, w: 0.6, h: 0.7}));
    if (body.includes('planned overlay layout')) return ok('{"notes":""}');
    return ok(JSON.stringify(DIRECTOR));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  process.env.TMPDIR = originalTmp;
  rmSync(work, {recursive: true, force: true});
});
afterEach(() => {
  Object.assign(e, saved);
  geminiStatus = 200;
  geminiCalls = 0;
});

const run = async (strict: boolean | undefined) => {
  Object.assign(e, {GEMINI_API_KEY: 'offline', GROQ_API_KEY: 'offline', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false});
  const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
  return analyzeVideo({videoUrl: video, languageCode: 'en', userId: 'synthetic', requestedEdits: ['hook_title', 'zoom', 'cutaway'], directorV2: false, ...(strict ? {strictAiDirection: true} : {})});
};

describe('billing guard', () => {
  it('records only inside a guard, only for billing signals, and keeps the first one', async () => {
    noteBillingFailure('gemini', 402, 'x');
    expect(currentBillingBlock()).toBeNull();
    await runWithBillingGuard(async () => {
      noteBillingFailure('gemini', 500, 'upstream error');
      expect(currentBillingBlock()).toBeNull();
      noteBillingFailure('gemini', 402, 'first');
      noteBillingFailure('anthropic', undefined, 'Your credit balance is too low to access the Anthropic API');
      expect(currentBillingBlock()).toMatchObject({provider: 'gemini', status: 402, detail: 'first'});
    });
    expect(looksLikeBillingFailure(429, 'Your prepayment credits are depleted')).toBe(true);
    expect(looksLikeBillingFailure(429, 'rate limit, retry later')).toBe(false);
  });

  it('an EngineError carrying HTTP 402 is recorded as a Gemini billing block inside a guard', async () => {
    await runWithBillingGuard(async () => {
      void new EngineError('broll_failed', 'Gemini visual director failed (HTTP 402)', {status: 402, detail: 'prepayment credits are depleted'});
      expect(currentBillingBlock()).toMatchObject({provider: 'gemini', status: 402});
    });
  });

  it('two concurrent guarded runs do not see each other\'s blocks', async () => {
    const [a, b] = await Promise.all([
      runWithBillingGuard(async () => {
        noteBillingFailure('gemini', 402, 'a');
        await new Promise(resolve => setTimeout(resolve, 10));
        return currentBillingBlock()?.detail;
      }),
      runWithBillingGuard(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return currentBillingBlock()?.detail;
      }),
    ]);
    expect(a).toBe('a');
    expect(b).toBeUndefined();
  });
});

describe('strictAiDirection through the real pipeline', () => {
  it('HTTP 402 stops the run with billing_blocked and the exact blocker; no plan is produced', async () => {
    geminiStatus = 402;
    const error = await run(true).then(() => null, (reason: unknown) => reason as EngineError);
    expect(error).toBeInstanceOf(EngineError);
    expect(error!.code).toBe('billing_blocked');
    expect(error!.status).toBe(402);
    expect(error!.message).toContain('No deterministic plan was substituted');
    expect(error!.details).toMatchObject({status: 402, provider: 'gemini'});
  }, 60_000);

  it('control: the SAME 402 without the strict flag still degrades to the deterministic plan, exactly as before', async () => {
    geminiStatus = 402;
    const blueprint = await run(undefined);
    expect(blueprint.hookTitle).toBeTruthy();
    expect(geminiCalls).toBeGreaterThan(0);
  }, 60_000);

  it('a non-billing Director failure also stops a strict run (a fallback plan is never an AI edit)', async () => {
    geminiStatus = 500;
    const error = await run(true).then(() => null, (reason: unknown) => reason as EngineError);
    expect(error).toBeInstanceOf(EngineError);
    expect(['broll_failed', 'billing_blocked']).toContain(error!.code);
    expect(error!.message).toMatch(/Director did not run|billing/);
  }, 120_000);

  it('a healthy Director passes a strict run (no false positive)', async () => {
    const blueprint = await run(true);
    expect(blueprint.hookTitle).toBe('Silence Speaks');
  }, 60_000);
});
