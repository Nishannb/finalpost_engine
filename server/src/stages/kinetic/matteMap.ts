/**
 * Phase 5 (RVM integration): the person matte, decoded on the SOURCE timeline, mapped into the coordinates the solver works in: COMPOSITION fractions at OUTPUT frames.
 *
 * The renderer draws the speaker (and the matte foreground, through the same VideoTrack) as: output frame n of keep segment i shows source frame `trimBefore_i + (n - from_i)` at the composition
 * fps (remotion/src/lib/timeline.ts `segmentFrames`, copied below and parity-tested), cover-fitted with `objectPosition`, then the punch-in zoom (`zoomAffine`, the same copy the speaker geometry uses).
 * The matte is produced on a constant-frame-rate copy of the source at the COMPOSITION fps, so matte frame k is exactly the source picture the renderer shows for source frame index k (also for
 * variable-frame-rate sources). Every composition cell is mapped back through zoom^-1 and cover^-1 to a source position and read from that matte frame. Nothing is approximated a second time.
 *
 * Pure: no I/O. The decode lives in pipeline/kineticMatteStage.ts.
 */
import type {AlphaGrid, Box} from './scene.ts';
import {activeZoomAt, zoomAffine, type ZoomTriggerLite} from './zoomTrack.ts';

export type KeepSegmentLite = {sourceStart: number; sourceEnd: number; outputStart: number};
export type PlacedSegment = {from: number; durationInFrames: number; trimBefore: number; trimAfter: number};

const secToFrame = (seconds: number, fps: number): number => Math.round(Math.max(0, seconds) * fps);
const framesBetween = (a: number, b: number, fps: number): number => Math.max(1, Math.round((b - a) * fps));

/** Copy of remotion/src/lib/timeline.ts `segmentFrames` (parity test: matteMap.test.ts). */
export function placedSegments(segments: readonly KeepSegmentLite[], fps: number): PlacedSegment[] {
  return segments.map((segment, index) => {
    const from = secToFrame(segment.outputStart, fps);
    const trimBefore = secToFrame(segment.sourceStart, fps);
    const natural = framesBetween(segment.sourceStart, segment.sourceEnd, fps);
    const next = segments[index + 1];
    let durationInFrames = natural;
    if (!next) {
      const available = Math.ceil(Math.max(0, segment.sourceEnd) * fps - 1e-6) - trimBefore;
      durationInFrames = Math.max(1, Math.min(natural, available));
    } else {
      const toNext = secToFrame(next.outputStart, fps) - from;
      if (toNext >= 1 && Math.abs(toNext - natural) <= 1) durationInFrames = toNext;
    }
    return {from, durationInFrames, trimBefore, trimAfter: trimBefore + durationInFrames};
  });
}

/** The source frame index (at the composition fps) the renderer shows at output frame `n`, or null when no segment covers it. The LAST covering segment wins (later Sequences paint on top). */
export function sourceFrameAt(placed: readonly PlacedSegment[], n: number): number | null {
  let hit: number | null = null;
  for (const p of placed) if (n >= p.from && n < p.from + p.durationInFrames) hit = p.trimBefore + (n - p.from);
  return hit;
}

/** Source alpha decoded on the composition-fps grid: frame k = source time k / fps; `cols` x `rows` bytes per frame (0..255) over the WHOLE source frame. */
export type SourceAlphaFrames = {cols: number; rows: number; frames: ReadonlyArray<Uint8Array>};

export type CompositionMatteGeometry = {
  srcW: number;
  srcH: number;
  outW: number;
  outH: number;
  /** cover object-position 0..1 (the fullscreen speaker: 0.5, 0.42) */
  objectPosition: {x: number; y: number};
  zoomTriggers: readonly ZoomTriggerLite[];
  zoomEnabled: boolean;
  keepSegments: readonly KeepSegmentLite[];
  fps: number;
  durationFrames: number;
};

export type CompositionMatte = {
  grid: AlphaGrid;
  /** mean covered fraction of the composition over the sampled frames */
  alphaAreaFrac: number;
  /** union of the per-sample person boxes (composition fractions) */
  unionBox: Box | null;
  samples: number;
  /** sampled output frames whose source frame has no matte frame (beyond the decoded matte) */
  missing: number;
  /** sampled output frames where the matte is empty (no person) */
  empty: number;
};

export const MATTE_GRID_COLS = 36;
export const MATTE_GRID_ROWS = 64;
/** sub-samples per composition cell edge (2 x 2 points, mean >= 0.5 = covered) */
const SUB = 2;

/**
 * Map the source matte into composition fractions at output frames `0, step, 2*step, ...` (default every 3rd frame = 10 per second at 30 fps). A cell is covered when the mean alpha of its
 * sub-sample points (each read from the source position the renderer draws there) is >= 0.5. Points that fall outside the source picture (cover crop / zoom) read 0.
 */
export function compositionMatte(src: SourceAlphaFrames, geo: CompositionMatteGeometry, opts: {cols?: number; rows?: number; stepFrames?: number} = {}): CompositionMatte {
  const cols = opts.cols ?? MATTE_GRID_COLS, rows = opts.rows ?? MATTE_GRID_ROWS, step = Math.max(1, Math.floor(opts.stepFrames ?? 3));
  const placed = placedSegments(geo.keepSegments, geo.fps);
  const s = Math.max(geo.outW / geo.srcW, geo.outH / geo.srcH);
  const dispW = geo.srcW * s, dispH = geo.srcH * s;
  const offX = (geo.outW - dispW) * geo.objectPosition.x, offY = (geo.outH - dispH) * geo.objectPosition.y;
  const samples: AlphaGrid['samples'] = [];
  let areaSum = 0, missing = 0, empty = 0;
  let ux0 = 1, uy0 = 1, ux1 = 0, uy1 = 0;
  for (let n = 0; n < geo.durationFrames; n += step) {
    const k = sourceFrameAt(placed, n);
    const frame = k === null ? undefined : src.frames[k];
    if (!frame) { missing += 1; continue; }
    const z = geo.zoomEnabled ? zoomAffine(activeZoomAt(geo.zoomTriggers, n / geo.fps)) : {s: 1, tx: 0, ty: 0};
    const bits = Buffer.alloc(cols * rows);
    let cov = 0, minX = cols, minY = rows, maxX = -1, maxY = -1;
    for (let cy = 0; cy < rows; cy += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        let acc = 0;
        for (let j = 0; j < SUB; j += 1) {
          for (let i = 0; i < SUB; i += 1) {
            // composition point (fractions) -> unzoomed composition -> source fraction
            const u = (cx + (i + 0.5) / SUB) / cols, v = (cy + (j + 0.5) / SUB) / rows;
            const pu = (u - z.tx) / z.s, pv = (v - z.ty) / z.s;
            const sx = (pu * geo.outW - offX) / dispW, sy = (pv * geo.outH - offY) / dispH;
            if (sx < 0 || sx >= 1 || sy < 0 || sy >= 1) continue;
            acc += frame[Math.floor(sy * src.rows) * src.cols + Math.floor(sx * src.cols)]!;
          }
        }
        if (acc / (SUB * SUB) >= 127.5) {
          bits[cy * cols + cx] = 255; cov += 1;
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        }
      }
    }
    if (cov === 0) empty += 1;
    else { ux0 = Math.min(ux0, minX / cols); uy0 = Math.min(uy0, minY / rows); ux1 = Math.max(ux1, (maxX + 1) / cols); uy1 = Math.max(uy1, (maxY + 1) / rows); }
    areaSum += cov / (cols * rows);
    samples.push({frame: n, bits: bits.toString('base64')});
  }
  return {
    grid: {cols, rows, samples},
    alphaAreaFrac: samples.length ? areaSum / samples.length : 0,
    unionBox: ux1 > ux0 && uy1 > uy0 ? {x: ux0, y: uy0, w: ux1 - ux0, h: uy1 - uy0} : null,
    samples: samples.length,
    missing,
    empty,
  };
}

/**
 * Output-frame windows `[inFrame, outFrame + 1)` of the events with a line drawn BEHIND the person: the renderer's rule (KineticTrack `hasLayer`: `(line.layer ?? event.layering) === 'behind'`; an
 * event is drawn for `inFrame <= frame <= outFrame`, inclusive).
 */
export function behindWindows(events: ReadonlyArray<{layering?: string; inFrame: number; outFrame: number; lines?: ReadonlyArray<{layer?: string | null}>}>): Array<{inFrame: number; outFrame: number}> {
  return events.filter(e => (e.lines ?? []).some(l => (l.layer ?? e.layering) === 'behind')).map(e => ({inFrame: e.inFrame, outFrame: e.outFrame + 1}));
}

/**
 * Foreground spans (output SECONDS) for `blueprint.subjectForeground`: the behind windows padded by `padFrames`, merged, clipped to the composition. The renderer draws the foreground only inside
 * these spans and draws EVERY behind event behind it whenever a foreground exists, so every behind window must lie inside a span (`spansCover` checks it).
 */
export function foregroundSpans(windows: ReadonlyArray<{inFrame: number; outFrame: number}>, fps: number, durationFrames: number, padFrames = 3): Array<{start: number; end: number}> {
  const w = windows.map(x => [Math.max(0, x.inFrame - padFrames), Math.min(durationFrames, x.outFrame + padFrames)] as [number, number]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of w) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]); }
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return merged.map(([a, b]) => ({start: r6(a / fps), end: r6(b / fps)}));
}

/** True when every frame of every behind window is inside a span (the renderer's rule: `start <= t < end` at t = frame / fps). */
export function spansCover(spans: ReadonlyArray<{start: number; end: number}>, windows: ReadonlyArray<{inFrame: number; outFrame: number}>, fps: number): boolean {
  return windows.every(w => {
    for (let f = w.inFrame; f < w.outFrame; f += 1) { const t = f / fps; if (!spans.some(s => t >= s.start && t < s.end)) return false; }
    return true;
  });
}

/** The matte must exist for every frame the foreground is drawn: a span frame whose source frame lies beyond the decoded matte would draw no person over behind text. */
export function matteCoversSpans(placed: readonly PlacedSegment[], spans: ReadonlyArray<{start: number; end: number}>, fps: number, matteFrames: number): boolean {
  return spans.every(s => {
    for (let f = Math.round(s.start * fps); f < Math.round(s.end * fps); f += 1) { const k = sourceFrameAt(placed, f); if (k !== null && k >= matteFrames) return false; }
    return true;
  });
}

/**
 * Render-time safety (stages/render/prefetchAssets.ts): when the person foreground did not survive prefetch, the renderer would draw every behind line IN FRONT, where the solver placed it to be
 * covered by the person (over the face). Such events are removed (the same rule the template path applies to its host-composited heroes). Specs without behind lines are returned unchanged.
 */
export function withoutBehindEvents<T extends {events: ReadonlyArray<{layering?: string; lines?: ReadonlyArray<{layer?: string | null}>}>}>(spec: T): {spec: T; dropped: number} {
  const keep = spec.events.filter(e => !(e.lines ?? []).some(l => (l.layer ?? e.layering) === 'behind'));
  return keep.length === spec.events.length ? {spec, dropped: 0} : {spec: {...spec, events: keep}, dropped: spec.events.length - keep.length};
}
