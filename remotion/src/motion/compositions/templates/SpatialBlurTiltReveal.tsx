import React from 'react';

import {
  SPATIAL_BASE_SEC,
  SPATIAL_BOARD_ASPECT,
  SPATIAL_COLORS,
  SPATIAL_DEFAULT_LINES,
  SPATIAL_RING_BIRTH_SEC,
  SPATIAL_RING_FADE_SEC,
  SPATIAL_RING_SPACING,
  fitContain,
  spanProgress,
  spatialFrame,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, mixHex, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type SpatialBlurTiltRevealProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Two short lines [small, big] (demo only when omitted). */
  lines?: [string, string];
  /** Ring colour source (default ring #2A3AA8; live = edit-palette accent blended into the ground). */
  accent?: string;
  /** Board colour (default #06070C). */
  ground?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

/** Squircle (superellipse n = 4) outline with half-extents rx / ry about (0,0). */
function squirclePath(rx: number, ry: number): string {
  const steps = 72;
  const n = 4;
  const pts: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * rx;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * ry;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${pts.join(' ')} Z`;
}

/**
 * CLIP_26 SPATIAL BLUR + TILT REVEAL (WP51 Layer 2 / Batch B5): 16:10 board (letterboxed), 1.61 s, dark ground. Two lines start blurred (36 px), tilted -11 deg, 0.2 opacity up-left of centre and resolve over 0.7 s expo-out (blur_rotate_in)
 * to sharp, upright and centred, then ease to 0.93 scale over the hold. Concentric squircle rings (3 -> 7, 6.5% spacing) expand outward and fade at the edges. Silent.
 * BLUR IS ALLOWED HERE ONLY: the blur-in is this template's signature. No glow, glitch, light leak or bounce.
 */
export const SpatialBlurTiltReveal: React.FC<SpatialBlurTiltRevealProps> = ({width, height, lines, accent, ground, durationInFrames}) => {
  const {t} = useTemplateClock(SPATIAL_BASE_SEC, durationInFrames);
  const board = fitContain(SPATIAL_BOARD_ASPECT, width, height);
  const frame = spatialFrame(t);
  const bg = hexOr(ground) ?? SPATIAL_COLORS.ground;
  const ink = readableInk(bg, SPATIAL_COLORS.ink, '#0B0B0B');
  const ringColor = hexOr(accent) ? mixHex(bg, hexOr(accent)!, 0.6) : SPATIAL_COLORS.ring;
  const copy = lines && lines.length === 2 ? lines : [...SPATIAL_DEFAULT_LINES];
  const bigSize = Math.min(board.h * 0.12, (board.w * 0.78) / (Math.max(8, copy[1]!.length) * 0.6));
  const smallSize = Math.min(bigSize * 0.62, (board.w * 0.6) / (Math.max(8, copy[0]!.length) * 0.58));
  const spacing = board.h * SPATIAL_RING_SPACING;
  const maxR = board.h * 0.5 + spacing * 3;
  const drift = spanProgress(t, 0, SPATIAL_BASE_SEC);

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000'}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', backgroundColor: bg, fontFamily: fontFamily('inter')}}>
        <svg width={board.w} height={board.h} viewBox={`0 0 ${board.w} ${board.h}`} style={{position: 'absolute', inset: 0}}>
          <g transform={`translate(${board.w / 2} ${board.h / 2})`} fill="none" stroke={ringColor} strokeWidth={Math.max(2, board.h * 0.004)}>
            {SPATIAL_RING_BIRTH_SEC.map((birth, k) => {
              if (t < birth) return null;
              const r = spacing * (k + 1.4) + drift * spacing * 1.1;
              const edge = Math.min(1, Math.max(0, (maxR - r) / (spacing * 2.5)));
              const opacity = spanProgress(t, birth, birth + SPATIAL_RING_FADE_SEC) * edge;
              if (opacity <= 0) return null;
              return <path key={k} d={squirclePath(r * 1.3, r)} opacity={opacity} />;
            })}
          </g>
        </svg>
        <div
          style={{
            position: 'absolute',
            left: frame.x * board.w,
            top: frame.y * board.h,
            transform: `translate(-50%, -50%) rotate(${frame.rotateDeg}deg) scale(${frame.scale})`,
            opacity: frame.fade,
            filter: frame.blurPx > 0.05 ? `blur(${frame.blurPx}px)` : undefined,
            textAlign: 'center',
            color: ink,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{fontSize: smallSize, fontWeight: 500, lineHeight: 1.15, opacity: 0.86}}>{copy[0]}</div>
          <div style={{fontSize: bigSize, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em'}}>{copy[1]}</div>
        </div>
      </div>
    </div>
  );
};
