/**
 * Punch-in zoom -> a per-frame speaker box.
 *
 * In the edit renderer (remotion ShortVideo) the punch-in zoom (`ZoomFrame`) scales ONLY the speaker video layer; the kinetic track is drawn in composition space and does not zoom. So while a
 * punch-in is up the speaker's face grows and moves relative to the type: a face keep-out measured on the unzoomed box would be wrong exactly when the zoom is on. This module reproduces the
 * renderer's zoom maths (remotion/src/lib/timeline.ts `activeZoomAt` + `zoomStyleFor`, pinned by a parity test) and maps the speaker box through it, frame by frame, so the solver clears the
 * zoomed face (`ShotScene.boxTrack`; events clear the union of the boxes over their window, `boxSpan`).
 *
 * Pure. No I/O.
 */
import type {Box} from './scene.ts';
import {MIN_SPEAKER_DIM} from './speakerBox.ts';

export type ZoomTriggerLite = {start: number; end: number; scale: number; focus?: {x: number; y: number} | undefined};
export type ActiveZoom = {scale: number; focus?: {x: number; y: number}};

/** the legacy zoom origin (remotion DEFAULT_ZOOM_ORIGIN '50% 32%') */
export const DEFAULT_ZOOM_ORIGIN = {x: 0.5, y: 0.32};
export const ZOOM_IN_RAMP_SEC = 0.35;
export const ZOOM_OUT_RAMP_SEC = 1;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Copy of the renderer's `activeZoomAt` (same ramps, same winner rule). */
export function activeZoomAt(triggers: readonly ZoomTriggerLite[], timeSec: number, inRampSec = ZOOM_IN_RAMP_SEC, outRampSec = ZOOM_OUT_RAMP_SEC): ActiveZoom {
  let scale = 1;
  let focus: {x: number; y: number} | undefined;
  for (const t of triggers) {
    if (timeSec < t.start || timeSec > t.end) continue;
    const inT = easeInOut(clamp01((timeSec - t.start) / Math.max(0.05, inRampSec)));
    const outT = easeInOutCubic(clamp01((t.end - timeSec) / Math.max(0.05, outRampSec)));
    const candidate = 1 + (t.scale - 1) * Math.min(inT, outT);
    if (candidate > scale) { scale = candidate; focus = t.focus; }
  }
  return focus ? {scale, focus} : {scale};
}

/** Affine map of a composition-normalised point under the renderer's zoom: p' = s * p + t (the same maths as `zoomStyleFor`, expressed in 0..1 coordinates). */
export function zoomAffine(zoom: ActiveZoom): {s: number; tx: number; ty: number} {
  const s = zoom.scale;
  if (!(s > 1)) return {s: 1, tx: 0, ty: 0};
  if (!zoom.focus) return {s, tx: DEFAULT_ZOOM_ORIGIN.x * (1 - s), ty: DEFAULT_ZOOM_ORIGIN.y * (1 - s)};
  const centre = (f: number) => Math.min(s * f, Math.max(1 - s * (1 - f), 0.5));
  return {s, tx: centre(zoom.focus.x) - s * zoom.focus.x, ty: centre(zoom.focus.y) - s * zoom.focus.y};
}

/**
 * A composition-normalised box under a zoom (the renderer's affine map, `zoomAffine`). Phase 4.4: the result is NOT clipped vertically. The face of a speaker is the top FACE_FRACTION of the person's box, and a
 * zoom that pushes the body out of the bottom of the frame must not shorten the face with it (Phase 4.3 measured the face box 230 px short at 1.5x when the box was clipped first). So y0 / y1 keep their
 * true values (they may lie outside 0..1) and every consumer takes the face from y + FACE_FRACTION * h. Horizontally the box is clipped to the frame (the keep-out is as wide as the visible box). A box that is
 * entirely off screen is returned where it really is, not replaced by the unzoomed box.
 */
export function zoomBox(box: Box, zoom: ActiveZoom): Box {
  const {s, tx, ty} = zoomAffine(zoom);
  const x0 = clamp01(s * box.x + tx), x1 = clamp01(s * (box.x + box.w) + tx);
  const y0 = s * box.y + ty, y1 = s * (box.y + box.h) + ty;
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return {x: r(x0), y: r(y0), w: r(Math.max(0, x1 - x0)), h: r(y1 - y0)};
}

/**
 * The speaker box at sampled frames of the edit, with the punch-in zoom applied. `[]` when zoom is off or no trigger exists (the static box is then exact).
 * Samples EVERY frame (`step` 1) inside the span of any trigger and one at frame 0, so `boxAt` is exact for every frame the renderer draws and the union of `boxSpan` is the true union.
 */
export function speakerBoxTrack(input: {box: Box; triggers: readonly ZoomTriggerLite[]; fps: number; durationFrames: number; enabled: boolean; step?: number; /** a MOVING speaker (Phase 4.4, optional): the person's box (composition fractions, vertical extent unclipped) at sample frames; linearly interpolated per frame, held before the first and after the last sample. Absent = the static `box`. */ motion?: ReadonlyArray<{frame: number; box: Box}>}): Array<{frame: number; box: Box}> {
  const {box, fps, durationFrames} = input;
  const triggers = input.enabled ? input.triggers : [];
  const motion = [...(input.motion ?? [])].sort((p, q) => p.frame - q.frame);
  if ((triggers.length === 0 && motion.length === 0) || durationFrames <= 0) return [];
  const step = Math.max(1, Math.round(input.step ?? 1)); // every frame by default: the renderer's ramp-in changes the scale by up to 0.15 per 3 frames, so a coarser track makes a nearest-sample lookup lag it
  const baseAt = (f: number): Box => {
    if (motion.length === 0) return box;
    if (f <= motion[0]!.frame) return motion[0]!.box;
    const last = motion[motion.length - 1]!;
    if (f >= last.frame) return last.box;
    let i = 1; while (motion[i]!.frame < f) i += 1;
    const p = motion[i - 1]!, q = motion[i]!, u = (f - p.frame) / Math.max(1, q.frame - p.frame);
    const mix = (m: number, n: number) => m + (n - m) * u;
    return {x: mix(p.box.x, q.box.x), y: mix(p.box.y, q.box.y), w: mix(p.box.w, q.box.w), h: mix(p.box.h, q.box.h)};
  };
  const zoomLo = triggers.length ? Math.floor(Math.min(...triggers.map(t => t.start)) * fps) - 1 : Infinity;
  const zoomHi = triggers.length ? Math.ceil(Math.max(...triggers.map(t => t.end)) * fps) + 1 : -Infinity;
  const lo = Math.max(0, Math.min(zoomLo, motion.length ? motion[0]!.frame : Infinity));
  const hi = Math.min(durationFrames, Math.max(zoomHi, motion.length ? motion[motion.length - 1]!.frame : -Infinity));
  const out: Array<{frame: number; box: Box}> = [{frame: 0, box: baseAt(0)}];
  for (let f = lo; f <= hi; f += step) {
    const b = zoomBox(baseAt(f), activeZoomAt(triggers, f / fps));
    if (out[out.length - 1]!.frame !== f) out.push({frame: f, box: b});
  }
  // after the last trigger the zoom has retracted (and the speaker holds its last position): the plain box
  if (hi < durationFrames) out.push({frame: Math.min(durationFrames, hi + step), box: baseAt(hi + step)});
  return out;
}
