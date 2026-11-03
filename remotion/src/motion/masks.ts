/**
 * Shape clipping and animated clip regions, as plain CSS `clip-path` strings (deterministic, no SVG ids, crisp in the encoded video).
 *
 * This is SHAPE clipping. It hides parts of a layer inside a region the author describes. It knows nothing about the footage and is never
 * "subject-aware"; behind-the-speaker text exists only in the compositor (`TextBehindSubjectTrack`) and only when a real matte is present.
 */

export type ClipShape = 'rect' | 'rounded' | 'capsule' | 'circle' | 'ellipse';
export type ClipRegion = {x: number; y: number; width: number; height: number; shape?: ClipShape; /** rounded: corner radius px. */ radius?: number};

/** A static clip-path for a region, in the coordinate space of the element it is applied to. */
export function regionClipPath(region: ClipRegion): string {
  const {x, y, width, height, shape = 'rounded'} = region;
  const right = x + width;
  const bottom = y + height;
  switch (shape) {
    case 'rect':
      return `polygon(${x}px ${y}px, ${right}px ${y}px, ${right}px ${bottom}px, ${x}px ${bottom}px)`;
    case 'circle':
      return `circle(${Math.min(width, height) / 2}px at ${x + width / 2}px ${y + height / 2}px)`;
    case 'ellipse':
      return `ellipse(${width / 2}px ${height / 2}px at ${x + width / 2}px ${y + height / 2}px)`;
    case 'capsule':
      return `inset(${y}px calc(100% - ${right}px) calc(100% - ${bottom}px) ${x}px round ${Math.min(width, height) / 2}px)`;
    default:
      return `inset(${y}px calc(100% - ${right}px) calc(100% - ${bottom}px) ${x}px round ${region.radius ?? 24}px)`;
  }
}

export type MaskRevealKind = 'wipe-right' | 'wipe-left' | 'wipe-up' | 'wipe-down' | 'iris' | 'slit';

export const MASK_REVEAL_KINDS: readonly MaskRevealKind[] = ['wipe-right', 'wipe-left', 'wipe-up', 'wipe-down', 'iris', 'slit'];

const pct = (n: number) => `${Math.round(Math.min(100, Math.max(0, n)) * 100) / 100}%`;

/**
 * clip-path that shows `t` (0..1) of a w×h layer. At t=0 nothing is visible, at t=1 everything is, with no residual clip so an edge pixel is never lost.
 * `feather` is not offered: CSS clip-path edges are hard, which is what a deliberate mask reveal wants.
 */
export function revealClipPath(kind: MaskRevealKind, t: number, width: number, height: number): string {
  const p = Math.min(1, Math.max(0, t));
  if (p >= 1) {
    return 'inset(0% 0% 0% 0%)';
  }
  switch (kind) {
    case 'wipe-right':
      return `inset(0% ${pct(100 - p * 100)} 0% 0%)`;
    case 'wipe-left':
      return `inset(0% 0% 0% ${pct(100 - p * 100)})`;
    case 'wipe-down':
      return `inset(0% 0% ${pct(100 - p * 100)} 0%)`;
    case 'wipe-up':
      return `inset(${pct(100 - p * 100)} 0% 0% 0%)`;
    case 'slit': {
      const half = (p * 100) / 2;
      return `inset(${pct(50 - half)} 0% ${pct(50 - half)} 0%)`;
    }
    case 'iris': {
      const reach = Math.hypot(width, height) / 2;
      return `circle(${Math.round(reach * p * 100) / 100}px at 50% 50%)`;
    }
  }
}

/**
 * Text-behind-subject is possible only with a real foreground matte. This is the one place that decides whether it is: an alpha video the compositor
 * can layer, AND a keyed cutout that passed the engine's usability check. Anything else is a documented fallback, never a pretended depth effect.
 */
export type SubjectAwareDecision =
  | {mode: 'behind_subject'; basis: 'alpha_video'}
  | {mode: 'fallback'; fallback: 'shape_clip_panel'; reason: 'no_foreground_matte' | 'matte_unusable' | 'text_would_cover_face'};

export function decideTextBehindSubject(input: {maskAvailable: boolean; matteUsable: boolean; textOverlapsFace?: boolean}): SubjectAwareDecision {
  if (!input.maskAvailable) {
    return {mode: 'fallback', fallback: 'shape_clip_panel', reason: 'no_foreground_matte'};
  }
  if (!input.matteUsable) {
    return {mode: 'fallback', fallback: 'shape_clip_panel', reason: 'matte_unusable'};
  }
  if (input.textOverlapsFace) {
    return {mode: 'fallback', fallback: 'shape_clip_panel', reason: 'text_would_cover_face'};
  }
  return {mode: 'behind_subject', basis: 'alpha_video'};
}
