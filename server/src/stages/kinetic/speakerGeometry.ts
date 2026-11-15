/**
 * The ONE place that turns a measured speaker box into the per-frame geometry the solver, the verifier and the contract use (Phase 4.4).
 *
 *   source fractions --cover crop (object-position, as ShortVideo's `speakerAt`)--> composition box, vertical extent UNCLIPPED
 *   --the renderer's punch-in zoom (`zoomAffine`, a parity-tested copy of remotion/src/lib/timeline.ts `activeZoomAt` + `zoomStyleFor`), every frame--> a per-frame box track.
 * The face is always `faceRectOf(box)`: the top FACE_FRACTION of the person's real (unclipped) box. Nothing here approximates the renderer a second time: the zoom is `zoomAffine`, applied per frame.
 * Used by productionStage.ts, bench/pixelFace.ts and the geometry tests, so a fixture can never measure a different geometry than production uses. Pure.
 */
import {FACE_FRACTION, type Box} from './scene.ts';
import {resolveMeasuredSpeakerBox, type SpeakerBoxSource} from './speakerBox.ts';
import {speakerBoxTrack, type ZoomTriggerLite} from './zoomTrack.ts';

export type SpeakerGeometryInput = {
  box: unknown;
  source: SpeakerBoxSource;
  srcW: number;
  srcH: number;
  width: number;
  height: number;
  /** cover-fit object-position of the speaker layer; the fullscreen layout uses 50% 42% */
  objectPosition?: {x: number; y: number};
  zoomTriggers: readonly ZoomTriggerLite[];
  zoomEnabled: boolean;
  fps: number;
  durationFrames: number;
  /** Phase 4.8 (M2): the declared observation error budget; absent / null = none (the Phase 4.4-4.7 geometry exactly). Production passes DEFAULT_OBSERVATION_BUDGET. */
  observationBudget?: ObservationBudget | null;
  /** a moving speaker (optional): source-fraction boxes at sample frames (from a tracker); absent = one static box, which is what production measures today */
  motion?: ReadonlyArray<{frame: number; box: unknown; /** extra protection around the FACE (composition fractions), e.g. where the position is unobserved */ margin?: {x: number; y: number; asymmetric?: boolean}; /** more SOURCE boxes this point must also protect (the hull of unobserved motion); combined face-aware AFTER the crop mapping */ cover?: ReadonlyArray<unknown>}>;
};
export type SpeakerGeometry = {
  /** the person's box in composition fractions with its vertical extent unclipped (null: not a measured box) */
  box: Box | null;
  note: string;
  /** one sample per frame inside a punch-in (and frame 0); empty without a zoom */
  track: Array<{frame: number; box: Box}>;
  /** Phase 4.8: the soft crown allowance above the hard rectangle (composition fraction, before zoom); 0 without a budget */
  crownSoft: number;
};

/** the smallest box whose FACE region (top FACE_FRACTION) contains every input face region and whose person box contains every input box. A bounding box of the person boxes is NOT enough when the boxes differ in height position: the face is a fraction of the box, so it would stop short of the lower face. */
export function faceHull(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map(b => b.x)), x1 = Math.max(...boxes.map(b => b.x + b.w)), y0 = Math.min(...boxes.map(b => b.y));
  const faceBottom = Math.max(...boxes.map(b => b.y + FACE_FRACTION * b.h)), personBottom = Math.max(...boxes.map(b => b.y + b.h));
  return {x: x0, y: y0, w: x1 - x0, h: Math.max((faceBottom - y0) / FACE_FRACTION, personBottom - y0)};
}

/**
 * Phase 4.8 (M2): the declared OBSERVATION ERROR BUDGET. The detector's accuracy has NOT been measured (Phase 4.7/4.8: no stored real detector output exists); these numbers are a declared design target, not a measurement.
 *   topError     how far (fraction of the composition height, before any zoom) a detector's person-box TOP may lie BELOW the true top of the head. Phase 4.7 measured on real frames that the unchanged model tolerated
 *                0-1% for the head and 2% for the visible face; 3% is the budget the Phase 4.8 plan declared (cost: ~58 px of the area above the head).
 *   faceTopSlack the smallest gap between the person-box top and the VISIBLE-FACE top measured on real frames (29 px of 1920 on instalive, Phase 4.7 face annotations): the face hairline sits that far below the crown.
 * HARD (visible face, absolute): the protected rectangle's top is raised by topError - faceTopSlack, so a box top up to `topError` too low still covers the face. SOFT (hair / crown): the solver prefers to stay another
 * faceTopSlack clear above that (`crownSoft`, used by the upper zone), and falls back to the hard limit only when nothing readable fits otherwise.
 */
export type ObservationBudget = {topError: number; faceTopSlack: number};
export const DEFAULT_OBSERVATION_BUDGET: ObservationBudget = {topError: 0.03, faceTopSlack: 0.015};
export const hardTopExtension = (b: ObservationBudget | null | undefined): number => (b ? Math.max(0, b.topError - b.faceTopSlack) : 0);
export const crownSoftExtension = (b: ObservationBudget | null | undefined): number => (b ? Math.min(b.topError, b.faceTopSlack) : 0);
/** raises the TOP of the face rectangle by `e` (composition fraction) and keeps its bottom where it was: the person box starts e higher and is e/FACE_FRACTION taller */
export function extendTop(b: Box, e: number): Box { return e > 0 ? {x: b.x, y: b.y - e, w: b.w, h: b.h + e / FACE_FRACTION} : b; }
/**
 * Phase 4.8 (M3): the smallest gap, as a fraction of the PERSON-box height, between the bottom of the 42% rectangle and the bottom of the real VISIBLE FACE (chin), measured on the 23 annotated real frames (worst: instalive,
 * face bottom at 0.404 of the person box). A downward motion margin needs only what this slack does not already cover. (The 60-220 px "slack" quoted in the Phase 4.8 plan was measured against head annotations; the face
 * annotations are tighter, so the honest credit is small.)
 */
export const FACE_BOTTOM_SLACK_OF_HEIGHT = 0.016;
/** enlarges the box so that faceRectOf(result) contains faceRectOf(box) grown by `margin` (x clipped to the frame; the vertical extent stays unclipped, as everywhere in this module). `asymmetric` (Phase 4.8 M3): the bottom grows only by
 * what the measured face-bottom slack does not already cover; the top always grows by the full margin. */
export function withFaceMargin(b: Box, margin?: {x: number; y: number; asymmetric?: boolean}): Box {
  if (!margin) return b;
  const x0 = Math.max(0, b.x - margin.x), x1 = Math.min(1, b.x + b.w + margin.x);
  const bottom = margin.asymmetric ? Math.max(0, margin.y - FACE_BOTTOM_SLACK_OF_HEIGHT * b.h) : margin.y;
  return {x: x0, y: b.y - margin.y, w: x1 - x0, h: b.h + (margin.y + bottom) / FACE_FRACTION};
}

export function resolveSpeakerGeometry(input: SpeakerGeometryInput): SpeakerGeometry {
  const geometry = {srcW: input.srcW, srcH: input.srcH, outW: input.width, outH: input.height, objectPosition: input.objectPosition ?? {x: 0.5, y: 0.42}};
  const r = resolveMeasuredSpeakerBox({box: input.box, source: input.source, geometry});
  if (!r.box) return {box: null, note: r.note, track: [], crownSoft: 0};
  const e = hardTopExtension(input.observationBudget);
  let box = extendTop(r.extent ?? r.box, e);
  const motion = (input.motion ?? []).flatMap(m => { const s = resolveMeasuredSpeakerBox({box: m.box, source: input.source, geometry}); if (!s.box) return [];
    const extras = (m.cover ?? []).flatMap(c => { const e = resolveMeasuredSpeakerBox({box: c, source: input.source, geometry}); return e.box ? [e.extent ?? e.box] : []; });
    return [{frame: m.frame, box: withFaceMargin(faceHull([extendTop(s.extent ?? s.box, e), ...extras.map(x => extendTop(x, e))]), m.margin)}]; });
  // Phase 4.5: with a motion track the base box (what the Director contract and the shot-level checks read) is the HULL of every position the speaker may take, not the first box
  if (motion.length) box = faceHull(motion.map(m => m.box));
  const track = speakerBoxTrack({box, triggers: input.zoomTriggers, fps: input.fps, durationFrames: input.durationFrames, enabled: input.zoomEnabled, ...(motion.length ? {motion} : {})});
  return {box, note: r.note, track, crownSoft: crownSoftExtension(input.observationBudget)};
}

/** the protected face region of a person's box (composition fractions; may extend outside the frame) */
export const faceRectOf = (b: Box): Box => ({x: b.x, y: b.y, w: b.w, h: b.h * FACE_FRACTION});
