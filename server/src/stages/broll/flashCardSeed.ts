/**
 * WP17: FLASH CARD candidates. A pivot is a connective beat ("Then everything broke", "But then", "Suddenly", "Until one day", "However") where the Metromedia edit cuts to a solid black / white full frame with 1-4
 * words for a fraction of a second and then whips into the next world. PURE: it reads timed words only (no env, no I/O, no model). The phrase is a VERBATIM contiguous run of the speech; nothing is invented.
 *
 * Detection is deliberately narrow so cards stay special (a plain sentence that merely starts with "Then" is not a pivot):
 *  - an IDIOM inside a clause: "then everything ...", "everything broke / changed / fell apart ...", "but then", "suddenly", "until one day / then", "however", "that changed everything";
 *  - a SHORT CLAUSE: a clause of at most 4 words that starts with a pivot word (then, but, suddenly, until, however, yet, so, and then).
 * A clause ends at . ? ! , ; : or a pause of 0.45 s. The card shows the idiom (or the short clause) from its first word, at most 4 words, trimmed of trailing connectors.
 */
export type TimedWordLike = {text: string; start: number; end: number};

export type FlashCardCandidate = {
  phrase: string;
  firstWord: number;
  lastWord: number;
  startSec: number;
  endSec: number;
};

export const FLASH_CARD_MAX_WORDS = 4;
export const FLASH_CARD_MIN_SEC = 0.35;
export const FLASH_CARD_MAX_SEC = 1.2;
/** Cards a clip of `durationSec` may carry: about one per 13 s, at least 1 (clips of 10 s or more), at most 4; none under 10 s. */
export const flashCardCap = (durationSec: number): number => (Number.isFinite(durationSec) && durationSec >= 10 ? Math.min(4, Math.max(1, Math.floor(durationSec / 13))) : 0);

/** How long a card is up: the spoken span plus a short tail, clamped to 0.5-1.2 s (the preferred band is 0.5-0.8 s for a 4-word phrase said at speaking pace). */
export function flashCardDuration(spokenSec: number): number {
  const wanted = Math.max(0.5, Math.min(FLASH_CARD_MAX_SEC, spokenSec + 0.15));
  return Math.round(Math.max(FLASH_CARD_MIN_SEC, wanted) * 1000) / 1000;
}

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
const clean = (word: string) => word.replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%]+$/gu, '');
const WEAK_END = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'it', 'its', 'that', 'this', 'i', 'we', 'you', 'so']);
const PIVOT_START = new Set(['then', 'but', 'suddenly', 'until', 'however', 'yet', 'so']);

/** Idioms, matched on the normalised clause text; the card starts at the first word of the match. */
const IDIOMS: readonly RegExp[] = [
  /\bthen everything\b/,
  /\beverything (?:broke|changed|fell apart|collapsed|stopped)\b/,
  /\bthat changed everything\b/,
  /\bbut then\b/,
  /\bsuddenly\b/,
  /\buntil (?:one day|then|suddenly)\b/,
  /\bhowever\b/,
  /\bthen it (?:hit|clicked|broke)\b/,
];

type Clause = {from: number; to: number};

function clauses(words: readonly TimedWordLike[]): Clause[] {
  const out: Clause[] = [];
  let from = 0;
  for (let index = 0; index < words.length; index += 1) {
    const next = words[index + 1];
    const ends = /[.?!,;:—]["')”’]*$/.test(words[index]!.text) || !next || next.start - words[index]!.end >= 0.45;
    if (ends) {
      out.push({from, to: index});
      from = index + 1;
    }
  }
  return out;
}

export function findFlashCardCandidates(words: readonly TimedWordLike[]): FlashCardCandidate[] {
  const found: FlashCardCandidate[] = [];
  for (const clause of clauses(words)) {
    const indexes = Array.from({length: clause.to - clause.from + 1}, (_, offset) => clause.from + offset);
    const tokens = indexes.map(index => norm(words[index]!.text));
    if (tokens.some(token => token === '')) continue;
    let startAt = -1;
    const text = tokens.join(' ');
    for (const idiom of IDIOMS) {
      const match = idiom.exec(text);
      if (match) {
        startAt = text.slice(0, match.index).split(' ').filter(Boolean).length;
        break;
      }
    }
    // a short clause that opens with a pivot word
    if (startAt < 0 && tokens.length <= FLASH_CARD_MAX_WORDS && (PIVOT_START.has(tokens[0]!) || (tokens[0] === 'and' && tokens[1] === 'then')) && (tokens.length >= 2 || tokens[0] === 'suddenly' || tokens[0] === 'however')) startAt = 0;
    if (startAt < 0) continue;
    let chosen = indexes.slice(startAt, startAt + FLASH_CARD_MAX_WORDS);
    while (chosen.length > 1 && WEAK_END.has(norm(words[chosen[chosen.length - 1]!]!.text))) chosen = chosen.slice(0, -1);
    const first = chosen[0]!;
    const last = chosen[chosen.length - 1]!;
    const phrase = chosen.map(index => clean(words[index]!.text)).filter(Boolean).join(' ');
    if (!phrase || phrase.replace(/[^\p{L}]/gu, '').length < 4) continue;
    found.push({phrase, firstWord: first, lastWord: last, startSec: words[first]!.start, endSec: words[last]!.end});
  }
  return found;
}
