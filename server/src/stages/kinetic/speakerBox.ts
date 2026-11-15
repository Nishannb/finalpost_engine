/**
 * G1: a MEASURED speaker bounding box without a matte.
 *
 * The edit pipeline already measures where the person is (stages/layout/occupancy.ts: one Gemini vision box around "head + torso", fractions of the SOURCE frame, sampled once
 * ~28% into the clip). Knowing roughly where the person is does not need pixel segmentation: it is enough for beside / above / flank placement and for the face keep-out.
 * What still needs a matte or depth (behind-the-head, stack-over-cutout, occlusion probing) stays refused (`ShotScene.noMatte`).
 *
 * This module is the single place that turns a raw box into scene input. It validates (finite, sane size, clamped) and maps SOURCE-normalised coordinates to
 * COMPOSITION-normalised ones: the compositor draws the speaker with `object-fit: cover` and an object position (remotion VideoTrack: 50% 50% fullscreen, 28% / 72% in the split
 * layouts), so a 16:9 or 4:5 source is cropped and a box in source fractions is NOT a box in composition fractions. A box that is mostly cropped out is rejected (null):
 * the solver then keeps its estimate, exactly as before.
 *
 * Pure. No I/O.
 */
import type {Box} from './scene.ts';

/** Smallest plausible person box (fraction of the frame) after clamping. The fallback box in occupancy.ts is 0.64 x 0.62; a wide shot is roughly 0.2 x 0.4. */
export const MIN_SPEAKER_DIM = 0.08;
/** A box is accepted when at least this share of it lies inside the composition after the crop. */
export const MIN_VISIBLE_FRACTION = 0.5;
/** Tolerance for a detector that returns -0.003 or 1.004. Beyond it the box is rejected, not clamped. */
const EDGE_TOLERANCE = 0.05;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A raw box (anything) -> a clamped normalised Box, or null when it cannot be a person box. */
export function validateSpeakerBox(raw: unknown): Box | null {
  if (!raw || typeof raw !== 'object') return null;
  const {x, y, w, h} = raw as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  if (x < -EDGE_TOLERANCE || y < -EDGE_TOLERANCE || x + w > 1 + EDGE_TOLERANCE || y + h > 1 + EDGE_TOLERANCE) return null;
  const x0 = clamp01(x), y0 = clamp01(y), x1 = clamp01(x + w), y1 = clamp01(y + h);
  const out = {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
  if (out.w < MIN_SPEAKER_DIM || out.h < MIN_SPEAKER_DIM) return null;
  return {x: round4(out.x), y: round4(out.y), w: round4(out.w), h: round4(out.h)};
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export type CompositionGeometry = {
  /** source video pixel size */
  srcW: number;
  srcH: number;
  /** composition pixel size */
  outW: number;
  outH: number;
  /** object-position of the cover fit, 0..1 per axis (default 0.5 / 0.5 = the fullscreen layout) */
  objectPosition?: {x: number; y: number};
  /** punch-in on the speaker: scale about a composition-normalised focus point (1 = none). The box is mapped into the zoomed frame. */
  zoom?: {scale: number; cx: number; cy: number};
};

/** Why a box did not make it (for the report). */
export type SpeakerBoxRejection = 'invalid_box' | 'invalid_geometry' | 'cropped_out';

/**
 * Source-normalised box -> composition-normalised box under `object-fit: cover` (+ optional zoom). Returns the clipped visible part, or a rejection reason.
 * Identity when source and composition share an aspect ratio and there is no zoom (the box is only validated and clamped).
 */
export function sourceBoxToComposition(raw: unknown, geo: CompositionGeometry): {ok: true; box: Box; visibleFraction: number; /** Phase 4.4: the same box with its VERTICAL extent unclipped (x clipped): the face is the top fraction of the person's real box, not of the visible part */ extent: Box} | {ok: false; reason: SpeakerBoxRejection} {
  const box = validateSpeakerBox(raw);
  if (!box) return {ok: false, reason: 'invalid_box'};
  const {srcW, srcH, outW, outH} = geo;
  if (![srcW, srcH, outW, outH].every(v => finite(v) && v > 0)) return {ok: false, reason: 'invalid_geometry'};
  const pos = geo.objectPosition ?? {x: 0.5, y: 0.5};
  if (!finite(pos.x) || !finite(pos.y) || pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) return {ok: false, reason: 'invalid_geometry'};
  const zoom = geo.zoom;
  if (zoom && (!finite(zoom.scale) || zoom.scale < 1 || zoom.scale > 4 || !finite(zoom.cx) || !finite(zoom.cy))) return {ok: false, reason: 'invalid_geometry'};

  // cover: the source is scaled until it fills the composition, the overflow is cropped according to objectPosition
  const s = Math.max(outW / srcW, outH / srcH);
  const dispW = srcW * s, dispH = srcH * s;
  const offX = (outW - dispW) * pos.x, offY = (outH - dispH) * pos.y;
  let x0 = (box.x * dispW + offX) / outW, x1 = ((box.x + box.w) * dispW + offX) / outW;
  let y0 = (box.y * dispH + offY) / outH, y1 = ((box.y + box.h) * dispH + offY) / outH;
  if (zoom && zoom.scale !== 1) {
    const z = (v: number, c: number) => c + (v - c) * zoom.scale;
    x0 = z(x0, zoom.cx); x1 = z(x1, zoom.cx); y0 = z(y0, zoom.cy); y1 = z(y1, zoom.cy);
  }
  const area = (x1 - x0) * (y1 - y0);
  const cx0 = clamp01(x0), cx1 = clamp01(x1), cy0 = clamp01(y0), cy1 = clamp01(y1);
  const visArea = Math.max(0, cx1 - cx0) * Math.max(0, cy1 - cy0);
  const visibleFraction = area > 0 ? visArea / area : 0;
  if (visibleFraction < MIN_VISIBLE_FRACTION) return {ok: false, reason: 'cropped_out'};
  const out = validateSpeakerBox({x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0});
  if (!out) return {ok: false, reason: 'cropped_out'};
  const extent = {x: out.x, y: round4(y0), w: out.w, h: round4(y1 - y0)};
  return {ok: true, box: out, visibleFraction: round4(visibleFraction), extent};
}

/** Where a speaker box came from. Only `vision` / `caller` boxes become a measured scene; the occupancy fallback box is a default, not a person (unmeasuredSlots in layout/unmeasuredSlots.ts). */
export type SpeakerBoxSource = 'vision' | 'fallback' | 'caller';
export type SpeakerBoxInput = {box: unknown; source: SpeakerBoxSource; geometry?: CompositionGeometry};

/** Raw input -> the box the scene may treat as measured, or why not. Pure. */
export function resolveMeasuredSpeakerBox(input: SpeakerBoxInput | undefined): {box: Box; extent: Box; note: string} | {box: null; note: string} {
  if (!input) return {box: null, note: 'no_speaker_box'};
  if (input.source === 'fallback') return {box: null, note: 'speaker_box_is_fallback_default'};
  if (input.geometry) {
    const r = sourceBoxToComposition(input.box, input.geometry);
    return r.ok ? {box: r.box, extent: r.extent, note: `speaker_box_measured:${input.source}:visible=${r.visibleFraction}`} : {box: null, note: `speaker_box_rejected:${r.reason}`};
  }
  const box = validateSpeakerBox(input.box);
  return box ? {box, extent: box, note: `speaker_box_measured:${input.source}:no_crop_mapping`} : {box: null, note: 'speaker_box_rejected:invalid_box'};
}
