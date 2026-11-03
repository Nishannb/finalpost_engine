/**
 * Skill C — line breaking for the glyph recipes (type_trail, scramble_settle). Those recipes draw one inline-block per CHARACTER, so the browser would wrap them mid-word ("Here is the trick th / at ...").
 * PURE (no React): words are never split; lines are balanced greedily; the font size is derived from the longest line so it fits the box.
 */

/** Average glyph advance of the heavy grotesque as a fraction of the font size (weight 900, tight tracking). */
export const GLYPH_ADVANCE_EM = 0.6;
/** Target characters per line at the base size on a portrait frame. */
export const TARGET_LINE_CHARS = 15;

/** Break `text` into at most `maxLines` balanced lines of whole words (a single long word stays on its own line). */
export function textualMgLines(text: string, maxLines = 3, targetChars = TARGET_LINE_CHARS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const total = words.join(' ').length;
  const lineCount = Math.max(1, Math.min(maxLines, words.length, Math.ceil(total / targetChars)));
  if (lineCount === 1) return [words.join(' ')];
  const goal = total / lineCount;
  const lines: string[] = [];
  let current = '';
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = current ? `${current} ${word}` : word;
    // start a new line when the candidate overshoots the goal by more than it undershoots it, as long as later lines can still take the rest
    if (current && lines.length < lineCount - 1 && Math.abs(candidate.length - goal) > Math.abs(current.length - goal)) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Font size (px) that fits the longest line in `boxWidth`, never above `maxPx`. */
export function textualMgFontPx(lines: readonly string[], boxWidth: number, maxPx: number): number {
  const longest = Math.max(1, ...lines.map(line => line.length));
  return Math.max(12, Math.min(maxPx, Math.floor(boxWidth / (longest * GLYPH_ADVANCE_EM))));
}
