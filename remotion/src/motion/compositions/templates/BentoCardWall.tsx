import React from 'react';

import {
  BENTO_CAMERA_BASE_SEC,
  BENTO_COLORS,
  BENTO_PALETTE_ORDER,
  bentoCamera,
  bentoLayout,
  bentoTranslate,
  type BentoKind,
  type BentoRect,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type BentoCard = {kind: 'ui' | 'photo'; src?: string; label?: string};

export type BentoCardWallProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The wall's cards (UI cards + photo cards). Default: a 12 card mix of both kinds with no text. Labels only ever come from here (never invented). */
  cards?: BentoCard[];
  /** The wall's single saturated accent (default yellow #F6D743). */
  accent?: string;
  /** Which card the camera pushes into (default: the 5th). */
  focusIndex?: number;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const DEFAULT_KINDS: BentoKind[] = ['ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'photo', 'ui', 'ui', 'photo', 'ui', 'ui'];

const isDark = (hex: string): boolean => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
};

const UiCard: React.FC<{rect: BentoRect; bg: string; label?: string; index: number}> = ({rect, bg, label, index}) => {
  const dark = isDark(bg);
  const ink = dark ? '#F4F4EF' : '#121212';
  const soft = dark ? 'rgba(244,244,239,0.28)' : 'rgba(18,18,18,0.16)';
  const pad = Math.min(rect.w, rect.h) * 0.09;
  const line = (widthFrac: number, top: number) => <div style={{position: 'absolute', left: pad, top, width: (rect.w - pad * 2) * widthFrac, height: Math.max(3, rect.h * 0.045), borderRadius: 99, backgroundColor: soft}} />;
  const bars = [0.5, 0.8, 0.35, 0.65].map((frac, i) => (
    <div key={i} style={{position: 'absolute', left: rect.w - pad - (4 - i) * (rect.w * 0.07), bottom: pad, width: rect.w * 0.05, height: rect.h * 0.3 * frac, backgroundColor: ink}} />
  ));
  return (
    <div style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, backgroundColor: bg, borderRadius: Math.min(rect.w, rect.h) * 0.07, overflow: 'hidden'}}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{position: 'absolute', left: pad + i * pad * 0.9, top: pad * 0.8, width: pad * 0.6, height: pad * 0.6, borderRadius: '50%', backgroundColor: i === 0 ? ink : soft}} />
      ))}
      {label ? (
        <div style={{position: 'absolute', left: pad, top: pad * 2, width: rect.w - pad * 2, fontFamily: fontFamily('inter'), fontWeight: 800, fontSize: Math.max(12, rect.h * 0.13), lineHeight: 1.05, letterSpacing: '-0.02em', color: ink, textTransform: 'uppercase'}}>{label}</div>
      ) : (
        <>
          {line(0.7, pad * 2.2)}
          {line(0.45, pad * 2.2 + rect.h * 0.1)}
        </>
      )}
      {rect.w > rect.h * 1.1 && index % 2 === 0 ? bars : null}
    </div>
  );
};

const PhotoCard: React.FC<{rect: BentoRect; tone: string; src?: string; accent?: string}> = ({rect, tone, src, accent}) => (
  <div style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: Math.min(rect.w, rect.h) * 0.07, overflow: 'hidden'}}>
    <PhotoFill src={src} ground={tone} figure={BENTO_COLORS.black} sun={accent ?? BENTO_COLORS.yellow} />
  </div>
);

/**
 * CLIP_03 BENTO CARD WALL (WP45 Layer 2): a justified wall of UI cards and photo cards (yellow / green / sage / white / black). The CAMERA is the motion: camera_creep (slow near-linear push on the wall) -> camera_jump_cut
 * (a HARD cut to a new framing: no dissolve) -> camera_ease_zoom (exp-decay push into one card) -> hold -> eased pull-back -> settle. No rotation, no motion blur, no fade; the wall never moves, only the camera.
 */
export const BentoCardWall: React.FC<BentoCardWallProps> = ({width, height, cards, focusIndex, accent, durationInFrames}) => {
  const {t} = useTemplateClock(BENTO_CAMERA_BASE_SEC, durationInFrames);
  const list: BentoCard[] = cards && cards.length >= 3 ? cards.slice(0, 16) : DEFAULT_KINDS.map(kind => ({kind}));
  const gap = Math.max(6, Math.round(Math.min(width, height) * 0.014));
  const rects = bentoLayout(list.map(card => card.kind), width, height, gap);
  const focus = rects[Math.min(rects.length - 1, Math.max(0, focusIndex ?? 4))]!;
  const camera = bentoCamera(t, {width, height}, focus);
  const {tx, ty} = bentoTranslate(camera, {width, height});

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: BENTO_COLORS.black}}>
      <div style={{position: 'absolute', left: 0, top: 0, width, height, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${camera.scale})`}}>
        {rects.map((rect, index) => {
          const card = list[index]!;
          const paletteKey = BENTO_PALETTE_ORDER[index % BENTO_PALETTE_ORDER.length]!;
          const tone = paletteKey === 'yellow' && accent ? accent : BENTO_COLORS[paletteKey];
          return card.kind === 'photo' ? <PhotoCard key={index} rect={rect} tone={tone} src={card.src} accent={accent} /> : <UiCard key={index} rect={rect} bg={tone} label={card.label} index={index} />;
        })}
      </div>
    </div>
  );
};
