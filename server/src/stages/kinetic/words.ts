import {normToken} from './transcript.ts';

/** Function words: always connectors (small, light, 0.9 opacity). The fallback tags with this list; the director prompt repeats it. */
export const FUNCTION_WORDS = new Set(['a', 'the', 'i', 'my', 'to', 'of', 'and', 'you', 'we', 'it', 'is', 'are', 'was', 'be', 'for', 'in', 'on', 'that', 'this', 'like', 'just']);

/** Multi-word tool / brand names that must stay one line and, when listed together, share equal size / fill. */
export const BRAND_PHRASES: string[][] = [['after', 'effects'], ['premiere', 'pro'], ['davinci', 'resolve'], ['final', 'cut']];
export const BRAND_JOINED = new Set(BRAND_PHRASES.map(p => p.join('')));
export const isBrandName = (text: string): boolean => BRAND_JOINED.has(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));

/** Two or more listed tool names in one block (After Effects / Premiere Pro / DaVinci Resolve): equal size and fill. */
export const isPeerList = (lines: Array<{text: string; role: string}>): boolean =>
  lines.filter(w => (w.role === 'hero' || w.role === 'support') && isBrandName(w.text)).length >= 2;

/** Spoken units after glueing brand phrases. "After Effects" counts as 1. */
export function countHeadlineUnits(lines: Array<{text: string}>): number {
  const toks = lines.flatMap(l => l.text.split(/\s+/).filter(Boolean));
  let i = 0, n = 0;
  while (i < toks.length) {
    const hit = BRAND_PHRASES.find(p => i + p.length <= toks.length && p.every((t, k) => normToken(toks[i + k]!) === t));
    if (hit) { n += 1; i += hit.length; } else { n += 1; i += 1; }
  }
  return n;
}

export const MAX_HEADLINE_UNITS = 6;
export const MAX_PEER_UNITS = 8;
