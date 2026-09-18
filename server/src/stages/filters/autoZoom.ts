/**
 * Stage B.2 — Auto-Zoom (camera punch-ins) and sentence segmentation.
 *
 * Sentence ends are detected from punctuation the ASR already produced, and the
 * sentence *after* each boundary gets scaled up. Zooming every following
 * sentence would leave the camera permanently pushed in, so punch-ins alternate:
 * a sentence is only zoomed when the previous one was not.
 */

import type {
  CaptionWord,
  WordToken,
  ZoomTrigger,
} from '../../types/blueprint.ts';
import {round, type Timeline} from './timeline.ts';

/** Trailing quotes/brackets may follow the terminator: `end."` or `end!)`. */
const SENTENCE_END = /[.!?]["'”’)\]]*\s*$/;

/**
 * Tokens whose period is not a sentence break.
 *
 * Deliberately a short, explicit list plus initials (`U.`) and list markers
 * (`2.`): a looser rule such as "capital letter plus up to three lowercase" also
 * eats real sentences like `Done.` and `Yes.`, which would drop punch-ins.
 */
const ABBREVIATION = /^(?:[A-Z]|\d+)\.$/;
const ABBREVIATION_WORDS = new Set([
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'sr.',
  'jr.',
  'st.',
  'vs.',
  'etc.',
  'e.g.',
  'i.e.',
  'a.m.',
  'p.m.',
  'no.',
  'fig.',
]);

export type Sentence = {
  index: number;
  start: number;
  end: number;
  firstWordIndex: number;
  lastWordIndex: number;
  text: string;
};

export type AutoZoomOptions = {
  scale: number;
  maxDurationSec: number;
  timeline: Timeline;
  /** Skip a punch-in when the previous sentence already had one. */
  alternate?: boolean;
};

export function splitSentences(words: WordToken[]): Sentence[] {
  const sentences: Sentence[] = [];
  let firstWordIndex = 0;

  const flush = (lastWordIndex: number) => {
    if (lastWordIndex < firstWordIndex) {
      return;
    }
    const slice = words.slice(firstWordIndex, lastWordIndex + 1);
    const first = slice[0]!;
    const last = slice.at(-1)!;
    sentences.push({
      index: sentences.length,
      start: first.start,
      end: Math.max(last.end, first.start),
      firstWordIndex,
      lastWordIndex,
      text: slice.map(w => w.text).join(' ').replace(/\s+([.,!?;:])/g, '$1'),
    });
    firstWordIndex = lastWordIndex + 1;
  };

  words.forEach((word, index) => {
    if (isSentenceEnd(word.text)) {
      flush(index);
    }
  });
  flush(words.length - 1);

  return sentences;
}

export function isSentenceEnd(rawToken: string): boolean {
  const token = rawToken.trim();
  if (!token || !SENTENCE_END.test(token)) {
    return false;
  }
  if (ABBREVIATION.test(token) || ABBREVIATION_WORDS.has(token.toLowerCase())) {
    return false;
  }
  return true;
}

export function detectZoomTriggers(
  words: WordToken[],
  options: AutoZoomOptions,
): ZoomTrigger[] {
  const {scale, maxDurationSec, timeline} = options;
  const alternate = options.alternate ?? true;
  const sentences = splitSentences(words);
  const triggers: ZoomTrigger[] = [];
  let previousZoomed = false;

  // Sentence 0 has no preceding boundary, so punch-ins start at sentence 1.
  for (let i = 1; i < sentences.length; i += 1) {
    const sentence = sentences[i]!;
    if (alternate && previousZoomed) {
      previousZoomed = false;
      continue;
    }

    const start = timeline.mapSourceToOutputClamped(sentence.start);
    const rawEnd = timeline.mapSourceToOutputClamped(sentence.end);
    const end = Math.min(rawEnd, start + maxDurationSec);
    if (end - start < 0.35) {
      previousZoomed = false;
      continue;
    }

    triggers.push({
      start: round(start),
      end: round(end),
      scale,
      sentenceIndex: sentence.index,
    });
    previousZoomed = true;
  }

  return triggers;
}

export function resolveDirectedZooms(input: {
  directed: Array<{timestamp: number; durationSec: number}>;
  words: WordToken[];
  timeline: Timeline;
  scale: number;
  maxDurationSec: number;
  blockedRanges: Array<{start: number; end: number}>;
}): ZoomTrigger[] {
  const sentences = splitSentences(input.words);
  const fromDirector = input.directed
    .map(zoom => {
      const start = input.timeline.mapSourceToOutputClamped(zoom.timestamp);
      const end = Math.min(
        start + Math.min(input.maxDurationSec, Math.max(1.2, zoom.durationSec)),
        input.timeline.outputDurationSec,
      );
      if (end - start < 0.5 || start < 3.4) {
        return null;
      }
      if (overlapsBlocked(start, end, input.blockedRanges)) {
        return null;
      }
      const sentence = sentences.find(
        item =>
          input.timeline.mapSourceToOutputClamped(item.start) <= start &&
          input.timeline.mapSourceToOutputClamped(item.end) >= start,
      );
      return {
        start: round(start),
        end: round(end),
        scale: input.scale,
        sentenceIndex: sentence?.index ?? 0,
      } satisfies ZoomTrigger;
    })
    .filter((zoom): zoom is ZoomTrigger => Boolean(zoom));

  if (input.directed.length > 0) {
    return spaceZooms(fromDirector, 8);
  }

  return detectSparseZoomTriggers(input.words, {
    scale: input.scale,
    maxDurationSec: Math.min(2, input.maxDurationSec),
    timeline: input.timeline,
    blockedRanges: input.blockedRanges,
  });
}

export function detectSparseZoomTriggers(
  words: WordToken[],
  options: AutoZoomOptions & {blockedRanges?: Array<{start: number; end: number}>},
): ZoomTrigger[] {
  const sentences = splitSentences(words);
  const scored = sentences
    .filter(sentence => sentence.index > 0)
    .map(sentence => ({
      sentence,
      score: emphasisScore(sentence, words),
    }))
    .filter(row => row.score >= 1.2)
    .sort((a, b) => b.score - a.score || a.sentence.start - b.sentence.start);

  const pool =
    scored.length > 0
      ? scored.map(row => row.sentence)
      : sentences.filter(sentence => sentence.index > 0).slice(0, 4);

  const triggers: ZoomTrigger[] = [];
  for (const sentence of pool) {
    const start = options.timeline.mapSourceToOutputClamped(sentence.start);
    const end = Math.min(
      options.timeline.mapSourceToOutputClamped(sentence.end),
      start + Math.min(1.8, options.maxDurationSec),
    );
    if (start < 4 || end - start < 0.5) {
      continue;
    }
    if (overlapsBlocked(start, end, options.blockedRanges ?? [])) {
      continue;
    }
    if (triggers.some(zoom => Math.abs(zoom.start - start) < 9)) {
      continue;
    }
    triggers.push({
      start: round(start),
      end: round(end),
      scale: options.scale,
      sentenceIndex: sentence.index,
    });
    if (triggers.length >= 3) {
      break;
    }
  }
  return triggers.sort((a, b) => a.start - b.start);
}

/**
 * Cheap prosody proxy from ASR timing: slower / punched words and !? beats
 * score higher than flat filler sentences.
 */
export function emphasisScore(sentence: Sentence, words: WordToken[]): number {
  const slice = words.slice(sentence.firstWordIndex, sentence.lastWordIndex + 1);
  if (slice.length === 0) {
    return 0;
  }
  let score = 0;
  if (/!/.test(sentence.text)) {
    score += 2.2;
  }
  if (/\?/.test(sentence.text)) {
    score += 1.4;
  }
  if (
    /\b(never|always|must|need|important|secret|truth|actually|remember|listen)\b/i.test(
      sentence.text,
    )
  ) {
    score += 1.3;
  }
  const durations = slice.map(word => Math.max(0.05, word.end - word.start));
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const max = Math.max(...durations);
  if (max > avg * 1.65 && max > 0.28) {
    score += 1.1;
  }
  const wordCount = sentence.text.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 6 && wordCount <= 14) {
    score += 0.6;
  }
  if (wordCount <= 3) {
    score -= 0.4;
  }
  return score;
}

function overlapsBlocked(
  start: number,
  end: number,
  ranges: Array<{start: number; end: number}>,
): boolean {
  return ranges.some(range => start < range.end - 0.15 && end > range.start + 0.15);
}

function spaceZooms(zooms: ZoomTrigger[], minGapSec: number): ZoomTrigger[] {
  const out: ZoomTrigger[] = [];
  for (const zoom of [...zooms].sort((a, b) => a.start - b.start)) {
    const previous = out.at(-1);
    if (previous && zoom.start < previous.end + minGapSec) {
      continue;
    }
    out.push(zoom);
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

/**
 * Project ASR words onto the output timeline for caption rendering.
 *
 * Words that land inside a cut are dropped — by construction those are silence
 * artifacts, not speech.
 */
export function buildCaptionWords(
  words: WordToken[],
  timeline: Timeline,
): CaptionWord[] {
  const sentences = splitSentences(words);
  const sentenceByWordIndex = new Map<number, number>();
  for (const sentence of sentences) {
    for (let i = sentence.firstWordIndex; i <= sentence.lastWordIndex; i += 1) {
      sentenceByWordIndex.set(i, sentence.index);
    }
  }

  const out: CaptionWord[] = [];
  words.forEach((word, index) => {
    const start = timeline.mapSourceToOutput(word.start);
    if (start === null) {
      return;
    }
    const end = timeline.mapSourceToOutputClamped(word.end);
    out.push({
      text: word.text,
      start: round(start),
      end: round(Math.max(start + 0.08, end)),
      sentenceIndex: sentenceByWordIndex.get(index) ?? 0,
    });
  });

  // Cuts can collapse two words onto the same instant; keep captions monotonic.
  for (let i = 1; i < out.length; i += 1) {
    const previous = out[i - 1]!;
    const current = out[i]!;
    if (current.start < previous.start) {
      current.start = previous.start;
    }
    if (previous.end > current.start) {
      previous.end = round(Math.max(previous.start + 0.08, current.start));
    }
  }

  return out;
}
