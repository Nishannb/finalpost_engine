/**
 * WP14A: MOTION RECIPES, the video vernacular of the motion toolkit. A recipe is a named, declarative entrance (elastic type snap, smear blur, type trail, scramble-settle, split reveal, squash and stretch,
 * counter snap, nested scale) that a plate host runs through <MotionRecipe>. Pure math here (no React): `recipeState` maps (recipe, frame, fps, duration) to the transform / filter / clip of the wrapped layer, so every
 * recipe is unit-testable frame by frame.
 *
 * Rules every recipe keeps:
 *  - MOTION ONLY. A recipe never draws chrome (no browser bar, tabs, notification, card): hosts own the paper; the recipe only moves, blurs, stretches, clips and re-times what it wraps.
 *  - ALREADY MOVING at frame 0: the first frame is never the end state, and something changes between frame 0 and frame 10.
 *  - DURATION-ADAPTIVE: the entrance is a short fixed span clamped to a fraction of the graphic (`entranceFrames`), so +-40 % of the duration still ends in the identity state well before the last third.
 *  - ENDS AT IDENTITY: opacity 1, scale 1, no blur, no offset, no clip.
 * No network, no timers, no random or clock calls: scrambles are a deterministic hash of (index, frame).
 */
import {interpolate, spring} from 'remotion';

import {ease, springIn} from '../animation';

export type MotionRecipeId =
  | 'elastic_type_snap'
  | 'smear_blur_in'
  | 'type_trail'
  | 'scramble_settle'
  | 'split_mask_reveal'
  | 'stretch_squash_pop'
  | 'counter_snap'
  | 'nested_scale_in'
  | 'glitch_text_reveal'
  | 'pixel_dissolve_in'
  | 'gooey_accent_pop'
  | 'blur_spin_settle'
  | 'logo_slam'
  | 'sticker_pop'
  | 'still_push_in'
  | 'card_tilt_in'
  | 'orbit_drift';

export type MotionRecipeFamily = 'type_physics' | 'reveal_mask' | 'image_story' | 'metric';
export type MotionIntent = 'hook' | 'punchline' | 'evidence' | 'list' | 'stat' | 'pivot' | 'payoff' | 'media';

/** WP19: recipes that keep moving after the entrance (a slow drift over the hold). Every other recipe ends at IDENTITY. */
export const CONTINUOUS_RECIPE_IDS: readonly string[] = ['orbit_drift'];

/** How the executor drives a recipe: a transform on the wrapped layer, a per-glyph text effect, or a counted number. */
export type RecipeDriver = 'transform' | 'glyph' | 'number';

export type MotionRecipe = {
  id: MotionRecipeId;
  family: MotionRecipeFamily;
  /** The beats this recipe suits (a seed / Director picks a recipe by intent). */
  intents: readonly MotionIntent[];
  driver: RecipeDriver;
  /** What it feels like, and the Remotion primitives that implement it (documentation, shown in the README). */
  feel: string;
  /** Declarative steps (documentation + tests): the primitive and its key parameters. */
  steps: ReadonlyArray<{primitive: 'spring' | 'interpolate' | 'keyframes' | 'clip' | 'filter_blur' | 'stagger' | 'hash_scramble'; target: string; note: string}>;
};

export const MOTION_RECIPES: readonly MotionRecipe[] = [
  {
    id: 'elastic_type_snap',
    family: 'type_physics',
    intents: ['hook', 'punchline'],
    driver: 'transform',
    feel: 'Scale 0.4 -> overshoot -> 1 on a springy curve, with a blur that clears as it lands (Snappy / Elastic Text).',
    steps: [
      {primitive: 'spring', target: 'scale', note: 'damping 9, stiffness 220, mass 0.6: overshoots ~12 %'},
      {primitive: 'filter_blur', target: 'blur', note: '10 px -> 0 with the spring'},
    ],
  },
  {
    id: 'smear_blur_in',
    family: 'type_physics',
    intents: ['pivot', 'hook'],
    driver: 'transform',
    feel: 'A horizontal smear: the layer is stretched and blurred along x and slides in, then snaps sharp (Stretch Blur).',
    steps: [
      {primitive: 'interpolate', target: 'translateX', note: '-90 px -> 0, outExpo'},
      {primitive: 'interpolate', target: 'scaleX', note: '1.35 -> 1 (stretch)'},
      {primitive: 'filter_blur', target: 'blur', note: '22 px -> 0'},
    ],
  },
  {
    id: 'type_trail',
    family: 'type_physics',
    intents: ['list', 'hook'],
    driver: 'glyph',
    feel: 'Characters arrive one after another, each leaving a fading ghost of itself behind it (Type Trail).',
    steps: [
      {primitive: 'stagger', target: 'chars', note: '1 frame per character'},
      {primitive: 'interpolate', target: 'ghost', note: 'two ghosts at -0.4em / -0.8em fade as the character lands'},
    ],
  },
  {
    id: 'scramble_settle',
    family: 'type_physics',
    intents: ['pivot', 'stat'],
    driver: 'glyph',
    feel: 'Glyphs flicker through random letters and lock onto the real ones left to right.',
    steps: [
      {primitive: 'hash_scramble', target: 'chars', note: 'deterministic hash of (index, frame)'},
      {primitive: 'stagger', target: 'settle', note: 'character i settles at 6 + 1.2 i frames'},
    ],
  },
  {
    id: 'split_mask_reveal',
    family: 'reveal_mask',
    intents: ['evidence', 'payoff'],
    driver: 'transform',
    feel: 'A horizontal slit opens from the centre line and the layer is revealed through it (Split Reveal).',
    steps: [
      {primitive: 'clip', target: 'clipPath', note: 'inset(44% 0) -> inset(0)'},
      {primitive: 'interpolate', target: 'scaleY', note: '1.04 -> 1'},
    ],
  },
  {
    id: 'stretch_squash_pop',
    family: 'type_physics',
    intents: ['punchline', 'hook'],
    driver: 'transform',
    feel: 'Cartoon physics: stretched flat, squashed tall, overshoot, settle. Not a fade.',
    steps: [
      {primitive: 'keyframes', target: 'scaleX/scaleY', note: '(1.4, 0.55) -> (0.85, 1.2) -> (1.06, 0.96) -> (1, 1)'},
    ],
  },
  {
    id: 'counter_snap',
    family: 'metric',
    intents: ['stat'],
    driver: 'number',
    feel: 'A number counts up on a snappy spring and the digits pop as they settle.',
    steps: [
      {primitive: 'spring', target: 'value', note: 'snappy preset, from -> to'},
      {primitive: 'keyframes', target: 'scale', note: '1 -> 1.12 -> 1 on settle'},
    ],
  },
  {
    id: 'nested_scale_in',
    family: 'image_story',
    intents: ['evidence', 'payoff', 'stat'],
    driver: 'transform',
    feel: 'Nested scale from the centre: the layer grows 0.6 -> 1 while its content counter-scales 1.25 -> 1 (Nested Images energy).',
    steps: [
      {primitive: 'spring', target: 'scale', note: 'smooth spring, outer 0.6 -> 1'},
      {primitive: 'spring', target: 'innerScale', note: 'inner 1.25 -> 1'},
    ],
  },
  {
    id: 'glitch_text_reveal',
    family: 'type_physics',
    intents: ['pivot', 'punchline'],
    driver: 'transform',
    feel: 'RGB split and horizontal jitter that settle into sharp type in a few stepped frames (Glitch Text Reveal). The split is a red / blue drop-shadow pair (never the karaoke blue-green).',
    steps: [
      {primitive: 'hash_scramble', target: 'translateX', note: 'hashed +-14 px jitter every 2 frames, shrinking to 0'},
      {primitive: 'filter_blur', target: 'rgbSplit', note: 'red / blue offset 9 px -> 0 as two drop-shadows'},
    ],
  },
  {
    id: 'pixel_dissolve_in',
    family: 'reveal_mask',
    intents: ['evidence', 'payoff'],
    driver: 'transform',
    feel: 'A coarse checker grid reveals the layer and refines to nothing: the mask cells shrink 96 px -> 6 px while opacity climbs in four steps (Pixel Dissolve, lite).',
    steps: [
      {primitive: 'clip', target: 'mask', note: 'repeating conic-gradient checker, cell 96 -> 6 px, then no mask'},
      {primitive: 'interpolate', target: 'opacity', note: 'quantised to 0.25 / 0.5 / 0.75 / 1'},
    ],
  },
  {
    id: 'gooey_accent_pop',
    family: 'type_physics',
    intents: ['punchline', 'stat'],
    driver: 'transform',
    feel: 'A blobby pop: x and y overshoot out of phase with a slight tilt, so the layer wobbles like a gooey blob before it settles. Motion only: no backing card.',
    steps: [
      {primitive: 'keyframes', target: 'scaleX', note: '0.6 -> 1.18 -> 0.94 -> 1'},
      {primitive: 'keyframes', target: 'scaleY', note: '1.3 -> 0.86 -> 1.06 -> 1 (out of phase with x)'},
      {primitive: 'interpolate', target: 'rotate', note: '-4 deg -> 0'},
    ],
  },
  {
    id: 'blur_spin_settle',
    family: 'type_physics',
    intents: ['hook', 'pivot'],
    driver: 'transform',
    feel: 'A slight spin and blur resolving to sharp upright type (Blurry Text Spin, lite): rotate 14 deg -> 0, blur 12 px -> 0, scale 0.92 -> 1.',
    steps: [
      {primitive: 'interpolate', target: 'rotate', note: '14 deg -> 0, outBack'},
      {primitive: 'filter_blur', target: 'blur', note: '12 px -> 0'},
    ],
  },
  {
    id: 'logo_slam',
    family: 'image_story',
    intents: ['media', 'payoff', 'hook'],
    driver: 'transform',
    feel: 'A logo HIT: it slams in from 0.2 scale, overshoots to ~1.18, rocks a few degrees and settles (Jitter logo reveal). Motion only.',
    steps: [
      {primitive: 'keyframes', target: 'scale', note: '0.2 -> 1.18 -> 0.97 -> 1'},
      {primitive: 'keyframes', target: 'rotate', note: '-8 deg -> 3 -> -1 -> 0'},
      {primitive: 'filter_blur', target: 'blur', note: '6 px -> 0'},
    ],
  },
  {
    id: 'sticker_pop',
    family: 'image_story',
    intents: ['media', 'punchline', 'hook'],
    driver: 'transform',
    feel: 'An elastic sticker pop: scale 0.3 -> overshoot -> 1 with a small rotate wiggle that dies out (KLIPY stickers, emoji).',
    steps: [
      {primitive: 'spring', target: 'scale', note: 'elastic spring 0.3 -> 1'},
      {primitive: 'interpolate', target: 'rotate', note: '10 deg * cos wiggle, decaying to 0'},
    ],
  },
  {
    id: 'still_push_in',
    family: 'image_story',
    intents: ['media', 'evidence', 'payoff'],
    driver: 'transform',
    feel: 'A slow camera push on a still: scale 1.12 -> 1 over ~60 % of the hold with a soft blur that clears in the first frames (Ken Burns, not a fade).',
    steps: [
      {primitive: 'interpolate', target: 'scale', note: '1.12 -> 1, out curve, over 60 % of the graphic'},
      {primitive: 'filter_blur', target: 'blur', note: '8 px -> 0 in the entrance'},
    ],
  },
  {
    id: 'card_tilt_in',
    family: 'image_story',
    intents: ['media', 'evidence', 'payoff'],
    driver: 'transform',
    feel: 'A card swung in under perspective: rotateY 16 deg and rotateX 10 deg settle to 0 while the scale lands 0.9 -> 1 (article / screenshot as a physical object).',
    steps: [
      {primitive: 'spring', target: 'rotateY/rotateX', note: '16 / 10 deg -> 0, smooth spring'},
      {primitive: 'spring', target: 'scale', note: '0.9 -> 1'},
    ],
  },
  {
    id: 'orbit_drift',
    family: 'image_story',
    intents: ['media', 'payoff'],
    driver: 'transform',
    feel: 'CONTINUOUS: a very slow drift (a few px, ~1.5 deg) on two out-of-phase sines for the whole hold; a short blur-clear entrance. For logo-cloud background items.',
    steps: [
      {primitive: 'interpolate', target: 'translateX/translateY/rotate', note: 'sines at 0.9 / 0.7 rad per second, ramped in over the entrance'},
    ],
  },
];

export const MOTION_RECIPE_IDS: readonly MotionRecipeId[] = MOTION_RECIPES.map(recipe => recipe.id);
export const MOTION_INTENTS: readonly MotionIntent[] = ['hook', 'punchline', 'evidence', 'list', 'stat', 'pivot', 'payoff', 'media'];

export function getRecipe(id: string | undefined | null): MotionRecipe | null {
  return MOTION_RECIPES.find(recipe => recipe.id === id) ?? null;
}

/**
 * Every recipe that lists `intent`, in priority order: recipes whose FIRST intent it is come first (registry order), then the others. The head of this list is the stable default (`recipeForIntent`);
 * the rest are the variety pool (WP14C), e.g. pivot: smear_blur_in, glitch_text_reveal, blur_spin_settle, scramble_settle.
 */
export function recipesForIntent(intent: MotionIntent): MotionRecipeId[] {
  const lead = MOTION_RECIPES.filter(recipe => recipe.intents[0] === intent);
  const rest = MOTION_RECIPES.filter(recipe => recipe.intents[0] !== intent && recipe.intents.includes(intent));
  return [...lead, ...rest].map(recipe => recipe.id);
}

/** The stable default recipe for an intent (the head of the priority list). */
export function recipeForIntent(intent: MotionIntent): MotionRecipeId {
  return recipesForIntent(intent)[0]!;
}

/** Variety: the n-th recipe of the intent's pool (wraps). `variant` 0 is the default. */
export function recipeForIntentVaried(intent: MotionIntent, variant: number): MotionRecipeId {
  const pool = recipesForIntent(intent);
  return pool[((variant % pool.length) + pool.length) % pool.length]!;
}

/** The entrance length in frames: a short fixed span, never more than 40 % of the graphic, never under 8 frames. */
export function entranceFrames(durationInFrames: number): number {
  return Math.max(8, Math.min(24, Math.round(durationInFrames * 0.4)));
}

export type RecipeState = {
  opacity: number;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  blurPx: number;
  /** CSS clip-path of the wrapped layer; undefined = no clip. */
  clipPath?: string;
  /** nested_scale_in: the content's counter-scale. */
  innerScale: number;
  /** WP14C: rotation in degrees (blur_spin_settle, gooey_accent_pop). */
  rotateDeg: number;
  /** WP19: perspective tilt in degrees (card_tilt_in); the host applies `perspective()` when either is non-zero. */
  rotateXDeg: number;
  rotateYDeg: number;
  /** WP14C: glitch RGB split offset in px (red left, blue right). */
  rgbSplitPx: number;
  /** WP14C: pixel_dissolve_in checker cell size in px; undefined = no mask. */
  maskCellPx?: number;
};

export const IDENTITY: RecipeState = {opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, blurPx: 0, innerScale: 1, rotateDeg: 0, rotateXDeg: 0, rotateYDeg: 0, rgbSplitPx: 0};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** A deterministic 0..1 hash of two integers (no random or clock calls). */
const hash = (a: number, b: number): number => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const r3 = (value: number) => Math.round(value * 1000) / 1000;
const ELASTIC = {damping: 9, stiffness: 220, mass: 0.6} as const;

/** A spring with an explicit config (the elastic recipes' own curves; `springIn` covers the presets). */
const springWith = (frame: number, fps: number, delay: number, config: {damping: number; stiffness: number; mass: number}) => spring({frame: frame - delay, fps, config});

/**
 * The transform-driven state of a recipe. `frame` is relative to the graphic (the host passes `frame - delay`). Glyph and number recipes return their wrapper state too (a light settle), the executor
 * adds the per-glyph / counted-number layer on top.
 */
export function recipeState(id: MotionRecipeId, frame: number, fps: number, durationInFrames: number): RecipeState {
  const span = entranceFrames(durationInFrames);
  const t = clamp01(frame / span);
  switch (id) {
    case 'elastic_type_snap': {
      const s = springWith(frame, fps, 0, ELASTIC);
      const scale = 0.4 + 0.6 * s;
      return {...IDENTITY, scaleX: r3(scale), scaleY: r3(scale), blurPx: r3(10 * (1 - clamp01(s))), opacity: r3(0.35 + 0.65 * clamp01(s * 1.8))};
    }
    case 'smear_blur_in': {
      const p = frame >= span ? 1 : interpolate(frame, [0, span], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.outExpo}); // outExpo stops just short of 1, so the end is forced
      return {...IDENTITY, translateX: r3(-90 * (1 - p)), scaleX: r3(1 + 0.35 * (1 - p)), blurPx: r3(22 * (1 - p)), opacity: r3(0.3 + 0.7 * p)};
    }
    case 'split_mask_reveal': {
      const p = interpolate(frame, [0, span], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.out});
      const inset = 44 * (1 - p); // a slit is already open on the first frame
      return {...IDENTITY, clipPath: p >= 1 ? undefined : `inset(${r3(inset)}% 0% ${r3(inset)}% 0%)`, scaleY: r3(1.04 - 0.04 * p)};
    }
    case 'stretch_squash_pop': {
      const f = [0, span * 0.35, span * 0.65, span];
      const scaleX = interpolate(frame, f, [1.4, 0.85, 1.06, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.inOut});
      const scaleY = interpolate(frame, f, [0.55, 1.2, 0.96, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.inOut});
      return {...IDENTITY, scaleX: r3(scaleX), scaleY: r3(scaleY), opacity: r3(0.4 + 0.6 * clamp01(t * 2.5))};
    }
    case 'nested_scale_in': {
      const s = springWith(frame, fps, 0, {damping: 18, stiffness: 120, mass: 0.9});
      return {...IDENTITY, scaleX: r3(0.6 + 0.4 * s), scaleY: r3(0.6 + 0.4 * s), innerScale: r3(1.25 - 0.25 * s), opacity: r3(0.4 + 0.6 * clamp01(s * 2))};
    }
    case 'counter_snap': {
      const s = springIn(frame, fps, 0, 'snappy');
      const pop = interpolate(frame, [span * 0.5, span * 0.75, span], [1, 1.12, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      return {...IDENTITY, scaleX: r3(pop), scaleY: r3(pop), opacity: r3(0.5 + 0.5 * clamp01(s * 2))};
    }
    case 'glitch_text_reveal': {
      if (frame >= span) return {...IDENTITY};
      const step = Math.floor(Math.max(0, frame) / 2);
      const p = clamp01((step * 2) / span); // stepped: the jitter holds for two frames
      const sign = hash(step + 3, 17) < 0.5 ? -1 : 1;
      const amp = 14 * (1 - p) * (0.4 + 0.6 * hash(step + 11, 5));
      return {...IDENTITY, translateX: r3(sign * amp), rgbSplitPx: r3(9 * (1 - p) * (hash(step + 29, 7) > 0.25 ? 1 : 0.4)), opacity: r3(0.4 + 0.6 * (hash(step + 41, 9) > 0.2 || p > 0.6 ? 1 : 0.5) * (0.5 + 0.5 * p))};
    }
    case 'pixel_dissolve_in': {
      if (frame >= span) return {...IDENTITY};
      const p = clamp01(frame / span);
      const level = Math.min(3, Math.floor(p * 4));
      return {...IDENTITY, opacity: [0.25, 0.5, 0.75, 1][level]!, maskCellPx: r3(96 - 90 * ease.out(p))};
    }
    case 'gooey_accent_pop': {
      if (frame >= span) return {...IDENTITY};
      const f = [0, span * 0.3, span * 0.6, span];
      const sx = interpolate(frame, f, [0.6, 1.18, 0.94, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.inOut});
      const sy = interpolate(frame, f, [1.3, 0.86, 1.06, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.inOut});
      return {...IDENTITY, scaleX: r3(sx), scaleY: r3(sy), rotateDeg: r3(-4 * (1 - t)), opacity: r3(0.45 + 0.55 * clamp01(t * 3)), blurPx: r3(5 * (1 - t))};
    }
    case 'blur_spin_settle': {
      if (frame >= span) return {...IDENTITY};
      const spin = interpolate(frame, [0, span], [14, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.outBack});
      return {...IDENTITY, rotateDeg: r3(spin), blurPx: r3(12 * (1 - t)), scaleX: r3(0.92 + 0.08 * t), scaleY: r3(0.92 + 0.08 * t), opacity: r3(0.4 + 0.6 * clamp01(t * 2.5))};
    }
    case 'logo_slam': {
      if (frame >= span) return {...IDENTITY};
      const f = [0, span * 0.4, span * 0.7, span];
      const k = (values: number[]) => interpolate(frame, f, values, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease.out});
      const scale = k([0.2, 1.18, 0.97, 1]);
      return {...IDENTITY, scaleX: r3(scale), scaleY: r3(scale), rotateDeg: r3(k([-8, 3, -1, 0])), blurPx: r3(6 * (1 - t)), opacity: r3(0.5 + 0.5 * clamp01(t * 3))};
    }
    case 'sticker_pop': {
      if (frame >= span) return {...IDENTITY};
      const s = springWith(frame, fps, 0, ELASTIC);
      const scale = 0.3 + 0.7 * s;
      return {...IDENTITY, scaleX: r3(scale), scaleY: r3(scale), rotateDeg: r3(10 * (1 - t) * Math.cos(t * Math.PI * 3)), opacity: r3(0.5 + 0.5 * clamp01(s * 2))};
    }
    case 'still_push_in': {
      const hold = Math.max(span, Math.round(durationInFrames * 0.6));
      const p = clamp01(frame / hold);
      const scale = frame >= hold ? 1 : 1 + 0.12 * (1 - ease.out(p));
      return {...IDENTITY, scaleX: r3(scale), scaleY: r3(scale), blurPx: r3(8 * (1 - t)), opacity: r3(0.5 + 0.5 * clamp01(t * 2))};
    }
    case 'card_tilt_in': {
      const s = clamp01(springWith(frame, fps, 0, {damping: 16, stiffness: 110, mass: 0.9}));
      const settled = frame >= span * 2 ? 1 : s;
      return {...IDENTITY, rotateYDeg: r3(16 * (1 - settled)), rotateXDeg: r3(10 * (1 - settled)), scaleX: r3(0.9 + 0.1 * settled), scaleY: r3(0.9 + 0.1 * settled), opacity: r3(0.5 + 0.5 * clamp01(s * 2))};
    }
    case 'orbit_drift': {
      const ramp = clamp01(frame / span);
      const sec = Math.max(0, frame) / fps;
      return {...IDENTITY, translateX: r3(7 * Math.sin(sec * 0.9) * ramp), translateY: r3(5 * Math.cos(sec * 0.7) * ramp), rotateDeg: r3(1.5 * Math.sin(sec * 0.6 + 1) * ramp), blurPx: r3(6 * (1 - ramp)), opacity: r3(0.4 + 0.6 * ramp)};
    }
    case 'type_trail':
    case 'scramble_settle':
      // glyph recipes: the wrapper only breathes in (a short rise); the glyph layer does the real work
      return {...IDENTITY, translateY: r3(14 * (1 - t)), opacity: r3(0.5 + 0.5 * t)};
  }
}

// ---- glyph recipes ----

const SCRAMBLE_SET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&';

/** Frames character `index` stays scrambled: 6 + 1.2 per character, capped so the line settles within the entrance. */
export function scrambleSettleFrame(index: number, total: number, durationInFrames: number): number {
  const span = entranceFrames(durationInFrames);
  return Math.min(span, Math.round(6 + 1.2 * index) * Math.min(1, span / Math.max(1, 6 + 1.2 * total)));
}

/** The text at `frame`: each non-space character is a hashed random glyph until its settle frame, then the real one. Deterministic. */
export function scrambleText(text: string, frame: number, durationInFrames: number): string {
  const chars = Array.from(text);
  return chars
    .map((ch, index) => {
      if (/\s/.test(ch)) return ch;
      if (frame >= scrambleSettleFrame(index, chars.length, durationInFrames)) return ch;
      return SCRAMBLE_SET[Math.floor(hash(index + 1, Math.floor(frame / 2)) * SCRAMBLE_SET.length)]!;
    })
    .join('');
}

export type GlyphTrail = {char: string; opacity: number; translateY: number; ghosts: Array<{offsetEm: number; opacity: number}>};

/** Per-character state of type_trail at `frame`: a character lands at index frames (1 per char), rising and fading in, with two ghosts behind it that fade as it lands. */
export function typeTrailGlyphs(text: string, frame: number, durationInFrames: number): GlyphTrail[] {
  const chars = Array.from(text);
  const stepFrames = Math.min(1, (entranceFrames(durationInFrames) - 6) / Math.max(1, chars.length));
  return chars.map((char, index) => {
    const start = index * Math.max(0.25, stepFrames);
    const p = clamp01((frame - start) / 6);
    const eased = ease.out(p);
    return {
      char,
      opacity: r3(eased),
      translateY: r3(18 * (1 - eased)),
      ghosts: [
        {offsetEm: -0.4, opacity: r3(0.35 * (1 - p) * (p > 0 ? 1 : 0))},
        {offsetEm: -0.8, opacity: r3(0.18 * (1 - p) * (p > 0 ? 1 : 0))},
      ],
    };
  });
}

/** counter_snap: the shown value at `frame` (spring from -> to, never past `to` by more than the overshoot, ends exactly on `to`). */
export function counterSnapValue(frame: number, fps: number, durationInFrames: number, from: number, to: number): number {
  const span = entranceFrames(durationInFrames);
  if (frame >= span) return to;
  return from + (to - from) * clamp01(springIn(frame, fps, 0, 'snappy'));
}

// ---- WP14D: kinetic type binding (per-unit text entrances and caption words) ----

/** Per-unit text entrance (a KineticText word / char / line): the recipe runs on a short local clock, 40 frames of "duration" = a 16-frame entrance. */
export const UNIT_RECIPE_DURATION_FRAMES = 40;

/** Only transform-driven recipes can drive a single text unit; glyph / number recipes (type_trail, scramble_settle, counter_snap) cannot. */
export function isUnitRecipe(id: string | undefined | null): id is MotionRecipeId {
  const recipe = getRecipe(id);
  return recipe !== null && recipe.driver === 'transform';
}

/**
 * The state of one text unit `localFrame` frames after its own start. Before the unit's start the unit is hidden (opacity 0) so staggered units appear one after another instead of all sitting at the
 * recipe's first frame. Returns the recipe state afterwards.
 */
export function unitRecipeState(id: MotionRecipeId, localFrame: number, fps: number): RecipeState {
  if (localFrame < 0) return {...IDENTITY, opacity: 0};
  return recipeState(id, localFrame, fps, UNIT_RECIPE_DURATION_FRAMES);
}

/** The caption word entrance settles within this many frames (0.33 s at 30 fps); the recipe is blended to identity over its last 40 %. */
export const CAPTION_WORD_SETTLE_FRAMES = 10;
const CAPTION_RECIPE_DURATION_FRAMES = 22;

/** Which recipe a caption animation uses: bounce -> stretch_squash_pop, scale / pop / type -> elastic_type_snap; highlight / karaoke / box / unknown -> none (their own timing stays). */
export function captionRecipeIdFor(animation: string | undefined | null, typedLook = false): MotionRecipeId | null {
  if (animation === 'bounce') return 'stretch_squash_pop';
  if (animation === 'scale' || animation === 'pop' || animation === 'type') return 'elastic_type_snap';
  // a short-form typed look (WP13C) has no neon fill or shine to tell the active word apart, so its active word takes the elastic snap
  if (typedLook && (animation === 'highlight' || animation === 'karaoke' || animation === undefined || animation === null)) return 'elastic_type_snap';
  return null;
}

const lerpNumber = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The entrance state of the ACTIVE caption word `sinceOnset` frames after its onset, or null for an animation with no recipe. The recipe is blended to identity over the last 40 % of
 * `CAPTION_WORD_SETTLE_FRAMES` and is exactly identity from then on, so a word never keeps moving while it is read. Deterministic; no random or clock.
 */
export function captionWordRecipeState(animation: string | undefined | null, sinceOnset: number, fps: number, typedLook = false): RecipeState | null {
  const id = captionRecipeIdFor(animation, typedLook);
  if (!id) return null;
  if (sinceOnset >= CAPTION_WORD_SETTLE_FRAMES) return {...IDENTITY};
  const raw = recipeState(id, Math.max(0, sinceOnset), fps, CAPTION_RECIPE_DURATION_FRAMES);
  const w = clamp01((sinceOnset - CAPTION_WORD_SETTLE_FRAMES * 0.6) / (CAPTION_WORD_SETTLE_FRAMES * 0.4));
  return {
    ...IDENTITY,
    opacity: r3(lerpNumber(raw.opacity, 1, w)),
    translateX: r3(lerpNumber(raw.translateX, 0, w)),
    translateY: r3(lerpNumber(raw.translateY, 0, w)),
    scaleX: r3(lerpNumber(raw.scaleX, 1, w)),
    scaleY: r3(lerpNumber(raw.scaleY, 1, w)),
    blurPx: r3(lerpNumber(raw.blurPx, 0, w)),
    rotateDeg: r3(lerpNumber(raw.rotateDeg, 0, w)),
  };
}

/** CSS for a unit / caption-word state (transform, blur, clip); opacity is returned separately so a caller can multiply it into its own. */
export function recipeStateCss(state: RecipeState): {transform: string; filter: string | undefined; clipPath: string | undefined; opacity: number} {
  return {
    transform: `translate(${state.translateX}px, ${state.translateY}px) rotate(${state.rotateDeg}deg) scale(${state.scaleX}, ${state.scaleY})`,
    filter: state.blurPx > 0 ? `blur(${state.blurPx}px)` : undefined,
    clipPath: state.clipPath,
    opacity: state.opacity,
  };
}

// ---- WP14F: vernacular exits + SFX peaks ----

export type RecipeExitMode = 'smear_blur_out' | 'scale_blur_out' | 'close_mask';

/** Pick a video-native exit that matches the entrance family (not a soft fade alone). */
export function exitModeForRecipe(id: MotionRecipeId): RecipeExitMode {
  const recipe = getRecipe(id);
  if (!recipe) return 'scale_blur_out';
  if (recipe.family === 'reveal_mask' || recipe.family === 'image_story') return 'close_mask';
  if (id === 'smear_blur_in' || id === 'glitch_text_reveal' || id === 'blur_spin_settle') return 'smear_blur_out';
  return 'scale_blur_out';
}

export function exitFrames(durationInFrames: number, requested?: number): number {
  const span = requested ?? 10;
  return Math.max(6, Math.min(14, Math.min(span, Math.floor(durationInFrames * 0.25))));
}

/**
 * Vernacular exit state over the last `exitLen` frames of the graphic. Before the exit window returns IDENTITY
 * (multiply opacity/scale in the host). Progress 0 at exit start → 1 at end. Soft fade alone is not enough: smear or scale+blur.
 */
export function recipeExitState(
  id: MotionRecipeId,
  frame: number,
  durationInFrames: number,
  exitLen?: number,
): RecipeState {
  const len = exitFrames(durationInFrames, exitLen);
  const start = durationInFrames - len;
  if (frame < start) return {...IDENTITY};
  const t = clamp01((frame - start) / Math.max(1, len));
  const p = ease.in(t);
  const mode = exitModeForRecipe(id);
  if (mode === 'smear_blur_out') {
    return {
      ...IDENTITY,
      translateX: r3(90 * p),
      scaleX: r3(1 + 0.35 * p),
      blurPx: r3(22 * p),
      opacity: r3(1 - p),
    };
  }
  if (mode === 'close_mask') {
    const inset = 44 * p;
    return {
      ...IDENTITY,
      clipPath: p >= 1 ? 'inset(50% 0% 50% 0%)' : `inset(${r3(inset)}% 0% ${r3(inset)}% 0%)`,
      scaleY: r3(1 + 0.04 * p),
      opacity: r3(1 - 0.85 * p),
      blurPx: r3(8 * p),
    };
  }
  // scale_blur_out
  return {
    ...IDENTITY,
    scaleX: r3(1 - 0.35 * p),
    scaleY: r3(1 - 0.35 * p),
    blurPx: r3(14 * p),
    opacity: r3(1 - p),
  };
}

export type RecipeSfxKind = 'whoosh' | 'hit' | 'pop';
export type RecipeSfxPeak = {frame: number; kind: RecipeSfxKind};

/**
 * Deterministic SFX peaks for a recipe entrance (frames relative to graphic start). Used by the polish SFX planner.
 * elastic/stretch/gooey → pop near settle; smear/glitch/spin → whoosh on start; split/pixel/nested → whoosh mid-open; counter → hit on snap.
 */
export function recipeSfxPeaks(id: MotionRecipeId, durationInFrames: number, fps: number): RecipeSfxPeak[] {
  const span = entranceFrames(durationInFrames);
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
