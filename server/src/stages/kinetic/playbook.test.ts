import {describe, expect, it} from 'vitest';

import {shortsSafeRect} from '../broll/heroSweep.ts';
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {buildFallbackPlan} from './fallback.ts';
import {fixtureShots, fixtureWords} from './fixtures.ts';
import {marginInside, restingMargin, wordAabbAt} from './geometry.ts';
import {verifyRenderSpec} from './guardrails.ts';
import {solveLayout} from './layout.ts';
import {entryFrames, exitFrames, interpolateWordKeys} from './motion.ts';
import {buildScene, type Box} from './scene.ts';
import {brandConfigSchema, type KineticPlan, type KineticWord, type RenderEvent, type StyleName, type TextEvent} from './schema.ts';

const brand = brandConfigSchema.parse({});
const depth = new SubjectBandDepth();
const W = 720, H = 1280;
const mkWords = (): KineticWord[] => ['i', 'feel', 'like', 'giving', 'up'].map((text, idx) => ({idx, text, startFrame: 20 + idx * 14, endFrame: 32 + idx * 14, emphasisScore: 0.8}));
const shots = [{id: 's', startFrame: 0, endFrame: 200}];
const lines: TextEvent['lines'] = [{text: 'i feel like', role: 'connector'}, {text: 'giving', role: 'hero'}, {text: 'up', role: 'support'}];
const ev = (over: Partial<TextEvent> = {}): TextEvent => ({id: 'e', shotId: 's', wordRange: [0, 4], lines, preset: 'type.words', layering: 'auto', anchor: 'auto', regionHint: 'auto', ...over});
function solve(style: StyleName, box: Box, over: Partial<TextEvent> = {}, words = mkWords(), size = {width: W, height: H}) {
  const scene = buildScene({shotId: 's', subjectBox: box, luminance: 0.07, width: size.width, height: size.height});
  const plan: KineticPlan = {version: '1', style, events: [ev(over)]};
  return solveLayout({plan, words, shots, scenes: {s: scene}, cameras: {s: new StaticCamera().track(shots[0]!)}, depth, brand, ...size, fps: 30, seed: 3, planSource: 't'});
}
const LEFT: Box = {x: 0.04, y: 0.3, w: 0.4, h: 0.62};
const RIGHT: Box = {x: 0.56, y: 0.3, w: 0.4, h: 0.62};
const CENTRE: Box = {x: 0.36, y: 0.3, w: 0.28, h: 0.62};
const heroOf = (e: RenderEvent) => e.lines.find(l => l.role === 'hero')!;

describe('styles', () => {
  for (const style of ['cinematicClean', 'editorialLuxury'] as const) {
    it(`${style}: no glow, one white fill`, () => {
      const {spec} = solve(style, LEFT);
      for (const e of spec.events) {
        expect(e.shadow.glowPx).toBe(0);
        for (const l of e.lines) { expect(l.glow).toBeNull(); expect(l.fill.colors).toEqual(['#FFFFFF']); }
      }
    });
  }
  it('retroNeon: at most one coloured word per block, glow only on it', () => {
    const {spec} = solve('retroNeon', LEFT);
    for (const e of spec.events) {
      const coloured = e.lines.filter(l => l.fill.colors[0] !== '#FFFFFF');
      expect(coloured.length).toBeLessThanOrEqual(1);
      for (const l of e.lines) expect(l.glow !== null).toBe(coloured.includes(l));
      // a library entry (IN-*), never the old single E5; the colour is the plate-derived accent, not the storyboard sheet cycle
      expect(heroOf(e).anim).toMatch(/^IN-\d+$/);
      for (const c of coloured) expect(['#F2C14E', '#E6FF3B', '#4FD8C9', '#FF4FA8']).not.toContain(c.fill.colors[0]!.toUpperCase());
    }
  });
});

describe('sizes + roles', () => {
  it('hero / connector px ratio is 2..3.6, hero takes a library entry, connectors IN-1 / IN-3', () => {
    for (const style of ['cinematicClean', 'editorialLuxury', 'retroNeon'] as const) {
      for (const box of [LEFT, RIGHT, CENTRE]) {
        for (const e of solve(style, box).spec.events) {
          const c = e.lines.find(l => l.role === 'connector'), h = e.lines.find(l => l.role === 'hero');
          if (c && h) { const r = h.fontPx / c.fontPx; expect(r).toBeGreaterThanOrEqual(2); expect(r).toBeLessThanOrEqual(3.6); }
        }
      }
    }
    const e = solve('cinematicClean', LEFT).spec.events[0]!;
    expect(heroOf(e).anim).toMatch(/^IN-\d+$/);
    expect(['IN-1', 'IN-3']).toContain(e.lines.find(l => l.role === 'connector')!.anim);
    expect(e.lines.find(l => l.role === 'connector')!.textOpacity).toBe(0.9);
  });
});

describe('layout: gutter first', () => {
  it('centred narrow subject, ONE phrase -> one block in one column (never a flank split), hero not through the face', () => {
    const {spec} = solve('cinematicClean', CENTRE, {lines: [{text: 'i feel like', role: 'connector'}, {text: 'done', role: 'hero'}, {text: 'now', role: 'support'}]}, ['i', 'feel', 'like', 'done', 'now'].map((text, idx) => ({idx, text, startFrame: 20 + idx * 14, endFrame: 32 + idx * 14, emphasisScore: 0.8})));
    expect(spec.events).toHaveLength(1);
    expect(spec.events[0]!.zone).not.toBe('flank');
    const hero = spec.events[0]!;
    const box = CENTRE;
    const f = hero.keyframes[Math.floor(hero.keyframes.length / 2)]!.frame;
    const r = wordAabbAt(hero, heroOf(hero), f);
    const eye = {x: (box.x + box.w / 2) * W, y: (box.y + 0.15 * box.h) * H};
    expect(eye.x >= r.left && eye.x <= r.right && eye.y >= r.top && eye.y <= r.bottom).toBe(false);
  });
  it('a short hero beside a left subject goes to the open right gutter; beside a right subject, to the left', () => {
    const short: Partial<TextEvent> = {lines: [{text: 'go', role: 'hero'}], wordRange: [3, 3]};
    const narrowL: Box = {x: 0.04, y: 0.3, w: 0.3, h: 0.62}, narrowR: Box = {x: 0.66, y: 0.3, w: 0.3, h: 0.62};
    const l = solve('cinematicClean', narrowL, short).spec.events[0]!, r = solve('cinematicClean', narrowR, short).spec.events[0]!;
    expect(l.zone).toBe('besideRight');
    expect(r.zone).toBe('besideLeft');
    const cx = (e: RenderEvent) => { const kf = e.keyframes[1]!; const hl = heroOf(e); return kf.x - e.block.w / 2 + hl.dx + hl.w / 2; };
    expect(cx(l)).toBeGreaterThan((narrowL.x + narrowL.w) * W);
    expect(cx(r)).toBeLessThan(narrowR.x * W);
  });
  it('resting ink stays inside shortsSafeRect on every hold frame (720 and 1080)', () => {
    for (const size of [{width: 720, height: 1280}, {width: 1080, height: 1920}]) {
      const safe = shortsSafeRect(size.width, size.height);
      for (const style of ['cinematicClean', 'editorialLuxury', 'retroNeon'] as const) for (const box of [LEFT, RIGHT, CENTRE, {x: 0.3, y: 0.3, w: 0.4, h: 0.62}]) {
        const {spec} = solve(style, box, {}, mkWords(), size);
        for (const e of spec.events) expect(restingMargin(e, safe)).toBeGreaterThanOrEqual(-0.5 - 1e-6);
        expect(verifyRenderSpec(spec, {scenes: {s: buildScene({shotId: 's', subjectBox: box, luminance: 0.07, ...size})}, depth, shots}).filter(v => v.rule === 'safe-rect' || v.rule === 'face-keepout')).toEqual([]);
      }
    }
  });
  it('running zone: centred, ~66% height, below the face, one word at a time with X2 swap', () => {
    const words = mkWords();
    const {spec} = solve('cinematicClean', {x: 0.28, y: 0.3, w: 0.44, h: 0.65}, {lines: [{text: 'i feel like giving up', role: 'running'}], regionHint: 'running'}, words);
    const e = spec.events[0]!;
    expect(e.zone).toBe('running');
    expect(e.keyframes[1]!.y).toBeGreaterThan(0.6 * H);
    expect(e.lines.slice(0, -1).every(l => l.exitFrame !== null)).toBe(true);
    const f = words[2]!.startFrame + 3;
    const vis = e.lines.filter(l => interpolateWordKeys(l.wordKeyframes, f).opacity > 0.05);
    expect(vis.length).toBeLessThanOrEqual(2);
  });
});

describe('motion', () => {
  const e = solve('cinematicClean', LEFT).spec.events[0]!;
  it('a word is first visible 1 or 2 frames BEFORE its speech start, never after', () => {
    const words = mkWords();
    e.lines.forEach((l, i) => {
      const startAbs = e.inFrame + l.startFrame;
      const first = l.wordKeyframes.find(k => k.opacity > 0 && k.mask > 0)!.frame;
      expect(startAbs - first).toBeGreaterThanOrEqual(1);
      expect(startAbs - first).toBeLessThanOrEqual(2);
      void words; void i;
    });
  });
  it('IN-1 is expo-out: the focus-pull blur at 50% of the entrance is far below the linear half, and it ends sharp', () => {
    const f1 = solve('cinematicClean', LEFT, {enter: 'IN-1'}).spec.events[0]!;
    const h = heroOf(f1);
    expect(h.anim).toBe('IN-1');
    const n = entryFrames('IN-1', 30);
    const enter = f1.inFrame + h.enterFrame;
    expect(interpolateWordKeys(h.wordKeyframes, enter + n / 2).blurPx).toBeLessThan(25 / 4);
    expect(interpolateWordKeys(h.wordKeyframes, enter).blurPx).toBeGreaterThan(8);
    expect(interpolateWordKeys(h.wordKeyframes, enter + n).blurPx).toBe(0);
  });
  it('X3 exit is shorter than the entry; the hold never sits static; X1 cuts on the cut frame', () => {
    expect(exitFrames('X3', 30)).toBeLessThan(entryFrames('E1', 30));
    const ks = e.keyframes.filter(k => k.opacity === 1);
    expect(new Set(ks.map(k => k.rotateY)).size).toBeGreaterThan(3);
    expect(Math.max(...ks.map(k => k.scale))).toBeGreaterThan(Math.min(...ks.map(k => k.scale)));
    const cut = solve('cinematicClean', LEFT, {exit: 'X1'}).spec.events[0]!;
    expect(cut.exit).toBe('X1');
    expect(cut.keyframes[cut.keyframes.length - 1]!.opacity).toBe(0);
  });
  it('X6 swipe-out is granted once per plan; parallax z by role', () => {
    const words = mkWords();
    const scene = buildScene({shotId: 's', subjectBox: LEFT, luminance: 0.07, width: W, height: H});
    const two = [ev({id: 'x', wordRange: [0, 1], lines: [{text: 'i feel', role: 'connector'}], exit: 'X6'}), ev({id: 'y', wordRange: [3, 4], lines: [{text: 'giving up', role: 'hero'}], exit: 'X6'})];
    const {spec} = solveLayout({plan: {version: '1', style: 'cinematicClean', events: two}, words, shots, scenes: {s: scene}, depth, brand, width: W, height: H, fps: 30, seed: 1, planSource: 't'});
    expect(spec.events.filter(x => x.exit === 'X6').length).toBeLessThanOrEqual(1);
    expect(heroOf(e).zPx).toBe(40);
    expect(e.lines.find(l => l.role === 'connector')!.zPx).toBe(-20);
  });
  it('same inputs -> deep-equal spec', () => {
    expect(solve('retroNeon', CENTRE).spec).toEqual(solve('retroNeon', CENTRE).spec);
  });
  it('running swap-exit never resurrects opacity after a word leaves', () => {
    const words: KineticWord[] = ['never', 'ever', 'do', 'these', 'three'].map((text, idx) => ({idx, text, startFrame: 10 + idx * 5, endFrame: 14 + idx * 5, emphasisScore: 0.2}));
    const scene = buildScene({shotId: 's', subjectBox: CENTRE, luminance: 0.07, width: W, height: H});
    const run: TextEvent = {id: 'run', shotId: 's', wordRange: [0, 4], lines: [{text: 'never ever do these three', role: 'running'}], preset: 'type.words', layering: 'front', anchor: 'auto', regionHint: 'running'};
    const {spec} = solveLayout({plan: {version: '1', style: 'cinematicClean', events: [run]}, words, shots, scenes: {s: scene}, depth, brand, width: W, height: H, fps: 30, seed: 1, planSource: 't'});
    const ev0 = spec.events[0]!;
    for (const line of ev0.lines) {
      const last = line.wordKeyframes[line.wordKeyframes.length - 1]!;
      // every swapped-out word must end at ~0; none may climb back after that last key
      if (line !== ev0.lines[ev0.lines.length - 1]) expect(last.opacity).toBeLessThanOrEqual(0.05);
      let peaked = false;
      let exited = false;
      for (let f = ev0.inFrame; f < ev0.outFrame; f += 1) {
        const op = interpolateWordKeys(line.wordKeyframes, f).opacity;
        if (op >= 0.9) peaked = true;
        if (peaked && op < 0.05) exited = true;
        if (exited) expect(op).toBeLessThanOrEqual(0.05);
      }
    }
  });
});

describe('behindSignature cap + fallback', () => {
  it('a 20 s fallback plan asks for at most 1 behindSignature per 8 s and stays legal', () => {
    const words: KineticWord[] = Array.from({length: 120}, (_, i) => ({idx: i, text: i % 5 === 3 ? 'Believe' : i % 5 === 0 ? 'the' : 'word', startFrame: i * 5, endFrame: i * 5 + 4, emphasisScore: i % 5 === 3 ? 0.95 : 0.1}));
    const sh = [{id: 's', startFrame: 0, endFrame: 600}];
    const {plan} = buildFallbackPlan({words, shots: sh});
    const behind = plan.events.filter(e => e.regionHint === 'behindSignature');
    expect(behind.length).toBeLessThanOrEqual(Math.ceil(20 / 8));
    const scene = buildScene({shotId: 's', subjectBox: {x: 0.3, y: 0.3, w: 0.4, h: 0.62}, luminance: 0.2, width: W, height: H});
    const {spec} = solveLayout({plan, words, shots: sh, scenes: {s: scene}, depth, brand, width: W, height: H, fps: 30, seed: 1, planSource: 'fb'});
    const behindEv = spec.events.filter(e => e.zone === 'behindSignature').map(e => e.inFrame).sort((a, b) => a - b);
    for (let i = 1; i < behindEv.length; i += 1) expect(behindEv[i]! - behindEv[i - 1]!).toBeGreaterThanOrEqual(240);
  });
  it('fallback tags function words as connectors and keeps old fixtures valid', () => {
    const words = fixtureWords();
    const {plan} = buildFallbackPlan({words, shots: fixtureShots(words)});
    expect(plan.style).toBe('retroNeon');
    for (const e of plan.events) for (const l of e.lines) if (l.role === 'connector') for (const t of l.text.split(' ')) expect(['a', 'the', 'i', 'my', 'to', 'of', 'and', 'you', 'we', 'it', 'is', 'are', 'was', 'be', 'for', 'in', 'on', 'that', 'this', 'like', 'just']).toContain(t.toLowerCase());
  });
});
