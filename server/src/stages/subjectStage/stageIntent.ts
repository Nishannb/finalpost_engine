/**
 * SUBJECT STAGE: deterministic lexical intent classifier (no model, no network). A spoken sentence / segment is mapped to the intent that selects its stage:
 *   context_or_setting -> S1 | quoting_or_citing -> S2 | search_or_many_sources -> S3 | explanation_key_terms -> S4 | official_or_final -> S1 or S5 | confirmation_or_verdict -> S4 (a single accent)
 * Pure. Also derives KEYWORD candidates (exact substrings of the spoken text) for the accents, and caps keyword hits at one per second.
 */
import type {StageId, SubjectStageIntent} from './subjectStageConfig.ts';

export type {SubjectStageIntent};
export const INTENT_PRIORITY: readonly SubjectStageIntent[] = ['official_or_final', 'quoting_or_citing', 'search_or_many_sources', 'context_or_setting', 'explanation_key_terms', 'confirmation_or_verdict'];

/** The stage(s) an intent selects, primary first. */
export const INTENT_STAGES: Readonly<Record<SubjectStageIntent, readonly StageId[]>> = {
  context_or_setting: ['S1'],
  quoting_or_citing: ['S2'],
  search_or_many_sources: ['S3'],
  explanation_key_terms: ['S4'],
  official_or_final: ['S1', 'S5'],
  confirmation_or_verdict: ['S4'],
};

type Rule = {intent: SubjectStageIntent; weight: number; re: RegExp};
const RULES: readonly Rule[] = [
  {
    intent: 'official_or_final',
    weight: 3,
    re: /\b(official(?:ly)?|government|ministry|authorit(?:y|ies)|press release|announcement|regulations?|ruling|verdict|decision|final(?:ly)?|conclusion|bottom line|in the end|the truth is|verify (?:through|with)|so remember|statement from)\b/gi,
  },
  {
    intent: 'quoting_or_citing',
    weight: 3,
    re: /\b(said|says|saying|according to|quotes?|quoted|wrote|writes|stated|states|announced|reported|statement|posted|tweeted|caption|headline|the message|it (?:says|reads)|reads as)\b/gi,
  },
  {
    intent: 'search_or_many_sources',
    weight: 3,
    re: /\b(search(?:ed|ing|es)?|google[ds]?|results?|links?|websites?|sources?|articles?|pages?|headlines|news (?:sites|outlets)|scroll(?:ing|ed)?|browse|browsing|listings?|reviews?|multiple|everywhere|all over|top results)\b/gi,
  },
  {
    intent: 'context_or_setting',
    weight: 2.5,
    re: /\b(imagine|picture this|back in|years? ago|last (?:week|year|month)|yesterday|it (?:all )?started|the story|situation|background|context|there (?:was|were)|once|during|recently|currently|these days|right now|a few days|in (?:19|20)\d\d)\b/gi,
  },
  {
    intent: 'explanation_key_terms',
    weight: 1.5,
    re: /\b(means?|called|known as|stands for|defined|definition|the term|key|basically|essentially|because|the reason|why|how|what is|which is|is when|refers? to|in other words|for example|step|first|second|third|important|remember|tip)\b/gi,
  },
  {
    intent: 'confirmation_or_verdict',
    weight: 2,
    re: /\b(yes|yep|exactly|correct|that'?s right|that is right|confirmed|true|indeed|absolutely|definitely|not true|false|fake|fact)\b/gi,
  },
];
/** a quoted passage of >= 3 words is a strong quoting cue */
const QUOTED = /["“]([^"”]{12,})["”]/g;
/** exact words that make a short sentence a confirmation / verdict */
const VERDICT_WORD = /\b(yes|yep|exactly|correct|confirmed|true|indeed|absolutely|definitely|false|fake)\b/i;

export type IntentResult = {intent: SubjectStageIntent | null; score: number; scores: Partial<Record<SubjectStageIntent, number>>; hits: string[]};

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Classify one sentence / segment. An intent needs a score >= 2; ties resolve by INTENT_PRIORITY. A confirmation only counts in a SHORT sentence (<= 10 words). */
export function classifyIntent(text: string): IntentResult {
  const scores: Partial<Record<SubjectStageIntent, number>> = {};
  const hits: string[] = [];
  const add = (intent: SubjectStageIntent, amount: number, hit: string) => {
    scores[intent] = (scores[intent] ?? 0) + amount;
    hits.push(`${intent}:${hit.toLowerCase()}`);
  };
  const words = wordCount(text);
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      if (rule.intent === 'confirmation_or_verdict') add(rule.intent, words <= 10 ? rule.weight : 0.5, m[0]);
      else add(rule.intent, rule.weight, m[0]);
    }
  }
  for (const m of text.matchAll(QUOTED)) add('quoting_or_citing', 3, `"${m[1]!.slice(0, 20)}"`);
  let best: SubjectStageIntent | null = null;
  let bestScore = 0;
  for (const intent of INTENT_PRIORITY) {
    const v = scores[intent] ?? 0;
    if (v >= 2 && v > bestScore + 1e-9) {
      best = intent;
      bestScore = v;
    }
  }
  return {intent: best, score: bestScore, scores, hits};
}

// ------------------------------------------------------------------------------------------------ keywords
export type KeywordHit = {at: number; text: string; score: number};
const STOP = new Set(
  'a an the and or but so if then than that this these those it its is are was were be been being to of in on at by for with from as into about over under not no yes do does did have has had i you he she we they me my your our their them his her what when where which who whom whose how why can could should would will just really very also still even more most some any all each every because everyone everything something nothing anything actually honestly people never always remember important basically essentially currently recently usually finally simply literally'.split(' '),
);

/**
 * Keyword candidates from a spoken sentence: numbers / percentages / amounts, ALL-CAPS terms, quoted words, proper nouns inside the sentence, the term after "called / known as / means", else the longest
 * content word. `text` is ALWAYS an exact substring of the spoken sentence (nothing is invented). `at` is estimated from the character position inside the sentence's [start, end]; when the caller has real
 * word timings it passes its own keywords instead.
 */
export function deriveKeywords(sentence: {start: number; end: number; text: string}): KeywordHit[] {
  const text = sentence.text;
  const span = Math.max(0.001, sentence.end - sentence.start);
  const found: KeywordHit[] = [];
  const push = (index: number, raw: string, score: number) => {
    let clean = raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '');
    // trim function words off the edges of a multi-word capture ("compounding and" -> "compounding")
    const parts = clean.split(/\s+/);
    while (parts.length > 1 && STOP.has(parts[parts.length - 1]!.toLowerCase())) parts.pop();
    while (parts.length > 1 && STOP.has(parts[0]!.toLowerCase())) parts.shift();
    clean = parts.join(' ');
    if (!clean || clean.length < 2 || clean.length > 32) return;
    const at = sentence.start + ((index + raw.length / 2) / Math.max(1, text.length)) * span;
    if (clean.toLowerCase().split(/\s+/).every(t => STOP.has(t))) return; // a keyword is never made only of function words
    if (!found.some(f => f.text.toLowerCase() === clean.toLowerCase())) found.push({at: Math.round(at * 1000) / 1000, text: clean, score});
  };
  for (const m of text.matchAll(/\$?\d[\d,.]*\s?(?:%|percent|million|billion|thousand|k|m)?/gi)) push(m.index!, m[0].trim(), 3);
  for (const m of text.matchAll(/\b[A-Z]{2,}\b/g)) push(m.index!, m[0], 3);
  for (const m of text.matchAll(/["“]([^"”]{2,28})["”]/g)) push(m.index! + 1, m[1]!, 3);
  for (const m of text.matchAll(/\b(?:called|known as|termed|means?|stands for)\s+(?:the\s+)?([\p{L}][\p{L}'-]*(?:\s[\p{L}][\p{L}'-]*)?)/giu)) push(m.index! + m[0].length - m[1]!.length, m[1]!, 3);
  for (const m of text.matchAll(/(?<=[a-z,;]\s)([A-Z][a-z]{2,})\b/g)) push(m.index!, m[1]!, 2);
  if (found.length === 0) {
    let best: {i: number; w: string} | undefined;
    for (const m of text.matchAll(/[\p{L}][\p{L}'-]{6,}/gu)) {
      if (STOP.has(m[0].toLowerCase())) continue;
      if (!best || m[0].length > best.w.length) best = {i: m.index!, w: m[0]};
    }
    if (best) push(best.i, best.w, 1);
  }
  return found.sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 3).sort((a, b) => a.at - b.at);
}

/** The spoken verdict word of a confirmation sentence ("yes", "exactly", "confirmed" ...), as spoken, with an estimated time; undefined when there is none. */
export function verdictKeyword(sentence: {start: number; end: number; text: string}): KeywordHit | undefined {
  const m = VERDICT_WORD.exec(sentence.text);
  if (!m) return undefined;
  const at = sentence.start + ((m.index + m[0].length / 2) / Math.max(1, sentence.text.length)) * Math.max(0.001, sentence.end - sentence.start);
  return {at: Math.round(at * 1000) / 1000, text: m[0], score: 3};
}

/** Cap keyword hits at one per `minGapSec` (default 1 s): time order, the first hit in a window wins. Pure; the input is not mutated. */
export function throttleKeywordHits<T extends {at: number}>(hits: readonly T[], minGapSec = 1): T[] {
  const out: T[] = [];
  for (const hit of [...hits].sort((a, b) => a.at - b.at)) {
    const last = out[out.length - 1];
    if (!last || hit.at - last.at >= minGapSec - 1e-9) out.push(hit);
  }
  return out;
}

/** Lowercased content tokens (stop words dropped) for the topic-overlap test. */
export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(token => token.length >= 4 && !STOP.has(token));
}

const TOPIC_MARKER = /^\s*(so|now|next|anyway|okay|alright|but|however|meanwhile|moving on|another|then|let'?s|here'?s|the (?:second|third|next|last)|finally)\b/i;
/** Whether a sentence opens with a topic-shift marker. */
export const startsWithTopicMarker = (text: string): boolean => TOPIC_MARKER.test(text);

/** Jaccard overlap of the content tokens of two texts (0 when either is empty). */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(contentTokens(a));
  const tb = new Set(contentTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/** The first content word (>= 3 letters, not a function word) among the first 8 words of a sentence, EXACTLY as spoken; undefined when there is none. Used so a stage opens on a word spoken near its start. */
export function firstContentWord(text: string): string | undefined {
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return tokens.slice(0, 8).find(t => t.length >= 3 && !STOP.has(t.toLowerCase()));
}
