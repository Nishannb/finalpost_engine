import {describe, expect, it} from 'vitest';

import {StaticCamera, type CameraTrack} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {fixtureShots, fixtureWords} from './fixtures.ts';
import {eventBlockAabbAt, marginInside} from './geometry.ts';
import {HERO_OCC_HARD_MAX, SUPPORT_OCC_MAX, lineOcclusions, verifyRenderSpec} from './guardrails.ts';
import {solveLayout, type SolveInput} from './layout.ts';
import {resolvePlan} from './plan.ts';
import {PRESETS} from './presets.ts';
import {brandConfigSchema, PRESET_NAMES, renderSpecSchema, type KineticPlan, type PresetName, type TextEvent} from './schema.ts';
import {buildScene, type AlphaGrid, type ShotScene} from './scene.ts';
import {shortsSafeRect} from '../broll/heroSweep.ts';

const brand = brandConfigSchema.parse({});
const words = fixtureWords();
const shots = fixtureShots(words);
const depth = new SubjectBandDepth();
const subject = {x: 0.28, y: 0.3, w: 0.44, h: 0.65};
const scene = (over: Partial<Parameters<typeof buildScene>[0]> = {}) => buildScene({shotId: 'shot-0', subjectBox: subject, ...over});

function ev(preset: PresetName, over: Partial<TextEvent> = {}): TextEvent {
  const def = PRESETS[preset];
  const [lo] = def.lines;
  const toks = ['Believe', 'tired', 'Stand', 'out', 'every'];
  const roles = (['support', 'hero', 'support', 'hero'] as const).slice(0, Math.max(lo, 1));
  const lines = (def.lines[0] === 1 ? [{text: 'Believe', role: def.hasHero ? 'hero' : 'caption'}] : roles.map((r, i) => ({text: toks[i % toks.length]!, role: def.hasHero ? (i === def.lines[0] - 1 ? 'hero' : r) : 'caption'}))) as TextEvent['lines'];
  return {id: `e-${preset}`, shotId: 'shot-0', wordRange: [4, 6], lines, preset, layering: 'auto', anchor: 'auto', regionHint: 'auto', ...over};
}
const planOf = (...events: TextEvent[]): KineticPlan => ({version: '1', events});
function solve(plan: KineticPlan, over: Partial<SolveInput> = {}, size = {width: 720, height: 1280}) {
  return solveLayout({plan, words, shots, scenes: {'shot-0': scene()}, depth, brand, ...size, fps: 30, seed: 7, planSource: 'test', ...over});
}
const fullGrid = (): AlphaGrid => ({cols: 36, rows: 64, samples: [{frame: 0, bits: Buffer.alloc(36 * 64, 255).toString('base64')}]});

describe('solver: safe rect', () => {
  for (const size of [{width: 720, height: 1280}, {width: 1080, height: 1920}]) {
    it(`keeps every sampled keyframe of every preset inside shortsSafeRect on ${size.width}x${size.height}`, () => {
      const safe = shortsSafeRect(size.width, size.height);
      const {spec} = solve(planOf(...PRESET_NAMES.map((p, i) => ({...ev(p), id: `e${i}`, wordRange: [i % 5, (i % 5) + 1] as [number, number]}))), {}, size);
      expect(spec.events.length).toBeGreaterThan(0);
      for (const e of spec.events) {
        for (let f = e.inFrame; f <= e.outFrame; f += 1) expect(marginInside(eventBlockAabbAt(e, f), safe)).toBeGreaterThanOrEqual(-0.5 - 1e-6);
        expect(e.safeProof.ok).toBe(true);
      }
      expect(renderSpecSchema.safeParse(spec).success).toBe(true);
    });
  }
  it('also holds with a long word and a 3D plane (perspective keyframes)', () => {
    const long = {...ev('plane3d.receding.swap'), lines: [{text: 'extraordinary', role: 'hero' as const}]};
    const {spec} = solve(planOf(long));
    const safe = shortsSafeRect(720, 1280);
    for (const e of spec.events) for (let f = e.inFrame; f <= e.outFrame; f += 1) expect(marginInside(eventBlockAabbAt(e, f), safe)).toBeGreaterThanOrEqual(-0.5 - 1e-6);
  });
});

describe('solver: occlusion + forced front', () => {
  it('a typical behind hero lands inside the hard cap and (when behind) near the readable target', () => {
    const {spec} = solve(planOf(ev('hero.gradientWord.behind', {layering: 'behind'})));
    const e = spec.events[0]!;
    if (e.layering === 'behind') {
      expect(e.occlusionFraction.max).toBeLessThanOrEqual(HERO_OCC_HARD_MAX);
      expect(e.occlusionFraction.mean).toBeGreaterThanOrEqual(0);
      expect(e.occlusionFraction.mean).toBeLessThanOrEqual(HERO_OCC_HARD_MAX);
    }
  });
  it('hero occlusion above the hard cap flips to front', () => {
    // the alpha grid says the whole frame is subject; the box / area are small so only the occlusion rule can decide
    const sc = scene({grid: fullGrid(), alphaAreaFrac: 0.3, subjectBox: {x: 0.42, y: 0.55, w: 0.16, h: 0.2}});
    const {spec, report} = solve(planOf(ev('hero.gradientWord.behind', {layering: 'behind'})), {scenes: {'shot-0': sc}});
    expect(spec.events[0]!.layering).toBe('front');
    expect(report.actions.some(a => a.action === 'flip-front')).toBe(true);
    expect(verifyRenderSpec(spec, {scenes: {'shot-0': sc}, depth, shots}).filter(v => v.rule === 'hero-occlusion')).toEqual([]);
  });
  it('subject alpha area > 0.55 forces front', () => {
    const {spec} = solve(planOf(ev('stack.condensedHero.behind', {layering: 'behind'})), {scenes: {'shot-0': scene({alphaAreaFrac: 0.6})}});
    expect(spec.events.every(e => e.layering === 'front')).toBe(true);
    expect(spec.events[0]!.notes.join(' ')).toMatch(/forced front/);
  });
  it('hero box overlapping the subject bbox > 70% forces front', () => {
    const sc = scene({subjectBox: {x: 0.05, y: 0.2, w: 0.9, h: 0.75}, alphaAreaFrac: 0.4});
    const {spec} = solve(planOf(ev('hero.gradientWord.behind', {layering: 'behind'})), {scenes: {'shot-0': sc}});
    expect(spec.events[0]!.layering).toBe('front');
  });
  it('support / caption lines behind the subject stay <= 5% occluded', () => {
    const sc = scene();
    const e = ev('stack.serifHero.behind', {layering: 'behind', lines: [{text: 'tired', role: 'support'}, {text: 'Believe', role: 'hero'}]});
    const {spec} = solve(planOf(e), {scenes: {'shot-0': sc}});
    const out = spec.events[0]!;
    if (out.layering === 'behind') {
      const occ = lineOcclusions(out, sc, depth, 720, 1280);
      out.lines.forEach((l, i) => { if (l.role !== 'hero') expect(occ[i]!.max).toBeLessThanOrEqual(SUPPORT_OCC_MAX + 1e-9); });
    }
    expect(verifyRenderSpec(spec, {scenes: {'shot-0': sc}, depth, shots}).filter(v => v.rule === 'support-occlusion')).toEqual([]);
  });
  it('front text stays off the face keep-out', () => {
    const {spec} = solve(planOf(ev('hero.thinSerif.front')));
    expect(verifyRenderSpec(spec, {scenes: {'shot-0': scene()}, depth, shots}).filter(v => v.rule === 'face-keepout')).toEqual([]);
  });
  it('twoHero.depth solves layering independently', () => {
    const e = ev('stack.twoHero.depth', {lines: [{text: 'Stand', role: 'hero'}, {text: 'out', role: 'hero'}], wordRange: [8, 9]});
    const {spec} = solve(planOf(e));
    expect(spec.events.map(x => x.id)).toEqual(['e-stack.twoHero.depth.a', 'e-stack.twoHero.depth.b']);
    expect(spec.events[1]!.layering).toBe('front');
  });
});

describe('solver: determinism, no matte, corrupt plan', () => {
  it('same inputs -> deep-equal RenderSpec', () => {
    const plan = planOf(...PRESET_NAMES.slice(0, 8).map((p, i) => ({...ev(p), id: `e${i}`, wordRange: [i, i + 1] as [number, number]})));
    expect(solve(plan).spec).toEqual(solve(plan).spec);
    expect(solve(plan, {seed: 8}).spec.seed).toBe(8);
  });
  it('missing matte -> every event in front, the job still returns a spec', () => {
    const sc = buildScene({shotId: 'shot-0', noMatte: true});
    const plan = planOf(ev('hero.gradientWord.behind', {layering: 'behind'}), {...ev('stack.condensedHero.behind', {layering: 'behind'}), id: 'e2', wordRange: [10, 11]});
    const {spec} = solve(plan, {scenes: {'shot-0': sc}});
    expect(spec.noMatte).toBe(true);
    expect(spec.events.length).toBeGreaterThan(0);
    expect(spec.events.every(e => e.layering === 'front')).toBe(true);
    const {spec: none} = solve(plan, {scenes: {}});
    expect(none.events.every(e => e.layering === 'front')).toBe(true);
  });
  it('corrupted plan -> fallback spec, no throw', () => {
    for (const raw of [{version: '1', events: [{nope: 1}]}, 'garbage', 42, {version: '1', events: [{...ev('fallback.boldCenter.front'), x: 10}]}, {version: '1', events: [{...ev('fallback.boldCenter.front'), lines: [{text: 'invented', role: 'hero'}]}]}]) {
      const r = resolvePlan(raw, words, shots);
      expect(r.source).toBe('fallback');
      expect(r.reason).toBeTruthy();
      const {spec} = solve(r.plan);
      expect(spec.events.length).toBeGreaterThan(0);
    }
  });
  it('a valid director plan is kept', () => expect(resolvePlan(planOf(ev('hero.gradientWord.behind')), words, shots).source).toBe('director'));
});

describe('solver: camera, cuts, density, contrast', () => {
  const wild: CameraTrack = {shotId: 'shot-0', source: 'test', samples: Array.from({length: 60}, (_, f) => ({frame: f, scale: 1, tx: f % 2 ? 40 : -40, ty: 0}))};
  it('downgrades plane -> background -> screen when the camera jitters', () => {
    const e = ev('hero.extruded3d.worldAnchored', {anchor: 'plane:wall'});
    expect(solve(planOf(e), {cameras: {'shot-0': new StaticCamera().track(shots[0]!)}}).spec.events[0]!.anchor).toBe('plane:wall');
    const r = solve(planOf(e), {cameras: {'shot-0': wild}});
    expect(r.spec.events[0]!.anchor).toBe('screen');
    expect(r.report.anchorDowngrades.length).toBeGreaterThan(0);
    const mild: CameraTrack = {shotId: 'shot-0', source: 'test', samples: Array.from({length: 60}, (_, f) => ({frame: f, scale: 1, tx: f % 2 ? 0.5 : -0.5, ty: 0}))};
    expect(['background']).toContain(solve(planOf(e), {cameras: {'shot-0': mild}}).spec.events[0]!.anchor);
  });
  it('a static camera keeps a background-anchored event fixed; a moving camera moves it', () => {
    const e = ev('stack.condensedHero.behind', {anchor: 'background'});
    const st = solve(planOf(e)).spec.events[0]!;
    // the hold now eases its scale up ~4% (never static), so the safe-rect clamp may nudge x by a pixel or two; the camera must not move it
    const spread = (e: typeof st) => { const xs = e.keyframes.filter(k => k.opacity >= 1 && k.blurPx < 1).map(k => k.x); return Math.max(...xs) - Math.min(...xs); };
    expect(spread(st)).toBeLessThan(4);
    const pan: CameraTrack = {shotId: 'shot-0', source: 'test', samples: [{frame: 0, scale: 1, tx: 0, ty: 0}, {frame: 120, scale: 1, tx: 30, ty: 0}]};
    const mv = solve(planOf(e), {cameras: {'shot-0': pan}}).spec.events[0]!;
    expect(spread(mv)).toBeGreaterThan(spread(st) + 2);
  });
  it('no event crosses a cut unless persistAcrossCut', () => {
    const cutShots = [{id: 'shot-0', startFrame: 0, endFrame: 60}, {id: 'shot-1', startFrame: 60, endFrame: 400}];
    const w = words;
    const idx = w.findIndex(x => x.endFrame > 60 && x.startFrame < 58);
    const base = (persist: boolean): TextEvent => ({...ev('fallback.boldCenter.front'), wordRange: [Math.max(0, idx), Math.max(0, idx) + 1], persistAcrossCut: persist});
    const sc = {'shot-0': scene(), 'shot-1': scene({shotId: 'shot-1'})};
    const a = solveLayout({plan: planOf(base(false)), words: w, shots: cutShots, scenes: sc, depth, brand, width: 720, height: 1280, fps: 30, seed: 1, planSource: 't'}).spec.events[0];
    if (a) expect(a.outFrame).toBeLessThanOrEqual(60);
    const b = solveLayout({plan: planOf(base(true)), words: w, shots: cutShots, scenes: sc, depth, brand, width: 720, height: 1280, fps: 30, seed: 1, planSource: 't'}).spec.events[0]!;
    expect(b.persistAcrossCut).toBe(true);
    expect(verifyRenderSpec(solveLayout({plan: planOf(base(false)), words: w, shots: cutShots, scenes: sc, depth, brand, width: 720, height: 1280, fps: 30, seed: 1, planSource: 't'}).spec, {scenes: sc, depth, shots: cutShots}).filter(v => v.rule === 'cut')).toEqual([]);
  });
  it('two unrelated heroes are separated by >= 6 frames and never active together', () => {
    const a = {...ev('hero.gradientWord.behind'), id: 'a', wordRange: [2, 4] as [number, number]};
    const b = {...ev('hero.goldGlow.behind'), id: 'b', wordRange: [5, 6] as [number, number]};
    const {spec} = solve(planOf(a, b));
    const vs = verifyRenderSpec(spec, {scenes: {'shot-0': scene()}, depth, shots}).filter(v => v.rule === 'gap' || v.rule === 'density-hero');
    expect(vs).toEqual([]);
  });
  it('adds a stroke when the fill has < 3:1 contrast with the plate', () => {
    const light = buildScene({shotId: 'shot-0', subjectBox: subject, luminance: 0.95});
    const {spec} = solve(planOf(ev('fallback.boldCenter.front')), {scenes: {'shot-0': light}});
    expect(spec.events[0]!.shadow.strokePx).toBeGreaterThan(0);
    const dark = buildScene({shotId: 'shot-0', subjectBox: subject, luminance: 0.05});
    expect(solve(planOf(ev('fallback.boldCenter.front')), {scenes: {'shot-0': dark}}).spec.events[0]!.shadow.strokePx).toBe(0);
  });
  it('sequence / swap / perLetter reveal frames come from the transcript', () => {
    const seq = {...ev('hero.gradientWord.sequence'), wordRange: [4, 6] as [number, number], lines: [{text: 'Believe in yourself!', role: 'hero' as const}]};
    const s = solve(planOf(seq)).spec.events[0]!;
    expect(s.lines[0]!.revealFrames).toHaveLength(3);
    expect(s.lines[0]!.wordFills).toHaveLength(3);
    const swap = {...ev('plane3d.receding.swap'), wordRange: [4, 8] as [number, number], lines: [{text: 'Believe in', role: 'support' as const}, {text: 'be yourself', role: 'hero' as const, swapSlot: {wordIdxSequence: [4, 6, 8]}}]};
    const w = solve(planOf(swap)).spec.events[0]!;
    expect(w.lines.find(l => l.swapWords.length)!.swapWords).toHaveLength(3);
    const pl = solve(planOf({...ev('hero.perLetter.behind'), lines: [{text: 'Believe', role: 'hero'}]})).spec.events[0]!;
    expect(pl.lines[0]!.revealFrames).toHaveLength(7);
  });
});
