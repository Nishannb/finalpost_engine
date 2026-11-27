/**
 * Kinetic B-roll guard (2026-11-28, owner): the LAST pass over a Kinetic blueprint's picture overlays, right before assembly. Pure.
 *
 * Owner rules it enforces on every split / cutaway asset, whichever stage placed it:
 *  - a LANDSCAPE asset (wider than tall) is a split screen: asset in the top half, the speaker in the bottom half;
 *  - a PORTRAIT asset (taller than wide) fills the whole frame as a cutaway, never a split; an about-square asset stays a split (a full-frame
 *    cover would cut ~44% of it away);
 *  - the asset is drawn once, sharp and large: never a blurred copy behind it, never a dark caption plate over it (`kineticMotion`, no `backdrop`);
 *  - in a split the speaker is framed by where the head really is (`speakerHeadTopFrac`: the RVM matte when there is one, else the measured
 *    speaker box), so the head and chin stay in the speaker half instead of a fixed crop that cut at the chin.
 * Without a measured head nothing is added and the renderer keeps its fixed framing.
 */
import type {VisualOverlay} from '../../types/blueprint.ts';
import type {AlphaGrid} from '../kinetic/scene.ts';

/** wider than this (w / h) = landscape = split screen. A square or portrait asset is never split. */
export const LANDSCAPE_MIN_ASPECT = 1.05;
/** taller than this (h / w) = portrait = full frame. Between the two (about square) stays a split: a full-frame cover would cut off ~44% of it. */
export const PORTRAIT_MIN_ASPECT = 1.05;

export type AssetOrientation = 'landscape' | 'portrait' | 'square' | 'unknown';

export function assetOrientation(width: number | undefined, height: number | undefined): AssetOrientation {
  if (!width || !height || width <= 0 || height <= 0) return 'unknown';
  if (width / height >= LANDSCAPE_MIN_ASPECT) return 'landscape';
  if (height / width >= PORTRAIT_MIN_ASPECT) return 'portrait';
  return 'square';
}

/** Head top (frame fraction, 0 = top) per output-time window. */
export type SpeakerHeadSource =
  | {kind: 'matte'; grid: AlphaGrid; fps: number}
  | {kind: 'box'; headTopFrac: number}
  | {kind: 'none'};

/** cells a grid row needs to count as the person (one stray cell is matte noise) */
const MIN_ROW_CELLS = 2;

function decodeBits(bits: string): Uint8Array {
  return Uint8Array.from(Buffer.from(bits, 'base64'));
}

/** Top row of the person in one alpha sample, as a frame fraction; null when the sample is empty. */
export function sampleHeadTop(bits: Uint8Array, cols: number, rows: number): number | null {
  for (let r = 0; r < rows; r += 1) {
    let n = 0;
    for (let c = 0; c < cols; c += 1) if (bits[r * cols + c]) n += 1;
    if (n >= MIN_ROW_CELLS) return r / rows;
  }
  return null;
}

/**
 * The head top for a window: the matte samples inside it (the HIGHEST head position, so the head never leaves the frame when the speaker moves up),
 * else the whole-video matte, else the measured box. Undefined = unknown.
 */
export function headTopForWindow(source: SpeakerHeadSource, start: number, end: number): number | undefined {
  if (source.kind === 'box') return clampFrac(source.headTopFrac);
  if (source.kind !== 'matte') return undefined;
  const {grid, fps} = source;
  const tops = (inWindow: boolean) =>
    grid.samples
      .filter(s => !inWindow || (s.frame / fps >= start - 0.25 && s.frame / fps <= end + 0.25))
      .map(s => sampleHeadTop(decodeBits(s.bits), grid.cols, grid.rows))
      .filter((v): v is number => v !== null);
  const local = tops(true);
  const all = local.length > 0 ? local : tops(false);
  return all.length > 0 ? clampFrac(Math.min(...all)) : undefined;
}

const clampFrac = (v: number) => Math.round(Math.min(0.9, Math.max(0, v)) * 1000) / 1000;

const isPictureHost = (o: VisualOverlay) => (o.layout === 'split' || o.layout === 'cutaway') && Boolean(o.assetUrl);

export function guardKineticBroll(overlays: readonly VisualOverlay[], head: SpeakerHeadSource): {overlays: VisualOverlay[]; warnings: string[]} {
  const warnings: string[] = [];
  let toFull = 0;
  let toSplit = 0;
  let framed = 0;
  let unframed = 0;
  const out = overlays.map(overlay => {
    if (!isPictureHost(overlay)) return overlay;
    const orientation = assetOrientation(overlay.width, overlay.height);
    // the orientation decides the layout; an unknown size keeps the placement's choice
    const layout: VisualOverlay['layout'] = orientation === 'portrait' ? 'cutaway' : orientation === 'unknown' ? overlay.layout : 'split';
    if (layout !== overlay.layout) {
      if (layout === 'cutaway') toFull += 1;
      else toSplit += 1;
    }
    const {backdrop: _backdrop, speakerHeadTopFrac: _head, ...rest} = overlay;
    if (layout === 'cutaway') {
      const {fitWidth: _fit, speakerSide: _side, ...cut} = rest;
      return {...cut, layout, anchor: 'top', kineticMotion: true} as VisualOverlay;
    }
    const headTop = headTopForWindow(head, overlay.start, overlay.end);
    if (headTop === undefined) unframed += 1;
    else framed += 1;
    return {...rest, layout, anchor: 'top', speakerSide: 'bottom', fitWidth: true, kineticMotion: true, ...(headTop !== undefined ? {speakerHeadTopFrac: headTop} : {})} as VisualOverlay;
  });
  if (toFull > 0) warnings.push(`kinetic_broll:portrait_full_frame:${toFull}`);
  if (toSplit > 0) warnings.push(`kinetic_broll:landscape_split:${toSplit}`);
  if (framed > 0) warnings.push(`kinetic_broll:split_head_framed:${framed}:${head.kind}`);
  if (unframed > 0) warnings.push(`kinetic_broll:split_head_unknown:${unframed}`);
  return {overlays: out, warnings};
}
