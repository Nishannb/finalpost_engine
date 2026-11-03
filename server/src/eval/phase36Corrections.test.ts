/**
 * Phase 36C regression tests: Claude budget under concurrency, shared stop, output-directory claim, preflight, early strict checks.
 * Fake transports and temporary directories only. Imports nothing that loads .env, the logger or a provider SDK.
 */
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {afterAll, describe, expect, it} from 'vitest';

import {createClaudeBudget, createMeteredGenerator} from '../lib/claudeBudget.ts';
import {claimOutputDir, OutputDirExistsError} from '../lib/claimOutputDir.ts';
import {preflightExperiment, type PreflightFacts} from '../lib/experimentPreflight.ts';
import {createSpendGuard} from '../lib/spendGuard.ts';
import {assertStrictDirectorDeliverables, assertStrictOpeningAccepted} from '../pipeline/strictOutcome.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(here, relative), 'utf8');

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

const OUT = 1e-5; // $10 per million output tokens
const newBudget = (over: Partial<Parameters<typeof createClaudeBudget>[0]> = {}) => {
  const stops: string[] = [];
  let stopped = false;
  const budget = createClaudeBudget({
    capUsd: 0.25, maxRequests: 4, outputUsdPerToken: OUT, maxTokensPerCall: 12_000, minTokensPerCall: 4_000,
    isStopped: () => stopped, stop: reason => { stopped = true; stops.push(reason); }, ...over,
  });
  return {budget, stops, setStopped: () => { stopped = true; }};
};

describe('Claude budget: overlapping reservations (F1)', () => {
  it('three overlapping calls cannot together reserve more than the cap: the third is refused and the sum never exceeds it', () => {
    const {budget, stops} = newBudget();
    const first = budget.reserve(0.02);
    const second = budget.reserve(0.02);
    const third = budget.reserve(0.02);
    expect(first.ok && first.reservation.maxTokens).toBe(12_000);
    const secondTokens = second.ok ? second.reservation.maxTokens : 0;
    expect(secondTokens).toBeGreaterThanOrEqual(8_990); // (0.25 - 0.14 - 0.02) / 1e-5, up to float rounding
    expect(secondTokens).toBeLessThanOrEqual(9_000);
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.reason).toBe('budget_exhausted');
    expect(budget.report().reservedUsd).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(stops).toHaveLength(1);
  });

  it('five callers racing for the last slots: exactly maxRequests are granted', async () => {
    const {budget} = newBudget({maxRequests: 2, capUsd: 10});
    const results = await Promise.all(Array.from({length: 5}, async () => budget.reserve(0.01)));
    expect(results.filter(result => result.ok)).toHaveLength(2);
    const refused = results.filter(result => !result.ok).map(result => (result.ok ? '' : result.reason));
    expect(refused).toHaveLength(3);
    expect(refused[0]).toBe('request_cap'); // the first refusal sets the shared stop; the later ones are refused as stopped
    expect(refused.slice(1)).toEqual(['stopped', 'stopped']);
  });

  it('commit swaps the reservation for the real cost and frees the difference for the next call', () => {
    const {budget} = newBudget();
    const a = budget.reserve(0.02);
    if (!a.ok) throw new Error('unreachable');
    budget.commit(a.reservation, 0.04);
    expect(budget.report()).toMatchObject({committedUsd: 0.04, reservedUsd: 0, openReservations: 0});
    const b = budget.reserve(0.02);
    expect(b.ok && b.reservation.maxTokens).toBe(12_000);
    budget.commit(a.reservation, 0.04); // settling twice changes nothing
    expect(budget.report().committedUsd).toBe(0.04);
  });

  it('failure before dispatch releases the money AND the slot; failure after dispatch keeps the full reservation as spent and the slot used', () => {
    const {budget} = newBudget({maxRequests: 1});
    const a = budget.reserve(0.02);
    if (!a.ok) throw new Error('unreachable');
    budget.fail(a.reservation, {dispatched: false});
    expect(budget.report()).toMatchObject({requests: 0, committedUsd: 0, reservedUsd: 0});
    const b = budget.reserve(0.02);
    if (!b.ok) throw new Error('unreachable');
    budget.fail(b.reservation, {dispatched: true});
    expect(budget.report().requests).toBe(1);
    expect(budget.report().committedUsd).toBeCloseTo(b.reservation.reservedUsd, 9);
    const c = budget.reserve(0.02);
    expect(c.ok === false && c.reason).toBe('request_cap');
  });

  it('unknown or non-finite price, estimate or cap fails closed before dispatch', () => {
    for (const [name, make, input] of [
      ['NaN input estimate', () => newBudget(), Number.NaN],
      ['negative input estimate', () => newBudget(), -1],
      ['zero output price', () => newBudget({outputUsdPerToken: 0}), 0.01],
      ['NaN output price', () => newBudget({outputUsdPerToken: Number.NaN}), 0.01],
      ['NaN cap', () => newBudget({capUsd: Number.NaN}), 0.01],
    ] as const) {
      const {budget, stops} = make();
      const result = budget.reserve(input);
      expect(result.ok, name).toBe(false);
      expect(result.ok === false && result.reason, name).toBe('unknown_cost');
      expect(stops, name).toHaveLength(1);
      expect(budget.report().requests, name).toBe(0);
    }
  });

  it('a non-finite reported cost is charged as the full reservation; reaching the cap stops everything', () => {
    const {budget, stops} = newBudget({capUsd: 0.1});
    const a = budget.reserve(0.01);
    if (!a.ok) throw new Error('unreachable');
    budget.commit(a.reservation, Number.NaN);
    expect(budget.report().committedUsd).toBeCloseTo(a.reservation.reservedUsd, 9);
    expect(stops.join()).toMatch(/spend cap reached/);
    expect(budget.reserve(0.01).ok).toBe(false);
  });

  it('an existing billing stop refuses the reservation without consuming a slot', () => {
    const {budget, setStopped} = newBudget();
    setStopped();
    const result = budget.reserve(0.01);
    expect(result.ok === false && result.reason).toBe('stopped');
    expect(budget.report().requests).toBe(0);
  });
});

describe('metered Claude generator with a fake transport', () => {
  const make = (over: Partial<Parameters<typeof createClaudeBudget>[0]> = {}) => {
    const state = newBudget(over);
    const calls: Array<Record<string, unknown>> = [];
    let dispatched = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: Array<ReturnType<typeof deferred<{model: string; cost: number}>>> = [];
    const seenMax: number[] = [];
    const metered = createMeteredGenerator<{n: number}, {model: string; cost: number}>({
      budget: state.budget, calls, dispatchedCount: () => dispatched, inputUsdUpperOf: () => 0.02,
      generate: async (_request, maxTokens) => {
        dispatched += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); seenMax.push(maxTokens);
        const gate = deferred<{model: string; cost: number}>();
        gates.push(gate);
        try { return await gate.promise; } finally { inFlight -= 1; }
      },
      costOf: result => result.cost, describe: result => ({model: result.model}),
    });
    return {...state, metered, calls, gates, seenMax, get dispatched() { return dispatched; }, get maxInFlight() { return maxInFlight; }, bumpDispatch: () => { dispatched += 1; }};
  };

  it('four simultaneous graphics: calls run one at a time, never more than maxRequests are dispatched, the rest are refused with no dispatch', async () => {
    const t = make({maxRequests: 2, capUsd: 10});
    const runs = [1, 2, 3, 4].map(n => t.metered({n}).then(() => 'ok', () => 'refused'));
    await tick();
    expect(t.dispatched).toBe(1);
    t.gates[0]!.resolve({model: 'm', cost: 0.03});
    await tick(); await tick();
    expect(t.dispatched).toBe(2);
    t.gates[1]!.resolve({model: 'm', cost: 0.03});
    expect(await Promise.all(runs)).toEqual(['ok', 'ok', 'refused', 'refused']);
    expect(t.dispatched).toBe(2);
    expect(t.maxInFlight).toBe(1);
    expect(t.calls.filter(call => call.refused)).toHaveLength(2);
    expect(t.stops.length).toBeGreaterThan(0);
  });

  it('later calls see the REAL spend of earlier ones (max_tokens shrinks as money is committed)', async () => {
    const t = make({capUsd: 0.25});
    const runs = [1, 2].map(n => t.metered({n}));
    await tick();
    t.gates[0]!.resolve({model: 'm', cost: 0.12});
    await tick(); await tick();
    t.gates[1]!.resolve({model: 'm', cost: 0.01});
    await Promise.all(runs);
    expect(t.seenMax[0]).toBe(12_000);
    expect(t.seenMax[1]).toBeGreaterThanOrEqual(10_990); // (0.25 - 0.12 - 0.02) / 1e-5, up to float rounding
    expect(t.seenMax[1]).toBeLessThanOrEqual(11_000);
  });

  it('a billing stop that arrives while calls are queued prevents their dispatch (in-flight work is not cancelled)', async () => {
    const t = make({capUsd: 10});
    const runs = [1, 2, 3].map(n => t.metered({n}).then(() => 'ok', () => 'refused'));
    await tick();
    expect(t.dispatched).toBe(1);
    t.setStopped(); // e.g. a 402 on another host
    t.gates[0]!.resolve({model: 'm', cost: 0.01});
    expect(await Promise.all(runs)).toEqual(['ok', 'refused', 'refused']);
    expect(t.dispatched).toBe(1);
  });

  it('timeout or abort AFTER dispatch keeps the reservation as spent; a failure BEFORE dispatch frees it', async () => {
    const t = make({capUsd: 10, maxRequests: 2});
    const timed = t.metered({n: 1}).then(() => 'ok', error => (error as Error).name);
    await tick();
    t.gates[0]!.reject(Object.assign(new Error('aborted'), {name: 'AbortError'}));
    expect(await timed).toBe('AbortError');
    expect(t.budget.report().committedUsd).toBeGreaterThan(0);
    expect(t.budget.report().requests).toBe(1);

    const after = createMeteredGenerator<{n: number}, {model: string}>({
      budget: t.budget, calls: [], dispatchedCount: () => 0, inputUsdUpperOf: () => 0.02,
      generate: async () => { throw new Error('client could not be built'); }, // nothing was forwarded
      costOf: () => 0, describe: () => ({}),
    });
    const committedBefore = t.budget.report().committedUsd;
    await after({n: 2}).catch(() => undefined);
    expect(t.budget.report().requests).toBe(1);
    expect(t.budget.report().committedUsd).toBe(committedBefore);
    expect(t.budget.report().reservedUsd).toBe(0);
  });

  it('a call that completes past the cap stops the budget so no further call is dispatched', async () => {
    const t = make({capUsd: 0.2});
    const runs = [1, 2].map(n => t.metered({n}).then(() => 'ok', () => 'refused'));
    await tick();
    t.gates[0]!.resolve({model: 'm', cost: 0.2});
    expect(await Promise.all(runs)).toEqual(['ok', 'refused']);
    expect(t.dispatched).toBe(1);
    expect(t.stops.join()).toMatch(/spend cap reached/);
  });
});

describe('spend guard under concurrent callers (fake transport)', () => {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent';
  const CLAUDE = 'https://api.anthropic.com/v1/messages';
  const harness = (caps: Record<string, number>) => {
    const sent: Array<{url: string; body: string}> = [];
    const pending: Array<ReturnType<typeof deferred<Response>>> = [];
    let respond: (index: number) => Promise<Response> | Response = () => new Response('{}', {status: 200});
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      sent.push({url: String(url), body: String(init?.body ?? '')});
      return respond(sent.length - 1);
    }) as typeof fetch;
    const guard = createSpendGuard({fetchImpl, geminiCapUsd: 1, maxRequestsPerHost: caps});
    return {guard, sent, pending, setRespond: (fn: typeof respond) => { respond = fn; }};
  };
  const post = (guard: ReturnType<typeof createSpendGuard>, url: string, body: string) => guard.fetch(url, {method: 'POST', body}).then(() => 'sent', (error: {code?: string}) => error.code ?? 'error');

  it('concurrent duplicate bodies: exactly one is dispatched, the others are refused as repeats', async () => {
    const h = harness({'generativelanguage.googleapis.com': 10});
    const results = await Promise.all(Array.from({length: 4}, () => post(h.guard, GEMINI, '{"same":1}')));
    expect(results.filter(r => r === 'sent')).toHaveLength(1);
    expect(results.filter(r => r === 'repeat_refused')).toHaveLength(3);
    expect(h.sent).toHaveLength(1);
  });

  it('concurrent DISTINCT bodies are not blocked by the duplicate rule, and the per-host cap holds exactly', async () => {
    const h = harness({'api.anthropic.com': 3});
    const results = await Promise.all(Array.from({length: 7}, (_, i) => post(h.guard, CLAUDE, `{"n":${i}}`)));
    expect(results.filter(r => r === 'sent')).toHaveLength(3);
    expect(results.filter(r => r === 'host_cap')).toHaveLength(4);
    expect(h.sent).toHaveLength(3);
  });

  it('retries (same body or changed body) all draw on the same per-host budget', async () => {
    const h = harness({'generativelanguage.googleapis.com': 3});
    expect(await post(h.guard, GEMINI, '{"a":1}')).toBe('sent');
    expect(await post(h.guard, GEMINI, '{"a":1}')).toBe('repeat_refused');
    expect(await post(h.guard, GEMINI, '{"a":1,"thinking":0}')).toBe('sent');
    expect(await post(h.guard, GEMINI, '{"a":2}')).toBe('sent');
    expect(await post(h.guard, GEMINI, '{"a":3}')).toBe('host_cap');
    expect(h.sent).toHaveLength(3);
  });

  it('a 402 arriving while other requests are pending: nothing NEW is dispatched to any host, requests already in flight still complete', async () => {
    const h = harness({'generativelanguage.googleapis.com': 10, 'api.anthropic.com': 10, 'api.groq.com': 2});
    const slow = [deferred<Response>(), deferred<Response>()];
    h.setRespond(index => (index < 2 ? slow[index]!.promise : new Response('{"error":{"message":"credits depleted"}}', {status: 402})));
    const a = post(h.guard, CLAUDE, '{"n":"a"}');
    const b = post(h.guard, CLAUDE, '{"n":"b"}');
    await tick();
    expect(await post(h.guard, GEMINI, '{"n":"c"}')).toBe('sent'); // answered 402 -> terminal stop
    expect(h.guard.isStopped()).toBe(true);
    expect(await post(h.guard, GEMINI, '{"n":"d"}')).toBe('billing_stop');
    expect(await post(h.guard, CLAUDE, '{"n":"e"}')).toBe('billing_stop');
    expect(await post(h.guard, 'https://api.groq.com/openai/v1/audio/transcriptions', '{"n":"f"}')).toBe('billing_stop');
    expect(h.sent).toHaveLength(3);
    slow[0]!.resolve(new Response('{}', {status: 200}));
    slow[1]!.resolve(new Response('{}', {status: 200}));
    expect(await Promise.all([a, b])).toEqual(['sent', 'sent']); // honest: the guard cannot recall what the provider already accepted
    expect(h.sent).toHaveLength(3);
  });

  it('guard.stop() from the Claude meter blocks every host, and isStopped() reports it', async () => {
    const h = harness({'generativelanguage.googleapis.com': 10, 'api.anthropic.com': 10});
    expect(h.guard.isStopped()).toBe(false);
    h.guard.stop('anthropic spend cap reached');
    expect(h.guard.isStopped()).toBe(true);
    expect(await post(h.guard, GEMINI, '{"x":1}')).toBe('billing_stop');
    expect(h.sent).toHaveLength(0);
  });
});

describe('output directory claim (F3)', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p36c-claim-'));
  afterAll(() => rmSync(root, {recursive: true, force: true}));

  it('a destination that does not exist is created (parents included)', () => {
    const dir = path.join(root, 'new', 'run-1');
    expect(claimOutputDir(dir)).toBe(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it('an existing EMPTY directory is refused and left as it was', () => {
    const dir = path.join(root, 'empty');
    mkdirSync(dir);
    expect(() => claimOutputDir(dir)).toThrow(OutputDirExistsError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a directory with stale artifacts is refused with no modification', () => {
    const dir = path.join(root, 'stale');
    mkdirSync(path.join(dir, 'director'), {recursive: true});
    writeFileSync(path.join(dir, 'experiment-report.json'), '{"old":true}');
    writeFileSync(path.join(dir, 'edited_phase36.mp4'), 'old video');
    const before = JSON.stringify([readdirSync(dir).sort(), statSync(path.join(dir, 'experiment-report.json')).mtimeMs, readFileSync(path.join(dir, 'edited_phase36.mp4'), 'utf8')]);
    expect(() => claimOutputDir(dir)).toThrow(/Choose a NEW, unique destination/);
    expect(JSON.stringify([readdirSync(dir).sort(), statSync(path.join(dir, 'experiment-report.json')).mtimeMs, readFileSync(path.join(dir, 'edited_phase36.mp4'), 'utf8')])).toBe(before);
  });

  it('an existing FILE at the path is refused', () => {
    const file = path.join(root, 'a-file');
    writeFileSync(file, 'x');
    expect(() => claimOutputDir(file)).toThrow(OutputDirExistsError);
    expect(readFileSync(file, 'utf8')).toBe('x');
  });

  it('racing processes: of six that claim the same path at once, exactly one succeeds', async () => {
    const target = path.join(root, 'race', 'run');
    const moduleUrl = pathToFileURL(path.resolve(here, '../lib/claimOutputDir.ts')).href;
    const code = `import {claimOutputDir} from ${JSON.stringify(moduleUrl)}; try { claimOutputDir(${JSON.stringify(target)}); process.exit(0); } catch (e) { process.exit(e.name === 'OutputDirExistsError' ? 3 : 4); }`;
    const codes = await Promise.all(Array.from({length: 6}, () => new Promise<number>(resolve => {
      const child = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', code], {stdio: 'ignore'});
      child.on('exit', exit => resolve(exit ?? -1));
    })));
    expect(codes.filter(c => c === 0)).toHaveLength(1);
    expect(codes.filter(c => c === 3)).toHaveLength(5);
  });
});

describe('preflight (no provider call)', () => {
  const good = (): PreflightFacts => ({
    keysPresent: {GEMINI_API_KEY: true, GROQ_API_KEY: true, ANTHROPIC_API_KEY: true},
    caps: {geminiUsd: 0.05, claudeUsd: 0.25, geminiRequests: 10, claudeRequests: 4, groqRequests: 2},
    claudePricePerToken: {input: 2e-6, output: 1e-5}, claudeModel: 'claude-sonnet-5-5',
    source: {exists: true, bytes: 1e6, hasAudio: true, durationSec: 41.7, maxDurationSec: 180}, requestedEdits: ['zoom'], minGeminiRequestsNeeded: 4,
  });
  it('accepts a complete configuration', () => expect(preflightExperiment(good())).toEqual({ok: true, problems: []}));
  it.each([
    ['missing key', (f: PreflightFacts) => { f.keysPresent.ANTHROPIC_API_KEY = false; }, /ANTHROPIC_API_KEY is not set/],
    ['no audio', (f: PreflightFacts) => { f.source.hasAudio = false; }, /no audio/],
    ['too long', (f: PreflightFacts) => { f.source.durationSec = 999; }, /limit is 180/],
    ['missing source', (f: PreflightFacts) => { f.source.exists = false; }, /missing or empty/],
    ['zero cap', (f: PreflightFacts) => { f.caps.claudeUsd = 0; }, /claudeUsd must be a positive/],
    ['NaN cap', (f: PreflightFacts) => { f.caps.geminiUsd = Number.NaN; }, /geminiUsd must be a positive/],
    ['Gemini cap below the pipeline minimum', (f: PreflightFacts) => { f.caps.geminiRequests = 2; }, /below the 4/],
    ['unpriced Claude model', (f: PreflightFacts) => { f.claudePricePerToken = null; }, /no usable price/],
  ])('refuses: %s', (_name, mutate, pattern) => {
    const facts = good();
    mutate(facts);
    const result = preflightExperiment(facts);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(pattern);
  });
});

describe('strict deliverables are checked before the paid motion stage (F4)', () => {
  it('outside a strict run nothing is raised', () => {
    expect(() => assertStrictDirectorDeliverables(false, {openingRequested: true, openingPlanPresent: false, fallbackSubstitutions: ['moments']})).not.toThrow();
    expect(() => assertStrictOpeningAccepted(undefined, {accepted: false, rejection: 'x'})).not.toThrow();
  });
  it('a strict run with deterministic substitution stops with the substituted parts named', () => {
    expect(() => assertStrictDirectorDeliverables(true, {openingRequested: false, openingPlanPresent: false, fallbackSubstitutions: ['zoom', 'emphasis']})).toThrow(/deterministic_substitution.*zoom, emphasis/);
  });
  it('a strict run that asked for an opening but got no plan stops', () => {
    expect(() => assertStrictDirectorDeliverables(true, {openingRequested: true, openingPlanPresent: false})).toThrow(/opening_missing/);
    expect(() => assertStrictDirectorDeliverables(true, {openingRequested: true, openingPlanPresent: true, fallbackSubstitutions: []})).not.toThrow();
    expect(() => assertStrictDirectorDeliverables(true, {openingRequested: false, openingPlanPresent: false})).not.toThrow();
  });
  it('a rejected opening stops a strict run; an accepted one does not', () => {
    expect(() => assertStrictOpeningAccepted(true, {accepted: false, rejection: 'no_clear_band_above_the_face'})).toThrow(/opening_rejected \(no_clear_band_above_the_face\)/);
    expect(() => assertStrictOpeningAccepted(true, {accepted: true})).not.toThrow();
  });
  it('analyzeVideo wires both checks before the motion stage dispatches anything', () => {
    const source = read('../pipeline/analyzeVideo.ts');
    const motion = source.indexOf('motion = await runMotionGraphicsStage(');
    expect(motion).toBeGreaterThan(0);
    for (const needle of ['assertDirectorRan(input.strictAiDirection, broll)', 'assertStrictDirectorDeliverables(input.strictAiDirection', 'assertStrictOpeningAccepted(input.strictAiDirection']) {
      const at = source.indexOf(needle);
      expect(at, needle).toBeGreaterThan(0);
      expect(at, needle).toBeLessThan(motion);
    }
    expect(source.indexOf('assertStrictDirectorDeliverables(input.strictAiDirection')).toBeGreaterThan(source.indexOf('assertDirectorRan(input.strictAiDirection, broll)'));
  });
});

describe('runner wiring (static)', () => {
  const runner = readFileSync(path.resolve(here, '../../../remotion/out/phase36-readiness/run_experiment.ts'), 'utf8');
  it('order: approval gate, then the static preflight, then the atomic claim, then the full preflight, the dump dir and the spend guard', () => {
    // Phase 36E: the preflight is split. The part that needs no logger (`preflightStatic`) runs BEFORE the claim; the part that needs the worker's price table and an
    // ffprobe of the source (`preflightExperiment`) runs AFTER it, once logging is directed into the run. The earlier assertion (full preflight before the claim) described
    // the 36C layout and no longer holds; this one proves the new ordering property. The wider ordering is asserted in phase36Isolation.test.ts.
    const at = (needle: string) => { const i = runner.indexOf(needle); expect(i, needle).toBeGreaterThan(0); return i; };
    const gate = at("process.env.P36_APPROVED !== 'yes'");
    const staticPreflight = at('preflightStatic({');
    const claim = at('claimOutputDir(outDir)');
    const fullPreflight = at('preflightExperiment({');
    const dump = at('process.env.DIRECTOR_DUMP_DIR =');
    const guardInstall = at('globalThis.fetch = guard.fetch');
    const analyze = at('await analyzeVideo(');
    expect(gate).toBeLessThan(staticPreflight);
    expect(staticPreflight).toBeLessThan(claim);
    expect(claim).toBeLessThan(fullPreflight);
    expect(claim).toBeLessThan(dump);
    expect(claim).toBeLessThan(guardInstall);
    expect(guardInstall).toBeLessThan(analyze);
    expect(runner).not.toMatch(/mkdirSync\(outDir/);
  });
  it('Claude calls go through the budget, with no unreserved spend counter left', () => {
    expect(runner).toContain('createMeteredGenerator');
    expect(runner).toContain('createClaudeBudget');
    expect(runner).not.toMatch(/claudeSpent\s*\+=/);
    expect(runner).toContain('isStopped: guard.isStopped');
  });
});
