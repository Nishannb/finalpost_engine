import React from 'react';

import {
  BLUR_CAROUSEL_BASE_SEC,
  BLUR_COLORS,
  BLUR_DEFAULT_WORDS,
  BLUR_LAYOUT,
  blurCarouselPos,
  blurRowStyle,
  blurTiltDeg,
  fitContain,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type BlurWordCarouselProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The list (2-12 words / short phrases). Default: the grammar's nine words. Text only ever comes from here. */
  words?: string[];
  /** One accent for this instance: it colours the active-row arrow (default white). */
  accent?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ROWS_EACH_SIDE = 4;

/**
 * CLIP_06 BLUR WORD CAROUSEL (WP46 Layer 2): a left-aligned word list on black that scrolls up one slot at a time (0.42 s ease-in-out move + 0.31 s hold per 0.73 s step). The active word is sharp white with a white arrow;
 * neighbours are grey and defocus progressively with distance (blur 1.5 / 5 / 10 px, strength 0.6 / 0.35 / 0.2, scale 0.88). The whole stack tilts about -8 degrees while it moves and -1 on the hold.
 * The only blur is this static depth-of-field on non-active rows (never motion blur); no cuts, zooms, glitches or glow. The layout is a 16:9 board centred in the frame; rows run on past it over the black ground. Silent.
 */
export const BlurWordCarousel: React.FC<BlurWordCarouselProps> = ({width, height, words, accent, durationInFrames}) => {
  const {t} = useTemplateClock(BLUR_CAROUSEL_BASE_SEC, durationInFrames);
  const list = words && words.length >= 2 ? words.slice(0, 12) : [...BLUR_DEFAULT_WORDS];
  const board = fitContain(16 / 9, width, height);
  const pos = Math.min(blurCarouselPos(t), list.length - 1);
  const pitch = board.h * BLUR_LAYOUT.slotPitch;
  const activeY = board.y + board.h * BLUR_LAYOUT.activeY;
  const textX = board.x + board.w * BLUR_LAYOUT.textX;
  const arrowX = board.x + board.w * BLUR_LAYOUT.arrowX;
  const fontSize = Math.round(board.h * 0.13);
  const arrowColor = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : BLUR_COLORS.active;

  const centre = Math.round(pos);
  const rows: React.ReactNode[] = [];
  for (let i = Math.max(0, centre - ROWS_EACH_SIDE); i <= Math.min(list.length - 1, centre + ROWS_EACH_SIDE); i++) {
    const d = i - pos;
    const style = blurRowStyle(d);
    const y = activeY + d * pitch;
    rows.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: Math.round(textX),
          top: Math.round(y),
          transform: `translateY(-50%) scale(${style.scale})`,
          transformOrigin: '0% 50%',
          whiteSpace: 'nowrap',
          fontFamily: `'Poppins', ${fontFamily('space_grotesk')}`,
          fontWeight: 700,
          fontSize,
          lineHeight: 1.1,
          color: style.color,
          opacity: style.strength,
          filter: style.blurPx > 0.05 ? `blur(${style.blurPx.toFixed(2)}px)` : undefined,
        }}
      >
        {list[i]}
      </div>,
    );
  }

  // the arrow belongs to the active slot: it rides with the list row nearest the active line and shrinks to nothing as that row leaves it
  const arrowRow = Math.round(pos);
  const arrowOffset = (arrowRow - pos) * pitch;
  const arrowScale = Math.max(0, 1 - Math.abs(arrowRow - pos) * 2);

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: BLUR_COLORS.ground}}>
      <div style={{position: 'absolute', inset: 0, transform: `rotate(${blurTiltDeg(t)}deg)`, transformOrigin: `${Math.round(arrowX)}px ${Math.round(activeY)}px`}}>
        {rows}
        {arrowScale > 0 ? (
          <svg
            width={fontSize * 0.9}
            height={fontSize * 0.9}
            viewBox="0 0 40 40"
            style={{position: 'absolute', left: Math.round(arrowX - (fontSize * 0.9) / 2), top: Math.round(activeY + arrowOffset - (fontSize * 0.9) / 2), transform: `scale(${arrowScale})`, transformOrigin: '50% 50%'}}
          >
            <path d="M5 20 H31 M21 9 L32 20 L21 31" fill="none" stroke={arrowColor} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>
    </div>
  );
};
