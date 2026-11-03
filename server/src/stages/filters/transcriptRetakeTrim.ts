/**
 * WP6A: transcript-only near-duplicate take trim (no script needed, no model call).
 *
 * Raw talking-head footage often holds the same line several times: a flubbed first attempt, a pause, a second attempt with a different verb or noun, sometimes a third. Without a
 * teleprompter script `scriptRetakeExclusions` cannot run, so every take stayed in the edit. This module finds those takes from the ASR words alone:
 *
 *  1. split the words into pause-separated utterances (the same splitter the script path uses);
 *  2. drop filler sounds (um, uh, hm...) from each utterance's token list and ignore utterances with fewer than `MIN_TOKENS` real tokens (a short "yeah" is never a take);
 *  3. an earlier utterance is a take of a LATER one (looked at only within the next `LOOKAHEAD` utterances and `MAX_TAKE_DISTANCE_SEC` seconds, so a refrain used on purpose far apart is not
 *     treated as a retake) when they share at least `MIN_SHARED_CONTENT` content words AND either
 *       - their token-set Jaccard similarity is at least `minSimilarity` (default 0.5: survives one or two swapped verbs / nouns), or
 *       - the earlier one is a false start: at least `FALSE_START_CONTAINMENT` of its tokens occur in the later one (it is the shorter, cut-off version of the same sentence);
 *  4. takes of the same line form a cluster (union of those links). KEEP RULE: keep ONE take per cluster, the LAST one (creators usually nail it on the final attempt), unless an earlier take
 *     is clearly more complete: it has at least `LONGER_RATIO` x as many tokens as the last take AND at least `LONGER_BY_TOKENS` more tokens, in which case the longest such earlier take is
 *     kept instead (the last attempt was cut short). Every other take of the cluster is excluded from the timeline.
 *  5. SAFETY: with fewer than `MIN_WORDS` words nothing is done; if the cuts would remove more than `maxRemovalFrac` of the source (default 0.3), or would drop more than
 *     `MAX_DROPPED_UTTERANCE_FRAC` of the utterances, nothing is cut at all (a junk transcript must not gut the video).
 * The exclusions are the dropped take's own time span plus padding, never reaching into a neighbouring utterance. Pure: no I/O, no model, no logger.
 *
 * WP6B, RESTARTS INSIDE ONE UTTERANCE. A restart with little or no pause ("this is exactly how figma revolutionized this is exactly how figma redefined collaboration...") never splits into
 * two utterances, so the take rule above cannot see it. For every utterance that is NOT already dropped as a take, `intraUtteranceRestarts` looks for an abandoned attempt followed by a
 * restatement in the same breath:
 *  - the restatement at token j repeats the opening of the earlier attempt at token i: at least `MIN_RESTART_PREFIX` identical leading tokens, at least `MIN_RESTART_CONTENT` of them content
 *    words (a repeated "the plan is" is not a restart);
 *  - the abandoned span [i, j) is at most `MAX_RESTART_SPAN` tokens and is either a FALSE START (it adds at most `FALSE_START_EXTRA` tokens beyond the repeated opening) or a full
 *    near-duplicate of what follows (the same `isRetakeOf` test as for separate takes, against the next stretch of the same length);
 *  - the restatement is at least as long as the abandoned span (it is the fuller statement).
 * KEEP RULE (same spirit as for takes): the later restatement is kept, the abandoned span [i, j) is excluded; scanning then continues from j, so a second restart is found too. A
 * restart whose removal would take more than `MAX_INTRA_REMOVAL_FRAC` of the utterance's tokens is ignored, and the global guards (`maxRemovalFrac`, minimum cut) apply to the sum of all cuts.
 * NOT detected: restarts whose repeated opening is shorter than three tokens.
 *
 * WP6C, IN-PLACE WORD SWAP. The exact observed mash "this is exactly how figma revolutionized redefined collaboration in design for design" repeats no opening: the speaker just replaced one
 * word by another in the same breath. `inPlaceWordSwaps` treats two ADJACENT past-tense verbs (A, then B) as alternatives, abandons A and keeps B, only when ALL of these hold (strict on
 * purpose; a real sentence rarely stacks two different -ed verbs with no word between):
 *  - A and B are different words of at least `MIN_SWAP_LETTERS` letters, both ending in "ed" (a verb in the same form), and not the same stem (neither is a prefix of the other);
 *  - optional false-start tail: A may be followed by one or two function words (never and/or/but/then/nor/yet) that are repeated right after B ("revolutionized the redefined the ...");
 *  - LEFT context: at least `MIN_SWAP_LEFT_CONTENT` content words before A, and the word right before A is not a linking verb or degree word (is/was/very/...: then two -ed words are
 *    stacked adjectives, "a limited detailed guide" is fine);
 *  - RIGHT context: B is followed by at least `MIN_SWAP_RIGHT_TOKENS` tokens, at least one a content word (B continues into a fuller phrase; a swap at the end of the utterance is not judged);
 *  - the utterance has at least `MIN_UTTERANCE_TOKENS_FOR_RESTART` tokens, and all swaps together remove at most `MAX_SWAP_REMOVAL_FRAC` of it (else none is cut).
 * Counted in `restarts` (so it feeds `droppedTakes` and `transcript_retakes_dropped:N` with no wiring change); a swap overlapping a WP6B restart span is not cut twice. "figma designed and
 * shipped collaboration tools" is kept ("and" between), as is "designed shipped" in a sentence whose left context has no content words.
 *
 * WP6E WIDENING (same left/right context, tail, linking-word and removal-cap guards as above; all counted in `restarts`):
 *  - IRREGULAR PAST pairs: two different irregular simple-past forms from a fixed list (built/rebuilt, made/remade, took/made...). The list leaves out auxiliaries and light verbs (did, had,
 *    got, went, kept, left, let, was, were, been) so "got built" / "had made" stay. A mixed regular + irregular pair is NOT matched (stricter on purpose).
 *  - SAME-LEMMA restart: one long stem (at least `MIN_LEMMA_STEM` letters) restarted with another inflection (revolutionize / revolutionized / revolutionizing). The tokens are
 *    normalized to lower case, so capitalization ("Redefined" mid-phrase) is not itself a signal.
 *  - NOUN RETRY: determiner, noun, the SAME determiner, noun ("the plan the strategy for design"): the first determiner + noun are abandoned. Needs two content words of left context, a
 *    left neighbour that is not a conjunction or linking word, at least three tokens after, and is never a three-item list ("the good the bad the ugly").
 * WP7E (keep-best + coach echo; the earlier rules are unchanged):
 *  - "yeah" / "yep" / "yup" count as noise like a hesitation sound when comparing takes (`isNoise`), so "yeah so today ..." matches "so today ...".
 *  - SAME-LINE widening in `isRetakeOf`: besides the Jaccard / false-start tests, two takes match when the SHORTER one is almost fully contained in the longer (either order) or when their
 *    ordered token sequences (longest common subsequence) overlap by at least `MIN_LCS_RATIO`; both still need `MIN_SHARED_CONTENT` shared content words. The look-ahead is `LOOKAHEAD` = 4.
 *  - COACH ECHO (`coachEchoDrops`): an off-camera coach feeds a line ("say: figma redefined collaboration"), the creator then performs it ("figma redefined collaboration in design"). If an
 *    utterance U1 (coach lead-ins like "say", "repeat after me", "try" stripped, at least `MIN_ECHO_TOKENS` tokens, `MIN_ECHO_CONTENT` content words) is contained at least `ECHO_CONTAINMENT` in
 *    a following utterance U2 within the next `ECHO_LOOKAHEAD` utterances and `ECHO_WINDOW_SEC`, and U2 has at least as many tokens (is at least as complete), U1 is dropped. When U1 is the
 *    longer one it is kept (nothing is cut for it); distinct beats (fewer than `MIN_ECHO_CONTENT` shared content words or low containment) are never touched. Counted in `echoes`
 *    (and `droppedTakes`).
 * NOT detected: adjective swaps, -ing pairs of different lemmas, nouns without a repeated determiner, mixed regular/irregular pairs, and alternatives separated by more than the tail.
 */
import type {TimeRange, WordToken} from '../../types/blueprint.ts';
import {isBackchannelToken, isFillerToken} from './autoTrim.ts';
import {jaccardSimilarity, mergeTimeRanges, normalizeToken, utterancesFromWords, type Utterance} from './scriptRetakeTrim.ts';
import {round} from './timeline.ts';

export type TranscriptRetakeOptions = {
  sourceDurationSec: number;
  /** Pause (seconds) that starts a new utterance. */
  utteranceGapSec?: number;
  /** Jaccard similarity that makes two utterances takes of one line. */
  minSimilarity?: number;
  /** Extra time kept out around the cut (it is clamped so it never reaches a neighbouring utterance). */
  paddingSec?: number;
  /** Largest share of the source the cuts may remove; above it nothing is cut. */
  maxRemovalFrac?: number;
  /**
   * WP7G (cuts profile only): WHOLE-VIDEO dedupe. Every pair of takes is compared (no look-ahead / distance limit), a take also matches when at least `WHOLE_LCS_SHORT` of the SHORTER
   * take's words occur in the same order inside the other (this catches a fragment of a sentence and the full sentence with the other verb), and the keep rule prefers the LONGEST
   * coherent take unless the last one is nearly as long. Far-apart pairs need a longer shorter take (`WHOLE_MIN_FAR_TOKENS`) and more shared content words, so an intentional refrain
   * is not collapsed. More takes may be dropped (`WHOLE_MAX_DROPPED_FRAC`).
   */
  wholeVideo?: boolean;
  /** WP7I: do nothing (the AI keep-plan already decided what stays). */
  skip?: boolean;
};

export type TranscriptRetakeResult = {
  trimExclusions: TimeRange[];
  /** How many takes were dropped (every cluster keeps exactly one), plus the restarts cut inside single utterances. */
  droppedTakes: number;
  /** How many clusters of two or more takes were found. */
  clusters: number;
  /** WP6B: how many abandoned attempts inside a single utterance were cut (already included in `droppedTakes`). */
  restarts: number;
  /** WP7E: how many coaching prompts (an earlier near-duplicate of a fuller later utterance) were dropped (already included in `droppedTakes`). */
  echoes?: number;
  /** Why nothing was cut although takes were found (or no words to judge). */
  skipped?: 'sparse_speech' | 'would_remove_too_much' | 'too_many_takes';
};

const MIN_WORDS = 12;
const MIN_TOKENS = 4;
const MIN_TAKE_SEC = 0.6;
const LOOKAHEAD = 4;
const MAX_TAKE_DISTANCE_SEC = 25;
const MIN_SHARED_CONTENT = 2;
const FALSE_START_CONTAINMENT = 0.75;
const MIN_LCS_RATIO = 0.65;
const SHORTER_CONTAINMENT = 0.85;
const WHOLE_LCS_SHORT = 0.8;
const WHOLE_MIN_FAR_TOKENS = 5;
const WHOLE_MIN_FAR_CONTENT = 3;
const WHOLE_LAST_NEAR_LONGEST = 0.85;
const WHOLE_MAX_DROPPED_FRAC = 0.5;
const MIN_ECHO_TOKENS = 3;
const MIN_ECHO_CONTENT = 2;
const ECHO_CONTAINMENT = 0.8;
const ECHO_LOOKAHEAD = 2;
const ECHO_WINDOW_SEC = 12;
/** Coach lead-ins that are not part of the line the creator performs. */
const COACH_LEAD = new Set(['say', 'try', 'repeat', 'again', 'okay', 'ok', 'alright', 'now', 'so', 'just', 'after', 'me', 'saying', 'start', 'with', 'go', 'ahead', 'lets', 'read', 'next']);
/** Two-word coach lead-ins ("like this", "say it") stripped as a pair; "this" / "it" / "like" alone start real sentences. */
const COACH_LEAD_PAIRS = new Set(['like this', 'say it', 'try it', 'say this', 'one more']);
const LONGER_RATIO = 1.35;
const LONGER_BY_TOKENS = 3;
const DEFAULT_GAP = 0.55;
const DEFAULT_SIM = 0.5;
const DEFAULT_PAD = 0.06;
const DEFAULT_MAX_REMOVAL = 0.3;
const MAX_DROPPED_UTTERANCE_FRAC = 0.4;
const MIN_CUT_SEC = 0.15;
const MIN_RESTART_PREFIX = 3;
const MIN_RESTART_CONTENT = 2;
const MAX_RESTART_SPAN = 18;
const FALSE_START_EXTRA = 3;
const MIN_UTTERANCE_TOKENS_FOR_RESTART = 8;
const MAX_INTRA_REMOVAL_FRAC = 0.6;
const MIN_SWAP_LETTERS = 6;
const MIN_SWAP_LEFT_CONTENT = 2;
const MIN_SWAP_RIGHT_TOKENS = 3;
const MAX_SWAP_TAIL = 2;
const MAX_SWAP_REMOVAL_FRAC = 0.2;
const SWAP_TAIL_BLOCK = new Set(['and', 'or', 'but', 'then', 'nor', 'yet']);
const SWAP_LEFT_BLOCK = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'very', 'so', 'too', 'more', 'most', 'quite', 'really', 'not']);

/** Function words that do not make two sentences "the same line". */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'we',
  'they', 'he', 'she', 'my', 'your', 'our', 'their', 'me', 'us', 'them', 'as', 'by', 'from', 'then', 'there', 'here', 'have', 'has', 'had', 'do', 'does', 'did', 'just', 'like', 'um', 'uh',
]);

type Take = {utterance: Utterance; tokens: string[]; order: number};

/** Hesitation sounds and backchannels (um, uh, yeah, yep): never part of a take's content. */
const isNoise = (token: string): boolean => isFillerToken(token) || isBackchannelToken(token);

const realTokens = (utterance: Utterance): string[] => utterance.norms.filter(token => !isNoise(token));

function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) row[j] = a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, row[j - 1]!);
    previous = row;
  }
  return previous[b.length]!;
}

function containment(small: string[], large: string[]): number {
  if (small.length === 0) return 0;
  const set = new Set(large);
  let hit = 0;
  for (const token of new Set(small)) if (set.has(token)) hit += 1;
  return hit / new Set(small).size;
}

function sharedContent(a: string[], b: string[]): number {
  const set = new Set(b.filter(token => !STOP.has(token)));
  let hit = 0;
  for (const token of new Set(a.filter(token => !STOP.has(token)))) if (set.has(token)) hit += 1;
  return hit;
}

/** Are `earlier` and `later` two takes of the same line? (see the header for the rule) */
export function isRetakeOf(earlier: string[], later: string[], minSimilarity = DEFAULT_SIM): boolean {
  if (earlier.length < MIN_TOKENS || later.length < MIN_TOKENS) return false;
  if (sharedContent(earlier, later) < MIN_SHARED_CONTENT) return false;
  if (jaccardSimilarity(earlier, later) >= minSimilarity) return true;
  // A false start: the earlier one is the shorter, cut-off version of the later sentence.
  if (earlier.length < later.length && containment(earlier, later) >= FALSE_START_CONTAINMENT) return true;
  // WP7E: the shorter take sits (almost) wholly inside the longer one, in either order, or the two share most of their word ORDER.
  const [short, long] = earlier.length <= later.length ? [earlier, later] : [later, earlier];
  if (short.length >= MIN_TOKENS && containment(short, long) >= SHORTER_CONTAINMENT && sharedContent(short, long) >= MIN_SHARED_CONTENT + 1) return true;
  return lcsLength(earlier, later) / Math.max(earlier.length, later.length) >= MIN_LCS_RATIO;
}

/** WP7G: share of the SHORTER take's words found in the same order in the other take (a fragment of a sentence scores 1). */
function orderedShareOfShorter(a: readonly string[], b: readonly string[]): number {
  const shorter = a.length <= b.length ? a : b;
  return shorter.length === 0 ? 0 : lcsLength(a, b) / shorter.length;
}

/** The coach's lead-in ("say", "repeat after me", "try") removed from the front of a prompt; the creator's performance has none. */
function stripCoachLead(tokens: readonly string[]): string[] {
  let i = 0;
  for (;;) {
    if (i < tokens.length - 2 && COACH_LEAD_PAIRS.has(`${tokens[i]} ${tokens[i + 1]}`)) i += 2;
    else if (i < tokens.length - 1 && COACH_LEAD.has(tokens[i]!)) i += 1;
    else break;
  }
  return tokens.slice(i) as string[];
}

/** WP7E coach echo: indices into `takes` of earlier utterances that are a coaching prompt for a fuller, near-duplicate later one (see the header). */
function coachEchoDrops(candidates: readonly Take[], isDropped: (take: Take) => boolean): Take[] {
  const out: Take[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const first = candidates[i]!;
    if (isDropped(first)) continue;
    const prompt = stripCoachLead(first.tokens);
    if (prompt.length < MIN_ECHO_TOKENS || contentCount(prompt) < MIN_ECHO_CONTENT) continue;
    for (let j = i + 1; j < candidates.length && candidates[j]!.order - first.order <= ECHO_LOOKAHEAD; j += 1) {
      const second = candidates[j]!;
      if (isDropped(second)) continue;
      if (second.utterance.start - first.utterance.end > ECHO_WINDOW_SEC) break;
      if (second.tokens.length < prompt.length) continue; // the earlier one is the fuller statement: keep it
      if (sharedContent(prompt, second.tokens) < MIN_ECHO_CONTENT) continue;
      if (containment(prompt, second.tokens) >= ECHO_CONTAINMENT || isRetakeOf(prompt, second.tokens)) {
        out.push(first);
        break;
      }
    }
  }
  return out;
}

/** WP7G: whole-video match (see `wholeVideo`). Far-apart pairs are stricter. */
function isWholeVideoMatch(earlier: string[], later: string[], far: boolean): boolean {
  const shorter = Math.min(earlier.length, later.length);
  if (shorter < (far ? WHOLE_MIN_FAR_TOKENS : MIN_TOKENS)) return false;
  if (sharedContent(earlier, later) < (far ? WHOLE_MIN_FAR_CONTENT : MIN_SHARED_CONTENT)) return false;
  return orderedShareOfShorter(earlier, later) >= WHOLE_LCS_SHORT;
}

/** The words whose midpoint is not inside any of `ranges` (so a second pass does not re-judge speech that is already cut). */
export function wordsOutsideRanges(words: readonly WordToken[], ranges: readonly TimeRange[]): WordToken[] {
  return words.filter(word => {
    const middle = (word.start + word.end) / 2;
    return !ranges.some(range => middle >= range.start && middle <= range.end);
  });
}

type TimedToken = {norm: string; start: number; end: number};

/** Utterances with per-token times, split exactly like `utterancesFromWords` (same sort, same gap rule, same empty-token skip) so the indices line up. */
function timedUtterances(words: readonly WordToken[], gapSec: number): TimedToken[][] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const out: TimedToken[][] = [];
  let current: TimedToken[] = [];
  let currentEnd = 0;
  for (const word of sorted) {
    const norm = normalizeToken(word.text);
    if (!norm) continue;
    if (current.length > 0 && word.start - currentEnd >= gapSec) {
      out.push(current);
      current = [];
    }
    current.push({norm, start: word.start, end: word.end});
    currentEnd = current.length === 1 ? word.end : Math.max(currentEnd, word.end);
  }
  if (current.length > 0) out.push(current);
  return out;
}

const contentCount = (tokens: string[]): number => tokens.filter(token => !STOP.has(token)).length;

/**
 * Abandoned attempts followed by a restatement inside ONE utterance (see the WP6B rule in the header). `tokens` are the utterance's non-filler tokens in order; the result lists
 * `[from, to)` index pairs: tokens `from..to-1` are the abandoned span, `to` is where the restatement starts.
 */
export function intraUtteranceRestarts(tokens: readonly string[]): Array<{from: number; to: number}> {
  const n = tokens.length;
  if (n < MIN_UTTERANCE_TOKENS_FOR_RESTART) return [];
  const found: Array<{from: number; to: number}> = [];
  let i = 0;
  while (i < n) {
    let hit = -1;
    for (let j = i + MIN_RESTART_PREFIX; j < n && j - i <= MAX_RESTART_SPAN && hit < 0; j += 1) {
      let prefix = 0;
      while (prefix < j - i && j + prefix < n && tokens[i + prefix] === tokens[j + prefix]) prefix += 1;
      if (prefix < MIN_RESTART_PREFIX || contentCount(tokens.slice(i, i + prefix)) < MIN_RESTART_CONTENT) continue;
      const span = j - i;
      if (n - j < span) continue; // the restatement must be at least as long as what was abandoned
      const falseStart = span <= prefix + FALSE_START_EXTRA;
      const nearDuplicate = isRetakeOf(tokens.slice(i, j) as string[], tokens.slice(j, Math.min(n, j + span + FALSE_START_EXTRA)) as string[]);
      if (falseStart || nearDuplicate) hit = j;
    }
    if (hit >= 0) {
      found.push({from: i, to: hit});
      i = hit;
    } else {
      i += 1;
    }
  }
  const removed = found.reduce((total, restart) => total + (restart.to - restart.from), 0);
  return removed > n * MAX_INTRA_REMOVAL_FRAC ? [] : found;
}

const isPastVerb = (token: string): boolean => token.length >= MIN_SWAP_LETTERS && token.endsWith('ed') && /^[a-z]+$/.test(token);

/** WP6E: irregular simple-past forms. No auxiliaries or light verbs (did, had, got, went, kept, left, let, was, were, been): "got built", "had made" are ordinary speech. */
const IRREGULAR_PAST = new Set([
  'built', 'made', 'took', 'wrote', 'ran', 'saw', 'gave', 'found', 'told', 'thought', 'brought', 'bought', 'taught', 'caught', 'met', 'paid', 'said', 'sold', 'sent', 'spent', 'stood',
  'understood', 'began', 'chose', 'drew', 'drove', 'fell', 'flew', 'forgot', 'grew', 'held', 'knew', 'lost', 'meant', 'rose', 'shook', 'spoke', 'threw', 'wore', 'won', 'led',
]);
const isIrregularPast = (token: string): boolean => IRREGULAR_PAST.has(token) || (token.startsWith('re') && IRREGULAR_PAST.has(token.slice(2)));
const LEMMA_SUFFIXES = new Set(['d', 'ed', 'ing']);
const MIN_LEMMA_STEM = 7;
const NOUN_DETERMINERS = new Set(['the', 'a', 'an', 'our', 'your', 'their', 'my', 'his', 'her', 'its']);
const NOUN_LEFT_BLOCK = new Set(['and', 'or', 'but', 'nor', 'then', 'than', 'versus', 'vs']);
const MIN_NOUN_LETTERS = 4;

/** Same long stem, differing only by an inflection (revolutionize / revolutionized): the speaker restarted the same word. Case is not used (tokens are normalized). */
function sameLemmaFamily(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_LEMMA_STEM && /^[a-z]+$/.test(long) && long.startsWith(short) && LEMMA_SUFFIXES.has(long.slice(short.length));
}

/** Are A then B alternative verbs (regular -ed pair, irregular-past pair, or one lemma restarted)? Mixed regular / irregular pairs are deliberately not matched. */
function isAlternativeVerbPair(a: string, b: string): boolean {
  if (a === b) return false;
  if (isPastVerb(a) && isPastVerb(b) && !a.startsWith(b) && !b.startsWith(a)) return true;
  if (isIrregularPast(a) && isIrregularPast(b)) return true;
  return sameLemmaFamily(a, b);
}

function verbSwaps(tokens: readonly string[]): Array<{from: number; to: number}> {
  const n = tokens.length;
  const found: Array<{from: number; to: number}> = [];
  let i = MIN_SWAP_LEFT_CONTENT;
  while (i < n) {
    const a = tokens[i]!;
    let hit = -1;
    if (contentCount(tokens.slice(0, i) as string[]) >= MIN_SWAP_LEFT_CONTENT && !SWAP_LEFT_BLOCK.has(tokens[i - 1] ?? '')) {
      for (let tail = 0; tail <= MAX_SWAP_TAIL && hit < 0; tail += 1) {
        const b = tokens[i + tail + 1];
        if (b === undefined || !isAlternativeVerbPair(a, b)) continue;
        const tailTokens = tokens.slice(i + 1, i + 1 + tail) as string[];
        if (tailTokens.some(token => !STOP.has(token) || SWAP_TAIL_BLOCK.has(token))) continue;
        const rest = tokens.slice(i + tail + 2) as string[];
        const afterTail = rest.slice(0, tail);
        if (tail > 0 && (afterTail.length < tail || afterTail.some((token, k) => token !== tailTokens[k]))) continue;
        const right = rest.slice(tail);
        if (right.length < MIN_SWAP_RIGHT_TOKENS || contentCount(right) < 1) continue;
        hit = i + tail + 1;
      }
    }
    if (hit >= 0) {
      found.push({from: i, to: hit});
      i = hit + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

/** WP6E: "the plan the strategy ..." (determiner, noun, the SAME determiner, noun): the first noun is abandoned together with its determiner. Never a 3-item list. */
function nounRetries(tokens: readonly string[]): Array<{from: number; to: number}> {
  const n = tokens.length;
  const found: Array<{from: number; to: number}> = [];
  for (let i = 1; i + 3 < n; i += 1) {
    const det = tokens[i]!;
    if (!NOUN_DETERMINERS.has(det) || tokens[i + 2] !== det) continue;
    const a = tokens[i + 1]!;
    const b = tokens[i + 3]!;
    const isNounish = (t: string) => t.length >= MIN_NOUN_LETTERS && /^[a-z]+$/.test(t) && !STOP.has(t) && !isPastVerb(t) && !isIrregularPast(t);
    if (a === b || !isNounish(a) || !isNounish(b)) continue;
    if (contentCount(tokens.slice(0, i) as string[]) < MIN_SWAP_LEFT_CONTENT || NOUN_LEFT_BLOCK.has(tokens[i - 1]!) || SWAP_LEFT_BLOCK.has(tokens[i - 1]!)) continue;
    if (tokens[i + 4] === det || (i >= 2 && tokens[i - 2] === det)) continue; // a list ("the good the bad the ugly")
    const right = tokens.slice(i + 4) as string[];
    if (right.length < MIN_SWAP_RIGHT_TOKENS || contentCount(right) < 1) continue;
    found.push({from: i, to: i + 2});
    i += 3;
  }
  return found;
}

/**
 * WP6C + WP6E: in-place alternative words (see the header). Same result shape as `intraUtteranceRestarts`: tokens `from..to-1` are abandoned, `to` is where the kept word starts.
 */
export function inPlaceWordSwaps(tokens: readonly string[]): Array<{from: number; to: number}> {
  if (tokens.length < MIN_UTTERANCE_TOKENS_FOR_RESTART) return [];
  const merged: Array<{from: number; to: number}> = [];
  for (const range of [...verbSwaps(tokens), ...nounRetries(tokens)].sort((x, y) => x.from - y.from)) {
    const last = merged[merged.length - 1];
    if (!last || range.from >= last.to) merged.push(range);
  }
  const removed = merged.reduce((total, swap) => total + (swap.to - swap.from), 0);
  return removed > tokens.length * MAX_SWAP_REMOVAL_FRAC ? [] : merged;
}

export function transcriptRetakeExclusions(words: readonly WordToken[], options: TranscriptRetakeOptions): TranscriptRetakeResult {
  const none = (skipped?: TranscriptRetakeResult['skipped']): TranscriptRetakeResult => ({trimExclusions: [], droppedTakes: 0, clusters: 0, restarts: 0, ...(skipped ? {skipped} : {})});
  if (options.skip) return none();
  if (words.length < MIN_WORDS) return none('sparse_speech');
  const gap = Math.max(0.25, options.utteranceGapSec ?? DEFAULT_GAP);
  const minSimilarity = Math.min(0.9, Math.max(0.3, options.minSimilarity ?? DEFAULT_SIM));
  const padding = Math.max(0, options.paddingSec ?? DEFAULT_PAD);
  const maxRemoval = Math.min(0.6, Math.max(0.05, options.maxRemovalFrac ?? DEFAULT_MAX_REMOVAL));
  const duration = Math.max(0, options.sourceDurationSec);
  const whole = options.wholeVideo === true;

  const all = utterancesFromWords([...words], gap);
  const timed = timedUtterances(words, gap);
  const takes: Take[] = [];
  all.forEach((utterance, order) => {
    const tokens = realTokens(utterance);
    if (tokens.length >= MIN_TOKENS && utterance.end - utterance.start >= MIN_TAKE_SEC) takes.push({utterance, tokens, order});
  });

  // Takes spoken as separate utterances: union-find over takes linked to a later take within the look-ahead window.
  const dropped: Take[] = [];
  let clusters = 0;
  if (takes.length >= 2) {
    const parent = takes.map((_, index) => index);
    const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index]!)));
    for (let i = 0; i < takes.length; i += 1) {
      for (let j = i + 1; j < takes.length && (whole || j <= i + LOOKAHEAD); j += 1) {
        const far = takes[j]!.utterance.start - takes[i]!.utterance.end > MAX_TAKE_DISTANCE_SEC || j > i + LOOKAHEAD;
        if (!whole && far) break;
        if (isRetakeOf(takes[i]!.tokens, takes[j]!.tokens, minSimilarity)) parent[find(i)] = find(j);
        else if (whole && isWholeVideoMatch(takes[i]!.tokens, takes[j]!.tokens, far)) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, number[]>();
    takes.forEach((_, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), index]));
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      clusters += 1;
      const ordered = members.map(index => takes[index]!);
      const last = ordered[ordered.length - 1]!;
      // KEEP RULE: the last take, unless an earlier take is clearly more complete (the last attempt was cut short).
      let keep = last;
      if (whole) {
        const longest = ordered.reduce((best, take) => (take.tokens.length > best.tokens.length ? take : best), last);
        keep = last.tokens.length >= longest.tokens.length * WHOLE_LAST_NEAR_LONGEST ? last : longest;
      }
      for (const candidate of ordered.slice(0, -1)) {
        const clearlyLonger = candidate.tokens.length >= Math.ceil(last.tokens.length * LONGER_RATIO) && candidate.tokens.length - last.tokens.length >= LONGER_BY_TOKENS;
        if (!whole && clearlyLonger && candidate.tokens.length >= keep.tokens.length) keep = candidate;
      }
      for (const take of ordered) if (take !== keep) dropped.push(take);
    }
  }

  // WP7E: coach -> creator echo. Short prompts (3+ tokens) count too, so judge them on their own candidate list.
  const echoCandidates: Take[] = [];
  all.forEach((utterance, order) => {
    const tokens = realTokens(utterance);
    if (tokens.length >= MIN_ECHO_TOKENS && utterance.end - utterance.start >= MIN_TAKE_SEC) echoCandidates.push({utterance, tokens, order});
  });
  const clusterDropped = new Set(dropped.map(take => take.order));
  const echoes = coachEchoDrops(echoCandidates, take => clusterDropped.has(take.order));
  for (const echo of echoes) dropped.push(echo);
  if (dropped.length > Math.ceil(all.length * (whole ? WHOLE_MAX_DROPPED_FRAC : MAX_DROPPED_UTTERANCE_FRAC))) return {...none('too_many_takes'), clusters};

  const exclusions: TimeRange[] = [];
  for (const take of dropped) {
    const previous = all[take.order - 1];
    const next = all[take.order + 1];
    const from = Math.max(previous ? previous.end : 0, take.utterance.start - padding);
    const to = Math.min(next ? next.start : Math.max(take.utterance.end + padding, 0), take.utterance.end + padding);
    if (to - from >= MIN_CUT_SEC) exclusions.push({start: round(from), end: round(to)});
  }

  // WP6B: abandoned attempts followed by a restatement inside one utterance (not for utterances already dropped as whole takes).
  let restarts = 0;
  if (timed.length === all.length) {
    const droppedOrders = new Set(dropped.map(take => take.order));
    timed.forEach((utterance, order) => {
      if (droppedOrders.has(order)) return;
      const tokens = utterance.filter(token => !isNoise(token.norm));
      const norms = tokens.map(token => token.norm);
      const spans = intraUtteranceRestarts(norms);
      // WP6C: in-place swaps, unless inside a restart span already being cut.
      for (const swap of inPlaceWordSwaps(norms)) if (!spans.some(span => swap.from < span.to && swap.to > span.from)) spans.push(swap);
      for (const restart of spans) {
        const before = tokens[restart.from - 1];
        const from = Math.max(before ? before.end : (all[order - 1]?.end ?? 0), tokens[restart.from]!.start - padding);
        const to = Math.max(tokens[restart.to - 1]!.end, tokens[restart.to]!.start - 0.02);
        if (to - from >= MIN_CUT_SEC) {
          exclusions.push({start: round(from), end: round(to)});
          restarts += 1;
        }
      }
    });
  }
  if (dropped.length === 0 && restarts === 0) return none();
  const echoCount = echoes.length;

  const merged = mergeTimeRanges(exclusions);
  const removed = merged.reduce((total, range) => total + (range.end - range.start), 0);
  if (duration > 0 && removed / duration > maxRemoval) return {...none('would_remove_too_much'), clusters};
  return {trimExclusions: merged, droppedTakes: dropped.length + restarts, clusters, restarts, ...(echoCount > 0 ? {echoes: echoCount} : {})};
}
