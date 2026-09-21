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

/**
 * Hold a graphic or B-roll for as long as the related speech lasts — not a
 * fixed clock. Expands to the spoken burst around the aligned word.
 */
export function speechHoldWindow(input: {
  words: WordToken[];
  atSec: number;
  phrase?: string;
  fallbackSec?: number;
  maxSec?: number;
}): {start: number; end: number} {
  const fallbackSec = Math.max(0.9, input.fallbackSec ?? 2.2);
  const maxSec = Math.max(fallbackSec, input.maxSec ?? 8);
  if (input.words.length === 0) {
    const guessed = holdFromPhrase(input.phrase, fallbackSec);
    return {
      start: input.atSec,
      end: input.atSec + Math.min(maxSec, guessed),
    };
  }

  const aligned = input.phrase
    ? alignTimestampToSpeech(input.atSec, input.phrase, input.words, input.phrase)
    : input.atSec;
  const burst = spokenBurstAround(input.words, aligned);
  if (!burst) {
    const guessed = holdFromPhrase(input.phrase, fallbackSec);
    return {
      start: aligned,
      end: aligned + Math.min(maxSec, guessed),
    };
  }
  const pad = 0.28;
  const start = burst.start;
  const end = Math.min(start + maxSec, burst.end + pad);
  if (end - start < 0.9) {
    return {start, end: start + Math.min(maxSec, 0.9)};
  }
  return {start, end};
}

/**
 * Title/lockup window: only the spoken phrase, not the whole sentence burst.
 * Adds linger so slow enter/exit still leave readable still time.
 */
export function speechPhraseWindow(input: {
  words: WordToken[];
  atSec: number;
  phrase?: string;
  fallbackSec?: number;
  lingerSec?: number;
  motionPadSec?: number;
  maxSec?: number;
}): {start: number; end: number} {
  const linger = input.lingerSec ?? 0.45;
  const motionPad = input.motionPadSec ?? 1.2;
  const fallbackSec = Math.max(1.4, input.fallbackSec ?? 2.2);
  const maxSec = Math.max(fallbackSec, input.maxSec ?? 7);
  const phrase = (input.phrase || '').trim();
  const minHold = Math.min(
    maxSec,
    Math.max(fallbackSec, holdFromPhrase(phrase, fallbackSec) + motionPad * 0.35),
  );

  if (input.words.length === 0) {
    return {start: input.atSec, end: input.atSec + minHold};
  }

  const needles = needlesFrom(phrase, phrase);
  const hits = input.words
    .map(word => {
      const token = normalizeToken(word.text);
      const score = needles.reduce(
        (best, needle) => Math.max(best, tokenMatchScore(token, needle)),
        0,
      );
      return {word, score};
    })
    .filter(hit => hit.score > 0);
  if (hits.length === 0) {
    const aligned = phrase
      ? alignTimestampToSpeech(input.atSec, phrase, input.words, phrase)
      : input.atSec;
    return {
      start: aligned,
      end: aligned + minHold,
    };
  }
  let anchor = hits[0]!;
  for (const hit of hits) {
    if (
      Math.abs(hit.word.start - input.atSec) < Math.abs(anchor.word.start - input.atSec)
    ) {
      anchor = hit;
    }
  }
  const nearby = hits
    .filter(hit => Math.abs(hit.word.start - anchor.word.start) <= 2.6)
    .sort((a, b) => a.word.start - b.word.start);
  const start = nearby[0]!.word.start;
  const spokenEnd = nearby.at(-1)!.word.end;
  const end = Math.min(start + maxSec, Math.max(spokenEnd + linger, start + minHold));
  return {start, end};
}

export function holdFromPhrase(phrase: string | undefined, fallbackSec: number): number {
  const words = (phrase || '')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0);
  if (words.length === 0) {
    return fallbackSec;
  }
  return Math.min(8, Math.max(0.9, words.length * 0.38 + 0.45));
}

function spokenBurstAround(
  words: WordToken[],
  atSec: number,
): {start: number; end: number} | null {
  if (words.length === 0) {
    return null;
  }
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const mid = (word.start + word.end) / 2;
    const dist = Math.abs(mid - atSec);
    if (dist < best) {
      best = dist;
      nearest = i;
    }
  }
  let from = nearest;
  let to = nearest;
  while (from > 0 && words[from]!.start - words[from - 1]!.end < 0.48) {
    from -= 1;
  }
  while (to < words.length - 1 && words[to + 1]!.start - words[to]!.end < 0.48) {
    to += 1;
  }
  return {start: words[from]!.start, end: words[to]!.end};
}

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

  const HOOK_GUARD = 3.2;
  const MAX_JUMP_SEC = 6;
  const afterHook =
    preferredSec >= HOOK_GUARD ? hits.filter(hit => hit.start >= HOOK_GUARD) : hits;
  const pool = afterHook.length > 0 ? afterHook : hits;
  const nearby = pool.filter(hit => Math.abs(hit.start - preferredSec) <= MAX_JUMP_SEC);
  const chosen = (nearby.length > 0 ? nearby : pool)[0];
  if (!chosen) {
    return preferredSec;
  }
  if (
    preferredSec >= HOOK_GUARD &&
    Math.abs(chosen.start - preferredSec) > MAX_JUMP_SEC
  ) {
    return preferredSec;
  }
  return chosen.start;
}

/**
 * Earliest spoken window for overlay/hook copy. Titles must land on the words
 * they quote, not on a later sentence the director guessed.
 */
export function firstPhraseWindow(
  words: WordToken[],
  phrase: string,
  fallback: {start: number; end: number},
): {start: number; end: number} {
  const needles = needlesFrom(phrase, phrase);
  if (words.length === 0 || needles.length === 0) {
    return fallback;
  }
  const hits = words
    .map(word => {
      const token = normalizeToken(word.text);
      const score = needles.reduce(
        (best, needle) => Math.max(best, tokenMatchScore(token, needle)),
        0,
      );
      return {word, score};
    })
    .filter(hit => hit.score >= 2)
    .sort((a, b) => a.word.start - b.word.start);
  if (hits.length === 0) {
    return fallback;
  }
  const first = hits[0]!;
  const cluster = hits.filter(hit => hit.word.start - first.word.start <= 2.6);
  const start = cluster[0]!.word.start;
  const spokenEnd = cluster.at(-1)!.word.end;
  return {
    start,
    end: Math.min(start + 4.5, Math.max(spokenEnd + 0.2, start + 1.2)),
  };
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
