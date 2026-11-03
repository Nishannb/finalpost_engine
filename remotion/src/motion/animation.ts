/**
 * Animation helpers: thin, deterministic wrappers over Remotion's
 * interpolate/spring/Easing. Every function is pure in (frame, …) so it can be
 * combined freely: opacity from one, position from another.
 */

import {Easing, interpolate, spring} from 'remotion';

export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'outBack' | 'outExpo';

export const ease: Record<EaseName, (t: number) => number> = {
  linear: t => t,
  in: Easing.in(Easing.cubic),
  out: Easing.out(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  outBack: Easing.out(Easing.back(1.6)),
  outExpo: Easing.out(Easing.exp),
};

export type SpringPreset = 'smooth' | 'snappy' | 'bouncy' | 'gentle';

export const springPresets: Record<SpringPreset, {damping: number; stiffness: number; mass: number}> = {
  smooth: {damping: 200, stiffness: 100, mass: 1},
  snappy: {damping: 20, stiffness: 200, mass: 0.6},
  bouncy: {damping: 10, stiffness: 160, mass: 0.7},
  gentle: {damping: 26, stiffness: 70, mass: 1.1},
};

const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** 0 → 1 between `start` and `start + duration` frames, eased. Clamped outside. */
export function progress(frame: number, start: number, duration: number, easing: EaseName = 'out'): number {
  return interpolate(frame, [start, start + Math.max(1, duration)], [0, 1], {...CLAMP, easing: ease[easing]});
}

/** Spring from 0 → ~1 starting at `delay` frames. `bouncy` overshoots past 1 briefly. */
export function springIn(frame: number, fps: number, delay = 0, preset: SpringPreset = 'snappy'): number {
  return spring({frame: frame - delay, fps, config: springPresets[preset]});
}

/** 1 → 0 over the last `duration` frames of a span of `durationInFrames`. */
export function exitProgress(frame: number, durationInFrames: number, duration = 10, easing: EaseName = 'in'): number {
  return 1 - progress(frame, durationInFrames - duration, duration, easing);
}

/** Start frame for item `index` in a staggered sequence. */
export function stagger(index: number, each = 4, start = 0): number {
  return start + index * each;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: {x: number; y: number}, b: {x: number; y: number}, t: number): {x: number; y: number} {
  return {x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)};
}

/** Position along a polyline at t (0–1), by length. */
export function pointAlong(points: Array<{x: number; y: number}>, t: number): {x: number; y: number} {
  if (points.length === 0) {
    return {x: 0, y: 0};
  }
  const segments = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = segments.reduce((a, b) => a + b, 0);
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i]!;
    if (remaining <= len || i === segments.length - 1) {
      return lerpPoint(points[i]!, points[i + 1]!, len === 0 ? 0 : Math.min(1, remaining / len));
    }
    remaining -= len;
  }
  return points[points.length - 1]!;
}

/** stroke-dasharray/offset that reveals a stroke of `length` px as t goes 0 → 1. */
export function drawStroke(length: number, t: number): {strokeDasharray: string; strokeDashoffset: number} {
  return {strokeDasharray: `${length} ${length}`, strokeDashoffset: length * (1 - Math.max(0, Math.min(1, t)))};
}

/** Deterministic oscillation between min and max, `period` seconds per cycle. */
export function pulse(frame: number, fps: number, period = 1, min = 0, max = 1): number {
  const s = 0.5 - 0.5 * Math.cos((frame / fps / period) * Math.PI * 2);
  return lerp(min, max, s);
}

/** Animated value through keyframes: keyframes([0, 20, 40], [0, 100, 80]). Clamped. */
export function keyframes(frame: number, frames: number[], values: number[], easing: EaseName = 'inOut'): number {
  return interpolate(frame, frames, values, {...CLAMP, easing: ease[easing]});
}
