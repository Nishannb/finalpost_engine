/**
 * WP14D: kinetic type (KineticText, BigKineticHeadline, product captions, VsClaim, QuoteCallout) speaks the motion-recipe dialect without breaking word-timed karaoke or the mute. Offline: no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {
  CAPTION_WORD_SETTLE_FRAMES,
  IDENTITY,
  UNIT_RECIPE_DURATION_FRAMES,
  captionRecipeIdFor,
  captionWordRecipeState,
  isUnitRecipe,
  recipeStateCss,
  unitRecipeState,
} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {COMPOSITION_INTENT, recipeForComposition} from '../../lib/motionRecipes.ts';
import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const motion = (file: string) => read(`../../../../remotion/src/motion/${file}`);
const FPS = 30;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('WP14D 1) BigKineticHeadline', () => {
  const source = motion('compositions/BigKineticHeadline.tsx');
  it('takes recipeId? (default stretch_squash_pop: the stacked headline is a punchline beat) and wraps every line in <MotionRecipe>; the word stagger stays', () => {
    expect(source).toContain('recipeId?: MotionRecipeId');
    expect(source).toContain("recipeId = 'stretch_squash_pop'");
    expect(source).toContain('<MotionRecipe recipeId={recipeId} delay={index * 8}>');
    expect(source).toContain('</MotionRecipe>');
    expect(source).toContain('each={3}');
    expect(source).toContain('effect="up"'); // reading energy of the word stagger is kept; the recipe owns the layer settle
  });
  it('is registered as a punchline plate: the composition map names it and the seed would emit that recipe; the registry forwards a recipeId (both content shapes)', () => {
    expect(COMPOSITION_INTENT.BigKineticHeadline).toBe('punchline');
    expect(recipeForComposition('BigKineticHeadline')).toBe('stretch_squash_pop');
    for (const content of [{lines: ['Hire the expert', 'trust their advice'], accent: 'expert'}, {headline: 'Hire the expert today'}]) {
      expect(resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {...content, recipeId: 'glitch_text_reveal'}})!.props.recipeId).toBe('glitch_text_reveal');
      expect(resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {...content, recipeId: 'not_a_recipe'}})!.props.recipeId).toBeUndefined();
    }
  });
  it('a delayed recipe line is hidden until its delay (a line must not sit on the recipe\'s first frame while it waits)', () => {
    const executor = motion('recipes/MotionRecipe.tsx');
    expect(executor).toContain('if (local < 0) return <div style={{...style, opacity: 0}}>');
  });
  it('passes worker validation as a library module', async () => {
    const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content: {lines: ['Hire the expert', 'trust their advice'], recipeId: 'stretch_squash_pop'}})!;
    expect(hit.compositionId).toBe('BigKineticHeadline');
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
});

describe('WP14D 2) KineticText', () => {
  const text = motion('components/Text.tsx');
  it('accepts recipeId? and drives each unit (word / char / line) from unitRecipeState; omitted = the soft effect as before', () => {
    expect(text).toContain('recipeId?: MotionRecipeId');
    expect(text).toContain('if (isUnitRecipe(props.recipeId))');
    expect(text).toContain('recipeStateCss(unitRecipeState(props.recipeId, frame - start, fps))');
    expect(text).toContain('filter: entrance.filter');
    expect(text).toContain('const t = springIn(frame, fps, start, spring);'); // the default path is still there
  });
  it('only transform-driven recipes drive a unit; glyph / number recipes fall back to the effect', () => {
    for (const id of ['elastic_type_snap', 'stretch_squash_pop', 'smear_blur_in', 'glitch_text_reveal', 'blur_spin_settle']) expect(isUnitRecipe(id), id).toBe(true);
    for (const id of ['type_trail', 'scramble_settle', 'counter_snap', 'nope', undefined]) expect(isUnitRecipe(id as string | undefined), String(id)).toBe(false);
  });
  it('per-unit math: hidden before its own start, moving on its first frame, identity after the 16-frame entrance; staggered units are in different states at the same frame', () => {
    expect(UNIT_RECIPE_DURATION_FRAMES).toBe(40);
    for (const id of ['elastic_type_snap', 'stretch_squash_pop'] as const) {
      expect(unitRecipeState(id, -1, FPS).opacity).toBe(0);
      expect(unitRecipeState(id, 0, FPS)).not.toEqual({...IDENTITY});
      const mid = unitRecipeState(id, 6, FPS);
      expect(mid.scaleX !== 1 || mid.scaleY !== 1).toBe(true);
      const late = unitRecipeState(id, 40, FPS);
      expect(late.opacity).toBe(1);
      expect(late.scaleX).toBeCloseTo(1, 1);
      expect(late.blurPx).toBeLessThan(0.1);
      // word 0 started 6 frames before word 1 (each = 6): at frame 8 they are in different states
      expect(unitRecipeState(id, 8, FPS)).not.toEqual(unitRecipeState(id, 2, FPS));
    }
    const css = recipeStateCss(unitRecipeState('elastic_type_snap', 0, FPS));
    expect(css.transform).toMatch(/^translate\(.+\) rotate\(.+deg\) scale\(.+\)$/);
    expect(css.filter).toMatch(/^blur\(/);
  });
  it('no browser / tab / notification chrome in the toolkit text module (code only)', () => {
    expect(stripComments(text)).not.toMatch(/browser|notification|address bar|tab strip|sidebar|dashboard/i);
  });
  it('hosts that should feel video-native pass a recipe; others keep the default behaviour', () => {
    expect(motion('compositions/BigKineticHeadline.tsx')).toContain('MotionRecipe');
    expect(motion('compositions/FullscreenStatement.tsx')).toMatch(/<MotionRecipe recipeId=\{recipeId\}(?: exit)?>/);
    expect(motion('compositions/StampTitle.tsx')).toMatch(/<MotionRecipe recipeId=\{recipeId\}(?: exit)?>/);
    expect(motion('compositions/TopicPills.tsx')).not.toContain('recipeId'); // chips keep their Badge springs
  });
});

describe('WP14D 3) product captions (KineticCaptions)', () => {
  it('animation -> recipe: bounce -> stretch_squash_pop; scale / pop / type -> elastic_type_snap; highlight / karaoke / box -> none; a typed look takes the elastic snap', () => {
    expect(captionRecipeIdFor('bounce')).toBe('stretch_squash_pop');
    for (const animation of ['scale', 'pop', 'type']) expect(captionRecipeIdFor(animation), animation).toBe('elastic_type_snap');
    for (const animation of ['highlight', 'karaoke', 'box', undefined, null, 'weird']) expect(captionRecipeIdFor(animation as string | undefined | null), String(animation)).toBeNull();
    expect(captionRecipeIdFor('highlight', true)).toBe('elastic_type_snap');
    expect(captionRecipeIdFor('karaoke', true)).toBe('elastic_type_snap');
    expect(captionRecipeIdFor('box', true)).toBeNull();
    expect(captionRecipeIdFor('bounce', true)).toBe('stretch_squash_pop');
  });
  it.each([['bounce', false], ['scale', false], ['pop', false], ['type', false], ['highlight', true], ['karaoke', true]] as const)('%s (typed %s): moving on the onset frame, changing within 3 frames, exactly identity from the settle window on', (animation, typed) => {
    const first = captionWordRecipeState(animation, 0, FPS, typed)!;
    expect(first).not.toBeNull();
    expect(first.scaleX !== 1 || first.scaleY !== 1 || first.blurPx > 0 || first.opacity < 1).toBe(true);
    expect(captionWordRecipeState(animation, 3, FPS, typed)).not.toEqual(first);
    expect(captionWordRecipeState(animation, CAPTION_WORD_SETTLE_FRAMES, FPS, typed)).toEqual({...IDENTITY});
    expect(captionWordRecipeState(animation, CAPTION_WORD_SETTLE_FRAMES + 50, FPS, typed)).toEqual({...IDENTITY});
    // the settle is a blend, not a jump: the last frame before the window is already close to identity
    const near = captionWordRecipeState(animation, CAPTION_WORD_SETTLE_FRAMES - 1, FPS, typed)!;
    expect(Math.abs(near.scaleX - 1)).toBeLessThan(0.1);
    expect(Math.abs(near.scaleY - 1)).toBeLessThan(0.1);
    expect(near.blurPx).toBeLessThan(1);
  });
  it('the settle window is 0.25-0.35 s; elastic overshoots past 1 before settling and the squash-pop squashes (cartoon physics), deterministic', () => {
    expect(CAPTION_WORD_SETTLE_FRAMES / FPS).toBeGreaterThanOrEqual(0.25);
    expect(CAPTION_WORD_SETTLE_FRAMES / FPS).toBeLessThanOrEqual(0.35);
    const elastic = Array.from({length: CAPTION_WORD_SETTLE_FRAMES}, (_, frame) => captionWordRecipeState('scale', frame, FPS)!);
    expect(elastic[0]!.scaleX).toBeLessThan(0.6);
    expect(Math.max(...elastic.map(state => state.scaleX))).toBeGreaterThan(1.0);
    const squash = Array.from({length: CAPTION_WORD_SETTLE_FRAMES}, (_, frame) => captionWordRecipeState('bounce', frame, FPS)!);
    expect(squash[0]!.scaleX).toBeGreaterThan(1.2);
    expect(squash[0]!.scaleY).toBeLessThan(0.7);
    expect(captionWordRecipeState('bounce', 4, FPS)).toEqual(captionWordRecipeState('bounce', 4, FPS));
  });
  it('wiring pins: only the ACTIVE word runs the recipe (no one-shot wrapper on the rail), the old pop remains for other animations, the karaoke fill / marker / stroke are untouched', () => {
    const captions = read('../../../../remotion/src/components/KineticCaptions.tsx');
    expect(captions).toContain('const recipe = isActive ? captionWordRecipeState(template.animation, sinceOnset, fps, Boolean(typed)) : null;');
    expect(captions).toContain('const pop = recipe ? 1 : isActive');
    expect(captions).toContain('!recipe && isActive && template.animation');
    expect(captions).not.toContain('<MotionRecipe');
    expect(captions).toContain("typed?.activeStyle === 'marker' && isActive"); // WP13C marker bar
    expect(captions).toContain('WebkitTextStroke = `${typed.strokeWidth}px ${typed.strokeColor}`'); // WP13C stroke
    expect(captions).toContain('useKaraokeFill');
  });
  it('the caption mute is untouched: ranges still gate the whole layer in ShortVideo', () => {
    expect(read('../../../../remotion/src/ShortVideo.tsx')).toContain('captionsMutedAt(blueprint.captionMuteRanges, timeSec)');
  });
});

describe('WP14D 4) soft-fade plate hosts migrated', () => {
  it('VsClaim sides enter with <MotionRecipe> (default smear_blur_in), QuoteCallout\'s quote block with split_mask_reveal and its mark with elastic_type_snap; no fade + slide Reveal left on them', () => {
    const vs = motion('compositions/VsClaim.tsx');
    expect(vs).toContain("recipeId = 'smear_blur_in'");
    expect(vs).toContain('<MotionRecipe recipeId={recipeId} delay={side.delay}>');
    expect(vs).not.toMatch(/effect=\{[^}]*'fade'/);
    const quote = motion('compositions/QuoteCallout.tsx');
    expect(quote).toContain("recipeId = 'split_mask_reveal'");
    expect(quote).toContain('<MotionRecipe recipeId="elastic_type_snap">');
    expect(quote).toContain('<MotionRecipe recipeId={recipeId}>');
  });
  it.each([
    ['VsClaim', {left: 'speed', right: 'quality'}],
    ['QuoteCallout', {quote: 'Never confuse being busy with progress', highlight: ['progress']}],
  ])('%s still passes worker validation as a library module', async (id, content) => {
    const hit = resolveLibraryGraphic({goal: 'g', visualDescription: 'v', placement: 'full_screen', content})!;
    expect(hit.compositionId).toBe(id);
    const {report} = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
  }, 60_000);
});
