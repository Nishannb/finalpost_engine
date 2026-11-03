import React from 'react';

import {PUSH_BASE_SEC, PUSH_CARD, PUSH_COLORS, PUSH_COUNT, PUSH_STILL_TONES, fitContain, mix, pushState, pushTravel} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type PortraitPushCarouselProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Up to three portrait stills (A, B, C); a missing one is a silhouette stand-in in the grammar's tone (cool grey / teal / neon dark). */
  imageUrls?: string[];
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;

/**
 * CLIP_16 PORTRAIT PUSH CAROUSEL (WP48 Layer 2 / layout C4): #FFFFFF, 4:5 artboard, 4.35 s loop, no text. Three rectangular portrait cards. Hold A (1.5% micro zoom) -> vertical_push A to B (1.0 s, inOutCubic: the
 * leaving card rises and eases to 0.94, the entering one rises from below and grows 0.9 -> 1, a 7.5% white gap between them at every frame) -> hold B -> push B to C (1.05 s) -> hard wrap to A.
 * Silent. No captions, blur, glow, bounce or cross-fade.
 */
export const PortraitPushCarousel: React.FC<PortraitPushCarouselProps> = ({width, height, imageUrls, durationInFrames}) => {
  const {t} = useTemplateClock(PUSH_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const state = pushState(t);
  const cardW = PUSH_CARD.w * board.w;
  const cardH = PUSH_CARD.h * board.h;
  const travel = pushTravel(cardH, board.h);
  const cy = board.h / 2;

  const card = (index: number, centreY: number, scale: number): React.ReactNode => {
    const tone = PUSH_STILL_TONES[index % PUSH_COUNT]!;
    const src = imageUrls && imageUrls.length > 0 ? imageUrls[index % imageUrls.length] : undefined;
    return (
      <div key={`card${index}`} style={{position: 'absolute', left: Math.round((board.w - cardW) / 2), top: Math.round(centreY - cardH / 2), width: Math.round(cardW), height: Math.round(cardH), overflow: 'hidden', transform: `scale(${scale})`, transformOrigin: '50% 50%'}}>
        <PhotoFill src={src} ground={tone.ground} figure={tone.figure} sun={tone.sun} />
      </div>
    );
  };

  const holding = state.from === state.to;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: PUSH_COLORS.ground}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', backgroundColor: PUSH_COLORS.ground}}>
        {card(state.from, mix(cy, cy - travel, state.e), state.outScale)}
        {!holding && card(state.to, mix(cy + travel, cy, state.e), state.inScale)}
      </div>
    </div>
  );
};
