import React from 'react';

import {
  GRID_ARTBOARD_ASPECT,
  GRID_COLORS,
  GRID_MORPH_BASE_SEC,
  GRID_MORPH_TIMELINE,
  GRID_TILE_MAP,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuart,
  findOp,
  fitContain,
  gridMergeRect,
  mix,
  opProgress,
  spanProgress,
  staggered,
} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type GridMosaicMorphProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The payoff photo (window reveal). Without it a flat silhouette stand-in is drawn. */
  imageSrc?: string;
  /** The block colour that grows and merges (default blue #4F7CFA). */
  accentFrom?: string;
  /** The colour the block floods to (default red #FD5D42). */
  accentTo?: string;
  /** One accent for this instance (e.g. the edit palette accent): it becomes `accentTo` unless that is set. */
  accent?: string;
  /** Draw the simple cream mark in the centre block (default true). */
  logoMark?: boolean;
  /** Slide the whole frame off to the left in the last 0.4 s (default false: the payoff hold stays whole). */
  exitSlide?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const EXIT_SEC = 0.4;

/**
 * CLIP_01 GRID MOSAIC MORPH (WP45 Layer 2): a 4x4 tile grid on a 4:5 artboard. tile_wipe_grow (tiles grow from an edge) -> logo_fill (the mark fills bottom-up inside a window) -> tile_merge_expand (the centre block
 * absorbs its neighbours, x edges then y edges) -> color_flood_swap (every cell recolours by an edge wipe, staggered 70 ms per step) -> window_reveal (the photo grows out of a one-cell window to the full frame) -> the 1.8 s
 * payoff hold. Opaque full-bleed. No fade, no motion blur, no glow: every reveal is a growing rect / clip window.
 */
export const GridMosaicMorph: React.FC<GridMosaicMorphProps> = ({width, height, imageSrc, accentFrom = GRID_COLORS.blue, accentTo: accentToProp, accent, logoMark = true, exitSlide = false, durationInFrames}) => {
  const accentTo = accentToProp ?? accent ?? GRID_COLORS.red;
  const {t, sec, durSec} = useTemplateClock(GRID_MORPH_BASE_SEC, durationInFrames);
  const ops = GRID_MORPH_TIMELINE;
  const board = fitContain(GRID_ARTBOARD_ASPECT, width, height);
  const cw = board.w / 4;
  const ch = board.h / 4;
  const cellX = (c: number) => Math.round(board.x + c * cw);
  const cellY = (r: number) => Math.round(board.y + r * ch);
  const px = (v: number) => Math.round(v);

  const wipe = findOp(ops, 'tile_wipe_grow')!;
  const merge = opProgress(ops, 'tile_merge_expand', t);
  const flood = findOp(ops, 'color_flood_swap')!;

  // 1) tile_wipe_grow: every non-cream tile grows from its row's edge (left on even rows, right on odd rows), diagonal stagger 45 ms
  const tiles: React.ReactNode[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const kind = GRID_TILE_MAP[r]![c]!;
      if (kind === '.') continue;
      if (kind === 'A' && merge > 0) continue; // the centre block is drawn once, as one merged rect
      const p = easeOutCubic(staggered(t, wipe.from, (r + c) * 0.045, 0.36));
      if (p <= 0) continue;
      const w = px(cw * p);
      const left = r % 2 === 0 ? cellX(c) : cellX(c) + px(cw) - w;
      tiles.push(<div key={`t${r}${c}`} style={{position: 'absolute', left, top: cellY(r), width: w + 1, height: px(ch) + 1, backgroundColor: kind === 'A' ? accentFrom : GRID_COLORS.beige}} />);
    }
  }

  // 3) tile_merge_expand: one rect, x edges first then y edges, absorbing the beige neighbours
  const rect = gridMergeRect(merge);
  const mergeRect =
    merge > 0 ? (
      <div key="merge" style={{position: 'absolute', left: cellX(rect.x0), top: cellY(rect.y0), width: cellX(rect.x1) - cellX(rect.x0) + 1, height: cellY(rect.y1) - cellY(rect.y0) + 1, backgroundColor: accentFrom}} />
    ) : null;

  // 4) color_flood_swap: each cell recolours by a wipe from its left edge; cells start 70 ms apart along the diagonal
  const floodCells: React.ReactNode[] = [];
  if (t >= flood.from) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const p = easeOutQuart(staggered(t, flood.from, (r + c) * 0.07, 0.3));
        if (p <= 0) continue;
        floodCells.push(<div key={`f${r}${c}`} style={{position: 'absolute', left: cellX(c), top: cellY(r), width: px(cw * p) + (p >= 1 ? 1 : 0), height: px(ch) + 1, backgroundColor: accentTo}} />);
      }
    }
  }

  // 2) logo_fill: the cream mark fills bottom-up inside a window (clip), centred on the artboard
  const logo = findOp(ops, 'logo_fill')!;
  const logoP = easeInOutCubic(spanProgress(t, logo.from, logo.to));
  const markSize = Math.min(cw, ch) * 1.1;
  const mark =
    logoMark && logoP > 0 ? (
      <div key="mark" style={{position: 'absolute', left: px(board.x + board.w / 2 - markSize / 2), top: px(board.y + board.h / 2 - markSize / 2), width: px(markSize), height: px(markSize), clipPath: `inset(${(1 - logoP) * 100}% 0 0 0)`}}>
        <div style={{position: 'absolute', left: '10%', top: '4%', width: '80%', height: '80%', borderRadius: '50%', backgroundColor: GRID_COLORS.cream}} />
        <div style={{position: 'absolute', left: '22%', top: '88%', width: '56%', height: '9%', backgroundColor: GRID_COLORS.cream}} />
      </div>
    ) : null;

  // 5) window_reveal: the photo grows from a one-cell window at the centre to the whole frame (clip inset, no opacity)
  const win = easeOutCubic(opProgress(ops, 'window_reveal', t));
  const startL = width / 2 - cw / 2;
  const startT = height / 2 - ch / 2;
  const photo =
    win > 0 ? (
      <div key="photo" style={{position: 'absolute', inset: 0, clipPath: `inset(${mix(startT, 0, win)}px ${mix(width - (startL + cw), 0, win)}px ${mix(height - (startT + ch), 0, win)}px ${mix(startL, 0, win)}px)`}}>
        <PhotoFill src={imageSrc} ground={GRID_COLORS.beige} figure={GRID_COLORS.ink} sun={accentFrom} />
      </div>
    ) : null;

  // optional exit_slide: the whole frame leaves to the left in the last 0.4 s (a hard-edged slide, not a fade)
  const exit = exitSlide ? easeInOutCubic(spanProgress(sec, durSec - EXIT_SEC, durSec)) : 0;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: GRID_COLORS.cream, transform: exit > 0 ? `translateX(${-exit * width}px)` : undefined}}>
      {tiles}
      {mergeRect}
      {floodCells}
      {mark}
      {photo}
    </div>
  );
};
