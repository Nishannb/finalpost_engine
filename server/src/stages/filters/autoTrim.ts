/**
 * Stage B.1 — Auto-Trim (silence + filler cleanup).
 *
 * Pure arithmetic over the ASR word map: long inter-word gaps and isolated
 * filler tokens become exclusion ranges. No GPU model, no second pass over the
 * media, and it shortens the output, which directly lowers Stage E render cost.
 */

import type {KeepSegment, TimeRange, WordToken} from '../../types/blueprint.ts';
import {round} from './timeline.ts';

export type AutoTrimOptions = {
  /** Gaps longer than this (seconds) are cut. */
  thresholdSec: number;
  /** Silence retained on each side of a cut so speech does not sound clipped. */
  paddingSec: number;
  sourceDurationSec: number;
  /** Drop um/uh-style fillers when they are short and isolated. */
  removeFillers?: boolean;
  /**
   * WP7G (cuts profile only): cut yeah / yep / yup even when ASR glued them mid-phrase ("and yeah that works"). Product priority on the cuts path is a clean cut over keeping a casual
   * "yeah". yes / no / content words are never matched. Default false: legacy and mvp keep the WP7E edge-only rule.
   */
  aggressiveBackchannel?: boolean;
  /**
   * Local VAD speech regions on the same clock as `words`. null/omitted/empty = legacy ASR-gap cutter. When non-empty, only the leading / inter-word / trailing gap cuts change.
   */
  speechRegions?: TimeRange[] | null;
  /** Pause shaping used only together with non-empty `speechRegions`. */
  pausePolicy?: {intentionalMaxSec: number; preservedSec: number; minGapSec: number};
};

export type AutoTrimResult = {
  trimExclusions: TimeRange[];
  keepSegments: KeepSegment[];
  removedSec: number;
  /** Why we kept the original length, if a safety guard fired. */
  skipped?: 'no_words' | 'sparse_speech' | 'would_remove_too_much';
};

/** Cuts shorter than this are not worth the extra timeline seam. */
const MIN_CUT_SEC = 0.05;
/** Whisper on music/animation often returns 1–2 tokens; that map is not a silence timeline. */
const MIN_WORDS_TO_TRIM = 6;
/** Never throw away most of the source because ASR missed the speech. */
const MAX_REMOVAL_FRAC = 0.4;
const MIN_KEEP_FRAC = 0.55;
const MIN_KEEP_SEC = 3;

/** Safe fillers only — never "like" / "you know" (too often real speech). */
const FILLER_TOKEN =
  /^(um+|uh+|uhm+|erm+|hm+|hmm+|ah+|eh+|mm+|mhm+|huh|uhhuh|uh-huh)[,.!?]*$/i;

/** WP6E: ASR often wraps a hesitation in quotes, brackets, ellipses or dashes ("um...", "(um)", "—uh", "\"hmm\""): strip that before judging the token. */
const WRAP_PUNCT = /^[\s"'`\u201c\u201d\u2018\u2019()[\]{}<>*_.,!?;:\u2026\-\u2013\u2014]+|[\s"'`\u201c\u201d\u2018\u2019()[\]{}<>*_.,!?;:\u2026\-\u2013\u2014]+$/g;
const stripWrap = (raw: string): string => raw.replace(WRAP_PUNCT, '');

/**
 * WP6A: hesitation SOUNDS that are never real words (um, uh, uhm, erm, hm, hmm, mm, mhm). Whisper often glues these to the neighbouring words (gaps under 0.04 s), and the
 * "mid-phrase rush" guard below then left them in the edit. For these tokens only, a tight gap no longer protects them. "ah", "eh", "huh" stay under the old guard: they can be speech.
 */
const HESITATION_TOKEN = /^(um+|uh+|uhm+|uhh+m*|erm+|ehm+|ahm+|hm+|hmm+|mm+|mhm+|mmhm+)[,.!?]*$/i;

/**
 * WP7E: backchannel interjections (yeah, yep, yup and close ASR spellings). Unlike hesitation sounds these can be real words, so they are cut only when they sit at the edge of a phrase
 * (a pause on at least one side), are short, or are stacked ("yeah yeah"). A glued mid-sentence "yeah" ("and yeah that works") is left alone. "yes" and "no" are never matched.
 */
const BACKCHANNEL_TOKEN = /^(ye+a*h+|yeh+|yea+h*|yep+|yup+|yah+|yeap)$/i;
const BACKCHANNEL_MAX_SEC = 0.7;
const BACKCHANNEL_EDGE_GAP_SEC = 0.15;

export function isBackchannelToken(raw: string): boolean {
  return BACKCHANNEL_TOKEN.test(stripWrap(raw));
}

export function autoTrimSilence(
  words: WordToken[],
  options: AutoTrimOptions,
): AutoTrimResult {
  const duration = Math.max(0, options.sourceDurationSec);
  const intact = (): AutoTrimResult => ({
    trimExclusions: [],
    keepSegments: [{sourceStart: 0, sourceEnd: duration, outputStart: 0}],
    removedSec: 0,
  });

  if (words.length === 0 || duration <= 0) {
    return {...intact(), skipped: words.length === 0 ? 'no_words' : undefined};
  }
  if (words.length < MIN_WORDS_TO_TRIM) {
    return {...intact(), skipped: 'sparse_speech'};
  }

  const threshold = Math.max(0.05, options.thresholdSec);
  const padding = Math.max(0, options.paddingSec);
  const removeFillers = options.removeFillers !== false;

  const sorted = [...words].sort((a, b) => a.start - b.start);
  const first = sorted[0]!;
  const lastWord = sorted.at(-1)!;
  const exclusions: TimeRange[] = [];

  const regions = options.speechRegions;
  if (regions && regions.length > 0) {
    vadGapCuts(exclusions, sorted, regions, {
      duration,
      threshold,
      padding,
      policy: options.pausePolicy,
    });
  } else {
    // Dead air before the first word has no preceding speech to protect, so it is
    // cut from zero rather than from `padding`.
    if (first.start > threshold) {
      pushCut(exclusions, 0, first.start - padding);
    }

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      const gap = next.start - current.end;
      if (gap <= threshold) {
        continue;
      }
      pushCut(exclusions, current.end + padding, next.start - padding);
    }

    const tailGap = duration - lastWord.end;
    if (tailGap > threshold) {
      pushCut(exclusions, lastWord.end + padding, duration);
    }
  }

  if (removeFillers) {
    for (let i = 0; i < sorted.length; i += 1) {
      const token = sorted[i]!;
      const backchannel = isBackchannelToken(token.text);
      if (!backchannel && !isFillerToken(token.text)) {
        continue;
      }
      const span = token.end - token.start;
      if (span > (backchannel ? BACKCHANNEL_MAX_SEC : 0.85)) {
        continue;
      }
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const gapBefore = prev ? token.start - prev.end : 0.4;
      const gapAfter = next ? next.start - token.end : 0.4;
      if (backchannel && !options.aggressiveBackchannel) {
        const stacked = Boolean((prev && isBackchannelToken(prev.text)) || (next && isBackchannelToken(next.text)));
        if (!stacked && gapBefore < BACKCHANNEL_EDGE_GAP_SEC && gapAfter < BACKCHANNEL_EDGE_GAP_SEC) {
          continue;
        }
      }
      // Only cut fillers that sit in a slight hesitation, not mid-phrase rush. WP6A: a pure hesitation sound (um/uh/hm...) is cut even when ASR glued it to its neighbours, with a
      // smaller safety pad so the words next to it are not clipped.
      const tight = gapBefore < 0.04 && gapAfter < 0.04;
      if (tight && !HESITATION_TOKEN.test(stripWrap(token.text)) && !(backchannel && options.aggressiveBackchannel)) {
        continue;
      }
      const edgePad = tight ? Math.min(padding, 0.015) : Math.min(padding, 0.06);
      const from = Math.max(
        prev ? prev.end + edgePad : token.start,
        token.start - 0.02,
      );
      const to = Math.min(
        next ? next.start - edgePad : token.end,
        token.end + 0.02,
      );
      pushCut(exclusions, from, to);
    }
  }

  const merged = mergeRanges(exclusions);
  const keepSegments = keepSegmentsFor(merged, duration);
  const removedSec = merged.reduce((total, range) => total + (range.end - range.start), 0);
  const keptSec = duration - removedSec;
  if (
    duration > 0 &&
    (removedSec / duration > MAX_REMOVAL_FRAC ||
      keptSec < Math.min(duration, Math.max(MIN_KEEP_SEC, duration * MIN_KEEP_FRAC)))
  ) {
    return {...intact(), skipped: 'would_remove_too_much'};
  }

  return {
    trimExclusions: merged.map(range => ({
      start: round(range.start),
      end: round(range.end),
    })),
    keepSegments,
    removedSec: round(removedSec),
  };
}

const WORD_EDGE_GUARD_SEC = 0.02;

/** Subranges of [from, to] not covered by any speech region. */
function inactiveWithin(from: number, to: number, regions: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = from;
  for (const region of mergeRanges(regions)) {
    if (region.end <= cursor) continue;
    if (region.start >= to) break;
    if (region.start > cursor) out.push({start: cursor, end: region.start});
    cursor = Math.max(cursor, region.end);
    if (cursor >= to) break;
  }
  if (cursor < to) out.push({start: cursor, end: to});
  return out;
}

function vadGapCuts(
  exclusions: TimeRange[],
  sorted: WordToken[],
  regions: TimeRange[],
  ctx: {duration: number; threshold: number; padding: number; policy?: AutoTrimOptions['pausePolicy']},
): void {
  const {duration, padding, policy} = ctx;
  const minGap = Math.max(ctx.threshold, policy?.minGapSec ?? 0);
  const intentionalMax = policy?.intentionalMaxSec ?? 0;
  const preserved = Math.max(0, policy?.preservedSec ?? 0);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const guard = WORD_EDGE_GUARD_SEC;

  /** Cut inactive subranges of [from, to], inset by padding except at the clip boundaries; never enter [allowFrom, allowTo]'s outside. */
  const cutInset = (from: number, to: number, allowFrom: number, allowTo: number): void => {
    for (const sub of inactiveWithin(Math.max(0, from), Math.min(duration, to), regions)) {
      const s = sub.start <= 0 ? 0 : sub.start + padding;
      const e = sub.end >= duration ? duration : sub.end - padding;
      pushCut(exclusions, Math.max(s, allowFrom), Math.min(e, allowTo));
    }
  };

  if (first.start > minGap) {
    cutInset(0, first.start, 0, first.start - guard);
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    const gap = next.start - current.end;
    if (gap <= minGap) continue;
    const allowFrom = current.end + guard;
    const allowTo = next.start - guard;
    if (gap <= intentionalMax) {
      for (const sub of inactiveWithin(current.end, next.start, regions)) {
        const excess = sub.end - sub.start - preserved;
        if (excess < MIN_CUT_SEC) continue;
        pushCut(
          exclusions,
          Math.max(sub.start + preserved / 2, allowFrom),
          Math.min(sub.end - preserved / 2, allowTo),
        );
      }
    } else {
      cutInset(current.end, next.start, allowFrom, allowTo);
    }
  }

  if (duration - last.end > minGap) {
    cutInset(last.end, duration, last.end + guard, duration);
  }
}

export function isFillerToken(raw: string): boolean {
  const core = stripWrap(raw);
  return FILLER_TOKEN.test(core) || HESITATION_TOKEN.test(core);
}

function pushCut(target: TimeRange[], start: number, end: number): void {
  const from = Math.max(0, start);
  const to = Math.max(from, end);
  if (to - from >= MIN_CUT_SEC) {
    target.push({start: from, end: to});
  }
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({...range});
  }
  return merged;
}

/** Complement of the cut ranges, stamped with running output offsets. */
export function keepSegmentsFor(
  exclusions: TimeRange[],
  sourceDurationSec: number,
): KeepSegment[] {
  const segments: KeepSegment[] = [];
  let cursor = 0;
  let outputStart = 0;

  for (const range of mergeRanges(exclusions)) {
    if (range.start > cursor) {
      const sourceEnd = Math.min(range.start, sourceDurationSec);
      if (sourceEnd > cursor) {
        segments.push({
          sourceStart: round(cursor),
          sourceEnd: round(sourceEnd),
          outputStart: round(outputStart),
        });
        outputStart += sourceEnd - cursor;
      }
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < sourceDurationSec) {
    segments.push({
      sourceStart: round(cursor),
      sourceEnd: round(sourceDurationSec),
      outputStart: round(outputStart),
    });
  }

  if (segments.length === 0) {
    segments.push({sourceStart: 0, sourceEnd: sourceDurationSec, outputStart: 0});
  }
  return segments;
}
