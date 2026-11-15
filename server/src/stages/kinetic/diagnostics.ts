/**
 * G2 / G6: structured diagnostics. Every time acceptance or the solver changes, demotes, replaces, refuses or drops something the Director asked for, it records ONE decision:
 * what was requested, what was produced, why, and whether a HARD constraint forced it or the solver chose to (DISCRETIONARY). Nothing here changes behaviour: the solver's
 * outputs are exactly what they were; this only makes the changes visible (and countable by the benchmark).
 *
 * hard           the request cannot be honoured: not in the transcript, no matte, not enough room at the readability floor, outside the safe rect, an unusable tag for this word.
 * discretionary  the request COULD be honoured but a house rule overrides it: density caps, one hero per block, "never the same entry + exit twice in a row", title spacing, gap trimming.
 *
 * Pure data. `requested` / `produced` are small JSON-safe values (strings, numbers, short arrays).
 */

export type DecisionStage = 'accept' | 'solve';
/** dropped: the event is gone. demoted / promoted: a word's role changed. replaced: a tag or choice was swapped for another. adjusted: same choice, changed value (timing, colour). refused: a capability was denied. trimmed: part of the event removed. */
export type DecisionKind = 'dropped' | 'demoted' | 'promoted' | 'replaced' | 'adjusted' | 'refused' | 'trimmed';
export type DecisionConstraint = 'hard' | 'discretionary';

export type SolverDecision = {
  eventId: string;
  stage: DecisionStage;
  kind: DecisionKind;
  /** what part of the request: event | role | lines | wordRange | enter | exit | regionHint | layering | pose | title | accent | preset | timing | style */
  field: string;
  requested: unknown;
  produced: unknown;
  /** stable machine code, `<kind>.<what>` (e.g. `dropped.density_gap`, `replaced.repeat_pair`) */
  code: string;
  reason: string;
  constraint: DecisionConstraint;
};

export type DecisionSink = (d: Omit<SolverDecision, 'stage'> & {stage?: DecisionStage}) => void;

export type DecisionSummary = {
  total: number;
  hard: number;
  discretionary: number;
  byKind: Record<string, number>;
  byCode: Record<string, number>;
};

export function summarizeDecisions(decisions: readonly SolverDecision[]): DecisionSummary {
  const s: DecisionSummary = {total: decisions.length, hard: 0, discretionary: 0, byKind: {}, byCode: {}};
  for (const d of decisions) {
    s[d.constraint] += 1;
    s.byKind[d.kind] = (s.byKind[d.kind] ?? 0) + 1;
    s.byCode[d.code] = (s.byCode[d.code] ?? 0) + 1;
  }
  return s;
}

export type EventPreservation = {
  eventId: string;
  /** preserved: nothing changed. adjusted: values changed but the creative choice stands. replaced: a tag / zone / layering was swapped. dropped: gone. */
  status: 'preserved' | 'adjusted' | 'replaced' | 'dropped';
  decisions: SolverDecision[];
};

const RANK: Record<EventPreservation['status'], number> = {preserved: 0, adjusted: 1, replaced: 2, dropped: 3};

/** Per requested event: how much of it survived. `eventIds` are the ids the Director asked for (a split / suffixed solver id such as `e1.a` counts for `e1`). */
export function preservationOf(eventIds: readonly string[], decisions: readonly SolverDecision[]): EventPreservation[] {
  const base = (id: string) => id.replace(/\.[a-z]$/, '');
  return eventIds.map(id => {
    const mine = decisions.filter(d => base(d.eventId) === id);
    let status: EventPreservation['status'] = 'preserved';
    for (const d of mine) {
      const s: EventPreservation['status'] = d.kind === 'dropped' ? 'dropped' : d.kind === 'replaced' || d.kind === 'refused' || d.kind === 'demoted' || d.kind === 'promoted' ? 'replaced' : 'adjusted';
      if (RANK[s] > RANK[status]) status = s;
    }
    return {eventId: id, status, decisions: mine};
  });
}
