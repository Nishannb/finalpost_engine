import React from 'react';

import {
  NESTED_COLORS,
  NESTED_CUT_SEC,
  NESTED_DEFAULT_LINES,
  NESTED_LAYERS,
  NESTED_RECT_BASE_SEC,
  NESTED_TYPE_CPS,
  NESTED_TYPE_START_SEC,
  nestedRectScale,
  typewriterChars,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type NestedRectTitleWipeProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The photo that grows last (default: a flat silhouette stand-in). */
  imageSrc?: string;
  /** The two typed lines: [serif title, sans subtitle]. Default: the grammar's two lines. */
  lines?: [string, string];
  /** One accent for this instance: the blue corner wedges / diamonds (default blue). */
  accent?: string;
  /** Show the finished title for the first 0.83 s before the hard cut to pale blue (the reference loop does). Default false: the beat starts AT the cut. */
  leadHold?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const SERIF = `'Playfair Display', Georgia, 'Times New Roman', serif`;

/** Cover-sized SVG layers authored in frame space (so they scale in LOCAL space with their rect). */
const NavyArcs: React.FC<{w: number; h: number}> = ({w, h}) => {
  const step = Math.min(w, h) * 0.09;
  return (
    <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
      {Array.from({length: 7}, (_, i) => (
        <React.Fragment key={i}>
          <circle cx={0} cy={h} r={step * (i + 2)} fill="none" stroke={NESTED_COLORS.pink} strokeWidth={step * 0.28} />
          <circle cx={w} cy={0} r={step * (i + 2)} fill="none" stroke={NESTED_COLORS.pink} strokeWidth={step * 0.28} />
        </React.Fragment>
      ))}
    </svg>
  );
};

const LightGrid: React.FC<{w: number; h: number}> = ({w, h}) => {
  const cell = Math.min(w, h) / 8;
  const lines: React.ReactNode[] = [];
  for (let x = cell; x < w; x += cell) lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={h} stroke={NESTED_COLORS.lightBlue} strokeWidth={Math.max(2, cell * 0.04)} />);
  for (let y = cell; y < h; y += cell) lines.push(<line key={`y${y}`} x1={0} y1={y} x2={w} y2={y} stroke={NESTED_COLORS.lightBlue} strokeWidth={Math.max(2, cell * 0.04)} />);
  return <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>{lines}</svg>;
};

const Diamonds: React.FC<{w: number; h: number; color: string}> = ({w, h, color}) => {
  const cell = Math.min(w, h) / 5;
  const items: React.ReactNode[] = [];
  for (let r = 0; r * cell < h + cell; r++) {
    for (let c = 0; c * cell < w + cell; c++) {
      const cx = c * cell + (r % 2 === 0 ? cell / 2 : 0);
      const cy = r * cell + cell / 2;
      items.push(<path key={`${r}-${c}`} d={`M${cx} ${cy - cell * 0.3} L${cx + cell * 0.3} ${cy} L${cx} ${cy + cell * 0.3} L${cx - cell * 0.3} ${cy} Z`} fill={color} />);
    }
  }
  return <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>{items}</svg>;
};

const CornerWedges: React.FC<{w: number; h: number; color: string}> = ({w, h, color}) => {
  const s = Math.min(w, h) * 0.22;
  return (
    <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
      <path d={`M0 0 L${s} 0 L0 ${s} Z`} fill={color} />
      <path d={`M${w} 0 L${w - s} 0 L${w} ${s} Z`} fill={color} />
      <path d={`M0 ${h} L${s} ${h} L0 ${h - s} Z`} fill={color} />
      <path d={`M${w} ${h} L${w - s} ${h} L${w} ${h - s} Z`} fill={color} />
    </svg>
  );
};

/**
 * CLIP_08 NESTED RECT TITLE WIPE (WP46 Layer 2): a HARD cut to pale blue (#ABCDEE), then six frame-shaped rects grow from the exact centre in an overlapping ease-in cascade (navy + pink arcs, cream, navy + light-blue grid,
 * pink, navy + blue diamonds, then the photo with blue corner wedges to full bleed). Every layer is scaled as a whole, so its inner graphics scale in local space and are clipped to its own rectangle. From 3.95 s two parallel
 * lines type at 37 chars / s with no caret (serif title + sans subtitle), then the end-state holds. No blur, glitch, shake, glow or cross-fade. Silent. The caller owns the frame (a template mutes captions).
 */
export const NestedRectTitleWipe: React.FC<NestedRectTitleWipeProps> = ({width, height, imageSrc, lines, accent, leadHold = false, durationInFrames}) => {
  const {t} = useTemplateClock(NESTED_RECT_BASE_SEC, durationInFrames);
  const copy = lines && lines.length === 2 ? lines : [...NESTED_DEFAULT_LINES];
  const blue = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : NESTED_COLORS.blue;
  // timeline time: the end-state is shown first only when leadHold is on; otherwise the beat starts at the cut
  const T = leadHold ? t : t + NESTED_CUT_SEC;
  const endState = T < NESTED_CUT_SEC;

  // typed lines: type size fits the longest line across 90 % of the width
  const longest = Math.max(copy[0]!.length, copy[1]!.length, 1);
  const titleSize = Math.round(Math.min(height * 0.07, (width * 0.9) / (longest * 0.52)));
  const subSize = Math.round(titleSize * 0.62);
  const typed = (index: 0 | 1): string => {
    const text = copy[index]!;
    return text.slice(0, endState ? text.length : typewriterChars(T, NESTED_TYPE_START_SEC, NESTED_TYPE_CPS, text.length));
  };
  const plateH = Math.round(titleSize * 2.9);

  const layers: React.ReactNode[] = [];
  NESTED_LAYERS.forEach((layer, index) => {
    const s = endState ? 1 : nestedRectScale(T, index);
    if (s <= 0) return;
    let content: React.ReactNode = null;
    let ground: string = NESTED_COLORS.navy;
    if (layer.id === 'navy_arcs') content = <NavyArcs w={width} h={height} />;
    else if (layer.id === 'cream') ground = NESTED_COLORS.cream;
    else if (layer.id === 'navy_grid') content = <LightGrid w={width} h={height} />;
    else if (layer.id === 'pink') ground = NESTED_COLORS.pink;
    else if (layer.id === 'navy_diamonds') content = <Diamonds w={width} h={height} color={blue} />;
    else {
      content = (
        <>
          <PhotoFill src={imageSrc} ground="#E9D8B8" figure="#3A2A1C" sun="#F2A33A" />
          <CornerWedges w={width} h={height} color={blue} />
          <div style={{position: 'absolute', left: 0, top: Math.round(height * 0.5 - plateH / 2), width, height: plateH, backgroundColor: NESTED_COLORS.navy}} />
        </>
      );
    }
    layers.push(
      <div key={layer.id} style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: layer.id === 'photo' ? '#000000' : ground, transform: `scale(${s})`, transformOrigin: '50% 50%'}}>
        {content}
      </div>,
    );
  });

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: endState ? NESTED_COLORS.navy : NESTED_COLORS.paleBlue}}>
      {layers}
      <div style={{position: 'absolute', left: Math.round(width * 0.05), top: Math.round(height * 0.5 - plateH / 2 + plateH * 0.16), whiteSpace: 'pre', fontFamily: SERIF, fontWeight: 700, fontSize: titleSize, lineHeight: 1.15, color: NESTED_COLORS.cream}}>{typed(0)}</div>
      <div style={{position: 'absolute', left: Math.round(width * 0.05), top: Math.round(height * 0.5 - plateH / 2 + plateH * 0.6), whiteSpace: 'pre', fontFamily: fontFamily('inter'), fontWeight: 600, fontSize: subSize, lineHeight: 1.15, letterSpacing: '0.03em', color: NESTED_COLORS.paleBlue}}>{typed(1)}</div>
    </div>
  );
};
