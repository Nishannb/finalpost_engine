/**
 * SFX on the beat, without ever covering a word. Pure. Runs after placement, on the hits polishSfx scheduled (built-in or catalog).
 *
 * Each hit snaps to the nearest bed beat within +-60 ms. The 120 ms word mask always wins over snapping: if the snapped time would land
 * within 120 ms after a word onset the unsnapped time is kept, and if that also violates the mask the hit is dropped. The cap and the minimum
 * spacing hold after snapping too (a snap can only move a hit by 60 ms, but two hits 0.8 s apart can end up 0.68 s apart).
 *
 * With a catalog `hook` entry a hit plays on frame 0 (placement puts a downbeat there). With a `cta` entry and a known CTA time it plays on the nearest
 * bar line. Both go through the same mask, spacing and cap, and have priority over the other hits for a slot.
 * No catalog entry for a cue: nothing is added. No beats (no placement): nothing is snapped.
 */

import {SFX_MAX_HITS, SFX_MIN_SPACING_SEC, SFX_WORD_MASK_SEC, type PolishSfxHit} from '../../lib/polishSfx.ts';
import type {SfxEntry} from '../../lib/sfxCatalog.ts';

export const SFX_SNAP_WINDOW_SEC = 0.06;

export type SnapStats = {input: number; snapped: number; dropped: number; hookAdded: boolean; ctaAdded: boolean};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function nearest(times: readonly number[], at: number): number | null {
  let best: number | null = null;
  for (const time of times) if (best === null || Math.abs(time - at) < Math.abs(best - at)) best = time;
  return best;
}

export function snapHitsToBeats(
  hits: readonly PolishSfxHit[],
  input: {
    beatsSec: readonly number[];
    barLinesSec?: readonly number[];
    wordOnsetsSec: readonly number[];
    durationSec: number;
    catalog?: readonly SfxEntry[];
    ctaAtSec?: number | null;
    maxHits?: number;
    minSpacingSec?: number;
  },
): {hits: PolishSfxHit[]; stats: SnapStats} {
  const maxHits = input.maxHits ?? SFX_MAX_HITS;
  const spacing = input.minSpacingSec ?? SFX_MIN_SPACING_SEC;
  const onsets = input.wordOnsetsSec.filter(Number.isFinite);
  const covers = (at: number) => onsets.some(onset => at > onset + 1e-6 && at <= onset + SFX_WORD_MASK_SEC + 1e-6);
  const stats: SnapStats = {input: hits.length, snapped: 0, dropped: 0, hookAdded: false, ctaAdded: false};
  const kept: PolishSfxHit[] = [];
  const free = (at: number) => kept.length < maxHits && !covers(at) && kept.every(hit => Math.abs(hit.at - at) >= spacing - 1e-9);

  const wants = (cue: 'hook' | 'cta') => (input.catalog ?? []).some(entry => entry.tobeused.includes(cue));
  const priority: PolishSfxHit[] = [];
  if (wants('hook')) priority.push({at: 0, kind: 'hit', reason: 'sfx_hook'});
  if (wants('cta') && input.ctaAtSec !== null && input.ctaAtSec !== undefined && Number.isFinite(input.ctaAtSec)) {
    const bar = nearest(input.barLinesSec ?? [], input.ctaAtSec);
    if (bar !== null && bar <= input.durationSec) priority.push({at: round3(bar), kind: 'hit', reason: 'sfx_cta'});
  }
  for (const hit of priority) {
    if (free(hit.at)) {
      kept.push(hit);
      if (hit.reason === 'sfx_hook') stats.hookAdded = true;
      else stats.ctaAdded = true;
    }
  }

  const ordered = [...hits].sort((a, b) => a.at - b.at);
  for (const [index, hit] of ordered.entries()) {
    const beat = input.beatsSec.length > 0 ? nearest(input.beatsSec, hit.at) : null;
    let snapped = beat !== null && Math.abs(beat - hit.at) <= SFX_SNAP_WINDOW_SEC && beat >= 0 && beat <= input.durationSec ? round3(beat) : null;
    // A snap must not cost the next hit its slot: when the two were far enough apart, keep them that far apart.
    const next = ordered[index + 1];
    if (snapped !== null && next && next.at - hit.at >= spacing - 1e-9 && next.at - snapped < spacing - 1e-9) snapped = null;
    if (snapped !== null && snapped !== hit.at && free(snapped)) {
      kept.push({...hit, at: snapped, reason: `${hit.reason ?? 'hit'}|beat`});
      stats.snapped += 1;
    } else if (free(hit.at)) {
      kept.push(hit);
    } else {
      stats.dropped += 1;
    }
  }
  kept.sort((a, b) => a.at - b.at);
  return {hits: kept, stats};
}
