/**
 * Final freeze (approved after the Phase 4.9 visual sign-off): an event that cannot hold its readability floor is handed to the readable running line
 * (productionStage.ts, `replaced.below_floor_to_running_line`). The running line used to draw every word white, so the Director's payoff word (the
 * "follow" of "follow for part two", the "life" of "three things changed my life") lost all emphasis. This module keeps exactly that emphasis and nothing else:
 *
 *  - `payoffAccents`: the words the SOLVER drew in the event's accent colour (playbook.ts colours the first hero line, else the first punch line, and a peer
 *    list's heroes / supports; every other word is #FFFFFF). Hero / punch lines are read first; only when none is accented is an accented support line read,
 *    which is the approved editorial emphasis line (a serif hero demoted to the support scale that keeps its accent). Connectors are never read.
 *  - `carryPayoffAccents`: on the running-line fill that now draws those words, the matching word gets that colour (solid fill only). Size, face, timing,
 *    order, placement and every other word are untouched. It runs BEFORE verification, so the verifier still checks the final colours.
 *
 * Contrast policy (approved at the freeze): the accent is kept ONLY when the running line already carries the solver's existing separation treatment, an
 * outline (`shadow.strokePx > 0`, which playbook.ts adds exactly when white measures below CONTRAST_MIN on the plate) or a glow (`shadow.glowPx > 0`).
 * Without it the payoff word stays WHITE: on pale clothing a coloured fill with only the soft drop shadow measured 1.04-1.46:1 locally (white 1.51-1.90:1).
 * No outline, glow or shadow is added here, and no contrast is measured here.
 *
 * Pure. No threshold, size or face-protection rule is read or changed here.
 */
import type {ShotScene} from './scene.ts';
import type {KineticWord, RenderEvent, RenderSpec} from './schema.ts';
import {normToken} from './transcript.ts';

const WHITE = /^#ffffff$/i;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Word index -> accent colour of the payoff word(s) the solved event drew in its accent. Empty when the event drew no accent. */
export function payoffAccents(ev: Pick<RenderEvent, 'wordRange' | 'lines'>, words: ReadonlyArray<KineticWord>): Map<number, string> {
  const out = new Map<number, string>();
  const coloured = (l: (typeof ev.lines)[number]) => HEX.test(l.color) && !WHITE.test(l.color);
  // the hero / punch the solver accented; when there is none, the approved editorial emphasis line (a serif hero demoted to the support scale, `replaced.hero_serif_emphasis`, which keeps the accent)
  let accented = ev.lines.filter(l => (l.role === 'hero' || l.role === 'punch') && coloured(l));
  if (accented.length === 0) accented = ev.lines.filter(l => l.role === 'support' && coloured(l));
  if (accented.length === 0) return out;
  // a per-letter treatment draws one line per LETTER: only the joined letters name the word (a single letter must never match a one-letter word such as "i")
  const perLetter = accented.length > 1 && accented.every(l => normToken(l.text).length <= 1);
  const byToken = new Map<string, string>();
  if (!perLetter) for (const l of accented) for (const t of l.text.split(/\s+/).map(normToken).filter(Boolean)) if (!byToken.has(t)) byToken.set(t, l.color);
  const joined = accented.map(l => normToken(l.text.replace(/\s+/g, ''))).join('');
  for (let i = ev.wordRange[0]; i <= ev.wordRange[1] && i < words.length; i += 1) {
    const t = normToken(words[i]!.text);
    if (!t) continue;
    const c = byToken.get(t) ?? (t.length >= 3 && joined.includes(t) ? accented[0]!.color : undefined);
    if (c) out.set(i, c);
  }
  return out;
}

/** The running-line word index each line of a fill event draws (lines are the fill's words in order; an unmatched line gets -1). */
function lineWordIdx(ev: Pick<RenderEvent, 'wordRange' | 'lines'>, words: ReadonlyArray<KineticWord>): number[] {
  let w = ev.wordRange[0];
  return ev.lines.map(l => {
    const t = normToken(l.text);
    for (let i = w; i <= ev.wordRange[1] && i < words.length; i += 1) if (normToken(words[i]!.text) === t) { w = i + 1; return i; }
    return -1;
  });
}

export type CarriedAccent = {eventId: string; wordIdx: number; text: string; color: string};

/**
 * Apply the carried payoff colours to the RUNNING lines that draw those words. Only running-only events are touched (the coverage fill); a Director event
 * is never recoloured. Returns the spec unchanged (same object) when nothing applies.
 */
export function carryPayoffAccents(spec: RenderSpec, carried: ReadonlyMap<number, string>, words: ReadonlyArray<KineticWord>, _scenes?: Readonly<Record<string, ShotScene>>): {spec: RenderSpec; applied: CarriedAccent[]; keptWhite: CarriedAccent[]} {
  const applied: CarriedAccent[] = [], keptWhite: CarriedAccent[] = [];
  if (carried.size === 0) return {spec, applied, keptWhite};
  let changed = false;
  const events = spec.events.map(ev => {
    if (!ev.lines.every(l => l.role === 'running')) return ev;
    if (![...carried.keys()].some(i => i >= ev.wordRange[0] && i <= ev.wordRange[1])) return ev;
    const idx = lineWordIdx(ev, words);
    // the existing separation treatment of this running line (playbook.ts): an outline or a glow; the soft drop shadow alone is not enough
    const separated = ev.shadow.strokePx > 0 || ev.shadow.glowPx > 0;
    let evChanged = false;
    const lines = ev.lines.map((l, k) => {
      const c = idx[k]! >= 0 ? carried.get(idx[k]!) : undefined;
      if (!c || l.fill.kind !== 'solid' || l.fill.colors.length !== 1) return l;
      const rec = {eventId: ev.id, wordIdx: idx[k]!, text: l.text, color: c};
      if (!separated) { keptWhite.push(rec); return l; }
      applied.push(rec); evChanged = true;
      return {...l, color: c, fill: {...l.fill, colors: [c]}};
    });
    if (!evChanged) return ev;
    changed = true;
    return {...ev, lines};
  });
  return {spec: changed ? {...spec, events} : spec, applied, keptWhite};
}
