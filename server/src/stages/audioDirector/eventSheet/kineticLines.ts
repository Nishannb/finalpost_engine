/**
 * Word-level Kinetic typography events (opt-in: buildEventSheet(..., {kineticLines: true})). Pure.
 *
 * Renderer contract (remotion/src/kinetic/spec.ts + TypeWords.tsx): in the type.words preset one RenderLine is one word; `startFrame` is the word's
 * SPEECH start and `enterFrame` its first visible frame (relative to the event inFrame); `wordKeyframes` are ABSOLUTE composition frames holding
 * the word's offsets from its rest pose (x, y, scale, scaleX, opacity, blurPx, rotateX/Y, mask, split), interpolated linearly per frame; a line is
 * drawn from its first keyframe while the event is on screen (inFrame..outFrame inclusive).
 *
 * Nothing is invented: the times below are read from those keyframes with one stated rule.
 *   - visible  = keyframes with opacity > 0.002 and mask > 0 (TypeWords.tsx draws nothing otherwise; every word carries an invisible pre-roll key).
 *   - landing  = the first visible keyframe at which the word is at rest within the REST tolerances (scale within 6 %, opacity >= 0.95,
 *                blur <= 1.5 px, travel <= 6 px, rotation <= 4 deg, mask >= 0.98, split <= 0.1); for a word that overshoots its rest scale (a stamp
 *                slam 1.15..1.6 -> 0.95 -> 1) the CONTACT frame instead: the scale minimum after the overshoot.
 *   - exit     = a line's own early exit (`exitFrame`, the X2 word swap) or the block's exit motion: the first frame of the trailing run of block
 *                keyframes that are no longer at rest.
 * Motion attributes (direction, travel, intensity) are measured from the first keyframe's offsets; they describe the drawn motion, not a judgement.
 */

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export const KINETIC_REST = Object.freeze({scale: 0.06, opacity: 0.05, blurPx: 1.5, travelPx: 6, rotateDeg: 4, mask: 0.02, split: 0.1});

/** How far a pose is from rest, in units of the REST tolerances (<= 1 = at rest). */
export function restDistance(pose: Obj): number {
  return Math.max(
    Math.abs(num(pose.scale, 1) - 1) / KINETIC_REST.scale,
    Math.abs(num(pose.scaleX, 1) - 1) / KINETIC_REST.scale,
    (1 - num(pose.opacity, 1)) / KINETIC_REST.opacity,
    num(pose.blurPx) / KINETIC_REST.blurPx,
    Math.hypot(num(pose.x), num(pose.y)) / KINETIC_REST.travelPx,
    Math.max(Math.abs(num(pose.rotateX)), Math.abs(num(pose.rotateY))) / KINETIC_REST.rotateDeg,
    (1 - num(pose.mask, 1)) / KINETIC_REST.mask,
    num(pose.split) / KINETIC_REST.split,
  );
}

export type KineticMotion = {
  /** Where the word comes from, read from its first keyframe. */
  direction: 'from_left' | 'from_right' | 'from_below' | 'from_above' | 'from_depth' | 'from_front' | 'swing' | 'flip' | 'in_place';
  /** 0..1, the strongest of: scale change, blur, travel, rotation; scaled down for slow (> 6 frame) arrivals. */
  intensity: number;
  /** Frames from the first visible keyframe to landing. */
  arrivalFrames: number;
  /** The word overshoots its rest scale before settling (a slam / pop signature). */
  overshoot: boolean;
};

export function measureMotion(keyframes: readonly Obj[], landingIndex: number, widthPx: number): KineticMotion {
  const first = keyframes[0] ?? {};
  const s0 = num(first.scale, 1);
  const x0 = num(first.x);
  const y0 = num(first.y);
  const rx = Math.abs(num(first.rotateX));
  const ry = Math.abs(num(first.rotateY));
  const travel = Math.hypot(x0, y0);
  let direction: KineticMotion['direction'] = 'in_place';
  if (ry > 20) direction = 'swing';
  else if (rx > 20) direction = 'flip';
  else if (travel > KINETIC_REST.travelPx * 4) direction = Math.abs(x0) >= Math.abs(y0) ? (x0 < 0 ? 'from_left' : 'from_right') : y0 > 0 ? 'from_below' : 'from_above';
  else if (s0 < 0.85) direction = 'from_depth';
  else if (s0 > 1.1) direction = 'from_front';
  const scales = keyframes.slice(0, landingIndex + 4).map(k => num(k.scale, 1));
  const overshoot = s0 > 1.1 && scales.some(s => s < 0.985);
  const arrivalFrames = Math.max(0, num(keyframes[landingIndex]?.frame) - num(first.frame));
  const raw = Math.max(Math.abs(s0 - 1) / 0.6, num(first.blurPx) / 30, travel / Math.max(1, widthPx * 0.5), Math.max(rx, ry) / 90, Math.abs(num(first.scaleX, 1) - 1) / 0.6);
  const intensity = Math.round(Math.min(1, raw) * (arrivalFrames > 6 ? 0.75 : 1) * 1000) / 1000;
  return {direction, intensity, arrivalFrames, overshoot};
}

export type KineticLineFact = {
  lineIndex: number;
  text: string;
  role: string;
  anim: string;
  /** absolute composition frames */
  firstVisibleFrame: number;
  landingFrame: number;
  speechFrame: number;
  exitFrame: number | null;
  fontPx: number;
  uppercase: boolean;
  motion: KineticMotion;
};

/** The word lines of one stored kinetic event that are actually drawn inside [inFrame, min(outFrame, compositionEnd)]. */
export function kineticLineFacts(raw: Obj, inFrame: number, lastDrawnFrame: number, widthPx: number): KineticLineFact[] {
  const lines = Array.isArray(raw.lines) ? raw.lines.filter(isObj) : [];
  const out: KineticLineFact[] = [];
  lines.forEach((line, lineIndex) => {
    const all = (Array.isArray(line.wordKeyframes) ? line.wordKeyframes.filter(isObj) : []).filter(k => Number.isFinite(num(k.frame, Number.NaN))).sort((a, b) => num(a.frame) - num(b.frame));
    const firstShown = all.findIndex(k => num(k.opacity, 1) > 0.002 && num(k.mask, 1) > 0);
    if (firstShown < 0) return;
    const keys = all.slice(firstShown);
    const firstVisible = Math.max(inFrame, num(keys[0]!.frame));
    if (firstVisible > lastDrawnFrame) return;
    let landingIndex = keys.findIndex(k => restDistance(k) <= 1);
    if (landingIndex < 0) landingIndex = keys.length - 1;
    if (num(keys[0]!.scale, 1) > 1.1) {
      // overshoot (slam): the contact frame is the scale minimum on the way to rest
      let contact = 0;
      for (let i = 1; i <= Math.min(keys.length - 1, landingIndex + 3); i += 1) if (num(keys[i]!.scale, 1) < num(keys[contact]!.scale, 1)) contact = i;
      if (num(keys[contact]!.scale, 1) < 0.995) landingIndex = contact;
    }
    const landingFrame = Math.max(firstVisible, num(keys[landingIndex]!.frame));
    if (landingFrame > lastDrawnFrame) return;
    const exitRel = typeof line.exitFrame === 'number' && Number.isInteger(line.exitFrame) ? line.exitFrame : null;
    out.push({
      lineIndex,
      text: typeof line.text === 'string' ? line.text : '',
      role: typeof line.role === 'string' ? line.role : 'unknown',
      anim: typeof line.anim === 'string' ? line.anim : 'unknown',
      firstVisibleFrame: firstVisible,
      landingFrame,
      speechFrame: inFrame + num(line.startFrame),
      exitFrame: exitRel !== null && inFrame + exitRel <= lastDrawnFrame ? inFrame + exitRel : null,
      fontPx: num(line.fontPx),
      uppercase: line.uppercase === true,
      motion: measureMotion(keys, landingIndex, widthPx),
    });
  });
  return out;
}

/** First frame of the block's exit motion (trailing run of non-rest block keyframes before outFrame), or null when the block simply cuts out. */
export function blockExitFrame(raw: Obj, inFrame: number, lastDrawnFrame: number): number | null {
  const keys = (Array.isArray(raw.keyframes) ? raw.keyframes.filter(isObj) : []).filter(k => Number.isFinite(num(k.frame, Number.NaN))).sort((a, b) => num(a.frame) - num(b.frame));
  if (keys.length < 2) return null;
  let index = keys.length;
  while (index > 0 && restDistance(keys[index - 1]!) > 1) index -= 1;
  if (index >= keys.length || index === 0) return null;
  const frame = num(keys[index]!.frame);
  return frame > inFrame && frame <= lastDrawnFrame ? frame : null;
}
