import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {StaticCamera, MeasuredCamera, BboxMotionCamera, smoothTrack, cameraJitter} from './camera.ts';
import {StageCache} from './cache.ts';
import {runKineticDirector, normalizeUnknownPresets, buildDirectorPrompt} from './director.ts';
import {fixtureRawWords, fixtureShots, fixtureWords} from './fixtures.ts';
import {matteUsable, resolveMatte, analyzeMatte} from './matte.ts';
import {runKinetic} from './runKinetic.ts';
import {brandConfigSchema, kineticPlanSchema} from './schema.ts';
import {buildScene} from './scene.ts';
import {toKineticWords, JsonTranscriptProvider, loadWhisperXProvider} from './transcript.ts';
import {gateCustomTreatments} from './workerGate.ts';
import {execFileSync} from 'node:child_process';

const brand = brandConfigSchema.parse({});
const words = fixtureWords();
const shots = fixtureShots(words);
let tmp: string;
beforeAll(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'kin-test-')); });
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const goodPlan = {version: '1', events: [{id: 'h', shotId: 'shot-0', wordRange: [2, 2], lines: [{text: 'TIRED', role: 'hero'}], preset: 'hero.gradientWord.behind', layering: 'behind', anchor: 'auto', regionHint: 'upperCenter'}]};

describe('director', () => {
  it('no Gemini configured -> deterministic fallback, reason recorded', async () => {
    const r = await runKineticDirector({words, shots, scenes: {}, brand, call: null});
    expect(r.source).toBe('fallback');
    expect(r.reason).toBe('director_not_configured');
    expect(r.plan.events.length).toBeGreaterThan(0);
  });
  it('a valid model answer is used', async () => {
    const r = await runKineticDirector({words, shots, scenes: {}, brand, call: async () => JSON.stringify(goodPlan)});
    expect(r.source).toBe('director');
  });
  it('invalid JSON / schema / invented words / a throwing call -> fallback, never a throw', async () => {
    for (const call of [async () => 'not json', async () => JSON.stringify({version: '1', events: [{...goodPlan.events[0], lines: [{text: 'invented', role: 'hero'}]}]}), async () => JSON.stringify({version: '1', events: [{...goodPlan.events[0], fontPx: 90}]}), async () => { throw new Error('boom'); }]) {
      const r = await runKineticDirector({words, shots, scenes: {}, brand, call});
      expect(r.source).toBe('fallback');
      expect(r.reason).toBeTruthy();
    }
  });
  it('an unknown preset id from the model becomes a custom-treatment request on the closest preset', async () => {
    const raw = normalizeUnknownPresets({version: '1', events: [{...goodPlan.events[0], preset: 'hero.glitterMeteor'}]});
    const parsed = kineticPlanSchema.parse(raw);
    expect(parsed.events[0]!.needsCustomTreatment?.description).toMatch(/glitterMeteor/);
    expect(parsed.events[0]!.preset).toBe('fallback.boldCenter.front');
  });
  it('the prompt carries no frame numbers or pixel hints', () => {
    const p = buildDirectorPrompt({words, shots, scenes: {'shot-0': buildScene({shotId: 'shot-0', noMatte: true})}, brand});
    expect(p).not.toMatch(/\bpx\b|pixel|\bframes?\b|\d+(\.\d+)?\s?s\b/i);
    expect(p).toMatch(/no matte/);
  });
});

describe('worker gate', () => {
  const custom = kineticPlanSchema.parse({version: '1', events: [{...goodPlan.events[0], preset: 'hero.goldGlow.behind', needsCustomTreatment: {description: 'molten glossy 3D metal'}}]});
  it('no API key -> closest preset, logged, not blocked, worker never invoked', async () => {
    const run = vi.fn();
    const logs: string[] = [];
    const r = await gateCustomTreatments(custom, {env: {KINETIC_WORKER: '1'}, log: m => logs.push(m)});
    expect(r.outcomes[0]!.outcome).toBe('fallback-no-api-key');
    expect(r.overrides.h).toBe('hero.goldGlow.behind');
    expect(logs).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });
  it('disabled by default even with a key (paid call)', async () => {
    const r = await gateCustomTreatments(custom, {env: {ANTHROPIC_API_KEY: 'x'}});
    expect(r.outcomes[0]!.outcome).toBe('fallback-worker-disabled');
  });
  it('a failing worker never throws', async () => {
    const r = await gateCustomTreatments(custom, {run: async () => { throw new Error('rate limited'); }});
    expect(r.outcomes[0]!.outcome).toBe('fallback-worker-failed');
  });
  it('events without needsCustomTreatment never reach the worker', async () => {
    const run = vi.fn(async () => ({id: 'x'}));
    const r = await gateCustomTreatments(kineticPlanSchema.parse(goodPlan), {run});
    expect(run).not.toHaveBeenCalled();
    expect(r.outcomes).toEqual([]);
  });
});

describe('providers', () => {
  it('static camera is the default and has no jitter', () => {
    const t = new StaticCamera().track(shots[0]!);
    expect(cameraJitter(t, 1280)).toBe(0);
  });
  it('measured similarity is smoothed per shot only', () => {
    const noisy = Array.from({length: 30}, (_, f) => ({frame: f, scale: 1, tx: f % 2 ? 6 : -6, ty: 0}));
    const t = new MeasuredCamera({'shot-0': noisy}).track(shots[0]!);
    expect(cameraJitter(t, 1280)).toBeLessThan(cameraJitter({shotId: 'x', source: 'raw', samples: noisy}, 1280));
    expect(smoothTrack(noisy.slice(0, 3), 5)).toHaveLength(3);
    expect(new MeasuredCamera({}).track(shots[0]!).source).toBe('static');
  });
  it('bbox-motion camera stays static unless the subject box really zooms', () => {
    const mk = (hEnd: number) => buildScene({shotId: 'shot-0', subjectBox: {x: 0.3, y: 0.3, w: 0.4, h: 0.5}, boxTrack: Array.from({length: 10}, (_, i) => ({frame: i * 5, box: {x: 0.3, y: 0.3, w: 0.4, h: 0.5 + (hEnd - 0.5) * (i / 9)}}))});
    expect(new BboxMotionCamera().track(shots[0]!, mk(0.52), {width: 720, height: 1280}).source).toBe('static');
    expect(new BboxMotionCamera().track(shots[0]!, mk(0.7), {width: 720, height: 1280}).source).toBe('bbox-motion');
  });
  it('optional adapters are off unless their flag is set', async () => {
    await expect(loadWhisperXProvider()).rejects.toThrow(/disabled/);
  });
  it('JSON transcript provider accepts word/text shapes and converts to integer frames', async () => {
    const f = path.join(tmp, 't.json');
    writeFileSync(f, JSON.stringify({words: [{word: 'Hi', start: 0.1, end: 0.3}, {text: 'there!', start: 0.3, end: 0.8}]}));
    const raw = await new JsonTranscriptProvider(f).words();
    const w = toKineticWords(raw, 30000 / 1001);
    expect(w.map(x => Number.isInteger(x.startFrame) && Number.isInteger(x.endFrame))).toEqual([true, true]);
    expect(w[0]!.startFrame).toBe(Math.round(0.1 * (30000 / 1001)));
  });
});

describe('stage cache', () => {
  it('recomputes only stages whose key changed; failures are not cached', async () => {
    const c = new StageCache(path.join(tmp, 'cache'));
    const a = vi.fn(async () => ({n: 1})), b = vi.fn(async () => ({n: 2}));
    await c.run('s1', {k: 1}, a); await c.run('s2', {k: 1}, b);
    await c.run('s1', {k: 1}, a); await c.run('s2', {k: 2}, b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => ({ok: false}));
    await c.run('s3', {k: 1}, bad, v => v.ok); await c.run('s3', {k: 1}, bad, v => v.ok);
    expect(bad).toHaveBeenCalledTimes(2);
  });
});

describe('runKinetic (injected IO, no ffmpeg / network)', () => {
  const video = () => { const f = path.join(tmp, 'v.mp4'); writeFileSync(f, 'not really a video'); return f; };
  const meta = {width: 720, height: 1280, fpsRational: '30000/1001', fps: 30000 / 1001, durationSec: 12, totalFrames: 360};
  const deps = (over: Record<string, unknown> = {}) => ({
    probe: async () => meta,
    shotDetector: null,
    transcript: {id: 'fixture', version: '1', words: async () => fixtureRawWords()},
    resolveMatte: async () => ({path: null, source: 'none' as const, reason: 'test: no matte'}),
    luminance: async () => ({}),
    directorCall: null,
    render: vi.fn(async () => undefined),
    ...over,
  });
  it('no matte, no Gemini -> still returns a valid fallback spec with every event in front, and the report says why', async () => {
    const out = path.join(tmp, 'out1', 'a.mp4');
    const r = await runKinetic({video: video(), out, cacheRoot: path.join(tmp, 'c1'), debug: true, deps: deps() as never});
    expect(r.spec.noMatte).toBe(true);
    expect(r.spec.events.length).toBeGreaterThan(0);
    expect(r.spec.events.every(e => e.layering === 'front')).toBe(true);
    expect(r.report.providers).toMatchObject({transcript: 'fixture', matte: 'none', depth: 'subject-band@1', camera: 'static@1', director: 'fallback'});
    expect(r.report.fallbackReasons).toContain('director_not_configured');
    expect(JSON.stringify(r.report.guardrailViolations)).toBe('[]');
    const rep = JSON.parse(readFileSync(`${out}.report.json`, 'utf8'));
    expect(rep.providers.matte).toBe('none');
    expect(rep.occlusionPerEvent.length).toBe(r.spec.events.length);
    expect(existsSync(`${out}.spec.json`)).toBe(true);
    // fps kept, integer frames only
    expect(r.spec.fps).toBeCloseTo(30000 / 1001, 6);
    for (const e of r.spec.events) { expect(Number.isInteger(e.inFrame)).toBe(true); expect(Number.isInteger(e.outFrame)).toBe(true); }
  });
  it('a rerun hits every cached stage; changing the brand recomputes only plan + solve', async () => {
    const cacheRoot = path.join(tmp, 'c2');
    const v = video();
    await runKinetic({video: v, cacheRoot, deps: deps() as never});
    const again = await runKinetic({video: v, cacheRoot, deps: deps() as never});
    expect(Object.values(again.report.cache).every(Boolean)).toBe(true);
    const changed = await runKinetic({video: v, cacheRoot, brand: brandConfigSchema.parse({palette: {ink: '#000000', paper: '#EEEEEE', accent: '#00FF00', accent2: '#FF00FF', gradients: {}}}), deps: deps() as never});
    expect(changed.report.cache).toMatchObject({ingest: true, shots: true, transcript: true, scene: true, plan: false, solve: false});
  });
  it('same inputs -> deep-equal spec across independent cache dirs (determinism)', async () => {
    const v = video();
    const a = await runKinetic({video: v, cacheRoot: path.join(tmp, 'c3a'), deps: deps() as never});
    const b = await runKinetic({video: v, cacheRoot: path.join(tmp, 'c3b'), deps: deps() as never});
    expect(a.spec).toEqual(b.spec);
  });
  it('a missing / empty matte file is treated as noMatte (never regenerated)', async () => {
    const empty = path.join(tmp, 'empty.webm');
    writeFileSync(empty, '');
    expect(matteUsable(empty)).toBe(false);
    const r = await resolveMatte({video: 'x.mp4', matteArg: empty, cacheDir: tmp});
    expect(r.path).toBeNull();
    expect(r.reason).toMatch(/missing or empty/);
  });
  it('transcript failure -> empty plan, still no throw', async () => {
    const r = await runKinetic({video: video(), cacheRoot: path.join(tmp, 'c4'), deps: deps({transcript: {id: 'x', version: '1', words: async () => { throw new Error('no key'); }}}) as never});
    expect(r.spec.events).toEqual([]);
    expect(r.report.warnings.join(' ')).toMatch(/transcript unavailable/);
  });
});

const hasVp9 = (() => { try { return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {encoding: 'utf8'}).includes('libvpx-vp9'); } catch { return false; } })();
describe.skipIf(!hasVp9)('matte alpha analysis (real ffmpeg, synthetic matte)', () => {
  it('decodes alpha (alphaextract before scale) into a subject box and bits', async () => {
    const m = path.join(tmp, 'synth.webm');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=360x640:r=25:d=1', '-f', 'lavfi', '-i', "nullsrc=s=360x640:r=25:d=1,format=gray,geq=lum='255*between(X,120,240)*between(Y,160,600)'", '-filter_complex', '[0][1]alphamerge', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '35', '-deadline', 'realtime', '-cpu-used', '8', m]);
    const a = await analyzeMatte(m, 25);
    expect(a.ok).toBe(true);
    const box = a.samples[0]!.box!;
    expect(box.x).toBeGreaterThan(0.28); expect(box.x).toBeLessThan(0.38);
    expect(box.w).toBeGreaterThan(0.25); expect(box.w).toBeLessThan(0.4);
    expect(a.samples[0]!.area).toBeGreaterThan(0.1);
  });
});
