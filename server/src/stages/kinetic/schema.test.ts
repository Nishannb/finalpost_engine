import {describe, expect, it} from 'vitest';

import {buildFallbackPlan, densityViolations, transcriptFidelity} from './fallback.ts';
import {fixtureShots, fixtureWords} from './fixtures.ts';
import {PRESETS, closestPreset, presetNames} from './presets.ts';
import {PRESET_NAMES, parseKineticPlan, textEventSchema} from './schema.ts';
import {heroCandidates, normToken} from './transcript.ts';

const ev = {id: 'e1', shotId: 's', wordRange: [0, 1], lines: [{text: 'You are', role: 'hero'}], preset: 'fallback.boldCenter.front', layering: 'front', anchor: 'screen', regionHint: 'auto'};
const plan = (e: unknown) => ({version: '1', events: [e]});

describe('KineticPlan zod', () => {
  it('accepts a valid event', () => expect(parseKineticPlan(plan(ev)).ok).toBe(true));
  it('rejects pixel / frame / font-size fields (strict)', () => {
    for (const extra of [{x: 10}, {fontPx: 200}, {inFrame: 4}, {top: 0.2}, {position: {x: 1, y: 2}}]) expect(parseKineticPlan(plan({...ev, ...extra})).ok).toBe(false);
    expect(parseKineticPlan(plan({...ev, lines: [{text: 'a', role: 'hero', fontSize: 90}]})).ok).toBe(false);
    expect(parseKineticPlan(plan({...ev, styleOverrides: {fontPx: 9}})).ok).toBe(false);
  });
  it('rejects unknown presets, bad enums, invented structure', () => {
    expect(parseKineticPlan(plan({...ev, preset: 'hero.madeUp'})).ok).toBe(false);
    expect(parseKineticPlan(plan({...ev, layering: 'middle'})).ok).toBe(false);
    expect(parseKineticPlan({version: '2', events: []}).ok).toBe(false);
    expect(parseKineticPlan({version: '1', events: [], extra: 1}).ok).toBe(false);
    expect(parseKineticPlan({version: '1', events: 'nope'}).ok).toBe(false);
    expect(parseKineticPlan(null).ok).toBe(false);
    expect(textEventSchema.safeParse({...ev, lines: []}).success).toBe(false);
  });
});

describe('preset registry', () => {
  it('lists all 20 names (incl. type.matchCut), each with a definition', () => {
    expect(PRESET_NAMES).toHaveLength(20);
    expect(PRESET_NAMES).toContain('type.matchCut');
    expect(new Set(presetNames())).toEqual(new Set(PRESET_NAMES));
    for (const n of PRESET_NAMES) expect(PRESETS[n].name).toBe(n);
  });
  it('only the glossy / extruded presets use three', () => {
    expect(PRESET_NAMES.filter(n => PRESETS[n].uses3d).sort()).toEqual(['hero.extruded3d.rise', 'hero.extruded3d.worldAnchored']);
  });
  it('unknown preset maps to the closest registered one', () => {
    expect(closestPreset('glossy 3d metal letters', 'nope')).toBe('hero.extruded3d.rise');
    expect(closestPreset('something odd')).toBe('fallback.boldCenter.front');
  });
});

describe('fallback plan', () => {
  const words = fixtureWords();
  const shots = fixtureShots(words);
  const {plan: fb} = buildFallbackPlan({words, shots});
  it('is a valid KineticPlan', () => expect(parseKineticPlan(fb).ok).toBe(true));
  it('only uses transcript words', () => {
    expect(fb.events.length).toBeGreaterThan(0);
    expect(transcriptFidelity(fb, words)).toEqual([]);
    const pool = new Set(words.map(w => normToken(w.text)));
    for (const e of fb.events) for (const l of e.lines) for (const t of l.text.split(/\s+/)) expect(pool.has(normToken(t))).toBe(true);
  });
  it('emphasis words become type.words hero blocks; every other word is left to the gap captions (no running events)', () => {
    const heroes = fb.events.filter(e => e.preset !== 'type.matchCut' && e.lines.some(l => l.role === 'hero'));
    expect(heroes.length).toBeGreaterThan(0);
    for (const h of heroes) {
      expect(['type.words', 'hero.extrudedStack.front']).toContain(h.preset);
      expect(h.lines.filter(l => l.role === 'hero')).toHaveLength(1);
      const hero = h.lines.find(l => l.role === 'hero')!;
      expect(words[h.wordRange[0]]!.emphasisScore + words[h.wordRange[1]]!.emphasisScore).toBeGreaterThan(0);
      expect(hero.text.length).toBeGreaterThan(0);
    }
    expect(fb.events.filter(e => e.lines.some(l => l.role === 'running'))).toEqual([]);
    expect(fb.style).toBe('retroNeon');
    expect(fb.fontPair).toBeTruthy();
    expect(heroCandidates(words).length).toBeGreaterThan(0);
  });
  it('respects density rules', () => expect(densityViolations(fb, words)).toEqual([]));
  it('fidelity check catches invented words', () => {
    const bad = {...fb, events: [{...fb.events[0]!, lines: [{text: 'invented', role: 'hero' as const}]}]};
    expect(transcriptFidelity(bad, words).length).toBe(1);
  });
  it('empty transcript gives an empty plan with a reason', () => {
    const r = buildFallbackPlan({words: [], shots});
    expect(r.plan.events).toEqual([]);
    expect(r.reason).toBeTruthy();
  });
});
