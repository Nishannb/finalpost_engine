/**
 * Semantic emphasis validation of a Director plan (Phase 4).
 *
 * Benchmark finding: Gemini picks grammatical glue (`you`, `for`, `a`, second / third as list markers) as the HERO of an event, and uses more heroes than the speech supports. A stop-word ban would
 * be wrong: "it was never about YOU" or a one-word beat after a long pause makes a small word the whole point. So the rule is EVIDENCE based, not list based:
 *
 *   a hero line is WEAK when every one of its words is glue (function words, discourse fillers, list-order markers). A weak hero is kept only with evidence from the SPEECH itself:
 *     isolated        a pause of >= 0.3 s on both sides (or the edit boundary): the speaker set it apart
 *     stressed        the speech-derived emphasis score is high for a glue word (long for its length, capitalised, exclamation)
 *     contrast        a contrast marker (not / never / but / instead / versus / only) within 4 words and a second pronoun in the same stretch ("not THEM, YOU")
 *     parallel        the same word starts or ends neighbouring phrases within 8 words ("you ... you")
 *     shouted         written in capitals in the transcript
 *   Without evidence the hero is REPAIRED, deterministically and recorded: 1. promote the strongest content word that the event already displays; 2. otherwise demote the glue word to a connector and
 *   let the event read as a quiet running line. Words are never invented or removed, the event keeps its words, timing and treatment.
 *
 * Deterministic, bounded (one pass, at most one repair per event), pure. Every change is a decision (stage `accept`, constraint `discretionary`).
 */
import type {SolverDecision} from './diagnostics.ts';
import type {KineticPlan, KineticWord, TextEvent} from './schema.ts';
import {normToken} from './transcript.ts';
import {FUNCTION_WORDS} from './words.ts';

const GLUE_EXTRA = new Set(['he', 'she', 'they', 'me', 'him', 'her', 'them', 'your', 'our', 'his', 'their', 'its', 'at', 'up', 'down', 'with', 'as', 'by', 'from', 'but', 'or', 'so', 'if', 'do', 'does', 'did', 'have', 'has', 'had', 'were', 'been', 'am', 'will', 'would', 'can', 'could', 'what', 'how', 'than', 'then', 'there', 'here', 'about', 'into', 'over', 'out', 'off', 'one', 'some', 'any', 'each', 'every']);
const DISCOURSE = new Set(['actually', 'really', 'very', 'even', 'still', 'also', 'maybe', 'basically', 'literally', 'honestly', 'simply', 'quite', 'rather', 'kind', 'sort', 'well', 'okay', 'ok', 'yeah']);
const LIST_MARKERS = new Set(['first', 'second', 'third', 'fourth', 'next', 'finally', 'lastly', 'firstly', 'secondly', 'thirdly']);
const CONTRAST = new Set(['not', 'never', 'but', 'instead', 'versus', 'vs', 'only', 'nobody', 'nothing']);
const PRONOUNS = new Set(['i', 'you', 'we', 'they', 'he', 'she', 'me', 'us', 'them', 'him', 'her']);

export type WordClass = 'content' | 'glue' | 'discourse' | 'list_marker';
export function classOf(token: string): WordClass {
  const t = normToken(token);
  if (!t) return 'glue';
  if (LIST_MARKERS.has(t)) return 'list_marker';
  if (DISCOURSE.has(t)) return 'discourse';
  if (FUNCTION_WORDS.has(t) || GLUE_EXTRA.has(t)) return 'glue';
  return 'content';
}

export type EmphasisEvidence = 'isolated' | 'stressed' | 'contrast' | 'parallel' | 'shouted';

/** Evidence from the speech that a (weak) word at `idx` carries the point. Empty = none. */
export function evidenceFor(words: readonly KineticWord[], idx: number, fps: number): EmphasisEvidence[] {
  const w = words[idx];
  if (!w) return [];
  const out: EmphasisEvidence[] = [];
  const prev = words[idx - 1], next = words[idx + 1];
  const gapBefore = prev ? (w.startFrame - prev.endFrame) / fps : Infinity;
  const gapAfter = next ? (next.startFrame - w.endFrame) / fps : Infinity;
  if (gapBefore >= 0.3 && (gapAfter >= 0.3 || /[.!?,;:]$/.test(w.text))) out.push('isolated');
  if (w.emphasisScore >= 0.5) out.push('stressed');
  const near = words.slice(Math.max(0, idx - 4), idx + 5);
  const nearToks = near.map(x => normToken(x.text));
  const myTok = normToken(w.text);
  if (nearToks.some(t => CONTRAST.has(t)) && PRONOUNS.has(myTok) && nearToks.filter(t => PRONOUNS.has(t)).length >= 2) out.push('contrast');
  const wider = words.slice(Math.max(0, idx - 8), idx + 9).filter(x => x.idx !== idx);
  // parallelism needs a pattern, not a coincidence: the same word at least twice more within 8 words, at phrase edges ("you ... you ... you")
  if (myTok && wider.filter(x => normToken(x.text) === myTok && (/[.,;:!?]$/.test(x.text) || /[.,;:!?]$/.test(w.text))).length >= 2) out.push('parallel');
  if (/^[A-Z]{2,}[^a-z]*$/.test(w.text.trim())) out.push('shouted');
  return out;
}

/** An ordinal is a list MARKER only where it opens a phrase or is followed by a comma ("Second, I stopped ..."); "for a second" / "the second time" use the word for its meaning. */
export function isMarkerUse(words: readonly KineticWord[], idx: number): boolean {
  const w = words[idx], prev = words[idx - 1];
  if (!w || !LIST_MARKERS.has(normToken(w.text))) return false;
  return /[,;:]$/.test(w.text) || !prev || /[.!?;:]$/.test(prev.text);
}

const heroLines = (ev: TextEvent) => ev.lines.map((l, i) => ({l, i})).filter(x => x.l.role === 'hero' || x.l.role === 'punch');

/** word index (inside the event's range) that a line token stands for: the first unused match in order. */
function indexOfToken(ev: TextEvent, words: readonly KineticWord[], token: string, from: number): number {
  const t = normToken(token);
  for (let i = Math.max(ev.wordRange[0], from); i <= ev.wordRange[1] && i < words.length; i += 1) if (normToken(words[i]!.text) === t) return i;
  return -1;
}

export type EmphasisReport = {checked: number; weak: number; kept: Array<{eventId: string; text: string; evidence: EmphasisEvidence[]}>; promoted: number; demoted: number};

export function validateEmphasis(plan: KineticPlan, words: readonly KineticWord[], fps: number): {plan: KineticPlan; decisions: SolverDecision[]; report: EmphasisReport} {
  const decisions: SolverDecision[] = [];
  const report: EmphasisReport = {checked: 0, weak: 0, kept: [], promoted: 0, demoted: 0};
  const events = plan.events.map((ev): TextEvent => {
    if (ev.preset !== 'type.words') return ev;
    const heroes = heroLines(ev);
    if (heroes.length === 0) return ev;
    report.checked += 1;
    // a hero line passes if ANY of its words is content, or the speech gives evidence for a glue word in it
    let weakLine = false, evidence: EmphasisEvidence[] = [];
    const contentTok = (t: string): boolean => {
      const c = classOf(t);
      if (c === 'content') return true;
      if (c !== 'list_marker') return false;
      const i = indexOfToken(ev, words, t, ev.wordRange[0]);
      return !(i >= 0 && isMarkerUse(words, i)); // a list marker used as a marker is not content; an ordinal used for its meaning is
    };
    for (const {l} of heroes) {
      const toks = l.text.split(/\s+/).filter(Boolean);
      if (toks.some(contentTok)) { weakLine = false; evidence = []; break; }
      weakLine = true;
      let from = ev.wordRange[0];
      for (const t of toks) {
        const idx = indexOfToken(ev, words, t, from);
        if (idx >= 0) { from = idx + 1; evidence = [...evidence, ...evidenceFor(words, idx, fps)]; }
      }
    }
    if (!weakLine) return ev;
    report.weak += 1;
    const heroText = heroes.map(h => h.l.text).join(' ');
    if (evidence.length > 0) { report.kept.push({eventId: ev.id, text: heroText, evidence: [...new Set(evidence)]}); return ev; }
    // 1) promote the strongest content word the event already displays
    const candidates = ev.lines.map((l, i) => ({l, i, toks: l.text.split(/\s+/).filter(Boolean)})).filter(x => x.l.role !== 'hero' && x.l.role !== 'punch' && x.toks.some(t => classOf(t) === 'content'));
    const score = (x: {toks: string[]}) => Math.max(...x.toks.map(t => { const i = indexOfToken(ev, words, t, ev.wordRange[0]); return i >= 0 && classOf(t) === 'content' ? words[i]!.emphasisScore + Math.min(0.12, normToken(t).length * 0.01) : -1; }));
    const best = [...candidates].sort((a, b) => score(b) - score(a) || a.i - b.i)[0];
    if (best && score(best) > 0) {
      const heroIdx = new Set(heroes.map(h => h.i));
      const lines = ev.lines.map((l, i) => (i === best.i ? {...l, role: 'hero' as const} : heroIdx.has(i) ? {...l, role: 'connector' as const} : l));
      report.promoted += 1;
      decisions.push({eventId: ev.id, stage: 'accept', kind: 'promoted', field: 'role', requested: {hero: heroText}, produced: {hero: best.l.text}, code: 'promoted.hero_content_word', reason: `"${heroText}" is grammatical glue with no support in the speech (no isolating pause, no stress, no contrast); the event's own content word "${best.l.text}" carries the point`, constraint: 'discretionary'});
      return {...ev, lines};
    }
    // 2) no content word to promote: the event reads as a quiet running line
    report.demoted += 1;
    decisions.push({eventId: ev.id, stage: 'accept', kind: 'demoted', field: 'role', requested: {hero: heroText}, produced: {role: 'running'}, code: 'demoted.hero_function_word', reason: `"${heroText}" is grammatical glue with no support in the speech and the event has no content word to promote: shown as a quiet running line instead of a headline`, constraint: 'discretionary'});
    return {...ev, lines: ev.lines.map(l => ({...l, role: 'running' as const})), regionHint: 'running' as const};
  });
  return {plan: decisions.length ? {...plan, events} : plan, decisions, report};
}
