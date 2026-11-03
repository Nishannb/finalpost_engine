import React from 'react';

import {ENTER_EASE_OUT, MOVE_IN_OUT, bezierAt, eased, phase} from '../../../lib/craftTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, mixHex, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

/** The anidoodle style allowlist (mirrors planVisualBackendBeats DOODLE_STYLE_ALLOWLIST). */
export const DOODLE_STYLES = ['cut-paper', 'pencil-watercolor', 'isometric', 'risograph', 'marker-comic', 'pixel', 'chalkboard', 'cyanotype'] as const;
export type DoodleStyleId = (typeof DOODLE_STYLES)[number];

export type DoodleDrawOnProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** One of the 8-style allowlist; anything else falls back to cut-paper. */
  style?: string;
  /** Up to three short labels, each a substring of the spoken sentence (input -> process -> output). Omitted = unlabeled shapes. */
  labels?: string[];
  accent?: string;
  ground?: string;
  ink?: string;
  durationInFrames?: number;
};

export const DOODLE_BASE_SEC = 4.6;

type Look = {ground: string; paper: string; ink: string; fill: boolean; stroke: number; shadow: boolean; wobble: number; dash?: string; radius: number};
const LOOKS: Record<DoodleStyleId, Look> = {
  'cut-paper': {ground: '#F1E9DA', paper: '#FFFFFF', ink: '#1B1B1B', fill: true, stroke: 0, shadow: true, wobble: 5, radius: 10},
  'pencil-watercolor': {ground: '#FBF8F1', paper: '#E9EFF5', ink: '#4A4A4A', fill: true, stroke: 3, shadow: false, wobble: 9, radius: 14},
  isometric: {ground: '#EEF1F6', paper: '#FFFFFF', ink: '#233044', fill: true, stroke: 3, shadow: true, wobble: 0, radius: 4},
  risograph: {ground: '#F6F1E6', paper: '#FFFFFF', ink: '#1E3FAE', fill: true, stroke: 4, shadow: false, wobble: 2, radius: 6},
  'marker-comic': {ground: '#FFFDF2', paper: '#FFFFFF', ink: '#111111', fill: true, stroke: 7, shadow: false, wobble: 3, radius: 8},
  pixel: {ground: '#121826', paper: '#1F2A44', ink: '#F4F4F4', fill: true, stroke: 6, shadow: false, wobble: 0, radius: 0},
  chalkboard: {ground: '#1F3A2F', paper: 'transparent', ink: '#F2F2EA', fill: false, stroke: 5, shadow: false, wobble: 6, dash: '1 0', radius: 12},
  cyanotype: {ground: '#0F3B6B', paper: 'transparent', ink: '#E7F1FF', fill: false, stroke: 4, shadow: false, wobble: 2, radius: 6},
};

export const safeDoodleStyleId = (style?: string): DoodleStyleId => ((DOODLE_STYLES as readonly string[]).includes(style ?? '') ? (style as DoodleStyleId) : 'cut-paper');

/** Deterministic hand wobble (frame-stable: a render never changes between frames or machines). */
const jit = (seed: number, amp: number): number => Math.sin(seed * 12.9898) * amp;

function blobPath(x: number, y: number, w: number, h: number, wobble: number, seed: number, radius: number): string {
  const p = (px: number, py: number, k: number) => `${(px + jit(seed + k, wobble)).toFixed(1)} ${(py + jit(seed + k + 7, wobble)).toFixed(1)}`;
  const r = radius;
  return `M ${p(x + r, y, 1)} L ${p(x + w - r, y, 2)} Q ${p(x + w, y, 3)} ${p(x + w, y + r, 4)} L ${p(x + w, y + h - r, 5)} Q ${p(x + w, y + h, 6)} ${p(x + w - r, y + h, 7)} L ${p(x + r, y + h, 8)} Q ${p(x, y + h, 9)} ${p(x, y + h - r, 10)} L ${p(x, y + r, 11)} Q ${p(x, y, 12)} ${p(x + r, y, 13)} Z`;
}

/**
 * CLIP_34 DOODLE DRAW-ON (WP54 / cutaway, native fallback for the anidoodle backend): a procedural explain diagram (input -> process -> output) drawn on by itself — no engine, no music, no vendor tree. Three shapes pop in as paper cut-outs
 * (or inked outlines for chalkboard / cyanotype) while arrows DRAW ON via stroke-dashoffset, hold, then leave. Style comes from the 8-style allowlist (default cut-paper). Silent, owns the frame.
 */
export const DoodleDrawOn: React.FC<DoodleDrawOnProps> = ({width, height, style, labels, accent, ground, ink, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(DOODLE_BASE_SEC, durationInFrames);
  const look = LOOKS[safeDoodleStyleId(style)];
  const edit = hexOr(accent);
  const bg = hexOr(ground) && !style ? (hexOr(ground) as string) : look.ground;
  const penBase = hexOr(ink) && !style ? (hexOr(ink) as string) : look.ink;
  const pen = penBase;
  const hot = edit ?? mixHex(penBase, '#FF5A36', 0.7);
  const W = 1000;
  const H = (height / width) * 1000;
  const boxW = 250;
  const boxH = 250;
  const cy = H * 0.42;
  const xs = [W * 0.05, W * 0.375, W * 0.7];
  const names = (labels ?? []).slice(0, 3);
  const exit = eased(MOVE_IN_OUT, t, Math.max(2.2, durSec - 0.45), 0.4);
  const arrows = [0, 1].map(i => {
    const x1 = xs[i]! + boxW + 14;
    const x2 = xs[i + 1]! - 14;
    return {x1, x2, len: x2 - x1};
  });
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg, fontFamily: fontFamily('inter')}}>
      <svg viewBox={`0 0 ${W} ${H}`} width={width} height={height} style={{position: 'absolute', inset: 0, opacity: 1 - exit}}>
        {xs.map((x, i) => {
          const pop = bezierAt(ENTER_EASE_OUT, phase(t, 0.15 + i * 0.75, 0.45));
          const accentBox = i === 2;
          const fill = look.fill ? (accentBox ? hot : look.paper) : 'none';
          const stroke = look.stroke > 0 || !look.fill ? Math.max(look.stroke, 4) : 0;
          const cx = x + boxW / 2;
          return (
            <g key={i} transform={`translate(${cx} ${cy}) scale(${0.6 + 0.4 * pop}) translate(${-cx} ${-cy})`} opacity={Math.min(1, pop * 1.5)}>
              {look.shadow ? <path d={blobPath(x + 10, cy - boxH / 2 + 12, boxW, boxH, look.wobble, i * 3 + 1, look.radius)} fill={mixHex(bg, '#000000', 0.18)} /> : null}
              <path d={blobPath(x, cy - boxH / 2, boxW, boxH, look.wobble, i * 3 + 2, look.radius)} fill={fill} stroke={stroke ? pen : 'none'} strokeWidth={stroke} strokeLinejoin="round" />
              {i === 0 ? <circle cx={cx} cy={cy} r={boxW * 0.2} fill="none" stroke={look.fill && !accentBox ? hot : pen} strokeWidth={Math.max(5, look.stroke)} /> : null}
              {i === 1 ? <path d={`M ${cx - 60} ${cy + 40} L ${cx} ${cy - 50} L ${cx + 60} ${cy + 40} Z`} fill="none" stroke={pen} strokeWidth={Math.max(5, look.stroke)} strokeLinejoin="round" /> : null}
              {i === 2 ? <path d={`M ${cx - 55} ${cy} L ${cx - 15} ${cy + 40} L ${cx + 60} ${cy - 40}`} fill="none" stroke={look.fill ? readableInk(hot, '#FFFFFF', '#111111') : pen} strokeWidth={Math.max(8, look.stroke + 2)} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {names[i] ? (
                <text x={cx} y={cy + boxH / 2 + 62} textAnchor="middle" fontSize={44} fontWeight={800} fill={pen}>
                  {names[i]}
                </text>
              ) : null}
            </g>
          );
        })}
        {arrows.map((a, i) => {
          const p = eased(MOVE_IN_OUT, t, 0.55 + i * 0.75, 0.55);
          const wob = jit(i + 40, look.wobble);
          return (
            <g key={i} stroke={pen} strokeWidth={Math.max(6, look.stroke + 1)} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <path d={`M ${a.x1} ${cy} Q ${(a.x1 + a.x2) / 2} ${cy + wob * 4} ${a.x2} ${cy}`} strokeDasharray={a.len * 1.05} strokeDashoffset={a.len * 1.05 * (1 - p)} />
              <path d={`M ${a.x2 - 26} ${cy - 24} L ${a.x2} ${cy} L ${a.x2 - 26} ${cy + 24}`} strokeDasharray={80} strokeDashoffset={80 * (1 - phase(p, 0.7, 0.3))} />
            </g>
          );
        })}
      </svg>
    </div>
  );
};
