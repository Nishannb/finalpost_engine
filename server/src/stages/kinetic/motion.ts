/**
 * MOTION-PLAYBOOK constants + easing, shared by the solver, the guardrails and the tests. Pure. Durations are written at 30 fps and scaled by fps/30.
 * Easing: entries expo-out cubic-bezier(0.16, 1, 0.3, 1); exits expo-in cubic-bezier(0.7, 0, 0.84, 0). Never linear (except the slow push), bounce, elastic, shake.
 */
import type {AnimName, ExitName, WordKeyframe} from './schema.ts';

/** Entry durations at 30 fps (the library IN-1..IN-11 + the E1..E6 aliases). IN-7 is the per-character profile (the cascade adds ~1 frame per character); IN-10 includes its 4-frame glint. */
export const ENTRY_FRAMES_30: Record<AnimName, number> = {E1: 8, E2: 10, E3: 8, E4: 10, E5: 11, E6: 16, 'IN-1': 8, 'IN-2': 11, 'IN-3': 5, 'IN-4': 8, 'IN-5': 10, 'IN-6': 5, 'IN-7': 6, 'IN-8': 14, 'IN-9': 4, 'IN-10': 12, 'IN-11': 3};
/** Exit durations at 30 fps. OUT-5 / OUT-6 are hard cuts (0 frames). */
export const EXIT_FRAMES_30: Record<ExitName, number> = {X1: 0, X2: 3, X3: 7, X4: 12, X5: 12, X6: 6, 'OUT-1': 5, 'OUT-2': 4, 'OUT-3': 4, 'OUT-4': 7, 'OUT-5': 0, 'OUT-6': 0, 'OUT-7': 12};
export const fpsScale = (n: number, fps: number): number => (n === 0 ? 0 : Math.max(1, Math.round((n * fps) / 30)));
export const entryFrames = (anim: AnimName, fps: number): number => fpsScale(ENTRY_FRAMES_30[anim], fps);
export const exitFrames = (x: ExitName, fps: number): number => fpsScale(EXIT_FRAMES_30[x], fps);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i += 1) {
      const t = (lo + hi) / 2;
      if (bx(t) < x) lo = t; else hi = t;
    }
    return by((lo + hi) / 2);
  };
}
export const expoOut = cubicBezier(0.16, 1, 0.3, 1);
export const expoIn = cubicBezier(0.7, 0, 0.84, 0);

export const CAMERA_BLEND = 0.3;
export const HOLD = {push: [1, 1.04] as [number, number], rotY: 3, rotX: 1.5, periodSec: 5};
/** conservative growth of the resting ink over the block life: push 1.04 x parallax z (+40 under perspective) */
export const REST_GROWTH = 1.075;

export const Z_BY_ROLE = {hero: 40, punch: 40, support: 0, connector: -20, running: 0} as const;

export function interpolateWordKeys(kfs: WordKeyframe[], frame: number): WordKeyframe {
  const first = kfs[0]!, last = kfs[kfs.length - 1]!;
  if (frame <= first.frame) return {...first, frame};
  if (frame >= last.frame) return {...last, frame};
  for (let i = 1; i < kfs.length; i += 1) {
    const b = kfs[i]!;
    if (frame <= b.frame) {
      const a = kfs[i - 1]!;
      const u = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      const l = (p: number, q: number) => p + (q - p) * u;
      return {frame, x: l(a.x, b.x), y: l(a.y, b.y), scale: l(a.scale, b.scale), opacity: l(a.opacity, b.opacity), rotateX: l(a.rotateX, b.rotateX), rotateY: l(a.rotateY, b.rotateY), blurPx: l(a.blurPx, b.blurPx), z: l(a.z, b.z), trackingEm: l(a.trackingEm, b.trackingEm), mask: l(a.mask, b.mask), glowK: l(a.glowK, b.glowK), ghost: l(a.ghost, b.ghost), scaleX: l(a.scaleX, b.scaleX), split: l(a.split, b.split)};
    }
  }
  return {...last, frame};
}

/** Per-character stagger of the IN-7 cascade, frames at 30 fps (~1 frame per character). */
export const CASCADE_STAGGER_30 = 1;
/** Hero / punch floor and connector / support floor, fractions of the frame height (after the final fit). */
export const HERO_FLOOR_FRAC = 0.075;
export const SUPPORT_FLOOR_FRAC = 0.035;
