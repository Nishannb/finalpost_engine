/** Plan acceptance: a raw director answer becomes a valid, grounded, density-clean KineticPlan or the deterministic fallback (with the reason recorded). Never throws. */
import type {SolverDecision} from './diagnostics.ts';
import {HERO_HOLD_FRAMES, MIN_GAP_FRAMES, buildFallbackPlan, densityViolations, rangeFrames, shotOfFrame, transcriptFidelity, type FallbackCapabilities, type PlateInfo} from './fallback.ts';
import {sanitizeMatchCuts} from './matchCut.ts';
import {isKnownPreset} from './presets.ts';
import {kineticPlanSchema, parseKineticPlan, textEventSchema, type KineticPlan, type KineticShot, type TextEvent, type KineticWord} from './schema.ts';
import {normToken} from './transcript.ts';
import {MAX_HEADLINE_UNITS, MAX_PEER_UNITS, countHeadlineUnits, isPeerList} from './words.ts';

/**
 * Where an event of the final plan came from (G5). `director`: exactly what the model wrote. `director_repaired`: the model's event with a recorded repair (a widened word range, an
 * ungrounded word removed, a shot id corrected). `fallback`: written by the deterministic planner, either for the whole plan or to FILL the place of a rejected director event (`replaces`).
 */
export type EventProvenance = {eventId: string; origin: 'director' | 'director_repaired' | 'fallback' | 'coverage_fill'; repairs: string[]; replaces?: string};
export type RejectedEvent = {eventId: string; code: string; reason: string; wordRange?: [number, number]};
export type ResolvedPlan = {
  plan: KineticPlan;
  /** `director` as soon as at least one model event survives (see `partial` / `provenance` for how much); `fallback` only when none did */
  source: 'director' | 'fallback';
  reason?: string;
  /** repairs applied to an accepted director plan (dropped match cuts, ...) */
  notes?: string[];
  /** one entry per event of `plan` */
  provenance?: Record<string, EventProvenance>;
  /** director events that were invalid (with the reason); a fallback event may stand in their place */
  rejected?: RejectedEvent[];
  /** accept-stage decisions (G2 / G6 shape): rejected, trimmed, repaired */
  decisions?: SolverDecision[];
  /** true when the plan mixes director events with fallback fills / lost some director events */
  partial?: boolean;
};

/**
 * Gemini often puts the right spoken words in `lines` but a slightly-too-narrow `wordRange`
 * (e.g. line has "know how to" while range stops before "how"). Expand the range to cover the
 * spoken tokens, then drop any token that still cannot be grounded. Keeps a near-valid director
 * plan instead of throwing away the whole LED edit for one off-by-one index.
 */
export function repairTranscriptFidelity(plan: KineticPlan, words: KineticWord[], opts: {nearest?: boolean} = {}): KineticPlan {
  const events: TextEvent[] = [];
  for (const ev of plan.events) {
    const [a0, b0] = ev.wordRange;
    const toks = ev.lines.flatMap(l => l.text.split(/\s+/).map(normToken).filter(Boolean));
    const found: number[] = [];
    let cursor = Math.max(0, Math.min(a0, words.length - 1) - 8);
    for (const tok of toks) {
      let idx = -1;
      if (opts.nearest) {
        // Phase 4: a repeated word ("I", "the") must resolve to the occurrence INSIDE the declared range (else the nearest one, within 6 words), not the first one after the cursor: the old rule
        // matched the wrong "I" and stretched the range backwards over a neighbouring event (overlapping ranges, fake hero collisions, words left undrawn).
        let bestDist = Infinity;
        for (let k = cursor; k < words.length; k += 1) {
          if (normToken(words[k]!.text) !== tok) continue;
          const dist = k < a0 ? a0 - k : k > b0 ? k - b0 : 0;
          if (dist < bestDist) { bestDist = dist; idx = k; }
          if (dist === 0 || k > b0 + 6) break;
        }
        if (bestDist > 6) idx = -1;
      } else {
        for (let k = cursor; k < words.length; k += 1) {
          if (normToken(words[k]!.text) === tok) { idx = k; break; }
        }
      }
      if (idx < 0) continue;
      found.push(idx);
      cursor = idx + 1;
    }
    const a = found.length ? Math.min(a0, ...found) : a0;
    const b = found.length ? Math.max(b0, ...found) : b0;
    if (a > b || b >= words.length || a < 0) continue;
    const allowed = new Set<string>();
    for (let k = a; k <= b; k += 1) allowed.add(normToken(words[k]!.text));
    const lines = ev.lines.flatMap(l => {
      const keep = l.text.split(/\s+/).filter(t => allowed.has(normToken(t)));
      return keep.length ? [{...l, text: keep.join(' ')}] : [];
    });
    if (!lines.length) continue;
    // density: type.words headline blocks are at most 6 spoken units (brand phrases count as 1; peer lists may hold 8)
    const isRunning = lines.every(l => l.role === 'running' || l.role === 'caption');
    let nextLines = lines;
    let nextA = a;
    let nextB = b;
    if (!isRunning && ev.preset === 'type.words') {
      const cap = isPeerList(lines) ? MAX_PEER_UNITS : MAX_HEADLINE_UNITS;
      if (countHeadlineUnits(lines) > cap) {
        const toks = lines.flatMap(l => l.text.split(/\s+/).filter(Boolean));
        const keep = new Set(toks.slice(-Math.min(toks.length, cap * 2)).map(normToken));
        nextLines = lines.flatMap(l => {
          const parts = l.text.split(/\s+/).filter(t => keep.has(normToken(t)));
          return parts.length ? [{...l, text: parts.join(' ')}] : [];
        });
        const found2: number[] = [];
        let c2 = a;
        for (const tok of nextLines.flatMap(l => l.text.split(/\s+/).map(normToken).filter(Boolean))) {
          for (let k = c2; k <= b; k += 1) if (normToken(words[k]!.text) === tok) { found2.push(k); c2 = k + 1; break; }
        }
        if (found2.length) { nextA = Math.min(...found2); nextB = Math.max(...found2); }
      }
    }
    if (!nextLines.length) continue;
    events.push({...ev, wordRange: [nextA, nextB], lines: nextLines});
  }
  return {...plan, events};
}

const issuesOf = (error: {issues: ReadonlyArray<{path: ReadonlyArray<PropertyKey>; message: string}>}, prefix: string) =>
  error.issues.slice(0, 3).map(i => `${prefix}${i.path.length ? `${prefix ? '.' : ''}${i.path.map(String).join('.')}` : prefix ? '' : '(root)'}: ${i.message}`).join('; ');

const brief = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object') return typeof raw;
  const e = raw as Record<string, unknown>;
  return {id: e.id, wordRange: e.wordRange, preset: e.preset, lines: Array.isArray(e.lines) ? e.lines.map(l => (l as {text?: unknown})?.text).slice(0, 6) : undefined};
};

/** The events of a fallback plan that may fill a rejected director event: entirely inside its word range and clear of every KEPT director event (with the solver's gap and hold). */
function fillsFor(rejected: RejectedEvent[], fallbackEvents: TextEvent[], kept: TextEvent[], words: KineticWord[]): Map<string, TextEvent[]> {
  const out = new Map<string, TextEvent[]>();
  const busy = kept.filter(e => e.wordRange[1] < words.length).map(e => rangeFrames(words, e.wordRange));
  for (const r of rejected) {
    if (!r.wordRange) continue;
    const [a, b] = r.wordRange;
    const mine = fallbackEvents.filter(f => f.wordRange[0] >= a && f.wordRange[1] <= b).filter(f => {
      const w = rangeFrames(words, f.wordRange);
      const hold = f.lines.some(l => l.role === 'hero') ? HERO_HOLD_FRAMES : 0;
      return !busy.some(k => w.inFrame < k.outFrame + MIN_GAP_FRAMES + HERO_HOLD_FRAMES && k.inFrame < w.outFrame + hold + MIN_GAP_FRAMES);
    });
    if (mine.length) out.set(r.eventId, mine);
  }
  return out;
}

/**
 * Plan acceptance with EVENT-LEVEL recovery (G5). The old behaviour threw the whole director plan away at the first problem; now:
 *   1. the plan envelope (version / style / fontPair / an `events` array) must be valid, else the whole fallback (nothing to recover);
 *   2. every event is validated on its own (schema, preset, shot, word range, transcript fidelity). A fixable problem is REPAIRED and recorded (`director_repaired`); an unfixable one REJECTS only that event;
 *   3. illegal / surplus match cuts are dropped (unchanged);
 *   4. a rejected event whose word range is known may be replaced by the fallback planner's events for exactly that range, when they clear the kept director events: never overwriting a valid director event;
 *   5. zero valid events from a non-empty plan = the whole fallback with the first reason (unchanged);
 *   6. every event of the result has a provenance record, and every rejection / repair is a decision.
 * Density rules are no longer an acceptance gate: the solver enforces them and records each drop / trim / demotion (diagnostics.ts), so a dense director plan is solved, not replaced.
 */
export function resolvePlan(raw: unknown, words: KineticWord[], shots: KineticShot[], upstreamReason?: string, opts: {fps?: number; plate?: PlateInfo; capabilities?: FallbackCapabilities; /** Phase 4: nearest-occurrence word-range repair */ nearestRange?: boolean} = {}): ResolvedPlan {
  const fps = opts.fps ?? 30;
  const fallbackPlan = () => buildFallbackPlan({words, shots, reason: 'recovery', fps, ...(opts.plate ? {plate: opts.plate} : {}), ...(opts.capabilities ? {capabilities: opts.capabilities} : {})}).plan;
  const provenanceOf = (plan: KineticPlan, origin: EventProvenance['origin']): Record<string, EventProvenance> => Object.fromEntries(plan.events.map(e => [e.id, {eventId: e.id, origin, repairs: []}]));
  const fallback = (reason: string, rejected: RejectedEvent[] = [], decisions: SolverDecision[] = []): ResolvedPlan => {
    const plan = fallbackPlan();
    return {plan, source: 'fallback', reason, provenance: provenanceOf(plan, 'fallback'), ...(rejected.length ? {rejected} : {}), ...(decisions.length ? {decisions} : {})};
  };
  if (raw === undefined || raw === null) return fallback(upstreamReason ?? 'no_director_plan');
  try {
    const rawEvents = typeof raw === 'object' && Array.isArray((raw as {events?: unknown}).events) ? ((raw as {events: unknown[]}).events) : null;
    if (!rawEvents) {
      const p = parseKineticPlan(raw);
      return fallback(p.ok ? 'schema: events: expected an array' : `schema: ${p.reason}`);
    }
    // the envelope alone (version / style / fontPair / unknown top-level keys) must be valid
    const env = kineticPlanSchema.safeParse({...(raw as object), events: []});
    if (!env.success) return fallback(`schema: ${issuesOf(env.error, '')}`);
    const envelope = env.data;

    const decisions: SolverDecision[] = [];
    const rejected: RejectedEvent[] = [];
    const repairsOf = new Map<string, string[]>();
    const kept: TextEvent[] = [];
    const seenIds = new Set<string>();
    const shotIds = new Set(shots.map(s => s.id));
    const MAX_EVENTS = 64;
    const reject = (eventId: string, code: string, reason: string, rawEv: unknown, wordRange?: [number, number]) => {
      rejected.push({eventId, code, reason, ...(wordRange ? {wordRange} : {})});
      decisions.push({eventId, stage: 'accept', kind: 'dropped', field: 'event', requested: brief(rawEv), produced: null, code: `dropped.${code}`, reason, constraint: 'hard'});
    };

    rawEvents.forEach((rawEv, i) => {
      const guess = rawEv && typeof rawEv === 'object' && typeof (rawEv as {id?: unknown}).id === 'string' ? (rawEv as {id: string}).id : `events.${i}`;
      if (i >= MAX_EVENTS) { reject(guess, 'too_many_events', `more than ${MAX_EVENTS} events: this one was not read`, rawEv); return; }
      const parsed = textEventSchema.safeParse(rawEv);
      if (!parsed.success) { reject(guess, 'schema', `schema: ${issuesOf(parsed.error, `events.${i}`)}`, rawEv); return; }
      let ev: TextEvent = parsed.data;
      const repairs: string[] = [];
      if (seenIds.has(ev.id)) { const id2 = `${ev.id.slice(0, 58)}~${i}`; repairs.push(`duplicate id ${ev.id} -> ${id2}`); ev = {...ev, id: id2}; }
      if (!isKnownPreset(ev.preset)) { reject(ev.id, 'unknown_preset', `unknown preset ${ev.preset}`, rawEv); return; }
      const [a0, b0] = ev.wordRange;
      const rangeOk = a0 <= b0 && b0 < words.length;
      if (!shotIds.has(ev.shotId)) {
        const fix = rangeOk ? shotOfFrame(shots, words[a0]!.startFrame) : undefined;
        if (!fix) { reject(ev.id, 'unknown_shot', `unknown shotId ${ev.shotId}`, rawEv, rangeOk ? [a0, b0] : undefined); return; }
        repairs.push(`shotId ${ev.shotId} -> ${fix.id}`);
        decisions.push({eventId: ev.id, stage: 'accept', kind: 'adjusted', field: 'shotId', requested: ev.shotId, produced: fix.id, code: 'adjusted.shot_id', reason: 'the shot id does not exist: the shot containing the first spoken word was used', constraint: 'hard'});
        ev = {...ev, shotId: fix.id};
      }
      if (!rangeOk) { reject(ev.id, 'range_outside_transcript', `transcript fidelity: ${ev.id}: wordRange [${a0},${b0}] outside transcript (${words.length} words)`, rawEv); return; }
      const fixed = repairTranscriptFidelity({version: '1', events: [ev]}, words, opts.nearestRange ? {nearest: true} : {}).events[0];
      if (!fixed) { reject(ev.id, 'no_grounded_words', 'transcript fidelity: no grounded events', rawEv, [a0, b0]); return; }
      if (fixed.wordRange[0] !== a0 || fixed.wordRange[1] !== b0) {
        repairs.push(`wordRange [${a0},${b0}] -> [${fixed.wordRange[0]},${fixed.wordRange[1]}]`);
        decisions.push({eventId: ev.id, stage: 'accept', kind: 'adjusted', field: 'wordRange', requested: [a0, b0], produced: fixed.wordRange, code: 'adjusted.word_range', reason: 'the range was moved to cover the words the lines actually spell', constraint: 'discretionary'});
      }
      const before = ev.lines.map(l => l.text).join(' | '), after = fixed.lines.map(l => l.text).join(' | ');
      if (before !== after) {
        const spoken = new Set(words.slice(Math.max(0, a0 - 8), Math.min(words.length, b0 + 9)).map(w => normToken(w.text)));
        const ungrounded = ev.lines.flatMap(l => l.text.split(/\s+/).map(normToken).filter(Boolean)).filter(t => !spoken.has(t));
        repairs.push(ungrounded.length ? `removed words not spoken here: ${ungrounded.join(' ')}` : 'cut to the headline word cap');
        decisions.push({eventId: ev.id, stage: 'accept', kind: 'trimmed', field: 'lines', requested: ev.lines.map(l => l.text), produced: fixed.lines.map(l => l.text), code: ungrounded.length ? 'trimmed.ungrounded_words' : 'trimmed.headline_cap', reason: ungrounded.length ? `words not in the transcript were removed: ${ungrounded.join(' ')}` : 'a headline block holds a limited number of spoken units: the earliest words were cut', constraint: ungrounded.length ? 'hard' : 'discretionary'});
      }
      const fid = transcriptFidelity({version: '1', events: [fixed]}, words);
      if (fid.length) { reject(fixed.id, 'invented_words', `transcript fidelity: ${fid[0]}`, rawEv, [a0, b0]); return; }
      seenIds.add(fixed.id);
      if (repairs.length) repairsOf.set(fixed.id, repairs);
      kept.push(fixed);
    });

    if (rawEvents.length > 0 && kept.length === 0) return fallback(rejected[0]!.reason, rejected, decisions);

    // a match cut outside the four legal moments (or a second one) is dropped, not a reason to throw anything away; it is NOT refilled (the drop is the intent)
    const mc = sanitizeMatchCuts({version: '1', style: envelope.style, ...(envelope.fontPair ? {fontPair: envelope.fontPair} : {}), events: kept}, words, fps);
    for (const d of mc.dropped) decisions.push({eventId: d.eventId, stage: 'accept', kind: 'dropped', field: 'event', requested: 'type.matchCut', produced: null, code: 'dropped.match_cut', reason: d.reason, constraint: 'discretionary'});
    const survivors = mc.plan.events;

    // fill ONLY where an invalid event stood, from the fallback planner, and never over a kept event
    const fills = rejected.length ? fillsFor(rejected, fallbackPlan().events, survivors, words) : new Map<string, TextEvent[]>();
    const fillEvents: TextEvent[] = [];
    const provenance: Record<string, EventProvenance> = {};
    const taken = new Set(survivors.map(e => e.id));
    for (const [rejectedId, evs] of fills) {
      for (const f of evs) {
        let id = `fb-${f.id}`.slice(0, 64);
        while (taken.has(id)) id = `${id.slice(0, 60)}~x`;
        taken.add(id);
        if (survivors.length + fillEvents.length >= MAX_EVENTS) break;
        fillEvents.push({...f, id});
        provenance[id] = {eventId: id, origin: 'fallback', repairs: [], replaces: rejectedId};
        decisions.push({eventId: id, stage: 'accept', kind: 'replaced', field: 'event', requested: `director event ${rejectedId}`, produced: `fallback event ${id}`, code: 'replaced.invalid_event_fill', reason: `the director event ${rejectedId} was invalid: the deterministic planner filled its words`, constraint: 'hard'});
      }
    }
    for (const e of survivors) provenance[e.id] = {eventId: e.id, origin: repairsOf.has(e.id) ? 'director_repaired' : 'director', repairs: repairsOf.get(e.id) ?? []};
    const events = [...survivors, ...fillEvents].sort((x, y) => x.wordRange[0] - y.wordRange[0] || x.wordRange[1] - y.wordRange[1]);
    const plan: KineticPlan = {version: '1', style: envelope.style, ...(envelope.fontPair ? {fontPair: envelope.fontPair} : {}), events};
    const notes = [...mc.dropped.map(d => `${d.eventId}: ${d.reason}`)];
    const dens = densityViolations(plan, words, fps);
    if (dens.length) notes.push(`density: ${dens.length} rule(s) for the solver to enforce (first: ${dens[0]})`);
    const partial = rejected.length > 0;
    if (partial) notes.push(`partial: ${rejected.length} director event(s) rejected, ${fillEvents.length} fallback fill(s), ${survivors.length} director event(s) kept`);
    return {plan, source: 'director', provenance, ...(rejected.length ? {rejected} : {}), ...(decisions.length ? {decisions} : {}), ...(partial ? {partial: true} : {}), ...(notes.length ? {notes} : {})};
  } catch (err) {
    return fallback(`exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}
