import React from 'react';

import {
  EDITORIAL_BASE_SEC,
  EDITORIAL_COLORS,
  EDITORIAL_DEFAULT_LINES,
  EDITORIAL_MICRO,
  editorialLineOffset,
  editorialPhotoRect,
  editorialSplit,
  fitContain,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type EditorialInsetPosterProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The photo that sits under all the text (default: a flat silhouette stand-in). */
  imageSrc?: string;
  /** The hairline headline lines (2-6; default Ancient / Heritage / Modern / Elegance): the first half sits above the brand row, the rest below. */
  lines?: string[];
  /** Brand lockup split across the inset (default AC | ME). Live polish passes a video-bound word. */
  brand?: string;
  /** Hide PARIS / MILAN / FW25 micro chrome (live polish). */
  hideMicro?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;
const HAIRLINE_SERIF = `'Cormorant Garamond', 'Playfair Display', Georgia, 'Times New Roman', serif`;
/** The widest AC | ME gap, as a fraction of the artboard width (room for the inset photo between the two). */
const MAX_GAP = 0.26;

/**
 * CLIP_12 EDITORIAL INSET POSTER (WP47 Layer 2): #FDFDFD, 4:5 artboard, 5.30 s seamless loop. The photo is the BOTTOM layer; every piece of text is above it. inset_to_fullbleed: the inset photo between AC and ME grows to cover
 * the artboard (ease-out + settle) under fixed text, then a HARD cut to white. Text auto-contrasts by masking, not fading: it is drawn in ink and again in white clipped to the photo's rectangle, so it is white exactly where the
 * photo is. line_mask_reveal: the hairline italic headlines rise through a horizontal mask one after another (0.10 s stagger, 0.35 s each). Then AC | ME split while the photo returns from a dot to the inset. microtext_frame:
 * the micro lines (PARIS | MILAN, ACME, EST.1992, FW25) never animate except by that contrast. Silent. No blur, glitch, glow or cross-fade.
 */
function brandHalves(brand: string | undefined): [string, string] {
  const raw = (brand && brand.trim() ? brand.trim() : 'ACME').toUpperCase().slice(0, 8);
  if (raw.length <= 1) return [raw, ''];
  const mid = Math.ceil(raw.length / 2);
  return [raw.slice(0, mid), raw.slice(mid)];
}

export const EditorialInsetPoster: React.FC<EditorialInsetPosterProps> = ({width, height, imageSrc, lines, brand, hideMicro = false, durationInFrames}) => {
  const {t} = useTemplateClock(EDITORIAL_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const copy = lines && lines.length >= 2 ? lines : [...EDITORIAL_DEFAULT_LINES];
  const [leftBrand, rightBrand] = brandHalves(brand);
  const photo = editorialPhotoRect(t);
  const split = editorialSplit(t);

  const bigSize = board.w * 0.22;
  const microSize = board.w * 0.022;
  const lineSize = board.w * 0.075;
  const lineH = board.w * 0.095;
  const capHalf = bigSize * 0.37;
  const cy = board.h / 2;
  const above = Math.ceil(copy.length / 2);

  const micro: React.CSSProperties = {position: 'absolute', fontFamily: fontFamily('space_grotesk'), fontWeight: 500, fontSize: microSize, lineHeight: 1, letterSpacing: '0.14em', whiteSpace: 'pre'};
  const maskedLine = (text: string, index: number, color: string): React.ReactNode => {
    const offset = editorialLineOffset(t, index);
    if (offset === null) return null;
    const row = index < above ? index : index - above;
    const centreY = index < above ? cy - capHalf - board.w * 0.05 - (above - 1 - row + 0.5) * lineH : cy + capHalf + board.w * 0.05 + (row + 0.5) * lineH;
    return (
      <div key={`line${index}`} style={{position: 'absolute', left: 0, top: Math.round(centreY - lineH / 2), width: board.w, height: lineH, overflow: 'hidden'}}>
        <div style={{width: '100%', height: lineH, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(${offset * 100}%)`, fontFamily: HAIRLINE_SERIF, fontStyle: 'italic', fontWeight: 300, fontSize: lineSize, lineHeight: 1, color, whiteSpace: 'pre'}}>{text}</div>
      </div>
    );
  };

  /** All the text in one ink colour; drawn twice (ink, then white clipped to the photo) for the auto-contrast. */
  const textLayer = (color: string, key: string): React.ReactNode => (
    <div key={key} style={{position: 'absolute', inset: 0}}>
      {!hideMicro && (
        <>
          <div style={{...micro, left: board.w * 0.05, top: board.h * 0.035, color}}>{EDITORIAL_MICRO.top[0]}</div>
          <div style={{...micro, left: 0, width: board.w, top: board.h * 0.035, textAlign: 'center', color}}>{EDITORIAL_MICRO.top[1]}</div>
          <div style={{...micro, right: board.w * 0.05, top: board.h * 0.035, textAlign: 'right', color}}>{EDITORIAL_MICRO.top[2]}</div>
          <div style={{...micro, left: 0, width: board.w, bottom: board.h * 0.035, textAlign: 'center', color}}>{EDITORIAL_MICRO.bottom}</div>
        </>
      )}
      <div style={{position: 'absolute', left: 0, top: Math.round(cy - bigSize / 2), width: board.w, height: bigSize, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: split * MAX_GAP * board.w, fontFamily: fontFamily('inter'), fontWeight: 800, fontSize: bigSize, lineHeight: 1, letterSpacing: '-0.02em', color, whiteSpace: 'pre'}}>
        <span>{leftBrand}</span>
        <span>{rightBrand}</span>
      </div>
      {copy.map((text, i) => maskedLine(text, i, color))}
    </div>
  );

  const px = photo ? {left: photo.x * board.w, top: photo.y * board.h, width: photo.w * board.w, height: photo.h * board.h} : null;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: EDITORIAL_COLORS.ground}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', backgroundColor: EDITORIAL_COLORS.ground}}>
        {px && (
          <div style={{position: 'absolute', left: px.left, top: px.top, width: px.width, height: px.height, overflow: 'hidden'}}>
            <PhotoFill src={imageSrc} ground="#D9C7A8" figure="#2B2A33" sun="#E4572E" />
          </div>
        )}
        {textLayer(EDITORIAL_COLORS.ink, 'ink')}
        {px && (
          <div style={{position: 'absolute', inset: 0, clipPath: `inset(${px.top}px ${board.w - px.left - px.width}px ${board.h - px.top - px.height}px ${px.left}px)`}}>
            {textLayer(EDITORIAL_COLORS.onPhoto, 'onPhoto')}
          </div>
        )}
      </div>
    </div>
  );
};
