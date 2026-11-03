/**
 * WP14F: vernacular recipe exits + SFX peaks on polish explain graphics.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {MOTION_RECIPE_IDS, recipeSfxPeaks, type MotionRecipeId} from '../../lib/motionRecipes.ts';
import {schedulePolishSfxHits} from '../../lib/polishSfx.ts';

const remotionRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../remotion');
const recipesPath = join(remotionRoot, 'src/motion/recipes/motionRecipes.ts');
const motionRecipePath = join(remotionRoot, 'src/motion/recipes/MotionRecipe.tsx');
const catalogPath = join(remotionRoot, 'src/motion/recipes/CATALOG.md');

const recipesSrc = () => readFileSync(recipesPath, 'utf8');
const host = (name: string) => readFileSync(join(remotionRoot, `src/motion/compositions/${name}.tsx`), 'utf8');

describe('WP14F 1) recipe exits', () => {
  it('defines recipeExitState, exitModeForRecipe, exitFrames and three vernacular modes', () => {
    const src = recipesSrc();
    expect(src).toContain('export function recipeExitState');
    expect(src).toContain('export function exitModeForRecipe');
    expect(src).toContain("'smear_blur_out'");
    expect(src).toContain("'scale_blur_out'");
    expect(src).toContain("'close_mask'");
  });

  it('MotionRecipe uses recipeExitState when exit is set (not soft exitProgress alone)', () => {
    const src = readFileSync(motionRecipePath, 'utf8');
    expect(src).toContain('recipeExitState');
    expect(src).toContain('exitFrames');
    expect(src).not.toMatch(/exitProgress/);
  });

  it('exit state is identity before the exit window and moves during it (frame math via dynamic import of remotion module is skipped; pin equations in source)', () => {
    const src = recipesSrc();
    expect(src).toMatch(/if \(frame < start\) return \{\.\.\.IDENTITY\}/);
    expect(src).toMatch(/translateX: r3\(90 \* p\)/);
    expect(src).toMatch(/scaleX: r3\(1 - 0\.35 \* p\)/);
  });

  it('OpenPlate / StampTitle / FullscreenStatement enable exit on MotionRecipe', () => {
    expect(host('OpenPlate')).toContain('<MotionRecipe recipeId={recipeId} exit>');
    expect(host('StampTitle')).toContain('<MotionRecipe recipeId={recipeId} exit>');
    expect(host('FullscreenStatement')).toContain('<MotionRecipe recipeId={recipeId} exit>');
  });
});

describe('WP14F 2) recipeSfxPeaks', () => {
  it('returns a deterministic peak for every registered recipe id', () => {
    for (const id of MOTION_RECIPE_IDS) {
      const peaks = recipeSfxPeaks(id, 90, 30);
      expect(peaks.length, id).toBeGreaterThanOrEqual(1);
      expect(peaks[0]!.frame, id).toBeGreaterThan(0);
      expect(['whoosh', 'hit', 'pop']).toContain(peaks[0]!.kind);
    }
  });

  it('maps families as documented (elastic→pop settle, smear→whoosh start, split→whoosh mid, counter→hit)', () => {
    expect(recipeSfxPeaks('elastic_type_snap', 90, 30)[0]!.kind).toBe('pop');
    expect(recipeSfxPeaks('smear_blur_in', 90, 30)[0]).toEqual({frame: 1, kind: 'whoosh'});
    expect(recipeSfxPeaks('split_mask_reveal', 90, 30)[0]!.kind).toBe('whoosh');
    expect(recipeSfxPeaks('counter_snap', 90, 30)[0]!.kind).toBe('hit');
  });

  it('server peaks stay stable across calls', () => {
    const a = recipeSfxPeaks('gooey_accent_pop' as MotionRecipeId, 120, 30);
    const b = recipeSfxPeaks('gooey_accent_pop' as MotionRecipeId, 120, 30);
    expect(a).toEqual(b);
  });
});

describe('WP14F 3) polish SFX planner', () => {
  it('emits recipe peaks when a graphic carries recipeId (in addition to placement hit)', () => {
    const {hits} = schedulePolishSfxHits({
      graphics: [
        {
          start: 2,
          end: 5,
          placementMode: 'full_screen',
          recipeId: 'elastic_type_snap',
          fps: 30,
        },
      ],
      minSpacingSec: 0.05,
      maxHits: 8,
    });
    expect(hits.some(hit => hit.reason?.startsWith('recipe_elastic_type_snap'))).toBe(true);
    expect(hits.some(hit => hit.kind === 'pop' || hit.kind === 'hit')).toBe(true);
  });

  it('ignores unknown recipe ids (placement hit only)', () => {
    const {hits} = schedulePolishSfxHits({
      graphics: [{start: 1, end: 3, placementMode: 'full_screen', recipeId: 'not_a_recipe'}],
    });
    expect(hits.every(hit => !hit.reason?.startsWith('recipe_'))).toBe(true);
    expect(hits.some(hit => hit.reason === 'graphic_full_screen')).toBe(true);
  });

  it('analyzeVideo passes recipeId from graphic.props into the scheduler', () => {
    const analyze = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../pipeline/analyzeVideo.ts'), 'utf8');
    expect(analyze).toContain('recipeId: typeof graphic.props?.recipeId === \'string\' ? graphic.props.recipeId : undefined');
  });
});

describe('WP14F 4) catalog', () => {
  it('CATALOG.md documents exits and SFX peaks', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    expect(catalog).toMatch(/Exits \+ SFX \(WP14F\)/);
    expect(catalog).toContain('smear_blur_out');
    expect(catalog).toContain('recipeSfxPeaks');
  });
});
