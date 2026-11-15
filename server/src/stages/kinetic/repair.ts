/**
 * Bounded creative repair of hero collisions (Phase 4).
 *
 * Phase 3 repaired a verifier objection by REMOVING the event. For two heroes that are active together that throws away real emphasis. The ladder here is deterministic and bounded:
 *
 *   1. keep the STRONGER hero, DEMOTE the weaker one to a quiet running line (its words, timing and place in the story stay; only its headline status goes);
 *   2. an event that is already quiet, or any objection that is not a hero / gap collision, is removed (as in Phase 3) and its words fall to the coverage fill.
 *
 * "Stronger" is measured, not guessed: the hero's content class (content > glue), the speech-derived emphasis score of its words, and whether the hero came from the Director unchanged. Ties go to
 * the earlier event (it is already on screen). One action per objection per pass; the caller bounds the passes. Every action is a decision with its measured reason.
 *
 * What this does NOT do (documented, Phase 3 report section 6.2): shift timing. Event windows come from the speech and the solver's own hold / trim rules; a "small timing change" would have to live
 * in the solver's `limitOut`, not in the plan. Pure.
 */
import {classOf} from './emphasis.ts';
import type {SolverDecision} from './diagnostics.ts';
import type {Violation} from './guardrails.ts';
import type {KineticPlan, KineticWord, TextEvent} from './schema.ts';
import {normToken} from './transcript.ts';

const parent = (id: string) => id.replace(/\.[ab]$/, '');

/** How strongly an event's hero is supported by the speech: higher = keep. */
export function heroStrength(ev: TextEvent, words: readonly KineticWord[]): number {
  const toks = ev.lines.filter(l => l.role === 'hero' || l.role === 'punch').flatMap(l => l.text.split(/\s+/).filter(Boolean));
  if (toks.length === 0) return -1;
  const score = (t: string) => {
    let best = 0;
    for (let i = ev.wordRange[0]; i <= ev.wordRange[1] && i < words.length; i += 1) if (normToken(words[i]!.text) === normToken(t)) best = Math.max(best, words[i]!.emphasisScore);
    return best + (classOf(t) === 'content' ? 0.5 : 0) + Math.min(0.1, normToken(t).length * 0.01);
  };
  return Math.max(...toks.map(score));
}

const quiet = (ev: TextEvent) => ev.lines.every(l => l.role === 'running' || l.role === 'caption');

export type RepairOutcome = {plan: KineticPlan; decisions: SolverDecision[]; demoted: string[]; removed: string[]};

/** One pass over the objections. Demotes the weaker hero of each collision pair; removes events the ladder cannot keep. */
export function repairViolations(plan: KineticPlan, violations: readonly Violation[], words: readonly KineticWord[]): RepairOutcome {
  const decisions: SolverDecision[] = [];
  const demoted: string[] = [], removed: string[] = [];
  const byId = new Map(plan.events.map(e => [e.id, e]));
  const touched = new Set<string>();
  const demote = new Map<string, string>(), remove = new Map<string, string>();
  for (const v of violations) {
    const b = parent(v.eventId);
    const pair = /^(\S+) and (\S+) are both hero/.exec(v.detail);
    if (v.rule === 'density-hero' && pair) {
      const a = byId.get(parent(pair[1]!)), c = byId.get(parent(pair[2]!));
      if (!a || !c || touched.has(a.id) || touched.has(c.id)) continue;
      const sa = heroStrength(a, words), sc = heroStrength(c, words);
      // the later event loses a tie (the earlier one is already on screen)
      const [keep, lose] = sc > sa + 1e-9 ? [c, a] : [a, c];
      touched.add(a.id); touched.add(c.id);
      if (quiet(lose)) remove.set(lose.id, `two heroes active together; "${lose.id}" is already quiet, so it is removed`);
      else demote.set(lose.id, `heroes "${a.id}" (${sa.toFixed(2)}) and "${c.id}" (${sc.toFixed(2)}) are active together: the stronger, "${keep.id}", keeps the headline`);
    } else if (byId.has(b) && !touched.has(b)) {
      touched.add(b);
      remove.set(b, `the verifier rejected the solved event (${v.rule}: ${v.detail.slice(0, 80)})`);
    }
  }
  const events = plan.events.flatMap((e): TextEvent[] => {
    if (remove.has(e.id)) {
      removed.push(e.id);
      decisions.push({eventId: e.id, stage: 'accept', kind: 'dropped', field: 'event', requested: 'event as planned', produced: 'removed (its words fall to the quiet running line)', code: 'dropped.guardrail_violation', reason: remove.get(e.id)!, constraint: 'hard'});
      return [];
    }
    if (demote.has(e.id)) {
      demoted.push(e.id);
      decisions.push({eventId: e.id, stage: 'accept', kind: 'demoted', field: 'role', requested: {role: 'hero'}, produced: {role: 'running'}, code: 'demoted.hero_collision', reason: demote.get(e.id)!, constraint: 'discretionary'});
      return [{...e, lines: e.lines.map(l => ({...l, role: 'running' as const})), regionHint: 'running' as const}];
    }
    return [e];
  });
  return {plan: {...plan, events}, decisions, demoted, removed};
}

/**
 * Oversized events (more spoken words than one block may show: the solver's MAX_BLOCK_WORDS) are SPLIT at line boundaries into consecutive events instead of being trimmed by the solver, which
 * silently dropped the tail (benchmark: a 10-word call to action lost "me what you chose"). Roles, treatment and tags are kept; the entry tags stay on the first chunk, the exit on the last.
 * Deterministic; one decision per split event. A single line longer than the cap is cut at word boundaries.
 */
export function splitOversizedEvents(plan: KineticPlan, words: readonly KineticWord[], maxWords: number): {plan: KineticPlan; decisions: SolverDecision[]} {
  const decisions: SolverDecision[] = [];
  const events = plan.events.flatMap((ev): TextEvent[] => {
    if (ev.preset !== 'type.words') return [ev];
    const lineWords = ev.lines.map(l => l.text.split(/\s+/).filter(Boolean));
    if (lineWords.reduce((n, w) => n + w.length, 0) <= maxWords) return [ev];
    // chunk lines
    const chunks: Array<{lines: TextEvent['lines']}> = [];
    let cur: TextEvent['lines'] = [], n = 0;
    const flush = () => { if (cur.length) chunks.push({lines: cur}); cur = []; n = 0; };
    ev.lines.forEach((l, i) => {
      const toks = lineWords[i]!;
      if (toks.length > maxWords) {
        flush();
        for (let k = 0; k < toks.length; k += maxWords) chunks.push({lines: [{...l, text: toks.slice(k, k + maxWords).join(' ')}]});
        return;
      }
      if (n + toks.length > maxWords) flush();
      cur.push(l); n += toks.length;
    });
    flush();
    if (chunks.length < 2) return [ev];
    let cursor = ev.wordRange[0];
    const out: TextEvent[] = [];
    chunks.forEach((c, ci) => {
      const toks = c.lines.flatMap(l => l.text.split(/\s+/).filter(Boolean)).map(normToken).filter(Boolean);
      const idxs: number[] = [];
      for (const t of toks) for (let k = cursor; k <= ev.wordRange[1] && k < words.length; k += 1) if (normToken(words[k]!.text) === t) { idxs.push(k); cursor = k + 1; break; }
      if (!idxs.length) return;
      const first = ci === 0, last = ci === chunks.length - 1;
      const lines = c.lines.map((l, li) => {
        const copy = {...l} as TextEvent['lines'][number];
        if (!first && li === 0) delete (copy as {enter?: unknown}).enter;
        return copy;
      });
      const part: TextEvent = {...ev, id: `${ev.id}~${ci + 1}`, wordRange: [Math.min(...idxs), Math.max(...idxs)], lines};
      if (!last) delete (part as {exit?: unknown}).exit;
      out.push(part);
    });
    if (out.length < 2) return [ev];
    decisions.push({eventId: ev.id, stage: 'accept', kind: 'adjusted', field: 'event', requested: `${lineWords.reduce((a, w) => a + w.length, 0)} words in one block`, produced: `${out.length} consecutive events of at most ${maxWords} words`, code: 'adjusted.event_split', reason: `a block shows at most ${maxWords} words; the solver would have cut the tail and left words undrawn`, constraint: 'hard'});
    return out;
  });
  return {plan: decisions.length ? {...plan, events} : plan, decisions};
}
