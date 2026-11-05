/**
 * SUBJECT STAGE Phase 4: the analyze wiring under POLISH_SUBJECT_STAGE. The gate, the whole-run matte request, the plan from caption words, the exclusions and the kinetic-led yield, with a MOCKED matte
 * (no python, no ffmpeg, no network). analyzeVideo itself needs paid model APIs, so its wiring is pinned by source assertions (placement, guards, what is touched).
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it, vi} from 'vitest';

import {subjectStageSchema} from '../../../remotion/src/blueprintSchema.ts';
import type {SubjectMatteResult} from '../media/personMatte.ts';
import {resolveKineticSubject} from '../stages/broll/kineticSubject.ts';
import {FIXTURE_ALERT} from '../stages/subjectStage/subjectStageFixtures.ts';
import {SUBJECT_STAGE_MATTE} from '../stages/subjectStage/subjectStageConfig.ts';
import {collectMatteNeeds, type PersonMatteDeps} from './personMatteStage.ts';
import {applySubjectStageExclusions, decideSubjectStageGate, isFullRvmDevice, kineticInputsUnderStage, planFromCaptionWords, runSubjectStage, type RunSubjectStageInput, type SubjectStageGateInput} from './subjectStageStage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPORT = {frames: 3000, segmented_frames: 200, fps: 25, width: 720, height: 1280, detected_ratio: 1, mean_area: 0.5, box: null, seconds: 12, model: 'rvm_mobilenetv3', ranges: [] as Array<[number, number]>};

/** caption words laid evenly over each fixture sentence */
const captionWords = FIXTURE_ALERT.sentences.flatMap(s => {
  const words = s.text.split(/\s+/);
  const step = (s.end - s.start) / words.length;
  return words.map((text, i) => ({text, start: Math.round((s.start + i * step) * 1000) / 1000, end: Math.round((s.start + (i + 1) * step - 0.02) * 1000) / 1000}));
});
const D = FIXTURE_ALERT.durationSec;

const gateBase: SubjectStageGateInput = {
  flag: true,
  polishPath: true,
  motionTemplates: true,
  motionPresent: true,
  skillFlags: {faceless: false, explainer: false, newsroom: false},
  durationSec: 40,
  rvmConfigured: true,
  rvmDevice: 'mps',
  keyable: false,
  providedCutout: false,
};

function makeDeps(over: Partial<PersonMatteDeps> = {}) {
  return {
    rvmConfigured: true,
    extractChroma: vi.fn(async () => {}),
    probeAlpha: vi.fn(async () => 0.4),
    fileBytes: vi.fn(async () => 100_000),
    upload: vi.fn(async (path: string) => ({publicUrl: `https://cdn.example/${path.split('/').pop()}`})),
    extractRvm: vi.fn(async (args: {outputPath: string; ranges: ReadonlyArray<readonly [number, number]>}): Promise<SubjectMatteResult | null> => ({path: args.outputPath, report: {...REPORT, ranges: args.ranges.map(r => [r[0], r[1]] as [number, number])}, cached: false, elapsedMs: 5})),
    ...over,
  } as PersonMatteDeps & {extractChroma: ReturnType<typeof vi.fn>; extractRvm: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>};
}
function runInput(over: Partial<RunSubjectStageInput> = {}, deps = makeDeps()): RunSubjectStageInput & {deps: ReturnType<typeof makeDeps>} {
  return {...gateBase, durationSec: D, captionWords, keepSegments: [{sourceStart: 0, sourceEnd: 300, outputStart: 0}], activeSourcePath: '/work/source.mp4', chromaPath: '/work/chroma.webm', rvmPath: '/work/matte.webm', deps, ...over} as never;
}

describe('gate matrix (pure)', () => {
  const g = (over: Partial<SubjectStageGateInput>) => decideSubjectStageGate({...gateBase, ...over});
  it('not polish -> not applicable (no warning, nothing happens)', () => {
    expect(g({polishPath: false})).toEqual({state: 'not_applicable', warning: null});
    expect(g({polishPath: false, flag: false}).state).toBe('not_applicable');
  });
  it('flag off on polish -> off + the off warning', () => {
    expect(g({flag: false})).toEqual({state: 'off', warning: 'polish_subject_stage:off'});
  });
  it.each([
    [{motionTemplates: false}, 'no_motion_templates'],
    [{motionPresent: false}, 'no_motion'],
    [{skillFlags: {faceless: true, explainer: false, newsroom: false}}, 'skill_faceless'],
    [{skillFlags: {faceless: false, explainer: true, newsroom: false}}, 'skill_explainer'],
    [{skillFlags: {faceless: false, explainer: false, newsroom: true}}, 'skill_newsroom'],
    [{durationSec: 2}, 'too_short'],
    [{rvmConfigured: false}, 'no_matte_backend'],
    [{rvmDevice: 'cpu', durationSec: 60}, 'cpu_over_45s'],
    [{rvmDevice: 'auto', durationSec: 46}, 'cpu_over_45s'],
    [{rvmDevice: undefined, durationSec: 90}, 'cpu_over_45s'],
    [{rvmDevice: 'mps', durationSec: 121}, 'too_long'],
  ] as Array<[Partial<SubjectStageGateInput>, string]>)('%j -> skipped:%s', (over, reason) => {
    expect(g(over)).toMatchObject({state: 'skipped', reason, warning: `polish_subject_stage:skipped:${reason}`});
  });
  it('matte routes: a provided cutout and a keyable backdrop need no RVM; RVM needs a GPU device or <= 45 s', () => {
    expect(g({providedCutout: true, rvmConfigured: false})).toMatchObject({state: 'candidate', route: 'provided', rvmAllowed: false});
    expect(g({keyable: true, rvmConfigured: false})).toMatchObject({state: 'candidate', route: 'chroma', rvmAllowed: false});
    expect(g({keyable: true, rvmDevice: 'cpu', durationSec: 80})).toMatchObject({route: 'chroma', rvmAllowed: false});
    expect(g({rvmDevice: 'mps', durationSec: 100})).toMatchObject({route: 'rvm', rvmAllowed: true});
    expect(g({rvmDevice: 'cuda', durationSec: 120})).toMatchObject({route: 'rvm', rvmAllowed: true});
    expect(g({rvmDevice: 'cpu', durationSec: 45})).toMatchObject({route: 'rvm', rvmAllowed: true});
    expect(g({rvmDevice: ' MPS '})).toMatchObject({route: 'rvm'});
  });
  it('the device rule', () => {
    for (const d of ['mps', 'cuda', ' MPS ', 'CUDA']) expect(isFullRvmDevice(d)).toBe(true);
    for (const d of ['cpu', 'auto', '', undefined, 'tpu', 'cuda:0']) expect(isFullRvmDevice(d)).toBe(false);
    expect(SUBJECT_STAGE_MATTE.cpuMaxVideoSec).toBe(45);
  });
});

describe('runSubjectStage: flag matrix with a mocked matte', () => {
  it('not polish: nothing happens, no warning, no matte call', async () => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput({polishPath: false}, deps));
    expect(r).toMatchObject({active: false, warnings: []});
    expect(deps.extractRvm).not.toHaveBeenCalled();
    expect(deps.extractChroma).not.toHaveBeenCalled();
  });
  it('flag OFF: the off warning only; the matte is never requested', async () => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput({flag: false}, deps));
    expect(r.active).toBe(false);
    expect(r.payload).toBeUndefined();
    expect(r.warnings).toEqual(['polish_subject_stage:off']);
    expect(deps.extractRvm).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
  });
  it.each([
    ['faceless', {skillFlags: {faceless: true, explainer: false, newsroom: false}}],
    ['explainer', {skillFlags: {faceless: false, explainer: true, newsroom: false}}],
    ['newsroom', {skillFlags: {faceless: false, explainer: false, newsroom: true}}],
  ] as const)('%s skill: skipped, no matte call', async (lane, over) => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput(over, deps));
    expect(r.active).toBe(false);
    expect(r.warnings).toEqual([`polish_subject_stage:skipped:skill_${lane}`]);
    expect(deps.extractRvm).not.toHaveBeenCalled();
  });
  it('ON + RVM on a GPU device: ONE whole-run extraction (every output second), payload set, parses with the blueprint schema', async () => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput({rvmDevice: 'mps'}, deps));
    expect(r.active).toBe(true);
    expect(r.warnings[0]).toBe('polish_subject_stage:on');
    expect(deps.extractRvm).toHaveBeenCalledTimes(1);
    const ranges = deps.extractRvm.mock.calls[0]![0].ranges as Array<[number, number]>;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]![0]).toBeLessThanOrEqual(0.001);
    expect(ranges[0]![1]).toBeGreaterThanOrEqual(D - 0.001); // the whole run, not the kinetic 20 / 45 s budget
    expect(deps.extractChroma).not.toHaveBeenCalled();
    expect(r.source).toBe('rvm');
    expect(r.matteUrl).toMatch(/^https:\/\/cdn\.example\//);
    expect(r.payload!.matteUrl).toBe(r.matteUrl);
    expect(subjectStageSchema.safeParse(r.payload).success).toBe(true);
    expect(r.payload!.spans.length).toBeGreaterThan(3);
    expect(r.payload!.spans[0]!.start).toBe(0);
    expect(r.payload!.spans[r.payload!.spans.length - 1]!.end).toBeCloseTo(D, 6);
    expect(r.warnings.some(w => w.startsWith('subject_stage:plan:'))).toBe(true);
    expect(r.warnings).toContain('subject_stage:matte:rvm');
  });
  it('maps the whole output run through cuts: two keep segments give two source ranges covering all of it', async () => {
    const deps = makeDeps();
    const half = D / 2;
    await runSubjectStage(runInput({keepSegments: [{sourceStart: 0, sourceEnd: half, outputStart: 0}, {sourceStart: 50, sourceEnd: 50 + half + 1, outputStart: half}]}, deps));
    const ranges = deps.extractRvm.mock.calls[0]![0].ranges as Array<[number, number]>;
    expect(ranges.length).toBe(2);
    const covered = ranges.reduce((sum, [a, b]) => sum + (b - a), 0);
    expect(covered).toBeGreaterThanOrEqual(D - 0.1);
  });
  it('CPU: allowed for <= 45 s, skipped (no matte call) above', async () => {
    const short = makeDeps();
    const ok = await runSubjectStage(runInput({rvmDevice: 'cpu', durationSec: 40, captionWords: captionWords.filter(w => w.end < 40)}, short));
    expect(ok.active).toBe(true);
    expect(short.extractRvm).toHaveBeenCalledTimes(1);
    const long = makeDeps();
    const no = await runSubjectStage(runInput({rvmDevice: 'cpu', durationSec: 60}, long));
    expect(no).toMatchObject({active: false, skipReason: 'cpu_over_45s'});
    expect(no.warnings).toEqual(['polish_subject_stage:skipped:cpu_over_45s']);
    expect(long.extractRvm).not.toHaveBeenCalled();
    const auto = makeDeps();
    expect((await runSubjectStage(runInput({rvmDevice: 'auto', durationSec: 60}, auto))).skipReason).toBe('cpu_over_45s');
  });
  it('a keyable backdrop uses the chroma fast path (no RVM)', async () => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput({keyable: true}, deps));
    expect(r.active).toBe(true);
    expect(r.source).toBe('chroma');
    expect(deps.extractChroma).toHaveBeenCalledTimes(1);
    expect(deps.extractRvm).not.toHaveBeenCalled();
    expect(r.warnings).toContain('speaker_cutout_keyed');
  });
  it('a failed key falls to RVM only where RVM is allowed; otherwise the style is OFF (fail closed)', async () => {
    const fallback = makeDeps({extractChroma: vi.fn(async () => { throw new Error('ffmpeg'); })});
    const a = await runSubjectStage(runInput({keyable: true, rvmDevice: 'mps'}, fallback));
    expect(a.active).toBe(true);
    expect(a.source).toBe('rvm');
    expect(a.warnings).toContain('speaker_cutout_extract_failed');
    const blocked = makeDeps({extractChroma: vi.fn(async () => { throw new Error('ffmpeg'); })});
    const b = await runSubjectStage(runInput({keyable: true, rvmDevice: 'cpu', durationSec: 80}, blocked));
    expect(b).toMatchObject({active: false, skipReason: 'matte_unavailable'});
    expect(blocked.extractRvm).not.toHaveBeenCalled();
  });
  it('a provided cutout URL is the matte: no extraction at all', async () => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput({providedCutout: true, providedCutoutUrl: 'https://cdn.example/provided.webm', rvmConfigured: false}, deps));
    expect(r.active).toBe(true);
    expect(r.source).toBe('provided');
    expect(r.payload!.matteUrl).toBe('https://cdn.example/provided.webm');
    expect(deps.extractRvm).not.toHaveBeenCalled();
    expect(deps.extractChroma).not.toHaveBeenCalled();
  });
  it('RVM busy / failed -> the style is skipped with the matte reason, never half-on', async () => {
    const deps = makeDeps({extractRvm: vi.fn(async (args: {onSkip?: (r: string) => void}) => { args.onSkip?.('busy'); return null; })});
    const r = await runSubjectStage(runInput({rvmDevice: 'mps'}, deps));
    expect(r).toMatchObject({active: false, skipReason: 'matte_unavailable'});
    expect(r.payload).toBeUndefined();
    expect(r.warnings).toContain('person_matte:skipped:busy');
    expect(r.warnings[r.warnings.length - 1]).toBe('polish_subject_stage:skipped:matte_unavailable');
  });
  it('an empty plan costs no matte', async () => {
    const deps = makeDeps();
    const r = await runSubjectStage(runInput({captionWords: []}, deps));
    expect(r).toMatchObject({active: false, skipReason: 'plan_empty'});
    expect(deps.extractRvm).not.toHaveBeenCalled();
    expect(deps.extractChroma).not.toHaveBeenCalled();
  });
  it('is deterministic', async () => {
    const a = await runSubjectStage(runInput({}, makeDeps()));
    const b = await runSubjectStage(runInput({}, makeDeps()));
    expect(JSON.stringify(a.payload)).toBe(JSON.stringify(b.payload));
  });
});

describe('plan from caption words', () => {
  it('uses the real sentences and re-times accent keywords to the matching caption word', () => {
    const {plan, retimed} = planFromCaptionWords({captionWords, durationSec: D});
    expect(plan.spans.length).toBeGreaterThan(3);
    expect(retimed).toBeGreaterThan(0);
    for (const a of plan.accents) {
      for (const line of a.lines ?? []) {
        const word = captionWords.find(w => w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === line.toLowerCase().split(/\s+/)[0]!.replace(/[^\p{L}\p{N}]+/gu, ''));
        expect(word, line).toBeDefined();
      }
    }
  });
});

describe('exclusions + kinetic yield', () => {
  const behind = [{start: 4, end: 6, text: 'x'}];
  const depth = [{start: 10, end: 13}];
  const inset = [{start: 20, end: 24}];
  const overlays = [{layout: 'cutout', start: 30, end: 33}, {layout: 'cutaway', start: 40, end: 43}, {layout: 'card', start: 50, end: 52}];
  it('clears behind-text (incl. the opening), depth overlays, inset reveals and the cutout layout; every other overlay stays', () => {
    const r = applySubjectStageExclusions({behind, opening: {start: 0, end: 2}, depth, insetReveals: inset, overlays});
    expect(r.behind).toEqual([]);
    expect(r.openingDropped).toBe(true);
    expect(r.depth).toEqual([]);
    expect(r.insetReveals).toEqual([]);
    expect(r.overlays.map(o => o.layout)).toEqual(['cutaway', 'card']);
    expect(r.dropped.cutouts).toEqual([overlays[0]]);
    expect(r.dropped.behind).toEqual(behind);
    expect(applySubjectStageExclusions({behind: [], opening: null, depth: [], insetReveals: [], overlays: []}).openingDropped).toBe(false);
  });
  it('inactive stage: the kinetic inputs are returned untouched (same object)', () => {
    const current = {kineticLed: true, segmentationConfigured: true, cutout: {available: true, videoUrl: 'https://cdn.example/keyed.webm'}};
    expect(kineticInputsUnderStage(false, current)).toBe(current);
  });
  it('active stage: kinetic-led off, no segmentation, no cutout to reuse', () => {
    const forced = kineticInputsUnderStage(true, {kineticLed: true, segmentationConfigured: true, cutout: {available: true, videoUrl: 'https://cdn.example/keyed.webm'}});
    expect(forced).toEqual({kineticLed: false, segmentationConfigured: false, cutout: {}});
  });
  it('resolveKineticSubject with the forced inputs draws NO matte / foreground, while the normal inputs still reuse the keyed cutout', async () => {
    const words = ((parts: Array<[string, number]>) => parts.flatMap(([text, at]) => text.split(/\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25}))))([['And that is attention.', 14], ['Never ignore this result.', 30]]);
    const box = {x: 0.3, y: 0.4, w: 0.4, h: 0.5};
    const common = {keepSegments: [{sourceStart: 0, sourceEnd: 120, outputStart: 0}], activeSourcePath: '/x.mp4', matteOutputPath: '/tmp/m.webm', occupancy: {speaker: box, source: 'vision' as const}, upload: async () => ({publicUrl: 'https://cdn.example/k.webm'}), extract: vi.fn(async () => null)};
    const base = {kineticLed: true as const, matteBudgetSec: 20, skill: 'explainer' as const, durationSec: 40, words};
    const keyed = {available: true, videoUrl: 'https://cdn.example/keyed.webm'};
    const normal = await resolveKineticSubject({...common, planInput: base, cutout: keyed, segmentationConfigured: true});
    expect(normal.foreground?.videoUrl).toBe('https://cdn.example/keyed.webm');
    const y = kineticInputsUnderStage(true, {kineticLed: true, segmentationConfigured: true, cutout: keyed});
    const yielded = await resolveKineticSubject({...common, planInput: {...base, kineticLed: y.kineticLed}, cutout: y.cutout as never, segmentationConfigured: y.segmentationConfigured});
    expect(yielded.foreground).toBeUndefined();
    expect(yielded.subjectMatte).toBeUndefined();
    expect(common.extract).not.toHaveBeenCalled();
  });
});

describe('collectMatteNeeds: the stage run is additive', () => {
  it('without stageRun the needs are exactly the kinetic-era ones; with it there is one whole-run need, kept first', () => {
    expect(collectMatteNeeds({behindTexts: [{start: 5, end: 7}]}).map(n => n.kind)).toEqual(['behind_text']);
    const needs = collectMatteNeeds({stageRun: {start: 0, end: 70}});
    expect(needs).toEqual([{kind: 'subject_stage', index: 0, priority: 0, start: 0, end: 70}]);
    expect(collectMatteNeeds({stageRun: null})).toEqual([]);
    expect(collectMatteNeeds({stageRun: {start: 0, end: 70}, behindTexts: [{start: 5, end: 7}]})[0]!.kind).toBe('subject_stage');
  });
});

describe('analyzeVideo wiring (source)', () => {
  const src = readFileSync(join(here, 'analyzeVideo.ts'), 'utf8');
  const at = (needle: string, from = 0) => {
    const i = src.indexOf(needle, from);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };
  it('the stage runs after the Director / opening elements exist and BEFORE the Phase C matte needs and finalizeEdits', () => {
    const stage = at('await runSubjectStage({');
    const phaseCNeeds = at('const needs = collectMatteNeeds({');
    const finalize = at('const finalized = finalizeEdits({');
    expect(at('let openingBehindForFinalize = openingBehindSubject;')).toBeLessThan(stage);
    expect(stage).toBeLessThan(phaseCNeeds);
    expect(phaseCNeeds).toBeLessThan(finalize);
  });
  it('the flag is read once, only through the gate inputs; the gate itself requires the polish profile', () => {
    expect(src.match(/flags\.subjectStage/g)).toHaveLength(1);
    expect(src).toContain('flag: flags.subjectStage,\n        polishPath,');
    expect(readFileSync(join(here, 'subjectStageStage.ts'), 'utf8')).toMatch(/if \(!input\.polishPath\) return \{state: 'not_applicable'/);
  });
  it('the exclusions are applied ONLY inside the active branch (skipped / off leave every list alone)', () => {
    const active = at('if (stage.active && stage.payload) {');
    const exclusions = at('applySubjectStageExclusions({behind: behindForFinalize', active);
    const activeEnd = at('subject_stage:excluded:', exclusions);
    expect(exclusions).toBeGreaterThan(active);
    expect(activeEnd).toBeGreaterThan(exclusions);
    for (const assign of ['broll.depthOverlays = cleared.depth;', 'broll.insetReveals = cleared.insetReveals;', 'broll.overlays = cleared.overlays;', 'behindForFinalize = cleared.behind;']) {
      const i = at(assign);
      expect(i, assign).toBeGreaterThan(active);
      expect(i, assign).toBeLessThan(activeEnd + 200);
    }
    // nothing else in the file assigns from `cleared` / the stage payload outside that branch
    expect(src.match(/^\s+(?:broll\.\w+|behindForFinalize) = cleared\./gm)!.length).toBe(4);
  });
  it('kinetic-led yields through one helper (3 changed lines) and the blueprint gets the field only when set', () => {
    expect(src).toContain('const kineticLedStyle = kineticYield.kineticLed;');
    expect(src).toContain('cutout: kineticYield.cutout,');
    expect(src).toContain('segmentationConfigured: kineticYield.segmentationConfigured,');
    expect(src).toContain('...(subjectStagePayload ? {subjectStage: subjectStagePayload} : {}),');
  });
  it('the existing kinetic subjectForeground path is untouched and still wins over the stage foreground (Remotion mounts the stage matte only when it is absent)', () => {
    expect(src).toContain('...(kineticForeground ? {subjectForeground: {videoUrl: kineticForeground.videoUrl, spans: kineticForeground.spans}} : {}),');
    expect(readFileSync(join(here, '../../../remotion/src/ShortVideo.tsx'), 'utf8')).toContain('{!blueprint.subjectForeground && subjectStageForeground ? (');
  });
});
