/**
 * Precedence between the creator's preset identity and a Director plan, with SYNTHETIC plans only (no model was called; this says nothing about real Director behaviour).
 * Rule: identity owns font family, plain-text colour and highlight colour (+ case, outline, shadow); the Director keeps roles, words, preset, motion tags, style and region.
 */
import {describe, expect, it} from 'vitest';

import {SubjectBandDepth} from './depth.ts';
import {fixtureShots, fixtureWords} from './fixtures.ts';
import {solveLayout} from './layout.ts';
import {deriveKineticIdentity, identityToBrand, type PresetLike} from './presetIdentity.ts';
import {brandConfigSchema, type KineticPlan, type TextEvent} from './schema.ts';
import {buildScene} from './scene.ts';

const words = fixtureWords();
const shots = fixtureShots(words);
const PUNCH: PresetLike = {id: 't', font: {family: 'Anton', case: 'upper'}, colors: {text: '#F5F5F5', active: '#FFE14D', outline: '#000000'}, stroke: {width: 0.004}};
const identity = deriveKineticIdentity(PUNCH);
const scene = buildScene({shotId: 'shot-0', subjectBox: {x: 0.28, y: 0.3, w: 0.44, h: 0.65}});

const wordsEvent = (over: Partial<TextEvent> = {}): TextEvent => ({
  id: 'w1', shotId: 'shot-0', wordRange: [4, 6], preset: 'type.words', layering: 'auto', anchor: 'auto', regionHint: 'auto',
  lines: [{text: 'believe', role: 'support'}, {text: 'yourself', role: 'hero'}], ...over,
});
const solve = (plan: KineticPlan, withIdentity: boolean) =>
  solveLayout({plan, words, shots, scenes: {'shot-0': scene}, depth: new SubjectBandDepth(), brand: withIdentity ? identityToBrand(identity) : brandConfigSchema.parse({}),
    ...(withIdentity ? {identity} : {}), width: 1080, height: 1920, fps: 30, seed: 7, planSource: 'synthetic'});
const hexRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const fills = (r: ReturnType<typeof solve>) => r.spec.events.flatMap(e => e.lines.map(l => ({text: l.text, font: l.font, color: l.fill.colors[0]})));

describe('Director accent vs the creator identity (synthetic Director plans)', () => {
  it('a Director accent hue does not change the highlight: the output equals the same plan with no Director accent', () => {
    const plain = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [wordsEvent()]}, true);
    for (const accent of ['cyan', 'magenta', '#00FF88']) {
      const directed = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [wordsEvent({accent: accent as never})]}, true);
      expect(fills(directed)).toEqual(fills(plain));
      expect(directed.report.decisions.some(d => d.code === 'refused.accent_identity' && d.requested === accent)).toBe(true);
    }
  });
  it('the highlight is the identity colour and plain words use the identity text colour; fonts are the identity font, whatever pair the Director chose', () => {
    for (const fontPair of ['street', 'editorial', 'neon'] as const) {
      const r = solve({version: '1', style: 'retroNeon', fontPair, events: [wordsEvent({accent: 'cyan'})]}, true);
      const f = fills(r);
      expect(new Set(f.map(x => x.font))).toEqual(new Set(['anton']));
      const [hr, hg, hb] = hexRgb(f.find(x => x.text.toLowerCase() === 'yourself')!.color!);
      expect(hr).toBeGreaterThanOrEqual(hg); expect(hg).toBeGreaterThan(hb * 1.5); // the identity's yellow hue (brightness alone may be nudged for contrast)
      expect(f.find(x => x.text.toLowerCase() === 'believe')!.color).toBe('#F5F5F5');
    }
  });
  it('without an identity the Director accent still works exactly as before (the rule only applies when a preset was selected)', () => {
    const withAccent = solve({version: '1', style: 'retroNeon', fontPair: 'street', events: [wordsEvent({accent: '#00FF88'})]}, false);
    const hero = fills(withAccent).find(x => x.text.toLowerCase() === 'yourself')!;
    const [r, g, b] = hexRgb(hero.color!);
    expect(g).toBeGreaterThan(r); expect(g).toBeGreaterThan(b); // the Director's green
    expect(withAccent.report.decisions.some(d => d.code === 'refused.accent_identity')).toBe(false);
  });
  it('legacy block presets: a Director font / gradient override is ignored under an identity and honoured without one', () => {
    const ev: TextEvent = {id: 'g1', shotId: 'shot-0', wordRange: [4, 6], preset: 'hero.gradientWord.behind', layering: 'front', anchor: 'auto', regionHint: 'auto', lines: [{text: 'Believe', role: 'hero'}], styleOverrides: {font: 'pacifico'}};
    const under = solve({version: '1', events: [ev]}, true);
    const without = solve({version: '1', events: [ev]}, false);
    expect(new Set(fills(under).map(x => x.font))).toEqual(new Set(['anton']));
    expect(fills(without).some(x => x.font === 'pacifico')).toBe(true);
  });
  it('what the Director still owns is untouched: roles, text, event windows and layout are identical with and without the identity', () => {
    const plan: KineticPlan = {version: '1', style: 'retroNeon', fontPair: 'street', events: [wordsEvent({accent: 'cyan'})]};
    const a = solve(plan, true).spec.events, b = solve(plan, false).spec.events;
    expect(a.map(e => [e.inFrame, e.outFrame, e.lines.map(l => l.text.toLowerCase())])).toEqual(b.map(e => [e.inFrame, e.outFrame, e.lines.map(l => l.text.toLowerCase())]));
  });
});
