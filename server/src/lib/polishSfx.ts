/**
 * WP12D: schedule local SFX hits for polish explain edits (whoosh / hit / pop only).
 * No music beds — those need a stock library and stay unset (musicMood omitted).
 * WP14F: when a graphic carries `recipeId`, also emit peaks from `recipeSfxPeaks` (entrance settle / smear start).
 * Pure: no I/O, no env.
 */

import {isMotionRecipeId, recipeSfxPeaks} from './motionRecipes.ts';

export type SfxHitKind = 'whoosh' | 'hit' | 'pop';

export type PolishSfxHit = {
  at: number;
  kind: SfxHitKind;
  volume?: number;
  reason?: string;
};

export type PolishSfxGraphic = {
  start: number;
  end: number;
  placementMode: 'full_screen' | 'split_screen' | 'overlay' | 'pip' | string;
  /** WP14F: motion recipe id on the plate; peaks fire relative to graphic start. */
  recipeId?: string;
  /** Timeline fps for frame→sec (default 30). */
  fps?: number;
};

export type PolishSfxTransition = {
  at: number;
  keyword: string;
};

export type PolishSfxFramed = {
  start: number;
};

/** Minimum gap between scheduled hits. */
export const SFX_MIN_SPACING_SEC = 0.8;
/** Voice-first: no hit within this long after a word onset, so a hit never covers the start of a word. Same constant as music/mergeHits.ts. */
export const SFX_WORD_MASK_SEC = 0.12;
/** Hard cap per edit. */
export const SFX_MAX_HITS = 8;

/** WP16: whips (any direction), flashes, dips, dissolves and glitches whoosh; a smash zoom and a hard cut land as a hit. */
const WHIP_OR_FLASH = /whip|flash|swish|glitch|dip\s*colou?r|blur\s*dissolve|smash\s*zoom/i;
const HIT_TRANSITION = /hard\s*cut|smash\s*zoom/i;

/**
 * Build capped, spaced SFX hits from leave-the-face graphics, procedural transitions, and framed windows.
 * Existing hits are kept and merged (deduped by time+kind); musicMood is never set here.
 */
export function schedulePolishSfxHits(input: {
  graphics?: readonly PolishSfxGraphic[];
  transitions?: readonly PolishSfxTransition[];
  framedWindows?: readonly PolishSfxFramed[];
  existing?: readonly PolishSfxHit[];
  maxHits?: number;
  minSpacingSec?: number;
  /**
   * Output-timeline word onsets. When given, a hit that would land within SFX_WORD_MASK_SEC after one is dropped here, before the cap and spacing,
   * so the next candidate can take its place. Applied at scheduling time only: a saved blueprint keeps its stored hits. Absent → no mask (old behaviour).
   */
  wordOnsetsSec?: readonly number[];
}): {hits: PolishSfxHit[]; added: number; maskedByWord: number} {
  const maxHits = input.maxHits ?? SFX_MAX_HITS;
  const minSpacing = input.minSpacingSec ?? SFX_MIN_SPACING_SEC;
  const proposed: PolishSfxHit[] = [];

  for (const graphic of input.graphics ?? []) {
    if (!(graphic.end > graphic.start)) continue;
    const mode = graphic.placementMode;
    if (mode === 'full_screen' || mode === 'split_screen') {
      proposed.push({
        at: round(graphic.start),
        kind: mode === 'full_screen' ? 'hit' : 'pop',
        volume: mode === 'full_screen' ? 0.14 : 0.1,
        reason: `graphic_${mode}`,
      });
    }
    // WP14F: vernacular recipe peaks (whoosh on smear/mask open, pop on elastic settle, hit on counter).
    if (graphic.recipeId && isMotionRecipeId(graphic.recipeId)) {
      const fps = graphic.fps && graphic.fps > 0 ? graphic.fps : 30;
      const durationInFrames = Math.max(1, Math.round((graphic.end - graphic.start) * fps));
      for (const peak of recipeSfxPeaks(graphic.recipeId, durationInFrames, fps)) {
        proposed.push({
          at: round(graphic.start + peak.frame / fps),
          kind: peak.kind,
          volume: peak.kind === 'whoosh' ? 0.1 : peak.kind === 'hit' ? 0.12 : 0.09,
          reason: `recipe_${graphic.recipeId}_${peak.kind}`,
        });
      }
    }
  }

  for (const transition of input.transitions ?? []) {
    if (!Number.isFinite(transition.at)) continue;
    const keyword = transition.keyword ?? '';
    if (WHIP_OR_FLASH.test(keyword) || HIT_TRANSITION.test(keyword)) {
      proposed.push({
        at: round(transition.at),
        kind: HIT_TRANSITION.test(keyword) ? 'hit' : 'whoosh',
        volume: 0.12,
        reason: `transition_${keyword.slice(0, 24)}`,
      });
    }
  }

  for (const framed of input.framedWindows ?? []) {
    if (!Number.isFinite(framed.start)) continue;
    proposed.push({
      at: round(framed.start),
      kind: 'pop',
      volume: 0.08,
      reason: 'framed_window',
    });
  }

  const onsets = (input.wordOnsetsSec ?? []).filter(Number.isFinite);
  const covers = (at: number) => onsets.some(onset => at > onset + 1e-6 && at <= onset + SFX_WORD_MASK_SEC + 1e-6);
  const valid = [...(input.existing ?? []), ...proposed].filter(hit => Number.isFinite(hit.at) && hit.at >= 0);
  const maskedByWord = valid.filter(hit => covers(hit.at)).length;
  const merged = valid
    .filter(hit => !covers(hit.at))
    .sort((a, b) => a.at - b.at || kindRank(a.kind) - kindRank(b.kind));

  const hits: PolishSfxHit[] = [];
  for (const hit of merged) {
    if (hits.length >= maxHits) break;
    const prior = hits[hits.length - 1];
    if (prior && hit.at - prior.at < minSpacing) continue;
    hits.push({
      at: hit.at,
      kind: hit.kind,
      ...(hit.volume !== undefined ? {volume: hit.volume} : {}),
      ...(hit.reason ? {reason: hit.reason} : {}),
    });
  }

  const existingKeys = new Set((input.existing ?? []).map(hit => `${hit.at}:${hit.kind}`));
  const added = hits.filter(hit => !existingKeys.has(`${hit.at}:${hit.kind}`)).length;
  return {hits, added, maskedByWord};
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const kindRank = (kind: SfxHitKind) => (kind === 'whoosh' ? 0 : kind === 'hit' ? 1 : 2);
