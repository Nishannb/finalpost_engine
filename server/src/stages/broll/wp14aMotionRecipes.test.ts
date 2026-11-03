/**
 * WP14A: the motion recipe registry (video vernacular), its executor, and the plate hosts that run recipes. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {
  counterSnapValue,
  entranceFrames,
  getRecipe,
  IDENTITY,
  MOTION_INTENTS as RENDERER_INTENTS,
  MOTION_RECIPES,
  MOTION_RECIPE_IDS as RENDERER_IDS,
  recipeForIntent as rendererRecipeForIntent,
  recipeState,
  scrambleText,
  typeTrailGlyphs,
} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {isMotionRecipeId, MOTION_INTENTS, MOTION_RECIPE_IDS, MOTION_RECIPE_INFO, recipeForIntent} from '../../lib/motionRecipes.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const motion = (file: string) => read(`../../../../remotion/src/motion/${file}`);
const FPS = 30;

describe('WP14A 1) registry and server parity', () => {
  it('registers 8+ recipes, each with a family, intents, a driver and declarative steps', () => {
    expect(MOTION_RECIPES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(RENDERER_IDS).size).toBe(RENDERER_IDS.length);
    for (const recipe of MOTION_RECIPES) {
      expect(['type_physics', 'reveal_mask', 'image_story', 'metric']).toContain(recipe.family);
      expect(recipe.intents.length).toBeGreaterThanOrEqual(1);
      expect(recipe.steps.length).toBeGreaterThanOrEqual(1);
      expect(recipe.feel.length).toBeGreaterThan(20);
      expect(['transform', 'glyph', 'number']).toContain(recipe.driver);
    }
    for (const id of ['elastic_type_snap', 'smear_blur_in', 'type_trail', 'scramble_settle', 'split_mask_reveal', 'stretch_squash_pop', 'counter_snap', 'nested_scale_in']) expect(getRecipe(id), id).not.toBeNull();
  });
  it('the server mirror equals the renderer registry: ids, families, intents and the intent defaults', () => {
    expect([...MOTION_RECIPE_IDS]).toEqual([...RENDERER_IDS]);
    expect([...MOTION_INTENTS]).toEqual([...RENDERER_INTENTS]);
    for (const recipe of MOTION_RECIPES) {
      expect(MOTION_RECIPE_INFO[recipe.id].family, recipe.id).toBe(recipe.family);
      expect([...MOTION_RECIPE_INFO[recipe.id].intents], recipe.id).toEqual([...recipe.intents]);
    }
    for (const intent of MOTION_INTENTS) expect(recipeForIntent(intent), intent).toBe(rendererRecipeForIntent(intent));
    expect(isMotionRecipeId('elastic_type_snap')).toBe(true);
    expect(isMotionRecipeId('fade_card')).toBe(false);
  });
  it('the intents cover hook / evidence / stat (and every intent has a recipe)', () => {
    const covered = new Set(MOTION_RECIPES.flatMap(recipe => recipe.intents));
    for (const intent of ['hook', 'evidence', 'stat', 'punchline', 'list', 'pivot', 'payoff'] as const) expect(covered.has(intent), intent).toBe(true);
    expect(recipeForIntent('hook')).toBe('elastic_type_snap');
    expect(recipeForIntent('evidence')).toBe('split_mask_reveal');
    expect(recipeForIntent('stat')).toBe('counter_snap');
  });
  it('exported from @finalpost/motion and documented in the README', () => {
    const index = motion('index.ts');
    for (const name of ['MotionRecipe', 'MOTION_RECIPES', 'MOTION_RECIPE_IDS', 'recipeState', 'recipeForIntent', 'scrambleText']) expect(index, name).toContain(name);
    const readme = motion('README.md');
    expect(readme).toContain('## Motion recipes (video vernacular)');
    for (const id of MOTION_RECIPE_IDS) expect(readme, id).toContain(`\`${id}\``);
  });
});

describe('WP14A 2) recipe frame math', () => {
  const identityAt = (state: ReturnType<typeof recipeState>) => state.opacity === 1 && state.scaleX === 1 && state.scaleY === 1 && state.blurPx === 0 && state.translateX === 0 && state.translateY === 0 && state.innerScale === 1 && state.clipPath === undefined;
  const numeric = (state: ReturnType<typeof recipeState>) => [state.opacity, state.translateX, state.translateY, state.scaleX, state.scaleY, state.blurPx, state.innerScale];
  it.each(MOTION_RECIPES.map(recipe => [recipe.id] as const))('%s: already moving (frame 0 is not the end state; something changes by frame 10) and ends on the identity state', id => {
    for (const duration of [54, 90, 126]) {
      const first = recipeState(id, 0, FPS, duration);
      expect(identityAt(first), `${id} frame 0 @${duration}`).toBe(false);
      expect(numeric(recipeState(id, 10, FPS, duration)), `${id} 0 -> 10 @${duration}`).not.toEqual(numeric(first));
      // WP19: orbit_drift is the one CONTINUOUS recipe: it keeps a few px of drift over the hold instead of ending on the exact identity
      if (id === 'orbit_drift') expect(Math.abs(recipeState(id, duration, FPS, duration).translateX), `${id} drift @${duration}`).toBeLessThan(8);
      else expect(identityAt(recipeState(id, duration, FPS, duration)), `${id} end @${duration}`).toBe(true);
    }
  });
  it.each(MOTION_RECIPES.map(recipe => [recipe.id] as const))('%s: duration-adaptive: the entrance is at most 40 %% of the graphic and the identity is reached within it (+ spring settle), for 90 frames +-40 %%', id => {
    for (const duration of [54, 90, 126]) {
      const span = entranceFrames(duration);
      expect(span).toBeGreaterThanOrEqual(8);
      expect(span).toBeLessThanOrEqual(Math.max(8, Math.round(duration * 0.4)));
      // by half-way through the graphic the recipe has long settled (the springs settle within ~1.2 s = 36 frames at most)
      const late = recipeState(id, Math.round(duration * 0.75), FPS, duration);
      expect(Math.abs(late.opacity - 1), `${id} opacity @${duration}`).toBeLessThan(0.02);
      expect(Math.abs(late.scaleX - 1), `${id} scaleX @${duration}`).toBeLessThan(0.02);
      expect(late.blurPx, `${id} blur @${duration}`).toBeLessThan(0.2);
    }
  });
  it('elastic_type_snap overshoots past 1 and clears its blur; stretch_squash_pop squashes then overshoots (cartoon physics, not a fade)', () => {
    const scales = Array.from({length: 40}, (_, frame) => recipeState('elastic_type_snap', frame, FPS, 90).scaleX);
    expect(scales[0]).toBeLessThan(0.5);
    expect(Math.max(...scales)).toBeGreaterThan(1.03);
    expect(recipeState('elastic_type_snap', 0, FPS, 90).blurPx).toBeGreaterThan(5);
    const squash = Array.from({length: 30}, (_, frame) => recipeState('stretch_squash_pop', frame, FPS, 90));
    expect(squash[0]!.scaleX).toBeGreaterThan(1.2);
    expect(squash[0]!.scaleY).toBeLessThan(0.7);
    expect(Math.min(...squash.map(state => state.scaleX))).toBeLessThan(0.95);
    expect(Math.max(...squash.map(state => state.scaleY))).toBeGreaterThan(1.1);
  });
  it('smear_blur_in starts stretched, blurred and offset, and arrives sharp; split_mask_reveal opens a slit from the centre; nested_scale_in counter-scales its content', () => {
    const smear = recipeState('smear_blur_in', 0, FPS, 90);
    expect(smear.translateX).toBeLessThan(-50);
    expect(smear.scaleX).toBeGreaterThan(1.2);
    expect(smear.blurPx).toBeGreaterThan(15);
    const split = recipeState('split_mask_reveal', 3, FPS, 90);
    expect(split.clipPath).toMatch(/^inset\(\d+(\.\d+)?% 0% \d+(\.\d+)?% 0%\)$/);
    expect(recipeState('split_mask_reveal', 90, FPS, 90).clipPath).toBeUndefined();
    const nested = recipeState('nested_scale_in', 0, FPS, 90);
    expect(nested.scaleX).toBeLessThan(0.7);
    expect(nested.innerScale).toBeGreaterThan(1.15);
  });
  it('scramble_settle: deterministic, keeps spaces, starts scrambled and ends on the real letters left to right', () => {
    const text = 'Hire the expert';
    const first = scrambleText(text, 0, 90);
    expect(first).not.toBe(text);
    expect(first[4]).toBe(' ');
    expect(first[8]).toBe(' ');
    expect(scrambleText(text, 0, 90)).toBe(first); // deterministic
    expect(scrambleText(text, 200, 90)).toBe(text);
    const mid = scrambleText(text, 10, 90);
    const settled = [...mid].filter((ch, index) => ch === text[index]).length;
    expect(settled).toBeGreaterThanOrEqual(1);
    expect(settled).toBeLessThan(text.length);
  });
  it('type_trail: characters land one after another with fading ghosts behind them; everything is landed and ghost-free at the end', () => {
    const early = typeTrailGlyphs('TRAIL', 3, 90);
    expect(early[0]!.opacity).toBeGreaterThan(early[4]!.opacity);
    expect(early.some(glyph => glyph.ghosts.some(ghost => ghost.opacity > 0))).toBe(true);
    const done = typeTrailGlyphs('TRAIL', 80, 90);
    expect(done.every(glyph => glyph.opacity === 1 && glyph.translateY === 0 && glyph.ghosts.every(ghost => ghost.opacity === 0))).toBe(true);
    expect(done.map(glyph => glyph.char).join('')).toBe('TRAIL');
  });
  it('counter_snap: counts toward the target on a spring and ends exactly on it', () => {
    expect(counterSnapValue(0, FPS, 90, 0, 85)).toBeLessThan(10);
    expect(counterSnapValue(6, FPS, 90, 0, 85)).toBeGreaterThan(counterSnapValue(2, FPS, 90, 0, 85));
    expect(counterSnapValue(80, FPS, 90, 0, 85)).toBe(85);
    expect(IDENTITY.opacity).toBe(1);
  });
});

describe('WP14A 3) executor and sandbox rules', () => {
  const recipes = motion('recipes/motionRecipes.ts');
  const executor = motion('recipes/MotionRecipe.tsx');
  it('no network, state, effects, timers or non-determinism in the recipe modules', () => {
    for (const [name, source] of [['motionRecipes.ts', recipes], ['MotionRecipe.tsx', executor]] as const) {
      for (const word of ['fetch(', 'http://', 'https://', 'useState', 'useEffect', 'useRef', 'setTimeout', 'setInterval', 'Math.random', 'Date.now', 'new Date', 'window.', 'document.', 'staticFile', 'AssetImage', '<img']) expect(source, `${name} ${word}`).not.toContain(word);
    }
  });
  it('the executor runs every driver branch (elastic / smear / transform via recipeState, glyph scramble, glyph trail, number count, nested inner scale) and falls back to a snappy pop, never a bare fade', () => {
    for (const needle of ["recipe.id === 'scramble_settle' && text !== undefined", "recipe.id === 'type_trail' && text !== undefined", "recipe.id === 'counter_snap' && value", "recipe.id === 'nested_scale_in'", 'recipeState(recipe.id, local, fps, durationInFrames)']) expect(executor, needle).toContain(needle);
    expect(executor).toContain('<Reveal effect="pop" spring="snappy"');
    expect(executor).not.toMatch(/effect=\{?\[?'fade'/);
    expect(executor).toContain('recipeExitState');
  });
  it('policy: a recipe is motion only: no browser chrome, tab strip, notification or card appears in the recipe modules', () => {
    for (const source of [recipes, executor]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/tab|address|notification|browser|sidebar|dashboard|borderRadius|boxShadow|border:|background:/i);
    }
    expect(recipes).toContain('MOTION ONLY');
    expect(motion('README.md')).toMatch(/Motion only\.[^\n]*never draws chrome/);
  });
  it('a tiny graphic using <MotionRecipe> (children, text and value forms) passes the worker validation: contract, typecheck, compile', async () => {
    const source = `import {Box, FitText, MotionRecipe, contentBox, type GraphicProps} from '@finalpost/motion';

type Content = {headline: string};

export default function Graphic({width, height, safeArea, content}: GraphicProps<Content>) {
  const box = contentBox(width, height, safeArea, 24);
  return (
    <Box {...box}>
      <MotionRecipe recipeId="elastic_type_snap">
        <FitText text={content!.headline} width={box.width} height={box.height / 2} maxLines={2} />
      </MotionRecipe>
      <MotionRecipe recipeId="scramble_settle" text={content!.headline} />
      <MotionRecipe recipeId="type_trail" text={content!.headline} />
      <MotionRecipe recipeId="counter_snap" value={{to: 85, suffix: '%'}} />
    </Box>
  );
}
`;
    const {report, compiled} = await validateGraphicSource(source);
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
  }, 60_000);
});

describe('WP14A 4) plate hosts run recipes', () => {
  const comp = (name: string) => motion(`compositions/${name}.tsx`);
  it.each([
    ['OpenPlate', 'elastic_type_snap'],
    ['StampTitle', 'stretch_squash_pop'],
    ['FullscreenStatement', 'smear_blur_in'],
    ['WikiCallout', 'split_mask_reveal'],
    ['NewspaperCallout', 'nested_scale_in'],
    ['TweetCard', 'nested_scale_in'],
  ])('%s takes recipeId? with default %s and wraps its entrance in <MotionRecipe>', (name, id) => {
    const source = comp(name);
    expect(source).toContain('recipeId?: MotionRecipeId');
    expect(source).toContain(`recipeId = '${id}'`);
    expect(source).toMatch(/<MotionRecipe recipeId=\{recipeId\}(?: exit)?>/);
    expect(source).toContain('</MotionRecipe>');
    expect(RENDERER_IDS).toContain(id);
  });
  it('OpenPlate no longer enters with a bare fade card: its title block is a recipe (spring physics), and the paper sheets are not bare fade + slide any more', () => {
    const open = comp('OpenPlate');
    expect(open).toMatch(/<MotionRecipe recipeId=\{recipeId\}(?: exit)?>/);
    for (const name of ['WikiCallout', 'NewspaperCallout', 'TweetCard']) expect(comp(name), name).not.toMatch(/<Reveal effect=\{\['fade', 'slide-up'\]\} spring="bouncy">\s*<div style=\{\{width: (page|sheet|card)\.width/);
  });
  it.each(['OpenPlate', 'StampTitle', 'FullscreenStatement', 'WikiCallout', 'NewspaperCallout', 'TweetCard'])('%s with its recipe still passes worker validation as a library module', async name => {
    const { resolveLibraryGraphic, libraryGraphicSource } = await import('../motionDirector/libraryRegistry.ts');
    const contents: Record<string, Record<string, unknown>> = {
      OpenPlate: {openTitle: 'Market size matters', kicker: 'Number two', accent: 'matters'},
      StampTitle: {stamp: '02 —', title: 'Market size matters'},
      FullscreenStatement: {statement: 'Keep the standard high', highlight: ['standard']},
      WikiCallout: {passage: 'The standard is reviewed every single quarter', highlight: ['standard']},
      NewspaperCallout: {passage: 'The startup raised a huge round', newspaper: true, highlight: ['raised']},
      TweetCard: {body: 'Nobody reads the documentation anymore', highlight: ['documentation']},
    };
    const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: contents[name]!})!;
    expect(hit.compositionId).toBe(name);
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
});
