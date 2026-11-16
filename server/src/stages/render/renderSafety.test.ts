/**
 * Phase SFX-3H: the production render boundary for generated-bed loudness. The REAL startRender / runRender (pipeline/renderRunner.ts),
 * startLambdaRender (stages/render/remotionLambda.ts) and renderLocally (stages/render/localRender.ts) are executed; only the outside world is stubbed:
 *   - @remotion/lambda/client renderMediaOnLambda: a spy (no AWS call); it must never be reached by a refused blueprint.
 *   - node:child_process spawn and prefetchAssets: spies; renderLocally must refuse before either.
 *   - the job store and the render budget: in-memory spies (no KV, no quota).
 * A static scan pins the call graph: these two functions are the only ones that hand a blueprint to Remotion.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {buildDuckEnvelope} from '../music/duckEnvelope.ts';
import {bedLoudnessRenderIssue} from './renderSafety.ts';

const spies = vi.hoisted(() => ({
  lambda: [] as unknown[],
  spawn: [] as unknown[],
  prefetch: 0,
  saved: [] as Array<{status: string; errorCode?: string}>,
  recorded: 0,
  blueprints: [] as unknown[],
}));

vi.mock('@remotion/lambda/client', () => ({
  renderMediaOnLambda: async (options: unknown) => {
    spies.lambda.push(options);
    return {bucketName: 'test-bucket', renderId: 'test-render', cloudWatchLogs: '', folderInS3Console: '', lambdaInsightsLogs: '', costs: {}};
  },
  getRenderProgress: async () => ({done: false}),
}));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      spies.spawn.push(args);
      throw new Error('spawn must not be reached in this test');
    },
  };
});
vi.mock('./prefetchAssets.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('./prefetchAssets.ts')>()),
  prefetchBlueprintMedia: async () => {
    spies.prefetch += 1;
    throw new Error('prefetch must not be reached in this test');
  },
}));
vi.mock('../../store/engineStore.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../store/engineStore.ts')>()),
  assertBlueprintAccess: async () => undefined,
  loadBlueprint: async () => spies.blueprints.shift() ?? null,
  saveRenderJob: async (job: {status: string; errorCode?: string}) => {
    spies.saved.push({status: job.status, ...(job.errorCode ? {errorCode: job.errorCode} : {})});
  },
  loadRenderJob: async () => null,
}));
vi.mock('./renderBudget.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('./renderBudget.ts')>()),
  assertRenderAllowed: async () => undefined,
  recordRender: async () => {
    spies.recorded += 1;
  },
}));

// ------------------------------------------------------------------------------------------------------------------- fixtures
const words = [{start: 0.5, end: 1.2}, {start: 3, end: 4}];
const duck = (bedLufs: unknown) => ({...buildDuckEnvelope({words, durationSec: 6, preset: 'talking', voLufs: -24, bedLufs: typeof bedLufs === 'number' && Number.isFinite(bedLufs) ? bedLufs : -23}), bedLufs});
function blueprint(bedLufs: unknown, provenance?: unknown, extra: Record<string, unknown> = {}) {
  return {
    blueprintId: 'bp_test',
    outputDurationSec: 6,
    sourceDurationSec: 6,
    audioDesign: {
      ducking: true,
      sfx: [],
      hits: [],
      musicSource: 'generated',
      musicUrl: 'https://bed.invalid/bed.wav',
      musicFullUrl: 'https://bed.invalid/bed.wav',
      voLufs: -24,
      duck: duck(bedLufs),
      ...(provenance === undefined ? {} : {musicProvenance: {source: 'generated', bedLoudness: provenance}}),
      ...extra,
    },
  } as never;
}
const measured = (lufs: number) => ({status: 'measured', lufs});
const STYLE = {captionTemplate: 'karaoke', trimEnabled: true} as never;
const audioOf = (bp: unknown) => (bp as {audioDesign: never}).audioDesign;

beforeEach(() => {
  spies.lambda.length = 0;
  spies.spawn.length = 0;
  spies.prefetch = 0;
  spies.saved.length = 0;
  spies.recorded = 0;
  spies.blueprints.length = 0;
  Object.assign(env as unknown as Record<string, unknown>, {REMOTION_FUNCTION_NAME: 'test-fn', REMOTION_SERVE_URL: 'https://serve.invalid/site', REMOTION_COMPOSITION_ID: 'ShortVideo'});
});

const REFUSED: Array<[string, unknown]> = [
  ['3. missing loudness', blueprint(undefined, measured(-23))],
  ['4. null', blueprint(null, measured(-23))],
  ['4. NaN', blueprint(Number.NaN, measured(-23))],
  ['4. Infinity', blueprint(Number.POSITIVE_INFINITY, measured(-23))],
  ['4. malformed (string)', blueprint('-23', measured(-23))],
  ['4. out of range (+5)', blueprint(5, measured(5))],
  ['4. out of range (-90)', blueprint(-90, measured(-90))],
  ['5. legacy -16 without provenance', blueprint(-16)],
  ['6. legacy -23 without provenance (compatibility decision: unverified, refused)', blueprint(-23)],
  ['provenance mismatch', blueprint(-16, measured(-23))],
  ['provenance with an untrusted status', blueprint(-16, {status: 'assumed', lufs: -16})],
];
const ACCEPTED: Array<[string, unknown]> = [
  ['1. measured -23 with provenance', blueprint(-23, measured(-23))],
  ['2. measured exactly -16 with provenance', blueprint(-16, measured(-16))],
  ['operator-attested -23', blueprint(-23, {status: 'operator_attested', lufs: -23})],
];

describe('the rule (renderSafety.bedLoudnessRenderIssue)', () => {
  it('refuses every unknown, invalid, legacy or inconsistent bed loudness, with its reason', () => {
    const codes = REFUSED.map(([, bp]) => bedLoudnessRenderIssue(audioOf(bp))?.code);
    expect(codes).toEqual(['bed_loudness_missing', 'bed_loudness_missing', 'bed_loudness_invalid', 'bed_loudness_invalid', 'bed_loudness_invalid', 'bed_loudness_invalid', 'bed_loudness_invalid', 'bed_loudness_unverified', 'bed_loudness_unverified', 'bed_loudness_provenance_mismatch', 'bed_loudness_provenance_invalid']);
  });
  it('accepts measured or attested values, including a genuine measured -16; ignores licensed, duck-less and absolute-preset beds', () => {
    for (const [, bp] of ACCEPTED) expect(bedLoudnessRenderIssue(audioOf(bp))).toBeNull();
    expect(bedLoudnessRenderIssue(audioOf(blueprint(-16, undefined, {musicSource: 'licensed'})))).toBeNull();
    expect(bedLoudnessRenderIssue({...audioOf<Record<string, unknown>>(blueprint(-16)), duck: undefined} as never)).toBeNull();
    expect(bedLoudnessRenderIssue(audioOf(blueprint(-16, undefined, {duck: {...duck(-16), preset: 'default'}})))).toBeNull();
    expect(bedLoudnessRenderIssue(undefined)).toBeNull();
  });
});

describe('boundary: startLambdaRender (every Lambda render)', () => {
  it('7-8. a refused blueprint never reaches renderMediaOnLambda', async () => {
    const {startLambdaRender} = await import('./remotionLambda.ts');
    for (const [label, bp] of REFUSED) {
      await expect(startLambdaRender({blueprint: bp, style: STYLE, renderJobId: 'rn_x'}), label).rejects.toThrow(/Refusing to render \(startLambdaRender\): unsafe_bed_loudness:/);
    }
    expect(spies.lambda).toHaveLength(0);
  });
  it('9. a valid measured bed (-23, or exactly -16) is sent unchanged', async () => {
    const {startLambdaRender} = await import('./remotionLambda.ts');
    for (const [, bp] of ACCEPTED) {
      const before = JSON.stringify(bp);
      await startLambdaRender({blueprint: bp, style: STYLE, renderJobId: 'rn_ok'});
      const sent = spies.lambda.at(-1) as {inputProps: {blueprint: unknown}};
      expect(JSON.stringify(sent.inputProps.blueprint)).toBe(before);
    }
    expect(spies.lambda).toHaveLength(ACCEPTED.length);
  });
});

describe('boundary: renderLocally (every local render: the job runner and every script)', () => {
  it('7-8. a refused blueprint throws before any prefetch, workspace or Remotion process', async () => {
    const {renderLocally} = await import('./localRender.ts');
    for (const [label, bp] of REFUSED) {
      await expect(renderLocally({blueprint: bp, style: STYLE, renderJobId: 'rn_local', sweepStaleScratch: false}), label).rejects.toThrow(/Refusing to render \(renderLocally\): unsafe_bed_loudness:/);
    }
    expect(spies.spawn).toHaveLength(0);
    expect(spies.prefetch).toBe(0);
  });
});

describe('boundary: startRender / runRender (the job API: render route, captions and template runners)', () => {
  it('7-8. a refused blueprint fails at startRender: no job, no quota, no render', async () => {
    const {startRender} = await import('../../pipeline/renderRunner.ts');
    for (const [label, bp] of REFUSED) {
      spies.blueprints.push(bp);
      await expect(startRender({userId: 'u', blueprintId: 'bp_test', style: STYLE}), label).rejects.toThrow(/Refusing to render \(startRender\)/);
    }
    expect(spies.saved).toHaveLength(0);
    expect(spies.recorded).toBe(0);
    expect(spies.lambda).toHaveLength(0);
  });
  it('a valid blueprint goes through to Lambda unchanged; a blueprint that turns unsafe before the render starts is stopped by the render function', async () => {
    const {startRender} = await import('../../pipeline/renderRunner.ts');
    const good = blueprint(-16, measured(-16));
    spies.blueprints.push(good, good);
    const job = await startRender({userId: 'u', blueprintId: 'bp_test', style: STYLE});
    await vi.waitFor(() => expect(spies.lambda).toHaveLength(1));
    expect(JSON.stringify((spies.lambda[0] as {inputProps: {blueprint: unknown}}).inputProps.blueprint)).toBe(JSON.stringify(good));
    expect(job.renderJobId).toMatch(/^rn_/);
    expect(spies.saved[0]).toEqual({status: 'queued'}); // the job record was created (the same object is then advanced by runRender)
    expect(spies.recorded).toBe(1);
    // check-then-use: valid when the job is created, unsafe when runRender reloads it
    spies.blueprints.push(good, blueprint(-16));
    await startRender({userId: 'u', blueprintId: 'bp_test', style: STYLE});
    await vi.waitFor(() => expect(spies.saved.some(entry => entry.status === 'failed' && entry.errorCode === 'render_failed')).toBe(true));
    expect(spies.lambda).toHaveLength(1);
  });
});

describe('8. call graph: only renderLocally and startLambdaRender hand a blueprint to Remotion, and both enforce the rule first', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
  const sources = files(SRC).map(file => ({file: path.relative(SRC, file), text: readFileSync(file, 'utf8')}));

  it('renderMediaOnLambda is called only in remotionLambda.ts; `remotion render` of ShortVideo only in localRender.ts', () => {
    expect(sources.filter(s => /renderMediaOnLambda\(/.test(s.text)).map(s => s.file)).toEqual(['stages/render/remotionLambda.ts']);
    expect(sources.filter(s => /'remotion',\s*'render',\s*'src\/index\.ts',\s*'ShortVideo'/.test(s.text)).map(s => s.file)).toEqual(['stages/render/localRender.ts']);
    // the other Remotion users render probes and stills, not a blueprint's video: the mix probe (only from inside renderLocally), the motion
    // worker's still check, the eval still capture
    expect(sources.filter(s => /runMixMeasure\(/.test(s.text) && !s.file.endsWith('mixMeasure.ts')).map(s => s.file)).toEqual(['stages/render/localRender.ts']);
  });
  it('both functions assert the rule as their first statement, and startRender asserts it before the job and the quota', () => {
    const fn = (file: string, signature: RegExp) => {
      const text = sources.find(s => s.file === file)!.text;
      const at = text.search(signature);
      return text.slice(at, at + 1500);
    };
    expect(fn('stages/render/localRender.ts', /export async function renderLocally/)).toMatch(/\}\): Promise<\{outputUrl: string\}> \{\s*\/\/[^\n]*\n\s*assertBedLoudnessRenderable\(input\.blueprint, 'renderLocally'\);/);
    expect(fn('stages/render/remotionLambda.ts', /export async function startLambdaRender/)).toMatch(/\}\): Promise<\{bucketName: string; lambdaRenderId: string\}> \{\s*\/\/[^\n]*\n\s*assertBedLoudnessRenderable\(input\.blueprint, 'startLambdaRender'\);/);
    const start = fn('pipeline/renderRunner.ts', /export async function startRender/);
    expect(start.indexOf("assertBedLoudnessRenderable(blueprint, 'startRender')")).toBeGreaterThan(0);
    expect(start.indexOf("assertBedLoudnessRenderable(blueprint, 'startRender')")).toBeLessThan(start.indexOf('assertRenderAllowed('));
  });
});
