/**
 * Round 2: gap captions, speaker-aware placement + readability floors, one phrase = one block, per-video font / accent, the diverse motion library, the match-cut moments, RVM device fallback.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {describe, expect, it, vi} from 'vitest';

import {hexToHsl, hueDistance, nudgeForContrast, plateAccents, resolveAccent} from './accent.ts';
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {KINETIC_DIRECTOR_SYSTEM, buildDirectorPrompt} from './director.ts';
import {buildFallbackPlan} from './fallback.ts';
import {fixtureShots, fixtureWords} from './fixtures.ts';
import {restingMargin, restingRange, wordAabbAt} from './geometry.ts';
import {verifyRenderSpec} from './guardrails.ts';
import {buildSheet3} from './sheet3.ts';
import {solveLayout} from './layout.ts';
import {matchCutMomentOf, sanitizeMatchCuts} from './matchCut.ts';
import {HERO_FLOOR_FRAC, entryFrames, exitFrames, interpolateWordKeys} from './motion.ts';
import {resolvePlan} from './plan.ts';
import {shortsSafeRect} from '../broll/heroSweep.ts';
import {buildScene, type Box} from './scene.ts';
import {brandConfigSchema, kineticPlanSchema, type KineticPlan, type KineticWord, type RenderEvent, type RenderSpec, type TextEvent} from './schema.ts';
import {toKineticWords} from './transcript.ts';

const brand = brandConfigSchema.parse({});
const depth = new SubjectBandDepth();
const W = 1080, H = 1920, FPS = 30;
const mk = (texts: string[], start = 20, step = 14, emphasis = 0.8): KineticWord[] => texts.map((text, idx) => ({idx, text, startFrame: start + idx * step, endFrame: start + idx * step + 11, emphasisScore: emphasis}));
const shots = (end = 600) => [{id: 's', startFrame: 0, endFrame: end}];
const CENTRE: Box = {x: 0.3, y: 0.2, w: 0.4, h: 0.7};
const LEFT: Box = {x: 0.03, y: 0.25, w: 0.3, h: 0.65};
const FULL: Box = {x: 0, y: 0.17, w: 1, h: 0.83};
const baseEv = (over: Partial<TextEvent>): TextEvent => ({id: 'e', shotId: 's', wordRange: [0, 0], lines: [{text: 'x', role: 'hero'}], preset: 'type.words', layering: 'auto', anchor: 'auto', regionHint: 'auto', ...over});
function solve(plan: KineticPlan, words: KineticWord[], box: Box = CENTRE, over: {noMatte?: boolean; end?: number} = {}): {spec: RenderSpec; report: ReturnType<typeof solveLayout>['report']} {
  const sh = shots(over.end ?? 600);
  const scene = buildScene({shotId: 's', ...(over.noMatte ? {noMatte: true} : {subjectBox: box}), luminance: 0.07, plateColor: '#345266', width: W, height: H});
  return solveLayout({plan, words, shots: sh, scenes: {s: scene}, cameras: {s: new StaticCamera().track(sh[0]!)}, depth, brand, width: W, height: H, fps: FPS, seed: 3, planSource: 't'});
}
const heroLine = (e: RenderEvent) => e.lines.find(l => l.role === 'hero' || l.role === 'punch')!;

describe('1. gap captions', () => {
  const words = fixtureWords();
  const sh = fixtureShots(words);
  const plan = buildFallbackPlan({words, shots: sh}).plan;
  const scene = buildScene({shotId: sh[0]!.id, subjectBox: CENTRE, luminance: 0.2, width: 720, height: 1280});
  const {spec} = solveLayout({plan, words, shots: sh, scenes: {[sh[0]!.id]: scene}, depth, brand, width: 720, height: 1280, fps: 30, seed: 1, planSource: 't'});

  it('exist, and never overlap a kinetic event in time or repeat a kinetic word', () => {
    expect(spec.captions.length).toBeGreaterThan(0);
    const owned = new Set<number>();
    for (const e of spec.events) for (let i = e.wordRange[0]; i <= e.wordRange[1]; i += 1) owned.add(i);
    for (const c of spec.captions) {
      expect(owned.has(c.wordIdx), `caption "${c.text}" belongs to a kinetic event`).toBe(false);
      for (const e of spec.events) expect(c.inFrame < e.outFrame && e.inFrame < c.outFrame, `caption "${c.text}" overlaps ${e.id}`).toBe(false);
      expect(words[c.wordIdx]!.text.replace(/[.,;:!?]+$/, '')).toBe(c.text);
    }
  });
  it('are large textual edits that fill leftover screen, inside the safe rect and off the face keep-out; IN-11 tick in, OUT-6 cut', () => {
    const safe = shortsSafeRect(720, 1280);
    expect(spec.captions.length).toBeGreaterThan(0);
    for (const c of spec.captions) {
      expect(c.fontPx / 1280).toBeGreaterThanOrEqual(0.065);
      expect(c.fontPx / 1280).toBeLessThanOrEqual(0.15);
      expect(c.weight).toBeGreaterThanOrEqual(700);
      expect(c.cx).toBeCloseTo(360, 0);
      expect(c.cx - c.w / 2).toBeGreaterThanOrEqual(safe.left - 0.5);
      expect(c.cx + c.w / 2).toBeLessThanOrEqual(safe.right + 0.5);
      expect(c.cy - c.h / 2).toBeGreaterThanOrEqual(safe.top - 0.5);
      expect(c.cy + c.h / 2).toBeLessThanOrEqual(safe.bottom + 0.5);
      const face = {top: CENTRE.y * 1280, bottom: (CENTRE.y + 0.42 * CENTRE.h) * 1280};
      const overlapFace = c.cy - c.h / 2 < face.bottom && c.cy + c.h / 2 > face.top;
      expect(overlapFace).toBe(false);
      expect(c.anim).toBe('IN-11');
      expect(c.exit).toBe('OUT-6');
      expect(c.keyframes[0]!.opacity).toBeLessThan(1);
      expect(c.keyframes[0]!.scale).toBeLessThan(1);
      expect(c.keyframes[0]!.scale).toBeGreaterThanOrEqual(0.92);
      expect(c.keyframes[c.keyframes.length - 1]!.opacity).toBe(1);
      expect(c.keyframes[c.keyframes.length - 1]!.scale).toBe(1);
      expect(c.keyframes.filter(k => k.opacity < 1).length).toBeLessThanOrEqual(3);
    }
  });
  it('never invents a word', () => {
    const pool = new Set(words.map(w => w.text.replace(/[.,;:!?]+$/, '')));
    for (const c of spec.captions) expect(pool.has(c.text)).toBe(true);
  });
});

describe('4. one phrase = one reading block', () => {
  const cta = ['follow', 'me', 'for', 'more', 'valuable', 'tips'];
  const words = mk(cta, 30, 8);
  const plan = (box: 'any'): KineticPlan => ({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEv({id: 'cta', wordRange: [0, 5], lines: [{text: cta.join(' '), role: 'punch'}], regionHint: box === 'any' ? 'flank' : 'auto'})]});
  for (const [name, box] of [['centred subject', CENTRE], ['subject left', LEFT], ['subject filling the frame', FULL]] as const) {
    it(`a CTA stays ONE centred column (${name}); flank is refused for one phrase`, () => {
      const {spec} = solve(plan('any'), words, box);
      expect(spec.events).toHaveLength(1);
      const e = spec.events[0]!;
      expect(e.zone).not.toBe('flank');
      expect(e.id.endsWith('.a') || e.id.endsWith('.b')).toBe(false);
      // every word row is centred on the block: no word is pushed to an opposite edge
      const rows = new Map<number, typeof e.lines>();
      for (const l of e.lines) rows.set(l.dy, [...(rows.get(l.dy) ?? []), l]);
      for (const row of rows.values()) {
        const left = Math.min(...row.map(l => l.dx)), right = Math.max(...row.map(l => l.dx + l.w));
        expect(Math.abs((left + right) / 2 - e.block.w / 2)).toBeLessThan(1);
      }
      expect(rows.size).toBeLessThanOrEqual(5);
      // reading order: rows top to bottom follow the spoken order
      const order = e.lines.map(l => l.text.toLowerCase());
      expect(order).toEqual(cta);
      const ys = [...rows.keys()].sort((a, b) => a - b);
      const firstOfRow = ys.map(y => rows.get(y)![0]!.text.toLowerCase());
      expect(firstOfRow[0]).toBe('follow');
      expect(restingMargin(e, shortsSafeRect(W, H))).toBeGreaterThanOrEqual(-0.5);
    });
  }
  it('flank is only for a truly centred subject AND a multi-sentence event', () => {
    const two = mk(['i', 'feel', 'done.', 'now', 'we', 'go'], 20, 14);
    const narrow: Box = {x: 0.4, y: 0.2, w: 0.2, h: 0.7};
    const one = solve({version: '1', style: 'cinematicClean', events: [baseEv({wordRange: [0, 2], lines: [{text: 'i feel', role: 'connector'}, {text: 'done', role: 'hero'}], regionHint: 'flank'})]}, two, narrow).spec;
    expect(one.events.every(e => e.zone !== 'flank')).toBe(true);
  });
});

describe('2. speaker awareness, open side, readability floors', () => {
  it('type goes to the open gutter beside a left speaker, never over the box', () => {
    const words = mk(['go', 'big'], 20, 14);
    const {spec} = solve({version: '1', style: 'cinematicClean', fontPair: 'street', events: [baseEv({wordRange: [1, 1], lines: [{text: 'big', role: 'hero'}]})]}, words, LEFT);
    const e = spec.events[0]!;
    expect(e.zone).toBe('besideRight');
    const [f0, f1] = restingRange(e, heroLine(e));
    const r = wordAabbAt(e, heroLine(e), Math.round((f0 + f1) / 2));
    expect(r.left).toBeGreaterThan((LEFT.x + LEFT.w) * W);
  });
  it('an estimated (no matte) box never earns a gutter or a flank', () => {
    const words = mk(['go', 'big'], 20, 14);
    const {spec} = solve({version: '1', style: 'cinematicClean', events: [baseEv({wordRange: [1, 1], lines: [{text: 'big', role: 'hero'}], regionHint: 'besideRight'})]}, words, CENTRE, {noMatte: true});
    expect(['besideLeft', 'besideRight', 'flank']).not.toContain(spec.events[0]!.zone);
  });
  it('hero / punch hold ~8% of the frame height and connectors / support >= 3.5% after the fit, across zones', () => {
    for (const box of [CENTRE, LEFT, FULL]) {
      const words = mk(['i', 'feel', 'like', 'winning', 'today'], 20, 12);
      const {spec} = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEv({wordRange: [0, 4], lines: [{text: 'i feel like', role: 'connector'}, {text: 'winning', role: 'hero'}, {text: 'today', role: 'support'}]})]}, words, box);
      const e = spec.events[0]!;
      const mid = e.keyframes[Math.floor(e.keyframes.length / 2)]!.scale;
      for (const l of e.lines) {
        const frac = (l.fontPx * mid) / H;
        if (l.role === 'hero') expect(frac).toBeGreaterThanOrEqual(HERO_FLOOR_FRAC * 0.95);
        else expect(frac).toBeGreaterThanOrEqual(0.035 * 0.95);
      }
    }
  });
  it('extruded 3D hero: a connector never drags the hero down to caption size (the 55 px "viral" bug)', () => {
    const words = mk(['to', 'go', 'viral'], 20, 14);
    for (const preset of ['hero.extrudedStack.front', 'hero.extruded3d.rise'] as const) {
      const ev = baseEv({id: 'v', wordRange: [0, 2], preset, layering: preset === 'hero.extrudedStack.front' ? 'front' : 'auto', lines: [{text: 'to go', role: 'connector'}, {text: 'viral', role: 'hero'}], accent: 'magenta'});
      const {spec, report} = solve({version: '1', style: 'retroNeon', events: [ev]}, words, CENTRE);
      const e = spec.events[0]!;
      const h = e.lines.find(l => l.role === 'hero')!;
      const scale = Math.min(...e.keyframes.filter(k => k.opacity >= 0.9 && k.blurPx < 1.5).map(k => k.scale));
      expect((h.fontPx * scale) / H, `${preset} hero ${h.fontPx}px x ${scale}`).toBeGreaterThanOrEqual(HERO_FLOOR_FRAC);
      expect(h.fontPx).toBeGreaterThan(2 * e.lines.find(l => l.role === 'connector')!.fontPx - 1);
      expect(report.violations).toEqual([]);
    }
  });
  it('a close-up that fills the frame leaves no gutter: a block-level 3D preset asked for besideRight keeps hero size (no 10 px sliver) and takes the per-video font', () => {
    const words = mk(['cool', 'effects'], 20, 14);
    const ev = baseEv({id: 'v', wordRange: [0, 1], preset: 'hero.extruded3d.rise', lines: [{text: 'cool', role: 'support'}, {text: 'effects', role: 'hero'}], regionHint: 'besideRight'});
    const {spec} = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [ev]}, words, FULL);
    const e = spec.events[0]!;
    const h = e.lines.find(l => l.role === 'hero')!;
    expect(h.font).toBe('anton');
    const scale = Math.min(...e.keyframes.filter(k => k.opacity >= 0.9 && k.blurPx < 1.5).map(k => k.scale));
    expect((h.fontPx * scale) / H).toBeGreaterThanOrEqual(HERO_FLOOR_FRAC);
  });
  it('a long two-word hero is stacked word by word instead of shrinking through the floor', () => {
    const words = mk(['add', 'cool', 'effects'], 20, 14);
    const ev = baseEv({id: 'v', wordRange: [0, 2], preset: 'hero.extrudedStack.front', layering: 'front', lines: [{text: 'add', role: 'connector'}, {text: 'cool effects', role: 'hero'}]});
    const e = solve({version: '1', style: 'retroNeon', events: [ev]}, words, CENTRE).spec.events[0]!;
    expect(e.lines.filter(l => l.role === 'hero').length).toBe(2);
    for (const l of e.lines.filter(x => x.role === 'hero')) expect(l.fontPx / H).toBeGreaterThanOrEqual(HERO_FLOOR_FRAC);
  });
});

describe('6. behind the subject fires once a matte exists', () => {
  const words = mk(['this', 'is', 'incredible'], 20, 14);
  const behind = (noMatte: boolean) => solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEv({wordRange: [2, 2], lines: [{text: 'incredible', role: 'hero'}], regionHint: 'behindSignature'})]}, words, CENTRE, {noMatte}).spec.events[0]!;
  it('is refused without a matte and legal with one (the refusal is the only reason it was dropped)', () => {
    const no = behind(true);
    expect(no.layering).toBe('front');
    expect(no.notes.join(' ')).toMatch(/behindSignature refused: no matte/);
    const yes = behind(false);
    expect(yes.notes.join(' ')).not.toMatch(/refused: no matte/);
  });
  it('the director prompt asks for behind-the-head / stack-over-cutout and 3D when a matte exists', () => {
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/BEHIND THE SPEAKER[^]*at least ONE hero/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/3D: use "hero\.extruded3d\.rise" or "hero\.extrudedStack\.front" for at least ONE real keyword/);
  });
});

describe('5. colour and font are chosen per video', () => {
  const words = mk(['this', 'is', 'viral'], 20, 14);
  const plan = (pair: 'street' | 'editorial' | 'neon', accent?: string): KineticPlan => ({version: '1', style: 'retroNeon', fontPair: pair, events: [baseEv({wordRange: [1, 2], lines: [{text: 'is', role: 'connector'}, {text: 'viral', role: 'hero'}], ...(accent ? {accent: accent as never} : {})})]});
  it('fontPair maps to measured faces: street = anton caps, editorial = playfair italic, neon = pacifico script', () => {
    expect(heroLine(solve(plan('street'), words).spec.events[0]!).font).toBe('anton');
    expect(heroLine(solve(plan('editorial'), words).spec.events[0]!).font).toBe('playfairItalic');
    expect(heroLine(solve(plan('neon'), words).spec.events[0]!).font).toBe('pacifico');
    expect(solve(plan('street'), words).spec.fontPair).toBe('street');
  });
  it("the director's accent hue survives (no sheet cycle); only brightness may be nudged", () => {
    for (const named of ['crimson', 'magenta', 'violet', 'cyan'] as const) {
      const e = solve(plan('street', named), words).spec.events[0]!;
      const got = heroLine(e).color;
      expect(['#F2C14E', '#E6FF3B', '#4FD8C9', '#FF4FA8']).not.toContain(got.toUpperCase());
      expect(hueDistance(hexToHsl(got).h, hexToHsl(resolveAccent(named)!).h)).toBeLessThan(4);
    }
    const hex = solve(plan('street', '#12A04B'), words).spec.events[0]!;
    expect(hueDistance(hexToHsl(heroLine(hex).color).h, hexToHsl('#12A04B').h)).toBeLessThan(4);
  });
  it('nudgeForContrast keeps the hue and reaches 3:1 on a dark plate', () => {
    const n = nudgeForContrast('#3A0A18', '#111111');
    expect(n.nudged).toBe(true);
    expect(hueDistance(hexToHsl(n.hex).h, hexToHsl('#3A0A18').h)).toBeLessThan(6);
  });
  it('a plan without an accent gets one derived from the plate (a blue plate does not get blue)', () => {
    const acc = plateAccents('#345266', '#121212');
    for (const c of acc) expect(hueDistance(hexToHsl(c).h, hexToHsl('#345266').h)).toBeGreaterThan(40);
    const e = solve({...plan('street'), events: [baseEv({wordRange: [1, 2], lines: [{text: 'viral', role: 'hero'}]})]}, words).spec.events[0]!;
    expect(heroLine(e).color).not.toBe('#FFFFFF');
  });
  it('the plan schema accepts fontPair / accent / enter / exit and the director prompt says the sheet colours are not a default', () => {
    expect(kineticPlanSchema.safeParse(plan('neon', 'gold')).success).toBe(true);
    expect(kineticPlanSchema.safeParse({...plan('neon'), fontPair: 'nope'}).success).toBe(false);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/fontPair/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/NOT a default/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/street/);
    const p = buildDirectorPrompt({words, shots: [{id: 's', startFrame: 0, endFrame: 100}], scenes: {s: buildScene({shotId: 's', subjectBox: CENTRE, luminance: 0.1, plateColor: '#345266'})}, brand});
    expect(p).toMatch(/mean colour #345266/);
  });
});

describe('7. diverse motion', () => {
  const heroPlan = (n: number, tags: Partial<TextEvent> = {}, style: 'retroNeon' | 'editorialLuxury' | 'cinematicClean' = 'retroNeon'): {plan: KineticPlan; words: KineticWord[]} => {
    const words = mk(Array.from({length: n * 2}, (_, i) => (i % 2 ? 'amazing' : 'this')), 20, 40);
    return {words, plan: {version: '1', style, fontPair: 'street', events: Array.from({length: n}, (_, i) => baseEv({id: `h${i}`, wordRange: [i * 2, i * 2 + 1], lines: [{text: 'this', role: 'connector'}, {text: 'amazing', role: 'hero'}], regionHint: 'running', ...tags}))}};
  };
  it('consecutive lockups never share the same entry+exit pair, even when the director repeats one', () => {
    const {plan, words} = heroPlan(6, {enter: 'IN-2', exit: 'OUT-1'});
    const evs = solve(plan, words, CENTRE, {end: 800}).spec.events;
    expect(evs.length).toBeGreaterThanOrEqual(5);
    const pairs = evs.map(e => `${heroLine(e).anim}|${e.exit}`);
    for (let i = 1; i < pairs.length; i += 1) expect(pairs[i], `lockup ${i}: ${pairs.join(' ')}`).not.toBe(pairs[i - 1]);
    expect(pairs.every(p => /^IN-\d+\|OUT-\d$/.test(p))).toBe(true);
  });
  it('untagged heroes rotate through the library, never one E5 + X3 recipe', () => {
    for (const style of ['retroNeon', 'editorialLuxury', 'cinematicClean'] as const) {
      const {plan, words} = heroPlan(6, {}, style);
      const evs = solve(plan, words, CENTRE, {end: 800}).spec.events;
      const pairs = evs.map(e => `${heroLine(e).anim}|${e.exit}`);
      expect(new Set(pairs).size, pairs.join(' ')).toBeGreaterThanOrEqual(style === 'editorialLuxury' ? 2 : 3);
      for (let i = 1; i < pairs.length; i += 1) expect(pairs[i]).not.toBe(pairs[i - 1]);
      // the last lockup is the final CTA: it ghost-dims (OUT-7)
      const body = evs.slice(0, -1);
      expect(evs[evs.length - 1]!.exit).toBe('OUT-7');
      if (style === 'editorialLuxury') for (const e of body) { expect(['IN-1', 'IN-10']).toContain(heroLine(e).anim); expect(e.exit).toBe('OUT-4'); }
      if (style === 'retroNeon') for (const e of body) { expect(['IN-2', 'IN-4', 'IN-6', 'IN-7', 'IN-9']).toContain(heroLine(e).anim.startsWith('IN-7') ? 'IN-7' : heroLine(e).anim); expect(['OUT-1', 'OUT-2']).toContain(e.exit); }
    }
  });
  it('the fallback rotates through IN-1/2/3/4/6 and OUT-1/2/4', () => {
    const texts = ['we', 'love', 'viral', 'hooks', 'and', 'we', 'hate', 'boring', 'edits', 'but', 'amazing', 'effects', 'make', 'wonderful', 'stories', 'with', 'fantastic', 'transitions', 'every', 'single', 'day'];
    const words = toKineticWords(texts.map((text, i) => ({text, start: 1 + i * 1.2, end: 1.9 + i * 1.2})), FPS).map(w => ({...w, emphasisScore: /^[a-z]{5,}$/.test(w.text) && w.text !== 'every' ? 0.9 : 0.1}));
    const sh = [{id: 's', startFrame: 0, endFrame: words[words.length - 1]!.endFrame + 60}];
    const fb = buildFallbackPlan({words, shots: sh, fps: FPS}).plan;
    expect(fb.fontPair).toBeTruthy();
    const scene = buildScene({shotId: 's', subjectBox: CENTRE, luminance: 0.1, width: W, height: H});
    const {spec} = solveLayout({plan: fb, words, shots: sh, scenes: {s: scene}, depth, brand, width: W, height: H, fps: FPS, seed: 1, planSource: 'fallback'});
    const tw = spec.events.filter(e => e.presetResolved === 'type.words');
    const anims = new Set(tw.flatMap(e => e.lines.map(l => l.anim)));
    const exits = new Set(tw.map(e => e.exit));
    for (const a of ['IN-1', 'IN-2', 'IN-3', 'IN-4', 'IN-6']) expect([...anims], `entries ${[...anims]}`).toContain(a);
    for (const x of ['OUT-1', 'OUT-2', 'OUT-4']) expect([...exits], `exits ${[...exits]}`).toContain(x);
  });
  it('IN-3 whips in with scaleX 1.6 -> 1 and blur; OUT-2 smears to scaleX 3 with blur and dies; hold scale eases 1.00 -> ~1.04', () => {
    const words = [...mk(['now', 'amazing'], 30, 20), ...mk(['so', 'amazing'], 140, 20).map(w => ({...w, idx: w.idx + 2}))];
    const second = baseEvAmazing({id: 'b', wordRange: [2, 3], lines: [{text: 'so', role: 'connector'}, {text: 'amazing', role: 'hero'}]});
    const {spec} = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEvAmazing({enter: 'IN-3', exit: 'OUT-2'}), second]}, words, CENTRE);
    const e = spec.events[0]!;
    const h = heroLine(e);
    expect(h.anim).toBe('IN-3');
    expect(e.exit).toBe('OUT-2');
    const first = h.wordKeyframes.find(k => k.opacity > 0)!;
    expect(first.scaleX).toBeGreaterThan(1.3);
    expect(first.blurPx).toBeGreaterThan(10);
    expect(Math.abs(first.x)).toBeGreaterThan(200);
    const enter = e.inFrame + h.enterFrame;
    expect(interpolateWordKeys(h.wordKeyframes, enter + entryFrames('IN-3', FPS)).scaleX).toBe(1);
    const last = h.wordKeyframes[h.wordKeyframes.length - 1]!;
    expect(last.scaleX).toBeCloseTo(3, 1);
    expect(last.blurPx).toBeGreaterThan(80);
    expect(last.opacity).toBeLessThan(0.05);
    expect(e.outFrame - (h.wordKeyframes.find(k => k.scaleX > 1.01 && k.frame > enter + 6)?.frame ?? e.outFrame)).toBeLessThanOrEqual(exitFrames('OUT-2', FPS) + 1);
    const sc = e.keyframes.filter(k => k.opacity >= 1 && k.blurPx < 1 && k.frame > e.inFrame + h.enterFrame + 16).map(k => k.scale); // after the hero row has joined
    expect(Math.max(...sc) / Math.min(...sc)).toBeGreaterThan(1.002); // eased: never a static hold
    expect(Math.max(...sc) / Math.min(...sc)).toBeLessThan(1.06);
  });
  it('IN-7 cascades one glyph per line ~1 frame apart; IN-9 glitches with an RGB split then lands clean; OUT-7 ghost-dims only the final CTA', () => {
    const words = mk(['now', 'amazing'], 30, 20);
    const casc = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEvAmazing({enter: 'IN-7', exit: 'OUT-1'})]}, words, CENTRE).spec.events[0]!;
    const glyphs = casc.lines.filter(l => l.role === 'hero');
    expect(glyphs.map(g => g.text).join('')).toBe('AMAZING');
    const starts = glyphs.map(g => g.wordKeyframes.find(k => k.opacity > 0.05)!.frame);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeLessThanOrEqual(2);
    expect(starts[starts.length - 1]! - starts[0]!).toBeLessThanOrEqual(12);
    const glitch = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEvAmazing({enter: 'IN-9', exit: 'OUT-1'})]}, words, CENTRE).spec.events[0]!;
    const gh = heroLine(glitch);
    expect(Math.max(...gh.wordKeyframes.map(k => k.split))).toBeGreaterThan(3);
    expect(gh.wordKeyframes.filter(k => k.split > 0).length).toBeLessThanOrEqual(4);
    const dim = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEvAmazing({enter: 'IN-2', exit: 'OUT-7'})]}, words, CENTRE).spec.events[0]!;
    expect(dim.exit).toBe('OUT-7'); // the only (= last) lockup
    const multi = heroPlan(2, {exit: 'OUT-7'});
    const evs = solve(multi.plan, multi.words, CENTRE, {end: 400}).spec.events;
    expect(evs[0]!.exit).not.toBe('OUT-7');
  });
  it('every entry / exit stays inside the library and the render spec is guardrail-clean', () => {
    const {plan, words} = heroPlan(5);
    const sh = shots(800);
    const scene = buildScene({shotId: 's', subjectBox: CENTRE, luminance: 0.07, width: W, height: H});
    const {spec} = solveLayout({plan, words, shots: sh, scenes: {s: scene}, depth, brand, width: W, height: H, fps: FPS, seed: 3, planSource: 't'});
    expect(verifyRenderSpec(spec, {scenes: {s: scene}, depth, shots: sh}).filter(v => v.rule === 'safe-rect')).toEqual([]);
  });
});
function baseEvAmazing(over: Partial<TextEvent>): TextEvent {
  return baseEv({id: 'a', wordRange: [0, 1], lines: [{text: 'now', role: 'connector'}, {text: 'amazing', role: 'hero'}], regionHint: 'running', ...over});
}

describe('3. match cut only in the four moments', () => {
  const say = (text: string, t0: number) => text.split(' ').map((w, i) => ({text: w, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25}));
  const wordsOf = (raw: ReturnType<typeof say>): KineticWord[] => toKineticWords(raw, FPS);
  const mcEvent = (words: KineticWord[], keyword: string): TextEvent => {
    const i = words.findIndex(w => w.text.toLowerCase() === keyword);
    return baseEv({id: 'mc', preset: 'type.matchCut', layering: 'front', wordRange: [Math.max(0, i - 3), Math.min(words.length - 1, i + 3)], lines: [{text: keyword, role: 'hero'}], matchCut: {keyword}});
  };
  it('"that was an example of a hook" is NOT a match cut: the director plan keeps going without it', () => {
    const words = wordsOf(say('that was an example of a hook for you all today', 3));
    const sh = [{id: 's', startFrame: 0, endFrame: words[words.length - 1]!.endFrame + 90}];
    const ev = mcEvent(words, 'hook');
    expect(matchCutMomentOf(words.findIndex(w => w.text === 'hook'), ev.wordRange, words, FPS).ok).toBe(false);
    const plan: KineticPlan = {version: '1', style: 'retroNeon', events: [ev]};
    const s = sanitizeMatchCuts(plan, words, FPS);
    expect(s.plan.events).toHaveLength(0);
    expect(s.dropped[0]!.reason).toMatch(/opening hook|statistic|pivot|core keyword/);
    // resolvePlan: the same plan with a normal hero event stays a director plan, the match cut is dropped with a note
    const hero = baseEv({id: 'h', wordRange: [5, 5], lines: [{text: 'hook', role: 'hero'}]});
    const r = resolvePlan({version: '1', style: 'retroNeon', events: [ev, hero]}, words, sh, undefined, {fps: FPS});
    expect(r.source).toBe('director');
    expect(r.plan.events.map(e => e.id)).toEqual(['h']);
    expect(r.notes?.join(' ')).toMatch(/match cut dropped/);
  });
  it('a statistic, a pivot, the opening hook and the core keyword are legal; a second cut is not', () => {
    const stat = wordsOf(say('only 90% of creators ever make money', 2));
    expect(matchCutMomentOf(stat.findIndex(w => w.text === 'creators'), [0, stat.length - 1], stat, FPS)).toMatchObject({ok: true, moment: 'statistic'});
    const pivot = wordsOf(say('the problem is nobody tells you the solution', 2));
    expect(matchCutMomentOf(1, [0, pivot.length - 1], pivot, FPS)).toMatchObject({ok: true, moment: 'pivot'});
    const open = wordsOf(say('viral hooks decide everything inside three seconds', 0.1));
    const top = open.reduce((a, w) => (w.emphasisScore > a.emphasisScore && w.text.length >= 4 ? w : a), open[0]!);
    expect(matchCutMomentOf(top.idx, [0, open.length - 1], open, FPS).ok).toBe(true);
    const a = mcEvent(stat, 'creators');
    const two = sanitizeMatchCuts({version: '1', style: 'retroNeon', events: [a, {...a, id: 'mc2'}]}, stat, FPS);
    expect(two.plan.events).toHaveLength(1);
    expect(two.dropped[0]!.reason).toMatch(/at most one/);
  });
  it('the solver (acceptMatchCuts) also refuses a match cut outside the four moments', () => {
    const words = wordsOf(say('that was an example of a hook for you all', 3));
    const sh = [{id: 's', startFrame: 0, endFrame: words[words.length - 1]!.endFrame + 90}];
    const {report} = solve({version: '1', style: 'retroNeon', events: [mcEvent(words, 'hook')]}, words, CENTRE, {end: sh[0]!.endFrame});
    expect(report.dropped.some(d => d.eventId === 'mc' && /match cut/.test(d.reason))).toBe(true);
  });
  it('the director prompt no longer says "use a match cut whenever a concept is named"', () => {
    expect(KINETIC_DIRECTOR_SYSTEM).not.toMatch(/whenever the speech suits/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/ONLY in these four moments/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/example of a hook/);
  });
});

describe('peer tool names share size and fill', () => {
  it('the director prompt asks for frequent lockups, readable behind letters, and equal peer tools', () => {
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/FREQUENT/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/12-18 headline/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/PEER LISTS/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/first and last letters/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/LARGE textual captions/);
  });
  it('fallback glues After Effects / Premiere Pro / DaVinci Resolve into one equal event', () => {
    const texts = ['use', 'After', 'Effects', 'Premiere', 'Pro', 'and', 'DaVinci', 'Resolve', 'every', 'single', 'day'];
    const words = toKineticWords(texts.map((text, i) => ({text, start: 1 + i * 0.4, end: 1.3 + i * 0.4})), FPS).map(w => ({...w, emphasisScore: /^(After|Effects|Premiere|DaVinci|Resolve|every|single)$/.test(w.text) ? 0.8 : 0.1}));
    const sh = [{id: 's', startFrame: 0, endFrame: words[words.length - 1]!.endFrame + 60}];
    const fb = buildFallbackPlan({words, shots: sh, fps: FPS}).plan;
    const tools = fb.events.find(e => e.lines.some(l => /after/i.test(l.text)));
    expect(tools).toBeTruthy();
    const names = tools!.lines.filter(l => /after|premiere|davinci/i.test(l.text));
    expect(names.length).toBe(3);
    expect(tools!.lines.filter(l => l.role === 'hero')).toHaveLength(1);
  });
  it('glues After Effects / Premiere Pro / DaVinci Resolve into equal accented lines', () => {
    const words = mk(['use', 'After', 'Effects', 'Premiere', 'Pro', 'and', 'DaVinci', 'Resolve'], 20, 10);
    const ev = baseEv({
      id: 'tools', wordRange: [1, 7], regionHint: 'running',
      lines: [
        {text: 'After Effects', role: 'hero'},
        {text: 'Premiere Pro', role: 'support'},
        {text: 'DaVinci Resolve', role: 'support'},
      ],
      accent: 'cyan',
    });
    const e = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [ev]}, words).spec.events[0]!;
    const names = e.lines.filter(l => /after|premiere|davinci/i.test(l.text));
    expect(names.length).toBe(3);
    const sizes = names.map(l => l.fontPx);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1);
    for (const l of names) {
      expect(l.fill.colors[0].toUpperCase()).not.toBe('#FFFFFF');
      expect(l.glow).not.toBeNull();
    }
  });
});

describe('perspective poses', () => {
  const holdOf = (e: RenderEvent) => e.keyframes.find(k => k.opacity > 0.9 && k.blurPx < 1.5 && k.frame > e.inFrame + 6) ?? e.keyframes[Math.floor(e.keyframes.length / 2)]!;
  it('recede, isometric, trapezoid and slant rest at different angles', () => {
    const words = mk(['posting'], 20, 14);
    const at = (pose: 'recede' | 'isometric' | 'trapezoid' | 'slant') => {
      const e = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [baseEv({wordRange: [0, 0], lines: [{text: 'posting', role: 'hero'}], regionHint: 'upper', pose, accent: 'orange'})]}, words).spec.events[0]!;
      return {pose: e.pose, k: holdOf(e)};
    };
    const recede = at('recede');
    expect(recede.pose).toBe('recede');
    expect(Math.abs(recede.k.rotateY)).toBeGreaterThan(24);
    expect(at('isometric').k.rotateX).toBeLessThan(-18);
    expect(at('trapezoid').k.rotateX).toBeGreaterThan(18);
    expect(at('slant').pose).toBe('slant');
    expect(Math.abs(at('slant').k.rotateY)).toBeGreaterThan(6);
  });
  it('a production fallback cycles non-flat poses onto front heroes', () => {
    const words = mk(['hooks', 'captions', 'effects', 'stories', 'editing', 'really', 'matter', 'today'], 10, 36);
    const sh = shots(500);
    const plan = buildFallbackPlan({words, shots: sh, fps: FPS}).plan;
    const scene = buildScene({shotId: 's', subjectBox: CENTRE, luminance: 0.12, plateColor: '#2A3344', width: W, height: H});
    const {spec} = solveLayout({plan, words, shots: sh, scenes: {s: scene}, cameras: {s: new StaticCamera().track(sh[0]!)}, depth, brand, width: W, height: H, fps: FPS, seed: 3, planSource: 'fallback'});
    const poses = spec.events.filter(e => e.presetResolved === 'type.words' && e.zone !== 'behindSignature' && e.zone !== 'stackOverCutout').map(e => e.pose ?? 'flat');
    expect(poses.filter(p => p !== 'flat').length).toBeGreaterThan(0);
    expect(new Set(poses).size).toBeGreaterThan(1);
  });
  it('sheet 3 shows every pose and stays inside the guardrails', () => {
    const sb = buildSheet3();
    expect(sb.report.dropped).toEqual([]);
    const scenes = Object.fromEntries(sb.shots.map(s => [s.id, buildScene({shotId: s.id, subjectBox: sb.cells.find(c => c.slot === s.startFrame)?.box ?? CENTRE, luminance: 0.12, width: 720, height: 1280})]));
    expect(verifyRenderSpec(sb.spec, {scenes, depth, shots: sb.shots, words: sb.words, plan: sb.plan})).toEqual([]);
    const poses = new Set(sb.spec.events.map(e => e.pose).filter(Boolean));
    for (const p of ['recede', 'isometric', 'trapezoid', 'slant']) expect(poses.has(p)).toBe(true);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/isometric/);
    expect(KINETIC_DIRECTOR_SYSTEM).toMatch(/trapezoid/);
  });
});

describe('3D chrome uses the director accent, not sheet grey', () => {
  it('extruded fill albedo is the accent, not white / sheet yellow', () => {
    const words = mk(['cool', 'effects'], 20, 14);
    const ev = baseEv({id: 'fx', wordRange: [1, 1], preset: 'hero.extruded3d.rise', layering: 'behind', regionHint: 'behindSignature', lines: [{text: 'effects', role: 'hero'}], accent: 'magenta'});
    const e = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [ev]}, words).spec.events[0]!;
    const h = e.lines.find(l => l.role === 'hero')!;
    expect(h.fill.kind).toBe('chrome');
    expect(h.fill.colors[0].toUpperCase()).not.toBe('#FFFFFF');
    expect(['#F2C14E', '#E6FF3B', '#4FD8C9', '#FF4FA8', '#FFFFFF']).not.toContain(h.fill.colors[0].toUpperCase());
  });
});

describe('RVM: always run, cpu fallback, bounded', () => {
  it('RVM_DEVICE=mps unavailable -> cpu, recorded; a timeout -> noMatte with a warning, never a hang', async () => {
    process.env.RVM_PYTHON = '/usr/bin/true';
    process.env.RVM_DEVICE = 'mps';
    const {resolveMatte} = await import('./matte.ts');
    const dir = mkdtempSync(path.join(tmpdir(), 'kin-rvm-'));
    const devices: string[] = [];
    const run = vi.fn(async (_py: string, args: string[], o: {env: NodeJS.ProcessEnv}) => {
      devices.push(String(o.env.RVM_DEVICE));
      if (o.env.RVM_DEVICE === 'mps') { writeFileSync(path.join(dir, 'matte.json'), JSON.stringify({ok: false, error: 'RVM_DEVICE=mps requested but torch.backends.mps.is_available() is False'})); return {code: 1, stderr: '', timedOut: false}; }
      writeFileSync(args[3]!, 'webm'); writeFileSync(path.join(dir, 'matte.json'), JSON.stringify({ok: true, device: 'cpu'}));
      return {code: 0, stderr: '', timedOut: false};
    });
    const r = await resolveMatte({video: '/x/v.mp4', cacheDir: dir, run});
    expect(devices).toEqual(['mps', 'cpu']);
    expect(r).toMatchObject({source: 'rvm', device: 'cpu'});
    expect(r.deviceNote).toMatch(/mps unavailable[^]*fell back to cpu/);

    const dir2 = mkdtempSync(path.join(tmpdir(), 'kin-rvm-'));
    const slow = vi.fn(async () => ({code: null, stderr: '', timedOut: true}));
    const t = await resolveMatte({video: '/x/v.mp4', cacheDir: dir2, run: slow, timeoutSec: 1});
    expect(t.path).toBeNull();
    expect(t.reason).toMatch(/timed out[^]*without a matte/);
    expect(slow).toHaveBeenCalledTimes(1);
    rmSync(dir, {recursive: true, force: true});
    rmSync(dir2, {recursive: true, force: true});
  });
});
