/**
 * Phase D: kinetic-led with a usable RVM person matte plans BEHIND-the-presenter beats (the environmental hero ONLY, as a scrolling marquee so every glyph is clear of the head for a stretch; small word-pop type is never behind), spread through the edit and capped by a matted-footage budget.
 * Without a matte (or in the sparse planner) NOTHING changes: those cases are compared against signatures captured from the planner BEFORE this phase (wp57KineticLedMatte.golden.json).
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {LIBRARY_COMPOSITION_IDS, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {
  KINETIC_MATTE_BUDGET_CPU_SEC,
  KINETIC_MATTE_BUDGET_GPU_SEC,
  KINETIC_MATTE_MIN_SPACING_SEC,
  MATTE_RANGE_PAD_SEC,
  isMatteBeat,
  kineticLedBeatBudget,
  kineticMatteQuota,
  kineticMotionFamily,
  matteBudgetSecForDevice,
} from './kineticLedConfig.ts';
import {kineticTypeCapabilitiesFor} from './kineticTypeCapabilities.ts';
import {kineticCandidatesOf} from './kineticTypeStory.ts';
import {bindMotionTemplateContent} from './motionTemplateBind.ts';
import {KINETIC_STORY_IDS, planCraftTemplateBeats} from './planCraftTemplateBeats.ts';
import {sentencesOfWords} from './visualBackend/planVisualBackendBeats.ts';

// ---- fixtures (the same builders produced the golden file before the change) -------------------------------------------------------------------------------
function wordsFor(sentences: string[], gap = 3.2, t0 = 1.2) {
  const words: {text: string; start: number; end: number}[] = [];
  let t = t0;
  for (const sentence of sentences) {
    for (const text of sentence.split(/\s+/)) {
      words.push({text, start: t, end: t + 0.28});
      t += 0.32;
    }
    t += gap;
  }
  return words;
}
const PITCH = ['Real growth matters now.', 'Sales jumped 200 percent today.', 'Not luck but proof.', 'Remember the bottom line here.', 'Never ignore this result.', 'Simple offer beats noise.', 'We gained 50 leads fast.', 'Instead of ads use trust.', 'Free audit changes everything.', 'That is why growth compounds.', 'Attention drives the whole story.', 'Just DM me for a free video.'];
// short, concrete phrases WITHOUT any impact keyword: the relaxed matte gate is for these
const SHORT = ['Walk beside the river.', 'Pick your favourite window.', 'Dinner tastes better outside.', 'Neighbours wave across gardens.', 'Mornings begin with coffee.', 'Sunlight crosses the kitchen.', 'Children chase the bicycle.', 'Lanterns glow along terraces.', 'Evenings smell of rosemary.', 'Music drifts through hallways.', 'Bakers open before sunrise.', 'Gardens bloom behind fences.'];
// one-word sentences: the hero needs >= 2 words, so these can only become word pops
const ONE_WORD = ['Seriously.', 'Absolutely.', 'Honestly.', 'Genuinely.', 'Certainly.', 'Literally.', 'Remarkably.', 'Truthfully.'];
const BOX = {x: 0.25, y: 0.3, w: 0.5, h: 0.45};
const HOST = {hostComposited: true, box: BOX};

const make = (sentences: string[], gap: number, opts: {led: boolean; matte?: typeof HOST | {src: string; box: typeof BOX}; matteBudgetSec?: number; box?: typeof BOX | undefined}) => {
  const words = wordsFor(sentences, gap);
  const durationSec = Math.max(40, words[words.length - 1]!.end + 1);
  return {
    words,
    durationSec,
    plan: planCraftTemplateBeats({skill: 'explainer', durationSec, words, subjectBox: opts.box === undefined ? BOX : opts.box, kineticLed: opts.led, ...(opts.matte ? {subjectMatte: opts.matte} : {}), ...(opts.matteBudgetSec !== undefined ? {matteBudgetSec: opts.matteBudgetSec} : {})}),
  };
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const signature = (p: ReturnType<typeof planCraftTemplateBeats>) => ({beats: p.beats.map(b => [b.templateId, r3(b.start), r3(b.end), JSON.stringify(b.hint ?? {})]), warnings: p.warnings});
const GOLDEN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wp57KineticLedMatte.golden.json'), 'utf8')) as Record<string, ReturnType<typeof signature>>;
const matteBeatsOf = (p: ReturnType<typeof planCraftTemplateBeats>) => p.beats.filter(b => isMatteBeat(b));
const matteCost = (b: {start: number; end: number}) => b.end - b.start + 2 * MATTE_RANGE_PAD_SEC;

describe('without a matte (or without kinetic-led) the plan is exactly what it was before Phase D', () => {
  it.each([
    ['led_nomatte_pitch', PITCH, 0.4, {led: true}],
    ['led_nomatte_short', SHORT, 3.2, {led: true}],
    ['sparse_nomatte_pitch', PITCH, 0.4, {led: false}],
    ['sparse_matte_pitch', PITCH, 0.4, {led: false, matte: HOST}],
    ['sparse_matte_short', SHORT, 3.2, {led: false, matte: HOST}],
  ] as const)('%s: beats, hints and warnings are identical to the pre-change golden', (name, sentences, gap, opts) => {
    expect(signature(make([...sentences], gap, opts).plan)).toEqual(GOLDEN[name]);
  });

  it('a matte budget changes nothing when there is no matte', () => {
    const a = make(SHORT, 3.2, {led: true});
    const b = make(SHORT, 3.2, {led: true, matteBudgetSec: 3});
    expect(signature(b.plan)).toEqual(signature(a.plan));
    expect(a.plan.warnings.some(w => w.startsWith('kinetic_led:matte'))).toBe(false);
  });

  it('a no-matte hero keeps its face-safe headroom hint; no beat is a matte beat', () => {
    const {plan} = make(SHORT, 3.2, {led: true});
    const heroes = plan.beats.filter(b => b.templateId === 'clip_45_type_environmental_hero');
    expect(heroes.length).toBeGreaterThan(0);
    for (const h of heroes) expect((h.hint as {occlusionFallback?: string}).occlusionFallback).toBe('headroom');
    expect(matteBeatsOf(plan).length).toBe(0);
  });
});

describe('kinetic-led WITH a usable matte', () => {
  const {plan, durationSec} = make(SHORT, 3.2, {led: true, matte: HOST, matteBudgetSec: KINETIC_MATTE_BUDGET_CPU_SEC});
  const matte = matteBeatsOf(plan);

  it('plans environmental-hero beats that sit BEHIND the presenter (no headroom fallback), many more than without a matte', () => {
    const heroes = plan.beats.filter(b => b.templateId === 'clip_45_type_environmental_hero');
    expect(heroes.length).toBeGreaterThanOrEqual(3);
    for (const h of heroes) expect((h.hint as Record<string, unknown>).occlusionFallback).toBeUndefined();
    for (const h of heroes) expect(h.hint).toMatchObject({reveal: 'sweep'}); // every matte hero carries the sweep reveal: the word travels so every letter is clear for part of the beat
    expect(matte.length).toBeGreaterThanOrEqual(4);
    expect(matte.length).toBeGreaterThan(matteBeatsOf(make(SHORT, 3.2, {led: true}).plan).length);
  });

  it('fills the matte quota first (~40% of the beat budget) and reports it', () => {
    const budget = kineticLedBeatBudget(durationSec);
    const quota = kineticMatteQuota(budget);
    expect(quota).toBe(Math.max(1, Math.round(budget * 0.4)));
    expect(matte.length).toBeGreaterThanOrEqual(Math.min(quota, 4));
    expect(plan.warnings).toContain(`kinetic_led:matte:beats:${matte.length}_of_${budget}`);
    expect(plan.warnings).toContain(`kinetic_led:matte:quota:${quota}`);
    expect(plan.warnings.some(w => /^kinetic_led:matte:seconds:[\d.]+_of_20$/.test(w))).toBe(true);
  });

  it('spreads the matte beats through the edit (pass 1 keeps them >= the spacing apart)', () => {
    const starts = matte.map(b => b.start).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(KINETIC_MATTE_MIN_SPACING_SEC - 1e-6);
  });

  it('still obeys the gap, one-treatment-per-sentence and no-four-in-a-row (time order) rules', () => {
    const story = plan.beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId)).sort((a, b) => a.start - b.start);
    for (let i = 1; i < story.length; i += 1) expect(story[i]!.start - story[i - 1]!.end).toBeGreaterThanOrEqual(2 - 1e-6); // kinetic-led gap
    const sentences = sentencesOfWords(make(SHORT, 3.2, {led: true}).words as never);
    const owner = (t: number) => sentences.findIndex(s => t >= s.start - 0.5 && t <= s.end + 0.5);
    const owners = story.map(b => owner(b.start + 0.2));
    expect(new Set(owners).size).toBe(owners.length);
    for (let i = 0; i + 3 < story.length; i += 1) {
      const f = kineticMotionFamily(story[i]!.templateId);
      expect([1, 2, 3].every(d => kineticMotionFamily(story[i + d]!.templateId) === f), `4 ${f} beats in a row at ${story[i]!.start}`).toBe(false);
    }
  });

  it('on a number-heavy pitch the matte never displaces the stated-number beats (they are kept exactly as without a matte)', () => {
    const noMatte = make(PITCH, 0.4, {led: true}).plan;
    const withMatte = make(PITCH, 0.4, {led: true, matte: HOST}).plan;
    const numbers = (p: typeof noMatte) => p.beats.filter(b => b.templateId === 'clip_46_type_impact_number').map(b => r3(b.start));
    expect(numbers(withMatte)).toEqual(numbers(noMatte));
    expect(numbers(withMatte).length).toBeGreaterThanOrEqual(2);
    expect(matteBeatsOf(withMatte).length).toBeGreaterThanOrEqual(1); // its heroes are upgraded to matte beats
  });
});

describe('the matted-footage budget', () => {
  it('never plans more matted seconds (beat + pad on each side) than the cap, for any cap', () => {
    for (const cap of [0, 3, 5, 8, 13, 20, 45]) {
      const {plan} = make(SHORT, 3.2, {led: true, matte: HOST, matteBudgetSec: cap});
      const used = matteBeatsOf(plan).reduce((sum, b) => sum + matteCost(b), 0);
      expect(used, `cap ${cap}`).toBeLessThanOrEqual(cap + 1e-6);
    }
  });

  it('a larger cap never gives fewer matte beats; a zero cap gives none and demotes heroes to the headroom layout', () => {
    const counts = [0, 5, 13, 45].map(cap => matteBeatsOf(make(SHORT, 3.2, {led: true, matte: HOST, matteBudgetSec: cap}).plan).length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBe(0);
    expect(counts[3]).toBeGreaterThan(counts[1]!);
    const zero = make(SHORT, 3.2, {led: true, matte: HOST, matteBudgetSec: 0}).plan;
    const demoted = zero.beats.filter(b => b.templateId === 'clip_45_type_environmental_hero');
    expect(demoted.length).toBeGreaterThan(0);
    for (const h of demoted) expect(h.hint).toMatchObject({occlusion: 'none', occlusionFallback: 'headroom'});
    expect(zero.warnings).toContain('kinetic_led:matte:demoted:budget');
  });

  it('beyond the cap a hero is only planned in the headroom layout where the measured subject box leaves room, else not at all', () => {
    const tight = make(SHORT, 3.2, {led: true, matte: {hostComposited: true, box: {x: 0.25, y: 0.1, w: 0.5, h: 0.8}}, matteBudgetSec: 0, box: {x: 0.25, y: 0.1, w: 0.5, h: 0.8}}).plan;
    expect(tight.beats.filter(b => b.templateId === 'clip_45_type_environmental_hero').length).toBe(0); // no headroom above a head at y = 0.1
  });

  it('defaults to the conservative CPU cap; an explicit mps / cuda device earns the larger one; unknown never does', () => {
    expect(KINETIC_MATTE_BUDGET_CPU_SEC).toBe(20);
    expect(KINETIC_MATTE_BUDGET_GPU_SEC).toBe(45);
    for (const gpu of ['mps', 'cuda', ' MPS ', 'CUDA']) expect(matteBudgetSecForDevice(gpu), gpu).toBe(45);
    for (const other of ['cpu', 'auto', '', undefined, 'tpu', 'cuda:0']) expect(matteBudgetSecForDevice(other as string | undefined), String(other)).toBe(20);
    const unset = make(SHORT, 3.2, {led: true, matte: HOST}).plan;
    const explicit = make(SHORT, 3.2, {led: true, matte: HOST, matteBudgetSec: 20}).plan;
    expect(signature(unset)).toEqual(signature(explicit));
  });
});

describe('hero scoring and the relaxed claim gate (kinetic-led with a matte only)', () => {
  const sentenceOf = (text: string) => sentencesOfWords(wordsFor([text], 0) as never)[0]!;
  const allowed = new Set<string>(KINETIC_STORY_IDS);
  const heroOf = (text: string, ctx: Record<string, unknown>) => kineticCandidatesOf(sentenceOf(text) as never, {durationSec: 40, subjectBox: BOX, ...ctx} as never, allowed).candidates.find(c => c.templateId === 'clip_45_type_environmental_hero');

  it('a strong SHORT phrase without an impact keyword becomes a hero only when preferMatte; sparse + matte and no matte are unchanged', () => {
    const text = 'Walk beside the river.';
    expect(heroOf(text, {hasMatte: true, preferMatte: true})).toBeDefined();
    expect(heroOf(text, {hasMatte: true, preferMatte: true})!.score).toBeCloseTo(0.88, 5);
    expect(heroOf(text, {hasMatte: true})).toBeUndefined();
    expect(heroOf(text, {})).toBeUndefined();
  });

  it('still needs >= 2 words, no digits, and a short sentence', () => {
    const ctx = {hasMatte: true, preferMatte: true};
    expect(heroOf('Seriously.', ctx)).toBeUndefined();
    expect(heroOf('Walk beside 5 rivers.', ctx)).toBeUndefined();
    expect(heroOf('Walk beside the quiet river towards the old stone bridge.', ctx)).toBeUndefined(); // 9 words
  });

  it('boosts the matte hero score for a real claim (0.98 vs 0.93 vs 0.90) and leaves the no-matte score alone', () => {
    const text = 'Never ignore this result.';
    expect(heroOf(text, {hasMatte: true, preferMatte: true})!.score).toBeCloseTo(0.98, 5);
    expect(heroOf(text, {hasMatte: true})!.score).toBeCloseTo(0.93, 5);
    expect(heroOf(text, {})!.score).toBeCloseTo(0.9, 5);
  });
});

describe('word pop (clip_49) is NEVER behind the presenter', () => {
  it('the planner never marks a word pop as a matte beat, with or without a matte, kinetic-led or sparse', () => {
    for (const opts of [{led: true, matte: HOST}, {led: true}, {led: false, matte: HOST}, {led: true, matte: {src: 'https://cdn.example/m.webm', box: BOX}}] as const) {
      const plan = make(ONE_WORD, 3.2, opts).plan;
      const pops = plan.beats.filter(b => b.templateId === 'clip_49_type_kinetic_word_pop');
      if (opts.led && 'matte' in opts && opts.matte === HOST) expect(pops.length).toBeGreaterThanOrEqual(1);
      for (const b of pops) {
        expect(isMatteBeat(b)).toBe(false);
        expect((b.hint as Record<string, unknown>).occlusion).toBeUndefined();
      }
    }
  });

  it('the binder drops occlusion + hostComposited for a word pop even when a stale hint and a host matte ask for them', () => {
    const words = wordsFor(['Seriously.'], 0, 5);
    const base = {words, beatStart: 4.8, beatEnd: 6.6, accent: '#3D4A5C', ink: '#171717'};
    const pop = (hint: Record<string, unknown>, subjectMatte?: unknown) => bindMotionTemplateContent({...base, templateId: 'clip_49_type_kinetic_word_pop', hint: {word: 'Seriously', anchor: 'left', ...hint}, ...(subjectMatte ? {subjectMatte} : {})} as never) as Record<string, unknown> | null;
    for (const props of [pop({occlusion: 'matte'}, HOST), pop({occlusion: 'matte'}, {...HOST, src: 'https://cdn.example/m.webm'}), pop({occlusion: 'matte', reveal: 'sweep'}), pop({}, HOST)]) {
      expect(props).toMatchObject({word: 'Seriously'});
      expect(props).not.toHaveProperty('occlusion');
      expect(props).not.toHaveProperty('hostComposited');
      expect(props).not.toHaveProperty('subjectSrc');
    }
  });

  it('the library registry never forwards occlusion / hostComposited / a subject asset to TypeKineticWordPop', () => {
    const hit = (content: Record<string, unknown>) => resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'overlay', content: {motionTemplateId: 'clip_49_type_kinetic_word_pop', word: 'Seriously', anchor: 'left', ...content}} as never);
    for (const content of [{}, {occlusion: 'matte'}, {occlusion: 'matte', hostComposited: true}, {occlusion: 'matte', subjectSrc: 'https://cdn.example/m.webm'}]) {
      const res = hit(content);
      expect(res?.compositionId).toBe('TypeKineticWordPop');
      expect(res?.props).toMatchObject({word: 'Seriously'});
      expect(res?.props).not.toHaveProperty('occlusion');
      expect(res?.props).not.toHaveProperty('hostComposited');
    }
  });

  it('is documented as matte-free for the Director', () => {
    const row = kineticTypeCapabilitiesFor('explainer', new Set<string>(LIBRARY_COMPOSITION_IDS)).find(r => r.templateId === 'clip_49_type_kinetic_word_pop');
    expect(row?.matte).toBe('none');
  });

  it('the Remotion comp has no occlusion branch (no SubjectForeground in TypeKineticWordPop)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../remotion/src/motion/compositions/templates/KineticTypeStory.tsx'), 'utf8');
    const pop = src.slice(src.indexOf('export const TypeKineticWordPop'), src.indexOf('// ---', src.indexOf('export const TypeKineticWordPop')));
    expect(pop).not.toContain('SubjectForeground');
    expect(pop).not.toMatch(/occluded|occlusion ===/);
  });
});

describe('environmental hero: the sweep reaches the props, and an unreadable word is demoted', () => {
  const heroWords = (sentence: string) => wordsFor([sentence], 0, 5);
  const hero = (sentence: string, hint: Record<string, unknown>, subjectMatte: unknown = HOST) =>
    bindMotionTemplateContent({words: heroWords(sentence), beatStart: 4.8, beatEnd: 7, accent: '#3D4A5C', ink: '#171717', templateId: 'clip_45_type_environmental_hero', hint, subjectMatte} as never) as Record<string, unknown> | null;

  it('a short word behind the presenter binds occlusion matte + reveal sweep (host-composited and own-asset)', () => {
    expect(hero('Take the lead.', {text: 'lead'})).toMatchObject({occlusion: 'matte', reveal: 'sweep', hostComposited: true});
    expect(hero('Take the lead.', {text: 'lead'}, {src: 'https://cdn.example/m.webm', box: BOX})).toMatchObject({occlusion: 'matte', reveal: 'sweep', subjectSrc: 'https://cdn.example/m.webm'});
  });

  it('a long word is NOT demoted (it scrolls); a subject that fills the frame (no usable gutter) is, even with a stale matte hint (no occlusion, no reveal, no host flag)', () => {
    const long = hero('That changes everything.', {text: 'everything'});
    expect(long).toMatchObject({occlusion: 'matte', reveal: 'sweep', hostComposited: true});
    const union = {hostComposited: true, box: {x: 0, y: 0.09, w: 1, h: 0.91}};
    for (const props of [hero('That changes everything.', {text: 'everything'}, union), hero('That changes everything.', {text: 'everything', occlusion: 'matte', reveal: 'sweep'}, union), hero('Take the lead.', {text: 'lead'}, union)]) {
      expect(props).toMatchObject({occlusion: 'none'});
      expect(props).not.toHaveProperty('reveal');
      expect(props).not.toHaveProperty('hostComposited');
    }
  });

  it('an explicit demotion still wins over a readable word', () => {
    const props = hero('Take the lead.', {text: 'lead', occlusion: 'none', occlusionFallback: 'headroom'});
    expect(props).toMatchObject({occlusion: 'none'});
    expect(props).not.toHaveProperty('reveal');
  });

  it('reaches the Remotion props through the library registry: occlusion always travels with reveal sweep (the comp demotes an unsweepable word itself)', () => {
    const hit = (content: Record<string, unknown>) => resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'overlay', content: {motionTemplateId: 'clip_45_type_environmental_hero', subjectBox: BOX, occlusion: 'matte', hostComposited: true, ...content}} as never);
    expect(hit({text: 'LEAD'})?.props).toMatchObject({text: 'LEAD', occlusion: 'matte', reveal: 'sweep', hostComposited: true});
    expect(hit({text: 'LEAD', occlusion: 'none'})?.props).toMatchObject({occlusion: 'none'});
    expect(hit({text: 'LEAD', occlusion: 'none'})?.props).not.toHaveProperty('reveal');
    expect(hit({text: 'LEAD', hostComposited: false})?.props).toMatchObject({occlusion: 'none'});
  });

  it('the planner puts heroes behind the presenter whatever the word length, and refuses text-behind only for a subject with no usable gutter (headroom where there is room, else not planned)', () => {
    const plan = make(SHORT, 3.2, {led: true, matte: HOST}).plan;
    const heroes = plan.beats.filter(b => b.templateId === 'clip_45_type_environmental_hero');
    expect(heroes.length).toBeGreaterThanOrEqual(3);
    expect(heroes.some(b => String((b.hint as Record<string, unknown>).text ?? '').length >= 6 && isMatteBeat(b))).toBe(true); // a long word is behind the presenter
    const fullFrame = {x: 0, y: 0.25, w: 1, h: 0.7};
    const none = make(SHORT, 3.2, {led: true, matte: {hostComposited: true, box: fullFrame}, box: fullFrame}).plan;
    expect(none.beats.filter(b => b.templateId === 'clip_45_type_environmental_hero' && isMatteBeat(b)).length).toBe(0);
  });
});

describe('isMatteBeat', () => {
  it('hero: yes unless demoted or on the no-matte fallback; word pop: never; nothing else', () => {
    expect(isMatteBeat({templateId: 'clip_45_type_environmental_hero'})).toBe(true);
    expect(isMatteBeat({templateId: 'clip_45_type_environmental_hero', hint: {occlusion: 'none'}})).toBe(false);
    expect(isMatteBeat({templateId: 'clip_45_type_environmental_hero', hint: {occlusionFallback: 'headroom'}})).toBe(false);
    expect(isMatteBeat({templateId: 'clip_49_type_kinetic_word_pop'})).toBe(false);
    expect(isMatteBeat({templateId: 'clip_49_type_kinetic_word_pop', hint: {occlusion: 'matte'}})).toBe(false); // a stale hint cannot make small type a matte beat
    expect(isMatteBeat({templateId: 'clip_47_type_staggered_phrase', hint: {occlusion: 'matte'}})).toBe(false);
  });
});
