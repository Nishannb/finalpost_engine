/**
 * Skill C catalog + planner pins (WP43 scaffold). Full mount/proof is PROMPT_PASTE_WP43.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {MOTION_RECIPE_IDS} from '../../../../remotion/src/motion/recipes/motionRecipes.ts';
import {
  TEXTUAL_MG_CATALOG,
  TEXTUAL_MG_DEFERRED,
  TEXTUAL_MG_FAMILIES,
  defaultRecipeFor,
  familyForTrigger,
  textualMgFamily,
} from './textualMgCatalog.ts';
import {maxPlatesForDuration, planTextualMgPlates} from './textualMgPlanner.ts';
import {
  TEXTUAL_MG_CATALOG as REMOTION_CATALOG,
  TEXTUAL_MG_FAMILIES as REMOTION_FAMILIES,
} from '../../../../remotion/src/lib/textualMgCatalog.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../..');

describe('Skill C catalog', () => {
  it('lists every shipped family with resolvable recipes', () => {
    expect(TEXTUAL_MG_FAMILIES).toEqual([
      'snap_elastic',
      'trail_cascade',
      'scramble_glitch',
      'smear_blur',
      'mask_reveal',
      'counter_metric',
      'tagline_plate',
    ]);
    expect(TEXTUAL_MG_DEFERRED).toContain('blend_extrude');
    for (const id of TEXTUAL_MG_FAMILIES) {
      const row = textualMgFamily(id)!;
      expect(row.compositionId).toBe('TextualMgPlate');
      expect(row.recipes.length).toBeGreaterThan(0);
      for (const recipe of row.recipes) {
        expect(MOTION_RECIPE_IDS).toContain(recipe);
      }
      expect(defaultRecipeFor(id)).toBe(row.recipes[0]);
    }
  });

  it('maps triggers deterministically', () => {
    expect(familyForTrigger('spoken_stat')).toBe('counter_metric');
    expect(familyForTrigger('hook_title')).toBe('snap_elastic');
    expect(familyForTrigger('cta_keyword')).toBe('tagline_plate');
  });

  it('grammar yaml + editref name Skill C', () => {
    const yaml = readFileSync(join(root, 'remotion/out/phase36-readiness/textual-mg-grammar.yaml'), 'utf8');
    expect(yaml).toMatch(/snap_elastic/);
    expect(yaml).toMatch(/designed_text_plates_not_karaoke/);
    const editref = readFileSync(join(root, 'editref.md'), 'utf8');
    expect(editref).toMatch(/Skill C — Textual motion graphics/);
    expect(editref).toMatch(/POLISH_TEXTUAL_MG/);
  });

  it('server and remotion catalogs stay in parity', () => {
    expect([...REMOTION_FAMILIES]).toEqual([...TEXTUAL_MG_FAMILIES]);
    expect(REMOTION_CATALOG.map(r => ({id: r.id, recipes: [...r.recipes]}))).toEqual(
      TEXTUAL_MG_CATALOG.map(r => ({id: r.id, recipes: [...r.recipes]})),
    );
  });
});

describe('planTextualMgPlates', () => {
  const words = [
    {text: 'Six', start: 0.2, end: 0.4},
    {text: 'billion', start: 0.4, end: 0.7},
    {text: 'people', start: 0.7, end: 1.0},
    {text: 'watch', start: 1.0, end: 1.2},
    {text: 'short', start: 1.2, end: 1.4},
    {text: 'videos', start: 1.4, end: 1.8},
    {text: 'but', start: 8.0, end: 8.2},
    {text: 'almost', start: 8.2, end: 8.5},
    {text: 'none', start: 8.5, end: 8.8},
    {text: 'convert', start: 8.8, end: 9.2},
    {text: 'Follow', start: 18.0, end: 18.3},
    {text: 'for', start: 18.3, end: 18.5},
    {text: 'more', start: 18.5, end: 18.8},
  ];

  it('is sparse, mutes captions, and prefers hook + stat + pivot + cta', () => {
    const plan = planTextualMgPlates({durationSec: 20, words});
    expect(plan.plates.length).toBeGreaterThanOrEqual(2);
    expect(plan.plates.length).toBeLessThanOrEqual(maxPlatesForDuration(20));
    expect(plan.plates[0]!.trigger).toBe('hook_title');
    expect(plan.plates.some(p => p.family === 'counter_metric' || p.trigger === 'spoken_stat')).toBe(true);
    expect(plan.captionMuteRanges.length).toBe(plan.plates.length);
    expect(plan.warnings.some(w => w.startsWith('polish_textual_mg:plates:'))).toBe(true);
  });

  it('skips empty / tiny clips', () => {
    expect(planTextualMgPlates({durationSec: 1, words}).plates).toEqual([]);
    expect(planTextualMgPlates({durationSec: 30, words: []}).warnings.join()).toMatch(/short_or_empty/);
  });

  it('TextualMgPlate is exported from the motion barrel', () => {
    const index = readFileSync(join(root, 'remotion/src/motion/index.ts'), 'utf8');
    expect(index).toMatch(/TextualMgPlate/);
    expect(index).toMatch(/compositions = \{[^}]*TextualMgPlate/);
  });
});
