/**
 * WP19: object / media recipes (the image_story family) and their media hosts. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {CONTINUOUS_RECIPE_IDS, MOTION_RECIPE_IDS as RENDERER_IDS, MOTION_RECIPES, recipeSfxPeaks as rendererSfx, recipeState} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {CARD_TILT_HOSTS, MOTION_RECIPE_IDS, MOTION_RECIPE_INFO, recipeForComposition, recipeSfxPeaks} from '../../lib/motionRecipes.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import type {LabeledAssetBrief, LabeledAssetSlot} from './labeledAssetBrief.ts';
import {planLabeledAssetPlacements, RECIPE_BY_KIND, type ResolvedLabeledAsset} from './labeledAssetPlacement.ts';
import {preferMediaWarnings, textOnlyOpensWithMediaAvailable} from './preferMedia.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NEW = ['logo_slam', 'sticker_pop', 'still_push_in', 'card_tilt_in', 'orbit_drift'] as const;
const FPS = 30;
const D = 90;

describe('WP19 1) registry parity', () => {
  it('the five image_story recipes exist in the renderer and the server, same family, same intents', () => {
    for (const id of NEW) {
      expect(RENDERER_IDS).toContain(id);
      expect(MOTION_RECIPE_IDS).toContain(id);
      const renderer = MOTION_RECIPES.find(recipe => recipe.id === id)!;
      expect(renderer.family).toBe('image_story');
      expect(MOTION_RECIPE_INFO[id].family).toBe('image_story');
      expect([...MOTION_RECIPE_INFO[id].intents]).toEqual([...renderer.intents]);
    }
    expect([...MOTION_RECIPE_IDS]).toEqual([...RENDERER_IDS]);
  });
  it('SFX peaks: logo_slam hit, sticker_pop pop, push / tilt whoosh, orbit soft whoosh; renderer = server', () => {
    const kind = (id: (typeof NEW)[number]) => recipeSfxPeaks(id, D, FPS)[0]!.kind;
    expect(kind('logo_slam')).toBe('hit');
    expect(kind('sticker_pop')).toBe('pop');
    expect(kind('still_push_in')).toBe('whoosh');
    expect(kind('card_tilt_in')).toBe('whoosh');
    expect(kind('orbit_drift')).toBe('whoosh');
    for (const id of NEW) expect(rendererSfx(id, D, FPS)).toEqual(recipeSfxPeaks(id, D, FPS));
  });
  it('the catalog, README and CATALOG name every new recipe', () => {
    const readme = read('../../../../remotion/src/motion/README.md');
    const catalog = read('../../../../remotion/src/motion/recipes/CATALOG.md');
    for (const id of NEW) {
      expect(readme).toContain(`\`${id}\``);
      expect(catalog).toContain(`\`${id}\``);
    }
  });
  it('intent pools keep their old heads (new recipes lead only the media intent)', () => {
    expect(MOTION_RECIPE_INFO.logo_slam.intents[0]).toBe('media');
    expect(recipeForComposition('NewspaperCallout', 0)).toBe('split_mask_reveal');
  });
});

describe('WP19 2) frame math', () => {
  const at = (id: (typeof NEW)[number], frame: number, duration = D) => recipeState(id, frame, FPS, duration);
  it.each(NEW.map(id => [id] as const))('%s moves between frame 0 and frame ~8', id => {
    const a = at(id, 0);
    const b = at(id, 8);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it('logo_slam starts small, overshoots past 1 and settles on identity', () => {
    const scales = Array.from({length: 30}, (_, frame) => at('logo_slam', frame).scaleX);
    expect(scales[0]).toBeLessThan(0.3);
    expect(Math.max(...scales)).toBeGreaterThan(1.1);
    expect(at('logo_slam', D).scaleX).toBe(1);
    expect(at('logo_slam', 0).rotateDeg).not.toBe(0);
  });
  it('sticker_pop overshoots and wiggles, then ends still', () => {
    const states = Array.from({length: 30}, (_, frame) => at('sticker_pop', frame));
    expect(Math.max(...states.map(s => s.scaleX))).toBeGreaterThan(1.02);
    expect(states.some(s => s.rotateDeg !== 0)).toBe(true);
    expect(at('sticker_pop', D).rotateDeg).toBe(0);
  });
  it('still_push_in pushes slowly: still above 1 past the entrance, back to 1 by the end, blur clears early', () => {
    expect(at('still_push_in', 0).scaleX).toBeGreaterThan(1.1);
    expect(at('still_push_in', 20).scaleX).toBeGreaterThan(1.01);
    expect(at('still_push_in', D).scaleX).toBe(1);
    expect(at('still_push_in', 0).blurPx).toBeGreaterThan(0);
    expect(at('still_push_in', 24).blurPx).toBe(0);
  });
  it('card_tilt_in has a real perspective rotation early and none at the end', () => {
    const first = at('card_tilt_in', 0);
    expect(Math.abs(first.rotateYDeg)).toBeGreaterThanOrEqual(12);
    expect(Math.abs(first.rotateXDeg)).toBeGreaterThan(0);
    expect(Math.abs(at('card_tilt_in', 5).rotateYDeg)).toBeGreaterThan(0);
    const end = at('card_tilt_in', D);
    expect(end.rotateYDeg).toBe(0);
    expect(end.rotateXDeg).toBe(0);
    expect(end.scaleX).toBe(1);
  });
  it('orbit_drift is continuous: it still moves late in the hold and stays within a few px', () => {
    expect(CONTINUOUS_RECIPE_IDS).toContain('orbit_drift');
    const late = [60, 70, 80].map(frame => at('orbit_drift', frame).translateX);
    expect(new Set(late).size).toBeGreaterThan(1);
    for (const x of late) expect(Math.abs(x)).toBeLessThanOrEqual(8);
  });
  it('every other recipe still ends on identity (rotateX / rotateY included)', () => {
    for (const id of MOTION_RECIPES.map(recipe => recipe.id).filter(id => !CONTINUOUS_RECIPE_IDS.includes(id))) {
      const end = recipeState(id, D, FPS, D);
      expect(end.rotateXDeg, id).toBe(0);
      expect(end.rotateYDeg, id).toBe(0);
    }
  });
});

const slot = (id: string, kind: LabeledAssetSlot['kind'], startSec: number, endSec: number, userAssetId: string): LabeledAssetSlot => ({
  id, label: `${kind} ${id}`, kind, reason: '', startSec, endSec, accept: ['image'], spokenHint: '', status: 'uploaded', userAssetId,
});
const assets = new Map<string, ResolvedLabeledAsset>(['ub_1', 'ub_2', 'ub_3', 'ub_4'].map((id, i) => [id, {url: `https://cdn.example.com/${i}.png`, mediaKind: 'image' as const}]));
const plan = (slots: LabeledAssetSlot[]) => planLabeledAssetPlacements({brief: {version: 1, outputDurationSec: 60, slots} as LabeledAssetBrief, assets, outputDurationSec: 60});

describe('WP19 3) media hosts', () => {
  it('labeled overlays carry the kind recipe: logo = logo_slam, person = still_push_in, screenshot = card_tilt_in', () => {
    const out = plan([slot('a', 'logo', 5, 8, 'ub_1'), slot('b', 'person', 20, 23, 'ub_2'), slot('c', 'screenshot', 35, 39, 'ub_3')]);
    expect(out.overlays.map(o => o.recipeId)).toEqual(['logo_slam', 'still_push_in', 'card_tilt_in']);
    expect(RECIPE_BY_KIND.logo).toBe('logo_slam');
  });
  it('ImageRun items carry per-item recipes; a logo_cloud only names the hero', () => {
    const seq = plan([slot('a', 'logo', 5, 7, 'ub_1'), slot('b', 'person', 8, 10, 'ub_2')]);
    expect(seq.runs[0]!.items.map(i => i.recipeId)).toEqual(['logo_slam', 'still_push_in']);
    const cloud = plan([slot('a', 'logo', 5, 7, 'ub_1'), slot('b', 'logo', 7.5, 9.5, 'ub_4')]);
    expect(cloud.runs[0]!.mode).toBe('logo_cloud');
    expect(cloud.runs[0]!.items.map(i => i.recipeId)).toEqual(['logo_slam', undefined]);
  });
  it('the registry forwards valid item recipes, drops unknown ones, and the module passes worker validation', async () => {
    const hit = resolveLibraryGraphic({goal: 'x', visualDescription: 'y', placement: 'full_screen', content: {imageRun: [{src: 'https://cdn.example.com/a.png', recipeId: 'logo_slam'}, {src: 'https://cdn.example.com/b.png', recipeId: 'made_up'}]}})!;
    expect(hit.props.items).toEqual([{asset: 'run_0', recipeId: 'logo_slam'}, {asset: 'run_1'}]);
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
  it('ImageRun source: per-item recipe, mode-aware defaults (logo_slam hero, orbit_drift / sticker_pop cloud, sequence rotation)', () => {
    const comp = strip(read('../../../../remotion/src/motion/compositions/ImageRun.tsx'));
    expect(comp).toMatch(/recipeId\?: MotionRecipeId/);
    expect(comp).toMatch(/IMAGE_RUN_SEQUENCE_RECIPES[^;]*'logo_slam', 'still_push_in', 'nested_scale_in'/);
    expect(comp).toMatch(/IMAGE_RUN_CLOUD_HERO_RECIPE: MotionRecipeId = 'logo_slam'/);
    expect(comp).toMatch(/'orbit_drift', 'sticker_pop'/);
    expect(comp).not.toMatch(/recipeId = 'nested_scale_in'/);
  });
  it('the media card host runs the recipe (MediaCardTrack) and the schema keeps recipeId', () => {
    const card = strip(read('../../../../remotion/src/components/MediaCardTrack.tsx'));
    expect(card).toMatch(/getRecipe\(overlay\.recipeId\)/);
    expect(card).toMatch(/perspective\(900px\)/);
    expect(read('../../../../remotion/src/blueprintSchema.ts')).toMatch(/recipeId: z\.string\(\)\.optional\(\)/);
  });
  it('KLIPY overlays default to sticker_pop', () => {
    expect(strip(read('./klipyOverlayPlanner.ts'))).toMatch(/recipeId: 'sticker_pop'/);
  });
  it('perspective-tilt evidence cards: Newspaper / Wiki / Tweet take card_tilt_in on odd variants; other hosts do not', () => {
    for (const host of CARD_TILT_HOSTS) {
      expect(recipeForComposition(host, 1)).toBe('card_tilt_in');
      expect(recipeForComposition(host, 0)).not.toBe('card_tilt_in');
    }
    expect(recipeForComposition('OpenPlate', 1)).not.toBe('card_tilt_in');
  });
  it('MotionRecipe applies perspective only for tilting recipes', () => {
    expect(strip(read('../../../../remotion/src/motion/recipes/MotionRecipe.tsx'))).toMatch(/state\.rotateXDeg !== 0 \|\| state\.rotateYDeg !== 0/);
  });
});

describe('WP19 4) prefer media over a text-only open', () => {
  const open = {start: 1, end: 4, mode: 'full_screen', compositionId: 'OpenPlate'};
  const beat = {start: 3, end: 6};
  it('a text-plate open with a media beat available and nothing under it is flagged', () => {
    const windows = textOnlyOpensWithMediaAvailable({graphics: [open], mediaBeats: [beat], mediaUnder: []});
    expect(windows).toEqual([{start: 1, end: 4}]);
    expect(preferMediaWarnings(windows)).toEqual(['polish_aesthetic:prefer_media:1.0-4.0']);
  });
  it('no media available, media already under the open, a late plate, or a non-text plate are not flagged', () => {
    expect(textOnlyOpensWithMediaAvailable({graphics: [open], mediaBeats: [], mediaUnder: []})).toEqual([]);
    expect(textOnlyOpensWithMediaAvailable({graphics: [open], mediaBeats: [beat], mediaUnder: [{start: 0, end: 5}]})).toEqual([]);
    expect(textOnlyOpensWithMediaAvailable({graphics: [{...open, start: 20, end: 23}], mediaBeats: [beat], mediaUnder: []})).toEqual([]);
    expect(textOnlyOpensWithMediaAvailable({graphics: [{...open, compositionId: 'ImageRun'}], mediaBeats: [beat], mediaUnder: []})).toEqual([]);
  });
  it('analyze records the soft warning after the media is placed and before the density block', () => {
    const analyze = strip(read('../../pipeline/analyzeVideo.ts'));
    const hook = analyze.indexOf('textOnlyOpensWithMediaAvailable(');
    expect(hook).toBeGreaterThan(analyze.indexOf('publishImageRuns('));
    expect(hook).toBeLessThan(analyze.indexOf('ensurePolishTransitionDensity('));
    expect(analyze).toMatch(/preferMediaWarnings\(windows\)/);
  });
});
