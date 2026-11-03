import React from 'react';
import {OffthreadVideo} from 'remotion';

import {ENTER_EASE_OUT, EXIT_EASE_IN, MOVE_IN_OUT, PLAYFUL_OVERSHOOT, clamp01, eased} from '../../../lib/craftTiming';
import {fontFamily} from '../../fonts';
import {hexOr, mixHex, readableInk} from './colorUtil';

/**
 * KINETIC_TYPE_STORYTELLING (WP55) shared primitives. These templates are OVERLAYS on footage (they own no frame, captions are never muted): large type, hard hierarchy, deterministic motion.
 * Safe area mirrors server motionCraftStandards CRAFT_SAFE_AREA (a test pins the numbers): chrome top 8 %, sides 6 %, caption band bottom 28 %.
 */
export const KINETIC_SAFE = {topFrac: 0.08, captionBandFrac: 0.28, sideFrac: 0.06} as const;

export type SubjectBox = {x: number; y: number; w: number; h: number};
export const DEFAULT_SUBJECT_BOX: SubjectBox = {x: 0.3, y: 0.3, w: 0.4, h: 0.62};

export type Direction = 'up' | 'down' | 'left' | 'right';
export const DIRECTIONS: readonly Direction[] = ['up', 'left', 'right', 'down'];

export type KineticPalette = {accent: string; accent2: string; ink: string; shadow: string};

/** Edit palette -> type palette. `accent2` is the contrast colour (never the edit ink): defaults to a blue unless the accent already is one. */
export function kineticPalette(props: {accent?: string; accent2?: string; ink?: string}): KineticPalette {
  const accent = hexOr(props.accent) ?? '#FF8A1F';
  const ink = hexOr(props.ink) ?? '#FFFFFF';
  const accent2 = hexOr(props.accent2) ?? '#2F8CFF';
  // light ink needs a dark shadow and the other way round (readableInk(bg, light, dark) returns `dark` on a bright bg)
  return {accent, accent2, ink, shadow: readableInk(ink, 'rgba(255,255,255,0.6)', 'rgba(0,0,0,0.6)')};
}

/** Layered legibility shadow: a tight contact shadow and a soft drop (no wide halo: mask wrappers clip it into visible boxes), so type reads on sky as well as on shade. */
export const typeShadow = (pal: KineticPalette, em = 0.05): string => `0 ${em * 0.4}em 0 ${pal.shadow}, 0 ${em}em ${em * 2.6}em ${pal.shadow}`;

/** Type region inside the safe area (px). Read-able type lives here; it never enters the caption band. */
export function typeRegion(width: number, height: number) {
  const left = width * KINETIC_SAFE.sideFrac;
  const top = height * KINETIC_SAFE.topFrac;
  const bottom = height * (1 - KINETIC_SAFE.captionBandFrac);
  return {left, top, w: width * (1 - KINETIC_SAFE.sideFrac * 2), h: bottom - top, bottom};
}

/**
 * Aspect-aware size cap. The first implementation capped every font at a fraction of the HEIGHT, which made type small on wide frames. Wider frames get a larger fraction (the longest-run fit against the width
 * still bounds it), and no cap may exceed 42 % of the safe type region's height, so big type never reaches the caption band: 9:16 x1, 4:5 x1.08, 1:1 x1.2, 16:9 x1.75.
 */
export function aspectBoost(width: number, height: number): number {
  const a = width / height;
  return a >= 1.5 ? 1.75 : a >= 1.1 ? 1.4 : a >= 0.95 ? 1.2 : a >= 0.7 ? 1.08 : 1;
}
export const capPx = (width: number, height: number, frac: number): number => Math.min(height * frac * aspectBoost(width, height), typeRegion(width, height).h * 0.42);

/** Largest font size (px) for which the longest unbreakable run of `chars` characters fits `boxW` (Inter 800-900 averages ~0.6 em per cap). */
export const fitRun = (chars: number, boxW: number, maxPx: number, emPerChar = 0.6): number => Math.min(maxPx, boxW / (Math.max(3, chars) * emPerChar));

/** Deterministic 0..n-1 pick from a string (renders must be identical frame for frame). */
export function seedOf(text: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.abs(h) % Math.max(1, n);
}

export function offsetFor(dir: Direction, distance: number, progress: number): {x: number; y: number} {
  const rest = (1 - progress) * distance;
  switch (dir) {
    case 'up':
      return {x: 0, y: rest};
    case 'down':
      return {x: 0, y: -rest};
    case 'left':
      return {x: rest, y: 0};
    default:
      return {x: -rest, y: 0};
  }
}

/** enter / exit progress 0..1 at beat time `sec`. Exit starts `exitSec` before the end and is shorter than the enter. */
export function enterExit(sec: number, durSec: number, delay = 0, enterSec = 0.42, exitSec = 0.26, curve = ENTER_EASE_OUT) {
  const enter = eased(curve, sec, delay, enterSec);
  const exit = eased(EXIT_EASE_IN, sec, Math.max(delay + enterSec, durSec - exitSec), exitSec);
  return {enter, exit, alive: enter > 0 && exit < 1};
}

export {ENTER_EASE_OUT, EXIT_EASE_IN, MOVE_IN_OUT, PLAYFUL_OVERSHOOT, clamp01, eased, mixHex};

/** Fills the frame; type is positioned inside by the template. */
export const KineticStage: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: fontFamily('inter')}}>{children}</div>
);

/**
 * Real subject occlusion layer: a person-only cutout (alpha video, one segmentation pass per source video, cached) drawn ABOVE the type. Without `src` it renders nothing: callers must then use the
 * no-occlusion layout (type in headroom), never pretend that ordinary z-order is occlusion.
 */
export const SubjectForeground: React.FC<{src?: string; startSec?: number; width: number; height: number; fps: number}> = ({src, startSec = 0, width, height, fps}) => {
  if (!src) return null;
  return (
    <OffthreadVideo
      src={src}
      transparent
      muted
      startFrom={Math.max(0, Math.round(startSec * fps))}
      style={{position: 'absolute', left: 0, top: 0, width, height, objectFit: 'cover'}}
    />
  );
};
