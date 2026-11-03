/**
 * WP13B: image-beat language. Grade-flip face beats, a pacing planner that rotates the reset kinds, and a whip / hard-cut preference at the cuts where the picture changes. Offline: no render, no network, no stock.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {GRADE_RAMP_SEC, gradeAmountAt, gradeFilterAt} from '../../../../remotion/src/lib/gradeBeat.ts';
import {POLISH_LEAN_EDITS} from '../../lib/editToolkits.ts';
import type {WordToken} from '../../types/blueprint.ts';
import {EDIT_LOOKS} from '../directorV2/editLooks.ts';
import type {VisualDirection} from './geminiDirector.ts';
import {applyEditLookToDirection} from './lookDirection.ts';
import {faceStretches, GRADE_SEC, maxGradeBeats, planPacing, RESET_ROTATION} from './pacing.ts';
import {applyPolishDensityFill} from './polishDensityFill.ts';
import {CUT_TRANSITION_ROTATION, cutTransitionKeyword, isProceduralKeyword, TRANSITION_KEYWORDS} from './transitionPlan.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('WP13B 1) grade-flip face beat', () => {
  it('gradeAmountAt ramps in, holds and ramps out; nothing outside a beat; the end is exclusive; overlapping beats take the strongest', () => {
    const beats = [{startSec: 10, endSec: 12}];
    expect(gradeAmountAt(beats, 9.99)).toBe(0);
    expect(gradeAmountAt(beats, 10)).toBe(0);
    expect(gradeAmountAt(beats, 10 + GRADE_RAMP_SEC / 2)).toBeCloseTo(0.5, 2);
    expect(gradeAmountAt(beats, 11)).toBe(1);
    expect(gradeAmountAt(beats, 12 - GRADE_RAMP_SEC / 2)).toBeCloseTo(0.5, 2);
    expect(gradeAmountAt(beats, 12)).toBe(0);
    expect(gradeAmountAt([{startSec: 0, endSec: 4}, {startSec: 3, endSec: 3.1}], 3.05)).toBe(1);
    expect(gradeAmountAt(undefined, 5)).toBe(0);
    expect(gradeAmountAt([{startSec: 5, endSec: 5}], 5)).toBe(0); // empty beat
  });
  it('gradeFilterAt is a plain CSS filter (no backdrop-filter) and undefined when no grade is active', () => {
    expect(gradeFilterAt([{startSec: 10, endSec: 12}], 5)).toBeUndefined();
    expect(gradeFilterAt([{startSec: 10, endSec: 12}], 11)).toBe('grayscale(1) contrast(1.18)');
    expect(read('../../../../remotion/src/lib/gradeBeat.ts')).not.toContain('backdrop');
  });
  it('wiring: the blueprint field defaults to [], the base video track takes the filter, ShortVideo feeds it from the beats', () => {
    expect(timelineBlueprintSchema.shape.gradeBeats.parse(undefined)).toEqual([]);
    const track = read('../../../../remotion/src/components/VideoTrack.tsx');
    expect(track).toContain('grade?: string');
    expect(track).toContain('...(grade ? {filter: grade} : {})');
    expect(read('../../../../remotion/src/ShortVideo.tsx')).toContain('grade={gradeFilterAt(blueprint.gradeBeats, timeSec)}');
    expect(read('../../types/blueprint.ts')).toContain('gradeBeats?: Array<{startSec: number; endSec: number}>');
  });
  it('the server keeps a beat only where the talking head is on screen (no cutaway / split / container / full or split plate over it) and warns via the fill', () => {
    const analyze = read('../../pipeline/analyzeVideo.ts');
    expect(analyze).toContain('const gradeBeats = polishPath');
    expect(analyze).toContain('...(gradeBeats.length > 0 ? {gradeBeats} : {})');
    for (const needle of ["overlay.layout === 'split'", 'broll.mediaContainers', "graphic.placement.mode === 'full_screen'"]) expect(analyze).toContain(needle);
    expect(read('./brollPlanner.ts')).toContain('{gradeBeats: direction.gradeBeats}');
  });
});

describe('WP13B 2) image-beat planner: variety', () => {
  const starts = Array.from({length: 11}, (_, index) => 2 + index * 3.5);
  it('the rotation is framed window -> grade flip -> procedural transition, least-used first', () => {
    expect(RESET_ROTATION).toEqual(['framed_window', 'grade_bw', 'transition']);
  });
  it('a 40 s clip with no beats and framed windows allowed gets >= 2 DIFFERENT reset kinds, within the caps, on sentence starts, >= 4 s apart', () => {
    const plan = planPacing({durationSec: 40, beats: [], sentenceStarts: starts, framedAllowed: true, transitionAllowed: true, gradeAllowed: true});
    const kinds = [plan.framed.length > 0, plan.grades.length > 0, plan.transitions.length > 0].filter(Boolean).length;
    expect(kinds).toBeGreaterThanOrEqual(2);
    expect(plan.grades.length).toBeLessThanOrEqual(maxGradeBeats(40));
    for (const grade of plan.grades) {
      expect(grade.end - grade.start).toBeCloseTo(GRADE_SEC, 2);
      expect(grade.end - grade.start).toBeGreaterThanOrEqual(1.2);
      expect(grade.end - grade.start).toBeLessThanOrEqual(2.5);
      expect(starts).toContain(grade.start);
    }
    const all = [...plan.framed, ...plan.grades, ...plan.transitions].sort((a, b) => a.start - b.start);
    for (let i = 1; i < all.length; i += 1) expect(all[i]!.start - all[i - 1]!.start).toBeGreaterThanOrEqual(4);
  });
  it('the first reset is a framed window when allowed (as before); without framed windows the grade flip leads; grade flips are opt-in', () => {
    const withFramed = planPacing({durationSec: 40, beats: [], sentenceStarts: starts, framedAllowed: true, transitionAllowed: true, gradeAllowed: true});
    expect(withFramed.framed.length).toBeGreaterThanOrEqual(1);
    const noFramed = planPacing({durationSec: 40, beats: [], sentenceStarts: starts, framedAllowed: false, transitionAllowed: true, gradeAllowed: true});
    expect(noFramed.framed).toEqual([]);
    expect(noFramed.grades.length).toBeGreaterThanOrEqual(1);
    expect(noFramed.transitions.length).toBeGreaterThanOrEqual(1);
    const optOut = planPacing({durationSec: 40, beats: [], sentenceStarts: starts, framedAllowed: true, transitionAllowed: true});
    expect(optOut.grades).toEqual([]);
  });
  it('a stretch with no room for a reset does not stop the others (the next-longest stretch is tried)', () => {
    const plan = planPacing({durationSec: 60, beats: [{start: 20, end: 23}, {start: 33, end: 36}], sentenceStarts: [25, 45, 50], framedAllowed: false, transitionAllowed: true, gradeAllowed: true});
    expect(plan.grades.length + plan.transitions.length).toBeGreaterThanOrEqual(1);
  });
  it('capped: at most 2 grade flips per clip even on a long empty clip; none on a short one', () => {
    const long = planPacing({durationSec: 120, beats: [], sentenceStarts: Array.from({length: 30}, (_, i) => 2 + i * 3.8), framedAllowed: true, transitionAllowed: true, gradeAllowed: true});
    expect(long.grades.length).toBeLessThanOrEqual(2);
    expect(planPacing({durationSec: 15, beats: [], sentenceStarts: [3, 7, 11], framedAllowed: true, transitionAllowed: true, gradeAllowed: true}).grades).toEqual([]);
    expect(faceStretches([...long.framed, ...long.grades, ...long.transitions], 120).length).toBeGreaterThanOrEqual(0);
  });
  describe('on the explain path through the fill', () => {
    const SENTENCES = Array.from({length: 15}, (_, index) => `Sentence number ${index + 1} talks about something different and interesting here.`);
    const WORDS: WordToken[] = SENTENCES.flatMap((sentence, index) => {
      const tokens = sentence.split(' ');
      const slot = 3.5 / tokens.length;
      return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
    });
    const LEAN = new Set<string>(POLISH_LEAN_EDITS);
    const direction = (): VisualDirection => ({
      hookTitle: 'Ship faster', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [], caption: {} as never, suggestedLutIds: [], preferredLutId: '',
      zooms: [{timestamp: 6, durationSec: 2.5}], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [], estimatedCostUsd: 0, source: 'gemini',
    });
    const run = (lookId: string, extra: Record<string, unknown> = {}) => {
      const look = EDIT_LOOKS.find(entry => entry.id === lookId)!;
      const enforced = applyEditLookToDirection(direction(), look, {matteUsable: false}).direction;
      return applyPolishDensityFill({direction: enforced, look, words: WORDS, outputDurationSec: 60, requested: LEAN, matteUsable: false, cutawayResolvable: false, explainPlates: true, coveredBy: [], ...extra});
    };
    it('a look without framed windows gets a grade flip on the direction with polish_pace:grade_bw:<n>; no text is added; off with pacing:false; not off the explain path', () => {
      const result = run('talking_head');
      const grades = result.direction.gradeBeats ?? [];
      expect(grades.length).toBeGreaterThanOrEqual(1);
      expect(grades.length).toBeLessThanOrEqual(maxGradeBeats(60));
      expect(result.warnings).toContain(`polish_pace:grade_bw:${grades.length}`);
      for (const grade of grades) expect(grade.end - grade.start).toBeCloseTo(GRADE_SEC, 2);
      expect(result.direction.motionGraphics).toEqual([]);
      expect(result.direction.semanticEmphasis).toEqual([]);
      expect(run('talking_head', {pacing: false}).direction.gradeBeats).toBeUndefined();
      expect(run('talking_head', {explainPlates: false}).direction.gradeBeats).toBeUndefined();
    });
    it('a look with framed windows still gets a reset (the fixture\'s plates cover all but the tail, so one reset fits there); resets and plates never overlap', () => {
      const result = run('explainer_cutaway');
      const resets = [
        ...result.direction.mediaContainers.map(item => ({start: item.start, end: item.end})),
        ...(result.direction.gradeBeats ?? []),
        ...(result.direction.transitions ?? []),
      ];
      expect(resets.length).toBeGreaterThanOrEqual(1);
      for (const reset of resets) for (const anchor of result.plateAnchors) expect(reset.start >= anchor.startSec + 3 || reset.end <= anchor.startSec).toBe(true);
    });
  });
});

describe('WP13B 3) cut-transition preference where the picture changes', () => {
  it('cutTransitionKeyword rotates procedural whip / hard-cut / flash styles, never a stock light leak; stable for any index', () => {
    expect(CUT_TRANSITION_ROTATION).toEqual(['whip blur right', 'smash zoom', 'hard cut', 'whip blur left', 'dip color', 'blur dissolve', 'flash white', 'whip blur']); // WP16 expanded the rotation
    for (let index = -3; index < 12; index += 1) {
      expect(isProceduralKeyword(cutTransitionKeyword(index)), String(index)).toBe(true);
      expect(TRANSITION_KEYWORDS as readonly string[]).not.toContain(cutTransitionKeyword(index));
    }
    expect(cutTransitionKeyword(0)).toBe('whip blur right');
    expect(cutTransitionKeyword(1)).toBe('smash zoom');
    expect(cutTransitionKeyword(8)).toBe(cutTransitionKeyword(0));
  });
  it('wiring: polish (editLooks) engine cut transitions use it, with renderGenerated so the asset-less clip survives; non-polish keeps the stock keywords', () => {
    const planner = read('./brollPlanner.ts');
    expect(planner).toContain('procedural: Boolean(input.editLooks)');
    expect(planner).toContain('keyword: input.procedural ? cutTransitionKeyword(index) : TRANSITION_QUERIES[index % TRANSITION_QUERIES.length]!');
    expect(planner).toContain('...(input.procedural ? {renderGenerated: true} : {})');
  });
});
