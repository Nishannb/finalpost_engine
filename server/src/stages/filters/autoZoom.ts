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
  TimeRange,
  WordToken,
  ZoomTrigger,
} from '../../types/blueprint.ts';
import {isMvpLikeProfile, type ProductEditProfile} from '../../lib/productEditProfile.ts';
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

/** Punch-in scale a Director may request; anything outside is ignored (the configured default applies). */
export const ZOOM_SCALE_BOUNDS = {min: 1.05, max: 1.6} as const;

/** The requested scale when it is a finite number inside the supported bounds, otherwise undefined. */
export function normalizeZoomScale(value: unknown): number | undefined {
  const scale = Number(value);
  if (value == null || value === '' || !Number.isFinite(scale)) {
    return undefined;
  }
  return scale >= ZOOM_SCALE_BOUNDS.min && scale <= ZOOM_SCALE_BOUNDS.max ? round(scale) : undefined;
}

/** A focus is usable only when both coordinates are finite and inside the frame (0–1). */
export function normalizeZoomFocus(value: unknown): {x: number; y: number} | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const {x, y} = value as {x?: unknown; y?: unknown};
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? {x: round(x), y: round(y)} : undefined;
}

export type DirectedZoomInput = {timestamp: number; durationSec: number; scale?: number; focus?: {x: number; y: number}};

export function resolveDirectedZooms<Z extends DirectedZoomInput>(input: {
  directed: Z[];
  words: WordToken[];
  timeline: Timeline;
  /** Default punch-in scale, used when the Director gave none or an unsupported one. */
  scale: number;
  maxDurationSec: number;
  /**
   * Not consulted here: cutaway/overlay/depth/inset overlap is decided earlier by the editorial gate
   * (`zoom_blocked_by_cutaway_or_overlay`). Kept so callers can pass the ranges for documentation.
   */
  blockedRanges?: Array<{start: number; end: number}>;
  /** The Director's times are already output-timeline seconds (Director v2 / north-star). */
  alreadyOutput?: boolean;
  /**
   * Visual-evidence gate for a zoom focus (VISUAL_CONTEXT_V2). Returns a reason to refuse the focus (the zoom itself is
   * kept, aimed at the default origin) or null to accept it. Absent: any in-range focus is accepted (legacy).
   */
  focusEvidence?: (zoom: Z, window: {start: number; end: number}, focus: {x: number; y: number}) => string | null;
  trace?: {keep: (zoom: Z, trigger: ZoomTrigger, note?: string) => void; drop: (zoom: Z, reason: string) => void};
}): ZoomTrigger[] {
  const sentences = splitSentences(input.words);
  const toOutput = (sec: number) =>
    input.alreadyOutput ? Math.min(Math.max(0, sec), input.timeline.outputDurationSec) : input.timeline.mapSourceToOutputClamped(sec);
  const triggers: ZoomTrigger[] = [];
  for (const zoom of input.directed) {
    const start = toOutput(zoom.timestamp);
    const end = Math.min(start + Math.max(0, zoom.durationSec), input.timeline.outputDurationSec);
    if (end - start < 0.05) {
      input.trace?.drop(zoom, 'zoom_has_no_duration_after_timeline_mapping');
      continue;
    }
    const sentence = sentences.find(
      item => toOutput(item.start) <= start && toOutput(item.end) >= start,
    );
    const requested = normalizeZoomScale(zoom.scale);
    let focus = normalizeZoomFocus(zoom.focus);
    const refusedFocus = focus ? input.focusEvidence?.(zoom, {start: round(start), end: round(end)}, focus) ?? null : null;
    if (refusedFocus) {
      focus = undefined;
    }
    const trigger: ZoomTrigger = {
      start: round(start),
      end: round(end),
      scale: requested ?? input.scale,
      ...(focus ? {focus} : {}),
      sentenceIndex: sentence?.index ?? 0,
    };
    const notes = [
      zoom.scale === undefined ? '' : requested === undefined ? `zoom_scale_${zoom.scale}_unsupported_default_${input.scale}_used` : `zoom_scale_${requested}`,
      zoom.focus === undefined ? '' : refusedFocus ? `zoom_focus_dropped:${refusedFocus}` : focus ? `zoom_focus_${focus.x}_${focus.y}` : 'zoom_focus_out_of_range_ignored_default_origin_used',
    ].filter(Boolean);
    triggers.push(trigger);
    input.trace?.keep(zoom, trigger, notes.length > 0 ? notes.join(';') : undefined);
  }
  return triggers;
}

/**
 * WP4H: a zoom focus the Director picked against an UNMEASURED speaker box (the fake default one) can aim the punch at the wrong place and crop the real head. On the `mvp` profile with
 * occupancy `source === 'fallback'`, every zoom is kept (times, scale, sentence index) and its focus is dropped, so the renderer grows it from its default origin (50% 32%). A measured
 * speaker (`vision`), any other profile, and a zoom with no focus are unchanged (the same array / objects). `dropped` counts only zooms that had a focus. Pure.
 */
export function dropUnmeasuredZoomFocus(
  triggers: readonly ZoomTrigger[],
  context: {profile?: ProductEditProfile; source?: 'vision' | 'fallback'},
): {triggers: ZoomTrigger[]; dropped: number} {
  if (!isMvpLikeProfile(context.profile) || context.source !== 'fallback') return {triggers: [...triggers], dropped: 0};
  let dropped = 0;
  const next = triggers.map(trigger => {
    if (!trigger.focus) return trigger;
    dropped += 1;
    const {focus: _focus, ...rest} = trigger;
    return rest;
  });
  return {triggers: next, dropped};
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
      start + Math.min(2.6, options.maxDurationSec),
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
  /** WP7E: cut ranges (source seconds). A word whose midpoint is inside one is dropped even when its start edge maps onto a neighbouring kept segment, so captions match kept speech only. */
  exclusions: readonly TimeRange[] = [],
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
    const middle = (word.start + word.end) / 2;
    if (exclusions.some(range => middle >= range.start && middle <= range.end)) {
      return;
    }
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
