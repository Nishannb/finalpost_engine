/**
 * WP31: the ONE switch that turns glossy-pill karaoke off on the polish profile. PURE (no env, no I/O).
 *
 * Where the pill came from (traced, not guessed):
 *   1. `shineCaptionDirection()` / the Director default is `template: 'karaoke'` + `animation: 'highlight'`. In `KineticCaptions`, `highlight` with no typed treatment (`!typed`) paints the ACTIVE word on a
 *      near-black rounded plate with a neon border, a two-layer bloom and a white sheen sweep: the glossy pill ("HOURS", "THE", "WRONG." in WP28).
 *   2. WP13C already had the cure (the look's `LOOK_CAPTION_TYPE`: ink fill + heavy dark stroke + soft shadow, no glow, no plate), but analyze only applied it when
 *      `polishPath && motion && !captionTemplate && no creator B-roll`. WP28 had labeled assets (creator B-roll), so the gate was false and the pill shipped.
 *   3. Templates with a fill (`box`, `subtitle`, `basic`, `grape`, `soft-ai`), the utility `moving-pill` renderer and the `grape-theme` / `soft-ai-theme` package themes draw their own rounded plate, and
 *      `KineticCaptions` falls back to the template's own `backgroundColor` even when the direction says `boxColor: null`, so they cannot be fixed by colours alone.
 *
 * The switch: on polish, `polishBareCaption` (wired once, unconditionally, in analyzeVideo) (a) swaps any plate-style template for `karaoke`, (b) clears the box colour, and (c) writes the look's type contract
 * onto the direction, so `KineticCaptions` takes its typed path (bare stroked type + soft shadow) instead of the shine plate. Non-polish profiles never call it; the env kill switch
 * `POLISH_BARE_CAPTIONS=0` restores the old behaviour on polish too.
 */
import type {CaptionDirection, CaptionTemplateId} from '../types/blueprint.ts';
import {LOOK_CAPTION_TYPE, type ShortFormLookId} from './shortFormLook.ts';

/** Templates that draw a rounded plate / chip / pill behind the words (own fill, `box` animation, or a dedicated pill renderer). Never the polish default. */
export const PILL_CHROME_TEMPLATES: ReadonlySet<CaptionTemplateId> = new Set<CaptionTemplateId>([
  'moving-pill',
  'box',
  'subtitle',
  'basic',
  'grape',
  'grape-theme',
  'soft-ai',
  'soft-ai-theme',
]);

/** The bare video-type template polish falls back to: white grotesque, stroked, no fill, centered by the Director's position. */
export const POLISH_BARE_TEMPLATE: CaptionTemplateId = 'karaoke';

/**
 * WP32: chest-band weight. WP31 made the type bare but left it at the template's size (~93 px on a 1080 canvas, three words a line), which reads as a subtitle next to the Metromedia ref's mid-frame words
 * ("This founder", "billion"). ONE path scales it: the caption direction. `fontScale` 1.4 is the largest scale the caption-split legibility band is built for (remotion/src/lib/captionSplit.ts: 100 px at 1.4), so it
 * never overflows that band; `maxWords` 2 means fewer, bigger words on screen. Both are look-independent tokens; the look's stroke / ink contract is unchanged (no neon, no pills).
 */
export const POLISH_BARE_FONT_SCALE = 1.4;
export const POLISH_BARE_MAX_WORDS = 2;

export type PolishBareCaptionResult = {caption: CaptionDirection; warnings: string[]};

/** True when this direction would paint glossy pill chrome in the renderer (shine plate, own-fill template, pill renderer, or a box colour). */
export function isGlossyPillCaption(caption: Pick<CaptionDirection, 'template' | 'animation' | 'boxColor' | 'activeStyle'>): boolean {
  if (PILL_CHROME_TEMPLATES.has(caption.template)) return true;
  if (caption.boxColor) return true;
  // `highlight` without a typed treatment is the neon-bordered shine plate (KineticCaptions: `useShine = animation === 'highlight' && !typed`).
  if (caption.animation === 'highlight' && !caption.activeStyle) return true;
  if (caption.template === 'gaming-stream' && !caption.activeStyle) return true; // its own template animation is `highlight`
  return false;
}

/**
 * Make a polish caption direction bare. `templateLocked` = the caller named a template explicitly: a plate-style one is still replaced (polish never ships the pill), any other explicit template is kept,
 * and its type treatment is only touched where it would otherwise draw the shine plate. Idempotent. Returns the input object untouched (no warnings) when it is already bare.
 */
export function polishBareCaption(
  caption: CaptionDirection,
  options: {lookId: ShortFormLookId; templateLocked: boolean},
): PolishBareCaptionResult {
  const warnings: string[] = [];
  const pillTemplate = PILL_CHROME_TEMPLATES.has(caption.template);
  const needsType = !caption.activeStyle && (!options.templateLocked || isGlossyPillCaption(caption));
  // WP32: chest-band size applies wherever polish owns the type: no caller template, or a plate template that is being replaced. An explicit non-pill caller template keeps its own size.
  const sizes = !options.templateLocked || pillTemplate;
  const needsSize = sizes && ((caption.fontScale ?? 1) < POLISH_BARE_FONT_SCALE || (caption.maxWords ?? Infinity) > POLISH_BARE_MAX_WORDS);
  if (!pillTemplate && !needsType && !caption.boxColor && !needsSize) return {caption, warnings};

  let next: CaptionDirection = {...caption};
  if (pillTemplate) {
    warnings.push(`polish_caption_pill_replaced:${caption.template}`);
    next = {...next, template: POLISH_BARE_TEMPLATE, uppercase: false};
  }
  if (next.boxColor) next = {...next, boxColor: null};
  if (next.animation === 'highlight' || next.animation === 'box' || pillTemplate) next = {...next, animation: 'scale'};
  if (!next.activeStyle) {
    const type = LOOK_CAPTION_TYPE[options.lookId];
    next = {
      ...next,
      textColor: type.textColor,
      highlightColor: type.highlightColor,
      strokeColor: type.strokeColor,
      strokeWidthEm: type.strokeWidthEm,
      glow: type.glow,
      activeStyle: type.activeStyle,
      ...(type.activeInk ? {activeInk: type.activeInk} : {}),
    };
    warnings.push(`look:caption_type:${options.lookId}`);
  }
  if (needsSize) {
    next = {...next, fontScale: Math.max(caption.fontScale ?? 1, POLISH_BARE_FONT_SCALE), maxWords: Math.min(caption.maxWords ?? POLISH_BARE_MAX_WORDS, POLISH_BARE_MAX_WORDS)};
    warnings.push(`polish_caption_scale:${next.fontScale}:${next.maxWords}`);
  }
  warnings.push(`polish_caption_bare:${options.lookId}`);
  return {caption: next, warnings};
}
