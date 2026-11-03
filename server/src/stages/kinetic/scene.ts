/** S6: per-shot scene summary from what the pipeline already has (matte bbox / alpha grid). Pure data + helpers; no model, no face detector. */
import {shortsSafeRect} from '../broll/heroSweep.ts';

/** Normalised box (fractions of the frame). */
export type Box = {x: number; y: number; w: number; h: number};
export type AlphaGridSample = {frame: number; /** base64 of cols*rows bytes, 0 or 255 */ bits: string};
export type AlphaGrid = {cols: number; rows: number; samples: AlphaGridSample[]};

export type ShotScene = {
  shotId: string;
  /** no usable matte: every text event renders in front */
  noMatte: boolean;
  /** the box is a default / vision estimate, not measured on a matte */
  estimated: boolean;
  subjectBox: Box;
  boxTrack?: Array<{frame: number; box: Box}>;
  /** fraction of the frame covered by the subject alpha (0..1) */
  alphaAreaFrac: number;
  grid?: AlphaGrid;
  /** upper 42% of the subject box: eyes / mouth keep-out */
  faceKeepOut: Box;
  /** regions outside the subject box but inside the safe rect */
  freeSpace: Box[];
  /** 0..1, 0 = sharp plate; neutral default 0 */
  blurHint: number;
  /** mean plate luminance 0..1; neutral default 0.45 */
  luminance: number;
  /** mean plate colour (#rrggbb) when sampled: the director / solver pick an accent that suits it */
  plateColor?: string;
};

export const FACE_FRACTION = 0.42;
export const DEFAULT_SUBJECT_BOX: Box = {x: 0.3, y: 0.3, w: 0.4, h: 0.62};

export const faceKeepOutOf = (b: Box): Box => ({x: b.x, y: b.y, w: b.w, h: b.h * FACE_FRACTION});

export function freeSpaceOf(b: Box, width = 720, height = 1280): Box[] {
  const s = shortsSafeRect(width, height);
  const sx0 = s.left / width, sx1 = s.right / width, sy0 = s.top / height, sy1 = s.bottom / height;
  const out: Box[] = [
    {x: sx0, y: sy0, w: Math.max(0, b.x - sx0), h: sy1 - sy0}, // left
    {x: b.x + b.w, y: sy0, w: Math.max(0, sx1 - (b.x + b.w)), h: sy1 - sy0}, // right
    {x: sx0, y: sy0, w: sx1 - sx0, h: Math.max(0, b.y - sy0)}, // above
    {x: sx0, y: b.y + b.h, w: sx1 - sx0, h: Math.max(0, sy1 - (b.y + b.h))}, // below
  ];
  return out.filter(r => r.w > 0.02 && r.h > 0.02);
}

/** Subject-band alpha area from a box when no grid exists (head ellipse + torso block of the silhouette model in depth.ts). */
export function modelAreaFrac(b: Box): number {
  const head = Math.PI * (0.2 * b.w) * (0.13 * b.h);
  const torso = 0.8 * b.w * 0.73 * b.h;
  return Math.min(1, head + torso);
}

export function buildScene(input: {
  shotId: string;
  subjectBox?: Box | null;
  boxTrack?: ShotScene['boxTrack'];
  alphaAreaFrac?: number;
  grid?: AlphaGrid;
  noMatte?: boolean;
  blurHint?: number;
  luminance?: number;
  plateColor?: string;
  width?: number;
  height?: number;
}): ShotScene {
  const noMatte = Boolean(input.noMatte) || !input.subjectBox;
  const box = input.subjectBox ?? DEFAULT_SUBJECT_BOX;
  return {
    shotId: input.shotId,
    noMatte,
    estimated: noMatte,
    subjectBox: box,
    ...(input.boxTrack ? {boxTrack: input.boxTrack} : {}),
    alphaAreaFrac: input.alphaAreaFrac ?? modelAreaFrac(box),
    ...(input.grid ? {grid: input.grid} : {}),
    faceKeepOut: faceKeepOutOf(box),
    freeSpace: freeSpaceOf(box, input.width, input.height),
    blurHint: input.blurHint ?? 0,
    luminance: input.luminance ?? 0.45,
    ...(input.plateColor ? {plateColor: input.plateColor} : {}),
  };
}

/** Subject box at a frame (nearest track sample, else the shot union box). */
export function boxAt(scene: ShotScene, frame: number): Box {
  const t = scene.boxTrack;
  if (!t || t.length === 0) return scene.subjectBox;
  let best = t[0]!;
  for (const s of t) if (Math.abs(s.frame - frame) < Math.abs(best.frame - frame)) best = s;
  return best.box;
}

/** Union of the subject boxes over a frame window (the person moves: an event must clear every pose it lives through). Falls back to boxAt. */
export function boxSpan(scene: ShotScene, f0: number, f1: number): Box {
  const t = scene.boxTrack;
  const inside = t ? t.filter(s => s.frame >= f0 && s.frame <= f1) : [];
  if (inside.length === 0) return boxAt(scene, Math.round((f0 + f1) / 2));
  const x0 = Math.min(...inside.map(s => s.box.x)), y0 = Math.min(...inside.map(s => s.box.y));
  const x1 = Math.max(...inside.map(s => s.box.x + s.box.w)), y1 = Math.max(...inside.map(s => s.box.y + s.box.h));
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}
