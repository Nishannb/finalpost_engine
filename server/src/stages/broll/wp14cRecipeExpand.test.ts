/**
 * WP14C: four more video-vernacular recipes (glitch, pixel dissolve, gooey pop, blur spin), the intent priority / variety pool, and their executor. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {
  IDENTITY,
  MOTION_INTENTS as RENDERER_INTENTS,
  MOTION_RECIPES,
  MOTION_RECIPE_IDS as RENDERER_IDS,
  entranceFrames,
  recipeForIntent as rendererForIntent,
  recipeForIntentVaried as rendererVaried,
  recipeState,
  recipesForIntent as rendererPool,
} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {MOTION_INTENTS, MOTION_RECIPE_IDS, MOTION_RECIPE_INFO, recipeForComposition, recipeForIntent, recipeForIntentVaried, recipesForIntent} from '../../lib/motionRecipes.ts';
import {buildSystemPrompt} from '../../motionWorker/prompt.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {REGISTRY_RECIPE_IDS, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps} from './explainPlateGaps.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const motion = (file: string) => read(`../../../../remotion/src/motion/${file}`);
const FPS = 30;
const NEW_IDS = ['glitch_text_reveal', 'pixel_dissolve_in', 'gooey_accent_pop', 'blur_spin_settle'] as const;

describe('WP14C 1) registry and parity', () => {
  it('12+ unique recipes; the four new ones are registered with the requested families and intents; transform-driven (they wrap any layer)', () => {
    expect(RENDERER_IDS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(RENDERER_IDS).size).toBe(RENDERER_IDS.length);
    const byId = Object.fromEntries(MOTION_RECIPES.map(recipe => [recipe.id, recipe]));
    expect(byId.glitch_text_reveal).toMatchObject({family: 'type_physics', intents: ['pivot', 'punchline'], driver: 'transform'});
    expect(byId.pixel_dissolve_in).toMatchObject({family: 'reveal_mask', intents: ['evidence', 'payoff'], driver: 'transform'});
    expect(byId.gooey_accent_pop).toMatchObject({family: 'type_physics', intents: ['punchline', 'stat'], driver: 'transform'});
    expect(byId.blur_spin_settle).toMatchObject({family: 'type_physics', intents: ['hook', 'pivot'], driver: 'transform'});
  });
  it('renderer, server mirror and registry copy are the same list, with the same families and intents', () => {
    expect([...MOTION_RECIPE_IDS]).toEqual([...RENDERER_IDS]);
    expect([...REGISTRY_RECIPE_IDS]).toEqual([...RENDERER_IDS]);
    expect([...MOTION_INTENTS]).toEqual([...RENDERER_INTENTS]);
    for (const recipe of MOTION_RECIPES) {
      expect(MOTION_RECIPE_INFO[recipe.id].family, recipe.id).toBe(recipe.family);
      expect([...MOTION_RECIPE_INFO[recipe.id].intents], recipe.id).toEqual([...recipe.intents]);
    }
  });
  it('documented in the README, listed in the Claude system prompt with family and intents, and forwarded by the registry to a host', () => {
    const readme = motion('README.md');
    for (const id of NEW_IDS) {
      expect(readme, id).toContain(`\`${id}\``);
      expect(buildSystemPrompt(), id).toContain(id);
      const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {openTitle: 'Market size matters', recipeId: id}})!;
      expect(hit.props.recipeId, id).toBe(id);
    }
    expect(buildSystemPrompt()).toContain('glitch_text_reveal (type_physics; intents: pivot, punchline)');
    expect(readme).toContain('Intent priority and variety (WP14C)');
  });
});

describe('WP14C 2) frame math', () => {
  const identity = (state: ReturnType<typeof recipeState>) => state.opacity === 1 && state.scaleX === 1 && state.scaleY === 1 && state.blurPx === 0 && state.translateX === 0 && state.translateY === 0 && state.innerScale === 1 && state.rotateDeg === 0 && state.rgbSplitPx === 0 && state.clipPath === undefined && state.maskCellPx === undefined;
  const numeric = (state: ReturnType<typeof recipeState>) => [state.opacity, state.translateX, state.translateY, state.scaleX, state.scaleY, state.blurPx, state.rotateDeg, state.rgbSplitPx, state.maskCellPx ?? 0];
  it.each(NEW_IDS.map(id => [id] as const))('%s: already moving at frame 0, changing by frame 10, settled by 75 %% of the graphic and exactly on identity at the end, for 54 / 90 / 126 frames', id => {
    for (const duration of [54, 90, 126]) {
      const first = recipeState(id, 0, FPS, duration);
      expect(identity(first), `${id} f0 @${duration}`).toBe(false);
      expect(numeric(recipeState(id, 10, FPS, duration)), `${id} 0->10 @${duration}`).not.toEqual(numeric(first));
      expect(identity(recipeState(id, Math.round(duration * 0.75), FPS, duration)), `${id} 75% @${duration}`).toBe(true);
      expect(identity(recipeState(id, duration, FPS, duration)), `${id} end @${duration}`).toBe(true);
      expect(entranceFrames(duration)).toBeLessThanOrEqual(Math.max(8, Math.round(duration * 0.4)));
    }
  });
  it('glitch_text_reveal: hashed jitter that changes every 2 frames and shrinks, an RGB split that closes, deterministic', () => {
    const xs = Array.from({length: 12}, (_, frame) => recipeState('glitch_text_reveal', frame, FPS, 90));
    expect(recipeState('glitch_text_reveal', 0, FPS, 90)).toEqual(xs[0]);
    expect(xs[0]!.rgbSplitPx).toBeGreaterThan(3);
    expect(xs[1]!.translateX).toBe(xs[0]!.translateX); // steps of 2 frames
    expect(new Set(xs.map(state => state.translateX)).size).toBeGreaterThanOrEqual(3); // it jitters
    expect(Math.max(...xs.slice(8).map(state => Math.abs(state.translateX)))).toBeLessThan(Math.max(...xs.slice(0, 4).map(state => Math.abs(state.translateX))) + 0.001);
    expect(xs.slice(-2).every(state => state.rgbSplitPx < xs[0]!.rgbSplitPx)).toBe(true);
  });
  it('pixel_dissolve_in: a coarse checker that refines and stepped opacity (four levels), then no mask at all', () => {
    const states = Array.from({length: entranceFrames(90) + 1}, (_, frame) => recipeState('pixel_dissolve_in', frame, FPS, 90));
    expect(states[0]!.maskCellPx).toBeGreaterThan(80);
    const cells = states.filter(state => state.maskCellPx !== undefined).map(state => state.maskCellPx!);
    expect(cells).toEqual([...cells].sort((a, b) => b - a)); // cells only shrink
    expect(cells[cells.length - 1]!).toBeLessThan(20);
    expect(new Set(states.map(state => state.opacity))).toEqual(new Set([0.25, 0.5, 0.75, 1]));
    expect(states[states.length - 1]!.maskCellPx).toBeUndefined();
  });
  it('gooey_accent_pop: x and y overshoot out of phase (a blob, not a uniform scale) with a slight tilt that levels out', () => {
    const states = Array.from({length: 24}, (_, frame) => recipeState('gooey_accent_pop', frame, FPS, 90));
    expect(states[0]!.scaleX).toBeLessThan(0.8);
    expect(states[0]!.scaleY).toBeGreaterThan(1.15);
    expect(Math.max(...states.map(state => state.scaleX))).toBeGreaterThan(1.05);
    expect(Math.min(...states.map(state => state.scaleY))).toBeLessThan(0.95);
    expect(states.some(state => Math.abs(state.scaleX - state.scaleY) > 0.25)).toBe(true);
    expect(states[0]!.rotateDeg).toBeLessThan(0);
    expect(Math.abs(recipeState('gooey_accent_pop', 30, FPS, 90).rotateDeg)).toBeLessThan(0.01);
  });
  it('blur_spin_settle: spins and blurs in, resolving to sharp upright; the spin may overshoot slightly (outBack) before it levels', () => {
    const states = Array.from({length: 24}, (_, frame) => recipeState('blur_spin_settle', frame, FPS, 90));
    expect(states[0]!.rotateDeg).toBeGreaterThan(10);
    expect(states[0]!.blurPx).toBeGreaterThan(8);
    expect(states[0]!.scaleX).toBeLessThan(0.95);
    expect(Math.abs(recipeState('blur_spin_settle', 30, FPS, 90).rotateDeg)).toBeLessThan(0.01);
    expect(recipeState('blur_spin_settle', 30, FPS, 90).blurPx).toBe(0);
    expect(IDENTITY.rotateDeg).toBe(0);
  });
  it('the executor paints the new state: rotation, red / blue drop-shadow split (no blue-green), checker mask from a conic-gradient (no url()), blur', () => {
    const executor = motion('recipes/MotionRecipe.tsx');
    // WP14F: rotation may be composed as `rot` (entrance + exit); rgb split / checker mask pins stay.
    expect(executor).toMatch(/rotate\(\$\{(?:state\.rotateDeg|rot)\}deg\)/);
    for (const needle of ['state.rgbSplitPx > 0', 'drop-shadow(${-state.rgbSplitPx}px', 'rgba(255,45,85,0.75)', 'rgba(45,120,255,0.75)', "'conic-gradient(#000 25%, transparent 0 50%, #000 0 75%, transparent 0)'", 'maskSize:', 'WebkitMaskImage: mask']) expect(executor, needle).toContain(needle);
    const code = executor.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/url\(|0,\s?229,\s?255|00E5FF/i);
  });
});

describe('WP14C 3) intent priority and variety', () => {
  it('the defaults are unchanged (hook elastic, punchline squash-pop, evidence split reveal, stat counter, pivot smear)', () => {
    expect(recipeForIntent('hook')).toBe('elastic_type_snap');
    expect(recipeForIntent('punchline')).toBe('stretch_squash_pop');
    expect(recipeForIntent('evidence')).toBe('split_mask_reveal');
    expect(recipeForIntent('stat')).toBe('counter_snap');
    expect(recipeForIntent('pivot')).toBe('smear_blur_in');
    expect(recipeForIntent('list')).toBe('type_trail');
  });
  it('the variety pool of an intent lists the default first and now offers the new recipes', () => {
    expect(recipesForIntent('pivot')).toEqual(['smear_blur_in', 'scramble_settle', 'glitch_text_reveal', 'blur_spin_settle']);
    expect(recipesForIntent('punchline')).toEqual(['stretch_squash_pop', 'gooey_accent_pop', 'elastic_type_snap', 'glitch_text_reveal', 'sticker_pop']); // WP19: image_story recipes append (first intent 'media')
    expect(recipesForIntent('evidence')).toEqual(['split_mask_reveal', 'nested_scale_in', 'pixel_dissolve_in', 'still_push_in', 'card_tilt_in']);
    expect(recipesForIntent('hook')).toContain('blur_spin_settle');
    expect(recipesForIntent('stat')).toContain('gooey_accent_pop');
    for (const intent of MOTION_INTENTS) {
      expect(recipesForIntent(intent).length, intent).toBeGreaterThanOrEqual(1);
      expect(rendererPool(intent), intent).toEqual(recipesForIntent(intent));
      expect(rendererForIntent(intent), intent).toBe(recipeForIntent(intent));
      for (let n = -2; n < 7; n += 1) expect(rendererVaried(intent, n), `${intent} ${n}`).toBe(recipeForIntentVaried(intent, n));
    }
  });
  it('the varied pick wraps, is stable per variant and variant 0 is the default; a composition without a recipe host stays without one', () => {
    expect(recipeForIntentVaried('pivot', 0)).toBe('smear_blur_in');
    expect(recipeForIntentVaried('pivot', 1)).toBe('scramble_settle');
    expect(recipeForIntentVaried('pivot', 2)).toBe('glitch_text_reveal');
    expect(recipeForIntentVaried('pivot', 4)).toBe('smear_blur_in');
    expect(recipeForComposition('FullscreenStatement')).toBe('smear_blur_in');
    expect(recipeForComposition('FullscreenStatement', 2)).toBe('glitch_text_reveal');
    expect(recipeForComposition('WikiCallout', 2)).toBe('pixel_dissolve_in');
    expect(recipeForComposition('TopicPills', 3)).toBeUndefined();
  });
  it('Claude plate briefs rotate through the pool for variety (later briefs get later recipes); every id is registered and the library forwards it', () => {
    const sentences = [
      'Roughly 85 percent of projects slip without a clear owner.',
      'Number two market size matters more than anything else.',
      'The headline reported that the startup raised a huge round and investors are piling in at a valuation nobody expected.',
      'Someone tweeted that nobody reads the documentation anymore.',
    ];
    let t = 0;
    const words = sentences.flatMap(sentence => sentence.split(' ').map((text, i, all) => { const start = t; t += 0.3; if (i === all.length - 1) t += 5; return {text, start, end: start + 0.27}; }));
    const briefs = buildClaudePlateBriefs(detectExplainPlateGaps({durationSec: Math.ceil(t + 2), words, coverStarts: []}), words, 4);
    const ids = briefs.map(item => (JSON.parse(item.contentJson) as {recipeId?: string}).recipeId).filter((id): id is string => id !== undefined);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(MOTION_RECIPE_IDS as readonly string[]).toContain(id);
    expect(read('./explainPlateGaps.ts')).toContain('recipeForComposition(shape.composition, briefs.length)');
  });
  it('seeds keep the stable default (no behaviour change for the library path)', () => {
    expect(read('../motionDirector/transcriptLibrarySeed.ts')).toContain('recipeForComposition(candidate.composition)');
  });
});

describe('WP14C 4) policy and validation', () => {
  it('the recipe modules still contain no browser / tab / notification / card chrome (code only)', () => {
    for (const file of ['recipes/motionRecipes.ts', 'recipes/MotionRecipe.tsx']) {
      const code = motion(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/tab|address|notification|browser|sidebar|dashboard|borderRadius|boxShadow|border:|background:/i);
      for (const word of ['fetch(', 'http://', 'https://', 'useState', 'useEffect', 'Math.random', 'Date.now', 'setTimeout']) expect(code, `${file} ${word}`).not.toContain(word);
    }
  });
  it('a tiny graphic using each new recipe passes the worker validation: contract, typecheck, compile', async () => {
    const source = `import {Box, FitText, MotionRecipe, contentBox, type GraphicProps} from '@finalpost/motion';

type Content = {headline: string};

export default function Graphic({width, height, safeArea, content}: GraphicProps<Content>) {
  const box = contentBox(width, height, safeArea, 24);
  return (
    <Box {...box}>
      <MotionRecipe recipeId="glitch_text_reveal"><FitText text={content!.headline} width={box.width} height={box.height / 4} maxLines={1} /></MotionRecipe>
      <MotionRecipe recipeId="pixel_dissolve_in"><FitText text={content!.headline} width={box.width} height={box.height / 4} maxLines={1} /></MotionRecipe>
      <MotionRecipe recipeId="gooey_accent_pop"><FitText text={content!.headline} width={box.width} height={box.height / 4} maxLines={1} /></MotionRecipe>
      <MotionRecipe recipeId="blur_spin_settle"><FitText text={content!.headline} width={box.width} height={box.height / 4} maxLines={1} /></MotionRecipe>
    </Box>
  );
}
`;
    const {report, compiled} = await validateGraphicSource(source);
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
  it('a host with a new recipe passed by the seed / Director still validates as a library module', async () => {
    const { libraryGraphicSource } = await import('../motionDirector/libraryRegistry.ts');
    for (const id of NEW_IDS) {
      const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {passage: 'The standard is reviewed every single quarter', recipeId: id}})!;
      expect(hit.props.recipeId).toBe(id);
      const {report} = await validateGraphicSource(libraryGraphicSource(hit));
      expect(report, id).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    }
  }, 90_000);
});
