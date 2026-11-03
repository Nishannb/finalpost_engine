/**
 * WP11A / WP56: ONE TEXT JOB AT A TIME. A generated graphic that carries spoken words must not play together with the karaoke captions of the same words. This module decides, from the final graphics and
 * their briefs, which time ranges the caption layer is muted for. PURE: no env, no I/O. The renderer (remotion ShortVideo) hides the caption layer and backing plate inside these ranges and restores them after.
 *
 *   full_screen / split_screen graphic with readable text/numbers -> muted for its whole window
 *   full_screen / split_screen with NO readable text (ImageRun / photo stacks / money stills) -> captions STAY ON (WP56)
 *   kinetic text / emphasis / chip overlays (`textItems`) -> same intersection rule as an overlay
 *   overlay / pip graphic               -> muted only when its on-screen words intersect the spoken caption words in its window (a caption clone); a graphic with no shared words leaves the captions alone
 *   frame_inset / stillness never contribute mute ranges (planner must not add them here)
 */
export type MuteRange = {startSec: number; endSec: number};
type GraphicWindow = {id: string; start: number; end: number; placement: {mode: string}};
type TimedWord = {text: string; start: number; end: number};

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const SHORT_OK = 3;
const SMALL_WORDS = new Set(['the', 'and', 'for', 'you', 'are', 'was', 'but', 'not', 'that', 'this', 'with', 'have', 'from', 'your', 'they', 'will']);

/** Asset / URL fields are not on-screen readable copy (WP56: textless ImageRun must not mute captions). */
const SKIP_CONTENT_KEYS = new Set([
  'icon',
  'icons',
  'recipeId',
  'src',
  'url',
  'assetUrl',
  'subjectSrc',
  'logoSrc',
  'markSrc',
  'imageUrls',
  'screenshotUrls',
]);

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    // skip bare URLs / paths mistaken for words
    if (!/^https?:\/\//i.test(value) && !/\.(jpg|jpeg|png|webp|gif|mp4|webm)(\?|$)/i.test(value)) out.push(value);
  } else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) if (!SKIP_CONTENT_KEYS.has(key)) stringsOf(item, out);
  }
  return out;
}

/** Content words (length >= 3, not a function word) of every string in a brief's content. */
export function contentWordsOf(content: unknown): Set<string> {
  const words = new Set<string>();
  for (const text of stringsOf(content)) for (const token of text.split(/\s+/)) {
    const word = norm(token);
    if (word.length >= SHORT_OK && !SMALL_WORDS.has(word)) words.add(word);
  }
  return words;
}

/** Any other on-screen text with a window (kinetic text, emphasis pops, chip / lockup overlays): muted when it shares spoken words with the captions of its window. */
export type TextItem = {start: number; end: number; text: string};

export function captionMuteRanges(input: {graphics: readonly GraphicWindow[]; contentById: ReadonlyMap<string, unknown>; captionWords: readonly TimedWord[]; textItems?: readonly TextItem[]}): MuteRange[] {
  const ranges: MuteRange[] = [];
  for (const item of input.textItems ?? []) {
    if (!(item.end > item.start) || !item.text.trim()) continue;
    const mine = contentWordsOf(item.text);
    const spoken = input.captionWords.filter(word => word.end > item.start && word.start < item.end).map(word => norm(word.text));
    if (spoken.some(word => mine.has(word))) ranges.push({startSec: item.start, endSec: item.end});
  }
  for (const graphic of input.graphics) {
    if (!(graphic.end > graphic.start)) continue;
    const mine = contentWordsOf(input.contentById.get(graphic.id));
    // WP56: only mute when the plate owns readable text/numbers. Textless full-bleed stills keep captions.
    if (graphic.placement.mode === 'full_screen' || graphic.placement.mode === 'split_screen') {
      if (mine.size === 0) continue;
      ranges.push({startSec: graphic.start, endSec: graphic.end});
      continue;
    }
    if (mine.size === 0) continue;
    const spoken = input.captionWords.filter(word => word.end > graphic.start && word.start < graphic.end).map(word => norm(word.text));
    if (spoken.some(word => mine.has(word))) ranges.push({startSec: graphic.start, endSec: graphic.end});
  }
  return mergeMuteRanges(ranges);
}

/** Sort, merge touching / overlapping ranges (0.05 s tolerance) and round to ms. WP43: Skill C plate windows merge into the WP11A ranges through this. */
export function mergeMuteRanges(ranges: readonly MuteRange[]): MuteRange[] {
  const sorted = ranges.filter(range => range.endSec > range.startSec).map(range => ({...range})).sort((a, b) => a.startSec - b.startSec);
  const merged: MuteRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startSec <= last.endSec + 0.05) last.endSec = Math.max(last.endSec, range.endSec);
    else merged.push({...range});
  }
  return merged.map(range => ({startSec: Math.round(range.startSec * 1000) / 1000, endSec: Math.round(range.endSec * 1000) / 1000}));
}
