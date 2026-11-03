/**
 * WP7I: AI keep-plan for the `cuts` profile. Brittle word-overlap matching cannot pair "redefined" with "revolutionized" or "collaboration" with "collaborative", so ONE cheap text-model call reads
 * the numbered transcript segments and says which source ranges make the polished short. The engine only validates and applies that answer.
 *
 *  - `buildKeepPlanSegments`: the ASR words split into numbered segments (a pause of `SEGMENT_GAP_SEC` or sentence-ending punctuation starts a new one). Hesitation sounds are not listed.
 *  - `buildKeepPlanPrompt`: the instruction + the segments. Schema (the one source of truth): `{"keep": [{"start": sec, "end": sec, "reason": "..."}], "notes": "..."}`; keep ranges are SOURCE seconds.
 *  - `parseKeepPlan`: tolerant of code fences; anything that is not that shape is `null`.
 *  - `applyAiKeepPlan`: pure. A word is kept when its midpoint is inside a keep range (so a range can never bleed into a neighbouring dropped word); everything else becomes a trim exclusion, clamped to
 *    [0, duration] and merged. GUARDS (any trip => `ok:false` with a reason, the caller falls back to the deterministic retake path and warns `cuts_ai_keep_plan_skipped:<reason>`):
 *      empty_plan / invalid_ranges (nothing usable), empty_timeline (no word kept), too_little_kept (< `MIN_KEPT_WORD_FRAC` of the words, or < `MIN_KEPT_WORDS`), would_remove_too_much (more than
 *      `MAX_SPEECH_REMOVAL_FRAC` of the SPOKEN time dropped), bad_timeline (the result would be shorter than the analyze keep floor).
 *    Silence between kept words is cut too (the silence pass does it anyway), so the guard is about SPEECH, not dead air.
 * WP7J HARDENING: (1) the prompt demands `ideas` then ONE best range per idea, treats same-meaning takes as one idea whatever the tense / verb / noun form, and says when in doubt DROP;
 * (2) `postScrub` runs after every accepted plan and gives the model NO veto: yeah / yep / yup words are removed, doubled words and lone one-word / echoed two-word stutter segments are removed, and
 * two kept segments about the same thing (light stem overlap) collapse to the longer one; (3) the keep-side guard around each cut is `KEEP_GUARD_SEC` (20 ms, was 80 ms) so a dropped neighbour's
 * audio cannot bleed into the kept side, and a word is kept only if its MIDPOINT is inside a kept range. Speech-removal guard is `MAX_SPEECH_REMOVAL_FRAC` 0.8: an aggressive clean plan is not a reason to
 * fall back (fallback is for empty / invalid / near-empty plans).
 * `requestAiKeepPlan` is the only function that touches the network (one `requestJson` call, labelled `cuts ai keep plan`, counted by the per-edit Gemini cap). The model never sees audio or video.
 */
import {env} from '../../config/env.ts';
import {requestJson} from '../../lib/http.ts';
import type {TimeRange, WordToken} from '../../types/blueprint.ts';
import {isBackchannelToken, isFillerToken} from './autoTrim.ts';
import {normalizeToken} from './scriptRetakeTrim.ts';
import {round} from './timeline.ts';

export type KeepRange = {start: number; end: number; reason?: string};
export type KeepPlan = {keep: KeepRange[]; ideas?: string[]; notes?: string};
export type KeepSegment = {index: number; start: number; end: number; text: string; /** Longest single-word duration in the segment (s). */ maxWordSec?: number; /** Words at or above `LONG_WORD_PROMPT_SEC`, e.g. `raised(3.18s)`. */ longWords?: string[]};

export type KeepPlanSkipReason =
  | 'empty_plan'
  | 'invalid_ranges'
  | 'empty_timeline'
  | 'too_little_kept'
  | 'would_remove_too_much'
  | 'bad_timeline'
  | 'no_words'
  | 'model_failed'
  | 'invalid_response'
  | 'disabled';

export type ScrubCounts = {yeah: number; stutter: number; dupe: number; stuck: number; restart: number};

export type ApplyKeepPlanResult =
  | {ok: true; exclusions: TimeRange[]; keepRanges: TimeRange[]; keptWords: number; totalWords: number; removedSpeechFrac: number; scrub: ScrubCounts}
  | {ok: false; reason: KeepPlanSkipReason; detail?: string};

const SEGMENT_GAP_SEC = 0.3;
const MIN_KEPT_WORD_FRAC = 0.2;
const MIN_KEPT_WORDS = 6;
const MAX_SPEECH_REMOVAL_FRAC = 0.8;
/** Keep-side guard left between a cut and the nearest kept word (the cut reaches to within this of the kept word, so dropped audio cannot bleed). */
const KEEP_GUARD_SEC = 0.02;
const EDGE_PAD_SEC = 0.04;
const DOUBLE_WORD_GAP_SEC = 0.6;
const DOUBLE_WORD_OK = new Set(['very', 'really', 'so', 'no', 'that', 'had', 'bye', 'ha', 'go', 'many', 'much']);
/** Shared content stems needed: 4, or 3 when the smaller segment has only 4 or fewer (a short abandoned take of a longer sentence). */
const DUPE_MIN_SHARED = 4;
const DUPE_MIN_SHARED_SHORT = 3;
/** Overlap coefficient (shared / size of the smaller stem set): a shorter take wholly inside a longer one scores high. */
const DUPE_MIN_OVERLAP = 0.6;
const STEM_STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'how', 'as', 'by', 'from', 'then', 'there', 'here', 'have', 'has', 'had', 'do', 'does', 'did', 'just', 'so', 'not', 'what', 'which', 'who', 'one', 'every', 'all']);
/** WP7K: a single word held this long (ASR word end - start) is a stuck / dragged word, never emphasis. The post-scrub removes it from the keep. */
export const STUCK_WORD_SEC = 1.5;
/** The prompt flags words from this duration so the model prefers a more fluent take before the scrub has to act. */
export const LONG_WORD_PROMPT_SEC = 1.2;
/** After a stuck token is cut out, a segment with fewer kept words than this is dropped whole (a fragment, not a sentence). */
const MIN_WORDS_AFTER_EXCISE = 3;
/** A fluent alternate take needs at least this many words to replace a take with a stuck word. */
const MIN_ALTERNATE_WORDS = 6;
/** Restart detection: the abandoned prefix is at most this many kept words long, with no stall of `RESTART_MAX_GAP_SEC` or more inside it. */
const RESTART_MAX_PREFIX = 10;
/** A partial repeat (abandoned prefix longer than the repeat) needs this many matching words; an abandoned prefix that is repeated WHOLE needs 2. */
const RESTART_MIN_REPEAT = 4;
const RESTART_MAX_GAP_SEC = 1;
/** Guard left between a cut and a kept word when the cut swallows a backchannel (yeah / ok ...): 0 = the cut covers the whole gap up to the kept words' ASR bounds (normal guard is `KEEP_GUARD_SEC`). */
const BACKCHANNEL_GUARD_SEC = 0;
const WEAK_BACKCHANNEL = new Set(['ok', 'okay']);
const STRONG_BACKCHANNEL = new Set(['mmhmm', 'mhm', 'mmhm', 'hmm', 'uhhuh', 'uhuh']);
/** The speech-removal guard counts a word as at most this long, so held / stuck words (WP7K removes them) do not push a clean aggressive plan over the cap. */
const MAX_GUARD_WORD_SEC = 0.6;
const MIN_CUT_SEC = 0.05;
const MIN_KEEP_FRAC = 0.1;
const MIN_KEEP_SEC = 2;
const MAX_PROMPT_SEGMENTS = 400;

const wordText = (word: WordToken): string => word.text.trim();

/** Numbered segments the model chooses from. Hesitation sounds (um, uh...) are left out of the text. */
export function buildKeepPlanSegments(words: readonly WordToken[]): KeepSegment[] {
  const sorted = [...words].filter(word => wordText(word) && !isFillerToken(wordText(word))).sort((a, b) => a.start - b.start);
  const out: KeepSegment[] = [];
  let current: WordToken[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const longWords = current.filter(word => word.end - word.start >= LONG_WORD_PROMPT_SEC).map(word => `${wordText(word)}(${round(word.end - word.start, 2)}s)`);
    const maxWordSec = round(Math.max(...current.map(word => word.end - word.start)), 2);
    out.push({index: out.length + 1, start: round(current[0]!.start), end: round(current[current.length - 1]!.end), text: current.map(wordText).join(' '), maxWordSec, ...(longWords.length > 0 ? {longWords} : {})});
    current = [];
  };
  for (const word of sorted) {
    const last = current[current.length - 1];
    if (last && word.start - last.end >= SEGMENT_GAP_SEC) flush();
    current.push(word);
    if (/[.!?…]["')\]]*$/.test(wordText(word))) flush();
  }
  flush();
  return out;
}

export function buildKeepPlanPrompt(segments: readonly KeepSegment[], sourceDurationSec: number): {system: string; user: string} {
  const system =
    'You are a surgical short-form video editor. You receive the numbered transcript segments of ONE raw, messy talking-head recording (the creator may be coached by an off-camera person who feeds lines). ' +
    'Leftovers from retakes (a repeated take, a stutter, a half sentence, a "yeah") are product defects: an under-cut mistake is worse than a shorter video. Reply with JSON only, no prose.';
  const user =
    `Source length: ${round(sourceDurationSec, 2)} s. Each segment is "[n] start-end text" (seconds in the SOURCE video).\n\n` +
    `GOAL: a tight, polished short made ONLY of necessary speech by the creator. When in doubt, DROP.\n\n` +
    `STEP 1 - "ideas": list every DISTINCT idea in the transcript, one short line each.\n` +
    `STEP 2 - "keep": for EACH idea exactly ONE source range: the single best, complete, fluent, final take. NEVER a second range for the same idea.\n\n` +
    `SAME-IDEA RULE (semantic, not word-for-word): two segments are the SAME idea when the meaning matches even if the tense, verb, noun form or wording differs. ` +
    `Examples: "revolutionized the space" = "redefined collaboration"; "collaboration" = "collaborative"; ` +
    `"raised millions", "raised over millions", "raised millions of dollars", "raised tens of millions" with "solving / focusing on one single problem" are ONE idea (keep the single most complete take); ` +
    `two "Figma highlighted how traditional design tools weren't built..." variants are ONE idea. Keep the most complete take, normally the last full one; drop every other variant.\n\n` +
    `NEVER KEEP: a segment that is only a backchannel ("yeah", "yep", "yup", "ok", "mm-hmm"); a one-word or two-word stutter echo ("Collaboration." alone, "productivity." alone); ` +
    `a repeat of a word already said; a broken or abandoned fragment ("How did it out?"); a line the off-camera coach says to the creator when the creator then performs it; a false start; a self-correction.\n` +
    `Never invent, reorder or edit words. Keep chronological order. Prefer cutting to keeping any doubtful shred.\n\n` +
    `SMOOTHNESS FIRST (equal to the same-idea rule): a segment can carry "LONG: word(3.18s)" - a word the creator held or got stuck on. A word held ${LONG_WORD_PROMPT_SEC}s+ is a delivery defect, NOT emphasis: an elongated "raised" (3s) or "traditional" (4s) is a stall. ` +
    `If another take of the same idea has no LONG word, KEEP THAT FLUENT TAKE even if it is shorter or a bit less complete; never keep a take with a stuck word when a fluent one exists. ` +
    `If EVERY take of an idea has a stuck word, keep the least-bad one; the engine will cut the stuck word out or drop it. ` +
    `SAME-LINE RESTART: if the creator begins a phrase, stalls, and repeats the phrase ("Here's how their... Here's how their pitch deck..."), keep only the fluent completion.\n\n` +
    `OUTPUT (strict JSON): {"ideas":["<idea 1>","<idea 2>"],"keep":[{"start":<sec>,"end":<sec>,"reason":"<short>"}],"notes":"<one line>"}\n` +
    `"keep" is what is applied. Use the exact start and end seconds of the segment you keep (adjacent kept segments of different ideas may be merged into one range only when both are kept). ` +
    `Ranges are ascending and do not overlap.\n\n` +
    segments.slice(0, MAX_PROMPT_SEGMENTS).map(segment => `[${segment.index}] ${segment.start}-${segment.end} ${segment.text}${segment.longWords?.length ? `  LONG: ${segment.longWords.join(', ')}` : ''}`).join('\n');
  return {system, user};
}

/** Parse the model text into a plan, or null when it is not `{keep: [{start,end}...]}`. */
export function parseKeepPlan(raw: string): KeepPlan | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as {keep?: unknown}).keep)) return null;
  const keep: KeepRange[] = [];
  for (const item of (value as {keep: unknown[]}).keep) {
    if (!item || typeof item !== 'object') continue;
    const {start, end, reason} = item as {start?: unknown; end?: unknown; reason?: unknown};
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    keep.push({start, end, ...(typeof reason === 'string' ? {reason: reason.slice(0, 160)} : {})});
  }
  const notes = (value as {notes?: unknown}).notes;
  const rawIdeas = (value as {ideas?: unknown}).ideas;
  const ideas = Array.isArray(rawIdeas) ? rawIdeas.filter((idea): idea is string => typeof idea === 'string').map(idea => idea.slice(0, 200)).slice(0, 60) : undefined;
  return {keep, ...(ideas && ideas.length > 0 ? {ideas} : {}), ...(typeof notes === 'string' ? {notes: notes.slice(0, 400)} : {})};
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end + 1e-6) last.end = Math.max(last.end, range.end);
    else out.push({...range});
  }
  return out;
}

/** Segment membership by word index (same split rule as `buildKeepPlanSegments`). */
function segmentIndexGroups(words: readonly WordToken[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  words.forEach((word, index) => {
    const last = current.length > 0 ? words[current[current.length - 1]!]! : null;
    if (last && word.start - last.end >= SEGMENT_GAP_SEC) {
      groups.push(current);
      current = [];
    }
    current.push(index);
    if (/[.!?…]["')\]]*$/.test(wordText(word))) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Crude stem for the safety-net duplicate check only (collaboration / collaborative / collaborate share a stem). Not a retake brain: the model decides, this only catches what it left behind. */
function stemOf(norm: string): string {
  const word = norm.replace(/s$/, '');
  return word.length >= 7 ? word.slice(0, 6) : word;
}

const contentStems = (norms: string[]): Set<string> => new Set(norms.filter(norm => !STEM_STOP.has(norm) && norm.length > 2).map(stemOf));

/**
 * WP7J post-scrub: the model gets no veto over these. Mutates `kept`. Order: (1) yeah / yep / yup words, (2) doubled words, (3) stutter segments (a lone one-word segment, or a two-word one whose
 * words all occur in another segment), (4) safety-net duplicates among the KEPT segments (>= 4 shared content stems and overlap coefficient >= 0.6: keep the longer, the later on a tie). A dropped take is never
 * brought back.
 */
function postScrub(words: readonly WordToken[], kept: boolean[]): ScrubCounts {
  const counts: ScrubCounts = {yeah: 0, stutter: 0, dupe: 0, stuck: 0, restart: 0};
  const norm = words.map(word => normalizeToken(word.text));
  const groups = segmentIndexGroups(words);
  const keptOf = (group: number[]) => group.filter(index => kept[index]);
  const alive = () => groups.filter(group => keptOf(group).length > 0);
  words.forEach((word, index) => {
    if (kept[index] && isBackchannelToken(wordText(word))) {
      kept[index] = false;
      counts.yeah += 1;
    }
  });
  // WP7K: mm-hmm / uh-huh are never content; ok / okay only when standalone (a kept segment of at most two words).
  for (const group of groups) {
    for (const index of keptOf(group)) {
      const token = norm[index]!;
      if (STRONG_BACKCHANNEL.has(token) || (WEAK_BACKCHANNEL.has(token) && keptOf(group).length <= 2)) {
        kept[index] = false;
        counts.yeah += 1;
      }
    }
  }
  for (let i = 0; i + 1 < words.length; i += 1) {
    if (kept[i] && kept[i + 1] && norm[i] && norm[i] === norm[i + 1] && !DOUBLE_WORD_OK.has(norm[i]!) && words[i + 1]!.start - words[i]!.end < DOUBLE_WORD_GAP_SEC) {
      kept[i] = false;
      counts.stutter += 1;
    }
  }
  for (const group of groups) {
    const mine = keptOf(group);
    if (mine.length === 0 || mine.length > 2 || alive().length < 2) continue;
    const tokens = mine.map(index => norm[index]!).filter(Boolean);
    const echoed = tokens.length === 2 && tokens.every(token => groups.some(other => other !== group && other.some(index => norm[index] === token)));
    if (tokens.length <= 1 || echoed) {
      for (const index of mine) kept[index] = false;
      counts.stutter += 1;
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    const live = alive();
    for (let i = 0; i < live.length && !changed; i += 1) {
      for (let j = i + 1; j < live.length && !changed; j += 1) {
        const a = contentStems(keptOf(live[i]!).map(index => norm[index]!));
        const b = contentStems(keptOf(live[j]!).map(index => norm[index]!));
        const shared = [...a].filter(stem => b.has(stem)).length;
        const smaller = Math.min(a.size, b.size);
        if (shared < (smaller <= 4 ? DUPE_MIN_SHARED_SHORT : DUPE_MIN_SHARED) || shared / smaller < DUPE_MIN_OVERLAP) continue;
        const loser = keptOf(live[i]!).length > keptOf(live[j]!).length ? live[j]! : live[i]!;
        for (const index of loser) kept[index] = false;
        counts.dupe += 1;
        changed = true;
      }
    }
  }
  restartScrub(words, kept, norm, counts);
  fluencyScrub(words, kept, norm, groups, counts);
  return counts;
}

/** WP7K: an immediate phrase restart among the kept words ("here's how their ... here's how their pitch deck") keeps the later completion and drops the abandoned prefix. Mutates `kept`. */
function restartScrub(words: readonly WordToken[], kept: boolean[], norm: string[], counts: ScrubCounts): void {
  for (let changed = true; changed; ) {
    changed = false;
    const order = words.map((_, index) => index).filter(index => kept[index] && norm[index]);
    for (let j = 1; j < order.length && !changed; j += 1) {
      for (let back = 1; back <= RESTART_MAX_PREFIX && j - back >= 0 && !changed; back += 1) {
        const i = j - back;
        let run = 0;
        while (j + run < order.length && i + run < j && norm[order[i + run]!] === norm[order[j + run]!]) run += 1;
        const wholePrefix = i + run >= j;
        if (run < (wholePrefix ? 2 : RESTART_MIN_REPEAT)) continue;
        let stalled = false;
        for (let k = i; k < j + run - 1 && !stalled; k += 1) stalled = words[order[k + 1]!]!.start - words[order[k]!]!.end >= RESTART_MAX_GAP_SEC;
        if (stalled) continue;
        for (let k = i; k < j; k += 1) kept[order[k]!] = false;
        counts.restart += 1;
        changed = true;
      }
    }
  }
}

const VERB_LIKE = /(?:ed|ing)$/;

/**
 * WP7K fluency scrub (after the dupe collapse). A kept word held `STUCK_WORD_SEC`+ is a defect. Per segment: (1) swap to a FLUENT alternate take of the same idea already in the transcript (dupe-level stem
 * overlap, every word under the limit, >= `MIN_ALTERNATE_WORDS` words, no backchannel, nothing kept in between); else (2) cut the stuck token out and join the neighbours - but a stuck verb-like word
 * ("raised", "revolutionized") in the middle of the sentence is load-bearing, so the whole take is dropped instead; (3) a segment left with fewer than `MIN_WORDS_AFTER_EXCISE` words is dropped. Shorter wins.
 */
function fluencyScrub(words: readonly WordToken[], kept: boolean[], norm: string[], groups: number[][], counts: ScrubCounts): void {
  const dur = (index: number) => words[index]!.end - words[index]!.start;
  const keptOf = (group: number[]) => group.filter(index => kept[index]);
  const stemsOf = (group: number[]) => contentStems(group.map(index => norm[index]!));
  const sharedEnough = (a: Set<string>, b: Set<string>) => {
    const shared = [...a].filter(stem => b.has(stem)).length;
    const smaller = Math.min(a.size, b.size);
    return shared >= (smaller <= 4 ? DUPE_MIN_SHARED_SHORT : DUPE_MIN_SHARED) && shared / smaller >= DUPE_MIN_OVERLAP;
  };
  groups.forEach((group, groupIndex) => {
    const mine = keptOf(group);
    const stuck = mine.filter(index => dur(index) >= STUCK_WORD_SEC);
    if (stuck.length === 0) return;
    counts.stuck += 1;
    const myStems = stemsOf(mine);
    let best: number[] | null = null;
    groups.forEach((other, otherIndex) => {
      if (otherIndex === groupIndex || keptOf(other).length > 0 || other.length < MIN_ALTERNATE_WORDS) return;
      if (other.some(index => dur(index) >= STUCK_WORD_SEC || isBackchannelToken(wordText(words[index]!)))) return;
      if (!sharedEnough(myStems, stemsOf(other))) return;
      const [from, to] = otherIndex < groupIndex ? [otherIndex, groupIndex] : [groupIndex, otherIndex];
      if (groups.slice(from + 1, to).some(between => keptOf(between).length > 0)) return;
      if (!best || other.length > best.length) best = other;
    });
    if (best) {
      for (const index of mine) kept[index] = false;
      for (const index of best as number[]) kept[index] = true;
      return;
    }
    const loadBearing = stuck.some(index => VERB_LIKE.test(norm[index]!) && index !== mine[0] && index !== mine[mine.length - 1]);
    if (loadBearing) {
      for (const index of mine) kept[index] = false;
      return;
    }
    for (const index of stuck) kept[index] = false;
    if (keptOf(group).length < MIN_WORDS_AFTER_EXCISE) for (const index of keptOf(group)) kept[index] = false;
  });
}

/** Validate a plan against the words, scrub it, and turn it into trim exclusions (see the header for the guards). Pure. */
export function applyAiKeepPlan(input: {words: readonly WordToken[]; plan: KeepPlan | null; sourceDurationSec: number}): ApplyKeepPlanResult {
  const duration = Math.max(0, input.sourceDurationSec);
  const words = [...input.words].filter(word => wordText(word) && !isFillerToken(wordText(word))).sort((a, b) => a.start - b.start);
  if (words.length === 0 || duration <= 0) return {ok: false, reason: 'no_words'};
  if (!input.plan || input.plan.keep.length === 0) return {ok: false, reason: 'empty_plan'};

  const ranges = mergeRanges(
    input.plan.keep
      .map(range => ({start: Math.max(0, Math.min(range.start, range.end)), end: Math.min(duration, Math.max(range.start, range.end))}))
      .filter(range => range.end - range.start > 0.05),
  );
  if (ranges.length === 0) return {ok: false, reason: 'invalid_ranges'};

  // A word is kept only when its MIDPOINT is inside a range: a range that starts a few ms early into a retake word cannot keep that word.
  const kept = words.map(word => {
    const middle = (word.start + word.end) / 2;
    return ranges.some(range => middle >= range.start && middle <= range.end);
  });
  if (kept.every(flag => !flag)) return {ok: false, reason: 'empty_timeline'};
  const scrub = postScrub(words, kept);
  const keptWords = kept.filter(Boolean).length;
  if (keptWords === 0) return {ok: false, reason: 'empty_timeline', detail: 'post-scrub removed everything'};
  if (keptWords < MIN_KEPT_WORDS || keptWords / words.length < MIN_KEPT_WORD_FRAC) return {ok: false, reason: 'too_little_kept', detail: `${keptWords}/${words.length} words`};

  const speech = (flag: boolean) => words.reduce((total, word, index) => (kept[index] === flag ? total + Math.min(MAX_GUARD_WORD_SEC, word.end - word.start) : total), 0);
  const removedSpeechFrac = speech(false) / Math.max(1e-9, speech(true) + speech(false));
  if (removedSpeechFrac > MAX_SPEECH_REMOVAL_FRAC) return {ok: false, reason: 'would_remove_too_much', detail: `${round(removedSpeechFrac, 3)} of speech`};

  // Exclusions: before the first kept word, between kept runs when a dropped word sits there, and after the last kept word. The cut reaches to within KEEP_GUARD_SEC of the kept words.
  const exclusions: TimeRange[] = [];
  const keepRanges: TimeRange[] = [];
  const pushCut = (start: number, end: number) => {
    const from = Math.max(0, start);
    const to = Math.min(duration, end);
    if (to - from >= MIN_CUT_SEC) exclusions.push({start: round(from), end: round(to)});
  };
  let previous = -1;
  let runStart = -1;
  words.forEach((word, index) => {
    if (!kept[index]) return;
    if (previous < 0) {
      pushCut(0, word.start - Math.min(KEEP_GUARD_SEC, word.start / 2));
      runStart = index;
    } else if (index - previous > 1) {
      const gap = word.start - words[previous]!.end;
      const swallowsBackchannel = words.slice(previous + 1, index).some(between => isBackchannelToken(wordText(between)) || STRONG_BACKCHANNEL.has(normalizeToken(between.text)) || WEAK_BACKCHANNEL.has(normalizeToken(between.text)));
      const guard = swallowsBackchannel ? BACKCHANNEL_GUARD_SEC : Math.min(KEEP_GUARD_SEC, Math.max(0, gap) / 4);
      pushCut(words[previous]!.end + guard, word.start - guard);
      keepRanges.push({start: round(words[runStart]!.start), end: round(words[previous]!.end)});
      runStart = index;
    }
    previous = index;
  });
  keepRanges.push({start: round(words[runStart]!.start), end: round(words[previous]!.end)});
  pushCut(words[previous]!.end + EDGE_PAD_SEC, duration);

  const merged = mergeRanges(exclusions);
  const removedSec = merged.reduce((total, range) => total + (range.end - range.start), 0);
  const keptSec = duration - removedSec;
  if (keptSec < Math.min(duration, Math.max(MIN_KEEP_SEC, duration * MIN_KEEP_FRAC))) return {ok: false, reason: 'bad_timeline', detail: `${round(keptSec, 2)} s kept`};
  return {ok: true, exclusions: merged, keepRanges, keptWords, totalWords: words.length, removedSpeechFrac: round(removedSpeechFrac, 4), scrub};
}

type GeminiResponse = {candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>};

export type RequestedKeepPlan = {plan: KeepPlan | null; raw: string; model: string; reason?: KeepPlanSkipReason};

/** The one network call. Never throws: a failure is `{plan: null, reason}` and the caller falls back to the deterministic path. */
export async function requestAiKeepPlan(input: {words: readonly WordToken[]; sourceDurationSec: number; model?: string}): Promise<RequestedKeepPlan> {
  const model = input.model || env.GEMINI_MODEL || 'gemini-3.6-flash';
  const segments = buildKeepPlanSegments(input.words);
  if (segments.length === 0) return {plan: null, raw: '', model, reason: 'no_words'};
  const {system, user} = buildKeepPlanPrompt(segments, input.sourceDurationSec);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  try {
    const body = await requestJson<GeminiResponse>(url, {
      method: 'POST',
      label: 'cuts ai keep plan',
      failureCode: 'internal',
      timeoutMs: 60_000,
      retries: 1,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: system}]},
        contents: [{role: 'user', parts: [{text: user}]}],
        generationConfig: {temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json'},
      }),
    });
    const raw = (body.candidates?.[0]?.content?.parts ?? []).map(part => part.text ?? '').join('').trim();
    const plan = parseKeepPlan(raw);
    return plan ? {plan, raw, model} : {plan: null, raw, model, reason: 'invalid_response'};
  } catch {
    return {plan: null, raw: '', model, reason: 'model_failed'};
  }
}
