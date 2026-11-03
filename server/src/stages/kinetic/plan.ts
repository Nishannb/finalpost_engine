/** Plan acceptance: a raw director answer becomes a valid, grounded, density-clean KineticPlan or the deterministic fallback (with the reason recorded). Never throws. */
import {buildFallbackPlan, densityViolations, transcriptFidelity, type PlateInfo} from './fallback.ts';
import {sanitizeMatchCuts} from './matchCut.ts';
import {isKnownPreset} from './presets.ts';
import {parseKineticPlan, type KineticPlan, type KineticShot, type TextEvent, type KineticWord} from './schema.ts';
import {normToken} from './transcript.ts';
import {MAX_HEADLINE_UNITS, MAX_PEER_UNITS, countHeadlineUnits, isPeerList} from './words.ts';

export type ResolvedPlan = {plan: KineticPlan; source: 'director' | 'fallback'; reason?: string; /** repairs applied to an accepted director plan (dropped match cuts, ...) */ notes?: string[]};

/**
 * Gemini often puts the right spoken words in `lines` but a slightly-too-narrow `wordRange`
 * (e.g. line has "know how to" while range stops before "how"). Expand the range to cover the
 * spoken tokens, then drop any token that still cannot be grounded. Keeps a near-valid director
 * plan instead of throwing away the whole LED edit for one off-by-one index.
 */
export function repairTranscriptFidelity(plan: KineticPlan, words: KineticWord[]): KineticPlan {
  const events: TextEvent[] = [];
  for (const ev of plan.events) {
    const [a0, b0] = ev.wordRange;
    const toks = ev.lines.flatMap(l => l.text.split(/\s+/).map(normToken).filter(Boolean));
    const found: number[] = [];
    let cursor = Math.max(0, Math.min(a0, words.length - 1) - 8);
    for (const tok of toks) {
      let idx = -1;
      for (let k = cursor; k < words.length; k += 1) {
        if (normToken(words[k]!.text) === tok) { idx = k; break; }
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

export function resolvePlan(raw: unknown, words: KineticWord[], shots: KineticShot[], upstreamReason?: string, opts: {fps?: number; plate?: PlateInfo} = {}): ResolvedPlan {
  const fps = opts.fps ?? 30;
  const fallback = (reason: string): ResolvedPlan => ({plan: buildFallbackPlan({words, shots, reason, fps, ...(opts.plate ? {plate: opts.plate} : {})}).plan, source: 'fallback', reason});
  if (raw === undefined || raw === null) return fallback(upstreamReason ?? 'no_director_plan');
  try {
    const parsed = parseKineticPlan(raw);
    if (!parsed.ok) return fallback(`schema: ${parsed.reason}`);
    const unknown = parsed.plan.events.find(e => !isKnownPreset(e.preset));
    if (unknown) return fallback(`unknown preset ${unknown.preset}`);
    const shotIds = new Set(shots.map(s => s.id));
    const badShot = parsed.plan.events.find(e => !shotIds.has(e.shotId));
    if (badShot) return fallback(`unknown shotId ${badShot.shotId}`);
    const grounded = repairTranscriptFidelity(parsed.plan, words);
    if (grounded.events.length === 0 && parsed.plan.events.length > 0) return fallback('transcript fidelity: no grounded events');
    // a match cut outside the four legal moments (or a second one) is dropped, not a reason to throw the whole edit away
    const mc = sanitizeMatchCuts(grounded, words, fps);
    const repaired = mc.plan;
    const fid = transcriptFidelity(repaired, words);
    if (fid.length) return fallback(`transcript fidelity: ${fid[0]}`);
    const dens = densityViolations(repaired, words, fps);
    if (dens.length) return fallback(`density: ${dens[0]}`);
    return {plan: repaired, source: 'director', ...(mc.dropped.length ? {notes: mc.dropped.map(d => `${d.eventId}: ${d.reason}`)} : {})};
  } catch (err) {
    return fallback(`exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}
