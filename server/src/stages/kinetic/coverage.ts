/**
 * Word coverage: "the typography track owns the spoken words, so every spoken word must be represented".
 *
 * For each transcript word: is it drawn by a lockup line (type.words / matchCut text of the event that owns its index), by a gap caption, or by nothing (and why)?
 * Pure. Used by the production stage (policy), the benchmark and the tests; it never changes a spec.
 */
import {drawnWordIdx as drawnIdx} from './coverageFill.ts';
import type {KineticWord, RenderSpec} from './schema.ts';
import {normToken} from './transcript.ts';

export type WordCoverageKind = 'lockup' | 'gap_caption' | 'missing';
export type MissingWhy = 'too_short_for_gap_caption' | 'spoken_under_lockup' | 'not_in_any_line' | 'no_room';

export type WordCoverage = {idx: number; text: string; kind: WordCoverageKind; eventId?: string; why?: MissingWhy};
export type CoverageReport = {
  words: number;
  lockup: number;
  gapCaption: number;
  missing: number;
  /** share of words drawn by something, 0..1 */
  coveredFraction: number;
  byWhy: Partial<Record<MissingWhy, number>>;
  perWord: WordCoverage[];
};

export function wordCoverage(spec: RenderSpec, words: KineticWord[]): CoverageReport {
  const lockup = new Map<number, string>();
  for (const ev of spec.events) for (const i of drawnIdx(ev, words)) if (!lockup.has(i)) lockup.set(i, ev.id);
  const gap = new Set(spec.captions.map(g => g.wordIdx));
  const perWord: WordCoverage[] = words.map(w => {
    const ev = lockup.get(w.idx);
    if (ev !== undefined) return {idx: w.idx, text: w.text, kind: 'lockup', eventId: ev};
    if (gap.has(w.idx)) return {idx: w.idx, text: w.text, kind: 'gap_caption'};
    let why: MissingWhy = 'no_room';
    if (normToken(w.text).length <= 2) why = 'too_short_for_gap_caption';
    else if (spec.events.some(e => w.startFrame >= e.inFrame && w.startFrame < e.outFrame)) why = spec.events.some(e => w.idx >= e.wordRange[0] && w.idx <= e.wordRange[1]) ? 'not_in_any_line' : 'spoken_under_lockup';
    return {idx: w.idx, text: w.text, kind: 'missing', why};
  });
  const byWhy: CoverageReport['byWhy'] = {};
  for (const p of perWord) if (p.why) byWhy[p.why] = (byWhy[p.why] ?? 0) + 1;
  const n = (k: WordCoverageKind) => perWord.filter(p => p.kind === k).length;
  const covered = n('lockup') + n('gap_caption');
  return {words: words.length, lockup: n('lockup'), gapCaption: n('gap_caption'), missing: n('missing'), coveredFraction: words.length ? covered / words.length : 1, byWhy, perWord};
}
