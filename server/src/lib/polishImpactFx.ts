/**
 * WP35: the Metromedia IMPACT FX plan (editref.md / metromedia-grammar.yaml `effects`). PURE (no env, no I/O, no model, no randomness): spoken words + the WP33 cut plan in, timed events out. The renderer
 * (remotion `ImpactFxTrack` / `ImpactPunch`, lib/impactFx.ts) paints them; this module only decides WHERE.
 *
 *   flash_overexpose     1-2 frames: on the HOOK word (the first caption group) and on a MAJOR REVEAL (a headline hold, else the first money hold). Lands exactly on the cut frame so the flash hides the cut.
 *   saturation_glow_pop  2-4 frames (3): on a NAME REVEAL: the first capitalised word of a proper-name run that is not a sentence start ("... founder Alex Chen" -> "Alex").
 *   punch_in             scale 1.10 over 7 frames (grammar 6-8), held for the whole MONEY hold ("six billion dollars"), reset by the next cut.
 *   bw_grade             a hard black-and-white flip on EMOTIONAL / PAST shots (collapse, fired, lost, ... and year tokens): whole shots of the cut plan, ~15 % of the runtime at most, never over a money hold or a
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
export const IMPACT_BW_SHARE_TARGET = 0.15;
export const IMPACT_BW_MIN_SPAN_SEC = 0.8;
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
  'collapsed', 'collapse', 'fired', 'lost', 'failed', 'failure', 'bankrupt', 'broke', 'alone', 'lonely', 'empty', 'cold', 'cried', 'crying', 'died', 'death', 'divorce', 'divorced', 'homeless', 'rejected', 'quit', 'betrayed',
  'destroyed', 'ruined', 'heartbroken', 'regret', 'regretted', 'grief', 'funeral', 'abandoned', 'shattered', 'humiliated',
]);
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

export function planBwSpans(words: readonly VoWord[], plan: Pick<VoCutPlan, 'shots' | 'holds' | 'chapterCards'>, durationSec: number): ImpactBwSpan[] {
  const blocked = [
    ...plan.holds.filter(hold => hold.reason === 'money').map(hold => ({start: hold.start, end: hold.end})),
    ...plan.chapterCards.map(card => ({start: card.at, end: round(card.at + card.duration)})),
  ];
  const free = (start: number, end: number) => !blocked.some(span => start < span.end - 1e-6 && end > span.start + 1e-6);
  const budget = durationSec * IMPACT_BW_SHARE_TARGET;
  const chosen: ImpactBwSpan[] = [];
  const used = () => chosen.reduce((sum, span) => sum + (span.endSec - span.startSec), 0);
  const ranked = emotionalBeats(words).sort((a, b) => b.score - a.score || a.at - b.at);
  for (const beat of ranked) {
    const index = plan.shots.findIndex(shot => beat.at >= shot.start - 1e-6 && beat.at < shot.end - 1e-6);
    if (index < 0) continue;
    let start = plan.shots[index]!.start;
    let end = plan.shots[index]!.end;
    // a sliver of a shot is not a grade beat: take the next shot with it
    const next = plan.shots[index + 1];
    if (end - start < IMPACT_BW_MIN_SPAN_SEC && next && next.kind !== 'card') end = next.end;
    if (!free(start, end) || end <= start) continue;
    if (chosen.some(span => start < span.endSec + 1e-6 && end > span.startSec - 1e-6)) continue;
    if (used() + (end - start) > budget + 1e-6) continue;
    chosen.push({startSec: round(start), endSec: round(Math.min(end, durationSec))});
  }
  // adjacent spans are one flip
  const sorted = chosen.sort((a, b) => a.startSec - b.startSec);
  const merged: ImpactBwSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.startSec <= last.endSec + 1e-6) last.endSec = Math.max(last.endSec, span.endSec);
    else merged.push({...span});
  }
  return merged;
}

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

  const bwSpans = planBwSpans(words, plan, durationSec);
  const bwShare = shareOf(bwSpans, durationSec);
  const fx: ImpactFxPlan = {flashes, satPops, punchIns, bwSpans};
  return {
    fx,
    warnings: [`polish_impact:flash:${flashes.length}`, `polish_impact:sat_pop:${satPops.length}`, `polish_impact:punch_in:${punchIns.length}`, `polish_impact:bw:${bwSpans.length}:${bwShare.toFixed(2)}`],
    stats: {flashes: flashes.length, satPops: satPops.length, punchIns: punchIns.length, bwSpans: bwSpans.length, bwShare},
  };
}

/** True when the plan has nothing to draw (the blueprint then carries no `impactFx`). */
export const impactFxIsEmpty = (fx: ImpactFxPlan): boolean => fx.flashes.length + fx.satPops.length + fx.punchIns.length + fx.bwSpans.length === 0;
