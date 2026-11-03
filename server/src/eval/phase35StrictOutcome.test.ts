/**
 * Phase 35 final gate: strict-run failure semantics for generated motion graphics.
 *
 * Mocked providers only. Claude goes through the real Anthropic SDK with a stubbed `fetch` (so errors carry the SDK's own text and classes) or through a
 * scripted generator; Gemini through a stubbed global `fetch`. The only real work is local and free: ffmpeg on a synthetic clip and the worker's real
 * one-frame Remotion render. Nothing reaches the network.
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';
import {currentBillingBlock, runWithBillingGuard} from '../lib/billingGuard.ts';
import {assessStrictMotion, enforceStrictMotion, strictDegradedWarnings, type StrictAssessment} from '../pipeline/strictOutcome.ts';
import {anthropicGenerator, type GenerateResponse} from '../motionWorker/worker.ts';
import {runMotionGraphicsStage} from '../stages/motionDirector/index.ts';

vi.mock('../storage/r2.ts', async importOriginal => ({...(await importOriginal<typeof import('../storage/r2.ts')>()), uploadSourceVideo: async () => ({publicUrl: 'staticFile:source.mp4', key: 'synthetic'})}));

const e = env as unknown as Record<string, unknown>;

// --- graphics ------------------------------------------------------------------------------------------------------------------------------------
const GOOD = `import {Box, Card, Counter, FitText, contentBox, sliceTop, type GraphicProps} from '@finalpost/motion';

type Content = {label: string; from: number; to: number};

export default function Graphic({width, height, safeArea, content}: GraphicProps<Content>) {
  const {label, from, to} = content!;
  const box = contentBox(width, height, safeArea, 12);
  const [top, bottom] = sliceTop(box, 0.6, 8);
  return (
    <Box {...box}>
      <Card width={box.width} height={box.height} variant="glass" padding={16}>
        <Counter from={from} to={to} width={top.width} height={top.height} prefix="$" suffix="M" />
        <FitText text={label} width={bottom.width} height={bottom.height} maxLines={1} />
      </Card>
    </Box>
  );
}
`;
const TYPE_ERROR = GOOD.replace('from={from}', 'start={from}'); // fails the typecheck
const RUNTIME_CRASH = GOOD.replace('const {label, from, to} = content!;', 'const {label, from, to} = content!;\n  const unit = (content as unknown as {unit: {symbol: string}}).unit.symbol;').replace('suffix="M"', 'suffix={unit}'); // compiles, throws while rendering
const reply = (source: string): GenerateResponse => ({text: `Here.\n\n\`\`\`tsx\n${source}\`\`\``, stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: {inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}});
const upload = async () => 'staticFile:x.js';

const graphic = (id: string, anchorWordIndex: number, extra: Record<string, unknown> = {}) => ({
  id,
  anchorWordIndex,
  durationSeconds: 3,
  reason: 'r',
  goal: 'g',
  visualDescription: 'v',
  placement: 'pip',
  box: {x: 0.55, y: 0.1, w: 0.4, h: 0.24},
  contentJson: JSON.stringify({label: 'Revenue', from: 2, to: 10}),
  ...extra,
});

let work: string;
let video: string;
const fixtures = {one: '', overlapping: '', malformed: ''};
const saved: Record<string, unknown> = {};
const KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'CONTENT_PROFILE_ENABLED', 'OCCUPANCY_CONTEXT_V2', 'HOOK_TITLE_POLICY', 'DIRECTOR_V2', 'NORTH_STAR', 'VISUAL_CONTEXT_V2', 'MOTION_GRAPHICS_ENABLED'];
const WORDS = Array.from({length: 40}, (_, i) => ({word: `word${i}.`, start: i * 0.5, end: i * 0.5 + 0.45}));
const ok = (text: string) => new Response(JSON.stringify({candidates: [{content: {parts: [{text}]}}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}}), {status: 200});
const DIRECTOR = {topic: 't', hook_title: 'Silence Speaks', hook_style: 'minimal', moments: [], caption: {}};
/** Status the MOTION Director's Gemini call answers with; 200 means "no Gemini motion call expected" (the fixture env serves the graphics). */
let motionGeminiStatus = 200;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'phase35-strictout-'));
  process.env.TMPDIR = join(work, 'tmp');
  execFileSync('mkdir', ['-p', process.env.TMPDIR]);
  video = join(work, 'source.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  const write = (name: string, graphics: unknown[]) => {
    const file = join(work, `${name}.json`);
    writeFileSync(file, JSON.stringify({graphics}));
    return file;
  };
  fixtures.one = write('one', [graphic('g1', 16)]);
  fixtures.overlapping = write('overlap', [graphic('g1', 16), graphic('g2', 17)]); // g2 overlaps g1 -> a placement refusal
  fixtures.malformed = write('malformed', [graphic('g1', 16), graphic('g2', 30, {contentJson: 'not json'})]);
  for (const key of KEYS) saved[key] = e[key];
  vi.stubGlobal('fetch', async (url: string | URL, init?: {body?: unknown}) => {
    const host = new URL(String(url)).hostname;
    if (host === 'api.groq.com') {
      return new Response(JSON.stringify({text: WORDS.map(word => word.word).join(' '), language: 'en', duration: 20, words: WORDS}), {status: 200});
    }
    if (host !== 'generativelanguage.googleapis.com') throw new Error(`blocked outbound request to ${host}`);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (body.includes('contentJson')) {
      return new Response(JSON.stringify({error: {code: motionGeminiStatus, message: motionGeminiStatus === 402 ? 'Your prepayment credits are depleted.' : 'upstream error'}}), {status: motionGeminiStatus});
    }
    if (body.includes('Vertical talking-head video frame')) return ok(JSON.stringify({x: 0.2, y: 0.1, w: 0.6, h: 0.7}));
    if (body.includes('planned overlay layout')) return ok('{"notes":""}');
    return ok(JSON.stringify(DIRECTOR));
  });
}, 120_000);
afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(work, {recursive: true, force: true});
});
afterEach(() => {
  Object.assign(e, saved);
  delete process.env.MOTION_DIRECTOR_FIXTURE;
  motionGeminiStatus = 200;
});

// --- helpers -------------------------------------------------------------------------------------------------------------------------------------
const anthropicClaude = (respond: () => Promise<Response>) => anthropicGenerator({client: new Anthropic({apiKey: 'offline', maxRetries: 0, fetch: respond as never})});
const claudeError = (status: number, type: string, message: string) => async () => new Response(JSON.stringify({type: 'error', error: {type, message}}), {status, headers: {'content-type': 'application/json'}});
const scripted = (...sources: string[]) => {
  let i = 0;
  return async () => reply(sources[Math.min(i++, sources.length - 1)]!);
};

const stageInput = {transcript: 't', words: WORDS.map(word => ({text: word.word, start: word.start, end: word.end})), outputDurationSec: 20, languageCode: 'en', edit: {brollClips: [], visualOverlays: [], insetReveals: [], depthOverlays: [], mediaContainers: [], motionGraphics: [], semanticEmphasis: [], frameInsets: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0}};
const stage = (fixture: string, generator: (r: never) => Promise<GenerateResponse>) => {
  process.env.MOTION_DIRECTOR_FIXTURE = fixture;
  return runMotionGraphicsStage({...stageInput, workerOptions: {upload, generator: generator as never, maxRepairAttempts: 0}} as never);
};
const fails = (assessment: StrictAssessment, atStage = 'motion_graphics') => {
  try {
    enforceStrictMotion(true, assessment, atStage);
  } catch (error) {
    return error as EngineError;
  }
  throw new Error('expected the strict assessment to fail');
};
/** A failed strict run must read as a failure: it names provider, stage, reason and graphic, and never claims completion. */
const expectFailureReport = (error: EngineError, expected: {provider: string; stage: string; kind: string; graphicId: string}) => {
  expect(error).toBeInstanceOf(EngineError);
  expect(error.code).toBe('ai_direction_failed');
  expect(error.message).toMatch(/FAILED/);
  expect(error.message).toMatch(/No blueprint was produced and no deterministic substitute was used/);
  expect(error.message).not.toMatch(/complete(d)?\b|success|ready|rendered/i);
  expect(error.details).toMatchObject({outcome: 'failed'});
  const first = (error.details as {failures: Array<Record<string, unknown>>}).failures[0]!;
  expect(first).toMatchObject(expected);
  expect(String(first.reason).length).toBeGreaterThan(0);
};

// --- stage-level cases ---------------------------------------------------------------------------------------------------------------------------
describe('strict outcomes: mocked failures at the motion stage', () => {
  it('SUCCESS: a valid graphic that renders is a successful strict run (no failures, no degradation)', async () => {
    const result = await stage(fixtures.one, scripted(GOOD));
    const assessment = assessStrictMotion(result);
    expect(assessment).toMatchObject({status: 'success', requested: ['g1'], delivered: ['g1'], failures: [], degraded: []});
    expect(enforceStrictMotion(true, assessment, 'motion_graphics')).toBe(assessment);
  }, 120_000);

  it('Claude HTTP 402 with unfamiliar wording: billing block recorded first (billing_blocked), and the assessment also fails with provider anthropic', async () => {
    await runWithBillingGuard(async () => {
      const result = await stage(fixtures.one, anthropicClaude(claudeError(402, 'billing_error', 'Account standing issue 7731.')) as never);
      expect(currentBillingBlock()).toMatchObject({provider: 'anthropic', status: 402});
      const assessment = assessStrictMotion(result);
      expect(assessment.status).toBe('failed');
      expectFailureReport(fails(assessment), {provider: 'anthropic', stage: 'motion_worker', kind: 'provider_error', graphicId: 'g1'});
    });
  });

  it('Claude HTTP 500: failed, provider anthropic, provider_error, graphic named (no billing block)', async () => {
    await runWithBillingGuard(async () => {
      const result = await stage(fixtures.one, anthropicClaude(claudeError(500, 'api_error', 'Internal server error')) as never);
      expect(currentBillingBlock()).toBeNull();
      expectFailureReport(fails(assessStrictMotion(result)), {provider: 'anthropic', stage: 'motion_worker', kind: 'provider_error', graphicId: 'g1'});
    });
  });

  it('invalid Claude-generated code (fails the typecheck): failed with generated_code_invalid, the typecheck error is the reason', async () => {
    const result = await stage(fixtures.one, scripted(TYPE_ERROR));
    const assessment = assessStrictMotion(result);
    expectFailureReport(fails(assessment), {provider: 'anthropic', stage: 'motion_worker', kind: 'generated_code_invalid', graphicId: 'g1'});
    expect(result.generatedGraphics).toHaveLength(0);
  }, 120_000);

  it('a reply with no code block is also generated_code_invalid', async () => {
    const result = await stage(fixtures.one, async () => ({...reply(''), text: 'Sorry, here is a description instead.'}));
    expectFailureReport(fails(assessStrictMotion(result)), {provider: 'anthropic', stage: 'motion_worker', kind: 'generated_code_invalid', graphicId: 'g1'});
  });

  it('code that compiles but crashes in the real one-frame render: failed with render_check_failed', async () => {
    const result = await stage(fixtures.one, scripted(RUNTIME_CRASH));
    const assessment = assessStrictMotion(result);
    expectFailureReport(fails(assessment), {provider: 'anthropic', stage: 'motion_worker', kind: 'render_check_failed', graphicId: 'g1'});
    expect(result.generatedGraphics).toHaveLength(0);
  }, 120_000);

  it('non-billing Gemini 500 in the motion Director: failed (director_failed, gemini, no graphic id), reason recorded', async () => {
    e.GEMINI_API_KEY = 'offline';
    motionGeminiStatus = 500;
    const result = await runMotionGraphicsStage(stageInput as never);
    expect(result.directorFailure?.reason).toMatch(/500|upstream/i);
    expectFailureReport(fails(assessStrictMotion(result)), {provider: 'gemini', stage: 'motion_director', kind: 'director_failed', graphicId: '*'});
  });

  it('Gemini HTTP 402 in the motion Director: recorded as a billing block, and the assessment also fails', async () => {
    e.GEMINI_API_KEY = 'offline';
    motionGeminiStatus = 402;
    await runWithBillingGuard(async () => {
      const result = await runMotionGraphicsStage(stageInput as never);
      expect(currentBillingBlock()).toMatchObject({provider: 'gemini', status: 402});
      expectFailureReport(fails(assessStrictMotion(result)), {provider: 'gemini', stage: 'motion_director', kind: 'director_failed', graphicId: '*'});
    });
  });

  it('REQUIRED omission: g2 lost to a placement refusal and nobody listed it optional, so the run fails closed', async () => {
    const result = await stage(fixtures.overlapping, scripted(GOOD));
    const assessment = assessStrictMotion(result);
    expect(assessment.status).toBe('failed');
    expect(assessment.delivered).toEqual(['g1']);
    expectFailureReport(fails(assessment), {provider: 'engine', stage: 'motion_director', kind: 'refused', graphicId: 'g2'});
  }, 120_000);

  it('OPTIONAL omission: the same g2, explicitly listed optional, is a degraded success that records what was omitted', async () => {
    const result = await stage(fixtures.overlapping, scripted(GOOD));
    const assessment = assessStrictMotion(result, {optionalIds: ['g2']});
    expect(assessment).toMatchObject({status: 'degraded', delivered: ['g1'], failures: []});
    expect(assessment.degraded).toEqual([expect.objectContaining({graphicId: 'g2', kind: 'refused', optional: true})]);
    expect(strictDegradedWarnings(assessment)).toEqual([expect.stringMatching(/^strict_degraded:g2:refused:overlaps graphic g1/)]);
  }, 120_000);

  it('"optional" never excuses a broken AI path: a provider error, invalid code or a malformed Director request for an optional graphic still fails', async () => {
    const claude500 = await stage(fixtures.one, anthropicClaude(claudeError(500, 'api_error', 'boom')) as never);
    expect(assessStrictMotion(claude500, {optionalIds: ['g1']}).status).toBe('failed');
    const invalid = await stage(fixtures.one, scripted(TYPE_ERROR));
    expect(assessStrictMotion(invalid, {optionalIds: ['g1']}).status).toBe('failed');
    const malformed = await stage(fixtures.malformed, scripted(GOOD));
    const assessment = assessStrictMotion(malformed, {optionalIds: ['g2']});
    expect(assessment.status).toBe('failed');
    expect(assessment.failures[0]).toMatchObject({graphicId: 'g2', kind: 'director_invalid', optional: false});
  }, 180_000);

  it('a graphic that survived the stage but is missing from the final plan is a conflict_validator failure (and excusable only when optional)', async () => {
    const result = await stage(fixtures.one, scripted(GOOD));
    const final = {generatedGraphicIds: new Set<string>(), behindSubjectTexts: []};
    expectFailureReport(fails(assessStrictMotion(result, {final}), 'conflict_validator'), {provider: 'engine', stage: 'conflict_validator', kind: 'conflict_dropped', graphicId: 'g1'});
    expect(assessStrictMotion(result, {final, optionalIds: ['g1']}).status).toBe('degraded');
  }, 120_000);
});

// --- real pipeline -------------------------------------------------------------------------------------------------------------------------------
const run = async (options: {strict: boolean; generator: (r: never) => Promise<GenerateResponse>; fixture?: string; optional?: string[]}) => {
  Object.assign(e, {GEMINI_API_KEY: 'offline', GROQ_API_KEY: 'offline', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', CONTENT_PROFILE_ENABLED: false, OCCUPANCY_CONTEXT_V2: false, HOOK_TITLE_POLICY: 'placeholder', DIRECTOR_V2: false, NORTH_STAR: false, VISUAL_CONTEXT_V2: false, MOTION_GRAPHICS_ENABLED: false});
  if (options.fixture) process.env.MOTION_DIRECTOR_FIXTURE = options.fixture;
  const {analyzeVideo} = await import('../pipeline/analyzeVideo.ts');
  return analyzeVideo({
    videoUrl: video,
    languageCode: 'en',
    userId: 'synthetic',
    requestedEdits: ['hook_title'],
    directorV2: false,
    generatedGraphicsEnabled: true,
    motionWorkerOptions: {upload, generator: options.generator as never, maxRepairAttempts: 0},
    ...(options.strict ? {strictAiDirection: true} : {}),
    ...(options.optional ? {strictOptionalGraphicIds: options.optional} : {}),
  });
};
const thrown = async (promise: Promise<unknown>) => promise.then(() => null, error => error as EngineError);

describe('strict vs non-strict through the real analyzeVideo (mocked providers)', () => {
  it('strict SUCCESS: the graphic is in the blueprint and the ledger says it rendered; no strict warnings', async () => {
    const blueprint = await run({strict: true, generator: scripted(GOOD), fixture: fixtures.one});
    expect(blueprint.generatedGraphics?.map(item => item.id)).toEqual(['g1']);
    expect((blueprint.stats as {warnings?: string[]}).warnings?.join(' ') ?? '').not.toMatch(/strict_degraded|motion_dropped/);
  }, 180_000);

  it('strict, Claude 500: the run FAILS (ai_direction_failed, anthropic, motion_graphics, g1); NON-strict with the same failure still completes without the graphic', async () => {
    const claude500 = () => anthropicClaude(claudeError(500, 'api_error', 'Internal server error'));
    const strict = await thrown(run({strict: true, generator: claude500() as never, fixture: fixtures.one}));
    expectFailureReport(strict!, {provider: 'anthropic', stage: 'motion_worker', kind: 'provider_error', graphicId: 'g1'});
    expect((strict!.details as {stage: string}).stage).toBe('motion_graphics');
    const lenient = await run({strict: false, generator: claude500() as never, fixture: fixtures.one});
    expect(lenient.generatedGraphics ?? []).toHaveLength(0);
    expect((lenient.stats as {warnings?: string[]}).warnings?.join(' ')).toMatch(/motion_dropped:g1/);
  }, 180_000);

  it('strict, invalid generated code: FAILS; non-strict drops the graphic and completes', async () => {
    const strict = await thrown(run({strict: true, generator: scripted(TYPE_ERROR) as never, fixture: fixtures.one}));
    expectFailureReport(strict!, {provider: 'anthropic', stage: 'motion_worker', kind: 'generated_code_invalid', graphicId: 'g1'});
    const lenient = await run({strict: false, generator: scripted(TYPE_ERROR) as never, fixture: fixtures.one});
    expect(lenient.generatedGraphics ?? []).toHaveLength(0);
  }, 180_000);

  it('strict, Claude 402 with unfamiliar wording: billing_blocked (anthropic) wins over the generic failure', async () => {
    const error = await thrown(run({strict: true, generator: anthropicClaude(claudeError(402, 'billing_error', 'Account standing issue 7731.')) as never, fixture: fixtures.one}));
    expect(error?.code).toBe('billing_blocked');
    expect(error?.details).toMatchObject({stage: 'motion_graphics', provider: 'anthropic'});
  }, 120_000);

  it('strict, Gemini 500 in the motion Director: FAILS (director_failed, gemini); NON-strict completes with motion_director_failed', async () => {
    motionGeminiStatus = 500;
    const strict = await thrown(run({strict: true, generator: scripted(GOOD) as never}));
    expectFailureReport(strict!, {provider: 'gemini', stage: 'motion_director', kind: 'director_failed', graphicId: '*'});
    const lenient = await run({strict: false, generator: scripted(GOOD) as never});
    expect(lenient.generatedGraphics ?? []).toHaveLength(0);
    expect((lenient.stats as {warnings?: string[]}).warnings).toContain('motion_director_failed');
  }, 180_000);

  it('strict, Gemini 402 in the motion Director: billing_blocked (gemini, HTTP 402)', async () => {
    motionGeminiStatus = 402;
    const error = await thrown(run({strict: true, generator: scripted(GOOD) as never}));
    expect(error?.code).toBe('billing_blocked');
    expect(error?.details).toMatchObject({stage: 'motion_graphics', provider: 'gemini', status: 402});
  }, 120_000);

  it('strict, REQUIRED omission (placement refusal): FAILS; non-strict completes with the one graphic that fit', async () => {
    const strict = await thrown(run({strict: true, generator: scripted(GOOD) as never, fixture: fixtures.overlapping}));
    expectFailureReport(strict!, {provider: 'engine', stage: 'motion_director', kind: 'refused', graphicId: 'g2'});
    const lenient = await run({strict: false, generator: scripted(GOOD) as never, fixture: fixtures.overlapping});
    expect(lenient.generatedGraphics?.map(item => item.id)).toEqual(['g1']);
  }, 180_000);

  it('strict, OPTIONAL omission: degraded success, the blueprint carries a strict_degraded warning naming the graphic', async () => {
    const blueprint = await run({strict: true, generator: scripted(GOOD) as never, fixture: fixtures.overlapping, optional: ['g2']});
    expect(blueprint.generatedGraphics?.map(item => item.id)).toEqual(['g1']);
    expect((blueprint.stats as {warnings?: string[]}).warnings?.join(' ')).toMatch(/strict_degraded:g2:refused/);
  }, 180_000);
});
