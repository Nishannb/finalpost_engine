/**
 * WP14A: server mirror of the motion recipe registry (remotion/src/motion/recipes/motionRecipes.ts). PURE: ids, families and intents only, no React and no renderer import (a test asserts parity). A seed or the Director
 * picks a recipe id by beat intent; the renderer's <MotionRecipe> runs it. Recipes are motion only: they never add chrome (no browser bar, tabs, notification cards).
 */
export const MOTION_RECIPE_IDS = [
  'elastic_type_snap',
  'smear_blur_in',
  'type_trail',
  'scramble_settle',
  'split_mask_reveal',
  'stretch_squash_pop',
  'counter_snap',
  'nested_scale_in',
  'glitch_text_reveal',
  'pixel_dissolve_in',
  'gooey_accent_pop',
  'blur_spin_settle',
  'logo_slam',
  'sticker_pop',
  'still_push_in',
  'card_tilt_in',
  'orbit_drift',
] as const;
export type MotionRecipeId = (typeof MOTION_RECIPE_IDS)[number];

export const MOTION_INTENTS = ['hook', 'punchline', 'evidence', 'list', 'stat', 'pivot', 'payoff', 'media'] as const;
export type MotionIntent = (typeof MOTION_INTENTS)[number];

export type MotionRecipeFamily = 'type_physics' | 'reveal_mask' | 'image_story' | 'metric';

export const MOTION_RECIPE_INFO: Record<MotionRecipeId, {family: MotionRecipeFamily; intents: readonly MotionIntent[]}> = {
  elastic_type_snap: {family: 'type_physics', intents: ['hook', 'punchline']},
  smear_blur_in: {family: 'type_physics', intents: ['pivot', 'hook']},
  type_trail: {family: 'type_physics', intents: ['list', 'hook']},
  scramble_settle: {family: 'type_physics', intents: ['pivot', 'stat']},
  split_mask_reveal: {family: 'reveal_mask', intents: ['evidence', 'payoff']},
  stretch_squash_pop: {family: 'type_physics', intents: ['punchline', 'hook']},
  counter_snap: {family: 'metric', intents: ['stat']},
  nested_scale_in: {family: 'image_story', intents: ['evidence', 'payoff', 'stat']},
  glitch_text_reveal: {family: 'type_physics', intents: ['pivot', 'punchline']},
  pixel_dissolve_in: {family: 'reveal_mask', intents: ['evidence', 'payoff']},
  gooey_accent_pop: {family: 'type_physics', intents: ['punchline', 'stat']},
  blur_spin_settle: {family: 'type_physics', intents: ['hook', 'pivot']},
  logo_slam: {family: 'image_story', intents: ['media', 'payoff', 'hook']},
  sticker_pop: {family: 'image_story', intents: ['media', 'punchline', 'hook']},
  still_push_in: {family: 'image_story', intents: ['media', 'evidence', 'payoff']},
  card_tilt_in: {family: 'image_story', intents: ['media', 'evidence', 'payoff']},
  orbit_drift: {family: 'image_story', intents: ['media', 'payoff']},
};

export const isMotionRecipeId = (value: unknown): value is MotionRecipeId => typeof value === 'string' && (MOTION_RECIPE_IDS as readonly string[]).includes(value);

/**
 * Every recipe that lists `intent`, in priority order (same rule as the renderer's `recipesForIntent`): recipes whose FIRST intent it is come first, in registry order, then the others. The head is the stable
 * default; the rest is the variety pool.
 */
export function recipesForIntent(intent: MotionIntent): MotionRecipeId[] {
  const lead = MOTION_RECIPE_IDS.filter(id => MOTION_RECIPE_INFO[id].intents[0] === intent);
  const rest = MOTION_RECIPE_IDS.filter(id => MOTION_RECIPE_INFO[id].intents[0] !== intent && MOTION_RECIPE_INFO[id].intents.includes(intent));
  return [...lead, ...rest];
}

/** The default recipe for an intent: the head of the priority list. */
export const recipeForIntent = (intent: MotionIntent): MotionRecipeId => recipesForIntent(intent)[0]!;

/** Variety: the n-th recipe of the intent's pool (wraps); `variant` 0 is the default. */
export function recipeForIntentVaried(intent: MotionIntent, variant: number): MotionRecipeId {
  const pool = recipesForIntent(intent);
  return pool[((variant % pool.length) + pool.length) % pool.length]!;
}

/**
 * WP14B: the beat intent of each plate composition when the seed has no richer signal, and so its default recipe. TopicPills is deliberately absent: its chips run their own Badge springs and cannot take a
 * glyph recipe such as type_trail (the `list` intent), so a pill seed carries no recipeId.
 */
export const COMPOSITION_INTENT: Readonly<Record<string, MotionIntent>> = {
  OpenPlate: 'hook',
  WikiCallout: 'evidence',
  NewspaperCallout: 'evidence',
  TweetCard: 'evidence',
  StampTitle: 'punchline',
  FlashCard: 'punchline',
  BigKineticHeadline: 'punchline',
  FullscreenStatement: 'pivot',
  StatHighlight: 'stat',
};

/** The recipe id a seed gives a composition (`variant` 0 = the default; WP14C: higher variants walk the intent's variety pool), or undefined when the composition has no recipe host. */
/** WP19: evidence cards that read as a physical object (article, screenshot, post) swing in under perspective on every second variant. */
export const CARD_TILT_HOSTS: ReadonlySet<string> = new Set(['NewspaperCallout', 'WikiCallout', 'TweetCard']);

export const recipeForComposition = (composition: string, variant = 0): MotionRecipeId | undefined => {
  const intent = COMPOSITION_INTENT[composition];
  if (intent && CARD_TILT_HOSTS.has(composition) && variant % 2 === 1) return 'card_tilt_in';
  return intent ? recipeForIntentVaried(intent, variant) : undefined;
};

/** WP14F: SFX kind for polish hits tied to a recipe peak. */
export type RecipeSfxKind = 'whoosh' | 'hit' | 'pop';
export type RecipeSfxPeak = {frame: number; kind: RecipeSfxKind};

/**
 * Deterministic SFX peaks for a recipe entrance (frames relative to graphic start). Mirrors remotion `recipeSfxPeaks`
 * without importing React. `durationInFrames` is the graphic length; `fps` defaults to 30.
 */
export function recipeSfxPeaks(id: MotionRecipeId, durationInFrames: number, fps = 30): RecipeSfxPeak[] {
  const span = Math.max(8, Math.min(24, Math.round(durationInFrames * 0.4)));
  const settle = Math.max(1, Math.round(span * 0.75));
  const mid = Math.max(1, Math.round(span * 0.45));
  switch (id) {
    case 'elastic_type_snap':
    case 'stretch_squash_pop':
    case 'gooey_accent_pop':
      return [{frame: settle, kind: 'pop'}];
    case 'smear_blur_in':
    case 'glitch_text_reveal':
    case 'blur_spin_settle':
    case 'type_trail':
    case 'scramble_settle':
      return [{frame: 1, kind: 'whoosh'}];
    case 'split_mask_reveal':
    case 'pixel_dissolve_in':
    case 'nested_scale_in':
      return [{frame: mid, kind: 'whoosh'}];
    case 'counter_snap':
    case 'logo_slam':
      return [{frame: settle, kind: 'hit'}];
    case 'sticker_pop':
      return [{frame: settle, kind: 'pop'}];
    case 'still_push_in':
    case 'card_tilt_in':
      return [{frame: 1, kind: 'whoosh'}];
    case 'orbit_drift':
      return [{frame: 1, kind: 'whoosh'}]; // soft: the drift itself is silent
    default:
      return [{frame: Math.min(settle, Math.round(fps * 0.2)), kind: 'pop'}];
  }
}
