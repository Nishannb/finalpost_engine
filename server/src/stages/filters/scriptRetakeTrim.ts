/**
 * Script-aligned retake detection for teleprompter footage.
 *
 * Split speech into pause-separated utterances, match each to a script line,
 * and when the same line was spoken more than once keep only the last take.
 */

import type {TimeRange, WordToken} from '../../types/blueprint.ts';
import {round} from './timeline.ts';

export type ScriptRetakeOptions = {
  /** Pause (seconds) that starts a new utterance. */
  utteranceGapSec?: number;
  /** Minimum Jaccard similarity to claim a script-line match. */
  minSimilarity?: number;
  /** Extra silence kept around a cut so speech does not clip. */
  paddingSec?: number;
  sourceDurationSec: number;
};

export type ScriptRetakeResult = {
  trimExclusions: TimeRange[];
  /** How many earlier takes were dropped. */
  droppedTakes: number;
  matchedLines: number;
};

const MIN_CUT_SEC = 0.08;
const DEFAULT_GAP = 0.55;
const DEFAULT_SIM = 0.42;
const DEFAULT_PAD = 0.06;

export function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0900-\u097f']+/gi, '')
    .trim();
}

/** Non-empty script lines (teleprompter paragraphs / beats). */
export function scriptLinesFromText(script: string): string[][] {
  const lines: string[][] = [];
  for (const line of script.split(/\r?\n/)) {
    const norms = (line.match(/\S+/g) ?? [])
      .map(normalizeToken)
      .filter(Boolean);
    if (norms.length >= 2) {
      lines.push(norms);
    }
  }
  // Fallback: sentence split when the creator pasted one long paragraph.
  if (lines.length === 0) {
    const norms = (script.match(/\S+/g) ?? [])
      .map(normalizeToken)
      .filter(Boolean);
    if (norms.length >= 4) {
      const chunk = 8;
      for (let i = 0; i < norms.length; i += chunk) {
        const slice = norms.slice(i, i + chunk);
        if (slice.length >= 2) {
          lines.push(slice);
        }
      }
    }
  }
  return lines;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      inter += 1;
    }
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

type Utterance = {
  start: number;
  end: number;
  norms: string[];
};

function utterancesFromWords(
  words: WordToken[],
  gapSec: number,
): Utterance[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const out: Utterance[] = [];
  let current: Utterance | null = null;
  for (const word of sorted) {
    const norm = normalizeToken(word.text);
    if (!norm) {
      continue;
    }
    if (!current) {
      current = {start: word.start, end: word.end, norms: [norm]};
      continue;
    }
    if (word.start - current.end >= gapSec) {
      out.push(current);
      current = {start: word.start, end: word.end, norms: [norm]};
      continue;
    }
    current.end = Math.max(current.end, word.end);
    current.norms.push(norm);
  }
  if (current) {
    out.push(current);
  }
  return out;
}

function bestLineIndex(
  norms: string[],
  lines: string[][],
  minSim: number,
): number {
  let best = -1;
  let bestScore = minSim;
  for (let i = 0; i < lines.length; i += 1) {
    const score = jaccardSimilarity(norms, lines[i]!);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Return exclusion ranges for earlier retakes of the same script line.
 */
export function scriptRetakeExclusions(
  words: WordToken[],
  scriptText: string,
  options: ScriptRetakeOptions,
): ScriptRetakeResult {
  const empty: ScriptRetakeResult = {
    trimExclusions: [],
    droppedTakes: 0,
    matchedLines: 0,
  };
  const script = (scriptText || '').trim();
  if (!script || words.length < 6) {
    return empty;
  }
  const lines = scriptLinesFromText(script);
  if (lines.length < 1) {
    return empty;
  }

  const gap = Math.max(0.25, options.utteranceGapSec ?? DEFAULT_GAP);
  const minSim = Math.min(0.9, Math.max(0.25, options.minSimilarity ?? DEFAULT_SIM));
  const padding = Math.max(0, options.paddingSec ?? DEFAULT_PAD);
  const duration = Math.max(0, options.sourceDurationSec);

  const utterances = utterancesFromWords(words, gap).filter(
    item => item.norms.length >= 2 && item.end - item.start >= 0.35,
  );
  if (utterances.length < 2) {
    return empty;
  }

  const byLine = new Map<number, Utterance[]>();
  let matchedLines = 0;
  for (const utterance of utterances) {
    const lineIndex = bestLineIndex(utterance.norms, lines, minSim);
    if (lineIndex < 0) {
      continue;
    }
    matchedLines += 1;
    const bucket = byLine.get(lineIndex) ?? [];
    bucket.push(utterance);
    byLine.set(lineIndex, bucket);
  }

  const exclusions: TimeRange[] = [];
  let droppedTakes = 0;
  for (const bucket of byLine.values()) {
    if (bucket.length < 2) {
      continue;
    }
    // Keep the last take (creators usually nail it on the final attempt).
    const keep = bucket[bucket.length - 1]!;
    for (let i = 0; i < bucket.length - 1; i += 1) {
      const take = bucket[i]!;
      // Never cut into the kept take window.
      const from = Math.max(0, take.start - padding);
      const to = Math.min(keep.start - padding * 0.5, take.end + padding);
      if (to - from >= MIN_CUT_SEC) {
        exclusions.push({start: round(from), end: round(to)});
        droppedTakes += 1;
      }
    }
  }

  return {
    trimExclusions: mergeTimeRanges(exclusions),
    droppedTakes,
    matchedLines,
  };
}

/** Tokens that are non-speech events Whisper sometimes emits. */
const NON_SPEECH =
  /^(cough|coughs|coughing|sneeze|sneezes|laughter|laugh|laughs|applause|clears?\s*throat|breath|inhale|exhale)$/i;

export function isNonSpeechToken(raw: string): boolean {
  const cleaned = raw.replace(/[[\]()*.!?,-]/g, ' ').trim();
  return NON_SPEECH.test(cleaned);
}

/**
 * Cut isolated cough / sneeze / laugh tokens from the timeline.
 */
export function nonSpeechExclusions(
  words: WordToken[],
  options: {paddingSec?: number},
): TimeRange[] {
  const padding = Math.max(0, options.paddingSec ?? 0.04);
  const exclusions: TimeRange[] = [];
  const sorted = [...words].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i += 1) {
    const token = sorted[i]!;
    if (!isNonSpeechToken(token.text)) {
      continue;
    }
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const from = Math.max(
      prev ? prev.end : 0,
      token.start - padding,
    );
    const to = Math.min(
      next ? next.start : token.end + padding,
      token.end + padding,
    );
    if (to - from >= MIN_CUT_SEC) {
      exclusions.push({start: round(from), end: round(to)});
    }
  }
  return mergeTimeRanges(exclusions);
}

export function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 0.02) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({...range});
  }
  return merged;
}
