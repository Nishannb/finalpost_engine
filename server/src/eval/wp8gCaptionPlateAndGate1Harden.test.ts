/**
 * WP8G tests. Part 1: the full-width caption backing plate on talking-head footage is OFF by default (opt-in only). Part 2: the Gemini budget plan for polish (occupancy one attempt, the keep-plan,
 * Director v2 and motion Director keep slots), the look fallback warning, the motion Director failure reason. Pure tests, source-text pins; no render, no network, no model call.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {captionBackingPlate, captionBackingPlateEnabled, captionsForBrollSplit} from '../../../remotion/src/lib/captionSplit.ts';
import {
  createGeminiEditBudget,
  DEFAULT_BUDGET_PLAN,
  geminiBudgetFromLimit,
  geminiBudgetPlanFor,
  POLISH_BUDGET_PLAN,
} from '../lib/geminiEditBudget.ts';
import {EngineError} from '../lib/errors.ts';
import {motionDirectorFailureReason} from '../stages/motionDirector/index.ts';
import {editLookFallbackWarnings} from '../stages/directorV2/editLooks.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('Part 1: the full-width caption band is off unless a blueprint opts in', () => {
  it('only an exact true enables it; absent, false and anything else do not', () => {
    expect(captionBackingPlateEnabled({backingPlate: true})).toBe(true);
    for (const value of [undefined, null, false, 0, 1, 'true', 'yes', {}, []]) expect(captionBackingPlateEnabled({backingPlate: value}), String(value)).toBe(false);
    expect(captionBackingPlateEnabled({})).toBe(false);
    expect(captionBackingPlateEnabled(undefined)).toBe(false);
    expect(captionBackingPlateEnabled(null)).toBe(false);
  });
  it('a typical legible blueprint (legibility.captions without the flag, bottom captions, the gaming-stream template) gets no band', () => {
    const legibilityCaptions = {avoidSplitFace: true, splitBoxColor: 'rgba(8,8,10,0.62)', splitTextColor: '#FFFFFF', splitHighlightColor: '#22D3EE', splitPlateColor: '#08080A'};
    expect(captionBackingPlateEnabled(legibilityCaptions)).toBe(false);
  });
  it('the old geometry function is unchanged for the opt-in (and still returns null where it always did)', () => {
    const layout = {position: 'bottom' as const, bottomFrac: 0.18, frameTopFrac: 0, frameHeightFrac: 1};
    const band = captionBackingPlate({template: 'gaming-stream', packageTheme: false, boxColor: null, splitPlateShowing: false, layout, canvasHeight: 1920})!;
    expect(band.top + band.height).toBeCloseTo(1920 * (1 - 0.18) + 1920 * 0.03, 6);
    expect(captionBackingPlate({template: 'box', packageTheme: false, boxColor: null, splitPlateShowing: false, layout, canvasHeight: 1920})).toBeNull();
    expect(captionBackingPlate({template: 'gaming-stream', packageTheme: false, boxColor: 'rgba(0,0,0,0.5)', splitPlateShowing: false, layout, canvasHeight: 1920})).toBeNull();
  });
  it('a real split layout still has its own plate, which the flag does not govern', () => {
    const plate = captionsForBrollSplit({position: 'bottom' as const, bottomFrac: 0.18, frameTopFrac: 0, frameHeightFrac: 1}, 'top', 1920).plate;
    expect(plate.height).toBeGreaterThan(0);
    const video = read('remotion/src/ShortVideo.tsx');
    expect(video).toContain('(splitCaptions?.plate ?? backingPlate)');
    expect(video).toContain('const splitCaptions = legibleCaptions && captionSplit ? captionsForBrollSplit(');
  });
  it('ShortVideo paints the backing plate only with the explicit opt-in (and still only for blueprints with legibility.captions, words and an active line)', () => {
    const video = read('remotion/src/ShortVideo.tsx');
    expect(video).toContain('legibleCaptions && captionBackingPlateEnabled(legibleCaptions) && blueprint.captionWords.length > 0 && captionPlateLineActive(plateLines, timeSec)');
    expect(video.match(/captionBackingPlate\(/g)).toHaveLength(1);
    expect(video.match(/captionBackingPlateEnabled\(/g)).toHaveLength(1);
    expect(video).toContain('OFF unless the blueprint explicitly opts in');
  });
  it('the schema carries the flag as an optional boolean, and nothing in the server writes it (polish, mvp and cuts cannot force the band back on)', () => {
    expect(read('remotion/src/blueprintSchema.ts')).toContain('backingPlate: z.boolean().optional(),');
    expect(read('server/src/types/blueprint.ts')).toContain('backingPlate?: boolean;');
    const walk = (dir: string): string[] => {
      
      return readdirSync(dir).flatMap((name: string) => {
        const path = resolve(dir, name);
        return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
      });
    };
    const writers = walk(resolve(ROOT, 'server/src')).filter(path => stripComments(readFileSync(path, 'utf8')).includes('backingPlate'));
    expect(writers.map(path => path.replace(`${ROOT}/`, ''))).toEqual(['server/src/types/blueprint.ts']);
  });
  it('the legibility writer and the profile code never mention the plate flag', () => {
    for (const file of ['server/src/lib/productEditProfile.ts', 'server/src/pipeline/analyzeVideo.ts', 'server/src/stages/broll/legibility.ts']) {
      let text = '';
      try {
        text = read(file);
      } catch {
        continue;
      }
      expect(stripComments(text), file).not.toContain('backingPlate');
    }
  });
  it('audit: every translucent caption background in the caption components belongs to a rounded, shrink-wrapped box (a per-word or per-line pill), never a canvas-wide band', () => {
    for (const file of ['remotion/src/components/KineticCaptions.tsx', 'remotion/src/captions/DynamicCaptionRenderer.tsx']) {
      const lines = read(file).split('\n');
      lines.forEach((line, index) => {
        if (!/backgroundColor: ['"`]rgba\(/.test(line) && !/: 'rgba\(15,23,42,0\.46\)'/.test(line)) return;
        const window = lines.slice(Math.max(0, index - 14), index + 2).join('\n');
        expect(window, `${file}:${index + 1}`).toMatch(/borderRadius/);
        expect(window, `${file}:${index + 1}`).not.toMatch(/left: 0,\s*\n\s*right: 0/);
      });
    }
  });
  it('the only canvas-wide caption band in the engine is the one ShortVideo draws for a split plate or the opt-in plate (left 0, right 0, a plate top and height)', () => {
    const video = read('remotion/src/ShortVideo.tsx');
    const bands = [...video.matchAll(/left: 0,\s*\n\s*right: 0,\s*\n\s*top: \(splitCaptions\?\.plate \?\? backingPlate\)!\.top,/g)];
    expect(bands).toHaveLength(1);
  });
});

describe('Part 2: the Gemini budget plan for polish', () => {
  const polish = (cap: number) => createGeminiEditBudget(cap, {plan: POLISH_BUDGET_PLAN});
  const attempt = (budget: ReturnType<typeof polish>, label: string) => budget.reserve(label).ok;
  const L = {keep: 'cuts ai keep plan', story: 'Director v2 story analyst', creative: 'Director v2 creative director', motion: 'motion graphics director', occ: 'Gemini speaker occupancy', profile: 'content profile'};

  it('cap 8: six reserved slots (one each, in priority order) and a pool of two', () => {
    const report = polish(8).report();
    expect(report.reservedAtStart).toEqual({keep_plan: 1, director_story: 1, director_creative: 1, motion_director: 1, occupancy: 1, content_profile: 1});
    expect(report.poolAtStart).toBe(2);
  });
  it('occupancy gets ONE attempt, then its fallback: retries are refused even while the pool still has slots', () => {
    const budget = polish(8);
    expect([attempt(budget, L.occ), attempt(budget, L.occ), attempt(budget, L.occ)]).toEqual([true, false, false]);
    expect(budget.report().byLabel[L.occ]).toBe(1);
    expect(budget.report().reservedUnused.keep_plan).toBe(1); // nothing was taken from the others
  });
  it('the Gate 1 sequence (three occupancy tries, keep-plan with a retry, story with a retry, creative, motion, content profile) starves nobody important', () => {
    const budget = polish(8);
    const results = [L.occ, L.occ, L.occ, L.keep, L.keep, L.story, L.story, L.creative, L.motion, L.profile].map(label => [label, attempt(budget, label)] as const);
    const refused = results.filter(([, ok]) => !ok).map(([label]) => label);
    expect(refused).toEqual([L.occ, L.occ]);
    expect(budget.report().attempted).toBe(8);
  });
  it('the SAME sequence under the default plan does starve the Director and the motion Director (why the plan exists)', () => {
    const budget = createGeminiEditBudget(8, {plan: DEFAULT_BUDGET_PLAN});
    const results = [L.occ, L.occ, L.occ, L.keep, L.keep, L.story, L.story, L.creative, L.motion, L.profile].map(label => [label, attempt(budget, label as never)] as const);
    const refused = results.filter(([, ok]) => !ok).map(([label]) => label);
    expect(refused.some(label => label === L.creative || label === L.motion)).toBe(true);
  });
  it('a retry (repair) may use the pool but never a slot another stage reserved', () => {
    const budget = polish(8);
    expect([attempt(budget, 'Director v2 repair'), attempt(budget, 'Director v2 story analyst repair'), attempt(budget, 'Director v2 repair')]).toEqual([true, true, false]);
    expect([L.keep, L.story, L.creative, L.motion, L.occ, L.profile].map(label => attempt(budget, label))).toEqual([true, true, true, true, true, true]);
  });
  it('a small cap hands slots out in priority order: with 4, the keep-plan, story, creative and motion Director run and occupancy falls back', () => {
    const budget = polish(4);
    expect([L.occ, L.motion, L.creative, L.story, L.keep].map(label => attempt(budget, label))).toEqual([false, true, true, true, true]);
  });
  it('the plan is chosen by profile: polish gets it, every other profile the default (unchanged); 0 is no budget; negative fails closed with the plan', () => {
    expect(geminiBudgetPlanFor('polish')).toBe(POLISH_BUDGET_PLAN);
    for (const profile of ['legacy', 'mvp', 'cuts', undefined] as const) expect(geminiBudgetPlanFor(profile)).toBe(DEFAULT_BUDGET_PLAN);
    expect(geminiBudgetFromLimit(0, POLISH_BUDGET_PLAN)).toBeUndefined();
    expect(geminiBudgetFromLimit(-1, POLISH_BUDGET_PLAN)!.reserve(L.keep).ok).toBe(false);
    expect(geminiBudgetFromLimit(8, POLISH_BUDGET_PLAN)!.report().reservedAtStart).toHaveProperty('motion_director');
    expect(geminiBudgetFromLimit(8)!.report().reservedAtStart).toEqual({director: 1, occupancy: 1, content_profile: 1});
  });
  it('the call sites pass the plan for the resolved profile', () => {
    expect(read('server/src/pipeline/analysisRunner.ts')).toContain('geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(extras.editProfile))');
    expect(read('server/src/scripts/firstVideo.ts')).toContain('geminiBudgetFromLimit(env.GEMINI_EDIT_MAX_REQUESTS, geminiBudgetPlanFor(editProfile))');
  });
  it('the labels in the plan are the labels the stages really send', () => {
    const labelSources: Array<[string, string]> = [
      ['server/src/stages/filters/cutsAiKeepPlan.ts', "label: 'cuts ai keep plan'"],
      ['server/src/stages/directorV2/storyAnalyst.ts', "label: 'Director v2 story analyst'"],
      ['server/src/stages/directorV2/creativeDirector.ts', "label: 'Director v2 creative director'"],
      ['server/src/stages/motionDirector/motionDirector.ts', "label: 'motion graphics director'"],
      ['server/src/stages/layout/occupancy.ts', "label: 'Gemini speaker occupancy'"],
      ['server/src/stages/contentProfile/contentProfile.ts', "label: 'content profile'"],
    ];
    for (const [file, label] of labelSources) expect(read(file), file).toContain(label);
    for (const label of Object.keys(POLISH_BUDGET_PLAN.labels)) expect(Object.values(POLISH_BUDGET_PLAN.labels)).toContain(POLISH_BUDGET_PLAN.labels[label]);
  });
});

describe('Part 2: the look fallback warning and the motion Director failure reason', () => {
  it('a Director v2 fallback on polish says `minimal_captions` was the look', () => {
    expect(editLookFallbackWarnings()).toEqual(['edit_look:minimal_captions', 'edit_look_fallback:minimal_captions']);
    // WP8H: the planner now builds the same warnings from the enforcement decision (the fallback direction is run through the minimal look), with the drops included
    const planner = read('server/src/stages/broll/brollPlanner.ts');
    expect(planner).toContain("warnings.push(...editLookWarnings({id: FALLBACK_LOOK_ID, requested: '', fellBack: true, dropped: enforced.dropped}));");
  });
  it('a failed motion Director keeps the bare warning and adds a reason', () => {
    expect(motionDirectorFailureReason(new EngineError('internal', 'x', {reason: 'edit_request_limit'}))).toBe('edit_request_limit');
    expect(motionDirectorFailureReason(new EngineError('upstream_error', 'boom'))).toBe('upstream_error');
    expect(motionDirectorFailureReason(new Error('anything with a secret key=abc'))).toBe('error');
    expect(motionDirectorFailureReason(null)).toBe('error');
    expect(motionDirectorFailureReason({code: 'Has Spaces And Caps'})).toBe('error');
    const stage = read('server/src/stages/motionDirector/index.ts');
    expect(stage).toContain("warnings: ['motion_director_failed', `motion_director_failed:${motionDirectorFailureReason(error)}`],");
  });
});
