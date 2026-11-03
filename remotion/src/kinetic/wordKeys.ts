/** Linear interpolation of a word's solver-sampled keyframes (the ONLY thing the compositor does with word motion). Same algorithm as server motion.ts `interpolateWordKeys`. */
import type {WordKeyframe} from './spec';

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
