/**
 * WP14B: beat intent -> motion recipe on the seeds, forwarded to the hosts, and Claude constrained to the recipe vocabulary. Offline: no render, no model, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {MOTION_RECIPE_IDS as RENDERER_IDS} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {COMPOSITION_INTENT, MOTION_RECIPE_IDS, recipeForComposition, recipeForIntent} from '../../lib/motionRecipes.ts';
import {buildGenerationPrompt, buildSystemPrompt, motionRecipeRules} from '../../motionWorker/prompt.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from '../motionDirector/libraryFallback.ts';
import {libraryGraphicSource, REGISTRY_RECIPE_IDS, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps} from './explainPlateGaps.ts';
import {isGroundedInTranscript} from './groundedText.ts';
import {generatedGraphicIsGrounded} from './legibility.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const timed = (sentences: string[], perWord = 0.3, gap = 4.5) => {
  let t = 0;
  return sentences.flatMap(sentence =>
    sentence.split(' ').map((text, i, all) => {
      const start = Math.round(t * 1000) / 1000;
      t += perWord;
      if (i === all.length - 1) t += gap;
      return {text, start, end: Math.round((start + perWord * 0.9) * 1000) / 1000};
    }),
  );
};
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'v', placement, content});
const OPENER = 'Today and I have a choice between two options that matter for the company I am building right now';
const JENSEN = [
  OPENER,
  'Roughly 85 percent of projects slip without a clear owner.',
  'Number two market size matters more than anything else.',
  'The headline reported that the startup raised a huge round and investors are piling in at a valuation nobody expected.',
  'Someone tweeted that nobody reads the documentation anymore.',
  'Then keep the standard high and ship it anyway today.',
];
const WORDS = timed(JENSEN, 0.3, 4.5);
const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: 80, lookId: remapped.id, explainPlates: true});
const contentOf = (composition: string) => {
  const graphic = seed.raw.graphics.find(item => seed.compositions[item.id] === composition);
  return graphic ? (JSON.parse(graphic.contentJson) as Record<string, unknown>) : undefined;
};

describe('WP14B 1) intent -> recipe on the seeds', () => {
  it('the composition -> intent -> recipe map is stable and only names real recipes; TopicPills has none (its chips run Badge springs, not glyph recipes)', () => {
    expect(recipeForComposition('OpenPlate')).toBe('elastic_type_snap');
    expect(recipeForComposition('WikiCallout')).toBe('split_mask_reveal');
    expect(recipeForComposition('NewspaperCallout')).toBe('split_mask_reveal');
    expect(recipeForComposition('TweetCard')).toBe('split_mask_reveal');
    expect(recipeForComposition('StampTitle')).toBe(recipeForIntent('punchline'));
    expect(recipeForComposition('FullscreenStatement')).toBe(recipeForIntent('pivot'));
    expect(recipeForComposition('StatHighlight')).toBe('counter_snap');
    expect(recipeForComposition('TopicPills')).toBeUndefined();
    expect(recipeForComposition('QuoteCallout')).toBeUndefined();
    for (const composition of Object.keys(COMPOSITION_INTENT)) expect(MOTION_RECIPE_IDS).toContain(recipeForComposition(composition));
  });
  it('seeded plates on the explain path carry recipeId from the beat intent: OpenPlate hook, evidence plates evidence, StampTitle punchline, StatHighlight stat', () => {
    const open = contentOf('OpenPlate');
    expect(open?.recipeId).toBe('elastic_type_snap');
    const evidence = ['WikiCallout', 'NewspaperCallout', 'TweetCard'].map(contentOf).filter(Boolean);
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    for (const content of evidence) expect(content!.recipeId).toBe('split_mask_reveal');
    for (const composition of ['StampTitle', 'StatHighlight', 'FullscreenStatement']) {
      const content = contentOf(composition);
      if (content) expect(content.recipeId, composition).toBe(recipeForComposition(composition));
    }
    for (const graphic of seed.raw.graphics) {
      const composition = seed.compositions[graphic.id]!;
      const content = JSON.parse(graphic.contentJson) as Record<string, unknown>;
      if (recipeForComposition(composition)) expect(content.recipeId, composition).toBe(recipeForComposition(composition));
      else expect(content.recipeId, composition).toBeUndefined();
    }
  });
  it('the standard (non-explain) seed path is unchanged: no recipeId', () => {
    const standard = seedLibraryGraphics({words: WORDS, outputDurationSec: 80, lookId: remapped.id});
    for (const graphic of standard.raw.graphics) expect((JSON.parse(graphic.contentJson) as Record<string, unknown>).recipeId).toBeUndefined();
  });
  it('the registry forwards a registered recipeId into the host props for every recipe host, and drops an unknown one (the host default runs)', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['OpenPlate', {openTitle: 'Market size matters', accent: 'matters'}],
      ['StampTitle', {stamp: '02 —', title: 'Market size matters'}],
      ['WikiCallout', {passage: 'The standard is reviewed every single quarter'}],
      ['NewspaperCallout', {passage: 'The startup raised a huge round', newspaper: true}],
      ['TweetCard', {body: 'Nobody reads the documentation anymore'}],
      ['FullscreenStatement', {statement: 'Keep the standard high'}],
      ['StatHighlight', {value: {to: 85, suffix: '%'}, label: 'of projects slip'}],
    ];
    for (const [id, content] of cases) {
      const hit = resolveLibraryGraphic(brief({...content, recipeId: 'smear_blur_in'}))!;
      expect(hit.compositionId, id).toBe(id);
      expect(hit.props.recipeId, id).toBe('smear_blur_in');
      expect(resolveLibraryGraphic(brief({...content, recipeId: 'fade_card_ui'}))!.props.recipeId, id).toBeUndefined();
      expect(resolveLibraryGraphic(brief(content))!.props.recipeId, id).toBeUndefined();
    }
  });
  it('the registry copy of the recipe ids equals the server list and the renderer registry', () => {
    expect([...REGISTRY_RECIPE_IDS]).toEqual([...MOTION_RECIPE_IDS]);
    expect([...REGISTRY_RECIPE_IDS]).toEqual([...RENDERER_IDS]);
  });
  it('recipeId is a key, not copy: grounding (legibility), the baked-text check and the caption mute ignore it', () => {
    expect(generatedGraphicIsGrounded({props: {content: {passage: 'the standard is reviewed', recipeId: 'split_mask_reveal'}}}, 'the standard is reviewed')).toBe(true);
    const seeded = seed.raw.graphics.map(graphic => JSON.parse(graphic.contentJson) as Record<string, unknown>);
    const transcript = WORDS.map(word => word.text).join(' ');
    for (const content of seeded) expect(generatedGraphicIsGrounded({props: {content}}, transcript)).toBe(true);
    for (const file of ['stages/broll/legibility.ts', 'stages/broll/bakedGraphicText.ts', 'lib/captionMute.ts', 'eval/rubricScorer.ts']) expect(read(`../../${file}`), file).toContain("key !== 'recipeId'");
  });
  it('the stage reports motion_recipes:used:<n> for the seeds that carry a recipe', () => {
    const result = addLibrarySeeds(emptyDirector, {words: WORDS, outputDurationSec: 80, occupied: [], captionBand: undefined as never, lookId: remapped.id, explainPlates: true});
    const used = result.warnings.find(warning => warning.startsWith('motion_recipes:used:'));
    expect(used).toBeDefined();
    expect(Number(used!.split(':')[2])).toBe(result.director.graphics.filter(graphic => typeof graphic.brief.content.recipeId === 'string').length);
    expect(Number(used!.split(':')[2])).toBeGreaterThanOrEqual(1);
  });
  it('a seeded plate with its recipe still passes worker validation as a library module', async () => {
    const open = seed.raw.graphics.find(graphic => seed.compositions[graphic.id] === 'OpenPlate')!;
    const hit = resolveLibraryGraphic({goal: open.goal, visualDescription: open.visualDescription, placement: open.placement, content: JSON.parse(open.contentJson)})!;
    expect(hit.props.recipeId).toBe('elastic_type_snap');
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
  it('the hosts accept recipeId (StatHighlight too) and default to the same recipe the seed would choose', () => {
    const stat = read('../../../../remotion/src/motion/compositions/StatHighlight.tsx');
    expect(stat).toContain('recipeId?: MotionRecipeId');
    expect(stat).toContain("recipeId = 'counter_snap'");
    expect(stat).toContain('<MotionRecipe recipeId={recipeId}>');
  });
});

describe('WP14B 2) Claude is constrained to the recipe vocabulary', () => {
  const system = buildSystemPrompt();
  it('the system prompt names <MotionRecipe>, lists every recipe id with its family and intents, and forbids fade + slide card UI and invented browser / tab / notification chrome', () => {
    expect(system).toContain('MotionRecipe');
    for (const id of MOTION_RECIPE_IDS) expect(system, id).toContain(id);
    expect(system).toContain('MOTION_RECIPE_IDS');
    expect(system).toMatch(/video edit, not a website/);
    expect(system).toMatch(/fade \+ slide-up card UI/);
    expect(system).toMatch(/Never invent browser chrome, address bars, tab strips, notification banners/);
    expect(system).toContain('elastic_type_snap (type_physics; intents: hook, punchline)');
  });
  it('source pin: the prompt module carries the rule and imports the id list from the server mirror', () => {
    const source = read('../../motionWorker/prompt.ts');
    expect(source).toContain('MotionRecipe');
    expect(source).toContain("from '../lib/motionRecipes.ts'");
    expect(MOTION_RECIPE_IDS.filter(id => source.includes(id) || source.includes('MOTION_RECIPE_IDS')).length).toBeGreaterThanOrEqual(3);
    expect(motionRecipeRules().length).toBeGreaterThanOrEqual(MOTION_RECIPE_IDS.length + 3);
  });
  it('the system prompt is request-independent (cached prefix): the same text twice', () => {
    expect(buildSystemPrompt()).toBe(system);
  });
  it('a brief whose content carries a recipeId gets the director\'s choice in the user turn; a brief without one does not', () => {
    const base = {id: 'g1', anchorWordIndex: 0, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen' as const, kind: 'card', assets: [], constraints: []};
    const canvas = {width: 1080, height: 1920, fps: 30};
    const withRecipe = buildGenerationPrompt({...base, content: {headline: 'Hire the expert', recipeId: 'split_mask_reveal'}} as never, canvas);
    expect(withRecipe).toContain("Director's motion recipe for this beat: split_mask_reveal");
    expect(withRecipe).toContain('<MotionRecipe recipeId="split_mask_reveal">');
    expect(buildGenerationPrompt({...base, content: {headline: 'Hire the expert'}} as never, canvas)).not.toContain("Director's motion recipe");
  });
});

describe('WP14B 3) Claude plate briefs carry a suggested recipe', () => {
  it('gap briefs whose shape has a recipe host get recipeId from the intent (evidence -> split_mask_reveal ...), spoken words untouched; a headline brief gets none', () => {
    const gaps = detectExplainPlateGaps({durationSec: 80, words: WORDS, coverStarts: []});
    const briefs = buildClaudePlateBriefs(gaps, WORDS, 4);
    expect(briefs.length).toBeGreaterThanOrEqual(1);
    const transcript = WORDS.map(word => word.text).join(' ');
    let withRecipe = 0;
    for (const item of briefs) {
      const content = JSON.parse(item.contentJson) as Record<string, unknown>;
      if (content.recipeId !== undefined) {
        withRecipe += 1;
        expect(MOTION_RECIPE_IDS).toContain(content.recipeId);
      } else {
        expect(typeof content.headline).toBe('string'); // the headline fallback has no recipe host
      }
      for (const [key, value] of Object.entries(content)) if (key !== 'recipeId' && typeof value === 'string') expect(isGroundedInTranscript(value, transcript) || /^0\d —$/.test(value), `${key}: ${value}`).toBe(true);
      const hit = resolveLibraryGraphic({goal: item.goal, visualDescription: item.visualDescription, placement: item.placement, content});
      if (hit && content.recipeId) expect(hit.props.recipeId).toBe(content.recipeId);
    }
    expect(withRecipe).toBeGreaterThanOrEqual(1);
  });
});
