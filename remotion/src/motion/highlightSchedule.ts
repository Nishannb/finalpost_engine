/**
 * WP12B: a SPEECH-SYNCED HIGHLIGHTER. A schedule is a list of `{word, fromSec, toSec}` spans, times in seconds from the START of the graphic (the seed measures them from the spoken word timings). The marker
 * WALKS: each scheduled word's bar sweeps in at its `fromSec`, and the previous bar dims when the next one begins. With no schedule (or an empty one) the static `highlight` words are used unchanged.
 * Pure: no React, no Remotion.
 */
export type HighlightSpan = {word: string; fromSec: number; toSec: number};

export const normalizeWord = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Valid spans only (finite, ordered, non-empty word), sorted by start. */
export function cleanSchedule(schedule: readonly HighlightSpan[] | undefined): HighlightSpan[] {
  return (schedule ?? [])
    .filter(span => normalizeWord(span.word) !== '' && Number.isFinite(span.fromSec) && Number.isFinite(span.toSec) && span.fromSec >= 0 && span.toSec > span.fromSec)
    .sort((a, b) => a.fromSec - b.fromSec);
}

/** The span whose word is being spoken at `tSec`, or null before the first / between spans / after the last. */
export function activeSpanAt(schedule: readonly HighlightSpan[] | undefined, tSec: number): HighlightSpan | null {
  return cleanSchedule(schedule).find(span => tSec >= span.fromSec && tSec < span.toSec) ?? null;
}

/** The words the marker has already visited by `tSec` (started at or before it). */
export function visitedWordsAt(schedule: readonly HighlightSpan[] | undefined, tSec: number): string[] {
  return cleanSchedule(schedule).filter(span => span.fromSec <= tSec).map(span => span.word);
}

/**
 * The per-word frames the KineticText uses: `starts[word]` = the frame its bar begins to sweep, `ends[word]` = the frame the NEXT span begins (when this bar dims). The last span never ends. Words repeated in the
 * schedule keep their first span. `words` = the distinct scheduled words to mark.
 */
export function scheduleFrames(schedule: readonly HighlightSpan[] | undefined, fps: number): {words: string[]; starts: Record<string, number>; ends: Record<string, number>} {
  const spans = cleanSchedule(schedule);
  const starts: Record<string, number> = {};
  const ends: Record<string, number> = {};
  const words: string[] = [];
  spans.forEach((span, index) => {
    const key = normalizeWord(span.word);
    if (key in starts) return;
    words.push(span.word);
    starts[key] = Math.round(span.fromSec * fps);
    const next = spans[index + 1];
    if (next) ends[key] = Math.round(next.fromSec * fps);
  });
  return {words, starts, ends};
}
