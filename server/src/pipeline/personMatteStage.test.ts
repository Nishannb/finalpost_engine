/**
 * Phase C: the person matte for Director-driven elements. Pure helpers (windows, merge, budget trim, reconcile), the chroma sanity gate, and the orchestrator with mocked extraction deps.
 * No python, no ffmpeg, no network. (analyzeVideo itself is not run here: it needs paid model APIs.)
 */
import {describe, expect, it, vi} from 'vitest';

import {parseMeanAlpha} from '../media/alphaProbe.ts';
import type {SubjectMatteResult} from '../media/personMatte.ts';
import {MATTE_RANGE_PAD_SEC} from '../stages/broll/kineticLedConfig.ts';
import {resolveKineticSubject, type MatteCoverage} from '../stages/broll/kineticSubject.ts';
import {
  CHROMA_MAX_MEAN_ALPHA,
  CHROMA_MIN_MEAN_ALPHA,
  chromaSanity,
  collectMatteNeeds,
  matteCostSec,
  obtainPersonMatte,
  paddedUnion,
  reconcileByCoverage,
  reconcileDirectorElements,
  trimToBudget,
  type MatteNeed,
  type PersonMatteDeps,
} from './personMatteStage.ts';

const SEGMENTS = [{sourceStart: 0, sourceEnd: 120, outputStart: 0}]; // identity timeline
const GOOD_REPORT = {frames: 3000, segmented_frames: 200, fps: 25, width: 720, height: 1280, detected_ratio: 1, mean_area: 0.5, box: null, seconds: 12, model: 'rvm_mobilenetv3', ranges: [] as Array<[number, number]>};

describe('collectMatteNeeds', () => {
  it('lists every element kind with its priority, drops empty windows', () => {
    const needs = collectMatteNeeds({openingBehind: {start: 0, end: 2}, behindTexts: [{start: 10, end: 12}], depthOverlays: [{start: 20, end: 23}], cutoutOverlays: [{start: 30, end: 34}, {start: 40, end: 40}]});
    expect(needs.map(n => [n.kind, n.start, n.priority])).toEqual([['opening_behind', 0, 0], ['behind_text', 10, 1], ['depth', 20, 2], ['cutout', 30, 3]]);
  });
  it('nothing planned = no needs', () => {
    expect(collectMatteNeeds({})).toEqual([]);
  });
});

describe('merging and cost', () => {
  it('windows whose padded spans touch become ONE range; distant ones stay separate', () => {
    expect(paddedUnion([{start: 10, end: 12}, {start: 12.5, end: 14}])).toEqual([{start: 9.7, end: 14.3}]); // gap 0.5 < 2 x pad
    expect(paddedUnion([{start: 10, end: 12}, {start: 20, end: 22}]).length).toBe(2);
    expect(paddedUnion([{start: 0.1, end: 1}])[0]!.start).toBe(0); // never before 0
  });
  it('cost is the padded union length: merging nearby windows is cheaper than separate ones', () => {
    const near = matteCostSec([{start: 10, end: 12}, {start: 12.5, end: 14}]);
    const apart = matteCostSec([{start: 10, end: 12}, {start: 30, end: 31.5}]);
    expect(near).toBeCloseTo(4.6, 6);
    expect(apart).toBeCloseTo(2.6 + 2.1, 6);
    expect(near).toBeLessThan(2.6 + 2.1);
  });
});

describe('trimToBudget', () => {
  const need = (kind: MatteNeed['kind'], start: number, end: number, priority: number, index = 0): MatteNeed => ({kind, start, end, priority, index});

  it('keeps everything that fits and reports the cost', () => {
    const r = trimToBudget([need('behind_text', 10, 12, 1), need('depth', 30, 33, 2)], 20);
    expect(r.kept.length).toBe(2);
    expect(r.dropped).toEqual([]);
    expect(r.costSec).toBeCloseTo(2.6 + 3.6, 6);
    expect(r.costSec).toBeLessThanOrEqual(20);
  });

  it('never exceeds the budget; the most important needs win (opening > behind text > depth > cutout), then the earliest', () => {
    const needs = [need('cutout', 5, 9, 3), need('depth', 20, 25, 2), need('behind_text', 40, 44, 1), need('opening_behind', 60, 62, 0)];
    const r = trimToBudget(needs, 8);
    expect(r.costSec).toBeLessThanOrEqual(8 + 1e-9);
    expect(r.kept.map(n => n.kind)).toEqual(['opening_behind', 'behind_text']); // 2.6 + 4.6 = 7.2; the depth (5.6) no longer fits
    expect(r.dropped.map(n => n.kind).sort()).toEqual(['cutout', 'depth']);
  });

  it('a need that merges into a kept window costs only the extra footage, so it still fits a tight budget', () => {
    const r = trimToBudget([need('behind_text', 10, 12, 1), need('depth', 12.4, 13, 2)], 3.8); // separate 2.6 + 1.6 = 4.2 > 3.8, merged 3.6 <= 3.8
    expect(r.kept.length).toBe(2);
    expect(r.costSec).toBeCloseTo(3.6, 6);
  });

  it('a zero budget keeps nothing', () => {
    const r = trimToBudget([need('behind_text', 10, 12, 1)], 0);
    expect(r.kept).toEqual([]);
    expect(r.windows).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const a = [need('depth', 20, 25, 2), need('behind_text', 40, 44, 1), need('cutout', 5, 9, 3)];
    expect(trimToBudget([...a].reverse(), 9).kept.map(n => n.kind)).toEqual(trimToBudget(a, 9).kept.map(n => n.kind));
  });
});

describe('reconcileByCoverage', () => {
  const items = [{start: 10, end: 12}, {start: 30, end: 33}];
  it('no asset: behind-subject / depth are dropped, the cutout layout keeps its crop fallback', () => {
    expect(reconcileByCoverage(items, null, {dropWhenNoMatte: true})).toEqual({kept: [], dropped: items});
    expect(reconcileByCoverage(items, null, {dropWhenNoMatte: false})).toEqual({kept: items, dropped: []});
  });
  it('a full-length asset keeps everything', () => {
    expect(reconcileByCoverage(items, {kind: 'all'}, {dropWhenNoMatte: true}).dropped).toEqual([]);
  });
  it('a range-limited asset keeps only what lies inside its padded windows', () => {
    const coverage: MatteCoverage = {kind: 'windows', windows: [{start: 10, end: 12}], padSec: MATTE_RANGE_PAD_SEC};
    const r = reconcileByCoverage(items, coverage, {dropWhenNoMatte: true});
    expect(r.kept).toEqual([{start: 10, end: 12}]);
    expect(r.dropped).toEqual([{start: 30, end: 33}]);
  });
});

describe('reconcileDirectorElements (every kind at once)', () => {
  const input = {behind: [{start: 10, end: 12}], opening: {start: 0, end: 2}, depth: [{start: 20, end: 23}], cutouts: [{start: 40, end: 44}]};
  it('no asset: behind text, the opening text and depth are dropped (and reported); the cutout overlay stays on its crop fallback', () => {
    const r = reconcileDirectorElements({...input, coverage: null});
    expect(r.behind.dropped.length).toBe(1);
    expect(r.openingDropped).toBe(true);
    expect(r.depth.dropped.length).toBe(1);
    expect(r.cutouts.kept.length).toBe(1);
    expect(r.warnings).toEqual(['person_matte:dropped:behind_text:1:no_person_matte', 'person_matte:dropped:opening_behind:no_person_matte', 'person_matte:dropped:depth:1:no_person_matte', 'speaker_cutout_crop']);
    expect(r.textBehindSkipped).toBe(true);
  });
  it('a full asset drops nothing and warns nothing', () => {
    const r = reconcileDirectorElements({...input, coverage: {kind: 'all'}});
    expect(r.warnings).toEqual([]);
    expect(r.textBehindSkipped).toBe(false);
  });
  it('a range-limited asset drops what it does not cover, including an uncovered cutout overlay (no person would show)', () => {
    const r = reconcileDirectorElements({...input, coverage: {kind: 'windows', windows: [{start: 10, end: 12}, {start: 20, end: 23}], padSec: 0.3}});
    expect(r.behind.kept.length).toBe(1);
    expect(r.depth.kept.length).toBe(1);
    expect(r.openingDropped).toBe(true);
    expect(r.cutouts.dropped.length).toBe(1);
    expect(r.warnings).toContain('person_matte:dropped:cutout:1:outside_person_matte');
    expect(r.textBehindSkipped).toBe(false); // there IS an asset
  });
});

describe('chroma sanity gate', () => {
  it('accepts a plausible key; rejects a tiny file, an empty alpha and an opaque alpha; an unmeasurable alpha falls back to the size check', () => {
    expect(chromaSanity({bytes: 80_000, meanAlpha: 0.5})).toEqual({ok: true, reason: 'ok'});
    expect(chromaSanity({bytes: 100, meanAlpha: 0.5}).reason).toBe('tiny_file');
    expect(chromaSanity({bytes: 80_000, meanAlpha: 0.001}).reason).toBe('empty_alpha');
    expect(chromaSanity({bytes: 80_000, meanAlpha: 0.995}).reason).toBe('opaque_alpha');
    expect(chromaSanity({bytes: 80_000, meanAlpha: null}).ok).toBe(true);
    expect(chromaSanity({bytes: 80_000, meanAlpha: CHROMA_MIN_MEAN_ALPHA}).ok).toBe(true);
    expect(chromaSanity({bytes: 80_000, meanAlpha: CHROMA_MAX_MEAN_ALPHA}).ok).toBe(true);
  });
  it('parses ffmpeg signalstats output into a 0..1 mean alpha', () => {
    expect(parseMeanAlpha('lavfi.signalstats.YAVG=127.5\nlavfi.signalstats.YAVG=255\n')).toBeCloseTo(0.75, 6);
    expect(parseMeanAlpha('nothing here')).toBeNull();
  });
});

describe('obtainPersonMatte (mocked deps)', () => {
  const base = {keepSegments: SEGMENTS, activeSourcePath: '/src.mp4', chromaPath: '/w/chroma.webm', rvmPath: '/w/rvm.webm', budgetSec: 20};
  const behindNeeds = collectMatteNeeds({behindTexts: [{start: 10, end: 12}], depthOverlays: [{start: 30, end: 33}]});

  function makeDeps(over: Partial<PersonMatteDeps> = {}) {
    const deps = {
      rvmConfigured: true,
      extractChroma: vi.fn(async () => undefined),
      probeAlpha: vi.fn(async () => 0.5 as number | null),
      fileBytes: vi.fn(async () => 50_000),
      upload: vi.fn(async (path: string) => ({publicUrl: `https://cdn.example/${path.split('/').pop()}`})),
      extractRvm: vi.fn(async (args: {outputPath: string; ranges: ReadonlyArray<readonly [number, number]>}): Promise<SubjectMatteResult | null> => ({path: args.outputPath, report: {...GOOD_REPORT, ranges: args.ranges.map(r => [r[0], r[1]] as [number, number])}, cached: false, elapsedMs: 5})),
      ...over,
    } satisfies PersonMatteDeps;
    return deps;
  }

  it('nothing planned and not forced: no extraction of any kind (no cost)', async () => {
    const deps = makeDeps();
    const r = await obtainPersonMatte({...base, needs: [], keyable: true, force: false, deps});
    expect(r.source).toBe('none');
    expect(r.attempted).toBe(false);
    expect(deps.extractChroma).not.toHaveBeenCalled();
    expect(deps.extractRvm).not.toHaveBeenCalled();
  });

  it('keyable + a sane key: chroma is the asset (full coverage) and RVM is never called', async () => {
    const deps = makeDeps();
    const r = await obtainPersonMatte({...base, needs: behindNeeds, keyable: true, force: false, deps});
    expect(r).toMatchObject({source: 'chroma', videoUrl: 'https://cdn.example/chroma.webm', coverage: {kind: 'all'}});
    expect(r.warnings).toContain('speaker_cutout_keyed');
    expect(deps.extractRvm).not.toHaveBeenCalled();
  });

  it('keyable but the key is insane (empty alpha): falls through to RVM for the planned windows', async () => {
    const deps = makeDeps({probeAlpha: vi.fn(async () => 0.001)});
    const r = await obtainPersonMatte({...base, needs: behindNeeds, keyable: true, force: false, deps});
    expect(r.warnings).toContain('speaker_cutout_keyed_rejected:empty_alpha');
    expect(deps.extractRvm).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('rvm');
  });

  it('keyable, the chroma extract throws, RVM is NOT configured: no asset, reported, nothing thrown', async () => {
    const deps = makeDeps({rvmConfigured: false, extractChroma: vi.fn(async () => { throw new Error('ffmpeg failed'); })});
    const r = await obtainPersonMatte({...base, needs: behindNeeds, keyable: true, force: false, deps});
    expect(r).toMatchObject({source: 'none', coverage: null, attempted: true});
    expect(r.warnings).toEqual(['speaker_cutout_extract_failed']);
    expect(deps.extractRvm).not.toHaveBeenCalled();
  });

  it('NOT keyable + RVM configured: RVM is called with SOURCE ranges derived from the planned behind-subject / depth windows (padded), and covers exactly them', async () => {
    const deps = makeDeps();
    const r = await obtainPersonMatte({...base, needs: behindNeeds, keyable: false, force: false, deps});
    expect(deps.extractChroma).not.toHaveBeenCalled();
    expect(deps.extractRvm).toHaveBeenCalledTimes(1);
    expect(deps.extractRvm.mock.calls[0]![0].ranges).toEqual([[9.7, 12.3], [29.7, 33.3]]);
    expect(deps.extractRvm.mock.calls[0]![0].outputPath).toBe('/w/rvm.webm');
    expect(r.source).toBe('rvm');
    expect(r.videoUrl).toBe('https://cdn.example/rvm.webm');
    expect(r.coverage).toEqual({kind: 'windows', windows: [{start: 10, end: 12}, {start: 30, end: 33}], padSec: MATTE_RANGE_PAD_SEC});
    expect(r.matteSec).toBeCloseTo(2.6 + 3.6, 6);
  });

  it('cuts are honoured: a window across a cut becomes two SOURCE ranges', async () => {
    const deps = makeDeps();
    const cut = [{sourceStart: 0, sourceEnd: 5, outputStart: 0}, {sourceStart: 50, sourceEnd: 60, outputStart: 5}];
    await obtainPersonMatte({...base, keepSegments: cut, needs: collectMatteNeeds({behindTexts: [{start: 4, end: 7}]}), keyable: false, force: false, deps});
    expect(deps.extractRvm.mock.calls[0]![0].ranges).toEqual([[3.7, 5], [50, 52.3]]);
  });

  it('nearby windows merge into ONE range (one decode pass over a short span instead of two)', async () => {
    const deps = makeDeps();
    await obtainPersonMatte({...base, needs: collectMatteNeeds({behindTexts: [{start: 10, end: 12}, {start: 12.5, end: 14}]}), keyable: false, force: false, deps});
    expect(deps.extractRvm.mock.calls[0]![0].ranges).toEqual([[9.7, 14.3]]);
  });

  it('over budget: the needs it cannot pay for are dropped from the ranges and reported', async () => {
    const deps = makeDeps();
    const r = await obtainPersonMatte({...base, budgetSec: 3, needs: behindNeeds, keyable: false, force: false, deps});
    expect(deps.extractRvm.mock.calls[0]![0].ranges).toEqual([[9.7, 12.3]]); // the behind text (priority 1) fits 3 s; the depth overlay does not
    expect(r.droppedNeeds.map(n => n.kind)).toEqual(['depth']);
    expect(r.warnings).toContain('person_matte:budget_dropped:1');
  });

  it('NOT keyable and RVM NOT configured: nothing is tried (planning falls back as before)', async () => {
    const deps = makeDeps({rvmConfigured: false});
    const r = await obtainPersonMatte({...base, needs: behindNeeds, keyable: false, force: false, deps});
    expect(r).toMatchObject({source: 'none', attempted: false, coverage: null});
    expect(deps.extractChroma).not.toHaveBeenCalled();
    expect(deps.extractRvm).not.toHaveBeenCalled();
  });

  it('RVM returns null (busy / low quality / failed): no asset, the skip reason is reported', async () => {
    const deps = makeDeps({extractRvm: vi.fn(async (args: {onSkip?: (r: string) => void}) => (args.onSkip?.('busy'), null))});
    const r = await obtainPersonMatte({...base, needs: behindNeeds, keyable: false, force: false, deps});
    expect(r).toMatchObject({source: 'none', coverage: null, attempted: true});
    expect(r.warnings).toContain('person_matte:skipped:busy');
  });

  it('an RVM that throws or an upload that fails also ends as "no asset" without throwing', async () => {
    const thrown = await obtainPersonMatte({...base, needs: behindNeeds, keyable: false, force: false, deps: makeDeps({extractRvm: vi.fn(async () => { throw new Error('boom'); })})});
    expect(thrown.source).toBe('none');
    const noUpload = await obtainPersonMatte({...base, needs: behindNeeds, keyable: false, force: false, deps: makeDeps({upload: vi.fn(async () => { throw new Error('r2 down'); })})});
    expect(noUpload.warnings).toContain('person_matte:skipped:upload_failed');
  });

  it('the forced test mode without RVM still tries the chroma key like before', async () => {
    const deps = makeDeps({rvmConfigured: false});
    const r = await obtainPersonMatte({...base, needs: [], keyable: false, force: true, deps});
    expect(deps.extractChroma).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('chroma');
  });

  it('END TO END for the Director windows: not keyable + RVM -> asset; RVM returns null -> every behind-subject / depth element is dropped', async () => {
    const behind = [{start: 10, end: 12}];
    const depth = [{start: 30, end: 33}];
    const needs = collectMatteNeeds({behindTexts: behind, depthOverlays: depth});
    const ok = makeDeps();
    const withAsset = await obtainPersonMatte({...base, needs, keyable: false, force: false, deps: ok});
    expect(ok.extractRvm).toHaveBeenCalledTimes(1);
    expect(reconcileDirectorElements({behind, depth, cutouts: [], coverage: withAsset.coverage}).warnings).toEqual([]); // both planned windows are inside the asset

    const failing = makeDeps({extractRvm: vi.fn(async () => null)});
    const noAsset = await obtainPersonMatte({...base, needs, keyable: false, force: false, deps: failing});
    const r = reconcileDirectorElements({behind, depth, cutouts: [], coverage: noAsset.coverage});
    expect(r.behind.kept).toEqual([]);
    expect(r.depth.kept).toEqual([]);
    expect(r.textBehindSkipped).toBe(true);
  });
});

describe('kinetic reuse of the Director asset (resolveKineticSubject)', () => {
  const words = ((parts: Array<[string, number]>) => parts.flatMap(([text, at]) => text.split(/\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25}))))([['And that is attention.', 14], ['Never ignore this result.', 30]]);
  const box = {x: 0.3, y: 0.4, w: 0.4, h: 0.5};
  const planInput = {skill: 'explainer' as const, durationSec: 40, words, kineticLed: true as const};
  const base = {planInput, keepSegments: SEGMENTS, activeSourcePath: '/x.mp4', matteOutputPath: '/tmp/m.webm', occupancy: {speaker: box, source: 'vision' as const}, upload: async () => ({publicUrl: 'https://cdn.example/kinetic.webm'})};
  const okExtract = async (a: {ranges: ReadonlyArray<readonly [number, number]>}) => ({path: '/tmp/m.webm', report: {...GOOD_REPORT, ranges: a.ranges.map(r => [r[0], r[1]] as [number, number])}, cached: false, elapsedMs: 1});

  it('a Director asset that covers the hero spans is reused: no second extraction', async () => {
    let calls = 0;
    const r = await resolveKineticSubject({...base, cutout: {available: true, videoUrl: 'https://cdn.example/director.webm'}, cutoutCoverage: {kind: 'windows', windows: [{start: 0, end: 40}], padSec: 0.3}, segmentationConfigured: true, extract: async a => (calls++, okExtract(a))});
    expect(calls).toBe(0);
    expect(r.foreground).toMatchObject({videoUrl: 'https://cdn.example/director.webm', source: 'existing_keyed_cutout'});
  });

  it('a range-limited Director asset that MISSES a hero span is not reused: the kinetic stage makes its own matte', async () => {
    let calls = 0;
    const r = await resolveKineticSubject({...base, cutout: {available: true, videoUrl: 'https://cdn.example/director.webm'}, cutoutCoverage: {kind: 'windows', windows: [{start: 0, end: 2}], padSec: 0.3}, segmentationConfigured: true, extract: async a => (calls++, okExtract(a))});
    expect(calls).toBe(1);
    expect(r.warnings.some(w => w.startsWith('kinetic_type:matte:director_asset_misses'))).toBe(true);
    expect(r.foreground?.videoUrl).toBe('https://cdn.example/kinetic.webm');
  });

  it('a full-length asset (chroma / provided) with no coverage given behaves exactly as before: reused, full coverage', async () => {
    let calls = 0;
    const r = await resolveKineticSubject({...base, cutout: {available: true, videoUrl: 'https://cdn.example/keyed.webm'}, segmentationConfigured: true, extract: async a => (calls++, okExtract(a))});
    expect(calls).toBe(0);
    expect(r.coverage).toEqual({kind: 'all'});
  });
});
