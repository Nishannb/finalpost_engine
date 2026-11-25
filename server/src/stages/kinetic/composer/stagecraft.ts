/**
 * P4 Stagecraft: the camera answers the type. Punch-in zooms are planned on the designed beats that hit hardest (a giant word, a counter, a contrast landing, the call to action),
 * at most one every few seconds and never on a takeover card (the card hides the speaker anyway). Existing directed zooms are kept where they do not collide. The zooms are decided
 * BEFORE the type is solved so every placement clears the zoomed face (the speaker geometry is rebuilt with the final zoom list).
 */
import type {CompositionName} from './types.ts';

export type ComposerZoom = {start: number; end: number; scale: number; focus?: {x: number; y: number}; sentenceIndex: number};

const PUNCH: ReadonlySet<CompositionName> = new Set(['giantWord', 'counterStat', 'contrastSplit', 'ctaCard', 'wordSwap', 'heroStack', 'markerHighlight']);
export const ZOOM_MIN_SPACING_SEC = 4.5;
export const ZOOM_MAX_SHARE = 0.32;

export function planPunchIns(input: {
  designed: ReadonlyArray<{startSec: number; endSec: number; intensity: number; composition: CompositionName; sentenceIndex: number}>;
  existing: ReadonlyArray<ComposerZoom>;
  durationSec: number;
  focus?: {x: number; y: number};
  energy: number;
}): {zooms: ComposerZoom[]; added: number; keptExisting: number} {
  const takeovers = input.designed.filter(d => d.composition === 'takeover');
  const clash = (s: number, e: number, list: ReadonlyArray<{start: number; end: number}>, pad: number) => list.some(z => s < z.end + pad && e > z.start - pad);
  const kept = input.existing.filter(z => !takeovers.some(t => z.start < t.endSec && z.end > t.startSec));
  const out: ComposerZoom[] = [...kept];
  const budget = input.durationSec * ZOOM_MAX_SHARE;
  let used = kept.reduce((s, z) => s + (z.end - z.start), 0);
  const candidates = input.designed.filter(d => PUNCH.has(d.composition) && d.intensity >= 0.66 - 0.1 * input.energy).sort((a, b) => b.intensity - a.intensity);
  let added = 0;
  for (const c of candidates) {
    const start = Math.max(0, c.startSec - 0.05);
    const end = Math.min(input.durationSec, Math.max(c.endSec, start + 0.9));
    if (end - start > 3.2) continue;
    if (used + (end - start) > budget) continue;
    if (clash(start, end, out.map(z => ({start: z.start, end: z.end})), ZOOM_MIN_SPACING_SEC - 1)) continue;
    const scale = Math.round((1.08 + 0.12 * c.intensity * (0.6 + 0.4 * input.energy)) * 100) / 100;
    out.push({start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, scale, ...(input.focus ? {focus: input.focus} : {}), sentenceIndex: c.sentenceIndex});
    used += end - start;
    added += 1;
  }
  out.sort((a, b) => a.start - b.start);
  return {zooms: out, added, keptExisting: kept.length};
}
