/**
 * Skill C — Textual motion graphics catalog (Jitter-class). PURE server copy.
 * Mirror: remotion/src/lib/textualMgCatalog.ts (parity pinned in wp43TextualMgCatalog.test.ts).
 * Grammar: remotion/out/phase36-readiness/textual-mg-grammar.yaml
 */

export const TEXTUAL_MG_FAMILIES = [
  'snap_elastic',
  'trail_cascade',
  'scramble_glitch',
  'smear_blur',
  'mask_reveal',
  'counter_metric',
  'tagline_plate',
] as const;

export type TextualMgFamily = (typeof TEXTUAL_MG_FAMILIES)[number];

/** Deferred: blend modes / extrusion / repeater — do not fake with web UI cards. */
export const TEXTUAL_MG_DEFERRED = ['blend_extrude'] as const;

export type TextualMgTrigger = 'hook_title' | 'spoken_stat' | 'chapter_pivot' | 'cta_keyword' | 'product_lockup';

/** Recipe id strings — must stay in MOTION_RECIPE_IDS (test-pinned). */
export type TextualMgRecipeId =
  | 'elastic_type_snap'
  | 'stretch_squash_pop'
  | 'blur_spin_settle'
  | 'type_trail'
  | 'scramble_settle'
  | 'glitch_text_reveal'
  | 'smear_blur_in'
  | 'split_mask_reveal'
  | 'counter_snap';

export type TextualMgFamilySpec = {
  id: TextualMgFamily;
  feel: string;
  jitterRefs: readonly string[];
  /** Preferred entrance recipes (first is default). */
  recipes: readonly TextualMgRecipeId[];
  /** Library composition id for GeneratedGraphicTrack. */
  compositionId: 'TextualMgPlate';
  triggers: readonly TextualMgTrigger[];
  /** Max words on the plate (counters use a number instead). */
  maxWords: number;
};

export const TEXTUAL_MG_CATALOG: readonly TextualMgFamilySpec[] = [
  {
    id: 'snap_elastic',
    feel: 'Scale overshoot + blur clear; bold snap land (Jitter Elastic / Bold Snap).',
    jitterRefs: ['elastic-text', 'bold-text-snap', 'snappy-text-stretch', 'tilted-text-snap'],
    recipes: ['elastic_type_snap', 'stretch_squash_pop', 'blur_spin_settle'],
    compositionId: 'TextualMgPlate',
    triggers: ['hook_title', 'chapter_pivot', 'cta_keyword'],
    maxWords: 6,
  },
  {
    id: 'trail_cascade',
    feel: 'Chars/words stagger in with fading ghosts (Type Trail / Cascading Text).',
    jitterRefs: ['type-trail', 'cascading-text', 'blur-text-scroller'],
    recipes: ['type_trail'],
    compositionId: 'TextualMgPlate',
    triggers: ['hook_title', 'chapter_pivot'],
    maxWords: 8,
  },
  {
    id: 'scramble_glitch',
    feel: 'Glyph flicker / RGB split then settle (Text Scramble / Glitchy Reveal).',
    jitterRefs: ['text-scramble', 'glitchy-text-reveal', 'glitch-01-text-reveal'],
    recipes: ['scramble_settle', 'glitch_text_reveal'],
    compositionId: 'TextualMgPlate',
    triggers: ['chapter_pivot', 'product_lockup'],
    maxWords: 6,
  },
  {
    id: 'smear_blur',
    feel: 'Directional blur + stretch entrance (Motion Blur / Blurry Text Spin).',
    jitterRefs: ['motion-blur-text', 'blurry-text-spin'],
    recipes: ['smear_blur_in', 'blur_spin_settle'],
    compositionId: 'TextualMgPlate',
    triggers: ['hook_title', 'chapter_pivot'],
    maxWords: 6,
  },
  {
    id: 'mask_reveal',
    feel: 'Clip/wipe sliding title (Sliding Reveal / Apple Event).',
    jitterRefs: ['sliding-text-reveal', 'sliding-title-reveal-apple-event'],
    recipes: ['split_mask_reveal'],
    compositionId: 'TextualMgPlate',
    triggers: ['hook_title', 'product_lockup'],
    maxWords: 8,
  },
  {
    id: 'counter_metric',
    feel: 'Number ticks to value (Countdown Bold / Counter posters).',
    jitterRefs: ['countdown-bold', 'counter-1-000-figma-plugin-installs'],
    recipes: ['counter_snap'],
    compositionId: 'TextualMgPlate',
    triggers: ['spoken_stat'],
    maxWords: 3,
  },
  {
    id: 'tagline_plate',
    feel: 'Short 1–6 word hero over media; soft shadow; clean exit.',
    jitterRefs: ['the-edit-tagline', 'the-crust-tagline', 'video-title-slide'],
    recipes: ['elastic_type_snap', 'stretch_squash_pop'],
    compositionId: 'TextualMgPlate',
    triggers: ['hook_title', 'cta_keyword', 'product_lockup'],
    maxWords: 6,
  },
];

export function textualMgFamily(id: string): TextualMgFamilySpec | undefined {
  return TEXTUAL_MG_CATALOG.find(row => row.id === id);
}

export function defaultRecipeFor(family: TextualMgFamily): TextualMgRecipeId {
  const row = textualMgFamily(family);
  return row?.recipes[0] ?? 'elastic_type_snap';
}

/** Heuristic: pick a family from a trigger (deterministic; director can override later). */
export function familyForTrigger(trigger: TextualMgTrigger): TextualMgFamily {
  switch (trigger) {
    case 'spoken_stat':
      return 'counter_metric';
    case 'cta_keyword':
      return 'tagline_plate';
    case 'product_lockup':
      return 'mask_reveal';
    case 'chapter_pivot':
      return 'scramble_glitch';
    case 'hook_title':
    default:
      return 'snap_elastic';
  }
}
