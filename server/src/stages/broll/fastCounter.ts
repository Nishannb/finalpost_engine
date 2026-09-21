/**
 * Fast count-up edit tool for huge spoken numbers.
 *
 * 50B starts at 35B, ticks quickly, then a small scale punch on the land.
 * Target is always the spoken figure — never invented.
 */

import type {SemanticEmphasis} from '../../types/blueprint.ts';

/** Parse a spoken magnitude into a counter range. Never invents the target. */
export function parseSpokenMagnitude(text: string): {
  countFrom: number;
  countTo: number;
  suffix: string;
} | null {
  const cleaned = text.replace(/,/g, '').trim();
  const wordOnly = cleaned.match(/^(?:a|one)?\s*(million|billion|thousand)s?$/i);
  if (wordOnly) {
    const word = wordOnly[1]!.toLowerCase();
    return {countFrom: 0.7, countTo: 1, suffix: ` ${word}`};
  }
  const match = cleaned.match(
    /([$€£])?\s*(\d+(?:\.\d+)?)(\s*(?:billion|million|thousand)|[kKmMbB%]|s)?/i,
  );
  if (!match) {
    return null;
  }
  const prefix = match[1] || '';
  const countTo = Number(match[2]);
  if (!Number.isFinite(countTo) || countTo <= 0) {
    return null;
  }
  const rawSuffix = (match[3] || '').trim();
  const suffix =
    rawSuffix.toLowerCase() === 's'
      ? ''
      : rawSuffix
        ? rawSuffix.length === 1
          ? rawSuffix
          : ` ${rawSuffix}`
        : '';
  const hasUnit = Boolean(rawSuffix && !/^(%|s)$/i.test(rawSuffix));
  const countFrom =
    !hasUnit && countTo < 10
      ? Math.max(0, Math.round((countTo - 3) * 10) / 10)
      : Math.round(countTo * 0.7 * 10) / 10;
  return {
    countFrom,
    countTo,
    suffix: prefix ? `${prefix}${suffix}` : suffix,
  };
}

export type SpokenCounter = {
  start: number;
  end: number;
  text: string;
  countFrom: number;
  countTo: number;
  countSuffix: string;
};

const UNIT_WORD = /^(billion|million|thousand|[kmb%])s?$/i;

export function isHugeSpokenNumber(parsed: {
  countTo: number;
  suffix: string;
}): boolean {
  const unit = parsed.suffix.toLowerCase();
  if (/[kmb]|thousand|million|billion/.test(unit)) {
    return true;
  }
  if (unit.includes('%') && parsed.countTo >= 20) {
    return true;
  }
  return parsed.countTo >= 100;
}

export function hugeNumberHits(
  words: Array<{text: string; start: number; end: number}>,
): SpokenCounter[] {
  return numberHits(words, parsed => isHugeSpokenNumber(parsed));
}

/** Any spoken number worth a counter, including 20s / million. */
export function spokenNumberHits(
  words: Array<{text: string; start: number; end: number}>,
): SpokenCounter[] {
  return numberHits(words, parsed => parsed.countTo >= 10 || Boolean(parsed.suffix.trim()));
}

function numberHits(
  words: Array<{text: string; start: number; end: number}>,
  accept: (parsed: {countTo: number; suffix: string}) => boolean,
): SpokenCounter[] {
  const hits: SpokenCounter[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const next = words[i + 1];
    const nextUnit = Boolean(next && UNIT_WORD.test(next.text.replace(/[^a-z%]/gi, '')));
    const pair = nextUnit ? `${word.text} ${next!.text}` : '';
    const two = pair ? parseSpokenMagnitude(pair) : null;
    const one = parseSpokenMagnitude(word.text);
    const picked =
      two && accept(two)
        ? {parsed: two, text: pair, start: word.start, end: next!.end, skip: 1}
        : one && accept(one)
          ? {parsed: one, text: word.text, start: word.start, end: word.end, skip: 0}
          : null;
    if (!picked) {
      continue;
    }
    const overlap = hits.some(
      hit => picked.start < hit.end + 0.15 && picked.end > hit.start - 0.15,
    );
    if (overlap) {
      continue;
    }
    hits.push({
      start: picked.start,
      end: picked.end,
      text: picked.text,
      countFrom: picked.parsed.countFrom,
      countTo: picked.parsed.countTo,
      countSuffix: picked.parsed.suffix,
    });
    if (picked.skip) {
      i += 1;
    }
  }
  return hits;
}

export function toCountEmphasis(
  hit: SpokenCounter,
  durationSec: number,
  accentColor = '#FACC15',
): SemanticEmphasis {
  return {
    start: hit.start,
    end: Math.min(durationSec, Math.max(hit.end + 1.2, hit.start + 2.1)),
    text: hit.text,
    weight: 'primary',
    treatment: 'count',
    accentColor,
    anchor: 'top_right',
    countFrom: hit.countFrom,
    countTo: hit.countTo,
    countSuffix: hit.countSuffix,
  };
}

export function ensureHugeNumberCounters(
  existing: SemanticEmphasis[],
  _words: Array<{text: string; start: number; end: number}>,
  _durationSec: number,
): SemanticEmphasis[] {
  return existing.map(item => fillCounterRange(item)).slice(0, 5);
}

export function fillCounterRange(item: SemanticEmphasis): SemanticEmphasis {
  const magnitude = parseSpokenMagnitude(item.text);
  if (!magnitude) {
    return item;
  }
  return {
    ...item,
    treatment: 'count',
    countFrom: item.countFrom ?? magnitude.countFrom,
    countTo: item.countTo ?? magnitude.countTo,
    countSuffix: item.countSuffix || magnitude.suffix,
  };
}
