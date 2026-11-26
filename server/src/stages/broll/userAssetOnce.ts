/**
 * 2026-11-26: creator assets are used ONCE per edit, and the time spans the Kinetic person matte is drawn over are merged. Pure.
 */
/** Merge overlapping / touching [start, end) spans (output seconds). */
export function mergeSpans(spans: ReadonlyArray<{start: number; end: number}>): Array<{start: number; end: number}> {
  const sorted = [...spans].filter(span => span.end > span.start).sort((a, b) => a.start - b.start);
  const out: Array<{start: number; end: number}> = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end + 1e-6) last.end = Math.max(last.end, span.end);
    else out.push({start: span.start, end: span.end});
  }
  return out;
}

/** Keep only the earliest placement of each creator asset (provider `user`, same URL) across clips and overlays; slideshows count every slide. */
export function useEachUserAssetOnce<C extends {start: number; provider?: string; assetUrl?: string}, O extends {start: number; provider?: string; assetUrl?: string; slides?: ReadonlyArray<{assetUrl?: string}>}>(clips: readonly C[], overlays: readonly O[]): {clips: C[]; overlays: O[]; removed: number} {
  const items = [...clips.map(item => ({kind: 'clip' as const, item})), ...overlays.map(item => ({kind: 'overlay' as const, item}))].sort((a, b) => a.item.start - b.item.start);
  const seen = new Set<string>();
  const drop = new Set<unknown>();
  for (const {item} of items) {
    if (item.provider !== 'user') continue;
    const urls = [item.assetUrl, ...(((item as O).slides ?? []).map(slide => slide.assetUrl))].map(url => (url ?? '').trim()).filter(Boolean);
    if (urls.length === 0) continue;
    if (urls.some(url => seen.has(url))) drop.add(item);
    else urls.forEach(url => seen.add(url));
  }
  return {clips: clips.filter(item => !drop.has(item)), overlays: overlays.filter(item => !drop.has(item)), removed: drop.size};
}
