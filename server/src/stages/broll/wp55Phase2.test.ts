/** WP55 phase 2: real-data integration pieces (matte ranges / cache / gate, subject resolution, brand + social assets, Director candidates, compiler, prefetch guard). Offline: no python, no network. */
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';

import {cacheKey, extractSubjectMatte, matteQualityGate, outputWindowsToSourceRanges, type MatteReport} from '../../media/personMatte.ts';
import {createRvmSlots} from '../../media/rvmSlot.ts';
import {toVisualDirection} from '../directorV2/compiler.ts';
import type {CompiledElement, PerceptionPack} from '../directorV2/types.ts';
import {brandNameFor, isSocialSlot} from './kineticAssets.ts';
import {coverageContains, heroBeatsOutsideCoverage, resolveKineticSubject} from './kineticSubject.ts';
import {kineticCandidateFromDirector, locatePhrase, KINETIC_TYPE_NAMES, KINETIC_TYPE_TEMPLATES} from './kineticTypeStory.ts';
import {KINETIC_STORY_IDS, planCraftTemplateBeats} from './planCraftTemplateBeats.ts';
import type {MotionTemplateWord} from './motionTemplateCatalog.ts';
import {formatKineticTypeForDirector} from './kineticTypeCapabilities.ts';
import {LIBRARY_COMPOSITION_IDS} from '../motionDirector/libraryRegistry.ts';

const speech = (parts: Array<[string, number]>): MotionTemplateWord[] =>
  parts.flatMap(([text, at]) => text.split(/\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25})));
const GOOD: MatteReport = {frames: 300, segmented_frames: 120, fps: 30, width: 720, height: 1280, detected_ratio: 0.97, mean_area: 0.12, box: {x: 0.3, y: 0.4, w: 0.4, h: 0.55}, seconds: 7, model: 'rvm_mobilenetv3', ranges: [[1, 5]]};

const madeDirs: string[] = [];
afterAll(() => {
  for (const dir of madeDirs) rmSync(dir, {recursive: true, force: true});
});

describe('matte ranges, gate and cache', () => {
  it('maps output windows to SOURCE ranges through cuts (a window across a cut becomes two ranges)', () => {
    const segs = [{sourceStart: 0, sourceEnd: 5, outputStart: 0}, {sourceStart: 20, sourceEnd: 30, outputStart: 5}];
    expect(outputWindowsToSourceRanges(segs, [{start: 1, end: 2}], 0)).toEqual([[1, 2]]);
    expect(outputWindowsToSourceRanges(segs, [{start: 4, end: 7}], 0)).toEqual([[4, 5], [20, 22]]);
    expect(outputWindowsToSourceRanges(segs, [{start: 6, end: 8}], 0.5)).toEqual([[20.5, 23.5]]);
    expect(outputWindowsToSourceRanges(segs, [{start: 50, end: 60}])).toEqual([]);
    // overlapping / adjacent windows merge
    expect(outputWindowsToSourceRanges(segs, [{start: 1, end: 2}, {start: 2.1, end: 3}], 0)).toEqual([[1, 3]]);
  });

  it('refuses low-quality mattes (person rarely found, speck, whole frame)', () => {
    expect(matteQualityGate(GOOD).usable).toBe(true);
    expect(matteQualityGate({...GOOD, detected_ratio: 0.4}).reason).toMatch(/only_40pct/);
    expect(matteQualityGate({...GOOD, mean_area: 0.005}).reason).toBe('subject_too_small');
    expect(matteQualityGate({...GOOD, mean_area: 0.9}).reason).toBe('matte_covers_frame');
    expect(matteQualityGate({...GOOD, segmented_frames: 1}).reason).toBe('no_frames');
  });

  it('extract (RVM): runs the tool once, caches by source + ranges + variant, gates quality, never throws', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'matte-test-'));
    madeDirs.push(dir);
    const src = path.join(dir, 'src.mp4');
    writeFileSync(src, Buffer.alloc(4096, 7));
    let calls = 0;
    let report: MatteReport = GOOD;
    const seenArgs: string[][] = [];
    // the injected runner stands in for `python -m human_matting.cli <in> <out.webm> <report.json> --quality q [--ranges a-b,...] [--max-side n]`
    const runner = async (_cmd: string, args: string[]) => {
      calls++;
      seenArgs.push(args);
      writeFileSync(args[3]!, 'webm');
      writeFileSync(args[4]!, JSON.stringify(report));
      return {code: 0, stderr: '', timedOut: false};
    };
    const cacheDir = path.join(dir, 'cache');
    const common = {python: '/fake/venv/bin/python', maxSide: 640, quality: 'fast' as const};
    const a = await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'a.webm'), ranges: [[1, 5]], runner, cacheDir});
    expect(seenArgs[0]!.slice(0, 2)).toEqual(['-m', 'human_matting.cli']);
    expect(seenArgs[0]!.slice(seenArgs[0]!.indexOf('--quality'))).toEqual(['--quality', 'fast', '--ranges', '1-5', '--max-side', '640']);
    expect(a?.cached).toBe(false);
    expect(readFileSync(path.join(dir, 'a.webm'), 'utf8')).toBe('webm');
    const b = await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'b.webm'), ranges: [[1, 5]], runner, cacheDir});
    expect(b?.cached).toBe(true);
    expect(calls).toBe(1);
    await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'c.webm'), ranges: [[8, 9]], runner, cacheDir});
    expect(calls).toBe(2);
    // a different max side / quality is a different artefact: it must not reuse the cached one
    await extractSubjectMatte({...common, maxSide: 1280, inputPath: src, outputPath: path.join(dir, 'c2.webm'), ranges: [[1, 5]], runner, cacheDir});
    expect(calls).toBe(3);
    expect(cacheKey('x', [[1, 2]])).not.toBe(cacheKey('x', [[1, 3]]));
    expect(cacheKey('x', [[1, 2]], 'side=640')).not.toBe(cacheKey('x', [[1, 2]], 'side=1280'));
    // a bad matte is skipped with a reason, a crashing tool is skipped, a missing backend is skipped
    report = {...GOOD, detected_ratio: 0.2};
    const skips: string[] = [];
    expect(await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'd.webm'), ranges: [[20, 22]], runner, cacheDir, onSkip: r => skips.push(r)})).toBeNull();
    expect(skips[0]).toMatch(/^low_quality/);
    expect(await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'e.webm'), ranges: [[30, 31]], runner: async () => ({code: 3, stderr: 'boom', timedOut: false}), cacheDir, onSkip: r => skips.push(r)})).toBeNull();
    expect(skips[1]).toMatch(/^tool_failed:3/);
    expect(await extractSubjectMatte({inputPath: src, outputPath: path.join(dir, 'f.webm'), ranges: [[1, 2]], python: null, cacheDir, onSkip: r => skips.push(r)})).toBeNull(); // not configured, no runner
    expect(skips[2]).toBe('not_configured');
    // exit 4 (runtime missing), a timeout, and a busy slot each skip with their own reason; none throws
    expect(await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'g.webm'), ranges: [[40, 41]], runner: async () => ({code: 4, stderr: '', timedOut: false}), cacheDir, onSkip: r => skips.push(r)})).toBeNull();
    expect(skips[3]).toBe('not_configured');
    expect(await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'h.webm'), ranges: [[50, 51]], runner: async () => ({code: null, stderr: '', timedOut: true}), cacheDir, onSkip: r => skips.push(r)})).toBeNull();
    expect(skips[4]).toBe('timeout');
    const held = createRvmSlots(() => 1);
    const release = (await held.acquire())!;
    let ranWhileBusy = 0;
    expect(await extractSubjectMatte({...common, inputPath: src, outputPath: path.join(dir, 'i.webm'), ranges: [[60, 61]], runner: async () => (ranWhileBusy++, {code: 0, stderr: '', timedOut: false}), cacheDir, slots: held, maxWaitMs: 30, onSkip: r => skips.push(r)})).toBeNull();
    expect(skips[5]).toBe('busy');
    expect(ranWhileBusy).toBe(0);
    release();
  });
});

describe('resolveKineticSubject (real-data gates)', () => {
  const words = speech([['Welcome to the show.', 1], ['And that is attention.', 12], ['Filler goes on and on here today.', 20], ['More filler for length here today.', 30]]);
  const planInput = {skill: 'explainer' as const, durationSec: 40, words};
  const seg = [{sourceStart: 0, sourceEnd: 40, outputStart: 0}];
  const base = {planInput, keepSegments: seg, activeSourcePath: '/x.mp4', matteOutputPath: '/tmp/m.webm', upload: async () => ({publicUrl: 'https://cdn.example.com/m.webm'})};
  const okExtract = async (a: {ranges: ReadonlyArray<readonly [number, number]>}) => ({path: '/tmp/m.webm', report: {...GOOD, ranges: a.ranges.map(r => [r[0], r[1]] as [number, number])}, cached: false, elapsedMs: 1});

  it('no backend, fallback occupancy: no matte, no box, no foreground (nothing invented)', async () => {
    const r = await resolveKineticSubject({...base, occupancy: {speaker: {x: 0.1, y: 0.1, w: 0.5, h: 0.5}, source: 'fallback'}, cutout: {}, extract: okExtract, segmentationConfigured: false});
    expect(r.subjectMatte).toBeUndefined();
    expect(r.subjectBox).toBeUndefined();
    expect(r.foreground).toBeUndefined();
  });

  it('backend on + a hero beat: segments ONLY the hero ranges, uploads, returns a host foreground with real spans', async () => {
    let asked: Array<readonly [number, number]> = [];
    const r = await resolveKineticSubject({...base, occupancy: {speaker: {x: 0.3, y: 0.4, w: 0.4, h: 0.5}, source: 'vision'}, cutout: {}, segmentationConfigured: true, extract: async a => ((asked = a.ranges), okExtract(a))});
    expect(asked.length).toBe(1);
    expect(asked[0]![1] - asked[0]![0]).toBeLessThan(6); // a few seconds of a 40 s video, not the whole file
    expect(r.subjectMatte).toMatchObject({hostComposited: true});
    expect(r.foreground).toMatchObject({videoUrl: 'https://cdn.example.com/m.webm', source: 'segmentation'});
    expect(r.foreground!.spans.length).toBe(1);
    expect(r.matte!.rangeCount).toBe(1);
  });

  it('backend on but NO hero beat: no extraction cost at all', async () => {
    let calls = 0;
    const r = await resolveKineticSubject({...base, planInput: {...planInput, words: speech([['We walked along the dock together.', 5]])}, occupancy: {speaker: {x: 0.3, y: 0.4, w: 0.4, h: 0.5}, source: 'vision'}, cutout: {}, segmentationConfigured: true, extract: async a => (calls++, okExtract(a))});
    expect(calls).toBe(0);
    expect(r.foreground).toBeUndefined();
  });

  it('a failed / low-quality matte falls back with a reported reason; an existing keyed cutout is reused without extraction', async () => {
    const r = await resolveKineticSubject({...base, occupancy: {speaker: {x: 0.3, y: 0.4, w: 0.4, h: 0.5}, source: 'vision'}, cutout: {}, segmentationConfigured: true, extract: async a => (a.onSkip?.('low_quality:person_in_only_30pct_of_frames'), null)});
    expect(r.warnings).toContain('kinetic_type:matte:skipped:low_quality:person_in_only_30pct_of_frames');
    expect(r.foreground).toBeUndefined();
    expect(r.subjectBox).toMatchObject({y: 0.4}); // headroom fallback keeps the measured box
    let calls = 0;
    const keyed = await resolveKineticSubject({...base, occupancy: {speaker: {x: 0.3, y: 0.4, w: 0.4, h: 0.5}, source: 'vision'}, cutout: {available: true, videoUrl: 'https://cdn.example.com/keyed.webm'}, segmentationConfigured: true, extract: async a => (calls++, okExtract(a))});
    expect(calls).toBe(0);
    expect(keyed.foreground).toMatchObject({videoUrl: 'https://cdn.example.com/keyed.webm', source: 'existing_keyed_cutout'});
  });
});

describe('person matte coverage + the kinetic-led pre-plan (Phase B2)', () => {
  const claims = speech([['And that is attention.', 3], ['The real secret is growth.', 9], ['Never stop the trust.', 15], ['Nothing beats the truth.', 21], ['Always choose freedom today.', 27], ['It is simply success.', 33]]);
  const box = {x: 0.3, y: 0.4, w: 0.4, h: 0.5};
  const planInput = {skill: 'explainer' as const, durationSec: 40, words: claims};
  const seg = [{sourceStart: 0, sourceEnd: 40, outputStart: 0}];
  const okExtract = async (a: {ranges: ReadonlyArray<readonly [number, number]>}) => ({path: '/tmp/m.webm', report: {...GOOD, ranges: a.ranges.map(r => [r[0], r[1]] as [number, number])}, cached: false, elapsedMs: 1});
  const heroesOf = (kineticLed: boolean) =>
    planCraftTemplateBeats({...planInput, subjectMatte: {hostComposited: true, box}, subjectBox: box, kineticLed}).beats.filter(b => b.templateId === 'clip_45_type_environmental_hero');
  const resolve = async (withLed: boolean) => {
    let asked: Array<readonly [number, number]> = [];
    const r = await resolveKineticSubject({
      planInput: {...planInput, ...(withLed ? {kineticLed: true} : {})},
      keepSegments: seg, activeSourcePath: '/x.mp4', matteOutputPath: '/tmp/m.webm', upload: async () => ({publicUrl: 'https://cdn.example.com/m.webm'}),
      occupancy: {speaker: box, source: 'vision'}, cutout: {}, segmentationConfigured: true, extract: async a => ((asked = a.ranges), okExtract(a)),
    });
    return {asked, r};
  };
  const covered = (asked: ReadonlyArray<readonly [number, number]>, b: {start: number; end: number}) => asked.some(([a, z]) => a <= b.start + 1e-6 && z >= b.end - 1e-6);

  it('kinetic-led plans more hero beats than the sparse planner (the case the old pre-plan got wrong)', () => {
    expect(heroesOf(true).length).toBeGreaterThan(heroesOf(false).length);
    expect(heroesOf(true).length).toBeGreaterThanOrEqual(2);
  });

  it('with kineticLed in the pre-plan, the extracted ranges cover EVERY real kinetic-led hero beat', async () => {
    const real = heroesOf(true);
    const {asked, r} = await resolve(true);
    expect(asked.length).toBeGreaterThan(0);
    for (const b of real) expect(covered(asked, b), `hero ${b.start.toFixed(2)}-${b.end.toFixed(2)} not covered by ${JSON.stringify(asked)}`).toBe(true);
    expect(r.coverage).toMatchObject({kind: 'windows', padSec: 0.3});
  });

  it('control: the OLD pre-plan (no kineticLed) leaves at least one real hero outside the matte ranges, and the coverage guard catches exactly those', async () => {
    const real = heroesOf(true);
    const {asked, r} = await resolve(false);
    const missing = real.filter(b => !covered(asked, b));
    expect(missing.length).toBeGreaterThan(0);
    const published = real.map(beat => ({beat: {templateId: beat.templateId, start: beat.start, end: beat.end}, graphic: {id: beat.id}}));
    const dropped = heroBeatsOutsideCoverage(published, r.coverage);
    expect(dropped.map(d => d.graphic.id).sort()).toEqual(missing.map(b => b.id).sort());
  });

  it('coverageContains: padded windows, merging, and "all"', () => {
    const cov = {kind: 'windows' as const, windows: [{start: 10, end: 12}], padSec: 0.3};
    expect(coverageContains(cov, 10, 12)).toBe(true);
    expect(coverageContains(cov, 9.75, 12.25)).toBe(true); // inside the +-0.3 s pad
    expect(coverageContains(cov, 9.6, 11)).toBe(false);
    expect(coverageContains(cov, 11, 12.4)).toBe(false);
    const two = {kind: 'windows' as const, windows: [{start: 10, end: 12}, {start: 12.5, end: 14}], padSec: 0.3};
    expect(coverageContains(two, 11, 14)).toBe(true); // the padded windows touch, so one beat may span both
    expect(coverageContains({...two, windows: [{start: 10, end: 12}, {start: 20, end: 22}]}, 11, 21)).toBe(false);
    expect(coverageContains({kind: 'all'}, 0, 999)).toBe(true);
  });

  it('heroBeatsOutsideCoverage only ever concerns hero beats, and nothing is dropped for a keyed (full-length) cutout or no coverage', () => {
    const hero = {beat: {templateId: 'clip_45_type_environmental_hero', start: 30, end: 32}, graphic: {id: 'a'}};
    const other = {beat: {templateId: 'clip_47_type_staggered_phrase', start: 30, end: 32}, graphic: {id: 'b'}};
    const cov = {kind: 'windows' as const, windows: [{start: 10, end: 12}], padSec: 0.3};
    expect(heroBeatsOutsideCoverage([hero, other], cov)).toEqual([hero]);
    expect(heroBeatsOutsideCoverage([hero, other], {kind: 'all'})).toEqual([]);
    expect(heroBeatsOutsideCoverage([hero, other], undefined)).toEqual([]);
  });

  it('a keyed cutout (the chroma fast path) is reused untouched and reports full coverage', async () => {
    let calls = 0;
    const r = await resolveKineticSubject({
      planInput: {...planInput, kineticLed: true}, keepSegments: seg, activeSourcePath: '/x.mp4', matteOutputPath: '/tmp/m.webm', upload: async () => ({publicUrl: 'x'}),
      occupancy: {speaker: box, source: 'vision'}, cutout: {available: true, videoUrl: 'https://cdn.example.com/keyed.webm'}, segmentationConfigured: true, extract: async a => (calls++, okExtract(a)),
    });
    expect(calls).toBe(0);
    expect(r.coverage).toEqual({kind: 'all'});
    expect(r.foreground).toMatchObject({source: 'existing_keyed_cutout'});
  });
});

describe('brand + social assets are creator-provided only', () => {
  it('brand name: explicit wins; uploaded logo label next; generic or un-uploaded labels give nothing', () => {
    expect(brandNameFor('  Northwind ', [])).toBe('Northwind');
    expect(brandNameFor(undefined, [{kind: 'logo', status: 'uploaded', label: 'Northwind Realty logo'}])).toBe('Northwind Realty');
    expect(brandNameFor(undefined, [{kind: 'logo', status: 'uploaded', label: 'Your logo'}])).toBeUndefined();
    expect(brandNameFor(undefined, [{kind: 'logo', status: 'needed', label: 'Northwind logo'}])).toBeUndefined();
    expect(brandNameFor('x', [])).toBeUndefined();
  });
  it('social slots: only uploaded screenshots labelled as the creator\'s own posts', () => {
    const slot = (label: string, status: 'uploaded' | 'needed' = 'uploaded', kind: 'screenshot' | 'product' = 'screenshot') => ({kind, status, label, userAssetId: 'u1'});
    expect(isSocialSlot(slot('My Instagram post'))).toBe(true);
    expect(isSocialSlot(slot('Dashboard screenshot'))).toBe(false);
    expect(isSocialSlot(slot('My Instagram post', 'needed'))).toBe(false);
    expect(isSocialSlot(slot('Instagram post', 'uploaded', 'product'))).toBe(false);
  });
});

describe('live Director candidates', () => {
  const talk = speech([['Welcome to the channel.', 2], ['And that is attention.', 12], ['Good editing feels invisible.', 20], ['We sell homes, not houses.', 26], ['Just DM me for a free video.', 34]]);
  const phrase = (text: string, template: string, extra: Record<string, unknown> = {}) => {
    const w = talk.find(x => x.text === text.split(' ')[0])!;
    return {template, text, start: w.start, end: w.start + text.split(' ').length * 0.3, ...extra};
  };
  const allowed = new Set<string>(KINETIC_STORY_IDS);
  const ctx = {durationSec: 40, subjectBox: {x: 0.3, y: 0.4, w: 0.4, h: 0.5}, hasMatte: true};

  it('the shared template name table matches the catalog ids', () => {
    expect(KINETIC_TYPE_NAMES.map(n => KINETIC_TYPE_TEMPLATES[n])).toEqual([...KINETIC_STORY_IDS]);
  });

  it('locates the exact phrase only inside the Director window, and rejects invented phrases', () => {
    expect(locatePhrase(talk, 'attention', 12.5, 13.5)?.map(w => w.text)).toEqual(['attention.']);
    expect(locatePhrase(talk, 'attention', 2, 3)).toBeNull();
    const r = kineticCandidateFromDirector({template: 'type_staggered_phrase', text: 'guaranteed growth', start: 12, end: 13}, talk, ctx, allowed);
    expect(r.rejected).toBe('phrase_not_in_transcript_window');
  });

  it('builds Director choices with the same builders, waiving only the semantic cue gates', () => {
    const hero = kineticCandidateFromDirector(phrase('attention.', 'type_environmental_hero', {start: 12.5, end: 13.6}), talk, ctx, allowed);
    expect(hero.candidate).toMatchObject({templateId: 'clip_45_type_environmental_hero', score: 1, hint: {text: 'attention'}});
    const noBox = kineticCandidateFromDirector({template: 'type_environmental_hero', text: 'attention.', start: 12.5, end: 13.6}, talk, {durationSec: 40}, allowed);
    expect(noBox.rejected).toBe('subject_unmeasured');
    const cta = kineticCandidateFromDirector({template: 'type_kinetic_cta', text: 'Just DM me for a free video.', start: 34, end: 36}, talk, ctx, allowed);
    expect(cta.candidate?.templateId).toBe('clip_53_type_kinetic_cta');
    // CTA structure still needs a real invitation: a plain phrase is not buildable
    expect(kineticCandidateFromDirector({template: 'type_kinetic_cta', text: 'Good editing feels invisible.', start: 20, end: 22}, talk, ctx, allowed).rejected).toBe('not_buildable_from_phrase');
    // asset gates still apply: no stills and no figure -> no social proof
    expect(kineticCandidateFromDirector({template: 'type_floating_social_proof', text: 'Welcome to the channel.', start: 2, end: 3.5}, talk, ctx, allowed).rejected).toBe('not_buildable_from_phrase');
    expect(kineticCandidateFromDirector({template: 'type_nonsense', text: 'attention', start: 12, end: 13}, talk, ctx, allowed).rejected).toBe('unknown_template');
    expect(kineticCandidateFromDirector(phrase('attention.', 'type_environmental_hero', {start: 12.5, end: 13.6}), talk, ctx, new Set()).rejected).toBe('template_not_allowed');
  });

  it('planner: owned with ≥1 accepted pick is Director-only; WP56 owned-empty falls back to deterministic', () => {
    const plan = (directed?: {candidates: any[]; owned: boolean}) => planCraftTemplateBeats({skill: 'explainer', durationSec: 40, words: talk, subjectBox: ctx.subjectBox, directed});
    const story = (p: ReturnType<typeof plan>) => p.beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId));
    // WP56: empty owned is NOT "skip kinetic" — deterministic fills
    const emptyOwned = plan({candidates: [], owned: true});
    expect(emptyOwned.warnings).toContain('kinetic_type:director_empty_fallback');
    expect(story(emptyOwned).length).toBeGreaterThan(0);
    const one = plan({candidates: [{template: 'type_staggered_phrase', text: 'Good editing feels invisible.', start: 20, end: 22}], owned: true});
    expect(story(one).map(b => b.templateId)).toEqual(['clip_47_type_staggered_phrase']);
    expect(one.warnings).toContain('kinetic_type:director:1_of_1:owned');
    const bad = plan({candidates: [{template: 'type_staggered_phrase', text: 'never said this', start: 20, end: 22}], owned: true});
    expect(bad.warnings).toContain('kinetic_type:director_rejected:type_staggered_phrase:phrase_not_in_transcript_window');
    expect(bad.warnings).toContain('kinetic_type:director_empty_fallback');
    expect(story(bad).length).toBeGreaterThan(0);
    expect(story(plan(undefined)).length).toBeGreaterThan(0);
    // skill allowlist still wins over the Director
    const faceless = planCraftTemplateBeats({skill: 'faceless', durationSec: 40, words: talk, directed: {candidates: [{template: 'type_environmental_hero', text: 'attention.', start: 12.5, end: 13.6}], owned: true}});
    expect(faceless.warnings).toContain('kinetic_type:director_rejected:type_environmental_hero:template_not_allowed');
  });

  it('compiler: with the family offered, kinetic_text + type_template becomes a candidate (not a legacy graphic); an empty list is kept; without the offer nothing changes', () => {
    const el = (extra: Record<string, unknown>) => ({id: 'e1', beatId: 'b', intent: 'strong claim', kind: 'kinetic_text', text: 'attention', start: 12.5, end: 13.6, params: {...extra}}) as unknown as CompiledElement;
    const plan = {editThesis: 't', caption: {}, hookTitle: '', hookStyle: 'bold', suggestedLutIds: [], estimatedCostUsd: 0} as never;
    const pack = {} as PerceptionPack;
    const on = toVisualDirection(plan, [el({typeTemplate: 'type_environmental_hero'})], pack, {kineticType: true});
    expect(on.kineticType).toEqual([{template: 'type_environmental_hero', text: 'attention', start: 12.5, end: 13.6, reason: 'strong claim'}]);
    expect(on.motionGraphics).toEqual([]);
    expect(toVisualDirection(plan, [el({})], pack, {kineticType: true}).kineticType).toEqual([]);
    const off = toVisualDirection(plan, [el({typeTemplate: 'type_environmental_hero'})], pack);
    expect(off.kineticType).toBeUndefined();
    expect(off.motionGraphics.length).toBe(1);
  });

  it('the prompt block is only produced for allowed skills and carries the "may choose none" rule', () => {
    const impl = new Set<string>(LIBRARY_COMPOSITION_IDS);
    expect(formatKineticTypeForDirector('explainer', impl)).toMatch(/Do not animate every sentence/);
    expect(formatKineticTypeForDirector('textual_mg', impl)).toBe('');
  });
});
