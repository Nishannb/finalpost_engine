/**
 * WP35: the Metromedia IMPACT FX plan (editref.md / metromedia-grammar.yaml `effects`). PURE (no env, no I/O, no model, no randomness): spoken words + the WP33 cut plan in, timed events out. The renderer
 * (remotion `ImpactFxTrack` / `ImpactPunch`, lib/impactFx.ts) paints them; this module only decides WHERE.
 *
 *   flash_overexpose     1-2 frames: on the HOOK word (the first caption group) and on a MAJOR REVEAL (a headline hold, else the first money hold). Lands exactly on the cut frame so the flash hides the cut.
 *   saturation_glow_pop  2-4 frames (3): on a NAME REVEAL: the first capitalised word of a proper-name run that is not a sentence start ("... founder Alex Chen" -> "Alex").
 *   punch_in             scale 1.10 over 7 frames (grammar 6-8), held for the whole MONEY hold ("six billion dollars"), reset by the next cut.
 *   bw_grade             a black-and-white flip, ONLY with a stated narrative reason (a past reference, or a sustained serious passage of >= 2 emotional words): the whole sentence, <= 2 spans, <= 10 % of the runtime (see planBwSpansWithReasons); the original colour is the default
 *                        chapter card. Strong emotional words are taken before a bare year token.
 *
 * Spacing keeps it impact, not strobe: flashes >= 3 s apart (<= 1 per 6 s), sat pops >= 2.5 s apart (<= 1 per 7 s) and never within 0.4 s of a flash.
 * Applied only on polish with the WP33 plan (POLISH_IMPACT_FX, default on); non-polish profiles never call it. Idempotent (a pure function of its input).
 */
import type {VoCutPlan, VoWord} from '../stages/broll/voCutGrammar.ts';

export const IMPACT_FLASH_FRAMES = 2;
export const IMPACT_SAT_POP_FRAMES = 3;
export const IMPACT_PUNCH_RAMP_FRAMES = 7;
export const IMPACT_PUNCH_SCALE = 1.1;
export const IMPACT_FLASH_MIN_GAP_SEC = 3;
export const IMPACT_FLASH_PER_SEC = 6;
export const IMPACT_SAT_MIN_GAP_SEC = 2.5;
export const IMPACT_SAT_PER_SEC = 7;
export const IMPACT_SAT_FLASH_CLEARANCE_SEC = 0.4;

export type ImpactFlash = {startSec: number; frames: number; reason: 'hook_word' | 'major_reveal'};
export type ImpactSatPop = {startSec: number; frames: number};
export type ImpactPunchIn = {startSec: number; endSec: number; rampFrames: number; scale: number};
export type ImpactBwSpan = {startSec: number; endSec: number};
export type ImpactFxPlan = {flashes: ImpactFlash[]; satPops: ImpactSatPop[]; punchIns: ImpactPunchIn[]; bwSpans: ImpactBwSpan[]};
export type PolishImpactFxResult = {fx: ImpactFxPlan; warnings: string[]; stats: {flashes: number; satPops: number; punchIns: number; bwSpans: number; bwShare: number}};

const round = (value: number) => Math.round(value * 1000) / 1000;
const clean = (text: string) => text.replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%]+$/gu, '');
const norm = (text: string) => clean(text).toLowerCase();
const endsSentence = (text: string) => /[.!?\u2026]["')\u201d\u2019]*$/.test(text);

/** Words that mark an emotional / past beat (score 2). */
const EMOTIONAL: ReadonlySet<string> = new Set([
  'collapsed', 'collapse', 'fired', 'lost', 'failed', 'failure', 'bankrupt', 'lonely', 'cried', 'crying', 'died', 'death', 'divorce', 'divorced', 'homeless', 'rejected', 'betrayed',
  'destroyed', 'ruined', 'heartbroken', 'regret', 'regretted', 'grief', 'funeral', 'abandoned', 'shattered', 'humiliated',
]);
// NOT in the list on purpose: 'alone' ("using X alone" = "by itself"), 'cold', 'empty', 'quit', 'broke': they are ordinary words more often than emotional beats, and one of them used to grey a whole shot.
const YEAR = /^(1[5-9]\d\d|20\d\d)$/;
/** Capitalised words that are not names. */
const NOT_NAMES: ReadonlySet<string> = new Set([
  'i', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'god', 'ai',
]);

type Beat = {at: number; score: number};

/** First word of each proper-name run (a capitalised word, not a sentence start, not a month / weekday). */
export function nameRevealTimes(words: readonly VoWord[]): number[] {
  const times: number[] = [];
  let previousWasName = false;
  words.forEach((word, index) => {
    const token = clean(word.text);
    const sentenceStart = index === 0 || endsSentence(words[index - 1]!.text);
    const name = /^\p{Lu}[\p{Ll}'\u2019-]{2,}$/u.test(token) && !NOT_NAMES.has(token.toLowerCase()) && !sentenceStart;
    if (name && !previousWasName) times.push(round(word.start));
    previousWasName = name;
  });
  return times;
}

function emotionalBeats(words: readonly VoWord[]): Beat[] {
  const beats: Beat[] = [];
  words.forEach((word, index) => {
    const token = norm(word.text);
    if (EMOTIONAL.has(token)) beats.push({at: word.start, score: 2});
    else if (YEAR.test(token)) beats.push({at: word.start, score: 1});
    else if (token === 'ago' && /^(years?|decades?|months?)$/.test(norm(words[index - 1]?.text ?? ''))) beats.push({at: words[index - 1]!.start, score: 1});
  });
  return beats;
}

/** The share of `durationSec` covered by the (non-overlapping, sorted) spans. */
const shareOf = (spans: readonly ImpactBwSpan[], durationSec: number) => (durationSec > 0 ? round(spans.reduce((sum, span) => sum + (span.endSec - span.startSec), 0) / durationSec) : 0);

/** Monochrome is a deliberate decision, never a default or a lexical reflex (V1 visual-quality correction). */
export const IMPACT_BW_MIN_SPAN_SEC = 1.2;
/** the renderer grammar's ceiling (remotion/src/lib/impactFx.ts BW_SHARE_TARGET); this planner's own cap is stricter, IMPACT_BW_SHARE_MAX */
export const IMPACT_BW_SHARE_TARGET = 0.15;
export const IMPACT_BW_MAX_SPANS = 2;
export const IMPACT_BW_SHARE_MAX = 0.1;
export const IMPACT_BW_MIN_GAP_SEC = 12;
export const IMPACT_BW_EDGE_SEC = 3;
export type ImpactBwReason = {startSec: number; endSec: number; reason: string};
const PAST_RE = /\b(?:back in|used to|remember when|years? ago|decades? ago|in the (?:\d0s|nineties|eighties|seventies|sixties)|once upon|at the time)\b/i;

/**
 * Black-and-white spans, each with the reason that justifies it. A single emotional word is NOT a reason. Allowed only for:
 *   past_reference       a sentence that places the story in the past ("years ago", "back in", a year such as 1999)
 *   serious_passage      a sentence (or two neighbouring ones, <= 8 s) with at least TWO distinct strongly emotional words: a sustained serious / reflective stretch
 * The span is the WHOLE sentence (never a sliver or a single frame), >= 1.2 s, never in the first or last 3 s, at most 2 per video, <= 10 % of the runtime, >= 12 s apart, never over a money hold or a
 * chapter card. No qualifying sentence = the video keeps its original colour from first frame to last.
 */
export function planBwSpansWithReasons(words: readonly VoWord[], plan: Pick<VoCutPlan, 'shots' | 'holds' | 'chapterCards'>, durationSec: number): {spans: ImpactBwSpan[]; reasons: ImpactBwReason[]} {
  const blocked = [
    ...plan.holds.filter(hold => hold.reason === 'money').map(hold => ({start: hold.start, end: hold.end})),
    ...plan.chapterCards.map(card => ({start: card.at, end: round(card.at + card.duration)})),
  ];
  const free = (start: number, end: number) => !blocked.some(span => start < span.end - 1e-6 && end > span.start + 1e-6);
  const sentences: VoWord[][] = [];
  let cur: VoWord[] = [];
  for (const word of words) {
    cur.push(word);
    if (endsSentence(word.text)) { sentences.push(cur); cur = []; }
  }
  if (cur.length > 0) sentences.push(cur);
  const emotionalIn = (sent: readonly VoWord[]) => new Set(sent.map(w => norm(w.text)).filter(t => EMOTIONAL.has(t)));
  type Candidate = {start: number; end: number; reason: string; score: number};
  const candidates: Candidate[] = [];
  sentences.forEach((sent, i) => {
    const start = sent[0]!.start;
    const end = sent[sent.length - 1]!.end;
    const text = sent.map(w => w.text).join(' ');
    const past = PAST_RE.test(text) || sent.some(w => YEAR.test(norm(w.text)));
    if (past) candidates.push({start, end, reason: 'past_reference', score: 2});
    const own = emotionalIn(sent);
    const neighbours = [sentences[i - 1], sentences[i + 1]].filter((n): n is VoWord[] => Boolean(n) && Math.abs(n![0]!.start - start) <= 8);
    const merged = new Set([...own, ...neighbours.flatMap(n => [...emotionalIn(n)])]);
    if (own.size >= 1 && merged.size >= 2) candidates.push({start, end, reason: `serious_passage:${[...merged].sort().join('+')}`, score: 3});
  });
  const chosen: Candidate[] = [];
  const used = () => chosen.reduce((sum, c) => sum + (c.end - c.start), 0);
  for (const c of candidates.sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (chosen.length >= IMPACT_BW_MAX_SPANS) break;
    if (c.end - c.start < IMPACT_BW_MIN_SPAN_SEC) continue;
    if (c.start < IMPACT_BW_EDGE_SEC || c.end > durationSec - IMPACT_BW_EDGE_SEC) continue;
    if (!free(c.start, c.end)) continue;
    if (chosen.some(o => c.start < o.end + IMPACT_BW_MIN_GAP_SEC && c.end > o.start - IMPACT_BW_MIN_GAP_SEC)) continue;
    if (used() + (c.end - c.start) > durationSec * IMPACT_BW_SHARE_MAX + 1e-6) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.start - b.start);
  return {
    spans: chosen.map(c => ({startSec: round(c.start), endSec: round(Math.min(c.end, durationSec))})),
    reasons: chosen.map(c => ({startSec: round(c.start), endSec: round(Math.min(c.end, durationSec)), reason: c.reason})),
  };
}

export const planBwSpans = (words: readonly VoWord[], plan: Pick<VoCutPlan, 'shots' | 'holds' | 'chapterCards'>, durationSec: number): ImpactBwSpan[] => planBwSpansWithReasons(words, plan, durationSec).spans;

export function planImpactFx(input: {words: readonly VoWord[]; plan: Pick<VoCutPlan, 'cuts' | 'groups' | 'holds' | 'shots' | 'chapterCards'>; durationSec: number}): PolishImpactFxResult {
  const {words, plan, durationSec} = input;
  const none: PolishImpactFxResult = {fx: {flashes: [], satPops: [], punchIns: [], bwSpans: []}, warnings: ['polish_impact:none'], stats: {flashes: 0, satPops: 0, punchIns: 0, bwSpans: 0, bwShare: 0}};
  if (!(durationSec >= 2) || plan.groups.length === 0) return none;

  // flashes: the hook word, then the major reveals (headline holds; else the first money hold)
  const candidates: ImpactFlash[] = [];
  const hook = plan.groups.find(group => group.start < 3);
  if (hook) candidates.push({startSec: round(hook.start), frames: IMPACT_FLASH_FRAMES, reason: 'hook_word'});
  const headlines = plan.holds.filter(hold => hold.reason === 'headline');
  const reveals = headlines.length > 0 ? headlines : plan.holds.filter(hold => hold.reason === 'money').slice(0, 1);
  for (const hold of reveals) candidates.push({startSec: round(hold.start), frames: IMPACT_FLASH_FRAMES, reason: 'major_reveal'});
  const flashCap = Math.max(1, Math.ceil(durationSec / IMPACT_FLASH_PER_SEC));
  const flashes: ImpactFlash[] = [];
  for (const candidate of candidates.sort((a, b) => a.startSec - b.startSec)) {
    if (flashes.length >= flashCap) break;
    const previous = flashes[flashes.length - 1];
    if (previous && candidate.startSec - previous.startSec < IMPACT_FLASH_MIN_GAP_SEC) continue;
    flashes.push(candidate);
  }

  // saturation pops: name reveals
  const satCap = Math.max(1, Math.ceil(durationSec / IMPACT_SAT_PER_SEC));
  const satPops: ImpactSatPop[] = [];
  for (const at of nameRevealTimes(words)) {
    if (satPops.length >= satCap) break;
    if (flashes.some(flash => Math.abs(flash.startSec - at) < IMPACT_SAT_FLASH_CLEARANCE_SEC)) continue;
    const previous = satPops[satPops.length - 1];
    if (previous && at - previous.startSec < IMPACT_SAT_MIN_GAP_SEC) continue;
    satPops.push({startSec: at, frames: IMPACT_SAT_POP_FRAMES});
  }

  // punch-ins: every money hold
  const punchIns: ImpactPunchIn[] = plan.holds
    .filter(hold => hold.reason === 'money')
    .map(hold => ({startSec: round(hold.start), endSec: round(hold.end), rampFrames: IMPACT_PUNCH_RAMP_FRAMES, scale: IMPACT_PUNCH_SCALE}));

  const bw = planBwSpansWithReasons(words, plan, durationSec);
  const bwSpans = bw.spans;
  const bwShare = shareOf(bwSpans, durationSec);
  const fx: ImpactFxPlan = {flashes, satPops, punchIns, bwSpans};
  return {
    fx,
    warnings: [...bw.reasons.map(r => `polish_impact:bw_reason:${r.startSec}-${r.endSec}:${r.reason}`), `polish_impact:flash:${flashes.length}`, `polish_impact:sat_pop:${satPops.length}`, `polish_impact:punch_in:${punchIns.length}`, `polish_impact:bw:${bwSpans.length}:${bwShare.toFixed(2)}`],
    stats: {flashes: flashes.length, satPops: satPops.length, punchIns: punchIns.length, bwSpans: bwSpans.length, bwShare},
  };
}

/** True when the plan has nothing to draw (the blueprint then carries no `impactFx`). */
export const impactFxIsEmpty = (fx: ImpactFxPlan): boolean => fx.flashes.length + fx.satPops.length + fx.punchIns.length + fx.bwSpans.length === 0;
