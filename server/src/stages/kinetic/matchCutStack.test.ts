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

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
/** words of `text` starting at `t0` s, 0.3 s each */
const say = (text: string, t0: number): Array<{text: string; start: number; end: number}> => text.split(' ').map((w, i) => ({text: w, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25}));
const wordsOf = (raw: ReturnType<typeof say>): KineticWord[] => toKineticWords(raw, FPS);
const shotsFor = (words: KineticWord[]) => [{id: 's', startFrame: 0, endFrame: words[words.length - 1]!.endFrame + 120}];
const matchCuts = (words: KineticWord[]) => buildFallbackPlan({words, shots: shotsFor(words), fps: FPS}).plan.events.filter(e => e.preset === 'type.matchCut');

describe('type.matchCut (fallback planner): only the four legal moments', () => {
  it('a statistic / claim yields exactly one match cut with a transcript keyword and >= 5 phrase words', () => {
    const words = wordsOf(say('only 90% of creators ever make money from videos', 1));
    const mc = matchCuts(words);
    expect(mc).toHaveLength(1);
    const kw = mc[0]!.matchCut!.keyword;
    expect(words.map(w => w.text.toLowerCase())).toContain(kw.toLowerCase());
    expect(kw.length).toBeGreaterThanOrEqual(4);
    expect(kw.length).toBeLessThanOrEqual(12);
    const [a, b] = mc[0]!.wordRange;
    expect(b - a + 1).toBeGreaterThanOrEqual(5);
  });
  it('the solved event carries the TypeTextMatchCut props, is full-frame in front, and no type.words overlaps it', () => {
    const words = wordsOf(say('only 90% of creators ever make money from their videos every single day', 1));
    const shots = shotsFor(words);
    const plan = buildFallbackPlan({words, shots, fps: FPS}).plan;
    const scenes = {s: buildScene({shotId: 's', subjectBox: {x: 0.28, y: 0.3, w: 0.44, h: 0.65}, width: 720, height: 1280})};
    const {spec, report} = solveLayout({plan, words, shots, scenes, cameras: {s: new StaticCamera().track(shots[0]!)}, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width: 720, height: 1280, fps: FPS, seed: 1, planSource: 't'});
    const mc = spec.events.filter(e => e.presetResolved === 'type.matchCut');
    expect(mc).toHaveLength(1);
    expect(mc[0]!.layering).toBe('front');
    expect(mc[0]!.matchCut!.phrase.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    expect(mc[0]!.outFrame - mc[0]!.inFrame).toBeGreaterThanOrEqual(Math.round(1.6 * FPS));
    expect(mc[0]!.outFrame - mc[0]!.inFrame).toBeLessThanOrEqual(Math.round(2 * FPS));
    for (const e of spec.events) if (e !== mc[0]) expect(e.inFrame < mc[0]!.outFrame && mc[0]!.inFrame < e.outFrame, `${e.id} overlaps the match cut`).toBe(false);
    expect(report.violations).toEqual([]);
  });
  it('a spelled number, a narrative pivot, the opening hook and the core keyword each qualify', () => {
    expect(matchCuts(wordsOf(say('ninety percent of creators fail within a year', 1))).map(e => e.matchCut!.keyword)).toEqual(['percent']);
    expect(matchCuts(wordsOf(say('the problem is nobody tells you the solution', 2)))).toHaveLength(1);
    const hook = matchCuts(wordsOf(say('viral hooks decide everything inside three seconds', 0.1)));
    expect(hook).toHaveLength(1);
    expect(hook[0]!.wordRange[0]).toBe(0);
    const core = matchCuts(wordsOf([...say('um so yeah today we talk', 1), ...say('what matters about editing is rhythm', 3.5), ...say('editing takes time', 9), ...say('good editing wins', 12)]));
    expect(core.map(e => e.matchCut!.keyword)).toEqual(['editing']);
  });
  it('naming a concept is NOT a trigger any more; "an example of a hook" is rejected', () => {
    expect(matchCuts(wordsOf(say('what is faith in the work we do', 1)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('that was an example of a hook', 2)))).toHaveLength(0);
    expect(matchCuts(wordsOf(say('the idea of a hook is called the first second', 3)))).toHaveLength(0);
  });
  it('filler produces zero match cuts', () => {
    expect(matchCuts(wordsOf(say('um so yeah i was just like going to the store and then it was fine okay', 1)))).toHaveLength(0);
  });
  it('two qualifying phrases produce only ONE match cut in the plan, however far apart', () => {
    expect(matchCuts(wordsOf([...say('only 90% of creators ever make money', 1), ...say('ninety percent of editors quit within a year', 6.5)]))).toHaveLength(1);
    expect(matchCuts(wordsOf([...say('only 90% of creators ever make money', 1), ...say('ninety percent of editors quit within a year', 26)]))).toHaveLength(1);
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
