/** Pure geometry shared by the solver and the guardrails: the CSS transform model the compositor uses, projected AABBs, safe-rect margins. */
import {exitFrames, entryFrames, interpolateWordKeys} from './motion.ts';
import type {Keyframe, RenderEvent, RenderLine} from './schema.ts';

export type Rect = {left: number; top: number; right: number; bottom: number};
export type Pt = {x: number; y: number};

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Screen position of a block-local point (relative to the block CENTRE, scale 1) under the compositor transform
 * `translate(x,y) perspective(d) translateZ(z) rotateX(a) rotateY(b) scale(s)`.
 */
export function projectPoint(p: Pt, kf: Pick<Keyframe, 'x' | 'y' | 'scale' | 'rotateX' | 'rotateY' | 'z'>, perspectivePx: number): Pt {
  const x1 = p.x * kf.scale, y1 = p.y * kf.scale;
  const cb = Math.cos(rad(kf.rotateY)), sb = Math.sin(rad(kf.rotateY));
  const ca = Math.cos(rad(kf.rotateX)), sa = Math.sin(rad(kf.rotateX));
  const x2 = x1 * cb;
  const z2 = -x1 * sb;
  const y3 = y1 * ca - z2 * sa;
  const z3 = y1 * sa + z2 * ca + kf.z;
  const denom = Math.max(1, perspectivePx - z3);
  const f = perspectivePx / denom;
  return {x: kf.x + x2 * f, y: kf.y + y3 * f};
}

export function rectCorners(r: {w: number; h: number; cx?: number; cy?: number}): Pt[] {
  const cx = r.cx ?? 0, cy = r.cy ?? 0;
  return [{x: cx - r.w / 2, y: cy - r.h / 2}, {x: cx + r.w / 2, y: cy - r.h / 2}, {x: cx + r.w / 2, y: cy + r.h / 2}, {x: cx - r.w / 2, y: cy + r.h / 2}];
}

export function aabbOf(pts: Pt[]): Rect {
  return {left: Math.min(...pts.map(p => p.x)), top: Math.min(...pts.map(p => p.y)), right: Math.max(...pts.map(p => p.x)), bottom: Math.max(...pts.map(p => p.y))};
}

/** Projected AABB of the whole block (w x h at scale 1, centred on the keyframe x,y). */
export function projectBlockAabb(block: {w: number; h: number}, kf: Pick<Keyframe, 'x' | 'y' | 'scale' | 'rotateX' | 'rotateY' | 'z'>, perspectivePx: number): Rect {
  return aabbOf(rectCorners(block).map(p => projectPoint(p, kf, perspectivePx)));
}

/** Projected AABB of one line box (line coordinates are block top-left based). */
export function projectLineAabb(line: Pick<RenderLine, 'dx' | 'dy' | 'w' | 'h'>, block: {w: number; h: number}, kf: Pick<Keyframe, 'x' | 'y' | 'scale' | 'rotateX' | 'rotateY' | 'z'>, perspectivePx: number): Rect {
  const cx = line.dx + line.w / 2 - block.w / 2;
  const cy = line.dy + line.h / 2 - block.h / 2;
  return aabbOf(rectCorners({w: line.w, h: line.h, cx, cy}).map(p => projectPoint(p, kf, perspectivePx)));
}

/** Smallest margin (px) of `r` inside `safe` (negative = outside by that much). */
export const marginInside = (r: Rect, safe: Rect): number => Math.min(r.left - safe.left, r.top - safe.top, safe.right - r.right, safe.bottom - r.bottom);

export const rectArea = (r: Rect): number => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
export function intersect(a: Rect, b: Rect): Rect | null {
  const r = {left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom)};
  return r.right > r.left && r.bottom > r.top ? r : null;
}
export const overlapFraction = (inner: Rect, outer: Rect): number => {
  const a = rectArea(inner);
  const i = intersect(inner, outer);
  return a > 0 && i ? rectArea(i) / a : 0;
};

/** Linear keyframe interpolation: the ONLY thing the compositor does with placement; also used to sample for tests. */
export function interpolateKeyframes(kfs: Keyframe[], frame: number): Keyframe {
  if (frame <= kfs[0]!.frame) return {...kfs[0]!, frame};
  const last = kfs[kfs.length - 1]!;
  if (frame >= last.frame) return {...last, frame};
  for (let i = 1; i < kfs.length; i += 1) {
    const b = kfs[i]!;
    if (frame <= b.frame) {
      const a = kfs[i - 1]!;
      const u = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      const l = (p: number, q: number) => p + (q - p) * u;
      return {frame, x: l(a.x, b.x), y: l(a.y, b.y), scale: l(a.scale, b.scale), opacity: l(a.opacity, b.opacity), rotateX: l(a.rotateX, b.rotateX), rotateY: l(a.rotateY, b.rotateY), blurPx: l(a.blurPx, b.blurPx), z: l(a.z, b.z)};
    }
  }
  return {...last, frame};
}

export const eventBlockAabbAt = (ev: Pick<RenderEvent, 'block' | 'keyframes' | 'perspectivePx'>, frame: number): Rect => projectBlockAabb(ev.block, interpolateKeyframes(ev.keyframes, frame), ev.perspectivePx);

/** projectPoint for a point that already has depth inside the block (word parallax z). */
export function projectPoint3(p: {x: number; y: number; z: number}, kf: Pick<Keyframe, 'x' | 'y' | 'scale' | 'rotateX' | 'rotateY' | 'z'>, perspectivePx: number): Pt {
  const x1 = p.x * kf.scale, y1 = p.y * kf.scale, z1 = p.z * kf.scale;
  const cb = Math.cos(rad(kf.rotateY)), sb = Math.sin(rad(kf.rotateY));
  const ca = Math.cos(rad(kf.rotateX)), sa = Math.sin(rad(kf.rotateX));
  const x2 = x1 * cb + z1 * sb;
  const z2 = -x1 * sb + z1 * cb;
  const y3 = y1 * ca - z2 * sa;
  const z3 = y1 * sa + z2 * ca + kf.z;
  const f = perspectivePx / Math.max(1, perspectivePx - z3);
  return {x: kf.x + x2 * f, y: kf.y + y3 * f};
}

type WordEv = Pick<RenderEvent, 'block' | 'keyframes' | 'perspectivePx' | 'inFrame' | 'outFrame' | 'fps' | 'exit'>;

/** Projected AABB of ONE word (block pose x the word's own keyframes x its parallax depth) at an absolute frame. */
export function wordAabbAt(ev: WordEv, line: RenderLine, frame: number): Rect {
  const kf = interpolateKeyframes(ev.keyframes, frame);
  const wk = line.wordKeyframes.length ? interpolateWordKeys(line.wordKeyframes, frame) : null;
  const cx = line.dx + line.w / 2 - ev.block.w / 2 + (wk?.x ?? 0);
  const cy = line.dy + line.h / 2 - ev.block.h / 2 + (wk?.y ?? 0);
  const s = wk?.scale ?? 1;
  const ry = rad(wk?.rotateY ?? 0);
  const z0 = line.zPx + (wk?.z ?? 0);
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = (sx! * line.w * s) / 2, ly = (sy! * line.h * s) / 2;
    return projectPoint3({x: cx + lx * Math.cos(ry), y: cy + ly, z: z0 - lx * Math.sin(ry)}, kf, ev.perspectivePx);
  });
  return aabbOf(pts);
}

/** The frames in which a word is at REST (entry finished, exit not started): the settled pose that must never clip the safe rect. */
export function restingRange(ev: WordEv, line: RenderLine): [number, number] {
  const from = ev.inFrame + line.enterFrame + entryFrames(line.anim, ev.fps);
  const to = line.exitFrame !== null ? ev.inFrame + line.exitFrame : ev.outFrame - Math.max(1, exitFrames(ev.exit, ev.fps));
  return [from, to];
}

/** Worst overflow (px, > 0 = outside) of any word's resting ink beyond `safe`, plus the margin (negative = outside). */
export function restingMargin(ev: WordEv & {lines: RenderLine[]}, safe: Rect): number {
  let m = Infinity;
  for (const line of ev.lines) {
    const [a, b] = restingRange(ev, line);
    for (let f = a; f <= b; f += 1) m = Math.min(m, marginInside(wordAabbAt(ev, line, f), safe));
  }
  return m;
}
