/**
 * WP54 Phase A (pure, no env, no IO): global motion craft standards distilled from iart-ai/motion-design-skills (MIT, documentation recipes — nothing vendored). NOT a toolkit and NOT an L1 skill: it is
 * (1) a short appendix for the polish Director prompt, (2) timing helpers the L2 template comps / planners read, (3) a restraint budget ("<= N full-screen GFX per minute") the planners share.
 * Easing strings are CSS cubic-béziers; `remotionEasing` names the matching `Easing.bezier(...)` for comps (4 numbers, same curve).
 */

export type CraftEasingToken = {
  /** CSS cubic-bezier string (docs / Director prompt). */
  css: string;
  /** The same curve as four numbers for Remotion `Easing.bezier(a, b, c, d)`. */
  bezier: readonly [number, number, number, number];
  /** Remotion note: how a comp should use it. */
  remotionEasing: string;
};

export const CRAFT_EASING = {
  /** Entrances: fast start, soft landing. */
  enterEaseOut: {css: 'cubic-bezier(0.16, 1, 0.3, 1)', bezier: [0.16, 1, 0.3, 1], remotionEasing: 'Easing.bezier(0.16, 1, 0.3, 1) on interpolate(frame, [in, in+dur], [0, 1])'},
  /** Exits: slow start, accelerate away (leaves faster than it arrived). */
  exitEaseIn: {css: 'cubic-bezier(0.7, 0, 0.84, 0)', bezier: [0.7, 0, 0.84, 0], remotionEasing: 'Easing.bezier(0.7, 0, 0.84, 0); exits run ~70% of the enter duration'},
  /** On-screen moves between two resting states. */
  moveInOut: {css: 'cubic-bezier(0.65, 0, 0.35, 1)', bezier: [0.65, 0, 0.35, 1], remotionEasing: 'Easing.bezier(0.65, 0, 0.35, 1) for position / scale between holds'},
  /** One accent per beat at most (a price tag, a sticker). Never on type that has to be read. */
  playfulOvershoot: {css: 'cubic-bezier(0.34, 1.56, 0.64, 1)', bezier: [0.34, 1.56, 0.64, 1], remotionEasing: 'Easing.bezier(0.34, 1.56, 0.64, 1) (or spring({damping: 12})) — sparingly, one element per beat'},
} as const satisfies Record<string, CraftEasingToken>;

export type CraftEasingName = keyof typeof CRAFT_EASING;

/** Duration bands by visual weight (seconds). */
export const CRAFT_DURATION_BANDS = {
  micro: {minSec: 0.1, maxSec: 0.2, use: 'hover / tick / caret / small state change'},
  ui: {minSec: 0.2, maxSec: 0.4, use: 'cards, chips, wipes, per-word reveals'},
  hero: {minSec: 0.4, maxSec: 0.8, use: 'the one element the beat is about (headline, number, device frame)'},
  cinematic: {minSec: 0.8, maxSec: 1.6, use: 'establishing push, mesh ground drift, logo settle — never on a spoken emphasis word'},
} as const;

export type CraftDurationBand = keyof typeof CRAFT_DURATION_BANDS;

export function clampToBand(band: CraftDurationBand, sec: number): number {
  const {minSec, maxSec} = CRAFT_DURATION_BANDS[band];
  return Math.min(maxSec, Math.max(minSec, sec));
}

/** Stagger between siblings: 20–80 ms; the whole group finishes revealing within ~800 ms. */
export const CRAFT_STAGGER = {minSec: 0.02, maxSec: 0.08, groupCapSec: 0.8} as const;

/** Per-item stagger for a group of `count` items: as wide as allowed, but the group never exceeds the cap. */
export function staggerStepSec(count: number): number {
  if (count <= 1) return 0;
  const fitted = CRAFT_STAGGER.groupCapSec / (count - 1);
  return Math.min(CRAFT_STAGGER.maxSec, Math.max(CRAFT_STAGGER.minSec, fitted));
}

/** Delay (s) of item `index` in a staggered group of `count`. */
export function staggerDelaySec(index: number, count: number): number {
  return Math.max(0, index) * staggerStepSec(count);
}

/** 1/3 simultaneity rule: at most a third of a group's elements animate at the same instant (the rest hold). */
export function maxSimultaneous(elementCount: number): number {
  return Math.max(1, Math.floor(elementCount / 3));
}

export function obeysSimultaneity(elementCount: number, movingNow: number): boolean {
  return movingNow <= maxSimultaneous(elementCount);
}

/** Restraint: a talking head must not turn into constant motion. Full-screen graphics per minute of output. */
export const CRAFT_MAX_FULLSCREEN_GFX_PER_MINUTE = 4;
/** Every ambient layer is capped separately (mesh ground / logo reveal ≤ 1 per edit; kinetic type ≤ 2; riso ≤ 2). */
export const CRAFT_AMBIENT_CAPS = {meshGround: 1, logoReveal: 1, kineticType: 2, riso: 2, productTemplates: 2} as const;

/** The number of full-screen graphics an edit of this length may carry in total (>= 1 for anything over 8 s, so short clips can still get their one beat). */
export function maxFullscreenGfx(durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  const budget = Math.floor((durationSec / 60) * CRAFT_MAX_FULLSCREEN_GFX_PER_MINUTE);
  return durationSec >= 8 ? Math.max(1, budget) : 0;
}

/** True when adding one more full-screen graphic keeps the edit within the budget. */
export function fullscreenBudgetAllows(durationSec: number, existingFullscreenCount: number): boolean {
  return existingFullscreenCount < maxFullscreenGfx(durationSec);
}

/**
 * Safe area: captions live in the lower band (`bottomFrac` of the frame, ~0.22–0.30 on polish); platform chrome owns the top ~8% and the right-hand rail. Type that must be read stays above the caption band
 * unless the beat mutes the captions (a frame-owning template). Ambient layers (mesh ground) never mute captions and never carry text.
 */
export const CRAFT_SAFE_AREA = {topFrac: 0.08, captionBandFrac: 0.28, sideFrac: 0.06} as const;

export const CRAFT_SAFE_AREA_NOTE =
  'Safe area: keep read-able type out of the caption band (bottom ~28%) and platform chrome (top ~8%, sides ~6%) unless the beat owns the frame and mutes the captions.';

/** The short Director appendix (injected once on the polish path; `polish_craft:standards:on`). */
export function formatCraftStandardsForDirector(): string {
  return [
    'MOTION CRAFT STANDARDS (apply to every designed graphic; do not add motion for its own sake):',
    `- Easing: enter = ease-out ${CRAFT_EASING.enterEaseOut.css}; exit = ease-in ${CRAFT_EASING.exitEaseIn.css} (shorter than the enter); moves between holds = ${CRAFT_EASING.moveInOut.css}; overshoot ${CRAFT_EASING.playfulOvershoot.css} on ONE accent per beat, never on read-able type.`,
    `- Duration by weight: micro ${CRAFT_DURATION_BANDS.micro.minSec}-${CRAFT_DURATION_BANDS.micro.maxSec}s, ui ${CRAFT_DURATION_BANDS.ui.minSec}-${CRAFT_DURATION_BANDS.ui.maxSec}s, hero ${CRAFT_DURATION_BANDS.hero.minSec}-${CRAFT_DURATION_BANDS.hero.maxSec}s, cinematic ${CRAFT_DURATION_BANDS.cinematic.minSec}-${CRAFT_DURATION_BANDS.cinematic.maxSec}s.`,
    `- Stagger siblings ${CRAFT_STAGGER.minSec * 1000}-${CRAFT_STAGGER.maxSec * 1000}ms; a group finishes revealing within ${CRAFT_STAGGER.groupCapSec * 1000}ms; at most 1/3 of the elements move at once.`,
    `- Restraint: at most ${CRAFT_MAX_FULLSCREEN_GFX_PER_MINUTE} full-screen graphics per minute; mesh ground / logo reveal at most 1 per edit; kinetic type at most 2; one idea per beat; no stacking a type beat on a number another beat already shows.`,
    `- ${CRAFT_SAFE_AREA_NOTE}`,
    '- Pick the tool the sentence needs: a spoken number -> counter / stat; a comparison -> compare / versus; one emphatic phrase -> kinetic type; product UI only when a screenshot exists; a price only when it is spoken. Never invent figures or copy.',
  ].join('\n');
}
