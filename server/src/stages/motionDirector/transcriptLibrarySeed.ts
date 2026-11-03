/**
 * WP8J: seed 1-2 LIBRARY graphics from the transcript alone. PURE: no env, no logger, no I/O, no model call. For polish in library-only mode (no Claude allowed): when the motion Director failed
 * or returned nothing the library can draw, these deterministic picks keep a polish render from being "raw + captions". The output has the SAME shape as a motion Director response
 * (`{graphics: [{id, anchorWordIndex, durationSeconds, reason, goal, visualDescription, placement, contentJson, box?}]}`), so it goes through the same `assembleDirectedGraphics` guards
 * (occupied intervals, caption band, overlap, maximum) and the same library publish path as a Gemini brief. Nothing here is moved or fitted afterwards.
 *
 * COPY RULE: every string in `contentJson` is a substring of the transcript (case kept) after trimming surrounding punctuation and collapsing spaces; nothing is translated, joined from
 * different places, completed or invented. The only words the engine adds are the composition's own UI label ("VS" between two sides), which is not content.
 *
 * Rules (a sentence is a run of words ended by . ? ! or a pause of 0.8 s or more):
 *   contrast   "between X and Y", "either X or Y", "X versus / vs Y", "not X but Y", "X instead of Y"      -> VsClaim            (score 5; sides trimmed to 5 words)
 *   stat       a digit number with a % / x / k / m / million / ... unit or a currency sign, plus a label  -> StatHighlight      (score 4.8: above an opening headline)
 *   list       3-6 short comma / "and" / "or" parts in one sentence (overlay with a safe box only)        -> TopicPills         (score 4)
 *   opening    the first sentence (starts in the first 10 s), 3-14 words, as up to 3 short lines          -> BigKineticHeadline (score 4.5; an emphatic later sentence scores 3)
 *   closing    the last sentence of the final 40 %, 4-14 words, no question                               -> FullscreenStatement(score 3.5)
 *   maxim      6-14 words with never / always / nobody / every / the best / the only / the secret / the key -> QuoteCallout      (score 2)
 * A composition tagged for the chosen Edit Look scores +1. The look's `maxGraphics` caps the count (minimal_captions allows none); the seed itself never exceeds `seedLimitForDuration` (WP8P).
 * Picks are greedy by score, never overlap each other or an occupied interval, start at least `MIN_SEPARATION_SEC` apart. WP8U: a sentence whose window hits something already on screen is slid to a
 * later word of the same sentence and shrunk into the free gap (>= 1.5 s) instead of being skipped.
 * Placement: overlay compositions (pills, and the headline when a clear band above the speaker exists) need a KNOWN speaker box with room above it; otherwise the headline is drawn
 * full-screen and pills are skipped. Everything else is full-screen (a cutaway beat).
 */
import {EDIT_LOOKS} from '../directorV2/editLooks.ts';
import {recipeForComposition} from '../../lib/motionRecipes.ts';
import {findFlashCardCandidates, flashCardCap, flashCardDuration} from '../broll/flashCardSeed.ts';
import {iconForLabel, iconForStat, illustrateLabels, LIBRARY_COMPOSITIONS, type LibraryCompositionId} from './libraryRegistry.ts';
import type {Interval, TimedWord} from './motionDirector.ts';

/**
 * The most graphics a seed adds, whatever the look allows. WP8P: duration-scaled instead of a flat 2 (Gate 4: one library graphic in 38 s). One seed per ~10 s of output, at least `SEED_MIN_GRAPHICS`
 * and at most `SEED_MAX_GRAPHICS` (40 s -> 4, 20 s -> 2, 60 s+ -> 6).
 */
export const SEED_MIN_GRAPHICS = 2;
export const SEED_MAX_GRAPHICS = 6;
export const SEED_SEC_PER_GRAPHIC = 10;
export const MIN_SEPARATION_SEC = 4;
/** WP9A: the explain-plate path targets one plate per engagement window (mirrors `SEC_PER_ENGAGE` in broll/engagementCadence.ts; this module stays free of broll imports). */
export const EXPLAIN_SEC_PER_PLATE = 8;
/** Compositions that read well in the bottom-anchored half-frame (top = designed plate, bottom = rounded talking head). Every other composition stays full screen. */
const SPLIT_PLATE_COMPOSITIONS: ReadonlySet<string> = new Set(['VsClaim', 'StatHighlight', 'QuoteCallout', 'BigKineticHeadline', 'ProcessSteps', 'BeforeAfter', 'StampTitle', 'TweetCard', 'WikiCallout', 'NewspaperCallout']);

/**
 * WP9B: an explicit plate the polish plan asks for in a window nothing predicted covers (e.g. a split with no creator B-roll). `text` is 2-5 consecutive spoken words (the fill's own phrase), so the plate
 * is a QuoteCallout of speaker-verbatim copy. `startSec` is an output-time spoken word start.
 */
export type PlateAnchor = {startSec: number; text: string; placement: 'split_screen' | 'full_screen'};

/** Seeds for the explain-plate path: one per ~EXPLAIN_SEC_PER_PLATE window (never fewer than the standard limit), bounded by SEED_MAX_GRAPHICS. */
export function explainPlateLimit(outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec <= 0) return seedLimitForDuration(outputDurationSec);
  return Math.min(SEED_MAX_GRAPHICS, Math.max(seedLimitForDuration(outputDurationSec), Math.floor(outputDurationSec / EXPLAIN_SEC_PER_PLATE)));
}

export function seedLimitForDuration(outputDurationSec: number): number {
  if (!Number.isFinite(outputDurationSec) || outputDurationSec <= 0) return SEED_MIN_GRAPHICS;
  return Math.max(SEED_MIN_GRAPHICS, Math.min(SEED_MAX_GRAPHICS, Math.round(outputDurationSec / SEED_SEC_PER_GRAPHIC)));
}
/** Seeds may start at the first word: whatever the hook title (or any other edit) already owns is excluded through `occupied`, not by a fixed time. */
export const MIN_START_SEC = 0;
const SENTENCE_GAP_SEC = 0.8;
const MAX_SENTENCE_WORDS = 28;
const MIN_WINDOW_SEC = 2.8;
const MAX_WINDOW_SEC = 4;

export type SeedBox = {x: number; y: number; w: number; h: number};

export type SeedRawGraphic = {
  id: string;
  anchorWordIndex: number;
  durationSeconds: number;
  reason: string;
  goal: string;
  visualDescription: string;
  placement: 'full_screen' | 'split_screen' | 'overlay';
  /** split_screen only. */
  graphicSide?: 'top' | 'bottom';
  contentJson: string;
  box?: SeedBox;
};

export type SeedResult = {
  raw: {graphics: SeedRawGraphic[]; notes: string};
  /** Seed graphic id -> the library composition it is meant for. */
  compositions: Record<string, LibraryCompositionId>;
  /** The cap applied: min(seedLimitForDuration(duration), the look's maxGraphics). */
  limit: number;
  /** Why nothing was seeded, when nothing was. */
  none?: 'look_allows_no_graphics' | 'too_short' | 'no_candidates';
  /** WP9B: anchors that could not be placed (occupied, no word, over the cap). */
  unplacedAnchors?: number;
  /** WP10A: id of the open / thumbnail plate seeded in the first second, when there is one. */
  openPlateId?: string;
  /** WP10B: overlay candidates that had no caption-band-clear box (pills skipped, an overlay headline drawn full screen). */
  skippedForCaptionBand?: number;
  /** WP10H: second (or later) TopicPills seeds dropped because another plate fits. */
  pillsCapped?: number;
  /** WP11A: ids of caption-clone candidates (bare-text pills) that were skipped. */
  captionClonesSkipped?: string[];
  /** WP17: flash / pivot cards placed (they count inside `limit`). */
  flashCards?: number;
  /** WP33: chapter cards (white FlashCards on the VO cut grammar's 15-25 s schedule) placed. They are not part of the pivot cap, but they do count inside `limit`. */
  chapterCards?: number;
  /** WP13A: ids of enumerations upgraded from weakly-illustrated pills to a WikiCallout. */
  listUpgraded?: string[];
};

type Sentence = {index: number; firstWord: number; start: number; end: number; text: string; wordCount: number};

type Candidate = {
  composition: LibraryCompositionId;
  score: number;
  sentence: Sentence;
  content: Record<string, unknown>;
  placement: 'full_screen' | 'overlay';
  hint: string;
  reason: string;
  /** Show for exactly this long (an open plate holds ~2.4 s whatever the sentence length). */
  fixedSec?: number;
  /** WP10B: the caption-band-clear box of an overlay candidate. */
  box?: SeedBox;
  /** WP13A: this plate replaced a weakly-illustrated pill list (the enumeration became an article page). */
  upgradedFromList?: boolean;
};

const clean = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`“”‘’(\[{<*_\-–—.,;:!?…]+/, '')
    .replace(/[\s"'`“”‘’)\]}>*_\-–—.,;:!?…]+$/, '')
    .trim();
const wordsOf = (value: string): string[] => value.split(/\s+/).filter(Boolean);
const letters = (value: string): number => (value.match(/\p{L}/gu) ?? []).length;
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'this', 'that', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'from', 'by', 'as', 'into', 'about', 'over', 'than', 'then', 'if', 'when']);

/** Drop function words from the outer edge of a side ("... expert in" -> "... expert"), keeping at least one word. Only removes words; never adds or reorders. */
function trimStopEdge(tokens: string[], edge: 'start' | 'end'): string[] {
  const out = [...tokens];
  while (out.length > 1 && STOP.has(clean(edge === 'start' ? out[0]! : out[out.length - 1]!).toLowerCase())) edge === 'start' ? out.shift() : out.pop();
  return out;
}

function sentencesOf(words: readonly TimedWord[]): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const next = words[i + 1];
    const endsHere = /[.?!…]["')”’]*$/.test(word.text) || !next || next.start - word.end >= SENTENCE_GAP_SEC || i - start + 1 >= MAX_SENTENCE_WORDS;
    if (endsHere) {
      const slice = words.slice(start, i + 1);
      out.push({index: out.length, firstWord: start, start: slice[0]!.start, end: word.end, text: slice.map(item => item.text).join(' '), wordCount: slice.length});
      start = i + 1;
    }
  }
  return out;
}

/** Contrast: two sides of one sentence. */
const CONTRAST: Array<{pattern: RegExp; order: 'lr' | 'rl'}> = [
  {pattern: /\bbetween\s+(.+?)\s+and\s+(.+)/i, order: 'lr'},
  {pattern: /\beither\s+(.+?)\s+or\s+(.+)/i, order: 'lr'},
  {pattern: /(.+?)\s+(?:versus|vs\.?)\s+(.+)/i, order: 'lr'},
  {pattern: /\bnot\s+(.+?)\s*,?\s+but\s+(.+)/i, order: 'lr'},
  {pattern: /(.+?)\s+instead of\s+(.+)/i, order: 'rl'},
];

function contrast(sentence: Sentence): Candidate | null {
  for (const rule of CONTRAST) {
    const match = rule.pattern.exec(sentence.text);
    if (!match) continue;
    let first = clean(match[1]!);
    let second = clean(match[2]!);
    first = trimStopEdge(wordsOf(first).slice(-5), 'start').join(' ');
    second = trimStopEdge(wordsOf(second).slice(0, 5), 'end').join(' ');
    first = clean(first);
    second = clean(second);
    const [left, right] = rule.order === 'lr' ? [first, second] : [second, first];
    if (letters(left) < 2 || letters(right) < 2 || left.toLowerCase() === right.toLowerCase() || left.length > 60 || right.length > 60) continue;
    return {composition: 'VsClaim', score: 5, sentence, content: {left, right}, placement: 'full_screen', hint: 'a two-sided claim card', reason: 'contrast in one sentence'};
  }
  return null;
}

const UNIT = '%|percent|x|k|m|million|billion|thousand|hours?|minutes?|days?|weeks?|months?|years?';
const STAT = new RegExp(`([$\\u20ac\\u00a3])?\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})?(?![\\w])`, 'i');

function stat(sentence: Sentence): Candidate | null {
  const match = STAT.exec(sentence.text);
  if (!match) return null;
  const currency = match[1];
  const unit = match[3]?.toLowerCase();
  const value = Number(match[2]!.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  if (!currency && !unit && value >= 1900 && value <= 2100) return null; // a year, not a statistic
  if (!currency && !unit && value < 10) return null; // "2 things" is not a headline number
  const after = clean(sentence.text.slice((match.index ?? 0) + match[0].length));
  const before = clean(sentence.text.slice(0, match.index ?? 0));
  const label = wordsOf(after).slice(0, 3).join(' ') || wordsOf(before).slice(-3).join(' ');
  const cleaned = clean(label);
  if (letters(cleaned) < 3 || cleaned.length > 60) return null;
  const suffix = unit === '%' || unit === 'percent' ? '%' : unit === 'x' || unit === 'k' || unit === 'm' ? unit : unit && unit.length <= 8 ? ` ${unit}` : undefined;
  const props: Record<string, unknown> = {value: {to: value, ...(currency ? {prefix: currency} : {}), ...(suffix ? {suffix} : {})}, label: cleaned};
  return {composition: 'StatHighlight', score: 4.8, sentence, content: props, placement: 'full_screen', hint: 'a big animated number', reason: 'a number with a label'};
}

/**
 * WP9F: the richer explain-plate shapes (ProcessSteps, BeforeAfter, ChartExplainer). Verbatim spoken runs only (clean + trimStopEdge never reorder, join or invent), the same rule as every seed.
 * PointerCallout is not here: it needs pixel targets the transcript does not carry.
 */
const ORDINAL_CUE = /\b(first|second|third|fourth|then|next|finally|lastly|last)\b/gi;
const LEADING_CUE = /^\s*(first|step one|number one|one)\b/i;
const FOLLOWING_CUE = /^\s*(second|third|fourth|then|next|finally|lastly|last)\b/i;
const MAX_STEPS = 5;

/** A run of at most 4 content-edged words as one verbatim label of at most 40 characters, or null. `lead` keeps the first words, `tail` the last. */
function labelRun(run: string, edge: 'lead' | 'tail'): string | null {
  let tokens = trimStopEdge(trimStopEdge(wordsOf(clean(run)), 'start'), 'end');
  tokens = edge === 'lead' ? tokens.slice(0, 4) : tokens.slice(-4);
  tokens = trimStopEdge(trimStopEdge(tokens, 'start'), 'end');
  const label = clean(tokens.join(' '));
  return letters(label) >= 3 && label.length <= 40 && !tokens.every(word => STOP.has(clean(word).toLowerCase())) ? label : null;
}

function steps(sentences: readonly Sentence[], index: number): Candidate | null {
  const sentence = sentences[index]!;
  let labels: string[] = [];
  const marks = [...sentence.text.matchAll(ORDINAL_CUE)];
  marks.forEach((mark, i) => {
    const from = (mark.index ?? 0) + mark[0].length;
    const to = marks[i + 1]?.index ?? sentence.text.length;
    const label = labelRun(sentence.text.slice(from, to), 'lead');
    if (label) labels.push(label);
  });
  if (labels.length < 2 && LEADING_CUE.test(sentence.text)) {
    labels = [];
    for (let i = index; i < sentences.length && labels.length < MAX_STEPS; i += 1) {
      const text = sentences[i]!.text;
      if (i === index ? !LEADING_CUE.test(text) : !FOLLOWING_CUE.test(text)) break;
      const label = labelRun(text.replace(/^\s*\w+(\s+one)?[\s,]*/i, ''), 'lead');
      if (!label) break;
      labels.push(label);
    }
  }
  labels = labels.slice(0, MAX_STEPS);
  if (labels.length < 2 || new Set(labels.map(label => label.toLowerCase())).size !== labels.length) return null;
  return {composition: 'ProcessSteps', score: 4.9, sentence, content: {steps: labels}, placement: 'full_screen', hint: 'a step-by-step process diagram', reason: 'ordered steps'};
}

const BEFORE_AFTER: RegExp[] = [/\bbefore\s+(.+?)\s*,?\s+(?:and\s+)?after\s+(.+)/i, /\bused to\s+(.+?)\s*,?\s+(?:but\s+)?now\s+(.+)/i, /\bfrom\s+(.+?)\s+to\s+(.+)/i];

function beforeAfter(sentence: Sentence): Candidate | null {
  for (const pattern of BEFORE_AFTER) {
    const match = pattern.exec(sentence.text);
    if (!match) continue;
    const before = labelRun(match[1]!, 'tail');
    const after = labelRun(match[2]!, 'lead');
    if (!before || !after || before.toLowerCase() === after.toLowerCase()) continue;
    return {composition: 'BeforeAfter', score: 4.7, sentence, content: {before: {label: before}, after: {label: after}}, placement: 'full_screen', hint: 'a before and after comparison', reason: 'before and after in one sentence'};
  }
  return null;
}

const LABELLED_NUMBER = /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent)?\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)/g;

function chart(sentence: Sentence): Candidate | null {
  const data: Array<{label: string; value: number}> = [];
  for (const match of sentence.text.matchAll(LABELLED_NUMBER)) {
    const value = Number(match[1]!.replace(/,/g, ''));
    const label = labelRun(match[2]!, 'lead');
    if (!Number.isFinite(value) || !label || (value >= 1900 && value <= 2100)) continue;
    if (data.some(row => row.label.toLowerCase() === label.toLowerCase())) continue;
    data.push({label, value});
  }
  if (data.length < 2 || data.length > 6) return null;
  return {composition: 'ChartExplainer', score: 4.95, sentence, content: {data}, placement: 'full_screen', hint: 'a labelled bar chart', reason: 'labelled numbers'};
}

/**
 * WP9G: section-title and social-post plates. `stampTitle`: a sentence that opens "Number two ...", "Step 3 ...", "Rule one ...", "Tip four ...": the stamp is the spoken ordinal as layout chrome (`02 \u2014`, the one
 * non-spoken string the grounding matcher allows) and the title is the next 1-4 spoken words. `tweetCard`: a sentence that says someone tweeted / posted / wrote / shared / texted / commented something: the post
 * body is the spoken run after the verb. No name or handle is ever invented (the card draws no header without them).
 */
const ORDINAL_WORDS: Record<string, number> = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9};
const STAMP_LEAD = /^\s*(?:number|step|rule|tip|part|lesson|reason|chapter)\s+(one|two|three|four|five|six|seven|eight|nine|[1-9])\b[\s,:.\-\u2013\u2014]*(.*)$/i;
const POST_VERB = /\b(?:tweeted|posted|wrote|shared|texted|commented)\b[\s,:]*(?:that\s+)?(.+)$/i;

function stampTitle(sentence: Sentence): Candidate | null {
  const match = STAMP_LEAD.exec(sentence.text);
  if (!match) return null;
  const n = ORDINAL_WORDS[match[1]!.toLowerCase()] ?? Number(match[1]);
  const title = labelRun(match[2] ?? '', 'lead');
  if (!(n >= 1 && n <= 9) || !title) return null;
  return {composition: 'StampTitle', score: 4.85, sentence, content: {stamp: `0${n} \u2014`, title}, placement: 'full_screen', hint: 'a section stamp title card', reason: 'a numbered section title'};
}

/**
 * WP10A/WP10H: 1-2 spoken words (the longest content words, in reading order) the highlighter marks. Each is a WHOLE word token of `body` (never a prefix / suffix of a longer word: "accountant" is never
 * marked as "account"), so the marker can never split a word.
 */
export function highlightWordsOf(body: string): string[] {
  const tokens = wordsOf(body).map(clean);
  const indexed = tokens.map((word, index) => ({word, index})).filter(item => letters(item.word) >= 5 && !STOP.has(item.word.toLowerCase()));
  const seen = new Set<string>();
  const unique = indexed.filter(item => (seen.has(item.word.toLowerCase()) ? false : (seen.add(item.word.toLowerCase()), true)));
  return unique.sort((a, b) => letters(b.word) - letters(a.word) || a.index - b.index).slice(0, 2).sort((a, b) => a.index - b.index).map(item => item.word);
}

const normTok = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * WP12B: the walking-highlighter schedule of an article / post plate. The passage is located in the spoken words (a verbatim token-for-token match starting at the sentence); the "stops" are its content
 * words (5+ letters, not a function word) and numbers / amounts, at most 6 spread across the passage; each stop is timed from the spoken word and measured from the plate's start. Fewer than 2 stops, or a
 * passage that cannot be located verbatim, gives no schedule (the static highlight is used). Times come from the transcript only; nothing is invented.
 */
export function highlightScheduleFor(passage: string, words: readonly TimedWord[], fromWord: number, windowStartSec: number, windowSec: number): Array<{word: string; fromSec: number; toSec: number}> {
  const tokens = wordsOf(passage);
  const keys = tokens.map(normTok);
  if (tokens.length === 0 || keys.some(key => key === '')) return [];
  let at = -1;
  for (let i = Math.max(0, fromWord); i + keys.length <= words.length && at < 0; i += 1) if (keys.every((key, j) => normTok(words[i + j]!.text) === key)) at = i;
  if (at < 0) return [];
  const stops = tokens
    .map((token, j) => ({token: clean(token), j}))
    .filter(({token, j}) => token !== '' && ((letters(token) >= 5 && !STOP.has(token.toLowerCase())) || /\d/.test(words[at + j]!.text)));
  const step = Math.max(1, Math.ceil(stops.length / 6));
  const picked = stops.filter((_, index) => index % step === 0).slice(0, 6);
  const spans = picked
    .map(({token, j}) => {
      const word = words[at + j]!;
      return {word: token, fromSec: Math.round((word.start - windowStartSec) * 1000) / 1000, toSec: Math.round((word.end - windowStartSec) * 1000) / 1000};
    })
    .filter(span => span.fromSec >= 0 && span.fromSec < windowSec && span.toSec > span.fromSec);
  return spans.length >= 2 ? spans : [];
}

/** WP10A: wiki / article / headline cues; the text after the cue is the captured line. */
const ARTICLE_CUE = /\b(?:research (?:shows|says|found|suggests)|studies (?:show|say|found)|according to(?: the)?(?: wiki(?:pedia)?| article| study| report)?|the article|an article|wikipedia|the wiki|it (?:says|said|reads)|says that|reported that|the headline|the study (?:says|found|shows))\b[\s,:]*(?:that\s+)?(.+)$/i;

function tweetCard(sentence: Sentence): Candidate | null {
  const match = POST_VERB.exec(sentence.text);
  if (!match) return null;
  const body = clean(match[1]!);
  const count = wordsOf(body).length;
  if (count < 4 || count > 24 || body.length > 160 || letters(body) < 12) return null;
  const highlight = highlightWordsOf(body);
  return {composition: 'TweetCard', score: 4.4, sentence, content: {body, ...(highlight.length > 0 ? {highlight} : {})}, placement: 'full_screen', hint: 'a social-post style card', reason: 'a post someone shared'};
}

/**
 * WP10B: an article / wiki page: an article cue ("according to the wiki", "the article", "research shows", "the study found") with the cited passage after it, OR a long quotable claim (13-24 words
 * with a claim cue). Content `{passage, highlight}`: the passage is a verbatim run, the highlighter marks 1-2 of its own long words.
 */
/**
 * WP52: a WikiCallout seeds ONLY from an explicit article / study / wiki citation (ARTICLE_CUE). The old money ("raised $1.5 billion"), long-claim and enumeration routes turned ordinary sales lines into
 * encyclopedia pages in the test2 live burn and are gone; lists go to TopicPills / the motion-template planner instead.
 */
function wikiCallout(sentence: Sentence): Candidate | null {
  const cued = ARTICLE_CUE.exec(sentence.text);
  if (!cued || /\?/.test(sentence.text)) return null;
  const passage = clean(cued[1]!);
  const count = wordsOf(passage).length;
  if (count < 4 || count > 28 || passage.length > 200 || letters(passage) < 14) return null;
  const highlight = highlightWordsOf(passage);
  if (highlight.length === 0) return null;
  return {composition: 'WikiCallout', score: 4.5, sentence, content: {passage, highlight}, placement: 'full_screen', hint: 'a captured encyclopedia article page', reason: 'an article the speaker cites'};
}

/**
 * WP13D: a NEWSPAPER clipping. Two routes, both verbatim: (1) a news cue ("headline", "reported", "breaking", "the newspaper", "journalists" ...) with the sentence as the passage (score 4.6); (2) VARIETY: a
 * 13-24 word quotable claim, scored just under the WikiCallout of the same sentence (4.0 vs 4.1), so once a WikiCallout is on the edit the "fresh composition" rule gives the next evidence window the
 * newspaper instead of a second article page. Content is `{passage, newspaper: true, highlight}`; no newspaper name or headline is invented (a title only exists if one is passed in).
 */
const NEWS_CUE = /\b(headlines?|reported|reports? (?:say|said|that|show)|breaking( news)?|the news|newspapers?|front page|journalists?|press release|according to (?:the )?(?:press|newspaper|times|post|journal|reporters?))\b/i;
function newspaperCallout(sentence: Sentence): Candidate | null {
  // WP52: NEWS_CUE only. The "quotable claim" variety route put "ON THE RECORD" clippings on ordinary stats and brand names.
  if (!NEWS_CUE.test(sentence.text)) return null;
  if (sentence.wordCount < 6 || sentence.wordCount > 40 || /\?/.test(sentence.text)) return null;
  const run = dropWeakEnd(wordsOf(clean(sentence.text)).slice(0, 22));
  const passage = clean(run.join(' '));
  const highlight = highlightWordsOf(passage);
  if (wordsOf(passage).length < 5 || passage.length > 200 || letters(passage) < 18 || highlight.length === 0) return null;
  return {composition: 'NewspaperCallout', score: 4.6, sentence, content: {passage, newspaper: true, highlight}, placement: 'full_screen', hint: 'a newspaper clipping', reason: 'a news / headline cue'};
}

/**
 * WP10D: claim-like speech cues. The original maxim words plus advice / choice language (should, must, need to, hire, advise, expert, choose, better than, the right / wrong ...). A cue only SELECTS a sentence; the
 * on-screen text is still a verbatim run of it.
 */
const CLAIM_CUE = /\b(never|always|nobody|the best|the only|the secret|the key|biggest|worst|most|more than|should|shouldn't|must|need to|have to|hire|hiring|advise|advice|recommend|expert|experts|choose|choice|the right|the wrong|better|instead of|don't|do not|stop)\b/i;

/** WP10A: a quotable claim (a maxim with never / always / nobody ...; WP10D: also advice / choice lines of 6-12 words) as a captured-post card with highlighter words. */
/** WP52: a maxim is NOT a tweet. Only a spoken social cue (tweet / posted / on twitter|x|instagram / @handle) lets a short claim become a TweetCard. */
const SOCIAL_CUE = /(?:\btweet(?:ed|s)?\b|\bretweet(?:ed)?\b|\bposted\b|\bon (?:twitter|x|instagram|linkedin|threads)\b|\bsocial post\b|(?:^|\s)@\w{2,})/i;
function claimCard(sentence: Sentence): Candidate | null {
  if (!SOCIAL_CUE.test(sentence.text)) return null;
  if (sentence.wordCount < 5 || sentence.wordCount > 12 || /\?/.test(sentence.text)) return null;
  if (!CLAIM_CUE.test(sentence.text)) return null;
  const body = clean(sentence.text);
  const highlight = highlightWordsOf(body);
  if (letters(body) < 14 || body.length > 140 || highlight.length === 0) return null;
  return {composition: 'TweetCard', score: 4.2, sentence, content: {body, highlight}, placement: 'full_screen', hint: 'a social-post style card', reason: 'a quotable claim'};
}

/** WP10F: words an open-plate title must not END on (connectors and the dangling number "one"): the slice stops before them. */
const WEAK_END = new Set([...STOP, 'one', 'also', 'just', 'very', 'really', 'not']);
function dropWeakEnd(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length > 1 && WEAK_END.has(clean(out[out.length - 1]!).toLowerCase())) out.pop();
  return out;
}

/** Filler words that carry no editorial weight at the start of a spoken line. */
const FILLER = new Set(['today', 'now', 'here', 'well', 'okay', 'ok', 'so', 'yeah', 'hello', 'hey', 'just', 'like', 'um', 'uh', 'actually', 'basically', 'right', 'look', 'listen', 'alright']);
/**
 * WP11A: a curve is a spice. Text earns the arc only with at least one content word (4+ letters, not a stop / filler word) AND fewer than half of its words being stop / filler words. "today and I" fails both.
 */
export function isEditorialText(text: string): boolean {
  const tokens = wordsOf(clean(text)).map(word => clean(word).toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return false;
  const weak = tokens.filter(word => STOP.has(word) || FILLER.has(word));
  return tokens.some(word => letters(word) >= 4 && !STOP.has(word) && !FILLER.has(word)) && weak.length * 2 < tokens.length;
}

const OPEN_PLATE_SEC = 2.4;
/** WP10D: the most words of a first sentence the open plate reads (arc kicker 2 + title up to 7, with slack). */
const OPEN_SLICE_WORDS = 12;
/** The opening plate may start this early at the latest (the first spoken line). */
export const OPEN_PLATE_MAX_START_SEC = 1;

/**
 * WP10A: a designed plate from one sentence: an optional ordinal (`Number two ...` -> `02 —`), an ARC kicker (the first two words, only with 6+ words), the title (up to 7 words) and one accent word for the
 * highlighter. Every string is a verbatim contiguous run of the sentence. `opening` = the first line of the video: score above everything, held 2.4 s. A later line (`curved headline`) needs to be emphatic.
 */
function openPlate(sentence: Sentence, opening: boolean): Candidate | null {
  const lead = STAMP_LEAD.exec(sentence.text);
  const number = lead ? ORDINAL_WORDS[lead[1]!.toLowerCase()] ?? Number(lead[1]) : 0;
  const stamp = number >= 1 && number <= 9 ? `0${number} \u2014` : undefined;
  const all = wordsOf(clean(stamp && lead ? lead[2] ?? '' : sentence.text));
  // WP10D: the OPENING plate slices a contiguous verbatim run from the start of a long first sentence (the first OPEN_SLICE_WORDS words) instead of refusing it; a later curved headline keeps its size limit.
  if (!opening && all.length > 18) return null;
  const tokens = opening ? all.slice(0, OPEN_SLICE_WORDS) : all;
  if (tokens.length < (opening ? 3 : 5)) return null;
  if (!opening && !(/!/.test(sentence.text) || /\b(never|stop|must|biggest|worst|best|only|always|nobody)\b/i.test(sentence.text))) return null;
  let kickerCount = tokens.length >= 6 ? 2 : 0;
  if (kickerCount && opening && tokens.length >= 8 && WEAK_END.has(clean(tokens[1]!).toLowerCase())) kickerCount = 3; // do not end the arc on a connector
  const kicker = kickerCount ? clean(tokens.slice(0, kickerCount).join(' ')) : '';
  let titleTokens = tokens.slice(kickerCount, kickerCount + 7);
  if (opening) while (titleTokens.length > 2 && clean(titleTokens.join(' ')).length > 64) titleTokens = titleTokens.slice(0, -1);
  if (opening) titleTokens = dropWeakEnd(titleTokens);
  const title = clean(titleTokens.join(' '));
  if (letters(title) < 6 || title.length > 64 || (kicker && (kicker.length > 28 || letters(kicker) < 3))) return null;
  const accent = wordsOf(title).map(clean).find(word => letters(word) >= 6 && !STOP.has(word.toLowerCase()));
  const content: Record<string, unknown> = {openTitle: title, ...(kicker ? {kicker} : {}), ...(stamp ? {stamp} : {}), ...(accent ? {accent} : {}), ...(kicker && !isEditorialText(kicker) ? {curve: false} : {})};
  return {
    composition: 'OpenPlate',
    score: opening ? 6.5 : 3.8,
    sentence,
    content,
    placement: 'full_screen',
    hint: opening ? 'a designed opening thumbnail plate' : 'a curved-headline plate',
    reason: opening ? 'the opening thumbnail beat' : 'an emphatic curved headline',
    ...(opening ? {fixedSec: OPEN_PLATE_SEC} : {}),
  };
}

/** WP9F: the plate shape the sentence around `atSec` supports (contrast, stat, steps, before / after, chart), or null. The Claude gap briefs use it so their content has the same shape and grounding as a seed. */
/** WP29: the explain-plate (polish) path never seeds a web-UI stepper. `ProcessSteps` is demoted here; a list of ordered cues falls through to the other shapes (headline / statement / flash card). */
export const POLISH_DEMOTED_SEEDS: ReadonlySet<string> = new Set(['ProcessSteps']);
const polishAllowed = (candidate: Candidate | null): candidate is Candidate => candidate !== null && !POLISH_DEMOTED_SEEDS.has(candidate.composition);

export type PlateStyle = 'VsClaim' | 'StatHighlight' | 'ProcessSteps' | 'BeforeAfter' | 'ChartExplainer' | 'StampTitle' | 'TweetCard' | 'OpenPlate' | 'WikiCallout' | 'NewspaperCallout' | 'headline';
export function plateShapeAt(words: readonly TimedWord[], atSec: number): {composition: LibraryCompositionId; content: Record<string, unknown>; hint: string} | null {
  const sentences = sentencesOf(words);
  const index = sentences.findIndex(sentence => atSec >= sentence.start - 0.05 && atSec <= sentence.end + 0.05);
  if (index < 0) return null;
  const sentence = sentences[index]!;
  const found = [contrast(sentence), stat(sentence), steps(sentences, index), beforeAfter(sentence), chart(sentence), stampTitle(sentence), tweetCard(sentence), claimCard(sentence), wikiCallout(sentence), newspaperCallout(sentence), openPlate(sentence, false)].filter(polishAllowed).sort((a, b) => b.score - a.score)[0]; // WP29: plateShapeAt feeds the polish Claude gap briefs: never a stepper
  return found ? {composition: found.composition, content: found.content, hint: found.hint} : null;
}

/**
 * WP8R: floating topic pills from a spoken list of 3-6 short items (professions, ingredients, exercises, features, …). When the speaker box is unmeasured, still seed as overlay with a default left mid-frame box —
 * Gate 5 occupancy_unmeasured used to skip pills entirely and leave only karaoke on the face.
 */
function pills(sentence: Sentence, overlayOk: boolean): Candidate | null {
  const parts = sentence.text.split(/\s*,\s*|\s+and\s+|\s+or\s+/i).map(clean).filter(Boolean);
  if (parts.length < 3 || parts.length > 6) return null;
  // First part: last 1-2 content words; middle: first 1-3; last: first 1-3 (drop trailing clause noise like "every single year").
  const items = parts.map((part, index) => {
    const tokens = wordsOf(part);
    const slice = index === 0 ? tokens.slice(-2) : tokens.slice(0, 3);
    return clean(trimStopEdge(slice, index === 0 ? 'start' : 'end').join(' '));
  });
  if (items.some(item => letters(item) < 3 || item.length > 40 || wordsOf(item).every(word => STOP.has(word.toLowerCase())))) return null;
  if (new Set(items.map(item => item.toLowerCase())).size !== items.length) return null;
  return {
    composition: 'TopicPills',
    score: overlayOk ? 4.2 : 4,
    sentence,
    content: {items},
    placement: 'overlay',
    hint: 'floating topic pills one after another',
    reason: 'a list of short items',
  };
}

/** WP8R: small lead-in + one big keyword (ref: “IF I WERE A” / “FARMER”). */
function keywordStack(sentence: Sentence): Candidate | null {
  if (sentence.wordCount < 4 || sentence.wordCount > 12) return null;
  const tokens = wordsOf(sentence.text);
  const last = clean(tokens[tokens.length - 1] ?? '');
  if (letters(last) < 4 || STOP.has(last.toLowerCase()) || /\?/.test(last)) return null;
  const lead = clean(tokens.slice(0, -1).join(' '));
  if (letters(lead) < 4 || lead.length > 36 || last.length > 24) return null;
  return {
    composition: 'BigKineticHeadline',
    score: 3.2, // below closing FullscreenStatement (3.5) and maxim (2) is lower; keyword stacks fill mid-clip gaps
    sentence,
    content: {lines: [lead, last], accent: last},
    placement: 'full_screen',
    hint: 'small lead-in then one big keyword',
    reason: 'a keyword stack',
  };
}

function headline(sentence: Sentence, opening: boolean, overlayOk: boolean): Candidate | null {
  if (sentence.wordCount < 3 || sentence.wordCount > 14) return null;
  const emphatic = /!/.test(sentence.text) || /\b(never|stop|must|biggest|worst|best|only)\b/i.test(sentence.text);
  if (!opening && !emphatic) return null;
  const tokens = wordsOf(sentence.text).slice(0, 9);
  const lines: string[] = [];
  for (let i = 0; i < tokens.length && lines.length < 3; i += 3) lines.push(clean(tokens.slice(i, i + 3).join(' ')));
  const shown = lines.filter(Boolean);
  if (shown.length === 0 || shown.some(line => line.length > 36 || letters(line) < 2)) return null;
  const accentWord = wordsOf(shown.join(' ')).map(clean).find(word => letters(word) >= 6 && !STOP.has(word.toLowerCase()));
  const content: Record<string, unknown> = {lines: shown, ...(accentWord ? {accent: accentWord} : {})};
  return {composition: 'BigKineticHeadline', score: opening ? 4.5 : 3, sentence, content, placement: overlayOk ? 'overlay' : 'full_screen', hint: 'big stacked kinetic type', reason: opening ? 'the opening line' : 'an emphatic line'};
}

function statement(sentence: Sentence, duration: number): Candidate | null {
  if (sentence.start < duration * 0.6 || sentence.wordCount < 4 || sentence.wordCount > 14 || /\?/.test(sentence.text)) return null;
  const text = clean(sentence.text);
  if (letters(text) < 8 || text.length > 140) return null;
  return {composition: 'FullscreenStatement', score: 3.5, sentence, content: {statement: text}, placement: 'full_screen', hint: 'one big full-screen statement', reason: 'a closing claim'};
}

function maxim(sentence: Sentence): Candidate | null {
  if (sentence.wordCount < 6 || sentence.wordCount > 14 || /\?/.test(sentence.text)) return null;
  if (!/\b(never|always|nobody|everyone|every|the best|the only|the secret|the key)\b/i.test(sentence.text)) return null;
  const quote = clean(sentence.text);
  if (letters(quote) < 10 || quote.length > 140) return null;
  return {composition: 'QuoteCallout', score: 2, sentence, content: {quote}, placement: 'full_screen', hint: 'a quote card', reason: 'a short maxim'};
}

/** WP8P: a plain content line (5-12 words, a long content word, no question) as a quote card. Lowest score: it only fills a duration-scaled limit once the better rules are used up. */
function keyline(sentence: Sentence): Candidate | null {
  if (sentence.wordCount < 5 || sentence.wordCount > 12 || /\?/.test(sentence.text)) return null;
  if (!wordsOf(sentence.text).some(word => letters(clean(word)) >= 7 && !STOP.has(clean(word).toLowerCase()))) return null;
  const quote = clean(sentence.text);
  if (letters(quote) < 14 || quote.length > 120) return null;
  return {composition: 'QuoteCallout', score: 1.5, sentence, content: {quote}, placement: 'full_screen', hint: 'a quote card', reason: 'a key line'};
}

/** Default left mid-frame band for TopicPills when occupancy is unmeasured (WP8R). */
export const DEFAULT_PILL_BOX: SeedBox = {x: 0.04, y: 0.28, w: 0.55, h: 0.36};

/** WP10B: the least height an overlay box keeps after being pulled out of the caption band (frame fraction). */
export const MIN_OVERLAY_BOX_H = 0.14;
const BAND_GAP = 0.02;

/**
 * WP10B: an overlay box that does not touch the caption band (frame fractions), or null. A box already clear is returned as is. Otherwise the box is SHRUNK to the free space above the band (same x / y / w), and if
 * that leaves under `MIN_OVERLAY_BOX_H` it is MOVED into the free space below the band; neither fits -> null (the caller skips with a warning instead of seeding a graphic the assembler would refuse).
 */
export function clearOfCaptionBand(box: SeedBox, band: {top: number; bottom: number} | undefined): SeedBox | null {
  if (!band || !(box.y < band.bottom && box.y + box.h > band.top)) return box;
  const above = band.top - BAND_GAP - box.y;
  if (above >= MIN_OVERLAY_BOX_H) return {...box, h: Math.round(Math.min(box.h, above) * 1000) / 1000};
  const belowY = band.bottom + BAND_GAP;
  const below = 1 - 0.04 - belowY;
  if (below >= MIN_OVERLAY_BOX_H) return {...box, y: Math.round(belowY * 1000) / 1000, h: Math.round(Math.min(box.h, below) * 1000) / 1000};
  return null;
}

/** A band above a KNOWN speaker, as frame fractions; null when there is none (or the speaker is unknown). */
export function safeOverlayBox(speakerBox: SeedBox | undefined, speakerUnknown?: boolean): SeedBox | null {
  if (!speakerBox || speakerUnknown) return null;
  const room = speakerBox.y - 0.1;
  if (speakerBox.y < 0.3 || room < 0.12) return null;
  return {x: 0.06, y: 0.06, w: 0.88, h: Math.min(0.28, room)};
}

const overlaps = (a: {start: number; end: number}, b: {start: number; end: number}) => a.start < b.end && a.end > b.start;
const kebab = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

/** WP10A: the plates with designed typography (arc / mask / highlighter) vs the plain ones they are preferred over. */
export const CRAFT_PLATES: ReadonlySet<string> = new Set(['OpenPlate', 'StampTitle', 'TweetCard', 'WikiCallout', 'NewspaperCallout']);
const CALLOUTS: ReadonlySet<string> = new Set(['TweetCard', 'WikiCallout', 'NewspaperCallout']);
/** WP13A: plates that must not take a window a screenshot callout (TweetCard / WikiCallout) could fill. */
const EVIDENCE_LOSERS: ReadonlySet<string> = new Set(['QuoteCallout', 'BigKineticHeadline', 'FullscreenStatement']);
/** WP13D: two screenshot callouts never share a sentence (the newspaper variety candidate and the article page are two looks at the SAME line). */
const duplicatesCallout = (candidate: Candidate, other: Candidate): boolean => CALLOUTS.has(candidate.composition) && CALLOUTS.has(other.composition) && candidate.sentence.index >= 0 && candidate.sentence.index === other.sentence.index;
const PLAIN_PLATES: ReadonlySet<string> = new Set(['FullscreenStatement', 'QuoteCallout']);

export function seedLibraryGraphics(input: {
  words: readonly TimedWord[];
  outputDurationSec: number;
  lookId?: string | null;
  speakerBox?: SeedBox;
  speakerUnknown?: boolean;
  occupied?: readonly Interval[];
  /** WP10A: the hook title's window. Blocks every plate EXCEPT the open plate, which replaces the hook (the caller then drops the hook title). */
  hookWindow?: Interval;
  /** WP17: labeled-asset slot windows (output time). A flash card is not placed strictly inside one when any other pivot is available; a pivot just before a slot start is preferred. */
  assetSlotWindows?: ReadonlyArray<{start: number; end: number}>;
  /** WP10B: the caption band (frame fractions). Overlay seeds (pills, an overlay headline) are placed clear of it; a pill box that cannot be is skipped (`skippedForCaptionBand`), a headline goes full screen. */
  captionBand?: {top: number; bottom: number};
  /** WP9A: explain-plate path (polish, no creator B-roll): one plate per engagement window, compositions varied across the timeline, alternate plates split-screen. */
  explainPlates?: boolean;
  /** WP9B: required plates (explain-plate path only), placed before the per-window pass. An anchor that cannot be placed is counted in `unplacedAnchors`. */
  anchors?: readonly PlateAnchor[];
  /** WP33: chapter cards planned by the VO cut grammar (`at` is a spoken word's start in the SAME word list as `words`, `text` is that word and the next 0-2 spoken words verbatim). Explain-plate path only; each becomes a short white FlashCard. */
  chapterCards?: ReadonlyArray<{at: number; duration: number; text: string; wordIndex: number}>;
}): SeedResult {
  const look = EDIT_LOOKS.find(entry => entry.id === input.lookId);
  const limit = Math.max(0, Math.min(input.explainPlates ? explainPlateLimit(input.outputDurationSec) : seedLimitForDuration(input.outputDurationSec), look ? look.maxGraphics : SEED_MAX_GRAPHICS));
  const empty = (none: SeedResult['none']): SeedResult => ({raw: {graphics: [], notes: `library seed: none (${none})`}, compositions: {}, limit, none});
  if (limit === 0) return empty('look_allows_no_graphics');
  if (input.words.length < 6 || input.outputDurationSec < 6) return empty('too_short');

  const measuredBox = safeOverlayBox(input.speakerBox, input.speakerUnknown);
  const box = measuredBox;
  const pillBox = measuredBox ?? DEFAULT_PILL_BOX;
  const sentences = sentencesOf(input.words);
  const lastIndex = sentences.length - 1;
  const candidates: Candidate[] = [];
  let skippedForCaptionBand = 0;
  let pillsCapped = 0;
  const captionClonesSkipped: string[] = [];
  for (const sentence of sentences) {
    const opening = sentence.index === 0 && sentence.start < 10;
    const found = [
      contrast(sentence),
      stat(sentence),
      ...(input.explainPlates ? [steps(sentences, sentence.index), beforeAfter(sentence), chart(sentence), stampTitle(sentence), tweetCard(sentence)] : []),
      ...(input.explainPlates ? [claimCard(sentence), wikiCallout(sentence), newspaperCallout(sentence), openPlate(sentence, opening && sentence.start < OPEN_PLATE_MAX_START_SEC)] : []), // WP10A
      pills(sentence, measuredBox !== null),
      keywordStack(sentence),
      headline(sentence, opening, measuredBox !== null),
      sentence.index === lastIndex || sentence.index === lastIndex - 1 ? statement(sentence, input.outputDurationSec) : null,
      maxim(sentence),
      keyline(sentence),
    ];
    for (const candidate of found) {
      if (!candidate) continue;
      if (input.explainPlates && POLISH_DEMOTED_SEEDS.has(candidate.composition)) continue; // WP29: ProcessSteps is never a polish seed
      if (input.explainPlates) {
        // WP11A: never clone the captions. A bare-text pill list is skipped; a list whose every label maps to an icon is kept as an illustrated list. A small overlay headline repeating the spoken line becomes a
        // designed full-screen statement (the captions are muted while it plays).
        if (candidate.composition === 'TopicPills') {
          // WP13A: ICON-UPGRADE instead of skip. Every label gets its mapped icon (a generic symbol when none maps); the list is kept as an illustrated list when at least half of its labels have a specific icon.
          // A weakly-illustrated enumeration of 3+ items is upgraded to an article page (WikiCallout); only when that is not possible either is it skipped (a bare-text chip would clone the captions).
          const items = (candidate.content.items as string[]) ?? [];
          const illustrated = illustrateLabels(items);
          if (illustrated.illustrated) {
            candidate.content = {...candidate.content, icons: illustrated.icons};
          } else {
            // WP52: no list -> wiki upgrade (it made encyclopedia pages of sales lines). A weakly-illustrated list is skipped here; the motion-template planner owns enumerations.
            captionClonesSkipped.push(`topic-pills-${sentence.index + 1}`);
            continue;
          }
        } else if (candidate.composition === 'ProcessSteps') {
          const steps = ((candidate.content.steps as string[]) ?? []).map(String);
          const illustrated = illustrateLabels(steps);
          if (illustrated.illustrated) candidate.content = {...candidate.content, icons: illustrated.icons};
        } else if (candidate.composition === 'StatHighlight') {
          const icon = iconForLabel(String(candidate.content.label ?? '')) ?? iconForStat(candidate.content.value);
          if (icon) candidate.content = {...candidate.content, icon};
        } else if (candidate.composition === 'BigKineticHeadline' && candidate.placement === 'overlay') {
          candidate.placement = 'full_screen';
        }
      }
      if (candidate.placement === 'overlay') {
        const fitted = clearOfCaptionBand(candidate.composition === 'TopicPills' ? pillBox : box ?? pillBox, input.captionBand);
        if (fitted) candidate.box = fitted;
        else {
          skippedForCaptionBand += 1;
          if (candidate.composition === 'TopicPills') continue;
          candidate.placement = 'full_screen';
        }
      }
      candidates.push(candidate);
    }
  }
  const tagged = (composition: LibraryCompositionId) => (look && LIBRARY_COMPOSITIONS.find(entry => entry.id === composition)?.looks.includes(look.id) ? 1 : 0);
  // WP10A: on the explain-plate path the CRAFT plates (open / stamp / post card with highlighter / curved headline) outrank plain statement and quote cards when both exist.
  const craft = (composition: LibraryCompositionId) => (!input.explainPlates ? 0 : CRAFT_PLATES.has(composition) ? 1 : PLAIN_PLATES.has(composition) ? -0.6 : 0);
  const ranked = candidates.map(candidate => ({candidate, score: candidate.score + tagged(candidate.composition) + craft(candidate.composition)})).sort((a, b) => b.score - a.score || a.candidate.sentence.start - b.candidate.sentence.start);

  const outputEnd = input.outputDurationSec - 0.05;
  /** WP56: StatHighlight must open on/near the spoken numeral — not at the start of a long sentence before the number is said. */
  const numeralWordIndex = (candidate: Candidate): number => {
    if (candidate.composition !== 'StatHighlight') return candidate.sentence.firstWord;
    const raw = (candidate.content.value as {to?: number} | undefined)?.to;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return candidate.sentence.firstWord;
    const end = candidate.sentence.firstWord + candidate.sentence.wordCount;
    for (let index = candidate.sentence.firstWord; index < end; index += 1) {
      const token = input.words[index]?.text ?? '';
      const digits = Number(token.replace(/[^\d.]/g, ''));
      if (Number.isFinite(digits) && Math.abs(digits - raw) < 1e-6) return index;
    }
    return candidate.sentence.firstWord;
  };
  const windowOf = (candidate: Candidate) => {
    const anchor = numeralWordIndex(candidate);
    const startAt = input.words[anchor]?.start ?? candidate.sentence.start;
    const span = candidate.sentence.end - startAt + 0.8;
    const duration = candidate.fixedSec ?? Math.round(Math.min(MAX_WINDOW_SEC, Math.max(MIN_WINDOW_SEC, span)) * 1000) / 1000;
    return {start: startAt, end: Math.min(startAt + duration, outputEnd), duration, anchorWordIndex: anchor};
  };
  /**
   * WP8U: the window of a candidate. The preferred one starts at the sentence's first word. When that overlaps something already on screen (`blockers`: occupied intervals and the seeds chosen so far),
   * the window is slid to a LATER word of the SAME sentence and shrunk to the free gap (at least 1.5 s, at most the preferred length), so the graphic still shows while the line is spoken.
   * A sentence with no free gap of that size gives null (the next candidate is tried).
   */
  const fitWindow = (candidate: Candidate, blockers: readonly {start: number; end: number}[]): ReturnType<typeof windowOf> | null => {
    const preferred = windowOf(candidate);
    if (candidate.sentence.start < MIN_START_SEC) return null;
    if (!blockers.some(interval => overlaps(preferred, interval)) && preferred.end - preferred.start >= 1.5) return preferred;
    for (let index = candidate.sentence.firstWord; index < candidate.sentence.firstWord + candidate.sentence.wordCount; index += 1) {
      const start = input.words[index]!.start;
      if (blockers.some(interval => start >= interval.start && start < interval.end)) continue;
      const nextBlock = Math.min(...blockers.filter(interval => interval.start >= start).map(interval => interval.start), Infinity);
      const end = Math.min(start + preferred.duration, nextBlock, outputEnd);
      if (end - start < 1.5) continue;
      return {start, end, duration: Math.round((end - start) * 1000) / 1000, anchorWordIndex: index};
    }
    return null;
  };
  const baseBlockers = (candidate?: Candidate): Interval[] => [...(input.occupied ?? []), ...(input.hookWindow && candidate?.composition !== 'OpenPlate' ? [input.hookWindow] : [])];
  const chosen: Array<{candidate: Candidate; window: ReturnType<typeof windowOf>}> = [];
  const accepts = (candidate: Candidate, window: NonNullable<ReturnType<typeof windowOf>>) =>
    !chosen.some(other => overlaps(window, other.window) || Math.abs(window.start - other.window.start) < MIN_SEPARATION_SEC || duplicatesCallout(candidate, other.candidate));
  const anchorSplit = new Set<string>();
  let unplacedAnchors = 0;
  if (input.explainPlates) {
    // WP9B: explicit anchors first. The plate starts at the anchor's spoken word, shows 2.8-4 s (shrunk to the free gap, at least 1.5 s) and carries the anchor's own words.
    for (const anchor of input.anchors ?? []) {
      let index = -1;
      for (let i = 0; i < input.words.length && input.words[i]!.start <= anchor.startSec + 0.05; i += 1) index = i;
      const word = index >= 0 ? input.words[index] : undefined;
      const text = clean(anchor.text);
      if (!word || chosen.length >= limit || letters(text) < 4) { unplacedAnchors += 1; continue; }
      const blockers = [...baseBlockers(), ...chosen.map(other => other.window)];
      const nextBlock = Math.min(...blockers.filter(interval => interval.start >= word.start).map(interval => interval.start), Infinity);
      const end = Math.min(word.start + MAX_WINDOW_SEC - 0.5, nextBlock, outputEnd);
      const window = {start: word.start, end, duration: Math.round((end - word.start) * 1000) / 1000, anchorWordIndex: index};
      if (window.duration < 1.5 || blockers.some(interval => word.start >= interval.start && word.start < interval.end) || chosen.some(other => overlaps(window, other.window) || Math.abs(window.start - other.window.start) < MIN_SEPARATION_SEC)) { unplacedAnchors += 1; continue; }
      const sentence = {index: -1, firstWord: index, start: word.start, end, text, wordCount: 1};
      const candidate: Candidate = {composition: 'QuoteCallout', score: 1, sentence, content: {quote: text}, placement: 'full_screen', hint: 'a quote card', reason: 'an explicit plate for an uncovered window'};
      chosen.push({candidate, window});
      if (anchor.placement === 'split_screen') anchorSplit.add(`${index}`);
    }
  }
  if (input.explainPlates) {
    // WP9A: one plate per engagement window, in time order. A window takes its best-ranked candidate whose composition is not used yet (variety); a repeat is allowed only when the window has no
    // alternative. Windows no candidate can fill are left to the standard pass below.
    for (let windowStart = 0; windowStart < input.outputDurationSec && chosen.length < limit; windowStart += EXPLAIN_SEC_PER_PLATE) {
      if (chosen.some(other => other.window.start >= windowStart && other.window.start < windowStart + EXPLAIN_SEC_PER_PLATE)) continue;
      const fitted = ranked
        .map(({candidate}) => ({candidate, window: fitWindow(candidate, [...baseBlockers(candidate), ...chosen.map(other => other.window)])}))
        .filter((item): item is {candidate: Candidate; window: NonNullable<ReturnType<typeof windowOf>>} => item.window !== null && item.window.start >= windowStart && item.window.start < windowStart + EXPLAIN_SEC_PER_PLATE && accepts(item.candidate, item.window));
      // WP10H: at most one TopicPills per edit: a later pills seed only wins a window when nothing else fits it.
      const hasPills = chosen.some(other => other.candidate.composition === 'TopicPills');
      const usable = hasPills && fitted.some(item => item.candidate.composition !== 'TopicPills') ? fitted.filter(item => item.candidate.composition !== 'TopicPills') : fitted;
      if (usable.length < fitted.length) pillsCapped += 1;
      const fresh = usable.find(item => !chosen.some(other => other.candidate.composition === item.candidate.composition));
      let pick = fresh ?? usable[0];
      // WP13A: the evidence slot belongs to a screenshot callout. When a TweetCard / WikiCallout fits this window, a quote card, a stacked headline or a plain statement does not take it.
      // (Only when the callout starts no more than 1.5 s after the plate it replaces: a late pick would crowd the next window out with the minimum separation.)
      if (pick && EVIDENCE_LOSERS.has(pick.candidate.composition)) {
        const base = pick;
        pick = usable.find(item => CALLOUTS.has(item.candidate.composition) && item.window.start <= base.window.start + 1.5) ?? pick;
      }
      if (pick) chosen.push(pick);
    }
  }
  for (const {candidate} of ranked) {
    if (chosen.length >= limit) break;
    const window = fitWindow(candidate, [...baseBlockers(candidate), ...chosen.map(other => other.window)]);
    if (!window) continue;
    if (chosen.some(other => overlaps(window, other.window) || Math.abs(window.start - other.window.start) < MIN_SEPARATION_SEC || duplicatesCallout(candidate, other.candidate))) continue;
    if (candidate.composition === 'TopicPills' && chosen.some(other => other.candidate.composition === 'TopicPills') && ranked.some(item => item.candidate.composition !== 'TopicPills' && !chosen.some(other => other.candidate === item.candidate))) { pillsCapped += 1; continue; }
    if (chosen.some(other => other.candidate.composition === candidate.composition) && ranked.some(item => !chosen.some(other => other.candidate.composition === item.candidate.composition) && item.candidate !== candidate)) continue;
    chosen.push({candidate, window});
  }
  // WP10D: guarantee a callout. On the explain path, when a sentence supports a TweetCard / WikiCallout and none was chosen, the best fitting one is added; at the cap it replaces the lowest-ranked other plate
  // (never the open plate, an explicit anchor or another callout).
  if (input.explainPlates && !chosen.some(item => CALLOUTS.has(item.candidate.composition))) {
    const scoreOf = new Map(ranked.map(item => [item.candidate, item.score]));
    const callouts = ranked.filter(item => CALLOUTS.has(item.candidate.composition)).map(item => item.candidate);
    // Victims, weakest first; QuoteCallout / statement / headline plates go before anything else (a quote card is NOT a screenshot callout and never satisfies this rule).
    const victims = chosen.filter(item => item.candidate.composition !== 'OpenPlate' && item.candidate.sentence.index >= 0).sort((a, b) => (scoreOf.get(a.candidate) ?? 0) - (scoreOf.get(b.candidate) ?? 0));
    for (const callout of callouts) {
      for (const victim of chosen.length < limit ? [undefined, ...victims] : victims) {
        const rest = chosen.filter(item => item !== victim);
        const window = fitWindow(callout, [...baseBlockers(callout), ...rest.map(other => other.window)]);
        if (!window || rest.some(other => overlaps(window, other.window) || Math.abs(window.start - other.window.start) < MIN_SEPARATION_SEC || duplicatesCallout(callout, other.candidate))) continue;
        chosen.splice(0, chosen.length, ...rest, {candidate: callout, window});
        callouts.length = 0;
        break;
      }
      if (callouts.length === 0) break;
    }
  }
  // WP12B: a plain QuoteCallout is not "evidence": when a WikiCallout candidate fits where a chosen QuoteCallout is, the quote card is swapped for the paper + highlighter plate.
  if (input.explainPlates) {
    // WP13A: also a stacked headline / plain statement gives way, and a TweetCard candidate counts as evidence next to a WikiCallout (a Wiki is tried first).
    const wikis = ranked
      .filter(item => CALLOUTS.has(item.candidate.composition) && !chosen.some(other => other.candidate === item.candidate))
      .sort((a, b) => Number(b.candidate.composition === 'WikiCallout') - Number(a.candidate.composition === 'WikiCallout') || b.score - a.score)
      .map(item => item.candidate);
    for (const quote of chosen.filter(item => EVIDENCE_LOSERS.has(item.candidate.composition) && item.candidate.sentence.index >= 0)) {
      for (const wiki of wikis) {
        const rest = chosen.filter(item => item !== quote);
        const window = fitWindow(wiki, [...baseBlockers(wiki), ...rest.map(other => other.window)]);
        // Same engagement window as the plate it replaces: the swap changes WHICH plate fills a window, never how many windows are filled.
        if (!window || Math.floor(window.start / EXPLAIN_SEC_PER_PLATE) !== Math.floor(quote.window.start / EXPLAIN_SEC_PER_PLATE)) continue;
        if (rest.some(other => overlaps(window, other.window) || Math.abs(window.start - other.window.start) < MIN_SEPARATION_SEC || duplicatesCallout(wiki, other.candidate))) continue;
        chosen.splice(0, chosen.length, ...rest, {candidate: wiki, window});
        wikis.splice(wikis.indexOf(wiki), 1);
        break;
      }
    }
  }
  // WP17: FLASH / PIVOT CARDS. A connective beat ("Then everything broke") becomes a short solid-ground full-screen card (0.35-1.2 s). They count inside `limit`: they fill spare capacity, or replace the weakest
  // plain plate, and never overlap another plate. A pivot strictly inside a labeled-asset slot window is used only when no pivot outside a slot exists; one just before a slot start is preferred.
  let flashCards = 0;
  let chapterCards = 0;
  if (input.explainPlates) {
    const cap = flashCardCap(input.outputDurationSec);
    const slots = input.assetSlotWindows ?? [];
    const insideSlot = (time: number) => slots.some(slot => time > slot.start + 0.35 && time < slot.end - 0.35);
    const beforeSlot = (time: number) => slots.some(slot => slot.start - time >= 0 && slot.start - time <= 1.2);
    const pivots = findFlashCardCandidates(input.words)
      .filter(item => item.startSec >= OPEN_PLATE_SEC + 0.2 && item.startSec <= outputEnd - 0.4)
      .map(item => ({...item, inside: insideSlot(item.startSec), before: beforeSlot(item.startSec)}));
    const usable = pivots.some(item => !item.inside) ? pivots.filter(item => !item.inside) : pivots;
    const regular = [...usable].sort((a, b) => Number(b.before) - Number(a.before) || a.startSec - b.startSec);
    // WP33: the VO cut grammar's chapter cards come FIRST (they own a fixed 15-25 s schedule, outside the pivot cap): a short white FlashCard on a spoken word start, verbatim words. A card whose word is not in this list, or that cannot fit before the end, is dropped.
    const chapters = (input.chapterCards ?? [])
      .filter(card => Number.isFinite(card.at) && Number.isFinite(card.duration) && card.text.trim() !== '' && Math.abs((input.words[card.wordIndex]?.start ?? Infinity) - card.at) < 0.05 && card.at >= OPEN_PLATE_SEC + 0.2 && card.at + card.duration <= outputEnd)
      .map(card => ({phrase: card.text.trim(), firstWord: card.wordIndex, lastWord: card.wordIndex, startSec: card.at, endSec: card.at + card.duration, inside: false, before: false, chapterSec: card.duration as number | undefined}));
    const ordered = [...chapters, ...regular.map(item => ({...item, chapterSec: undefined as number | undefined}))];
    const flashStarts: number[] = [];
    for (const pivot of ordered) {
      const chapter = pivot.chapterSec !== undefined;
      if (!chapter && flashCards >= cap) break;
      const duration = chapter ? pivot.chapterSec! : flashCardDuration(pivot.endSec - pivot.startSec);
      const window = {start: pivot.startSec, end: Math.min(pivot.startSec + duration, outputEnd), duration, anchorWordIndex: pivot.firstWord};
      window.duration = Math.round((window.end - window.start) * 1000) / 1000;
      if (window.duration < 0.5) continue; // the brief schema floor
      const blocked = baseBlockers().some(interval => overlaps(window, interval)) || (!chapter && flashStarts.some(start => Math.abs(start - window.start) < 4));
      if (blocked) continue;
      const replaceable = (item: (typeof chosen)[number]) => item.candidate.sentence.index >= 0 && (EVIDENCE_LOSERS.has(item.candidate.composition) || PLAIN_PLATES.has(item.candidate.composition));
      // a plate that sits where the pivot is can be replaced by the card when it is a plain one (statement / quote / headline); an evidence plate or the open plate cannot
      const overlapping = chosen.filter(item => overlaps({start: window.start - 0.25, end: window.end + 0.25}, item.window));
      let victim: (typeof chosen)[number] | undefined;
      if (overlapping.length > 1 || (overlapping.length === 1 && !replaceable(overlapping[0]!))) continue;
      if (overlapping.length === 1) victim = overlapping[0];
      else if (chosen.length >= limit) {
        victim = [...chosen].filter(replaceable).sort((a, b) => a.candidate.score - b.candidate.score)[0];
        if (!victim) continue;
      }
      const sentence = sentences.find(item => pivot.firstWord >= item.firstWord && pivot.firstWord < item.firstWord + item.wordCount) ?? sentences[0]!;
      const candidate: Candidate = {
        composition: 'FlashCard',
        score: 0,
        sentence: {...sentence, start: pivot.startSec, end: pivot.endSec, text: pivot.phrase, firstWord: pivot.firstWord, wordCount: pivot.phrase.split(/\s+/).length},
        content: {flash: pivot.phrase, ...(chapter || flashCards % 3 === 2 ? {ground: 'white'} : {})},
        placement: 'full_screen',
        hint: chapter ? 'a short white chapter card' : 'a short solid-ground flash card',
        reason: chapter ? 'a chapter card on the 15-25 s cut-grammar schedule' : 'a connective pivot beat',
        fixedSec: duration,
      };
      if (victim) chosen.splice(chosen.indexOf(victim), 1);
      chosen.push({candidate, window});
      flashStarts.push(window.start);
      if (chapter) chapterCards += 1;
      else flashCards += 1;
    }
  }
  if (chosen.length === 0) return empty('no_candidates');
  chosen.sort((a, b) => a.window.start - b.window.start);
  const compositions: Record<string, LibraryCompositionId> = {};
  // WP9A: on the explain-plate path every other full-screen plate of a split-friendly composition becomes the top half of a split (the speaker stays in the bottom half).
  const splitIndexes = new Set<number>();
  if (input.explainPlates) {
    let flip = false;
    chosen.forEach(({candidate, window}, index) => {
      if (anchorSplit.has(`${window.anchorWordIndex}`)) { splitIndexes.add(index); return; }
      if (candidate.placement !== 'full_screen' || !SPLIT_PLATE_COMPOSITIONS.has(candidate.composition)) return;
      if (flip) splitIndexes.add(index);
      flip = !flip;
    });
  }
  // WP12B: article / post plates get the walking-highlighter schedule from the spoken word timings.
  const withSchedule = (candidate: Candidate, window: {start: number; duration: number}): Record<string, unknown> => {
    // WP14B: the beat intent picks the motion recipe (OpenPlate hook, article / post plates evidence, stamp punchline, statement pivot, stat stat); a composition with no recipe host gets none.
    const recipeId = input.explainPlates ? recipeForComposition(candidate.composition) : undefined;
    const content = recipeId ? {...candidate.content, recipeId} : candidate.content;
    if (!input.explainPlates || (candidate.composition !== 'WikiCallout' && candidate.composition !== 'TweetCard' && candidate.composition !== 'NewspaperCallout')) return content;
    const text = String(candidate.content.passage ?? candidate.content.body ?? '');
    const schedule = highlightScheduleFor(text, input.words, candidate.sentence.firstWord, window.start, window.duration);
    return schedule.length >= 2 ? {...content, highlightSchedule: schedule} : content;
  };
  const graphics = chosen.map(({candidate, window}, index): SeedRawGraphic => {
    const id = `seed-${kebab(candidate.composition)}-${index + 1}`;
    compositions[id] = candidate.composition;
    return {
      id,
      anchorWordIndex: window.anchorWordIndex,
      durationSeconds: window.duration,
      reason: `library seed: ${candidate.reason}`,
      goal: `Make the point of this line land: ${candidate.reason}`,
      visualDescription: `${candidate.hint}, drawn from the speaker's own words`,
      placement: splitIndexes.has(index) ? 'split_screen' : candidate.placement,
      ...(splitIndexes.has(index) ? {graphicSide: 'top' as const} : {}),
      contentJson: JSON.stringify(withSchedule(candidate, window)),
      ...(candidate.placement === 'overlay'
        ? {box: candidate.box ?? (candidate.composition === 'TopicPills' ? pillBox : box ?? pillBox)}
        : {}),
    };
  });
  const listUpgraded = graphics.filter((_, index) => chosen[index]?.candidate.upgradedFromList).map(graphic => graphic.id);
  const openPlateId = graphics.find(graphic => compositions[graphic.id] === 'OpenPlate' && (input.words[graphic.anchorWordIndex]?.start ?? Infinity) < OPEN_PLATE_MAX_START_SEC)?.id;
  return {raw: {graphics, notes: `library seed: ${graphics.length} graphic(s)`}, compositions, limit, ...(unplacedAnchors > 0 ? {unplacedAnchors} : {}), ...(openPlateId ? {openPlateId} : {}), ...(skippedForCaptionBand > 0 ? {skippedForCaptionBand} : {}), ...(pillsCapped > 0 ? {pillsCapped} : {}), ...(captionClonesSkipped.length > 0 ? {captionClonesSkipped} : {}), ...(listUpgraded.length > 0 ? {listUpgraded} : {}), ...(flashCards > 0 ? {flashCards} : {}), ...(chapterCards > 0 ? {chapterCards} : {})};
}
