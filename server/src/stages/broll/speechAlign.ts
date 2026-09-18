/**
 * Snap B-roll / split starts to the spoken word they illustrate.
 *
 * Director timestamps are approximate. If the scene is "person swimming pool"
 * we look for "swim/swimming" in the ASR word map and start the cutaway there,
 * so the picture lands with the word — not a second late.
 */

import type {WordToken} from '../../types/blueprint.ts';

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'woman', 'women', 'man', 'men', 'female', 'male', 'person', 'people',
  'cinematic', 'closeup', 'close', 'up', 'shot', 'video', 'scene',
]);

export function alignTimestampToSpeech(
  preferredSec: number,
  searchKeyword: string,
  words: WordToken[],
  overlayText = '',
): number {
  if (words.length === 0) {
    return preferredSec;
  }
  const needles = needlesFrom(searchKeyword, overlayText);
  if (needles.length === 0) {
    return preferredSec;
  }

  const hits: Array<{start: number; score: number}> = [];
  for (const word of words) {
    const normalized = normalizeToken(word.text);
    if (!normalized) {
      continue;
    }
    for (const needle of needles) {
      const score = tokenMatchScore(normalized, needle);
      if (score <= 0) {
        continue;
      }
      // Prefer hits near the director's guess, but never ignore a clear lexical hit.
      const proximity = 1 / (1 + Math.abs(word.start - preferredSec));
      hits.push({start: word.start, score: score * 2 + proximity});
    }
  }

  if (hits.length === 0) {
    return preferredSec;
  }

  hits.sort((a, b) => b.score - a.score || Math.abs(a.start - preferredSec) - Math.abs(b.start - preferredSec));
  return hits[0]!.start;
}

export function needlesFrom(searchKeyword: string, overlayText = ''): string[] {
  const raw = `${searchKeyword} ${overlayText}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP.has(word));
  const out: string[] = [];
  for (const word of raw) {
    out.push(word);
    const stem = stemWord(word);
    if (stem !== word && stem.length >= 3) {
      out.push(stem);
    }
  }
  return [...new Set(out)];
}

function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stemWord(word: string): string {
  if (word.endsWith('ming') && word.length > 5) {
    return word.replace(/ming$/, ''); // swimming -> swim
  }
  if (word.endsWith('ing') && word.length > 5) {
    return word.slice(0, -3);
  }
  if (word.endsWith('ies') && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith('es') && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

function tokenMatchScore(token: string, needle: string): number {
  if (token === needle) {
    return 3;
  }
  if (token.startsWith(needle) || needle.startsWith(token)) {
    return 2;
  }
  if (token.includes(needle) || needle.includes(token)) {
    return 1;
  }
  return 0;
}
