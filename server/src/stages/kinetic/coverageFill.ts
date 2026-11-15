/**
 * Coverage fill: "the typography track owns the spoken words; the Director picks the treatment and emphasis, never silently drops a word".
 *
 * After the plan is resolved, every transcript word that no event's wordRange covers is given the quietest treatment the solver already has: a `running` line (small, one word at a time,
 * chest height, OUT-4). Runs are cut at sentence punctuation, at a pause, at a shot boundary and at `MAX_RUN_WORDS`. Director events are never changed; a fill never overlaps a Director event's words
 * (it only takes indices the plan leaves uncovered). The solver still applies its own density rules, so a fill that cannot be placed is reported by `wordCoverage`, not hidden.
 *
 * Pure.
 */
import {matchCutWindow} from './matchCut.ts';
import type {EventProvenance} from './plan.ts';
import type {KineticPlan, KineticShot, KineticWord, TextEvent} from './schema.ts';
import {normToken} from './transcript.ts';

export const MAX_RUN_WORDS = 4;
/** a sentence-final word shorter than this many frames may join a full run (see coverageFillEvents) */
export const SHORT_FINAL_WORD_FRAMES = 8;
/** a gap between two words longer than this starts a new run (seconds) */
export const RUN_BREAK_SEC = 0.45;

/** The words of `ev.wordRange` its lines actually draw: line tokens matched in order against the range (a swap slot adds its own sequence). */
export function drawnWordIdx(ev: Pick<TextEvent, 'wordRange' | 'lines'>, words: KineticWord[]): Set<number> {
  const drawn = new Set<number>();
  const tokens = ev.lines.flatMap(l => l.text.split(/\s+/).map(normToken).filter(Boolean));
  // some treatments split a word into one line per LETTER (per-letter cascade): compare on the joined characters as a second chance, still in order
  const joined = ev.lines.map(l => l.text.split(/\s+/).map(normToken).join('')).join('');
  let k = 0, p = 0;
  for (let i = ev.wordRange[0]; i <= ev.wordRange[1] && i < words.length; i += 1) {
    const t = normToken(words[i]!.text);
    if (!t) { drawn.add(i); continue; }
    const at = tokens.indexOf(t, k);
    if (at >= 0) { drawn.add(i); k = at + 1; continue; }
    const jat = joined.indexOf(t, p);
    if (jat >= 0 && t.length >= 3) { drawn.add(i); p = jat + t.length; }
  }
  for (const l of ev.lines) for (const idx of (l as {swapSlot?: {wordIdxSequence?: number[]}}).swapSlot?.wordIdxSequence ?? []) drawn.add(idx);
  return drawn;
}

const strip = (t: string) => t.replace(/[.,;:!?]+$/, '').trim();

/** `splitAfterIdx` (Phase 4.2 repair ladder, default none): a run is cut after each of these word indices (a run that could not be placed clear of the face is bisected this way). */
export function coverageFillEvents(plan: KineticPlan, words: KineticWord[], shots: KineticShot[], fps: number, splitAfterIdx?: ReadonlySet<number>): TextEvent[] {
  // "covered" = DRAWN by an event's lines, not merely inside its range (a match cut owns ~8 words of timing but draws one)
  const covered = new Set<number>();
  for (const e of plan.events) for (const i of drawnWordIdx(e, words)) covered.add(i);
  const shotOf = (w: KineticWord) => shots.find(s => w.startFrame >= s.startFrame && w.startFrame < s.endFrame) ?? shots[shots.length - 1];
  // A KEPT match cut owns the frame for its window: no other text may be on screen then (the solver drops any fill that overlaps it). So the words spoken inside the card's window are the card's (it shows the
  // speaker's own words as context) and are not offered to a fill; the runs on either side are cut AT the card's edges, so the words around the card keep their text instead of being dropped with an
  // overlapping run. Plans without a match cut are unaffected.
  const cardWindows = plan.events
    .filter(e => e.preset === 'type.matchCut')
    .map(e => matchCutWindow(e, words, shots.find(sh => sh.id === e.shotId), fps))
    .filter((w): w is {inFrame: number; outFrame: number} => w !== null);
  const inCard = (w: KineticWord) => cardWindows.some(c => w.startFrame >= c.inFrame && w.startFrame < c.outFrame);
  const out: TextEvent[] = [];
  let run: KineticWord[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const shot = shotOf(run[0]!);
    const lines = run.map(w => strip(w.text)).filter(t => normToken(t).length > 0 || t.length > 0);
    if (shot && lines.length > 0) {
      out.push({
        id: `cov-${run[0]!.idx}-${run[run.length - 1]!.idx}`,
        shotId: shot.id,
        wordRange: [run[0]!.idx, run[run.length - 1]!.idx],
        lines: lines.map(text => ({text, role: 'running' as const})),
        preset: 'type.words',
        layering: 'front',
        anchor: 'screen',
        regionHint: 'running',
      });
    }
    run = [];
  };
  const breakSec = RUN_BREAK_SEC * fps;
  for (const w of words) {
    if (covered.has(w.idx) || inCard(w)) { flush(); continue; }
    const prev = run[run.length - 1];
    if (prev) {
      const endsSentence = /[.!?;:]$/.test(prev.text);
      const pause = w.startFrame - prev.endFrame > breakSec;
      const otherShot = shotOf(prev)?.id !== shotOf(w)?.id;
      // A full run (MAX_RUN_WORDS) takes ONE more word when that word closes the sentence and is too short to stand alone (< 8 frames: the solver would drop it as unreadable, losing a meaningful word such as the
      // last word of "a paid group option."). It reads as the natural end of the phrase; every other run is cut exactly as before.
      const closesShort = run.length === MAX_RUN_WORDS && /[.!?]$/.test(w.text) && w.endFrame - w.startFrame < SHORT_FINAL_WORD_FRAMES;
      if (endsSentence || pause || otherShot || (run.length >= MAX_RUN_WORDS && !closesShort) || splitAfterIdx?.has(prev.idx)) flush();
    }
    run.push(w);
  }
  flush();
  return out;
}

/** The plan with the fills appended (sorted by first word) and one provenance record per fill. Director events untouched. */
export type CoverageFillResult = {
  plan: KineticPlan;
  added: TextEvent[];
  /** match cuts removed because their full-frame card owns more words than it draws (the solver forbids any other text during a card, so those words would be silently lost) */
  droppedMatchCuts: Array<{eventId: string; wordRange: [number, number]; drawn: number; owned: number}>;
  provenance: Record<string, EventProvenance>;
};

/**
 * The plan with the fills appended (sorted by first word) and one provenance record per fill. Director events are untouched EXCEPT a match cut that would swallow spoken words
 * (`policy.keepSwallowingMatchCuts` = false, the default): the card hides every other word for ~1.8 s, which breaks "the type track owns every spoken word".
 */
export function withCoverageFill(plan: KineticPlan, words: KineticWord[], shots: KineticShot[], fps: number, policy: {keepSwallowingMatchCuts?: boolean; splitAfterIdx?: ReadonlySet<number>} = {}): CoverageFillResult {
  const droppedMatchCuts: CoverageFillResult['droppedMatchCuts'] = [];
  const kept = policy.keepSwallowingMatchCuts ? plan.events : plan.events.filter(e => {
    if (e.preset !== 'type.matchCut') return true;
    const owned = e.wordRange[1] - e.wordRange[0] + 1;
    const drawn = drawnWordIdx(e, words).size;
    if (drawn >= owned) return true;
    droppedMatchCuts.push({eventId: e.id, wordRange: e.wordRange, drawn, owned});
    return false;
  });
  const base = kept.length === plan.events.length ? plan : {...plan, events: kept};
  const added = coverageFillEvents(base, words, shots, fps, policy.splitAfterIdx);
  if (added.length === 0) return {plan: base, added, droppedMatchCuts, provenance: {}};
  const events = [...base.events, ...added].sort((a, b) => a.wordRange[0] - b.wordRange[0]);
  return {plan: {...base, events}, added, droppedMatchCuts, provenance: Object.fromEntries(added.map(e => [e.id, {eventId: e.id, origin: 'coverage_fill' as const, repairs: []}]))};
}
