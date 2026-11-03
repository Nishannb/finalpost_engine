/**
 * Phase 35 preflight: how a strict AI-directed run behaves when CLAUDE (the motion worker) or the motion Director fails.
 * Mocked providers only: Claude goes through the real Anthropic SDK with a stubbed `fetch` (so the error text is the SDK's own), Gemini through a stubbed
 * global `fetch`. Nothing reaches the network.
 */
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {currentBillingBlock, runWithBillingGuard} from '../lib/billingGuard.ts';
import {EngineError} from '../lib/errors.ts';
import {assertNoBillingBlock} from '../pipeline/analyzeVideo.ts';
import {anthropicGenerator} from '../motionWorker/worker.ts';
import {runMotionGraphicsStage} from '../stages/motionDirector/index.ts';

const GRAPHIC = {id: 'g1', anchorWordIndex: 0, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen', contentJson: '{"title":"x"}'};
const words = Array.from({length: 40}, (_, i) => ({text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4}));
const input = {transcript: 't', words, outputDurationSec: 20, languageCode: 'en', edit: {brollClips: [], visualOverlays: [], insetReveals: [], depthOverlays: [], mediaContainers: [], motionGraphics: [], semanticEmphasis: [], frameInsets: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0}};

const claudeError = (status: number, type: string, message: string) => async () => new Response(JSON.stringify({type: 'error', error: {type, message}}), {status, headers: {'content-type': 'application/json'}});
const stageWith = (respond: () => Promise<Response>) => {
  const client = new Anthropic({apiKey: 'offline', maxRetries: 0, fetch: respond as never});
  return runMotionGraphicsStage({...input, workerOptions: {upload: async () => 'staticFile:x.js', generator: anthropicGenerator({client}), maxRepairAttempts: 0}} as never);
};

afterEach(() => {
  delete process.env.MOTION_DIRECTOR_FIXTURE;
  vi.unstubAllGlobals();
});

const fixtureFile = join(mkdtempSync(join(tmpdir(), 'p35pre-')), 'director.json');
writeFileSync(fixtureFile, JSON.stringify({graphics: [GRAPHIC]}));
const withFixture = () => {
  process.env.MOTION_DIRECTOR_FIXTURE = fixtureFile;
};

describe('Claude (motion worker) billing failure in a strict run', () => {
  it('"credit balance is too low" (HTTP 400, the real Anthropic wording) is recorded as an anthropic billing block and stops the run at motion_graphics', async () => {
    withFixture();
    await runWithBillingGuard(async () => {
      const result = await stageWith(claudeError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'));
      expect(result.generatedGraphics).toHaveLength(0); // no AI graphic was produced
      expect(result.warnings.join(' ')).toMatch(/motion_dropped:g1/);
      expect(currentBillingBlock()).toMatchObject({provider: 'anthropic'});
      let thrown: unknown;
      try {
        assertNoBillingBlock(true, 'motion_graphics');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EngineError);
      const failure = thrown as EngineError;
      expect(failure.code).toBe('billing_blocked');
      expect(failure.message).toMatch(/motion_graphics/);
      expect(failure.message).toMatch(/anthropic billing is blocked/);
      expect(failure.message).toMatch(/No deterministic plan was substituted/);
      expect(failure.message).not.toMatch(/complete|success|ready/i);
      expect(failure.details).toMatchObject({stage: 'motion_graphics', provider: 'anthropic'});
    });
  });

  it('an HTTP 402 from Claude (billing_error) is also a billing block', async () => {
    withFixture();
    await runWithBillingGuard(async () => {
      await stageWith(claudeError(402, 'billing_error', 'There is a billing issue with your account.'));
      expect(currentBillingBlock()).toMatchObject({provider: 'anthropic'});
    });
  });

  it('a non-billing Claude failure (HTTP 500) records NO billing block, and still yields no AI graphic (characterised, see report)', async () => {
    withFixture();
    await runWithBillingGuard(async () => {
      const result = await stageWith(claudeError(500, 'api_error', 'Internal server error'));
      expect(result.generatedGraphics).toHaveLength(0);
      expect(result.warnings.join(' ')).toMatch(/motion_dropped:g1/);
      expect(currentBillingBlock()).toBeNull();
      expect(() => assertNoBillingBlock(true, 'motion_graphics')).not.toThrow();
    });
  });

  it('non-strict: the same Claude billing failure outside a guard records nothing, throws nothing, and degrades as before', async () => {
    withFixture();
    const result = await stageWith(claudeError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'));
    expect(result.generatedGraphics).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/motion_dropped:g1/);
    expect(currentBillingBlock()).toBeNull();
    expect(() => assertNoBillingBlock(undefined, 'motion_graphics')).not.toThrow();
  });
});

describe('motion Director (Gemini) failure in a strict run', () => {
  const geminiFails = (status: number, message: string) =>
    vi.stubGlobal('fetch', async (url: string | URL) => {
      if (new URL(String(url)).hostname !== 'generativelanguage.googleapis.com') throw new Error('blocked outbound request');
      return new Response(JSON.stringify({error: {code: status, message}}), {status});
    });

  it('a Gemini HTTP 402 inside the motion Director is recorded and stops the run at motion_graphics', async () => {
    (env as Record<string, unknown>).GEMINI_API_KEY = 'offline';
    geminiFails(402, 'Your prepayment credits are depleted.');
    await runWithBillingGuard(async () => {
      const result = await runMotionGraphicsStage(input as never);
      expect(result.generatedGraphics).toHaveLength(0);
      expect(result.warnings).toContain('motion_director_failed');
      expect(currentBillingBlock()).toMatchObject({provider: 'gemini', status: 402});
      expect(() => assertNoBillingBlock(true, 'motion_graphics')).toThrow(/gemini billing is blocked \(HTTP 402\)/);
    });
  });

  it('a Gemini HTTP 500 inside the motion Director is swallowed by the stage even in a strict run (characterised, see report)', async () => {
    (env as Record<string, unknown>).GEMINI_API_KEY = 'offline';
    geminiFails(500, 'upstream error');
    await runWithBillingGuard(async () => {
      const result = await runMotionGraphicsStage(input as never);
      expect(result.warnings).toContain('motion_director_failed');
      expect(currentBillingBlock()).toBeNull();
    });
  });
});
