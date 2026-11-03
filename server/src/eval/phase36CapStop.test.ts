/**
 * Phase 36 safety correction: a spend-cap hit is a TERMINAL stop for every provider, not only the one that reached its cap (audit finding). Mocked `fetch`
 * only; `fetchImpl` counts every request that would have hit the network.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {createSpendGuard, SpendGuardError} from '../lib/spendGuard.ts';
import {judgeExperiment, type VerdictInput} from '../pipeline/experimentVerdict.ts';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent';
const CLAUDE = 'https://api.anthropic.com/v1/messages';
const GROQ = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CAPS = {'generativelanguage.googleapis.com': 10, 'api.anthropic.com': 4, 'api.groq.com': 2};

const rig = (promptTokens: number, outputTokens = 0, geminiCapUsd = 0.05) => {
  const sent: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    sent.push(String(url));
    return new Response(JSON.stringify({candidates: [{content: {parts: [{text: '{}'}]}}], usageMetadata: {promptTokenCount: promptTokens, candidatesTokenCount: outputTokens}}), {status: 200});
  }) as typeof fetch;
  return {sent, guard: createSpendGuard({fetchImpl, geminiCapUsd, maxRequestsPerHost: CAPS})};
};
const attempt = (guard: {fetch: typeof fetch}, url: string, body: string | FormData) => guard.fetch(url, {method: 'POST', body}).then(() => 'sent', (error: SpendGuardError) => error.code);

describe('a spend-cap hit stops ALL providers', () => {
  // 1,000,000 prompt tokens x $0.075/M = $0.075 > the $0.05 cap in ONE response.
  it('the audit finding: Gemini reaches its cap, then Claude and Groq are attempted: both are refused before any network request', async () => {
    const {sent, guard} = rig(1_000_000);
    expect(await attempt(guard, GEMINI, '{"call":1}')).toBe('sent'); // the cap-hit request itself completes and is accounted
    expect(sent).toHaveLength(1);
    const form = new FormData();
    form.append('file', new Blob(['x']), 'speech.ogg');
    expect(await attempt(guard, CLAUDE, '{"claude":1}')).toBe('billing_stop');
    expect(await attempt(guard, GROQ, form)).toBe('billing_stop');
    expect(await attempt(guard, GEMINI, '{"call":2}')).toBe('billing_stop');
    expect(sent).toHaveLength(1); // nothing else reached the network
    const report = guard.report();
    expect(report.refused.map(item => item.reason)).toEqual(['billing_stop', 'billing_stop', 'billing_stop']);
    expect(report.refused.map(item => item.host)).toEqual(['api.anthropic.com', 'api.groq.com', 'generativelanguage.googleapis.com']);
  });

  it('the cap-hit request is accounted exactly once and the stop names the cap as an estimate', async () => {
    const {guard} = rig(1_000_000, 100_000);
    await attempt(guard, GEMINI, '{"call":1}');
    const report = guard.report();
    expect(report.geminiUsd).toBeCloseTo(0.075 + 0.03, 6);
    expect(report.geminiTokens).toEqual({promptTokens: 1_000_000, outputTokens: 100_000});
    expect(report.requestsPerHost['generativelanguage.googleapis.com']).toBe(1);
    expect(report.billingStop).toMatch(/spend cap reached.*estimated/);
  });

  it('exactly at the cap counts as reached (>=); one token below does not stop anything', async () => {
    const at = rig(666_667, 0, 0.05); // 666,667 x 0.075/M = 0.05000003 >= 0.05
    await attempt(at.guard, GEMINI, '{"a":1}');
    expect(await attempt(at.guard, CLAUDE, '{"b":1}')).toBe('billing_stop');
    const below = rig(600_000, 0, 0.05); // 0.045
    await attempt(below.guard, GEMINI, '{"a":1}');
    expect(below.guard.report().billingStop).toBeNull();
    expect(await attempt(below.guard, CLAUDE, '{"b":1}')).toBe('sent');
    expect(await attempt(below.guard, GEMINI, '{"a":2}')).toBe('sent');
  });

  it('a caller that meters another provider can stop everything: guard.stop() (the runner does this at the Claude cap) blocks Gemini and Groq too, keeps the first reason, and is per instance', async () => {
    const {sent, guard} = rig(10);
    guard.stop('anthropic spend cap reached ($0.2500 of $0.25 estimated)');
    guard.stop('a later reason');
    expect(await attempt(guard, GEMINI, '{"a":1}')).toBe('billing_stop');
    expect(await attempt(guard, GROQ, '{"b":1}')).toBe('billing_stop');
    expect(sent).toHaveLength(0);
    expect(guard.report().billingStop).toBe('anthropic spend cap reached ($0.2500 of $0.25 estimated)');
    const independent = rig(10); // a new run builds a new guard: no state carries over
    expect(await attempt(independent.guard, GEMINI, '{"a":1}')).toBe('sent');
  });

  it('HTTP 402 still stops every host (existing behaviour preserved)', async () => {
    const sent: string[] = [];
    const guard = createSpendGuard({fetchImpl: (async (url: string | URL) => (sent.push(String(url)), new Response('{"error":{"message":"Your prepayment credits are depleted."}}', {status: 402}))) as typeof fetch, geminiCapUsd: 0.05, maxRequestsPerHost: CAPS});
    expect(await attempt(guard, GEMINI, '{"a":1}')).toBe('sent');
    expect(await attempt(guard, CLAUDE, '{"b":1}')).toBe('billing_stop');
    expect(await attempt(guard, GROQ, '{"c":1}')).toBe('billing_stop');
    expect(sent).toHaveLength(1);
  });

  it('the final verdict stays FAILED after a cap stop even when everything else (render, decode, ledger, opening) is perfect', () => {
    const base: VerdictInput = {
      blueprint: {width: 1080, height: 1920, outputDurationSec: 40, stats: {warnings: ['director_video_input:900000b', 'opening_treatment:plain']}, zoomTriggers: [{}], motionGraphics: [], semanticEmphasis: [], frameInsets: [], insetReveals: [], generatedGraphics: [], visualOverlays: []},
      ledger: {edits: [{type: 'zoom', final: {start: 1, end: 2}}], summary: {outcomes: {accepted_not_rendered: 0}}},
      outcomes: {fallbackSubstitutions: [], directorFallbackReason: null},
      output: {path: '/x.mp4', exists: true, bytes: 5_000_000, probe: {width: 1080, height: 1920, durationSec: 40.02, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 1200, decodedSec: 40, errors: []}},
      spend: {geminiUsd: 0.02, geminiCapUsd: 0.05, billingStop: null, refused: []},
      claudeSpentUsd: 0.1,
      claudeCapUsd: 0.25,
      expectAudio: true,
    };
    expect(judgeExperiment(base).status).toBe('success'); // control
    const capped = judgeExperiment({...base, spend: {...base.spend!, geminiUsd: 0.0501, billingStop: 'generativelanguage.googleapis.com spend cap reached ($0.0501 of $0.05 estimated)'}});
    expect(capped.status).toBe('failed');
    expect(capped.failures.map(item => item.code)).toContain('billing_stop');
    expect(judgeExperiment({...base, spend: {...base.spend!, billingStop: 'anthropic spend cap reached ($0.2500 of $0.25 estimated)'}}).status).toBe('failed');
  });

  it('the runner reports the Claude cap through the shared stop (source check) and still decides success only through the verdict', () => {
    const source = readFileSync(join(import.meta.dirname, '../../../remotion/out/phase36-readiness/run_experiment.ts'), 'utf8');
    // Phase 36C: the Claude meter moved into lib/claudeBudget.ts; the runner hands it the guard's shared stop, and the budget calls it on a cap reach or refusal.
    expect(source).toMatch(/stop: guard\.stop/);
    expect(source).toMatch(/isStopped: guard\.isStopped/);
    const budget = readFileSync(join(import.meta.dirname, '../lib/claudeBudget.ts'), 'utf8');
    expect(budget.match(/options\.stop\(/g)?.length).toBeGreaterThanOrEqual(3); // refusal, commit past the cap, failed dispatch past the cap
    expect(source).toMatch(/process\.exit\(verdict\.status === 'success' \? 0 : 1\)/);
  });
});
