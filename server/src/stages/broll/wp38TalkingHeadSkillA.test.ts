/**
 * WP38: Skill A tools on CLASSIC talking-head polish. Offline: no render, no network, no model.
 *   1. the switch: classic polish only; faceless / explainer / non-polish never read it; default on; kill switch restores pre-WP38
 *   2. the TH path really gets the tools: cut plan + accumulate + impact FX from one fixture, composed
 *   3. caption position: face-safe y (schema, renderer maths, only on an accumulate direction), WP34 band untouched
 *   4. editorial stills: tighter caps (face primary), WP30 defaults untouched when no TH option is passed
 *   5. honest summary warnings
 *   6. wiring in analyzeVideo + isolation of Skill A (faceless) and Skill B (explainer)
 *   7. the offline proof exists and measured what it claims
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {ACCUMULATE, ACCUMULATE_FACE_SAFE, accumulateCenterYFrac, accumulateFaceSafeShiftPx, accumulateFaceSafeYFrac} from '../../../../remotion/src/lib/accumulateCaptions.ts';
import {captionDirectionSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {env} from '../../config/env.ts';
import {polishAccumulateCaptions} from '../../lib/polishAccumulateCaptions.ts';
import {impactFxIsEmpty, planImpactFx} from '../../lib/polishImpactFx.ts';
import {coveredFraction, EDITORIAL_MAX_OPEN_RUNS, planEditorialStillMontage} from './editorialStillMontage.ts';
import {resolvePolishSkill} from './explainerPacing.ts';
import {
  TH_CAPTION_FACE_SAFE_Y_FRAC,
  TH_MAX_MID_ITEMS,
  TH_MAX_MID_RUNS,
  TH_MAX_OPEN_ITEMS,
  TH_MAX_OPEN_RUNS,
  TH_MAX_RUN_SEC,
  TH_NON_FACE_MAX_FRAC,
  TH_STILLS_MAX_FRAC,
  TH_STILLS_MAX_SEC,
  resolveTalkingHeadSkillA,
  talkingHeadCaption,
  talkingHeadSkillAWarnings,
  talkingHeadStillOptions,
} from './talkingHeadSkillA.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar, type VoWord} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = JSON.parse(read('./fixtures/wp38-vo-words.json')) as {durationSec: number; words: VoWord[]};
const flags = {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags});
const bare = {position: 'bottom' as const, bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#FFFFFF', boxColor: null, template: 'karaoke', animation: 'scale', fontScale: 1.4, maxWords: 2, glow: false, activeStyle: 'fill' as const};
const cardRanges = plan.chapterCards.map(card => ({start: card.at, end: Math.round((card.at + card.duration) * 1000) / 1000}));
const cardSec = cardRanges.reduce((sum, range) => sum + (range.end - range.start), 0);

let counter = 0;
/** A fake stock library: every query gets its own https photo, so every lookup resolves. */
const resolver = async (query: string, o: {excludeKeys: Set<string>}) => {
  counter += 1;
  const photo = {assetUrl: `https://images.example.com/${query.replace(/\s+/g, '-')}-${counter}.jpg`, provider: 'pexels', providerId: counter};
  return o.excludeKeys.has(`${photo.provider}:${photo.providerId}`) ? null : photo;
};
const stillSec = (runs: Array<{start: number; end: number}>) => runs.reduce((sum, run) => sum + (run.end - run.start), 0);

describe('WP38 1) the switch', () => {
  const base = {polish: true, skillAToolsEnabled: true, faceless: false, explainer: false};
  it('classic polish only: faceless, explainer, non-polish and the kill switch all read false', () => {
    expect(resolveTalkingHeadSkillA(base)).toBe(true);
    expect(resolveTalkingHeadSkillA({...base, faceless: true})).toBe(false);
    expect(resolveTalkingHeadSkillA({...base, explainer: true})).toBe(false);
    expect(resolveTalkingHeadSkillA({...base, faceless: true, explainer: true})).toBe(false);
    expect(resolveTalkingHeadSkillA({...base, polish: false})).toBe(false);
    expect(resolveTalkingHeadSkillA({...base, skillAToolsEnabled: false})).toBe(false);
  });
  it('POLISH_TH_SKILL_A_TOOLS defaults ON; the faceless and explainer opt-ins still default OFF', () => {
    expect(env.POLISH_TH_SKILL_A_TOOLS).toBe(true);
    expect(env.POLISH_FACELESS_DOC).toBe(false);
    expect(env.POLISH_EXPLAINER_SKILL).toBe(false);
    expect(read('../../config/env.ts')).toMatch(/POLISH_TH_SKILL_A_TOOLS: bool\(true\)/);
    expect(read('../../../../.env.example')).toMatch(/# POLISH_TH_SKILL_A_TOOLS=1/);
  });
  it('agrees with resolvePolishSkill: the switch is true exactly when the skill is `default`', () => {
    for (const faceless of [false, true]) for (const explainer of [false, true]) {
      expect(resolveTalkingHeadSkillA({polish: true, skillAToolsEnabled: true, faceless, explainer})).toBe(resolvePolishSkill({faceless, explainer}).skill === 'default');
    }
  });
});

describe('WP38 2) the talking-head path gets cuts + accumulate + impact FX', () => {
  const accumulate = polishAccumulateCaptions(bare, {plan, words: fixture.words, durationSec: fixture.durationSec});
  const th = talkingHeadCaption(accumulate.caption);
  const fx = planImpactFx({words: fixture.words, plan, durationSec: fixture.durationSec});
  it('the VO cut plan is dense (hard-cut anchors) and has a chapter card', () => {
    expect(plan.cuts.length).toBeGreaterThan(30);
    expect(plan.chapterCards.length).toBeGreaterThanOrEqual(1);
  });
  it('the caption is the WP34 accumulate grammar (mode + cut times) at the face-safe y', () => {
    expect(th.caption.mode).toBe('word_by_word_accumulate');
    expect(th.caption.cutTimes?.length).toBeGreaterThan(30);
    expect(th.caption.faceSafeYFrac).toBe(TH_CAPTION_FACE_SAFE_Y_FRAC);
    expect(th.caption.centerYFrac).toBe(0.46); // the WP34 value is kept (the schema band cannot hold 0.58); faceSafeYFrac is the override
    expect(th.warnings).toEqual(['polish_th_skill_a:caption_y:58']);
  });
  it('the impact FX fire on the talking-head fixture: >= 1 flash and >= 1 black-and-white span', () => {
    expect(impactFxIsEmpty(fx.fx)).toBe(false);
    expect(fx.fx.flashes.length).toBeGreaterThanOrEqual(1);
    expect(fx.fx.bwSpans.length).toBeGreaterThanOrEqual(1);
    expect(fx.fx.punchIns.length).toBeGreaterThanOrEqual(1);
  });
  it('composed: the report names every tool that fired', () => {
    const warnings = talkingHeadSkillAWarnings({
      cutPlanned: true, cuts: plan.cuts.length, chapterCards: plan.chapterCards.length, accumulate: true,
      fx: {flashes: fx.fx.flashes.length, satPops: fx.fx.satPops.length, punchIns: fx.fx.punchIns.length, bwSpans: fx.fx.bwSpans.length}, stills: 6, stillSec: 9, durationSec: fixture.durationSec,
    });
    expect(warnings).toContain(`polish_th_skill_a:cuts:${plan.cuts.length}`);
    expect(warnings).toContain('polish_th_skill_a:accumulate:on');
    expect(warnings.some(w => /^polish_th_skill_a:fx:\d+f\/\d+s\/\d+p\/\d+bw$/.test(w))).toBe(true);
    expect(warnings).toContain('polish_th_skill_a:stills:6');
  });
});

describe('WP38 3) caption position', () => {
  it('only an accumulate direction is moved; anything else (CaptionKit / template / style guide captions) comes back untouched', () => {
    const untouched = talkingHeadCaption(bare);
    expect(untouched.caption).toBe(bare);
    expect(untouched.warnings).toEqual([]);
    const explainerLike = talkingHeadCaption({...bare, mode: 'chunk_swap'});
    expect(explainerLike.caption.faceSafeYFrac).toBeUndefined();
  });
  it('idempotent', () => {
    const accumulate = polishAccumulateCaptions(bare, {plan, words: fixture.words, durationSec: fixture.durationSec}).caption;
    const once = talkingHeadCaption(accumulate).caption;
    expect(talkingHeadCaption(once).caption).toEqual(once);
  });
  it('the schema accepts faceSafeYFrac 0.55-0.60 and still rejects it outside; the WP34 centerYFrac band is unchanged', () => {
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, faceSafeYFrac: 0.58})).not.toThrow();
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, faceSafeYFrac: 0.7})).toThrow();
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, faceSafeYFrac: 0.4})).toThrow();
    expect(() => captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, centerYFrac: 0.58})).toThrow();
    expect(captionDirectionSchema.parse({position: 'center', bottomFrac: 0.2, faceSafeYFrac: 0.58}).faceSafeYFrac).toBe(0.58);
  });
  it('renderer maths: a direction with no faceSafeYFrac shifts 0 px (WP34 exactly); with it the line moves to 0.58 of the height', () => {
    expect(accumulateFaceSafeShiftPx(1920, {centerYFrac: 0.46})).toBe(0);
    expect(accumulateFaceSafeShiftPx(1920, undefined)).toBe(0);
    const shifted = 1920 * accumulateCenterYFrac(0.46) + accumulateFaceSafeShiftPx(1920, {centerYFrac: 0.46, faceSafeYFrac: 0.58});
    expect(shifted / 1920).toBeCloseTo(0.58, 6);
    expect(accumulateFaceSafeYFrac(undefined)).toBe(0.58);
    expect(accumulateFaceSafeYFrac(0.9)).toBe(ACCUMULATE_FACE_SAFE.yFracMax);
    expect(accumulateFaceSafeYFrac(0.1)).toBe(ACCUMULATE_FACE_SAFE.yFracMin);
    expect(ACCUMULATE.yFracMax).toBe(0.5); // the faceless band is untouched
    expect(ACCUMULATE.yFracMin).toBe(0.42);
  });
  it('the renderer keeps the WP34 position expression and adds the face-safe shift + a first-row anchor only with faceSafeYFrac', () => {
    const code = stripComments(read('../../../../remotion/src/components/AccumulateCaptions.tsx'));
    expect(code).toContain('top: height * accumulateCenterYFrac(direction?.centerYFrac) + accumulateFaceSafeShiftPx(height, direction)');
    expect(code).toContain("transform: 'translate(-50%, -50%)',");
    expect(code).toContain('...(faceSafe ? {transform: `translate(-50%, -${fontSize * 0.55}px)`} : {})');
  });
});

describe('WP38 4) editorial stills: tighter caps, face primary', () => {
  const options = talkingHeadStillOptions(fixture.durationSec, cardSec);
  it('the caps: 1 open run + 2 mid runs, 3-4 stills, runs <= 5.4 s, <= 25 % of the runtime and (with the cards) <= 28 %', () => {
    expect(options).toMatchObject({maxOpenRuns: TH_MAX_OPEN_RUNS, maxMidRuns: TH_MAX_MID_RUNS, maxOpenItems: TH_MAX_OPEN_ITEMS, maxMidItems: TH_MAX_MID_ITEMS, maxRunSec: TH_MAX_RUN_SEC});
    expect(options.maxTotalSec).toBeLessThanOrEqual(fixture.durationSec * TH_STILLS_MAX_FRAC + 1e-6);
    expect(options.maxTotalSec + cardSec).toBeLessThanOrEqual(fixture.durationSec * TH_NON_FACE_MAX_FRAC + 1e-6);
    expect(options.maxTotalSec).toBeLessThanOrEqual(TH_STILLS_MAX_SEC);
    expect(talkingHeadStillOptions(600).maxTotalSec).toBe(TH_STILLS_MAX_SEC); // a long edit is capped in seconds too
    expect(talkingHeadStillOptions(10, 5).maxTotalSec).toBe(0); // the cards already used the budget
  });
  it('the talking-head montage is a few short inserts: >= 3 stills, face on screen >= 70 % (stills + cards), far less than the WP30 montage', async () => {
    const th = await planEditorialStillMontage({words: fixture.words, outputDurationSec: fixture.durationSec, blockedRanges: cardRanges, resolver, ...options});
    const wp30 = await planEditorialStillMontage({words: fixture.words, outputDurationSec: fixture.durationSec, blockedRanges: cardRanges, resolver});
    expect(th.stills).toBeGreaterThanOrEqual(3);
    expect(th.runs.length).toBeGreaterThanOrEqual(1);
    expect(th.runs.filter(run => run.start < options.openSec).length).toBeLessThanOrEqual(TH_MAX_OPEN_RUNS);
    expect(th.runs.length).toBeLessThanOrEqual(TH_MAX_OPEN_RUNS + TH_MAX_MID_RUNS);
    for (const run of th.runs) {
      expect(run.items.length).toBeLessThanOrEqual(TH_MAX_OPEN_ITEMS);
      expect(run.end - run.start).toBeLessThanOrEqual(TH_MAX_RUN_SEC + 1e-6);
    }
    const covered = stillSec(th.runs) + cardSec;
    expect(stillSec(th.runs)).toBeLessThanOrEqual(options.maxTotalSec + 0.01); // the planner rounds each hold to 1 ms
    expect(1 - covered / fixture.durationSec).toBeGreaterThanOrEqual(0.7);
    expect(stillSec(th.runs)).toBeLessThan(stillSec(wp30.runs));
  });
  it('no TH option passed = the WP30 montage exactly (passing the WP30 defaults explicitly changes nothing)', async () => {
    const a = await planEditorialStillMontage({words: fixture.words, outputDurationSec: fixture.durationSec, blockedRanges: cardRanges, resolver: makeDeterministic()});
    const b = await planEditorialStillMontage({words: fixture.words, outputDurationSec: fixture.durationSec, blockedRanges: cardRanges, resolver: makeDeterministic(), maxOpenItems: 6, maxMidItems: 4, maxRunSec: 9});
    expect(b.runs.map(run => [run.start, run.end, run.items.length])).toEqual(a.runs.map(run => [run.start, run.end, run.items.length]));
    expect(EDITORIAL_MAX_OPEN_RUNS).toBe(2); // the WP30 caps are intact
  });
  it('a full-frame beat already on screen comes out of the same budget', () => {
    const blocked = [{start: 0, end: 10}];
    expect(coveredFraction(0, 40, blocked) * 40).toBeCloseTo(10, 6);
    expect(talkingHeadStillOptions(40, 10).maxTotalSec).toBeCloseTo(1.2, 6);
  });
});

function makeDeterministic() {
  let n = 0;
  return async (query: string, o: {excludeKeys: Set<string>}) => {
    n += 1;
    const photo = {assetUrl: `https://images.example.com/${query.replace(/\s+/g, '-')}-${n}.jpg`, provider: 'pexels', providerId: n};
    return o.excludeKeys.has(`${photo.provider}:${photo.providerId}`) ? null : photo;
  };
}

describe('WP38 5) honest warnings', () => {
  const base = {cutPlanned: true, cuts: 43, chapterCards: 2, accumulate: true, fx: {flashes: 2, satPops: 1, punchIns: 1, bwSpans: 2}, stills: 6, stillSec: 9, durationSec: 40};
  it('a tool that did not fire says so', () => {
    expect(talkingHeadSkillAWarnings({...base, cutPlanned: false, cuts: 0, chapterCards: 0})).toContain('polish_th_skill_a:no_cut_plan');
    expect(talkingHeadSkillAWarnings({...base, accumulate: false})).toContain('polish_th_skill_a:accumulate:off');
    expect(talkingHeadSkillAWarnings({...base, fx: null})).toContain('polish_th_skill_a:fx:none');
    expect(talkingHeadSkillAWarnings({...base, fx: {flashes: 0, satPops: 0, punchIns: 0, bwSpans: 0}})).toContain('polish_th_skill_a:fx:none');
    expect(talkingHeadSkillAWarnings({...base, stills: 0, stillSec: 0})).toContain('polish_th_skill_a:stills:0');
  });
  it('reports the share of the runtime the stills cover (not a face claim)', () => {
    expect(talkingHeadSkillAWarnings(base)).toContain('polish_th_skill_a:stills_pct:23');
  });
});

describe('WP38 6) wiring + isolation of Skill A / Skill B', () => {
  const analyze = stripComments(read('../../pipeline/analyzeVideo.ts'));
  it('analyzeVideo computes the switch from the env flags and applies it only through the TH helpers', () => {
    expect(analyze).toContain('resolveTalkingHeadSkillA({polish: Boolean(polishPath), skillAToolsEnabled: flags.thSkillATools, faceless: flags.facelessDoc, explainer: flags.explainerSkill})');
    expect(analyze).toContain('if (thSkillA) {');
    expect(analyze).toContain('talkingHeadCaption(broll.caption)');
    expect(analyze).toContain('...(thSkillA ? talkingHeadStillOptions(timeline.outputDurationSec, coveredFraction(0, timeline.outputDurationSec, stillBlocked) * timeline.outputDurationSec) : {})');
    expect(analyze).toContain('...talkingHeadSkillAWarnings({');
  });
  it('the face-safe move comes AFTER the accumulate captions and BEFORE the explainer block (which still replaces the captions)', () => {
    const accumulateAt = analyze.indexOf('polishAccumulateCaptions(broll.caption');
    const thAt = analyze.indexOf('talkingHeadCaption(broll.caption)');
    const explainerAt = analyze.indexOf("if (polishSkill.skill === 'explainer')");
    expect(accumulateAt).toBeGreaterThan(0);
    expect(thAt).toBeGreaterThan(accumulateAt);
    expect(explainerAt).toBeGreaterThan(thAt);
  });
  it('the Skill A (faceless) and Skill B (explainer) wiring is untouched', () => {
    expect(analyze).toContain('const facelessDoc = Boolean(polishPath && flags.facelessDoc && voGrammar && motion && stockConfigured());');
    expect(analyze).toContain("resolvePolishSkill({faceless: Boolean(polishPath && flags.facelessDoc), explainer: Boolean(polishPath && flags.explainerSkill)})");
    expect(analyze).toContain('!facelessDoc && flags.editorialStills');
    const facelessBlock = analyze.slice(analyze.indexOf('if (facelessDoc && voGrammar && motion) {'), analyze.indexOf('let thStillCount = 0;'));
    expect(facelessBlock).not.toContain('thSkillA');
    expect(facelessBlock).not.toContain('talkingHead');
    const explainerBlock = analyze.slice(analyze.indexOf("if (polishSkill.skill === 'explainer')"), analyze.indexOf('if (facelessDoc && voGrammar && motion) {'));
    expect(explainerBlock).not.toContain('thSkillA');
    expect(explainerBlock).not.toContain('talkingHead');
  });
  it('the faceless and explainer planners do not know the TH module', () => {
    for (const file of ['./facelessDocLane.ts', './explainerPacing.ts', './explainerClaims.ts', '../../lib/polishExplainerCaptions.ts']) {
      expect(read(file)).not.toContain('talkingHeadSkillA');
    }
  });
  it('the TH module is pure: no env, no I/O, no network', () => {
    const code = stripComments(read('./talkingHeadSkillA.ts'));
    expect(code).not.toMatch(/process\.env|from '\.\.\/\.\.\/config\/env|node:fs|fetch\(/);
  });
});

describe('WP38 7) the offline proof', () => {
  const dir = '../../../../remotion/out/phase36-readiness/';
  it('the proof files exist', () => {
    for (const file of ['wp38-talking-head-skill-a.mp4', 'wp38-contact-sheet.jpg', 'wp38-caption-y.jpg', 'wp38-measured.json', 'wp38-plan.json', 'WP38_TH_SKILL_A.md']) {
      expect(existsSync(new URL(dir + file, import.meta.url)), file).toBe(true);
    }
  });
  it('the measurements pass every check (face primary, accumulate, face-safe y clear of the face, flash, B&W, stills, card)', () => {
    const measured = JSON.parse(read(dir + 'wp38-measured.json')) as {checks: Record<string, boolean>; faceShare: {plannedPrimary: number}; captions: {faceSafeYRange: number[]; preWp38YRange: number[]}};
    for (const [name, value] of Object.entries(measured.checks)) expect(value, name).toBe(true);
    expect(measured.faceShare.plannedPrimary).toBeGreaterThanOrEqual(0.7);
    expect(measured.captions.faceSafeYRange[0]).toBeGreaterThanOrEqual(0.55);
    expect(measured.captions.preWp38YRange[1]).toBeLessThan(0.5);
  });
  it('the doc is honest about what was already there vs newly composed, and names the flags', () => {
    const doc = read(dir + 'WP38_TH_SKILL_A.md');
    for (const needle of ['POLISH_TH_SKILL_A_TOOLS', 'POLISH_FACELESS_DOC', 'POLISH_EXPLAINER_SKILL', 'already', 'newly', 'PAUSED', 'faceSafeYFrac', 'wp38-talking-head-skill-a.mp4']) expect(doc, needle).toContain(needle);
  });
});
