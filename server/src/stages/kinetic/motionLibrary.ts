/**
 * Motion library (pure): the entry poses IN-1..IN-10 (+ the E1..E6 aliases), the exit poses OUT-1..OUT-7 (+ X aliases) and the pools the solver rotates through.
 * Everything here is SAMPLED into keyframes by the solver (playbook.ts); the compositor only interpolates. Durations are written at 30 fps and scaled by fps / 30 (motion.ts).
 * Every fast move carries blurPx (motion blur).
 */
import {ENTRY_FRAMES_30, entryFrames, exitFrames, expoIn, expoOut, fpsScale} from './motion.ts';
import type {AnimName, ExitName, StyleName, WordKeyframe} from './schema.ts';

export const IDENT = (frame: number): WordKeyframe => ({frame, x: 0, y: 0, scale: 1, opacity: 1, rotateX: 0, rotateY: 0, blurPx: 0, z: 0, trackingEm: 0, mask: 1, glowK: 1, ghost: 0, scaleX: 1, split: 0});

export type PoseCtx = {fps: number; /** block width px (travel scale) */ bw: number; /** px scale k = width / 1080 */ k: number; /** shortens the travel when it would leave the safe rect (0..1) */ t: number; /** frame width px */ width: number; /** +1 = enters from the right / -1 from the left (IN-3) */ dir: number; /** width of this word (px, for stamp overshoot) */ wordW: number};

/** Entries whose travel leaves the safe rect on purpose (a whip / swing / slam is only off-safe for 2-4 frames). */
export const WILD_ENTRIES: ReadonlySet<AnimName> = new Set<AnimName>(['E3', 'IN-3', 'IN-4', 'IN-6', 'IN-5']);

/** Entry pose of one word at entrance frame i (0-based, sampled at the frame centre so the very first frame is already visible). */
export function entryPose(anim: AnimName, i: number, c: PoseCtx): WordKeyframe {
  const {fps, bw, k, t} = c;
  const n = entryFrames(anim, fps);
  const u = Math.min(1, (i + 0.5) / n);
  const e = expoOut(u);
  const f = (v: number) => v * (1 - e);
  const base = IDENT(0);
  const ramp = (frames: number) => expoOut(Math.min(1, (i + 0.5) / Math.max(1, fpsScale(frames, fps))));
  switch (anim) {
    case 'E1': return {...base, opacity: ramp(5), blurPx: f(10), scale: 1 + f(0.08) * t, x: -24 * k * f(1) * t, z: -120 * f(1) * t};
    case 'E2': return {...base, opacity: ramp(3), blurPx: f(22), scale: 1 + f(0.25) * t, z: 300 * f(1) * t, ghost: i < fpsScale(2, fps) ? 0.4 : 0};
    case 'E3': {
      const peak = 0.8;
      const x = u <= peak ? -1.1 * bw * (1 - expoOut(u / peak)) + 0.015 * bw * expoOut(u / peak) : 0.015 * bw * (1 - expoOut((u - peak) / (1 - peak)));
      return {...base, opacity: ramp(2), blurPx: f(40), x, rotateY: f(25)};
    }
    case 'E5': return {...base, blurPx: f(8), mask: e, glowK: 1 + f(1)};
    case 'E6': return {...base, opacity: ramp(6), blurPx: f(30), scale: 1 + f(0.15) * t, trackingEm: 0.4 * f(1)};
    // IN-1 focus-pull fade: opacity 0 -> 1, blur 25 -> 0, scale 1.12 -> 1, y +20 -> 0
    case 'IN-1': return {...base, opacity: ramp(5), blurPx: f(25), scale: 1 + f(0.12) * t, y: 20 * k * f(1)};
    // IN-2 z-push from depth: scale 0.4 -> 1, opacity 0 -> 1, blur 15 -> 0, glow peaks early
    case 'IN-2': return {...base, opacity: ramp(4), blurPx: f(15), scale: 1 - 0.6 * (1 - e), glowK: 1 + 1.4 * (1 - u) ** 1.5};
    // IN-3 horizontal whip: x from off-gutter to 0, blur high -> 0, scaleX 1.6 -> 1
    case 'IN-3': return {...base, opacity: ramp(2), x: c.dir * 0.95 * c.width * (1 - e), blurPx: f(40), scaleX: 1 + 0.6 * (1 - e)};
    // IN-4 3D Y-swing: rotateY 90 -> 0 (the block carries the perspective)
    case 'IN-4': return {...base, opacity: ramp(3), rotateY: f(90) * c.dir, blurPx: f(8)};
    // IN-5 floor flip-up: rotateX -90 -> 0, blur 20 -> 0
    case 'IN-5': return {...base, opacity: ramp(3), rotateX: -90 * (1 - e), blurPx: f(20)};
    // IN-6 stamp slam: scale 1.6 -> 0.95 -> 1 with a slight tilt (capped so the word never grows wider than the frame)
    case 'IN-6': {
      const peak = Math.max(1.12, Math.min(1.6, (1.12 * c.width) / Math.max(1, c.wordW)));
      const cut = 0.6;
      const s = u < cut ? peak - (peak - 0.95) * expoOut(u / cut) : 0.95 + 0.05 * expoOut((u - cut) / (1 - cut));
      return {...base, opacity: ramp(1), scale: s, rotateY: 7 * c.dir * (1 - e), blurPx: u < cut ? 10 * (1 - u / cut) : 0};
    }
    // IN-7 character cascade (one char; the solver staggers chars ~1 frame): blur / opacity / y
    case 'IN-7': return {...base, opacity: ramp(4), blurPx: f(16), y: 30 * k * f(1)};
    // IN-8 neon write-on: left-to-right mask 0 -> 1, glow ramp
    case 'IN-8': return {...base, mask: u, blurPx: f(3), glowK: 0.4 + 0.6 * e + 0.8 * Math.sin(Math.PI * u)};
    // IN-9 glitch pop: a few hard frames with an RGB split + horizontal jitter, then clean
    case 'IN-9': {
      const last = i >= n - 1;
      return last ? base : {...base, opacity: 1, split: 12 * k * (1 - i / n), x: (i % 2 === 0 ? 1 : -1) * 9 * k * (1 - i / n), ghost: 0.35};
    }
    // IN-10 gold rise + glint: y +60 -> 0, blur 20 -> 0, then a short opacity glint (the last 4 frames)
    case 'IN-10': {
      const rise = Math.max(1, n - fpsScale(4, fps));
      if (i < rise) {
        const ur = (i + 0.5) / rise, er = expoOut(ur);
        return {...base, opacity: expoOut(Math.min(1, (i + 0.5) / Math.max(1, fpsScale(3, fps)))), y: 60 * k * (1 - er), blurPx: 20 * (1 - er)};
      }
      const g = (i - rise + 0.5) / Math.max(1, n - rise);
      return {...base, opacity: 1 - 0.28 * Math.sin(Math.PI * g), glowK: 1 + 1.2 * Math.sin(Math.PI * g)};
    }
    case 'IN-11': return {...base, opacity: ramp(2), scale: 0.92 + 0.08 * e};
    default: return {...base, opacity: e, blurPx: f(10)};
  }
}

export const entryTotalFrames = (anim: AnimName, fps: number, chars = 1): number => entryFrames(anim, fps) + (anim === 'IN-7' ? Math.max(0, chars - 1) * Math.max(1, fpsScale(1, fps)) : 0);

/** Which exits live on the WORDS (scaleX / blur / opacity) and which on the BLOCK keyframes (x / rotateY / opacity). */
export const WORD_LEVEL_EXITS: ReadonlySet<ExitName> = new Set<ExitName>(['OUT-2', 'OUT-3', 'OUT-4', 'OUT-7']);

/** Exit pose of a word at progress p in [0, 1] (word-level exits only; identity otherwise). */
export function wordExitPose(exit: ExitName, p: number): Partial<WordKeyframe> {
  const ex = expoIn(Math.min(1, Math.max(0, p)));
  switch (exit) {
    case 'OUT-2': case 'OUT-3': return {scaleX: 1 + 2 * ex, blurPx: 100 * ex, opacity: 1 - ex};
    case 'OUT-4': return {opacity: 1 - ex, blurPx: 20 * ex, scale: 1 + 0.06 * ex};
    case 'OUT-7': return {opacity: 1 - 0.7 * ex};
    default: return {};
  }
}

// ---------------------------------------------------------------------------------------------------------------- pools + rotation

/** Entry pools by look. Loud heroes: IN-2/4/6/7/9; luxury editorial: IN-1 / IN-10; lead-ins: IN-1 / IN-3. IN-8 is for script words only. */
export const HERO_ENTER_POOL: Record<StyleName, AnimName[]> = {
  retroNeon: ['IN-2', 'IN-6', 'IN-4', 'IN-9', 'IN-7'],
  cinematicClean: ['IN-2', 'IN-5', 'IN-6', 'IN-4', 'IN-1'],
  editorialLuxury: ['IN-1', 'IN-10'],
};
export const HERO_EXIT_POOL: Record<StyleName, ExitName[]> = {
  retroNeon: ['OUT-1', 'OUT-2'],
  cinematicClean: ['OUT-2', 'OUT-4', 'OUT-1'],
  editorialLuxury: ['OUT-4'],
};
export const LEAD_ENTER_POOL: AnimName[] = ['IN-1', 'IN-3'];
export const PUNCH_ENTER_POOL: AnimName[] = ['IN-6', 'IN-2', 'IN-9'];

/** A director tag may name an exit or an entry of either generation; E / X aliases keep working. */
export const isLibraryEnter = (a: string): boolean => /^IN-\d+$/.test(a);
export const isLibraryExit = (x: string): boolean => /^OUT-\d$/.test(x);

export {ENTRY_FRAMES_30, exitFrames};
