import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {shortsSafeRect} from '../broll/heroSweep.ts';
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {buildFallbackPlan} from './fallback.ts';
import {restingMargin, restingRange, wordAabbAt} from './geometry.ts';
import {solveLayout} from './layout.ts';
import {PRESET_NAMES, brandConfigSchema, type KineticWord} from './schema.ts';
import {buildScene} from './scene.ts';
import {buildSheet2} from './sheet2.ts';
import {toKineticWords} from './transcript.ts';
import {matchCutBudget, matchCutMomentOf, matchCutWindow} from './matchCut.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
/** words of `text` starting at `t0` s, 0.3 s each */
const say = (text: string, t0: number): Array<{text: string; start: number; end: number}> => text.split(' ').map((w, i) => ({text: w, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25}));
const wordsOf = (raw: ReturnType<typeof say>): KineticWord[] => toKineticWords(raw, FPS);
const shotsFor = (words: KineticWord[]) => [{id: 's', startFrame: 0, endFrame: words[words.length - 1]!.endFrame + 120}];
const momentOf = (words: KineticWord[], keyword: string): string | undefined => { const i = words.findIndex(w => w.text.toLowerCase() === keyword.toLowerCase()); const v = matchCutMomentOf(i, [Math.max(0, i - 6), Math.min(words.length - 1, i + 6)], words, FPS); return v.ok ? v.moment : undefined; };
const matchCuts = (words: KineticWord[]) => buildFallbackPlan({words, shots: shotsFor(words), fps: FPS}).plan.events.filter(e => e.preset === 'type.matchCut');

const OPEN = () => wordsOf([...say('welcome back everyone this video is all about pricing for creators', 3), ...say('most creators get pricing wrong', 20)]); // "this video is all about pricing": an introducing construct whose object is the recurring topic
const CHAPTER = () => wordsOf([...say('that covers the basics of how hooks work', 10), ...say("now let's talk about pricing for creators", 13.2), ...say('prices change everything', 18)]);

describe('type.matchCut (fallback planner): only genuine narrative moments, never a keyword or a statistic alone', () => {
  it('the opening hook: the video\'s recurring topic introduced 2.5-10 s in yields exactly one match cut with a transcript keyword and >= 5 phrase words', () => {
    const words = OPEN();
    const mc = matchCuts(words);
    expect(mc).toHaveLength(1);
    expect(mc[0]!.matchCut!.keyword.toLowerCase()).toBe('pricing');
    const [a, b] = mc[0]!.wordRange;
    expect(b - a + 1).toBeGreaterThanOrEqual(5);
    expect(momentOf(words, mc[0]!.matchCut!.keyword)).toBe('openingHook');
  });

  it('the solved event is full-frame in front, 1.3-2 s long, carries real transcript words, and no type.words overlaps it', () => {
    const words = OPEN();
    const shots = shotsFor(words);
    const plan = buildFallbackPlan({words, shots, fps: FPS}).plan;
    const scenes = {s: buildScene({shotId: 's', subjectBox: {x: 0.28, y: 0.3, w: 0.44, h: 0.65}, width: 720, height: 1280})};
    const {spec, report} = solveLayout({plan, words, shots, scenes, cameras: {s: new StaticCamera().track(shots[0]!)}, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width: 720, height: 1280, fps: FPS, seed: 1, captionShortWords: true});
    const mc = spec.events.filter(e => e.presetResolved === 'type.matchCut');
    expect(mc).toHaveLength(1);
    expect(mc[0]!.layering).toBe('front');
    expect(mc[0]!.matchCut!.phrase.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    expect(mc[0]!.outFrame - mc[0]!.inFrame).toBeGreaterThanOrEqual(Math.round(1.3 * FPS));
    expect(mc[0]!.outFrame - mc[0]!.inFrame).toBeLessThanOrEqual(Math.round(2 * FPS));
    for (const e of spec.events) if (e !== mc[0]) expect(e.inFrame < mc[0]!.outFrame && mc[0]!.inFrame < e.outFrame, `${e.id} overlaps the match cut`).toBe(false);
    expect(report.violations).toEqual([]);
  });

  it('a chapter transition: a concluded thought, a pause, a section marker, then the next section\'s keyword', () => {
    const words = CHAPTER();
    const mc = matchCuts(words);
    expect(mc).toHaveLength(1);
    expect(mc[0]!.matchCut!.keyword.toLowerCase()).toBe('pricing');
    expect(momentOf(words, 'pricing')).toBe('chapterTransition');
  });

  it('a chapter marker WITHOUT a pause after a concluded thought is not a transition', () => {
    const words = wordsOf([...say('that covers the basics of how hooks work', 10), ...say("now let's talk about pricing for creators", 12.4)]);
    expect(matchCuts(words)).toHaveLength(0);
  });

  it('an evidence montage: consensus + impact in one long sentence, grounded in the speaker\'s own words', () => {
    const words = wordsOf(say('honestly everyone started talking about it and the data shows a massive spike in searches', 12));
    const mc = matchCuts(words);
    expect(mc).toHaveLength(1);
    expect(momentOf(words, mc[0]!.matchCut!.keyword)).toBe('evidenceMontage');
    expect(words.map(w => w.text.toLowerCase())).toContain(mc[0]!.matchCut!.keyword.toLowerCase());
  });

  it('before a reveal: a setup sentence with the reveal still to come; the card ends before the reveal starts', () => {
    const words = wordsOf([...say("and here's the secret about pricing", 14), ...say('it turns out nobody reads the fine print', 16.6)]);
    const mc = matchCuts(words);
    expect(mc).toHaveLength(1);
    expect(momentOf(words, mc[0]!.matchCut!.keyword)).toBe('beforeReveal');
    const revealStart = words.find(w => w.text === 'it')!.startFrame;
    const win = matchCutWindow(mc[0]!, words, shotsFor(words)[0], FPS)!;
    expect(win.outFrame).toBeLessThanOrEqual(revealStart);
    // no reveal after the setup = no build-up = no match cut
    expect(matchCuts(wordsOf(say("and here's the secret about pricing", 14)))).toHaveLength(0);
  });

  it('NOT triggers on their own: a statistic, a strong word, a first mention of a core keyword, a free timestamp', () => {
    expect(matchCuts(wordsOf(say('only 90% of creators ever make money from videos', 1)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('ninety percent of creators fail within a year', 1)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('the problem is nobody tells you the solution', 2)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('viral hooks decide everything inside three seconds', 0.1)))).toHaveLength(0); // 0.1 s in: before the 2.5 s opening window, and the topic does not recur
    expect(matchCuts(wordsOf([...say('um so yeah today we talk', 1), ...say('what matters about rhythm is feeling', 3.5), ...say('good rhythm wins', 12)]))).toHaveLength(0); // a recurring topic MENTIONED in the opening window is not an introduction
    expect(matchCuts(wordsOf([...say('we begin the video now', 1), ...say('some words about pacing today', 30), ...say('then rhythm for ten seconds straight', 31), ...say('rhythm again here', 50), ...say('and rhythm closes it', 70)]))).toHaveLength(0); // the topic is first said after 10 s: not an opening hook
  });

  it('naming a concept is NOT a trigger; "an example of a hook" is rejected; filler produces zero', () => {
    expect(matchCuts(wordsOf(say('what is faith in the work we do', 1)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('that was an example of a hook', 2)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('the idea of a hook is called the first second', 3)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('um so yeah i was just like going to the store and then it was fine okay', 1)))).toHaveLength(0);
  });

  it('the 43 s school clip\'s opening ("...went from zero to 30k a month and more by using a school alone"): a topic mentioned in passing is NOT an opening hook', () => {
    const words = wordsOf(say('these course creators went from zero to 30k a month and more by using a school alone', 0.08).concat(say('they are following three simple steps to use a school in the best way', 5.25)));
    expect(matchCuts(words)).toHaveLength(0);
  });
  it('an opening hook needs the topic to be the OBJECT of an introducing construct (or a question), and a topic that is introduced elsewhere in the sentence does not count', () => {
    const intro = (text: string) => matchCuts(wordsOf([...say(text, 2.6), ...say('and pricing again later on', 20)]));
    expect(intro("today we're talking about pricing for creators")).toHaveLength(1);
    expect(intro('here is how to fix your pricing today')).toHaveLength(1); // a how-to IS an introduction
    expect(intro('honestly just fix your pricing today before it hurts')).toHaveLength(0); // an instruction with no introducing construct
    expect(intro("here's how pricing really works for creators")).toHaveLength(1);
    expect(intro('why is your pricing so confusing for creators?')).toHaveLength(1); // a question
    expect(intro('my cousin said something about the weather and pricing today')).toHaveLength(0); // mentioned, not introduced
  });
  it('a chapter transition must introduce a NEW topic: a keyword already said earlier does not qualify', () => {
    const seen = wordsOf([...say('pricing matters for every creator out there', 1), ...say('that covers the basics of how hooks work', 10), ...say("now let's talk about pricing for creators", 13.2)]);
    expect(matchCuts(seen)).toHaveLength(0);
    expect(matchCuts(CHAPTER())).toHaveLength(1);
  });
  it('a reveal needs a substantive reveal sentence (>= 4 words) after the setup', () => {
    expect(matchCuts(wordsOf([...say("and here's the secret about pricing", 14), ...say('it works', 16.6)]))).toHaveLength(0);
  });
  it('generic recurring words are not a topic ("using", "more"): the planner needs a subject', () => {
    expect(matchCuts(wordsOf([...say('we keep using more tools and using more time', 3), ...say('using more helps', 20)]))).toHaveLength(0);
  });
});

describe('type.matchCut frequency (planner and validation)', () => {
  const longVideo = (second: number) => wordsOf([
    ...say('welcome back everyone this video is all about pricing for creators', 3),
    ...say('that covers the basics of how hooks work', second - 3),
    ...say("now let's talk about budgeting for creators", second + 0.2),
    ...say('thanks for watching everyone', 158),
  ]);
  it('short form (<= 90 s): at most ONE even when two moments qualify', () => {
    const words = wordsOf([...say('welcome back everyone this video is all about pricing for creators', 3), ...say('that covers the basics of how hooks work', 40), ...say("now let's talk about budgeting for creators", 43.2), ...say('bye', 60)]);
    expect(matchCuts(words)).toHaveLength(1);
  });
  it('long form: a second one only when 60 s or more apart; two that qualify 30 s apart give one', () => {
    expect(matchCuts(longVideo(100))).toHaveLength(2);
    expect(matchCuts(longVideo(33))).toHaveLength(1);
  });
  it('the budget is validated on a Director plan too (sanitizeMatchCuts) and in the solver (acceptMatchCuts)', () => {
    expect(matchCutBudget(43)).toBe(1);
    expect(matchCutBudget(90)).toBe(1);
    expect(matchCutBudget(160)).toBe(2);
    expect(matchCutBudget(300)).toBe(4);
  });
});

describe('stackOverCutout', () => {
  const sb = buildSheet2({only: ['b1.stack.clean', 'b2.stack.editorial']});
  const subject = (cell: (typeof sb.cells)[number]) => ({top: cell.box.y * 1280, bottom: (cell.box.y + cell.box.h) * 1280});
  it('the line above the subject box is front; lines overlapping the subject box are behind', () => {
    expect(sb.report.violations).toEqual([]);
    for (const [i, cell] of sb.cells.entries()) {
      const e = sb.spec.events.find(x => x.shotId === `shot-${i}`)!;
      expect(e.zone).toBe('stackOverCutout');
      const s = subject(cell);
      for (const line of e.lines) {
        const [f0, f1] = restingRange(e, line);
        const r = wordAabbAt(e, line, Math.round((f0 + f1) / 2));
        if (r.bottom <= s.top) expect(line.layer).toBe('front');
        else if (r.bottom > s.top && r.top < s.bottom) expect(line.layer).toBe('behind');
      }
      expect(e.lines.some(l => l.layer === 'front')).toBe(true);
      expect(e.lines.some(l => l.layer === 'behind')).toBe(true);
      const front = e.lines.filter(l => l.layer === 'front').map(l => wordAabbAt(e, l, Math.round((restingRange(e, l)[0] + restingRange(e, l)[1]) / 2)));
      for (const r of front) expect(r.bottom).toBeLessThanOrEqual(s.top);
    }
  });
  it('resting boxes stay inside shortsSafeRect', () => {
    const safe = shortsSafeRect(720, 1280);
    for (const e of sb.spec.events) expect(restingMargin(e, safe)).toBeGreaterThanOrEqual(-0.5);
  });
  it('is refused without a matte: nothing is placed behind', () => {
    const words: KineticWord[] = ['i', 'was', 'done'].map((text, idx) => ({idx, text, startFrame: 10 + idx * 14, endFrame: 22 + idx * 14, emphasisScore: 0.8}));
    const shots = [{id: 's', startFrame: 0, endFrame: 120}];
    const plan = {version: '1' as const, style: 'cinematicClean' as const, events: [{id: 'x', shotId: 's', wordRange: [0, 2] as [number, number], lines: [{text: 'i was', role: 'connector' as const}, {text: 'done', role: 'hero' as const}], preset: 'type.words' as const, layering: 'auto' as const, anchor: 'auto' as const, regionHint: 'stackOverCutout' as const}]};
    const scenes = {s: buildScene({shotId: 's', noMatte: true, width: 720, height: 1280})};
    const {spec} = solveLayout({plan, words, shots, scenes, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width: 720, height: 1280, fps: FPS, seed: 1, planSource: 't'});
    for (const e of spec.events) { expect(e.zone).not.toBe('stackOverCutout'); expect(e.layering).toBe('front'); }
  });
  it('sheet 2 is guardrail-clean and has nine distinct cells', () => {
    const all = buildSheet2();
    expect(all.cells).toHaveLength(9);
    expect(all.report.violations).toEqual([]);
    expect(all.report.dropped).toEqual([]);
  });
});

describe('duplication parity with type.matchCut', () => {
  it('schema.ts and spec.ts stay byte-identical and the preset is registered on both sides', () => {
    const remotion = join(here, '../../../../remotion/src/kinetic');
    expect(readFileSync(join(remotion, 'spec.ts'), 'utf8')).toBe(readFileSync(join(here, 'schema.ts'), 'utf8'));
    expect(PRESET_NAMES).toContain('type.matchCut');
    expect(readFileSync(join(remotion, 'presets.tsx'), 'utf8')).toContain("'type.matchCut':");
  });
});
