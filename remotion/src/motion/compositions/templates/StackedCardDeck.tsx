import React from 'react';

import {
  STACK_BASE_SEC,
  STACK_TONES,
  easeOutCubic,
  mix,
  stackState,
  stackTiltDeg,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type StackCard = {src?: string; label?: string};

export type StackedCardDeckProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** 2-6 square cards (grayscale). Default: 4 flat grey cards with no text. A label is static micro text and only ever comes from here. */
  cards?: StackCard[];
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const DEFAULT_CARDS: StackCard[] = [{}, {}, {}, {}];
const BEHIND_SCALE = 0.82;

/**
 * CLIP_04 STACKED CARD DECK (WP45 Layer 2): 1:1 grey cards stacked on black. card_stack_advance every 1.03 s (0.38 s swap + 0.65 s hold): the top card exits upward with a 3-5 degree tilt while the next scales
 * 0.82 -> 1 up from below the stack. Pure grayscale, solid dimming on the cards behind (no fade, no blur, no glow, no shadow).
 */
export const StackedCardDeck: React.FC<StackedCardDeckProps> = ({width, height, cards, durationInFrames}) => {
  const {t} = useTemplateClock(STACK_BASE_SEC, durationInFrames);
  const list = (cards && cards.length >= 2 ? cards : DEFAULT_CARDS).slice(0, 6);
  const n = list.length;
  const side = Math.round(Math.min(width, height) * 0.8);
  const state = stackState(t);
  const p = easeOutCubic(state.progress);
  const exitY = -(height / 2 + side);

  const layers: React.ReactNode[] = [];
  // draw the deepest first so the top card lands last (z order)
  for (let depth = 3; depth >= 0; depth--) {
    const absolute = state.completed + depth;
    const card = list[absolute % n]!;
    const tone = STACK_TONES[absolute % STACK_TONES.length]!;
    // resting depth -> (scale, y offset below the stack); during a swap each card moves one depth forward
    const at = (d: number) => ({scale: d === 0 ? 1 : d === 1 ? BEHIND_SCALE : BEHIND_SCALE * 0.9, y: d === 0 ? 0 : d === 1 ? side * 0.1 : side * 0.19, dim: d === 0 ? 0 : d === 1 ? 0.35 : 0.6});
    let scale: number;
    let y: number;
    let dim: number;
    let rot = 0;
    if (depth === 0) {
      scale = 1;
      y = exitY * p;
      dim = 0;
      rot = stackTiltDeg(state.completed) * p;
    } else {
      const from = at(depth);
      const to = at(depth - 1);
      scale = mix(from.scale, to.scale, p);
      y = mix(from.y, to.y, p);
      dim = mix(from.dim, to.dim, p);
    }
    layers.push(
      <div key={absolute} style={{position: 'absolute', left: Math.round((width - side) / 2), top: Math.round((height - side) / 2), width: side, height: side, transform: `translateY(${y}px) rotate(${rot}deg) scale(${scale})`, transformOrigin: '50% 50%', borderRadius: Math.round(side * 0.05), overflow: 'hidden', backgroundColor: tone}}>
        {card.src ? (
          <PhotoFill src={card.src} ground={tone} figure={tone} sun={tone} grayscale />
        ) : (
          <>
            <div style={{position: 'absolute', left: '29%', top: '24%', width: '42%', aspectRatio: '1 / 1', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.14)'}} />
            <div style={{position: 'absolute', left: '29%', top: '72%', width: '42%', height: '5%', backgroundColor: 'rgba(0,0,0,0.14)'}} />
          </>
        )}
        {card.label ? <div style={{position: 'absolute', left: '6%', top: '5%', fontFamily: fontFamily('inter'), fontWeight: 700, fontSize: Math.round(side * 0.032), letterSpacing: '0.04em', textTransform: 'uppercase', color: '#111111'}}>{card.label}</div> : null}
        {dim > 0 ? <div style={{position: 'absolute', inset: 0, backgroundColor: `rgba(0,0,0,${dim})`}} /> : null}
      </div>,
    );
  }

  return <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000000'}}>{layers}</div>;
};
