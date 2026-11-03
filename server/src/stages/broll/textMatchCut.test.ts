/**
 * TEXT MATCH CUT (clip_55_type_text_match_cut, toolkit kinetic_text): registration, meaning-based selection (incl. Kinetic-Led), grounding, the one-per-~20s cap and the style-bible invariants of the scene planner
 * (anchor lock, hard cuts on whole frames, no adjacent repeated layout, T2 linear push-in, T3 per-cut tint). Offline only.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {EDIT_TOOLKITS} from '../../lib/editToolkits.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {MATCH_CUT_SPECS, planMatchCutScenes, pushInScale, sceneAt, sceneFrames, type MatchCutVariant} from '../../../../remotion/src/lib/textMatchCut.ts';
import {kineticLedBeatBudget, kineticMotionFamily} from './kineticLedConfig.ts';
import {formatKineticTypeForDirector, kineticTypeCapabilitiesFor} from './kineticTypeCapabilities.ts';
import {KINETIC_TYPE_TEMPLATES, kineticCandidateFromDirector, kineticCandidatesOf, type KineticContext} from './kineticTypeStory.ts';
import {bindMotionTemplateContent} from './motionTemplateBind.ts';
import {SKILL_MOTION_TEMPLATE_ALLOWLIST, motionTemplate, type MotionTemplateWord} from './motionTemplateCatalog.ts';
import {KINETIC_STORY_IDS, planCraftTemplateBeats} from './planCraftTemplateBeats.ts';
import {sentencesOfWords} from './visualBackend/planVisualBackendBeats.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const ID = 'clip_55_type_text_match_cut';

const speech = (parts: Array<[string, number]>): MotionTemplateWord[] =>
  parts.flatMap(([text, at]) => text.split(/\s+/).map((word, i) => ({text: word, start: at + i * 0.3, end: at + i * 0.3 + 0.25})));
const sentence = (text: string, at = 10) => sentencesOfWords(speech([[text, at]]))[0]!;
const ctx = (extra: Partial<KineticContext> = {}): KineticContext => ({durationSec: 40, ...extra});
const only = new Set<string>([ID]);
const NAMING = 'So what is intelligence really and why does it matter to creators';
const SWAP = 'We move from chaos to clarity in every single edit we make';

describe('registration', () => {
  it('is a kinetic_text, frame-owning catalog row with a Remotion comp, in every skill that has kinetic type', () => {
    const spec = motionTemplate(ID)!;
    expect(spec).toMatchObject({compositionId: 'TypeTextMatchCut', toolkit: 'kinetic_text', ownsFrame: true});
    for (const skill of ['faceless', 'explainer', 'default'] as const) expect(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]).toContain(ID);
    expect(KINETIC_STORY_IDS).toContain(ID);
    expect(KINETIC_TYPE_TEMPLATES.type_text_match_cut).toBe(ID);
    expect(kineticMotionFamily(ID)).toBe('match_cut');
    expect(read('remotion/src/motion/index.ts')).toContain('TypeTextMatchCut');
  });

  it('is in the toolkit (proof): kinetic_text describes it and the Director capability block lists it', () => {
    const kinetic = EDIT_TOOLKITS.find(t => t.id === 'kinetic_text')!;
    expect(kinetic.description).toContain('type_text_match_cut');
    const rows = kineticTypeCapabilitiesFor('default', new Set(['TypeTextMatchCut']));
    expect(rows.map(r => r.name)).toContain('type_text_match_cut');
    expect(rows.find(r => r.name === 'type_text_match_cut')!.rendering).toContain('full-frame');
    expect(formatKineticTypeForDirector('default', new Set(['TypeTextMatchCut']))).toContain('type_text_match_cut (clip_55_type_text_match_cut');
  });

  it('resolves to the library comp as an opaque full-screen graphic (never as an overlay)', () => {
    const content = {motionTemplateId: ID, keyword: 'intelligence', phrase: 'what is intelligence really and why', variant: 'memo'};
    const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content});
    expect(hit?.compositionId).toBe('TypeTextMatchCut');
    expect(hit?.props).toMatchObject({keyword: 'intelligence', variant: 'memo'});
    expect(resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'overlay', content})).toBeNull();
  });
});

describe('selection by meaning', () => {
  it('a concept being named -> match cut on the word after the cue, with spoken context around it', () => {
    const c = kineticCandidatesOf(sentence(NAMING), ctx(), only).candidates.find(x => x.templateId === ID)!;
    expect(c.hint.keyword).toBe('intelligence');
    expect(c.hint.before).toBe('So what is');
    expect(String(c.hint.after)).toContain('really');
    expect(['memo', 'editorial', 'newsprint']).toContain(c.hint.variant);
    expect(c.shown).toBe('intelligence');
  });

  it('a from-X-to-Y contrast -> keyword swap (both words spoken)', () => {
    const c = kineticCandidatesOf(sentence(SWAP), ctx(), only).candidates.find(x => x.templateId === ID)!;
    expect(c.hint).toMatchObject({keyword: 'chaos', swapKeyword: 'clarity'});
  });

  it('no naming cue / digits / short sentence -> nothing (never decoration)', () => {
    expect(kineticCandidatesOf(sentence('We shot the whole thing in a garage last summer'), ctx(), only).candidates).toHaveLength(0);
    expect(kineticCandidatesOf(sentence('So what is intelligence for 10 minutes straight honestly'), ctx(), only).candidates).toHaveLength(0);
    expect(kineticCandidatesOf(sentence('what is love'), ctx(), only).candidates).toHaveLength(0);
  });

  it('a Director-chosen word is accepted when it is really spoken, rejected when it is not', () => {
    const words = speech([[NAMING, 10]]);
    const ok = kineticCandidateFromDirector({template: 'type_text_match_cut', text: 'intelligence', start: 10.6, end: 11.5}, words, ctx(), only);
    expect(ok.candidate?.hint.keyword).toBe('intelligence');
    expect(kineticCandidateFromDirector({template: 'type_text_match_cut', text: 'wisdom', start: 10.6, end: 11.5}, words, ctx(), only).rejected).toBe('phrase_not_in_transcript_window');
  });
});

describe('grounding', () => {
  const words = speech([[NAMING, 10]]);
  const base = {templateId: ID as const, words, beatStart: 10.3, beatEnd: 12};
  const hint = {keyword: 'intelligence', phrase: 'So what is intelligence really and why', before: 'So what is', after: 'really and why', variant: 'editorial'};

  it('binds spoken copy and does not merge the edit palette (the match cut carries its own highlight colour)', () => {
    const out = bindMotionTemplateContent({...base, hint, accent: '#3D4A5C', ground: '#F7F6F2'})!;
    expect(out).toMatchObject({keyword: 'intelligence', variant: 'editorial', personalized: true});
    expect(out.accent).toBeUndefined();
  });

  it('refuses an invented keyword, invented context, an over-long keyword or a too-short phrase', () => {
    expect(bindMotionTemplateContent({...base, hint: {...hint, keyword: 'wisdom'}})).toBeNull();
    expect(bindMotionTemplateContent({...base, hint: {...hint, phrase: 'So what is intelligence really and why not'}})).toBeNull();
    expect(bindMotionTemplateContent({...base, hint: {...hint, keyword: 'intelligence really and'}})).toBeNull();
    expect(bindMotionTemplateContent({...base, hint: {...hint, phrase: 'what is intelligence'}})).toBeNull();
    expect(bindMotionTemplateContent({...base, hint: {...hint, swapKeyword: 'wisdom'}})).toBeNull();
  });
});

describe('planning (incl. Kinetic-Led)', () => {
  const transcript = (n: number) => speech(Array.from({length: n}, (_, i) => [NAMING, 5 + i * 11] as [string, number]));

  it('plans a match cut that owns the frame, with the grounded hint', () => {
    const plan = planCraftTemplateBeats({skill: 'default', durationSec: 40, words: speech([[NAMING, 14]]), kineticOnly: [ID]});
    const beat = plan.beats.find(b => b.templateId === ID)!;
    expect(beat).toBeTruthy();
    expect(beat.muteCaptions).toBe(true);
    expect(beat.end - beat.start).toBeGreaterThanOrEqual(1.4);
    expect(beat.end - beat.start).toBeLessThanOrEqual(2.01);
    expect(beat.hint?.keyword).toBe('intelligence');
  });

  it('Kinetic-Led keeps it an event: at most one per 20 s, with the led style hint still on the beat', () => {
    const plan = planCraftTemplateBeats({skill: 'default', durationSec: 40, words: transcript(3), kineticOnly: [ID], kineticLed: true});
    const cuts = plan.beats.filter(b => b.templateId === ID);
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    expect(cuts.length).toBeLessThanOrEqual(2);
    expect(plan.beats.length).toBeLessThanOrEqual(kineticLedBeatBudget(40));
    expect(cuts[0]!.hint).toMatchObject({accent: '#3D4A5C'});
  });

  it('the competing-family rule treats it as its own family', () => {
    expect(kineticMotionFamily(ID)).not.toBe(kineticMotionFamily('clip_47_type_staggered_phrase'));
  });
});

describe('scene planner = the style bible', () => {
  const variants: MatchCutVariant[] = ['memo', 'editorial', 'newsprint'];
  const FPS = 30;

  it.each(variants)('%s: hard cuts on whole frames at the preset length, no adjacent repeated layout, keyword centre pinned to the anchor', variant => {
    const spec = MATCH_CUT_SPECS[variant];
    const scenes = planMatchCutScenes({variant, durSec: 1.8, fps: FPS, keyword: 'intelligence'});
    const per = sceneFrames(variant, FPS);
    expect(Math.abs(per / FPS - spec.sceneSec)).toBeLessThanOrEqual(1 / FPS);
    scenes.forEach((s, i) => {
      expect(Math.round(s.startSec * FPS)).toBe(i * per);
      expect(Math.abs(s.anchor.x - spec.anchor.x)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(s.anchor.y - spec.anchor.y)).toBeLessThanOrEqual(0.08);
      if (i > 0) expect(s.layoutId).not.toBe(scenes[i - 1]!.layoutId);
      expect(s.keyword).toBe('intelligence');
    });
    expect(scenes.length).toBeGreaterThanOrEqual(4);
  });

  it('a keyword swap repeats the layout family exactly once, at the swap point (T1 grammar)', () => {
    const scenes = planMatchCutScenes({variant: 'memo', durSec: 1.8, fps: FPS, keyword: 'chaos', swap: 'clarity'});
    const repeats = scenes.filter((s, i) => i > 0 && s.layoutId === scenes[i - 1]!.layoutId);
    expect(repeats).toHaveLength(1);
    expect(scenes.map(s => s.keyword)).toContain('clarity');
    expect(scenes[0]!.keyword).toBe('chaos');
  });

  it('T2 pushes in linearly 1.00 -> 1.14 and resets at each cut; T1 / T3 are static', () => {
    expect(pushInScale('editorial', 0)).toBe(1);
    expect(pushInScale('editorial', 1)).toBeCloseTo(1.14, 5);
    expect(pushInScale('editorial', 0.5)).toBeCloseTo(1.07, 5);
    expect(pushInScale('memo', 0.7)).toBe(1);
    expect(pushInScale('newsprint', 0.7)).toBe(1);
    const scenes = planMatchCutScenes({variant: 'editorial', durSec: 1.4, fps: FPS, keyword: 'intelligence'});
    const per = sceneFrames('editorial', FPS);
    expect(per).toBe(6);
    expect(sceneAt(scenes, 'editorial', FPS, per).progress).toBe(0);
  });

  it('T3 retints the whole frame on every cut and drifts the anchor up in the last scenes', () => {
    const scenes = planMatchCutScenes({variant: 'newsprint', durSec: 1.3, fps: FPS, keyword: 'intelligence'});
    expect(new Set(scenes.map(s => s.bg)).size).toBeGreaterThanOrEqual(4);
    expect(scenes[scenes.length - 1]!.anchor.y).toBeLessThan(scenes[0]!.anchor.y);
  });

  it('the comp keeps square highlight corners and the preset colours', () => {
    const src = readFileSync(join(repo, 'remotion/src/motion/compositions/templates/TextMatchCut.tsx'), 'utf8');
    expect(src).toContain('borderRadius: 0');
    expect(MATCH_CUT_SPECS.memo.keyword.bg).toBe('#EFDE28');
    expect(MATCH_CUT_SPECS.editorial.keyword.bg).toBe('#F1F858');
    expect(MATCH_CUT_SPECS.newsprint.keyword.bg).toBe('#F58515');
  });
});

function read(...parts: string[]) {
  return readFileSync(join(repo, ...parts), 'utf8');
}
