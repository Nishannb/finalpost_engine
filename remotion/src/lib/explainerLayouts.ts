/**
 * WP40: Skill B (Explainer) layout model, PURE. Geometry + ids only (no React), so the planner mirror (server/src/stages/broll/explainerPacing.ts) and the renderer share one set of numbers
 * (a server test asserts the ids and the caption table match). Grammar: remotion/out/phase36-readiness/explainer-grammar.yaml.
 *
 *   explainer_a  full talking head
 *   explainer_b  split: b-roll TOP half (y 0-50 %), speaker BOTTOM half (this is the same 50 / 50 split the polish `split` overlay uses: placement splitRatio 0.5)
 *   explainer_c  full-frame b-roll on #FFFFFF with a light-gray dot grid (diagrams, mockups, logo chips)
 *   explainer_d  full-frame dark cutaway, higher contrast
 */
export type ExplainerLayoutId = 'explainer_a' | 'explainer_b' | 'explainer_c' | 'explainer_d';
export const EXPLAINER_LAYOUT_IDS: readonly ExplainerLayoutId[] = ['explainer_a', 'explainer_b', 'explainer_c', 'explainer_d'];

/** Layout B: the seam sits at half the frame (grammar: top y 0-640, bottom y 640-1280 on 1280). */
export const EXPLAINER_SPLIT_RATIO = 0.5;
/** WP49: duration of the smooth expand when leaving / entering layout B (seconds). */
export const EXPLAINER_SPLIT_EXPAND_SEC = 0.4;

/** Layout C ground defaults (Skill B preferred edu_lime_paper). Overridable via blueprint.editPalette. */
export const EXPLAINER_GRID_BG = '#FFFFFF';
export const EXPLAINER_GRID_DOT = '#AEB4BD';
export const EXPLAINER_GRID_PITCH_FRAC = 0.042; // lattice pitch (~45 px at 1080)
export const EXPLAINER_GRID_DOT_RADIUS_FRAC = 0.0040; // ~4.3 px at 1080

/** Preferred Skill B accent (grammar `highlight.color`): lime — not a lock; see editPalette / blueprint.editPalette. */
export const EXPLAINER_LIME = '#BFFF00';
/** Layout D grade: darker, higher contrast than the speaker. */
export const EXPLAINER_DARK_GRADE = {brightness: 0.62, contrast: 1.28, saturate: 0.9} as const;

export type ExplainerGroundColors = {backgroundColor: string; dotColor: string};

/** Caption y (percent of frame height) per layout; B sits on the seam. WP41 draws the chunk-swap captions; WP40 only pins where they go. */
export const EXPLAINER_CAPTION_Y_PCT: Readonly<Record<ExplainerLayoutId, number>> = {explainer_a: 75, explainer_b: 50, explainer_c: 75, explainer_d: 75};

export type Rect = {x: number; y: number; w: number; h: number};
/** B-roll / speaker rectangles of a layout (frame pixels). A, C, D are full-frame (`speaker` is null on C / D: no speaker visible). */
export function explainerRegions(layout: ExplainerLayoutId, width: number, height: number): {top: Rect | null; bottom: Rect | null; full: Rect | null} {
  if (layout === 'explainer_b') {
    const seam = Math.round(height * EXPLAINER_SPLIT_RATIO);
    return {top: {x: 0, y: 0, w: width, h: seam}, bottom: {x: 0, y: seam, w: width, h: height - seam}, full: null};
  }
  return {top: null, bottom: null, full: {x: 0, y: 0, w: width, h: height}};
}

/** The dot-grid CSS (radial-gradient lattice) for a frame width: the same recipe the component paints. Colours default to Skill B preferred paper board; pass `colors` from editPalette when chosen. */
export function explainerGridCss(
  width: number,
  colors?: Partial<ExplainerGroundColors>,
): {backgroundColor: string; backgroundImage: string; backgroundSize: string} {
  const bg = colors?.backgroundColor ?? EXPLAINER_GRID_BG;
  const dot = colors?.dotColor ?? EXPLAINER_GRID_DOT;
  const pitch = Math.round(width * EXPLAINER_GRID_PITCH_FRAC * 100) / 100;
  const radius = Math.round(width * EXPLAINER_GRID_DOT_RADIUS_FRAC * 100) / 100;
  return {
    backgroundColor: bg,
    backgroundImage: `radial-gradient(circle at center, ${dot} 0px, ${dot} ${radius}px, rgba(0,0,0,0) ${radius + 0.9}px)`,
    backgroundSize: `${pitch}px ${pitch}px`,
  };
}

/** Logo-chip pop-in stagger (grammar: ~0.5 s apart). */
export const EXPLAINER_CHIP_STAGGER_SEC = 0.5;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export type ExplainerSplitExpand = {
  /** Draw split geometry (even while the destination layout is A/C/D). */
  drawSplit: boolean;
  /** Seam as fraction of frame height from the top (0 = full speaker, 0.5 = split, 1 = full top). */
  seam: number;
  /** Destination layout id after the expand completes. */
  targetLayout: ExplainerLayoutId;
  /** Which pane is growing: speaker (up) or b-roll (down). */
  expand: 'up' | 'down' | 'none';
};

/**
 * WP49: seam animation for B ↔ full-frame. Pure.
 * B→A: speaker (bottom) expands UP (seam 0.5→0).
 * B→C/D: b-roll (top) expands DOWN (seam 0.5→1).
 * A/C/D→B: reverse of the above over the first EXPLAINER_SPLIT_EXPAND_SEC of B.
 */
export function explainerSplitExpandAt(
  track: ReadonlyArray<{start: number; end: number; layout: ExplainerLayoutId}>,
  frame: number,
  fps: number,
  expandSec: number = EXPLAINER_SPLIT_EXPAND_SEC,
): ExplainerSplitExpand | null {
  if (track.length === 0) return null;
  const timeSec = frame / Math.max(1, fps);
  let index = 0;
  for (let i = 0; i < track.length; i++) {
    if (track[i]!.start <= timeSec + 1e-9) index = i;
    else break;
  }
  const active = track[index]!;
  const prev = index > 0 ? track[index - 1]! : null;
  const expandFrames = Math.max(1, Math.round(expandSec * fps));
  const localFrame = frame - Math.round(active.start * fps);
  const progress = easeOutCubic(localFrame / expandFrames);

  if (active.layout === 'explainer_b') {
    if (localFrame >= 0 && localFrame < expandFrames && prev && prev.layout !== 'explainer_b') {
      if (prev.layout === 'explainer_a') {
        return {drawSplit: true, seam: mix(0, EXPLAINER_SPLIT_RATIO, progress), targetLayout: 'explainer_b', expand: 'down'};
      }
      // C / D → B: collapse from full top into split
      return {drawSplit: true, seam: mix(1, EXPLAINER_SPLIT_RATIO, progress), targetLayout: 'explainer_b', expand: 'up'};
    }
    return {drawSplit: true, seam: EXPLAINER_SPLIT_RATIO, targetLayout: 'explainer_b', expand: 'none'};
  }

  if (prev?.layout === 'explainer_b' && localFrame >= 0 && localFrame < expandFrames) {
    if (active.layout === 'explainer_a') {
      return {drawSplit: progress < 0.999, seam: mix(EXPLAINER_SPLIT_RATIO, 0, progress), targetLayout: 'explainer_a', expand: 'up'};
    }
    // B → C / D: top pane grows to full
    return {drawSplit: progress < 0.999, seam: mix(EXPLAINER_SPLIT_RATIO, 1, progress), targetLayout: active.layout, expand: 'down'};
  }

  return {drawSplit: false, seam: active.layout === 'explainer_a' ? 0 : 1, targetLayout: active.layout, expand: 'none'};
}

/** Regions for a custom seam ratio (WP49 expand). */
export function explainerRegionsAtSeam(width: number, height: number, seam: number): {top: Rect; bottom: Rect} {
  const y = Math.round(height * Math.min(1, Math.max(0, seam)));
  return {
    top: {x: 0, y: 0, w: width, h: Math.max(0, y)},
    bottom: {x: 0, y, w: width, h: Math.max(0, height - y)},
  };
}
