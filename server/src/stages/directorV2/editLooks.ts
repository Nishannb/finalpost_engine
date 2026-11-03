/**
 * WP8B: EDIT LOOKS. A small grammar the visual Director must work inside, so an edit reads as one coherent style instead of a random sprinkle of toolkits. PURE: no env, no logger, no I/O, no
 * model call. Only the element-kind list from `schemas.ts` is imported (every look's allowlist is a subset of it, pinned by a test).
 *
 * How it is used (opt-in, `polish` profile only; `cuts` has no visuals, `legacy` and `mvp` are unchanged):
 *   1. `stage2SchemaWithEditLook()` adds a required `edit_look` enum to the Stage-2 response schema and `editLookPromptBlock()` is appended to the Stage-2 user text, so the model picks EXACTLY ONE look.
 *   2. `resolveEditLook(raw)` turns the model's answer into a look. A missing or unknown id falls back to `minimal_captions` (the safest look) and says so.
 *   3. `enforceEditLook(...)` strips every element the chosen look does not allow, caps the designed graphics at `maxGraphics`, and drops matte-dependent elements when the look requires a usable
 *      matte and there is none. Nothing outside the look is kept silently: every drop is reported, and `editLookWarnings` turns the decision into job warnings.
 *
 * REFERENCE BEATS the looks are modelled on (design only; nothing was downloaded or rendered):
 *   Explainer-style: vertical reframe / zoom, kinetic captions, floating topic pills, an occasional fullscreen graphic cutaway.   -> `explainer_cutaway`
 *   BONOMI-style: subject cutout + text-behind, big kinetic type, selective grade, brand lockup, half-frame / depth moments.   -> `talking_head`
 * `custom_graphic` is NOT a live element kind (the Stage-2 schema has no such kind; `custom_scene` is also omitted until an interpreter exists). The looks therefore use the live stand-ins
 * kinetic_text / card / lockup / cutaway for "a designed graphic", and `maxGraphics` counts those. When a custom-graphic kind goes live it joins `graphicKinds` of the looks that want it.
 * Captions are not elements (they come from `caption_style`), so every look keeps captions; `captionBias` only states the look's preference.
 */
import {ELEMENT_KINDS, STAGE2_RESPONSE_SCHEMA} from './schemas.ts';

export type ElementKind = (typeof ELEMENT_KINDS)[number];

export type EditLook = {
  id: string;
  label: string;
  /** The only element kinds the Director may emit under this look. */
  allowedElementKinds: readonly ElementKind[];
  /** Element kinds that count as a "designed graphic" for `maxGraphics` (a subset of the allowed kinds). */
  graphicKinds: readonly ElementKind[];
  /** At most this many graphic-kind elements are kept (later ones, in word order, are dropped). */
  maxGraphics: number;
  /** The look prefers the subject cutout (text-behind, depth) when a matte is usable. */
  preferCutout: boolean;
  /** Cutout / depth_overlay (text-behind-subject) are kept only when the matte is usable. */
  requireMatteForTextBehind: boolean;
  captionBias: 'kinetic_big' | 'kinetic_pills' | 'kinetic_split' | 'clean';
  notes: string;
};

/** Kinds that place a subject cutout or put something behind the subject: they need a usable matte. */
export const MATTE_DEPENDENT_KINDS: readonly ElementKind[] = ['cutout', 'depth_overlay'];

export const FALLBACK_LOOK_ID = 'minimal_captions';

/** WP8P: the designed-graphic cap of the two looks a talking-head / explainer clip lands on (was 2: Gate 4 ended with 3 zooms + 1 overlay + 1 library graphic in 38 s). `minimal_captions` stays 0. */
export const POLISH_LOOK_MAX_GRAPHICS = 5;

export const EDIT_LOOKS: readonly EditLook[] = [
  {
    id: 'talking_head',
    label: 'Talking head, BONOMI-leaning',
    allowedElementKinds: ['hook_title', 'zoom', 'cutout', 'depth_overlay', 'kinetic_text', 'lockup', 'emphasis', 'transition'],
    graphicKinds: ['kinetic_text', 'lockup', 'depth_overlay'],
    maxGraphics: POLISH_LOOK_MAX_GRAPHICS,
    preferCutout: true,
    requireMatteForTextBehind: true,
    captionBias: 'kinetic_big',
    notes: 'Captions + punch-in zooms + subject cutout with text behind (only when the matte is usable) + big kinetic type + a brand lockup. At most 5 designed graphics (stand-ins for a custom graphic); WP8P raised the cap from 2 so a 40 s clip can carry one beat per ~7 s.',
  },
  {
    id: 'explainer_cutaway',
    label: 'Explainer with cutaways and topic pills',
    allowedElementKinds: ['hook_title', 'zoom', 'card', 'cutaway', 'media_container', 'counter', 'emphasis', 'transition'],
    graphicKinds: ['cutaway', 'media_container'],
    maxGraphics: POLISH_LOOK_MAX_GRAPHICS,
    preferCutout: false,
    requireMatteForTextBehind: false,
    captionBias: 'kinetic_pills',
    notes: 'Captions + vertical reframe zooms + floating topic cards / pills + an occasional fullscreen cutaway. At most 5 fullscreen graphics (cutaway / media container); cards and pills are NOT graphic-kind (WP52: bubble / scatter chips are NOT a polish toolkit; lists -> TopicPills or Layer-2 templates such as BlurWordCarousel, ChatConversationBubbles only for chat intent) and are never capped by this number.',
  },
  {
    id: 'split_story',
    label: 'Split-frame story',
    allowedElementKinds: ['hook_title', 'zoom', 'split', 'frame_inset', 'kinetic_text', 'emphasis', 'transition'],
    graphicKinds: ['split', 'frame_inset', 'kinetic_text'],
    maxGraphics: 3,
    preferCutout: false,
    requireMatteForTextBehind: false,
    captionBias: 'kinetic_split',
    notes: 'Captions + zooms + a split or framed inset beside the speaker + kinetic text. At most 3 designed graphics.',
  },
  {
    id: FALLBACK_LOOK_ID,
    label: 'Minimal captions (safe fallback)',
    allowedElementKinds: ['zoom'],
    graphicKinds: [],
    maxGraphics: 0,
    preferCutout: false,
    requireMatteForTextBehind: false,
    captionBias: 'clean',
    notes: 'Captions and light zoom only. Used when the model gives no look, an unknown look, or when a safe plan is wanted.',
  },
];

export const EDIT_LOOK_IDS = EDIT_LOOKS.map(look => look.id);

export type EditLookResolution = {look: EditLook; requested: string; fellBack: boolean};

/** The model's answer -> a look. Missing, empty or unknown -> `minimal_captions` with `fellBack: true`. Exact ids only (no fuzzy matching). */
export function resolveEditLook(raw: unknown): EditLookResolution {
  const requested = typeof raw === 'string' ? raw : '';
  const found = EDIT_LOOKS.find(look => look.id === requested);
  if (found) return {look: found, requested, fellBack: false};
  return {look: EDIT_LOOKS.find(look => look.id === FALLBACK_LOOK_ID)!, requested, fellBack: true};
}

/**
 * WP8S GENERIC LOOK BIAS (polish only). The Director picks the look from the full table. Only a SPARSE pick (`minimal_captions`, missing or unknown) is revisited, and only from content-profile
 * fields that mean the same thing in every niche: the profile says the piece can carry designed graphics (`density` is not `none`) and is not plain chat (`structure` is not `conversational`, or
 * `density` is `moderate` / `rich`). Then the denser look `explainer_cutaway` (captions + zooms + cards / pills + cutaways, no matte needed) replaces it, reported as `edit_look_bias:<from>-><to>`.
 * An explicit dense pick (`talking_head`, `split_story`, `explainer_cutaway`) is NEVER rewritten, and no content type, mood or clip is special-cased.
 */
export const DENSITY_BIAS_TARGET_LOOK_ID = 'explainer_cutaway';
export type LookBiasProfile = {contentType?: string; density?: string; structure?: string; mood?: string};

export function profileCarriesDesignedGraphics(profile: LookBiasProfile | undefined): boolean {
  if (!profile || !profile.density || profile.density === 'none') return false;
  if (profile.density === 'moderate' || profile.density === 'rich') return true;
  return profile.structure !== undefined && profile.structure !== 'conversational';
}

export function biasEditLook(resolution: EditLookResolution, profile: LookBiasProfile | undefined): {resolution: EditLookResolution; biasedFrom?: string} {
  if (resolution.look.id !== FALLBACK_LOOK_ID || !profileCarriesDesignedGraphics(profile)) return {resolution};
  const target = EDIT_LOOKS.find(look => look.id === DENSITY_BIAS_TARGET_LOOK_ID)!;
  return {resolution: {look: target, requested: resolution.requested, fellBack: false}, biasedFrom: resolution.requested || resolution.look.id};
}

/**
 * WP8W MATTE-FAIL REMAP (polish only). A look that is built on the subject matte (`preferCutout` + `requireMatteForTextBehind`: `talking_head`) has nothing to stand on when the matte is unusable: its
 * cutout / depth overlays are dropped and what is left is face text. In that case the edit is planned under `explainer_cutaway` (cards / pills / cutaways / fullscreen graphics, no matte needed),
 * reported as `edit_look_matte_fallback:<from>-><to>`. Decided from the look's own flags and the matte gate only: no content type, mood or clip. A usable matte, and every look that does not
 * depend on the matte, are never remapped; no matte is invented.
 */
export function remapLookForUnusableMatte(resolution: EditLookResolution, matteUsable: boolean): {resolution: EditLookResolution; matteFallbackFrom?: string} {
  const {look} = resolution;
  if (matteUsable || look.id === FALLBACK_LOOK_ID || !look.preferCutout || !look.requireMatteForTextBehind) return {resolution};
  const target = EDIT_LOOKS.find(entry => entry.id === DENSITY_BIAS_TARGET_LOOK_ID)!;
  return {resolution: {look: target, requested: resolution.requested, fellBack: false}, matteFallbackFrom: look.id};
}

export type LookElementRef = {id: string; kind: string; startSec?: number; wordIndex?: number};

export type EditLookDrop = {id: string; kind: string; reason: 'kind_not_in_look' | 'over_max_graphics' | 'matte_not_usable'};

export type EditLookDecision = {
  id: string;
  requested: string;
  fellBack: boolean;
  /** WP8P: the look the model picked before the density bias replaced it (absent when it did not). */
  biasedFrom?: string;
  /** WP8W: the matte-dependent look the model picked before an unusable matte moved the plan to `explainer_cutaway`. */
  matteFallbackFrom?: string;
  dropped: EditLookDrop[];
  /** WP8C: the matte gate the enforcement ran with (from lib/matteGate.ts). Absent when the caller gave none and the pack's flag was used. */
  matteUsable?: boolean;
};

/**
 * Keep only what the look allows. Input order is preserved for the kept elements; the graphic cap keeps the FIRST `maxGraphics` graphic elements in the given order (callers pass elements in
 * word order). `matteUsable` is whether the speaker matte can carry text-behind / depth (default false: unknown is not usable).
 */
export function enforceEditLook<T extends {id: string; kind: string}>(
  elements: readonly T[],
  look: EditLook,
  context: {matteUsable?: boolean} = {},
): {kept: T[]; dropped: EditLookDrop[]} {
  const allowed = new Set<string>(look.allowedElementKinds);
  const graphic = new Set<string>(look.graphicKinds);
  const matteDependent = new Set<string>(MATTE_DEPENDENT_KINDS);
  const kept: T[] = [];
  const dropped: EditLookDrop[] = [];
  let graphics = 0;
  for (const element of elements) {
    if (!allowed.has(element.kind)) {
      dropped.push({id: element.id, kind: element.kind, reason: 'kind_not_in_look'});
      continue;
    }
    if (look.requireMatteForTextBehind && matteDependent.has(element.kind) && !context.matteUsable) {
      dropped.push({id: element.id, kind: element.kind, reason: 'matte_not_usable'});
      continue;
    }
    if (graphic.has(element.kind)) {
      if (graphics >= look.maxGraphics) {
        dropped.push({id: element.id, kind: element.kind, reason: 'over_max_graphics'});
        continue;
      }
      graphics += 1;
    }
    kept.push(element);
  }
  return {kept, dropped};
}

/** Job warnings for a decision: always `edit_look:<id>`; `edit_look_fallback:minimal_captions` when it fell back; `edit_look_dropped:<n>` and one `edit_look_drop:<kind>:<reason>` per drop. */
export function editLookWarnings(decision: EditLookDecision): string[] {
  const warnings = [`edit_look:${decision.id}`];
  if (decision.biasedFrom !== undefined) warnings.push(`edit_look_bias:${decision.biasedFrom || 'none'}->${decision.id}`);
  if (decision.matteFallbackFrom !== undefined) warnings.push(`edit_look_matte_fallback:${decision.matteFallbackFrom}->${decision.id}`);
  if (decision.fellBack) warnings.push(`edit_look_fallback:${FALLBACK_LOOK_ID}`);
  if (decision.dropped.length > 0) {
    warnings.push(`edit_look_dropped:${decision.dropped.length}`);
    for (const drop of decision.dropped) warnings.push(`edit_look_drop:${drop.kind}:${drop.reason}`);
  }
  return warnings;
}

/**
 * WP8H: caption templates polish accepts when the caller did not choose one (`--captions=` / a template lock). Clean outline typography only: no neon / game-HUD look (`gaming-stream`), no boxed
 * pills. Anything else the Director or the rotation picked is replaced by `POLISH_DEFAULT_CAPTION_TEMPLATE`. An explicit caller template is never touched (the caller locks it later).
 */
export const POLISH_CAPTION_TEMPLATES: readonly string[] = ['karaoke', 'editorial-emphasis', 'weight-shift'];
export const POLISH_DEFAULT_CAPTION_TEMPLATE = 'karaoke';

export function polishCaptionTemplate(current: string | null | undefined): {template: string; replaced: boolean} {
  if (current && POLISH_CAPTION_TEMPLATES.includes(current)) return {template: current, replaced: false};
  return {template: POLISH_DEFAULT_CAPTION_TEMPLATE, replaced: true};
}

/** WP8G: the warnings for a polish run whose Director v2 produced no plan at all (a fallback direction): the minimal look, said out loud. */
export function editLookFallbackWarnings(): string[] {
  return editLookWarnings({id: FALLBACK_LOOK_ID, requested: '', fellBack: true, dropped: []});
}

/** The Stage-2 response schema with a required top-level `edit_look` enum (a clone: the base schema, used by every other profile, is untouched). */
export function stage2SchemaWithEditLook(): typeof STAGE2_RESPONSE_SCHEMA {
  const schema = structuredClone(STAGE2_RESPONSE_SCHEMA) as typeof STAGE2_RESPONSE_SCHEMA & {properties: Record<string, unknown>; required: string[]};
  schema.properties = {edit_look: {type: 'STRING', enum: [...EDIT_LOOK_IDS]}, ...schema.properties};
  schema.required = ['edit_look', ...schema.required];
  return schema;
}

/** The text appended to the Stage-2 user message when looks are on. */
export function editLookPromptBlock(forcedLookId?: string): string {
  const lines = EDIT_LOOKS.map(look => `- ${look.id} (${look.label}): kinds ${look.allowedElementKinds.join(', ')}; at most ${look.maxGraphics} designed graphics (${look.graphicKinds.join(', ') || 'none'}); ${look.notes}`);
  const copyRule = 'COPY RULE: every word of the hook title and of every lockup, kinetic text, card, bubble, counter and emphasis text must be a word the speaker actually says in that span (their own words, in order). Text with any other word (a slogan, a paraphrase, an added claim) is removed from the edit.';
  const head = forcedLookId
    ? `EDIT LOOK (fixed for this edit): "${forcedLookId}". Keep edit_look = "${forcedLookId}" and emit only the element kinds that look allows.`
    : 'EDIT LOOK (required): pick EXACTLY ONE look id for the whole edit and put it in edit_look. Every element you emit must use a kind that look allows and the number of designed graphics must not exceed its maximum; anything else is dropped. Prefer explainer_cutaway or talking_head for a talk with a point to make; pick minimal_captions only for content that must stay plain.';
  const density = `BEAT RATE: aim for one intentional visual beat (a zoom, kinetic text, lockup, card or emphasis) every 6-8 seconds of the finished cut, spread across the clip, not clustered. Any lean toolkit you leave out is filled by the engine from the speaker's own words (kinetic text, lockup, card, emphasis, punch-in zooms), so omit a toolkit only when it would not suit the content.`;
  return `${head}\n${lines.join('\n')}\n${density}\n${copyRule}`;
}
