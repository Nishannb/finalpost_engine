/**
 * SUBJECT STAGE editorial decision contract (Phase 5.25). Pure: no model, no network.
 *
 * The long-term source of Subject Stage editorial meaning is the AI Director. This module defines WHAT a Director (or a labelled contract fixture, or the deterministic quote proposer)
 * may propose, and the deterministic VALIDATION every proposal must pass before anything is designed or rendered:
 *   chapters  boundaries (word ranges), an optional 1-3 word title with its evidence, or an explicit omission
 *   quotes    a complete spoken sentence / clause with the reason it matters, or an explicit omission
 *   cutaways  a catalogued asset, the spoken evidence that justifies it, and its window
 * Words are referenced by INDEX into the transcript, never by text, so nothing can be invented (fidelity by construction). The renderer never decides editorial meaning; the design step
 * only places what this contract accepted. No live Director call exists here: `source` says where a direction came from, and a contract fixture is never a Director output.
 */
import {z} from 'zod';

import {contentTokens, startsWithTopicMarker} from './stageIntent.ts';
import type {EditorialHint} from './stageDesign.ts';

const idx = z.number().int().min(0);
const range = z.tuple([idx, idx]);
const why = z.string().min(8).max(200);
const seconds = z.number().min(0);

/**
 * Item schemas. Each item is validated ON ITS OWN (Phase 5.26): one malformed or unsupported item is rejected with a code, the rest of the direction still counts.
 * Optional echo fields (`text`, `start`, `end`) let a Director restate what it means; they are CHECKED against the transcript and must agree (they can never introduce text or timing).
 */
export const directionChapterSchema = z.strictObject({
  id: z.string().min(1).max(16),
  wordRange: range,
  /** set = open the chapter with an S1 Set (needs a title); omit = an explicit decision to add nothing */
  treatment: z.enum(['set', 'omit']),
  title: z.strictObject({wordRange: range, why, text: z.string().max(60).optional()}).optional(),
  /** other places in the chapter where the title's topic is spoken (word ranges inside the chapter) */
  topicEvidence: z.array(range).max(4).optional(),
  omitReason: z.string().max(200).optional(),
  why: z.string().max(200).optional(),
  start: seconds.optional(),
  end: seconds.optional(),
});
export const directionQuoteSchema = z.strictObject({
  id: z.string().min(1).max(16),
  /** ONE contiguous range: a quote can never be assembled from separate parts of the transcript */
  wordRange: range,
  /** source_card = an S2 Source card; omit = an explicit decision not to quote */
  treatment: z.enum(['source_card', 'omit']),
  why,
  attributionRange: range.optional(),
  text: z.string().max(240).optional(),
  start: seconds.optional(),
  end: seconds.optional(),
});
export const directionCutawaySchema = z.strictObject({
  id: z.string().min(1).max(16),
  /** the spoken words that justify the cutaway */
  evidenceRange: range,
  /** asset id from the catalogue passed to the validator (e.g. a stock still's file name) */
  asset: z.string().min(1).max(120),
  start: seconds,
  end: seconds,
  why,
});
/** the envelope is strict (a wrong version / source / shape rejects the whole direction); its items are validated one by one */
export const subjectStageDirectionSchema = z.strictObject({
  version: z.literal('subject_stage_direction.v1'),
  /** director = a real Director answer; contract_fixture = a hand-authored CONTRACT TEST (never Director output); deterministic = the local quote proposer */
  source: z.enum(['director', 'contract_fixture', 'deterministic']),
  chapters: z.array(z.unknown()).max(24).default([]),
  quotes: z.array(z.unknown()).max(24).default([]),
  cutaways: z.array(z.unknown()).max(12).default([]),
});
export type DirectionChapter = z.input<typeof directionChapterSchema>;
export type DirectionQuote = z.input<typeof directionQuoteSchema>;
export type DirectionCutaway = z.input<typeof directionCutawaySchema>;
export type SubjectStageDirection = {version: 'subject_stage_direction.v1'; source: 'director' | 'contract_fixture' | 'deterministic'; chapters?: DirectionChapter[]; quotes?: DirectionQuote[]; cutaways?: DirectionCutaway[]};

export type TranscriptWord = {text: string; start: number; end: number};
/** what the validator knows about an asset: its id, url and descriptive tags (stock query / keyword); relevance is checked against these tags only */
export type CatalogAsset = {id: string; url: string; mediaKind: 'image' | 'video'; tags: string};
export type Rejection = {kind: 'chapter' | 'title' | 'quote' | 'cutaway' | 'direction'; id: string; code: string; reason: string};
export type Omission = {kind: 'chapter' | 'quote'; id: string; reason: string};

export type AcceptedChapter = {id: string; start: number; end: number; title?: {text: string; evidence: 'topic_sentence' | 'recurs_in_chapter' | 'topic_evidence'; why: string}};
/** `origin` (Phase 5.29D-PRE): 'builtin' = taken from the deterministic proposer as the fallback quote set (never set by the validator itself) */
export type AcceptedQuote = {id: string; start: number; end: number; text: string; attribution?: string; why: string; origin?: 'builtin'};
export type AcceptedCutaway = {id: string; start: number; end: number; asset: CatalogAsset; evidence: string; matchedTags: string[]; why: string};
export type ValidatedDirection = {source: 'director' | 'contract_fixture' | 'deterministic'; chapters: AcceptedChapter[]; quotes: AcceptedQuote[]; cutaways: AcceptedCutaway[]; omissions: Omission[]; rejected: Rejection[]};

export const DIRECTION_RULES = {
  titleMaxWords: 3, quoteMinWords: 4, quoteMaxWords: 16, quoteMinDensity: 0.3, quoteMinContent: 2, cutawayMinSec: 1, cutawayMaxSec: 3.5, cutawayEvidenceSlackSec: 1.5,
  /** an explicit start / end may differ from the words' own times by at most this much */
  timingToleranceSec: 0.25,
  /** a quote may not run across a silence longer than this (it would join two separate moments) */
  quoteMaxInternalGapSec: 1.2,
} as const;
/** conversational filler and calls to action that are never an editorial quote */
export const FILLER_PATTERNS: readonly RegExp[] = [/\bhere'?s the thing\b/i, /\byou know\b/i, /\blet me tell you\b/i, /\btrust me\b/i, /\bfollow for\b/i, /\blike and subscribe\b/i, /\bpart two\b/i, /\bsmash (?:that|the) (?:like|button)\b/i, /\bcomment below\b/i,
  // Phase 5.27C: calls to action the list missed ("Follow me for more valuable tips." was accepted). Narrow on purpose: "follow through", "subscribe to an idea" stay valid.
  /\bfollow (?:me|us)\b/i, /\bsubscribe (?:to (?:my|our|this) channel|for more)\b/i, /\blink in (?:my |the )?bio\b/i, /\bturn on (?:post )?notifications\b/i];

/** Phase 5.27C: single-word connectives that may LEAD a complete claim ("So if a video that you edit goes viral, you should expect a bonus.") */
const LEADING_CONNECTIVE = /^\s*(?:so|now|but|however|anyway|okay|alright|then|next|meanwhile|finally)\b,?\s*/i;
/** spoken interjections: not content when deciding whether a connective leads a real clause */
const INTERJECTIONS: ReadonlySet<string> = new Set(['yeah', 'okay', 'alright', 'right', 'well', 'like', 'basically', 'actually', 'honestly', 'guys', 'anyway', 'literally']);
/** what is still only a transition once the connective is removed */
const DISCOURSE_ONLY: readonly RegExp[] = [/^here(?:'?s| is) the (?:thing|deal|point)\b/i, /^let'?s (?:get|dive|jump|talk|move|go)\b/i, /^moving on\b/i, /^(?:the )?(?:next|second|third|last) (?:one|thing|point|tip|step)\b/i, /^(?:that'?s|this is) (?:it|all)\b/i, /^what i mean is\b/i];
/**
 * A quote that is a discourse TRANSITION, not a statement (Phase 5.27C narrows the Phase 5.25 rule, which rejected every quote opening with a topic marker, including complete claims led by "So").
 * Still a transition: a multi-word or presentational opener (let's, here's, another, the second / third / next / last, moving on); a connective followed by another opener or a discourse-only phrase;
 * a connective followed by fewer than `quoteMinContent` content words. A connective followed by a complete, meaningful clause is a statement.
 */
export function isDiscourseTransition(text: string): boolean {
  if (!startsWithTopicMarker(text)) return false;
  const lead = LEADING_CONNECTIVE.exec(text);
  if (!lead) return true;
  const rest = text.slice(lead[0].length);
  if (startsWithTopicMarker(rest) || DISCOURSE_ONLY.some(re => re.test(rest))) return true;
  return contentTokens(rest).filter(t => !INTERJECTIONS.has(t)).length < DIRECTION_RULES.quoteMinContent;
}


const textOf = (words: readonly TranscriptWord[], [a, b]: readonly [number, number]) => words.slice(a, b + 1).map(w => w.text).join(' ');
const stem = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').replace(/(ies)$/, 'y').replace(/s$/, '');
const normText = (t: string) => t.toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}%$']+/gu, '')).filter(Boolean).join(' ');
const validRange = (words: readonly TranscriptWord[], r: readonly [number, number]) => r[0] <= r[1] && r[1] < words.length;
const SENTENCE_END = /[.!?]["”]?$/;

/** sentence index of every word (a sentence ends at . ! ?) */
function sentenceStarts(words: readonly TranscriptWord[]): number[] {
  const starts = [0];
  words.forEach((w, i) => { if (SENTENCE_END.test(w.text) && i + 1 < words.length) starts.push(i + 1); });
  return starts;
}
const issue = (e: z.ZodError) => e.issues.slice(0, 2).map(i => `${i.path.join('.') || '(item)'}: ${i.message}`).join('; ');
/** an item schema failure: an unknown / unsupported treatment is named as such */
function itemFailure(kind: Rejection['kind'], raw: unknown, e: z.ZodError): Rejection {
  const id = raw && typeof raw === 'object' && typeof (raw as {id?: unknown}).id === 'string' ? (raw as {id: string}).id : '?';
  const unsupported = e.issues.some(i => i.path[0] === 'treatment');
  return {kind, id, code: unsupported ? 'unsupported_treatment' : 'invalid_item', reason: issue(e)};
}
/** explicit times must agree with the referenced words */
function timingAgrees(words: readonly TranscriptWord[], r: readonly [number, number], start?: number, end?: number): boolean {
  const tol = DIRECTION_RULES.timingToleranceSec;
  if (start !== undefined && Math.abs(start - words[r[0]]!.start) > tol) return false;
  if (end !== undefined && Math.abs(end - words[r[1]]!.end) > tol) return false;
  return true;
}

export function validateSubjectStageDirection(raw: unknown, words: readonly TranscriptWord[], opts: {assets?: readonly CatalogAsset[]; durationSec?: number} = {}): ValidatedDirection {
  const parsed = subjectStageDirectionSchema.safeParse(raw);
  if (!parsed.success) return {source: 'contract_fixture', chapters: [], quotes: [], cutaways: [], omissions: [], rejected: [{kind: 'direction', id: '-', code: 'schema', reason: issue(parsed.error)}]};
  const d = parsed.data;
  const rejected: Rejection[] = [];
  const omissions: Omission[] = [];
  const starts = sentenceStarts(words);
  const sentenceOf = (i: number) => { let s = 0; for (const st of starts) if (st <= i) s = st; return s; };
  const duration = opts.durationSec ?? (words.length ? words[words.length - 1]!.end : 0);

  // chapters: valid, ordered, non-overlapping, timing consistent
  const chapters: AcceptedChapter[] = [];
  const chapterRanges: Array<[number, number]> = [];
  let lastEnd = -1;
  // Phase 5.29C: ids must be unique per kind (a Director can repeat one); the FIRST item with an id is judged, every later one is rejected (deterministic, input order)
  const duplicate = (seen: Set<string>, id: string) => { if (seen.has(id)) return true; seen.add(id); return false; };
  const chapterIds = new Set<string>(), quoteIds = new Set<string>(), cutawayIds = new Set<string>();
  for (const rawItem of d.chapters) {
    const item = directionChapterSchema.safeParse(rawItem);
    if (!item.success) { rejected.push(itemFailure('chapter', rawItem, item.error)); continue; }
    const c = item.data;
    if (duplicate(chapterIds, c.id)) { rejected.push({kind: 'chapter', id: c.id, code: 'duplicate_id', reason: `chapter id "${c.id}" is used by an earlier chapter`}); continue; }
    if (!validRange(words, c.wordRange)) { rejected.push({kind: 'chapter', id: c.id, code: 'bad_range', reason: 'chapter word range invalid'}); continue; }
    if (c.wordRange[0] <= lastEnd) { rejected.push({kind: 'chapter', id: c.id, code: 'overlapping_chapter', reason: 'chapter overlaps (or precedes) the previous chapter'}); continue; }
    if (!timingAgrees(words, c.wordRange, c.start, c.end)) { rejected.push({kind: 'chapter', id: c.id, code: 'timing_mismatch', reason: 'explicit start / end contradict the chapter words'}); continue; }
    if (c.treatment === 'omit' && !c.omitReason?.trim()) { rejected.push({kind: 'chapter', id: c.id, code: 'omission_without_reason', reason: 'an omission must say why'}); continue; }
    if (c.treatment === 'set' && !c.title) { rejected.push({kind: 'chapter', id: c.id, code: 'set_without_title', reason: 'an S1 Set needs a title; use treatment "omit" to add nothing'}); continue; }
    lastEnd = c.wordRange[1];
    chapterRanges.push(c.wordRange);
    const chapter: AcceptedChapter = {id: c.id, start: words[c.wordRange[0]]!.start, end: words[c.wordRange[1]]!.end};
    if (c.treatment === 'omit') omissions.push({kind: 'chapter', id: c.id, reason: c.omitReason!.trim()});
    if (c.treatment === 'set' && c.title) {
      const t = c.title.wordRange;
      const titleText = validRange(words, t) ? textOf(words, t) : '';
      const content = contentTokens(titleText);
      const n = t[1] - t[0] + 1;
      let code = '';
      if (!validRange(words, t) || t[0] < c.wordRange[0] || t[1] > c.wordRange[1]) code = 'title_outside_chapter';
      else if (c.title.text !== undefined && normText(c.title.text) !== normText(titleText)) code = 'text_mismatch'; // the restated text is not what was said there
      else if (n > DIRECTION_RULES.titleMaxWords) code = 'title_too_long';
      else if (content.length === 0) code = 'title_not_meaningful'; // glue words, a lone number, a filler word
      if (!code) {
        const firstSentence = sentenceOf(c.wordRange[0]);
        const inTopicSentence = sentenceOf(t[0]) === firstSentence && t[0] >= c.wordRange[0];
        const chapterTokens = contentTokens(textOf(words, c.wordRange)).map(stem);
        const recurs = content.map(stem).some(tok => chapterTokens.filter(x => x === tok).length >= 2);
        const evidence = (c.topicEvidence ?? []).filter(r => validRange(words, r) && r[0] >= c.wordRange[0] && r[1] <= c.wordRange[1] && (r[1] < t[0] || r[0] > t[1]));
        const backed = evidence.some(r => contentTokens(textOf(words, r)).map(stem).some(tok => content.map(stem).includes(tok)));
        const ev: NonNullable<AcceptedChapter['title']>['evidence'] | null = inTopicSentence ? 'topic_sentence' : recurs ? 'recurs_in_chapter' : backed ? 'topic_evidence' : null;
        if (!ev) code = 'title_without_topic_evidence';
        else chapter.title = {text: titleText.replace(/[.,;:!?"“”]+$/g, ''), evidence: ev, why: c.title.why};
      }
      if (code) rejected.push({kind: 'title', id: c.id, code, reason: `title "${titleText}" rejected`});
    }
    chapters.push(chapter);
  }

  // quotes: one contiguous, complete, meaningful spoken clause; inside one chapter; no internal long silence; no overlap; timing consistent
  const quotes: AcceptedQuote[] = [];
  const quoteRanges: Array<[number, number]> = [];
  for (const rawItem of d.quotes) {
    const item = directionQuoteSchema.safeParse(rawItem);
    if (!item.success) { rejected.push(itemFailure('quote', rawItem, item.error)); continue; }
    const q = item.data;
    if (duplicate(quoteIds, q.id)) { rejected.push({kind: 'quote', id: q.id, code: 'duplicate_id', reason: `quote id "${q.id}" is used by an earlier quote`}); continue; }
    if (!validRange(words, q.wordRange)) { rejected.push({kind: 'quote', id: q.id, code: 'bad_range', reason: 'quote word range invalid'}); continue; }
    if (q.treatment === 'omit') { omissions.push({kind: 'quote', id: q.id, reason: q.why}); continue; }
    const text = textOf(words, q.wordRange);
    const n = q.wordRange[1] - q.wordRange[0] + 1;
    const first = q.wordRange[0];
    const startsClause = first === sentenceOf(first) || /[,;:—–]$/.test(words[first - 1]?.text ?? '');
    const content = contentTokens(text);
    let maxGap = 0;
    for (let i = q.wordRange[0] + 1; i <= q.wordRange[1]; i += 1) maxGap = Math.max(maxGap, words[i]!.start - words[i - 1]!.end);
    // straddling a chapter boundary joins two chapters' material; a quote wholly inside one chapter (or in time no chapter claims) is one moment
    const crossesChapter = chapterRanges.some(r => q.wordRange[0] <= r[1] && r[0] <= q.wordRange[1] && !(q.wordRange[0] >= r[0] && q.wordRange[1] <= r[1]));
    let code = '';
    if (q.text !== undefined && normText(q.text) !== normText(text)) code = 'text_mismatch';
    else if (!timingAgrees(words, q.wordRange, q.start, q.end)) code = 'timing_mismatch';
    else if (quoteRanges.some(r => q.wordRange[0] <= r[1] && r[0] <= q.wordRange[1])) code = 'overlapping_quote';
    else if (maxGap > DIRECTION_RULES.quoteMaxInternalGapSec) code = 'quote_spans_gap';
    else if (crossesChapter) code = 'quote_crosses_chapter';
    else if (n < DIRECTION_RULES.quoteMinWords || n > DIRECTION_RULES.quoteMaxWords) code = 'quote_length';
    else if (!startsClause || !SENTENCE_END.test(words[q.wordRange[1]]!.text)) code = 'quote_incomplete';
    else if (isDiscourseTransition(text)) code = 'quote_discourse_transition';
    else if (FILLER_PATTERNS.some(re => re.test(text))) code = 'quote_filler';
    else if (content.length < DIRECTION_RULES.quoteMinContent || content.length / n < DIRECTION_RULES.quoteMinDensity) code = 'quote_not_meaningful';
    if (code) { rejected.push({kind: 'quote', id: q.id, code, reason: `quote "${text}" rejected`}); continue; }
    quoteRanges.push(q.wordRange);
    const attribution = q.attributionRange && validRange(words, q.attributionRange) ? textOf(words, q.attributionRange) : undefined;
    quotes.push({id: q.id, start: words[q.wordRange[0]]!.start, end: words[q.wordRange[1]]!.end, text, ...(attribution ? {attribution} : {}), why: q.why});
  }

  // cutaways: a catalogued asset whose tags are SPOKEN in the evidence, near the window; valid, non-overlapping timing inside the video
  const cutaways: AcceptedCutaway[] = [];
  for (const rawItem of d.cutaways) {
    const item = directionCutawaySchema.safeParse(rawItem);
    if (!item.success) { rejected.push(itemFailure('cutaway', rawItem, item.error)); continue; }
    const c = item.data;
    if (duplicate(cutawayIds, c.id)) { rejected.push({kind: 'cutaway', id: c.id, code: 'duplicate_id', reason: `cutaway id "${c.id}" is used by an earlier cutaway`}); continue; }
    const asset = (opts.assets ?? []).find(a => a.id === c.asset);
    const len = c.end - c.start;
    let code = '';
    let matched: string[] = [];
    if (!(c.end > c.start)) code = 'bad_timing';
    else if (cutaways.some(o => c.start < o.end && o.start < c.end)) code = 'overlapping_cutaway';
    else if (!asset) code = 'asset_not_available';
    else if (!validRange(words, c.evidenceRange)) code = 'bad_range';
    else if (!(len >= DIRECTION_RULES.cutawayMinSec && len <= DIRECTION_RULES.cutawayMaxSec)) code = 'cutaway_duration';
    else if (duration > 0 && c.end > duration + 1e-6) code = 'bad_timing'; // past the end of the video
    else {
      const ev = c.evidenceRange;
      const evStart = words[ev[0]]!.start, evEnd = words[ev[1]]!.end;
      if (evEnd < c.start - DIRECTION_RULES.cutawayEvidenceSlackSec || evStart > c.end + DIRECTION_RULES.cutawayEvidenceSlackSec) code = 'evidence_not_near_window';
      else {
        const spoken = new Set(contentTokens(textOf(words, ev)).map(stem));
        matched = contentTokens(asset.tags).map(stem).filter(t => spoken.has(t));
        if (matched.length === 0) code = 'not_relevant';
      }
    }
    if (code) { rejected.push({kind: 'cutaway', id: c.id, code, reason: `cutaway ${c.asset} rejected`}); continue; }
    cutaways.push({id: c.id, start: c.start, end: c.end, asset: asset!, evidence: textOf(words, c.evidenceRange), matchedTags: [...new Set(matched)], why: c.why});
  }
  return {source: d.source, chapters, quotes, cutaways, omissions, rejected};
}

/**
 * Deterministic proposer (no Director): QUOTES ONLY, never titles or cutaways. Every complete sentence is proposed; the validator keeps the meaningful ones.
 */
export function proposeDeterministicQuotes(words: readonly TranscriptWord[]): SubjectStageDirection {
  const starts = sentenceStarts(words);
  const quotes = starts.map((s, i) => ({id: `dq${i}`, wordRange: [s, (starts[i + 1] ?? words.length) - 1] as [number, number], treatment: 'source_card' as const, why: 'deterministic proposal: a complete spoken sentence'}));
  return {version: 'subject_stage_direction.v1', source: 'deterministic', chapters: [], quotes, cutaways: []};
}

export type CompiledSpan = {start: number; end: number; stage: 'S1' | 'S2' | 'S4'; ref?: SpanRef};
/**
 * Phase 5.27D.1: the accepted item a compiled S1 / S2 span shows, so the design step resolves its text by identity, not by time: `index` is the item's position in
 * ValidatedDirection.chapters (a title) or .quotes (a quote), `id` its id (ids are not required to be unique, the index is).
 */
export type SpanRef = {kind: 'title' | 'quote'; id: string; index: number};
/** The compiler's timing rules (values unchanged since Phase 5.25; named in Phase 5.27C so its decisions can be reported). */
export const COMPILE_RULES = {
  /** an S1 opens its chapter and lasts at most this long (and ends at the chapter's first accepted quote, the chapter end or the video end) */
  titleMaxSec: 6,
  /** an S1 window shorter than this is not shown */
  titleMinSec: 1.4,
  /** an S2 starts this long before its quote and holds this long after it */
  quoteLeadSec: 0.15,
  quoteTailSec: 0.6,
  /** the first treatment starting before this owns the very start of the video */
  openingSnapSec: 1.0,
} as const;
/**
 * Phase 5.27C: what the compiler did with EVERY accepted title and quote (nothing is dropped silently any more). `compiled` items carry their final window and any adjustment;
 * `suppressed` items carry the reason, the window they would have had, and the card that was prioritized over them (Phase 5.27D).
 */
export type CompileOutcome = {
  kind: 'title' | 'quote';
  id: string;
  text: string;
  state: 'compiled' | 'suppressed';
  /** the final window (compiled) or the window the item would have had (suppressed), output seconds */
  start: number;
  end: number;
  reason?: 'title_window_below_min' | 'overlaps_earlier_card';
  detail?: string;
  /** Phase 5.27D: the item kept instead (`kind:id`), when the reason is a conflict with another card */
  prioritized?: string;
  adjustments: string[];
};
/**
 * Accepted decisions -> Subject Stage spans that tile [0, duration): an S1 opens each titled chapter (until its first quote's card, at most 6 s), an S2 holds each quote (quote time + 0.6 s),
 * everything else is a neutral S4. The editorial hints carry the accepted text to the design step; cutaways are passed through as explicit requests. `outcomes` reports every title / quote.
 *
 * Phase 5.27D scheduling (no threshold changed; every adjustment is listed in the outcome):
 *   - two cards whose COSMETIC margins overlap (a quote's 0.6 s tail, its 0.15 s lead) hand over at a point between the earlier item's required end (a quote's last word; a title's
 *     start + titleMinSec) and the later quote's first word: the tail / lead is trimmed to that point. Only when the spoken words themselves collide is it a conflict: the item placed first
 *     keeps priority (titles in chapter order, then quotes in time order) and the dropped quote names it.
 *   - a quote that STARTS a titled chapter leaves the title no opening window: the title is deferred to right after that quote's card, still inside the chapter (until the chapter's next quote
 *     card, the chapter end, 6 s, the video end); if it gets less than titleMinSec, the quote's tail is trimmed to its last word to make room; if it still does not fit, it is suppressed.
 *   - Phase 5.27D.1: "that quote's card" is the opening quote SEQUENCE (quotes that hand over to one another), so the deferred title never takes a following quote's slot; every S1 / S2
 *     span carries `ref` (the chapter / quote id) so the design step resolves its text by identity.
 */
export function compileDirection(v: ValidatedDirection, durationSec: number): {spans: CompiledSpan[]; editorial: EditorialHint[]; cutaways: AcceptedCutaway[]; outcomes: CompileOutcome[]} {
  type Item = {start: number; end: number; stage: 'S1' | 'S2'; hint: EditorialHint; outcome: CompileOutcome; mustStart: number; mustEnd: number; ref: SpanRef};
  const R = COMPILE_RULES;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const items: Item[] = [];
  const outcomes: CompileOutcome[] = [];
  const quotes = [...v.quotes].sort((a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /** a quote's card may not end later than this (its tail was trimmed so a deferred title fits) */
  const quoteEndCap = new Map<string, {end: number; by: string}>();
  for (const [chapterIndex, c] of v.chapters.entries()) {
    if (!c.title) continue;
    const inChapter = quotes.filter(q => q.start >= c.start && q.start < c.end);
    const firstQuote = inChapter[0];
    // Phase 5.27C: the S1 hands over to the quote card where that CARD starts (quote - lead), so a titled chapter keeps its later quote.
    const handOver = firstQuote ? firstQuote.start - R.quoteLeadSec : Number.POSITIVE_INFINITY;
    const end = Math.min(c.start + R.titleMaxSec, handOver, c.end, durationSec);
    const adjustments: string[] = [];
    if (end === c.start + R.titleMaxSec) adjustments.push(`capped_at_${R.titleMaxSec}s`);
    if (firstQuote && end === handOver) adjustments.push(`hands_over_to_quote:${firstQuote.id}`);
    if (end === durationSec && Math.min(c.start + R.titleMaxSec, c.end) > durationSec) adjustments.push('clamped_to_video_end');
    const outcome: CompileOutcome = {kind: 'title', id: c.id, text: c.title.text, state: 'compiled', start: r3(c.start), end: r3(Math.max(c.start, end)), adjustments};
    outcomes.push(outcome);
    if (end - c.start >= R.titleMinSec) { items.push({start: c.start, end, stage: 'S1', hint: {start: c.start, end, headline: c.title.text}, outcome, mustStart: c.start, mustEnd: c.start + R.titleMinSec, ref: {kind: 'title', id: c.id, index: chapterIndex}}); continue; }
    // Phase 5.27D: no opening window because a quote starts the chapter -> defer the title to right after the quote card(s), inside the chapter.
    // Phase 5.27D.1: "after the quote card" means after the OPENING QUOTE SEQUENCE: every in-chapter quote whose card starts before the previous card's natural end (it hands over to it)
    // belongs to the sequence, so a deferred title never takes the slot of a quote that would otherwise hand over (the title never displaces a valid quote).
    const deferredEnd = (from: number) => { const next = inChapter.find(q => q.start - R.quoteLeadSec >= from); return Math.min(from + R.titleMaxSec, next ? next.start - R.quoteLeadSec : c.end, c.end, durationSec); };
    if (firstQuote && end === handOver) {
      const sequence = [firstQuote];
      let natural = Math.min(durationSec, firstQuote.end + R.quoteTailSec);
      for (const q of inChapter.slice(1)) { if (q.start - R.quoteLeadSec >= natural) break; sequence.push(q); natural = Math.max(natural, Math.min(durationSec, q.end + R.quoteTailSec)); }
      const last = sequence[sequence.length - 1]!;
      // room is made only by trimming the LAST card's tail to its last word, and only when no other card of the sequence ends later than that word
      const trimTo = Math.max(...sequence.map(q => (q === last ? q.end : Math.min(durationSec, q.end + R.quoteTailSec))));
      let from = natural, trimmed = false;
      if (deferredEnd(from) - from < R.titleMinSec && trimTo < natural && deferredEnd(trimTo) - trimTo >= R.titleMinSec) { from = trimTo; trimmed = true; }
      const to = deferredEnd(from);
      if (from < c.end && to - from >= R.titleMinSec) {
        Object.assign(outcome, {start: r3(from), end: r3(to)});
        adjustments.length = 0;
        adjustments.push(`deferred_after_quote:${last.id}`);
        if (sequence.length > 1) adjustments.push(`after_quote_sequence:${sequence.map(q => q.id).join(',')}`);
        if (to === from + R.titleMaxSec) adjustments.push(`capped_at_${R.titleMaxSec}s`);
        if (to === c.end) adjustments.push('ends_at_chapter_end');
        if (trimmed) { quoteEndCap.set(last.id, {end: from, by: `title:${c.id}`}); adjustments.push(`quote_${last.id}_tail_trimmed`); }
        items.push({start: from, end: to, stage: 'S1', hint: {start: from, end: to, headline: c.title.text}, outcome, mustStart: from, mustEnd: from + R.titleMinSec, ref: {kind: 'title', id: c.id, index: chapterIndex}});
        continue;
      }
      const after = sequence.length > 1 ? `the quote sequence ${sequence.map(q => q.id).join(', ')}` : `quote ${last.id}`;
      Object.assign(outcome, {state: 'suppressed', reason: 'title_window_below_min', prioritized: `quote:${last.id}`,
        detail: `quote ${firstQuote.id} starts the chapter (no opening window), and after ${after} (${r3(Math.min(trimTo, natural))}-${r3(c.end)} s inside the chapter) there are only ${r3(Math.max(0, deferredEnd(Math.min(trimTo, natural)) - Math.min(trimTo, natural)))} s < ${R.titleMinSec} s; the quotes are kept`});
      continue;
    }
    Object.assign(outcome, {state: 'suppressed', reason: 'title_window_below_min', detail: `S1 window ${r3(Math.max(0, end - c.start))} s < ${R.titleMinSec} s`});
  }
  for (const q of quotes) {
    const cap = quoteEndCap.get(q.id);
    let start = Math.max(0, q.start - R.quoteLeadSec), end = Math.min(durationSec, q.end + R.quoteTailSec, cap ? cap.end : Number.POSITIVE_INFINITY);
    const adjustments = q.end + R.quoteTailSec > durationSec ? ['clamped_to_video_end'] : [];
    if (cap) adjustments.push(`tail_trimmed_for:${cap.by}`);
    const outcome: CompileOutcome = {kind: 'quote', id: q.id, text: q.text, state: 'compiled', start: r3(start), end: r3(end), adjustments};
    outcomes.push(outcome);
    // Phase 5.27D: resolve overlaps with already placed cards by trimming cosmetic margins only (all-or-nothing); a collision of required windows is a conflict, the placed card keeps priority
    const plan: Array<() => void> = [];
    let conflict: Item | null = null;
    for (const it of items.filter(x => x.start < end && start < x.end).sort((a, b) => a.start - b.start)) {
      if (it.start <= q.start) {
        const b = Math.max(it.mustEnd, start);
        if (b > q.start + 1e-9) { conflict = it; break; }
        if (b < it.end) plan.push(() => { it.end = b; it.hint = {...it.hint, end: b}; it.outcome.end = r3(b); it.outcome.adjustments.push(`tail_trimmed_for:quote:${q.id}`); });
        if (b > start) { const from = start; plan.push(() => { adjustments.push(`lead_trimmed_after:${it.outcome.kind}:${it.outcome.id}(${r3(b - from)}s)`); }); start = b; }
      } else {
        if (it.start < q.end - 1e-9) { conflict = it; break; }
        const e = it.start; plan.push(() => adjustments.push(`tail_trimmed_for:${it.outcome.kind}:${it.outcome.id}`)); end = e;
      }
    }
    if (conflict) {
      Object.assign(outcome, {state: 'suppressed', reason: 'overlaps_earlier_card', prioritized: `${conflict.outcome.kind}:${conflict.outcome.id}`,
        detail: `the spoken words (${r3(q.start)}-${r3(q.end)} s) collide with ${conflict.outcome.kind} ${conflict.outcome.id}'s required window (${r3(conflict.mustStart)}-${r3(conflict.mustEnd)} s), which was placed first and keeps priority`});
      continue;
    }
    for (const apply of plan) apply();
    Object.assign(outcome, {start: r3(start), end: r3(end)});
    items.push({start, end, stage: 'S2', hint: {start, end, quote: q.text, ...(q.attribution ? {attribution: q.attribution} : {})}, outcome, mustStart: q.start, mustEnd: q.end, ref: {kind: 'quote', id: q.id, index: v.quotes.indexOf(q)}});
  }
  items.sort((a, b) => a.start - b.start);
  // the opening treatment owns the very start of the video (no neutral sliver before the first spoken word)
  if (items[0] && items[0].start < R.openingSnapSec) { if (items[0].start > 0) items[0].outcome.adjustments.push('snapped_to_0_opening'); items[0].start = 0; items[0].hint = {...items[0].hint, start: 0}; items[0].outcome.start = 0; }
  const spans: CompiledSpan[] = [];
  const editorial: EditorialHint[] = [];
  let t = 0;
  for (const it of items) {
    const gap = it.start - t;
    // a sliver (< 0.3 s) between two treatments is absorbed by the previous span, never its own neutral span
    if (gap > 1e-6 && gap < 0.3 && spans.length > 0) spans[spans.length - 1]!.end = r3(it.start);
    else if (gap > 1e-6) spans.push({start: r3(t), end: r3(it.start), stage: 'S4'});
    spans.push({start: r3(it.start), end: r3(it.end), stage: it.stage, ref: it.ref});
    editorial.push({...it.hint, start: r3(it.hint.start), end: r3(it.hint.end)});
    t = it.end;
  }
  if (durationSec - t > 1e-6) spans.push({start: r3(t), end: r3(durationSec), stage: 'S4'});
  return {spans, editorial, cutaways: v.cutaways, outcomes};
}
