/**
 * MATCH CUT as a kinetic treatment (`type.matchCut`). The look is NOT redefined here: the compositor mounts the existing TypeTextMatchCut (remotion/src/motion/compositions/templates/TextMatchCut.tsx) with the grammar of
 * remotion/src/lib/textMatchCut.ts. This file decides WHEN a match cut is deserved, and that is a narrative judgment, not a keyword match.
 *
 * WHEN (V1 visual-quality correction): ONLY at one of four high-leverage narrative moments (see MatchCutMoment). None of these is enough on its own: a first mention of a keyword, a statistic, a strong
 * word, "the planner wants variety" or "a timestamp is free". If no moment genuinely applies there is NO match cut.
 *   openingHook         the video's central TOPIC is being INTRODUCED: 2.5-10 s in, in one of the first two sentences, by an explicit introducing construct ("this video is about", "today we're talking about", "here's how", "the problem with", a question)
 *                       whose object is the keyword, and the keyword is the video's recurring topic. A topic merely MENTIONED inside a sentence is not introduced.
 *   chapterTransition   a previous thought has concluded (a pause of >= 0.35 s after a >= 5-word sentence) and a section marker ("now", "next", "let's talk about", "step two") introduces a genuinely NEW topic: a keyword not said before
 *   evidenceMontage     one sentence carries BOTH a consensus / scale term ("everyone", "millions", "went viral") AND an impact term ("talking", "spike", "massive"), in >= 8 spoken words: grounded in the speaker's own words
 *   beforeReveal        a setup sentence ("here's the thing", "the secret is", "turns out") with a reveal sentence after it: the cut ends before the reveal starts, so the reveal lands on a quiet frame
 *
 * HOW MANY: short form (<= 90 s): at most ONE per video. Long form: at most one per 75 s, never closer than 60 s. Enforced here (planner AND the validation of a Director's events) and in the solver guardrails.
 * KEYWORD: ONE spoken word, 4-12 letters, a content word; the surrounding phrase has >= 5 spoken words. Everything shown is a contiguous slice of the transcript: nothing is invented.
 */
import {
  MATCH_CONTEXT_AFTER, MATCH_CONTEXT_BEFORE, MATCH_CUT_KEYWORD_MAX, MATCH_CUT_KEYWORD_MIN, buildMatchCut, matchCutVariantOf, matchKeywordOk,
} from '../broll/kineticTypeStory.ts';
import type {MotionTemplateWord} from '../broll/motionTemplateCatalog.ts';
import type {KineticPlan, KineticShot, KineticWord, MatchCutProps, RenderEvent, TextEvent} from './schema.ts';
import {normToken} from './transcript.ts';
import {FUNCTION_WORDS} from './words.ts';

export {MATCH_CUT_KEYWORD_MAX, MATCH_CUT_KEYWORD_MIN};
/** never closer than this (the solver re-checks it against the real fps) */
export const MATCH_CUT_GAP_SEC = 60;
/** short form is at most this long; it gets ONE match cut at most. Longer: one per MATCH_CUT_LONG_FORM_SPACING_SEC at most. */
export const MATCH_CUT_SHORT_FORM_MAX_SEC = 90;
export const MATCH_CUT_LONG_FORM_SPACING_SEC = 75;
/** the match cut owns the frame this long: 1-2.5 s is the target; 1.3 s = the 1.0 s shutter burst (cuts at 0..1.0 s) plus a 0.3 s decelerating crisp landing, then it ends decisively */
export const MATCH_CUT_SEC = 1.3;
export const MATCH_CUT_MIN_SEC = 1.2;
export const MATCH_CUT_MIN_PHRASE_WORDS = 5;
/** frames before the keyword is spoken at which the cut lands */
const LEAD_FRAMES = 2;
const MAX_SENTENCE_WORDS = 16;
const SENTENCE_GAP_SEC = 0.5;

const bareText = (t: string) => t.replace(/^[\s,;:.\-–—"'(]+|[\s,;:.!?"')]+$/g, '').trim();
const toMotionWords = (ws: readonly KineticWord[], fps: number): MotionTemplateWord[] => ws.map(w => ({text: w.text, start: w.startFrame / fps, end: w.endFrame / fps}));
const shotOf = (shots: readonly KineticShot[], frame: number): KineticShot | undefined => shots.find(s => frame >= s.startFrame && frame < s.endFrame) ?? shots[shots.length - 1];

/** Keyword legality: one spoken word, 4-12 letters, content word (the broll rule) and not one of the kinetic function words. */
export const isLegalMatchKeyword = (word: string): boolean => matchKeywordOk(bareText(word)) && !FUNCTION_WORDS.has(normToken(word));

// ---------------------------------------------------------------------------------------------------------------- the four legal moments

/**
 * A match cut is legal ONLY in one of four moments (never "whenever a concept is named"):
 *   openingHook  the lockup covers the first ~1 s of the file and the pinned word is the topic of the open
 *   statistic    a number, a percent, or a "secret / database / proof" claim
 *   pivot        an explicit narrative turn ("but here's", "the problem" -> "the solution", a sentence-initial "now")
 *   coreKeyword  the FIRST utterance of the single core keyword of the whole video (one content word, 4-12 letters, said >= 3 times, the clear top)
 * At most one match cut per plan. "that was an example of a hook" is none of these.
 */
export type MatchCutMoment = 'openingHook' | 'chapterTransition' | 'evidenceMontage' | 'beforeReveal';
/** short-form cap, kept as an export for callers that only know the short-form rule */
export const MATCH_CUT_MAX_PER_PLAN = 1;
/** How many match cuts a video of `durationSec` may carry. Never a target: zero is the right answer when no moment applies. */
export const matchCutBudget = (durationSec: number): number => (durationSec <= MATCH_CUT_SHORT_FORM_MAX_SEC ? 1 : Math.max(1, Math.floor(durationSec / MATCH_CUT_LONG_FORM_SPACING_SEC)));
const durationOfWords = (words: readonly KineticWord[], fps: number): number => (words.length ? words[words.length - 1]!.endFrame / fps : 0);

const OPEN_MIN_SEC = 2.5;
const OPEN_MAX_SEC = 10;
const CHAPTER_PAUSE_SEC = 0.35;
const CHAPTER_MIN_PREV_WORDS = 5;
const EVIDENCE_MIN_WORDS = 8;
const SECTION_RE = /^(?:(?:ok(?:ay)?|alright|so|and|but)[,\s]+)*(?:(?:now[,\s]+)?(?:let'?s (?:talk about|look at|move on to|dive into|get into|break down)|the next (?:step|thing|part|section|big \w+)|step (?:one|two|three|four|five|\d+)|part (?:one|two|three|\d+)|number (?:one|two|three|four|five|\d+))|now|next|moving on|chapter)\b/i;
const CONSENSUS_RE = /\b(everyone|everybody|millions?|thousands?|hundreds of|so many (?:people|creators|viewers|users)|all over|the whole (?:internet|world)|went viral|blew up|exploded)\b/i;
const IMPACT_RE = /\b(talking|talked|posting|posted|sharing|shared|searching|searched|spike|spiked|surge|surged|massive|huge|doubled|tripled|skyrocket\w*|jumped|growth|trending)\b/i;
/** An explicit INTRODUCING construct: the speaker announces the topic, a how-to, a problem or a mystery. Merely mentioning a word in passing ("...by using a school alone") is none of these. */
const INTRO_FRAME_RE = /\b(?:this (?:video|episode|lesson|channel) is (?:all )?about|(?:today|in this video)[,\s]+(?:we|i)(?:'re| are| am|'m)?\s*(?:going to )?(?:talk(?:ing)?|show(?:ing)?|look(?:ing)?|diving|cover(?:ing)?|break(?:ing)?)|i(?:'m| am) going to (?:show|teach|explain|tell|walk)|let me (?:show|tell|explain|walk)|let'?s (?:talk about|look at|dive into|break down)|here'?s (?:how|why|what)|how to|why (?:most|you|every|people|this|your|nobody)|what (?:if|happens|nobody|most)|the (?:truth|secret|problem|mystery|biggest mistake|real reason)(?: about| with| of| behind)|stop (?:doing|using|making)|you(?:'re| are) (?:probably |actually )?(?:doing|making))\b/i;
const REVEAL_SETUP_RE = /(\bhere'?s (?:the|what)\b|\bthe (?:secret|truth|answer|catch|twist|real reason)(?: is| was)?\b|\bturns out\b|\bguess what\b|\bbut (?:then|here'?s)\b)/i;

/** Words that recur in any talk without being its subject. A topic is a subject, not a verb form, an adverb, a quantity or a filler. */
const GENERIC_TOPIC = new Set(['more', 'most', 'many', 'much', 'some', 'even', 'also', 'very', 'still', 'just', 'really', 'thing', 'things', 'stuff', 'going', 'make', 'made', 'making', 'using', 'getting', 'doing', 'having', 'being', 'looking', 'trying', 'coming', 'taking', 'giving', 'saying', 'thinking', 'wanting', 'needing', 'following', 'working', 'doing', 'want', 'wanted', 'need', 'needs', 'like', 'know', 'think', 'take', 'takes', 'come', 'comes', 'give', 'gives', 'look', 'looks', 'good', 'great', 'best', 'better', 'first', 'second', 'third', 'next', 'last', 'every', 'always', 'never', 'today', 'people', 'time', 'times', 'long', 'little', 'back', 'right', 'something', 'anything', 'everything', 'nothing', 'about', 'after', 'again', 'because', 'before', 'while', 'where', 'which', 'would', 'could', 'should', 'other', 'another', 'whole', 'same', 'such', 'only', 'ever', 'once']);
export const isTopicWord = (word: string): boolean => {
  const t = normToken(word);
  return isLegalMatchKeyword(word) && !GENERIC_TOPIC.has(t) && !/ly$/.test(t);
};
const isNumeric = (t: string): boolean => /\d/.test(t) || /%$/.test(t.trim());
const tokenOf = (w: KineticWord): string => normToken(w.text);
void isNumeric;

/** The one core keyword of the whole video and where it is first said (null when no content word clearly dominates). */
export function coreKeywordOf(words: readonly KineticWord[]): {token: string; firstIdx: number; count: number} | null {
  const counts = new Map<string, {n: number; first: number}>();
  for (const w of words) {
    if (!isLegalMatchKeyword(w.text)) continue;
    const t = tokenOf(w);
    const c = counts.get(t);
    if (c) c.n += 1; else counts.set(t, {n: 1, first: w.idx});
  }
  const ranked = [...counts.entries()].sort((x, y) => y[1].n - x[1].n || x[1].first - y[1].first);
  const top = ranked[0];
  if (!top || top[1].n < 3) return null;
  if (ranked[1] && ranked[1][1].n === top[1].n) return null;
  return {token: top[0], firstIdx: top[1].first, count: top[1].n};
}

export type MomentVerdict = {ok: true; moment: MatchCutMoment; reason: string} | {ok: false; reason: string};

const sentenceCache = new WeakMap<readonly KineticWord[], KineticWord[][]>();
const sentencesCached = (words: readonly KineticWord[], fps: number): KineticWord[][] => {
  let v = sentenceCache.get(words);
  if (!v) { v = sentencesOf(words, fps); sentenceCache.set(words, v); }
  return v;
};
const textOf = (ws: readonly KineticWord[]): string => ws.map(w => w.text).join(' ');

/**
 * Which narrative moment (if any) makes the keyword at `kwIdx` a deserved match cut. `words` is the WHOLE transcript (context is the point: the sentences around it, the pauses, what comes next).
 * `range` is the event's word range; the keyword must be inside it. Pure.
 */
export function matchCutMomentOf(kwIdx: number, range: [number, number], words: readonly KineticWord[], fps: number): MomentVerdict {
  const kw = words[kwIdx];
  if (!kw || !isLegalMatchKeyword(kw.text)) return {ok: false, reason: 'keyword is not a 4-12 letter content word'};
  if (kwIdx < range[0] || kwIdx > range[1]) return {ok: false, reason: 'keyword outside the event range'};
  const sents = sentencesCached(words, fps);
  const si = sents.findIndex(sent => sent.some(w => w.idx === kwIdx));
  if (si < 0) return {ok: false, reason: 'keyword not inside a sentence'};
  const sent = sents[si]!;
  const prev = sents[si - 1];
  const next = sents[si + 1];
  const t = kw.startFrame / fps;
  const sentText = textOf(sent);
  const gapBefore = prev ? (sent[0]!.startFrame - prev[prev.length - 1]!.endFrame) / fps : 99;

  // D. before a major reveal: a setup sentence, with the reveal still to come (a reveal sentence follows)
  if (next && next.length >= 4 && REVEAL_SETUP_RE.test(sentText)) return {ok: true, moment: 'beforeReveal', reason: `setup "${REVEAL_SETUP_RE.exec(sentText)![0].trim()}" with a reveal to follow`};

  // B. chapter / topic transition: a concluded thought, a pause, a section marker, and the keyword is the next section's first content word
  if (prev && prev.length >= CHAPTER_MIN_PREV_WORDS && gapBefore >= CHAPTER_PAUSE_SEC && t > OPEN_MAX_SEC) {
    const head = textOf(sent.slice(0, 9));
    const m = SECTION_RE.exec(head);
    if (m) {
      const markerWords = m[0].trim().split(/\s+/).length;
      const firstContent = sent.slice(markerWords, markerWords + 6).find(w => isLegalMatchKeyword(w.text));
      const isNewTopic = words.findIndex(w => tokenOf(w) === tokenOf(kw)) === kwIdx; // a genuinely new topic: the keyword has not been said before
      if (firstContent && firstContent.idx === kwIdx && isNewTopic) return {ok: true, moment: 'chapterTransition', reason: `new section "${m[0].trim()}" after a ${gapBefore.toFixed(2)} s pause`};
    }
  }

  // C. evidence montage: consensus / scale AND impact in one sentence of enough spoken words (the speaker's own words are the evidence shown)
  if (sent.length >= EVIDENCE_MIN_WORDS && CONSENSUS_RE.test(sentText) && IMPACT_RE.test(sentText)) {
    const cue = IMPACT_RE.exec(sentText)![0].toLowerCase();
    const cueWord = sent.find(z => normToken(z.text) === cue) ?? sent[0]!;
    // the keyword of the montage is the content word closest to the impact term
    const near = sent.filter(w => isLegalMatchKeyword(w.text)).sort((x, y) => Math.abs(x.idx - cueWord.idx) - Math.abs(y.idx - cueWord.idx))[0];
    if (near && near.idx === kwIdx) return {ok: true, moment: 'evidenceMontage', reason: `consensus + impact: "${CONSENSUS_RE.exec(sentText)![0]}" / "${cue}"`};
  }

  // A. opening hook: the video's recurring topic is INTRODUCED (an explicit introducing construct or a question whose object is the keyword), 2.5-10 s in, inside the first two sentences
  if (si <= 1 && t >= OPEN_MIN_SEC && t <= OPEN_MAX_SEC) {
    const recurs = words.filter(w => tokenOf(w) === tokenOf(kw)).length >= 2;
    const first = words.findIndex(w => tokenOf(w) === tokenOf(kw)) === kwIdx;
    const pos = sent.findIndex(w => w.idx === kwIdx);
    const m = INTRO_FRAME_RE.exec(sentText);
    const isQuestion = /\?$/.test(sentText.trim());
    let introduced = isQuestion;
    if (m) {
      const startTok = sentText.slice(0, m.index).trim().split(/\s+/).filter(Boolean).length;
      const endTok = startTok + m[0].trim().split(/\s+/).length;
      introduced = pos >= startTok && pos < endTok + 6; // the keyword is the object of the introducing construct
    }
    // the topic is what the video keeps coming back to (recurrence), not what scores highest inside one sentence (sentence-final words always do)
    if (introduced && recurs && first && isTopicWord(kw.text)) return {ok: true, moment: 'openingHook', reason: `the video's topic "${kw.text}" is introduced at ${t.toFixed(1)} s (${m ? `"${m[0].trim()}"` : 'a question'}) and said again later`};
  }
  return {ok: false, reason: 'no opening hook, chapter transition, evidence montage or pre-reveal build-up here: no match cut'};
}

// ---------------------------------------------------------------------------------------------------------------- plan side

type Found = {eventWords: [number, number]; keywordIdx: number; swapIdx?: number; props: MatchCutProps; score: number; reason: string; moment: MatchCutMoment};
const MOMENT_SCORE: Record<MatchCutMoment, number> = {openingHook: 0.92, chapterTransition: 0.9, beforeReveal: 0.88, evidenceMontage: 0.86};

/** Sentences of a transcript: ends at . ! ? , a pause, or MAX_SENTENCE_WORDS. */
function sentencesOf(words: readonly KineticWord[], fps: number): KineticWord[][] {
  const out: KineticWord[][] = [];
  let cur: KineticWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const ends = /[.!?]$/.test(w.text) || !next || (next.startFrame - w.endFrame) / fps > SENTENCE_GAP_SEC || cur.length >= MAX_SENTENCE_WORDS;
    if (ends) { out.push(cur); cur = []; }
  });
  return out;
}

/** Every match cut the transcript supports (one best keyword per sentence and moment; before the one-per-plan cap). Pure. */
export function matchCutCandidates(words: readonly KineticWord[], fps: number): Found[] {
  const found: Found[] = [];
  for (const sent of sentencesOf(words, fps)) {
    if (sent.length < MATCH_CUT_MIN_PHRASE_WORDS) continue;
    const mw = toMotionWords(sent, fps);
    const seed = Math.floor(sent[0]!.startFrame / fps);
    // every legal keyword of the sentence, judged by the four moments; the best-scoring one wins
    let best: {si: number; moment: MatchCutMoment; reason: string; score: number} | null = null;
    sent.forEach((w, si) => {
      if (!isLegalMatchKeyword(w.text)) return;
      const hi = Math.min(sent.length - 1, si + MATCH_CONTEXT_AFTER), lo = Math.max(0, si - MATCH_CONTEXT_BEFORE);
      const v = matchCutMomentOf(w.idx, [sent[lo]!.idx, sent[hi]!.idx], words, fps);
      if (!v.ok) return;
      // an opening-hook topic that recurs more often is the better topic; ties go to the earlier mention (recurrence, then position, then emphasis)
      const recur = v.moment === 'openingHook' ? Math.min(6, words.filter(x => tokenOf(x) === tokenOf(w)).length) * 0.02 - (w.startFrame / fps) * 0.0005 : 0;
      const score = MOMENT_SCORE[v.moment] + recur + w.emphasisScore * (v.moment === 'openingHook' ? 0.0001 : 0.01);
      if (!best || score > best.score) best = {si, moment: v.moment, reason: v.reason, score};
    });
    if (!best) continue;
    const pick = best as {si: number; moment: MatchCutMoment; reason: string; score: number};
    const swap: number | undefined = undefined;
    const cand = buildMatchCut(mw, pick.si, swap, pick.reason, pick.score, seed);
    if (!cand) continue;
    const hiK = Math.max(pick.si, swap ?? pick.si);
    const from = Math.max(0, pick.si - MATCH_CONTEXT_BEFORE);
    const to = Math.min(sent.length, hiK + 1 + MATCH_CONTEXT_AFTER) - 1;
    const h = cand.hint as {keyword: string; swapKeyword?: string; phrase: string; before?: string; after?: string; variant: MatchCutProps['variant']};
    found.push({
      eventWords: [sent[from]!.idx, sent[to]!.idx],
      keywordIdx: sent[pick.si]!.idx,
      ...(swap !== undefined ? {swapIdx: sent[swap]!.idx} : {}),
      props: {keyword: h.keyword, ...(h.swapKeyword ? {swapKeyword: h.swapKeyword} : {}), phrase: h.phrase, ...(h.before ? {before: h.before} : {}), ...(h.after ? {after: h.after} : {}), variant: h.variant},
      score: cand.score,
      reason: cand.reason,
      moment: pick.moment,
    });
  }
  return found;
}

/**
 * The match-cut events of a deterministic plan: only deserved moments (see MatchCutMoment), best first, within the frequency budget (short form: one; long form: one per 75 s, never closer than 60 s),
 * each inside one shot with room for the window. Zero is a normal answer.
 */
export function planMatchCuts(words: readonly KineticWord[], shots: readonly KineticShot[], fps = 30): TextEvent[] {
  const budget = matchCutBudget(durationOfWords(words, fps));
  const ranked = matchCutCandidates(words, fps).sort((a, b) => b.score - a.score || a.keywordIdx - b.keywordIdx);
  const out: TextEvent[] = [];
  const starts: number[] = [];
  for (const c of ranked) {
    if (out.length >= budget) break;
    const kw = words[c.keywordIdx]!;
    const at = Math.max(0, kw.startFrame - LEAD_FRAMES);
    if (starts.some(o => Math.abs(o - at) < MATCH_CUT_GAP_SEC * fps)) continue;
    const shot = shotOf(shots, kw.startFrame);
    if (!shot || shot.endFrame - at < Math.round(MATCH_CUT_MIN_SEC * fps)) continue;
    const intent: NonNullable<TextEvent['matchCut']> = {keyword: c.props.keyword, ...(c.props.swapKeyword ? {swapKeyword: c.props.swapKeyword} : {}), variant: c.props.variant};
    out.push({id: `mc-${c.keywordIdx}`, shotId: shot.id, wordRange: c.eventWords, lines: [{text: c.props.keyword, role: 'hero'}], preset: 'type.matchCut', layering: 'front', anchor: 'screen', regionHint: 'auto', matchCut: intent});
    starts.push(at);
  }
  return out;
}

/** Frame window a match cut owns: lands 2 frames before the keyword is spoken, 1.8 s long, clipped to its shot. */
export function matchCutWindow(ev: TextEvent, words: readonly KineticWord[], shot: KineticShot | undefined, fps: number): {inFrame: number; outFrame: number} | null {
  const kw = locateKeyword(ev, words);
  if (!kw) return null;
  const inFrame = Math.max(shot && !ev.persistAcrossCut ? shot.startFrame : 0, kw.word.startFrame - LEAD_FRAMES);
  let outFrame = inFrame + Math.round(MATCH_CUT_SEC * fps);
  if (shot && !ev.persistAcrossCut) outFrame = Math.min(outFrame, shot.endFrame);
  // before a reveal the card must end BEFORE the reveal starts, so the reveal lands on a quiet frame (never over it)
  const verdict = matchCutMomentOf(kw.idx, ev.wordRange, words, fps);
  if (verdict.ok && verdict.moment === 'beforeReveal') {
    const sents = sentencesCached(words, fps);
    const si = sents.findIndex(sn => sn.some(w => w.idx === kw.idx));
    const reveal = sents[si + 1];
    if (reveal) outFrame = Math.min(outFrame, Math.max(inFrame + 1, reveal[0]!.startFrame));
  }
  return {inFrame, outFrame};
}

function locateKeyword(ev: TextEvent, words: readonly KineticWord[]): {word: KineticWord; idx: number; swapIdx?: number} | null {
  if (!ev.matchCut) return null;
  const [a, b] = ev.wordRange;
  const find = (token: string, from: number): number => {
    for (let k = from; k <= Math.min(b, words.length - 1); k += 1) if (normToken(words[k]!.text) === normToken(token)) return k;
    return -1;
  };
  const idx = find(ev.matchCut.keyword, a);
  if (idx < 0) return null;
  const swapIdx = ev.matchCut.swapKeyword ? find(ev.matchCut.swapKeyword, idx + 1) : undefined;
  return {word: words[idx]!, idx, ...(swapIdx !== undefined && swapIdx >= 0 ? {swapIdx} : {})};
}

/** Props for TypeTextMatchCut derived from the transcript slice of the event (null = not a legal match cut). */
export function deriveMatchCutProps(ev: TextEvent, words: readonly KineticWord[], fps: number): MatchCutProps | null {
  if (ev.preset !== 'type.matchCut' || !ev.matchCut) return null;
  const [a, b] = ev.wordRange;
  if (a > b || b >= words.length || b - a + 1 < MATCH_CUT_MIN_PHRASE_WORDS) return null;
  const hit = locateKeyword(ev, words);
  if (!hit || !isLegalMatchKeyword(hit.word.text)) return null;
  if (ev.matchCut.swapKeyword && (hit.swapIdx === undefined || !isLegalMatchKeyword(words[hit.swapIdx]!.text))) return null;
  const slice = words.slice(a, b + 1);
  const cand = buildMatchCut(toMotionWords(slice, fps), hit.idx - a, hit.swapIdx === undefined ? undefined : hit.swapIdx - a, 'plan', 1, Math.floor(words[a]!.startFrame / fps));
  if (!cand) return null;
  const h = cand.hint as {keyword: string; swapKeyword?: string; phrase: string; before?: string; after?: string; variant: MatchCutProps['variant']};
  return {keyword: h.keyword, ...(h.swapKeyword ? {swapKeyword: h.swapKeyword} : {}), phrase: h.phrase, ...(h.before ? {before: h.before} : {}), ...(h.after ? {after: h.after} : {}), variant: ev.matchCut.variant ?? h.variant ?? matchCutVariantOf(h.phrase)};
}

/** Structural problems of the match-cut events of a plan (the director path: any hit sends the plan to the fallback). */
export function matchCutViolations(plan: KineticPlan, words: readonly KineticWord[], fps = 30): string[] {
  const out: string[] = [];
  for (const ev of plan.events) {
    if (ev.preset === 'type.matchCut') {
      if (!ev.matchCut) out.push(`${ev.id}: type.matchCut without matchCut.keyword`);
      else if (ev.wordRange[1] >= words.length) out.push(`${ev.id}: wordRange outside transcript`);
      else if (!deriveMatchCutProps(ev, words, fps)) out.push(`${ev.id}: not a legal match cut (keyword 4-12 letters, content word, spoken inside >= ${MATCH_CUT_MIN_PHRASE_WORDS} words)`);
      else { const v = momentOfEvent(ev, words, fps); if (!v.ok) out.push(`${ev.id}: ${v.reason}`); }
    } else if (ev.matchCut) out.push(`${ev.id}: matchCut field on a ${ev.preset} event`);
  }
  const budget = matchCutBudget(durationOfWords(words, fps));
  if (plan.events.filter(e => e.preset === 'type.matchCut').length > budget) out.push(`more than ${budget} match cut(s) for a ${Math.round(durationOfWords(words, fps))} s video`);
  return out;
}

/** The moment verdict of a type.matchCut event (keyword located inside its word range). */
export function momentOfEvent(ev: TextEvent, words: readonly KineticWord[], fps: number): MomentVerdict {
  const hit = locateKeyword(ev, words);
  if (!hit) return {ok: false, reason: 'keyword not in the transcript range'};
  return matchCutMomentOf(hit.idx, ev.wordRange, words, fps);
}

/** A director plan keeps going without an illegal / surplus match cut: those events are dropped (with the reason) instead of sending the whole plan to the fallback. */
export function sanitizeMatchCuts(plan: KineticPlan, words: readonly KineticWord[], fps: number): {plan: KineticPlan; dropped: Array<{eventId: string; reason: string}>} {
  const dropped: Array<{eventId: string; reason: string}> = [];
  let kept = 0;
  const budget = matchCutBudget(durationOfWords(words, fps));
  const keptStarts: number[] = [];
  const events = plan.events.filter(ev => {
    if (ev.preset !== 'type.matchCut') return true;
    const v = ev.matchCut && ev.wordRange[1] < words.length && deriveMatchCutProps(ev, words, fps) ? momentOfEvent(ev, words, fps) : ({ok: false, reason: 'not a legal match cut'} as MomentVerdict);
    if (!v.ok) { dropped.push({eventId: ev.id, reason: `match cut dropped: ${v.reason}`}); return false; }
    if (kept >= budget) { dropped.push({eventId: ev.id, reason: `match cut dropped: at most ${budget} for this video length`}); return false; }
    const at = words[ev.wordRange[0]]!.startFrame;
    if (keptStarts.some(o => Math.abs(o - at) < MATCH_CUT_GAP_SEC * fps)) { dropped.push({eventId: ev.id, reason: `match cut dropped: closer than ${MATCH_CUT_GAP_SEC} s to another`}); return false; }
    keptStarts.push(at);
    kept += 1;
    return true;
  });
  return {plan: {...plan, events}, dropped};
}

// ---------------------------------------------------------------------------------------------------------------- solve side

/** The RenderEvent of a match cut: full frame, in FRONT of the plate and never behind the matte (it owns the frame). Hard cuts only: opacity 1 for the whole window. */
export function solveMatchCutEvent(a: {ev: TextEvent; words: readonly KineticWord[]; shot: KineticShot; fps: number; width: number; height: number; window: {inFrame: number; outFrame: number}; style: RenderEvent['style']}): RenderEvent | null {
  const props = deriveMatchCutProps(a.ev, a.words, a.fps);
  if (!props) return null;
  const {inFrame, outFrame} = a.window;
  const kf = (frame: number) => ({frame, x: a.width / 2, y: a.height / 2, scale: 1, opacity: 1, rotateX: 0, rotateY: 0, blurPx: 0, z: 0});
  return {
    id: a.ev.id,
    shotId: a.shot.id,
    preset: a.ev.preset,
    presetResolved: 'type.matchCut',
    inFrame, outFrame, fps: a.fps,
    layering: 'front',
    anchor: 'screen',
    material: 'flat',
    perspectivePx: Math.max(900, a.width * 1.4),
    block: {w: a.width, h: a.height},
    lines: [{
      text: props.keyword, role: 'hero', font: 'poppins', fontPx: Math.round(a.width * 0.09), italic: false, weight: 800, letterSpacingEm: 0, uppercase: false,
      dx: 0, dy: 0, w: a.width, h: a.height,
      fill: {kind: 'solid', colors: ['#FFFFFF'], angleDeg: 90},
      revealFrames: [], swapWords: [], swapFrames: [], wordFills: [],
      anim: 'E1', startFrame: 0, enterFrame: 0, color: '#FFFFFF', glow: null, textOpacity: 1, zPx: 0, exitFrame: null, wordKeyframes: [],
    }],
    keyframes: [kf(inFrame), kf(outFrame)],
    shadow: {color: 'rgba(0,0,0,0)', blurPx: 0, offsetY: 0, strokePx: 0, glowPx: 0},
    depthBlurPx: 0, tint: null,
    occlusionFraction: {mean: 0, max: 0},
    safeProof: {ok: true, sampledKeyframes: 2, minMarginPx: 0},
    wordRange: a.ev.wordRange,
    persistAcrossCut: Boolean(a.ev.persistAcrossCut),
    notes: ['match cut: full frame, hard cuts, in front of the plate'],
    style: a.style, zone: null, exit: 'X1',
    hold: {push: [1, 1], rotY: 0, rotX: 0, periodSec: 5},
    flash: null,
    matchCut: props,
  };
}

export type AcceptedMatchCut = {ev: TextEvent; window: {inFrame: number; outFrame: number}; shot: KineticShot};

/** Which match-cut events of a plan survive (legal, inside a shot, >= 20 s apart: earlier wins), plus the reasons for the rest. */
export function acceptMatchCuts(events: readonly TextEvent[], words: readonly KineticWord[], shots: readonly KineticShot[], fps: number): {accepted: AcceptedMatchCut[]; dropped: Array<{eventId: string; reason: string}>} {
  const accepted: AcceptedMatchCut[] = [];
  const dropped: Array<{eventId: string; reason: string}> = [];
  const mc = events.filter(e => e.preset === 'type.matchCut' && e.wordRange[0] <= e.wordRange[1] && e.wordRange[1] < words.length).sort((a, b) => words[a.wordRange[0]]!.startFrame - words[b.wordRange[0]]!.startFrame);
  for (const ev of mc) {
    const shot = shots.find(s => s.id === ev.shotId) ?? shotOf(shots, words[ev.wordRange[0]]!.startFrame);
    const window = shot ? matchCutWindow(ev, words, shot, fps) : null;
    if (!shot || !window) { dropped.push({eventId: ev.id, reason: 'match cut: keyword not in the transcript range'}); continue; }
    if (!deriveMatchCutProps(ev, words, fps)) { dropped.push({eventId: ev.id, reason: 'match cut: not legal (keyword / >= 5 spoken words)'}); continue; }
    const verdict = momentOfEvent(ev, words, fps);
    if (!verdict.ok) { dropped.push({eventId: ev.id, reason: `match cut: ${verdict.reason}`}); continue; }
    if (accepted.length >= matchCutBudget(Math.max(durationOfWords(words, fps), ...shots.map(sh => sh.endFrame / fps)))) { dropped.push({eventId: ev.id, reason: 'match cut: over the frequency budget for this video length'}); continue; }
    if (window.outFrame - window.inFrame < Math.round(MATCH_CUT_MIN_SEC * fps)) { dropped.push({eventId: ev.id, reason: 'match cut: less than 1.6 s left in the shot'}); continue; }
    if (accepted.some(o => Math.abs(o.window.inFrame - window.inFrame) < MATCH_CUT_GAP_SEC * fps)) { dropped.push({eventId: ev.id, reason: `match cut: closer than ${MATCH_CUT_GAP_SEC} s to another`}); continue; }
    accepted.push({ev, window, shot});
  }
  return {accepted, dropped};
}
