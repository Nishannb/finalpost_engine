/**
 * WP34: WORD-BY-WORD ACCUMULATE CAPTIONS (Metromedia grammar, editref.md / metromedia-grammar.yaml `captions`). PURE math, no React, no imports: the renderer (`AccumulateCaptions`), the server
 * (`polishAccumulateCaptions`) and the offline tests all read the same numbers.
 *
 *   mode: word_by_word_accumulate      a line is BUILT in spoken order ("This" -> "This founder" -> "This founder got fired"); earlier words stay until the line clears
 *   max_words_per_line: 4              (the VO cut grammar's groups are 1-3 words, so most lines are shorter)
 *   word_in: blur_fade                 blur 12 px -> 0, opacity 0 -> 1, 4 frames, a slight scale-up (0.96 -> 1) that NEVER overshoots (no bounce, no spring)
 *   line_out: hard_clear_on_next_cut   the whole line disappears on the cut that starts the next group (no fade)
 *   size_pct_frame_h: 7                understated, NOT MrBeast-big: font size = 7 % of the COMPOSITION height
 *   position: center, y 42-50 %        of the composition height (default 46 %)
 *   case: sentence                     caps only for figures ("$6 BILLION") and a flagged CTA keyword
 *   color #FFFFFF, soft shadow blur 8 / opacity 0.35, no pill, no stroke, no colour keyword highlight
 */

export const ACCUMULATE_MODE = 'word_by_word_accumulate' as const;

export const ACCUMULATE = {
  maxWordsPerLine: 4,
  sizePctFrameH: 7,
  /** Allowed vertical centre of the line, as a fraction of the composition height (grammar y_pct [42, 50]). */
  yFracMin: 0.42,
  yFracMax: 0.5,
  yFracDefault: 0.46,
  wordInFrames: 4,
  blurFromPx: 12,
  scaleFrom: 0.96,
  color: '#FFFFFF',
  shadowBlurPx: 8,
  shadowOpacity: 0.35,
  /** Inter has 400 / 700 / 800 loaded (styles/fontRequests.ts); 700 is the closest face to the grammar's SemiBold. */
  fontWeight: 700,
  /** How long the last word of a line stays after it is spoken when no cut comes first. */
  holdAfterSec: 0.25,
  /** A pause longer than this starts a new line even without a cut. */
  maxGapSec: 0.55,
  /** Tolerance when matching a cut time (planner rounds to 1 ms) to a word onset. */
  cutToleranceSec: 0.002,
  /** The widest container the line may use (fraction of the composition width); the rail-clear cap, when on, is applied by the renderer. */
  maxWidthFrac: 0.88,
  /** Average advance of a bold Latin glyph in em, for the one-word fit guard (a heuristic, deliberately on the wide side). */
  glyphEm: 0.62,
  minFitScale: 0.6,
} as const;

export type AccumulateWord = {text: string; start: number; end: number; sentenceIndex?: number};
export type AccumulateLine = {
  words: AccumulateWord[];
  /** Onset of the first word. */
  start: number;
  /** Time the whole line is hard-cleared (exclusive): the next cut / next line, or `holdAfterSec` after the last word. */
  clearAt: number;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Font size in px: `pct` % (default 7) of the composition HEIGHT. */
export function accumulateFontPx(frameHeight: number, pct: number = ACCUMULATE.sizePctFrameH): number {
  return Math.round(Math.max(0, frameHeight) * (Number.isFinite(pct) ? pct : ACCUMULATE.sizePctFrameH) / 100);
}

/** The line's vertical centre as a fraction of the height, always inside the grammar band [0.42, 0.50]. */
export function accumulateCenterYFrac(requested?: number): number {
  return clamp(Number.isFinite(requested) ? (requested as number) : ACCUMULATE.yFracDefault, ACCUMULATE.yFracMin, ACCUMULATE.yFracMax);
}

/**
 * WP38: the TALKING-HEAD (face-safe) band. On classic talking-head polish the face sits around the frame centre, so the accumulate line drops to ~55-60 % (chest / lower third) instead of the faceless 42-50 %
 * band. Opt-in per direction via `faceSafeYFrac`; absent = the WP34 band, exactly as before.
 */
export const ACCUMULATE_FACE_SAFE = {yFracMin: 0.55, yFracMax: 0.6, yFracDefault: 0.58} as const;

/** The face-safe line centre as a fraction of the height, always inside [0.55, 0.60]. */
export function accumulateFaceSafeYFrac(requested?: number): number {
  return clamp(Number.isFinite(requested) ? (requested as number) : ACCUMULATE_FACE_SAFE.yFracDefault, ACCUMULATE_FACE_SAFE.yFracMin, ACCUMULATE_FACE_SAFE.yFracMax);
}

/** Extra px (added to the WP34 position) that moves the line from its WP34 centre to the face-safe centre. 0 when the direction has no `faceSafeYFrac`. */
export function accumulateFaceSafeShiftPx(frameHeight: number, direction?: {centerYFrac?: number; faceSafeYFrac?: number}): number {
  if (!direction || direction.faceSafeYFrac === undefined || !Number.isFinite(direction.faceSafeYFrac)) return 0;
  return frameHeight * (accumulateFaceSafeYFrac(direction.faceSafeYFrac) - accumulateCenterYFrac(direction.centerYFrac));
}

/** The most words a line shows: the direction's own cap, never more than the grammar's 4 (and at least 1). */
export function accumulateMaxWords(requested?: number): number {
  return clamp(Math.floor(Number.isFinite(requested) ? (requested as number) : ACCUMULATE.maxWordsPerLine), 1, ACCUMULATE.maxWordsPerLine);
}

/**
 * A word's entrance state `frame` frames after its onset (frame 0 = the onset frame). Linear blur 12 -> 0 px and opacity 0 -> 1 over `wordInFrames` (4); the scale rises 0.96 -> 1 on an ease-out
 * quad, which is monotonic: it reaches 1 and stays there, it never exceeds 1 (no overshoot / bounce). Before the onset the word is hidden; after it, fully settled.
 */
export function accumulateWordState(frame: number, frames: number = ACCUMULATE.wordInFrames): {opacity: number; blurPx: number; scale: number} {
  if (!(frame >= 0)) return {opacity: 0, blurPx: ACCUMULATE.blurFromPx, scale: ACCUMULATE.scaleFrom};
  const p = clamp(frame / Math.max(1, frames), 0, 1);
  const eased = 1 - (1 - p) * (1 - p);
  return {opacity: p, blurPx: ACCUMULATE.blurFromPx * (1 - p), scale: ACCUMULATE.scaleFrom + (1 - ACCUMULATE.scaleFrom) * eased};
}

/**
 * Group spoken words into accumulate lines. A line breaks (a HARD clear + a new line) when: the NEXT word would be past `maxWords`, the sentence changes, the pause is long, or a CUT falls between the
 * previous word's onset and this word's onset (so a line never straddles a cut). A line also clears at the first cut after its start even when no word follows it at once (silence over a cut).
 * `cutTimes` are output-time seconds (the VO cut plan's cuts and group starts). Words must be in spoken order.
 */
export function groupAccumulateLines(
  words: readonly AccumulateWord[],
  options: {maxWords?: number; cutTimes?: readonly number[]; holdAfterSec?: number} = {},
): AccumulateLine[] {
  const maxWords = accumulateMaxWords(options.maxWords);
  const holdAfter = options.holdAfterSec ?? ACCUMULATE.holdAfterSec;
  const tolerance = ACCUMULATE.cutToleranceSec;
  const cuts = [...(options.cutTimes ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
  const cutBetween = (from: number, to: number) => cuts.some(cut => cut > from + tolerance && cut <= to + tolerance);

  const groups: AccumulateWord[][] = [];
  let current: AccumulateWord[] = [];
  for (const word of words) {
    const previous = current[current.length - 1];
    const breaks =
      previous !== undefined &&
      (current.length >= maxWords ||
        (word.sentenceIndex !== undefined && previous.sentenceIndex !== undefined && word.sentenceIndex !== previous.sentenceIndex) ||
        word.start - previous.end > ACCUMULATE.maxGapSec ||
        cutBetween(previous.start, word.start));
    if (breaks) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => {
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const next = groups[index + 1];
    const firstCutAfter = cuts.find(cut => cut > start + tolerance);
    let clearAt = end + holdAfter;
    if (next) clearAt = Math.min(clearAt, next[0]!.start);
    if (firstCutAfter !== undefined) clearAt = Math.min(clearAt, firstCutAfter);
    return {words: group, start, clearAt: Math.max(clearAt, start + 1e-3)};
  });
}

/** The line on screen at `timeSec` (start <= t < clearAt), or null (a hard clear leaves nothing between lines). */
export function activeAccumulateLineAt(lines: readonly AccumulateLine[], timeSec: number): AccumulateLine | null {
  let found: AccumulateLine | null = null;
  for (const line of lines) if (timeSec >= line.start && timeSec < line.clearAt) found = line;
  return found;
}

/** How many words of `line` have started by `timeSec` (the build step: 1 = "This", 2 = "This founder", ...). */
export function accumulateRevealedCount(line: AccumulateLine, timeSec: number): number {
  return line.words.filter(word => timeSec >= word.start).length;
}

const FIGURE = /[0-9$%\u20ac\u00a3]/;
const FIGURE_UNIT = /^(thousand|million|billion|trillion|percent|dollars?|euros?|pounds?|bucks|k|m|bn)$/i;
const normWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * What each word of a line shows. Sentence case: the spoken text is kept as written (the transcript already carries its sentence case), trailing punctuation is dropped, and ONLY figures
 * ("$6", "2008", "40%"), the unit that follows a figure ("BILLION", "DOLLARS") and a flagged keyword (`capsWords`: the CTA keyword) are upper-cased.
 */
export function accumulateDisplayWords(words: readonly {text: string}[], capsWords: readonly string[] = []): string[] {
  const caps = new Set(capsWords.map(normWord).filter(Boolean));
  let afterFigure = false;
  return words.map(word => {
    const clean = word.text.trim().replace(/[.,;:!?\u2026"'\u201c\u201d\u2018\u2019)\]]+$/u, '').replace(/^["'\u201c\u2018([]+/u, '');
    const isFigure = FIGURE.test(clean);
    const isUnit = afterFigure && FIGURE_UNIT.test(normWord(clean));
    afterFigure = isFigure || (afterFigure && isUnit);
    return isFigure || isUnit || caps.has(normWord(clean)) ? clean.toUpperCase() : clean;
  });
}

/**
 * The font size actually used: `basePx`, shrunk (never below `minFitScale` of it) when the longest single word could not fit the container on one line (a word cannot wrap). A heuristic on glyph
 * count, kept deliberately generous; at 7 % of the height on a 9:16 canvas ("vulnerability" at 134 px) it is what keeps the one-word case inside the frame.
 */
export function accumulateFitFontPx(basePx: number, longestWordChars: number, containerPx: number): number {
  const needed = Math.max(1, longestWordChars) * ACCUMULATE.glyphEm * basePx;
  if (needed <= containerPx) return basePx;
  return Math.max(Math.round(basePx * ACCUMULATE.minFitScale), Math.floor(containerPx / (Math.max(1, longestWordChars) * ACCUMULATE.glyphEm)));
}
