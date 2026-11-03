import React from 'react';
import {Img} from 'remotion';

import {ENTER_EASE_OUT, EXIT_EASE_IN, MOVE_IN_OUT, bezierAt, eased, phase} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {hexOr} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type ProductCursorClickProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The provided screenshot. Required upstream. */
  imageSrc?: string;
  /** Click target in 0..1 of the still (centre when omitted / invalid). */
  target?: {x: number; y: number};
  accent?: string;
  ground?: string;
  durationInFrames?: number;
};

export const CURSOR_CLICK_BASE_SEC = 3.0;

export const cursorTarget = (target?: {x: number; y: number}): {x: number; y: number} =>
  target && Number.isFinite(target.x) && Number.isFinite(target.y) ? {x: Math.min(0.95, Math.max(0.05, target.x)), y: Math.min(0.95, Math.max(0.05, target.y))} : {x: 0.5, y: 0.5};

/**
 * CLIP_42 PRODUCT CURSOR CLICK (WP54 / cutaway, gated): a cursor glides (moveInOut) from the lower-left over a PROVIDED still to the target, presses (a 0.92 dip) and a ripple rings out (ease-out, hero band); the still
 * pushes in slightly toward the target. Silent, owns the frame. Target is a coordinate or the centre fallback.
 */
export const ProductCursorClick: React.FC<ProductCursorClickProps> = ({width, height, imageSrc, target, accent, ground, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(CURSOR_CLICK_BASE_SEC, durationInFrames);
  const hot = hexOr(accent) ?? '#BFFF00';
  const bg = hexOr(ground) ?? '#0E1116';
  const tgt = cursorTarget(target);
  const boxW = width * 0.9;
  const boxH = height * 0.62;
  const left = (width - boxW) / 2;
  const top = height * 0.1;
  const move = eased(MOVE_IN_OUT, t, 0.25, 1.1);
  const start = {x: 0.12, y: 0.9};
  const cx = left + (start.x + (tgt.x - start.x) * move) * boxW;
  const cy = top + (start.y + (tgt.y - start.y) * move) * boxH;
  const press = phase(t, 1.4, 0.12);
  const ripple = bezierAt(ENTER_EASE_OUT, phase(t, 1.45, 0.7));
  const push = 1 + 0.05 * bezierAt(MOVE_IN_OUT, phase(t, 0, durSec));
  const exit = eased(EXIT_EASE_IN, t, Math.max(1.6, durSec - 0.3), 0.28);
  const cursor = Math.max(28, width * 0.045);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg}}>
      <div style={{position: 'absolute', left, top, width: boxW, height: boxH, overflow: 'hidden', borderRadius: width * 0.02, opacity: 1 - exit}}>
        <div style={{position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: `${tgt.x * 100}% ${tgt.y * 100}%`}}>
          {imageSrc ? <Img src={imageSrc} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <div style={{width: '100%', height: '100%', backgroundColor: '#fff'}} />}
        </div>
      </div>
      {ripple > 0 && ripple < 1 ? (
        <div style={{position: 'absolute', left: cx - cursor * 1.8 * ripple, top: cy - cursor * 1.8 * ripple, width: cursor * 3.6 * ripple, height: cursor * 3.6 * ripple, borderRadius: '50%', border: `${Math.max(3, cursor * 0.12)}px solid ${hot}`, opacity: 1 - ripple}} />
      ) : null}
      <svg style={{position: 'absolute', left: cx, top: cy, width: cursor, height: cursor * 1.3, opacity: 1 - exit, transform: `scale(${1 - 0.08 * Math.sin(Math.PI * press)})`, transformOrigin: '0 0'}} viewBox="0 0 20 26">
        <path d="M1 1 L1 20 L6 15.5 L9.5 23.5 L12.5 22 L9 14.5 L16 14.5 Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};
