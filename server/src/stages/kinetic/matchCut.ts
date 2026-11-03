/**
 * MATCH CUT as a kinetic treatment (`type.matchCut`). The look is NOT redefined here: the compositor mounts the existing TypeTextMatchCut (remotion/src/motion/compositions/templates/TextMatchCut.tsx) with the grammar of
 * remotion/src/lib/textMatchCut.ts. The SUITABILITY rules are the ones already written in stages/broll/kineticTypeStory.ts (`buildMatchCut`, `matchCutVariantOf`, naming regex, from-X-to-Y swap): imported, not copied
 * (kineticTypeStory only pulls the pure sceneSpec helper, so the kinetic tests stay light).
 *
 *   when      ONLY in one of four moments (see MatchCutMoment): the opening hook, a shocking statistic / claim, a major narrative pivot, the first utterance of the video's single core keyword.
 *             Naming a concept ("what is X", "called", "means") is NOT a trigger any more; at most ONE match cut per plan.
 *   keyword   ONE spoken word, 4-12 letters, a content word (never a function word); the surrounding phrase has >= 5 spoken words and is the only other glyph on screen
 *   cap       one per plan; it owns the frame ~1.8 s; no type.words block overlaps it
 *   never     invent a keyword: everything shown is a contiguous slice of the transcript
 */
import {
  MATCH_CONTEXT_AFTER, MATCH_CONTEXT_BEFORE, MATCH_CUT_KEYWORD_MAX, MATCH_CUT_KEYWORD_MIN, buildMatchCut, matchCutVariantOf, matchKeywordOk,
} from '../broll/kineticTypeStory.ts';
import type {MotionTemplateWord} from '../broll/motionTemplateCatalog.ts';
import type {KineticPlan, KineticShot, KineticWord, MatchCutProps, RenderEvent, TextEvent} from './schema.ts';
import {normToken} from './transcript.ts';
import {FUNCTION_WORDS} from './words.ts';

export {MATCH_CUT_KEYWORD_MAX, MATCH_CUT_KEYWORD_MIN};
/** one match cut per this many seconds (the solver re-checks it against the real fps) */
export const MATCH_CUT_GAP_SEC = 20;
/** the match cut owns the frame this long (the catalog says 1.6 s; the allowed band is 1.6-2.0 s) */
export const MATCH_CUT_SEC = 1.8;
export const MATCH_CUT_MIN_SEC = 1.6;
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
export type MatchCutMoment = 'openingHook' | 'statistic' | 'pivot' | 'coreKeyword';
export const MATCH_CUT_MAX_PER_PLAN = 1;
const NUMBER_WORDS = new Set(['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'million', 'billion', 'percent', 'dozens']);
const CLAIM_WORDS = new Set(['secret', 'secrets', 'database', 'databases', 'proof', 'proven', 'statistic', 'statistics']);
const PIVOT_RE = /(\bbut here'?s\b|\bhere'?s the (?:thing|catch|truth|problem|secret)\b|\bthe problem(?: is)?\b|\bthe solution\b|^(?:so |but |and )?now[,\s])/i;
const CORE_MIN_COUNT = 3;

const isNumeric = (t: string): boolean => /\d/.test(t) || /%$/.test(t.trim());
const tokenOf = (w: KineticWord): string => normToken(w.text);

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
  if (!top || top[1].n < CORE_MIN_COUNT) return null;
  if (ranked[1] && ranked[1][1].n === top[1].n) return null;
  return {token: top[0], firstIdx: top[1].first, count: top[1].n};
}

/** Index range of the first sentence of the transcript. */
function firstSentenceEnd(words: readonly KineticWord[], fps: number): number {
  const sents = sentencesOf(words, fps);
  return sents.length ? sents[0]![sents[0]!.length - 1]!.idx : -1;
}

export type MomentVerdict = {ok: true; moment: MatchCutMoment; reason: string} | {ok: false; reason: string};

/** Which of the four moments (if any) makes the keyword at `kwIdx` a legal match cut. `words` is the WHOLE transcript. */
export function matchCutMomentOf(kwIdx: number, range: [number, number], words: readonly KineticWord[], fps: number): MomentVerdict {
  const kw = words[kwIdx];
  if (!kw || !isLegalMatchKeyword(kw.text)) return {ok: false, reason: 'keyword is not a 4-12 letter content word'};
  const [a, b] = range;
  const slice = words.slice(a, b + 1);
  const text = slice.map(w => w.text).join(' ');

  // 2. shocking statistic / fact: the keyword is the number / claim word itself or the content word within three words after a number ("90% of creators")
  for (let i = a; i <= b; i += 1) {
    const w = words[i]!;
    const t = tokenOf(w);
    const statWord = isNumeric(w.text) || NUMBER_WORDS.has(t) || CLAIM_WORDS.has(t);
    const counted = isNumeric(w.text) || NUMBER_WORDS.has(t);
    if (statWord && (kwIdx === i || (counted && kwIdx > i && kwIdx <= i + 3))) return {ok: true, moment: 'statistic', reason: `statistic / claim "${w.text}"`};
  }
  // 3. major narrative pivot: the keyword sits right after an explicit turn
  const m = PIVOT_RE.exec(text);
  if (m) {
    let offset = 0;
    let kwStart = -1;
    slice.forEach((w, i) => { const at = text.indexOf(w.text, offset); offset = at >= 0 ? at + w.text.length : offset; if (a + i === kwIdx) kwStart = at; });
    if (kwStart >= m.index && kwStart <= m.index + m[0].length + 36) return {ok: true, moment: 'pivot', reason: `pivot "${m[0].trim()}"`};
  }
  // 1. opening hook: the lockup covers the first ~1 s and the pinned word is the topic (strongest content word) of the first sentence
  const firstEnd = firstSentenceEnd(words, fps);
  if (words[0] && words[0].startFrame <= Math.round(0.5 * fps) && kw.startFrame - LEAD_FRAMES <= Math.round(1.0 * fps) && kwIdx <= firstEnd) {
    const cands = words.slice(0, firstEnd + 1).filter(w => isLegalMatchKeyword(w.text));
    const top = Math.max(...cands.map(w => w.emphasisScore));
    if (kw.emphasisScore >= top - 1e-9) return {ok: true, moment: 'openingHook', reason: 'opening hook'};
  }
  // 4. first utterance of the single core keyword
  const core = coreKeywordOf(words);
  if (core && tokenOf(kw) === core.token && kwIdx === core.firstIdx) return {ok: true, moment: 'coreKeyword', reason: `first utterance of the core keyword "${core.token}"`};
  return {ok: false, reason: 'not an opening hook, a statistic / claim, a narrative pivot or the first utterance of the core keyword'};
}

// ---------------------------------------------------------------------------------------------------------------- plan side

type Found = {eventWords: [number, number]; keywordIdx: number; swapIdx?: number; props: MatchCutProps; score: number; reason: string; moment: MatchCutMoment};
const MOMENT_SCORE: Record<MatchCutMoment, number> = {statistic: 0.92, pivot: 0.9, openingHook: 0.88, coreKeyword: 0.86};

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
      const score = MOMENT_SCORE[v.moment] + w.emphasisScore * 0.01;
      if (!best || score > best.score) best = {si, moment: v.moment, reason: v.reason, score};
    });
    if (!best) continue;
    const pick = best as {si: number; moment: MatchCutMoment; reason: string; score: number};
    // "the problem -> the solution": a swap pair inside one pivot sentence
    let swap: number | undefined;
    if (pick.moment === 'pivot' && normToken(sent[pick.si]!.text) === 'problem') {
      const sol = sent.findIndex((w, i) => i > pick.si && normToken(w.text) === 'solution');
      if (sol >= 0 && isLegalMatchKeyword(sent[sol]!.text)) swap = sol;
    }
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

/** The match-cut events of a deterministic plan: AT MOST ONE, only when one of the four legal moments is in the transcript (best first), inside one shot with >= 1.6 s of room. */
export function planMatchCuts(words: readonly KineticWord[], shots: readonly KineticShot[], fps = 30): TextEvent[] {
  const ranked = matchCutCandidates(words, fps).sort((a, b) => b.score - a.score || a.keywordIdx - b.keywordIdx);
  for (const c of ranked) {
    const kw = words[c.keywordIdx]!;
    const at = Math.max(0, kw.startFrame - LEAD_FRAMES);
    const shot = shotOf(shots, kw.startFrame);
    if (!shot || shot.endFrame - at < Math.round(MATCH_CUT_MIN_SEC * fps)) continue;
    const intent: NonNullable<TextEvent['matchCut']> = {keyword: c.props.keyword, ...(c.props.swapKeyword ? {swapKeyword: c.props.swapKeyword} : {}), variant: c.props.variant};
    return [{id: `mc-${c.keywordIdx}`, shotId: shot.id, wordRange: c.eventWords, lines: [{text: c.props.keyword, role: 'hero'}], preset: 'type.matchCut', layering: 'front', anchor: 'screen', regionHint: 'auto', matchCut: intent}];
  }
  return [];
}

/** Frame window a match cut owns: lands 2 frames before the keyword is spoken, 1.8 s long, clipped to its shot. */
export function matchCutWindow(ev: TextEvent, words: readonly KineticWord[], shot: KineticShot | undefined, fps: number): {inFrame: number; outFrame: number} | null {
  const kw = locateKeyword(ev, words);
  if (!kw) return null;
  const inFrame = Math.max(shot && !ev.persistAcrossCut ? shot.startFrame : 0, kw.word.startFrame - LEAD_FRAMES);
  let outFrame = inFrame + Math.round(MATCH_CUT_SEC * fps);
  if (shot && !ev.persistAcrossCut) outFrame = Math.min(outFrame, shot.endFrame);
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
  if (plan.events.filter(e => e.preset === 'type.matchCut').length > MATCH_CUT_MAX_PER_PLAN) out.push(`more than ${MATCH_CUT_MAX_PER_PLAN} match cut in the plan`);
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
  const events = plan.events.filter(ev => {
    if (ev.preset !== 'type.matchCut') return true;
    const v = ev.matchCut && ev.wordRange[1] < words.length && deriveMatchCutProps(ev, words, fps) ? momentOfEvent(ev, words, fps) : ({ok: false, reason: 'not a legal match cut'} as MomentVerdict);
    if (!v.ok) { dropped.push({eventId: ev.id, reason: `match cut dropped: ${v.reason}`}); return false; }
    if (kept >= MATCH_CUT_MAX_PER_PLAN) { dropped.push({eventId: ev.id, reason: 'match cut dropped: at most one per plan'}); return false; }
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
    if (accepted.length >= MATCH_CUT_MAX_PER_PLAN) { dropped.push({eventId: ev.id, reason: `match cut: more than ${MATCH_CUT_MAX_PER_PLAN} per plan`}); continue; }
    if (window.outFrame - window.inFrame < Math.round(MATCH_CUT_MIN_SEC * fps)) { dropped.push({eventId: ev.id, reason: 'match cut: less than 1.6 s left in the shot'}); continue; }
    if (accepted.some(o => Math.abs(o.window.inFrame - window.inFrame) < MATCH_CUT_GAP_SEC * fps)) { dropped.push({eventId: ev.id, reason: `match cut: more than one per ${MATCH_CUT_GAP_SEC} s`}); continue; }
    accepted.push({ev, window, shot});
  }
  return {accepted, dropped};
}
