/**
 * Force stock searches into English Latin scene phrases.
 *
 * ASR may be Nepali/Hindi/Tamil while Pexels only ranks English tokens well.
 * Non-Latin characters in a query quietly return random stock.
 */

import {sanitizeVisualQuery} from './visualQuery.ts';

const NON_LATIN = /[^\u0000-\u007f]/;

export function hasNonLatinScript(text: string): boolean {
  return NON_LATIN.test(text);
}

/** Keep only ASCII letters/digits so Pexels never sees native-script tokens. */
export function ensureEnglishSearchQuery(raw: string): string {
  const ascii = raw
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ');
  return sanitizeVisualQuery(ascii);
}

export function englishQueryVariants(raw: string): string[] {
  const cleaned = ensureEnglishSearchQuery(raw);
  if (!cleaned) {
    return [];
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const out = [cleaned];
  if (parts.length >= 4) {
    out.push(parts.slice(0, 4).join(' '));
  }
  if (parts.length >= 3) {
    out.push(parts.slice(0, 3).join(' '));
  }
  return [...new Set(out)];
}
