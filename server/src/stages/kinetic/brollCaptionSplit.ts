/**
 * Kinetic + creator B-roll caption ownership (pure, no I/O).
 *
 * Rule: Kinetic type owns TALKING-HEAD time only. While a full-frame creator B-roll cutaway is on screen the only
 * text is the simple caption track (the blueprint's ordinary captions), never a kinetic event, and never both on
 * the same words. The caller derives the windows from the placed overlays, then:
 *   1. splitKineticSpecForBroll  -> drops kinetic events / gap captions that touch a B-roll window,
 *   2. kineticCaptionMuteRanges  -> mutes the ordinary captions everywhere EXCEPT those windows.
 */
import type {RenderSpec} from './schema.ts';

export type BrollWindow = {start: number; end: number};
type OverlayLike = {start: number; end: number; layout: string};

/** Layouts that cover the whole frame (the picture is the B-roll, the talking head is hidden). */
const FULL_FRAME_LAYOUTS: ReadonlySet<string> = new Set(['cutaway', 'split', 'composite']);

/** Output-time windows covered by full-frame overlays, merged. */
export function brollCoverageWindows(overlays: readonly OverlayLike[] | null | undefined): BrollWindow[] {
  const sorted = (overlays ?? [])
    .filter(overlay => FULL_FRAME_LAYOUTS.has(overlay.layout) && overlay.end > overlay.start)
    .map(overlay => ({start: overlay.start, end: overlay.end}))
    .sort((a, b) => a.start - b.start);
  const merged: BrollWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else merged.push({...window});
  }
  return merged;
}

const touches = (aStart: number, aEnd: number, windows: readonly BrollWindow[]) => windows.some(w => aStart < w.end && aEnd > w.start);

export type KineticBrollSplit = {spec: RenderSpec; droppedEvents: number; droppedCaptions: number; warnings: string[]};

/** B-roll wins: any kinetic event or gap caption overlapping a B-roll window is removed. No windows = the spec untouched (same object). */
export function splitKineticSpecForBroll(spec: RenderSpec, windows: readonly BrollWindow[]): KineticBrollSplit {
  if (windows.length === 0) return {spec, droppedEvents: 0, droppedCaptions: 0, warnings: []};
  const events = spec.events.filter(event => !touches(event.inFrame / event.fps, event.outFrame / event.fps, windows));
  const captions = spec.captions.filter(caption => !touches(caption.inFrame / spec.fps, caption.outFrame / spec.fps, windows));
  // Kinetic Composer scene elements (plates / shapes / counters) belong to the type: they go with it
  const scene = spec.scene?.filter(el => !touches(el.inFrame / spec.fps, el.outFrame / spec.fps, windows));
  const droppedEvents = spec.events.length - events.length;
  const droppedCaptions = spec.captions.length - captions.length;
  const droppedScene = (spec.scene?.length ?? 0) - (scene?.length ?? 0);
  return {
    spec: droppedEvents + droppedCaptions + droppedScene === 0 ? spec : {...spec, events, captions, ...(spec.scene ? {scene} : {})},
    droppedEvents,
    droppedCaptions,
    warnings: [`kinetic_broll:windows=${windows.length},events_dropped=${droppedEvents},gap_captions_dropped=${droppedCaptions}`],
  };
}

/** Ordinary captions are muted for the whole edit (Kinetic owns the words) EXCEPT inside the B-roll windows. */
export function kineticCaptionMuteRanges(windows: readonly BrollWindow[], durationSec: number): Array<{startSec: number; endSec: number}> {
  if (windows.length === 0) return [{startSec: 0, endSec: durationSec}];
  const ranges: Array<{startSec: number; endSec: number}> = [];
  let cursor = 0;
  for (const window of windows) {
    if (window.start > cursor) ranges.push({startSec: cursor, endSec: Math.min(window.start, durationSec)});
    cursor = Math.max(cursor, window.end);
  }
  if (cursor < durationSec) ranges.push({startSec: cursor, endSec: durationSec});
  return ranges.filter(range => range.endSec > range.startSec);
}
