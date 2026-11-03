/**
 * WP34: the polish caption direction for the Metromedia ACCUMULATE grammar (word_by_word_accumulate). PURE (no env, no I/O).
 *
 * The WP33 planner's caption groups (1-3 words) and cuts decide where a line ends: the direction carries `cutTimes` (every cut + every group start, output seconds), and the renderer
 * (remotion `AccumulateCaptions`) builds each line word by word, never lets a line straddle a cut, and hard-clears on the first cut after it started. `maxWords` is the grammar's 4.
 * Type is white sentence case at 7 % of the composition height, centred at y 46 % (band 42-50 %), soft shadow, no pill / box / glow / stroke. Only figures and the CTA keyword are caps (`capsWords`).
 *
 * Applied only on polish, AFTER `polishBareCaption`, and never over a CaptionKit preset, a designed caption style guide or a caller-named template (those keep their own look). Non-polish profiles never call it.
 * Idempotent. Kill switch: `POLISH_ACCUMULATE_CAPTIONS=0`.
 */
import type {CaptionDirection} from '../types/blueprint.ts';
import {ctaWindowsOf, type VoCutPlan, type VoWord} from '../stages/broll/voCutGrammar.ts';

export const ACCUMULATE_CAPTION_MODE = 'word_by_word_accumulate' as const;
export const ACCUMULATE_MAX_WORDS = 4;
export const ACCUMULATE_SIZE_PCT_FRAME_H = 7;
export const ACCUMULATE_CENTER_Y_FRAC = 0.46;
export const ACCUMULATE_Y_BAND = {min: 0.42, max: 0.5} as const;

const round = (value: number) => Math.round(value * 1000) / 1000;
const normWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const CTA_KEYWORD = /^(follow|subscribe)$/;

/** The renderer's cut list: every planned cut plus every caption-group start (sorted, de-duplicated at 1 ms). */
export function accumulateCutTimes(plan: Pick<VoCutPlan, 'cuts' | 'groups'>): number[] {
  const times = new Set<number>();
  for (const cut of plan.cuts) if (Number.isFinite(cut) && cut > 0) times.add(round(cut));
  for (const group of plan.groups) if (Number.isFinite(group.start) && group.start > 0) times.add(round(group.start));
  return [...times].sort((a, b) => a - b);
}

/** The CTA keyword (follow / subscribe, in the closing words only) is the one word besides figures that may be caps. */
export function accumulateCapsWords(words: readonly VoWord[], durationSec: number): string[] {
  const window = ctaWindowsOf(words, durationSec)[0];
  if (!window) return [];
  const hit = words.find(word => word.start >= window.start - 1e-6 && CTA_KEYWORD.test(normWord(word.text)));
  return hit ? [normWord(hit.text)] : [];
}

export type PolishAccumulateResult = {caption: CaptionDirection; warnings: string[]};

/** Write the accumulate grammar onto a polish caption direction. Returns the input untouched (no warnings) when there is nothing to key the cuts to. */
export function polishAccumulateCaptions(
  caption: CaptionDirection,
  options: {plan: Pick<VoCutPlan, 'cuts' | 'groups'>; words: readonly VoWord[]; durationSec: number},
): PolishAccumulateResult {
  const cutTimes = accumulateCutTimes(options.plan);
  if (cutTimes.length === 0) return {caption, warnings: ['polish_accumulate:no_cuts_skipped']};
  const capsWords = accumulateCapsWords(options.words, options.durationSec);
  const next: CaptionDirection = {
    ...caption,
    mode: ACCUMULATE_CAPTION_MODE,
    cutTimes,
    maxWords: ACCUMULATE_MAX_WORDS,
    sizePctFrameH: ACCUMULATE_SIZE_PCT_FRAME_H,
    centerYFrac: ACCUMULATE_CENTER_Y_FRAC,
    ...(capsWords.length > 0 ? {capsWords} : {}),
    // no pill, no box, no glow, no case change: the renderer draws white type with a soft shadow only
    boxColor: null,
    glow: false,
    uppercase: false,
    fontScale: 1,
  };
  return {caption: next, warnings: [`polish_accumulate:${ACCUMULATE_CAPTION_MODE}:${cutTimes.length}`]};
}
