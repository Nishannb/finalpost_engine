import React from 'react';

import {
  SILK_BASE_SEC,
  SILK_COLORS,
  SILK_DEFAULT_BODY,
  SILK_DEFAULT_LINES,
  SILK_DEFAULT_WORDMARK,
  SILK_MICRO,
  SILK_THUMB,
  fitContain,
  silkBodyOffset,
  silkLineOffset,
  silkPhotoRect,
  silkWordmarkOffset,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type SilkLegacyCoverProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The portrait (default: a flat grey silhouette stand-in; a real still is shown in black and white). */
  imageSrc?: string;
  /** The three headline lines (default SINCE—1972 / A LEGACY / WOVEN IN SILK). */
  lines?: [string, string, string];
  /** The giant in-image wordmark (default ACME in the demo; none when `hideMicro` and no wordmark is passed). */
  wordmark?: string;
  /** Small-caps body copy near the bottom (default: the demo line; none when `hideMicro` and no body is passed). */
  body?: string;
  /** Hide the PARIS / MILAN / ACME / EST. micro chrome and the demo copy (live polish). */
  hideMicro?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;

/**
 * CLIP_14 SILK LEGACY COVER (WP48 Layer 2 / layout C2): #FFFFFF, 4:5 artboard, 3.05 s seamless loop. B&W portrait thumb (18% W) between headline and body -> scale_thumb_expand (expo-out) to cover with a 4% white inset while the type
 * clears through its masks (and, if it still overlaps the growing photo, is drawn white on the photo: photo BELOW text) -> text_behind_subject (giant white wordmark between the photo and the subject; silhouette occlusion with the stand-in)
 * -> hard cut -> blank_beat_white (micro labels only, 0.3 s) -> thumb + body return and line_mask_reveal rebuilds SINCE—1972 / A LEGACY / WOVEN IN SILK (90 ms stagger) (== t 0). microtext_frame never animates.
 * Silent. No blur, glitch, glow or cross-fade.
 */
export const SilkLegacyCover: React.FC<SilkLegacyCoverProps> = ({width, height, imageSrc, lines, wordmark, body, hideMicro = false, durationInFrames}) => {
  const {t} = useTemplateClock(SILK_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const copy = lines && lines.length === 3 ? lines : [...SILK_DEFAULT_LINES];
  const word = (wordmark && wordmark.trim() ? wordmark.trim() : hideMicro ? '' : SILK_DEFAULT_WORDMARK).toUpperCase();
  const bodyLines = body && body.trim() ? [body.trim()] : hideMicro ? [] : [...SILK_DEFAULT_BODY];
  const photo = silkPhotoRect(t);
  const wordOffset = word ? silkWordmarkOffset(t) : null;
  const bodyOffset = bodyLines.length ? silkBodyOffset(t) : null;

  const lineH = board.h * 0.074;
  const lineSize = lineH * 0.8;
  const microSize = board.w * 0.0205;
  const bodySize = board.w * 0.022;
  const bodyLineH = bodySize * 1.7;
  const thumbTop = SILK_THUMB.y * board.h;
  const headBottom = thumbTop - board.h * 0.04;
  const bodyTop = board.h * 0.84;

  const micro: React.CSSProperties = {position: 'absolute', fontFamily: fontFamily('space_grotesk'), fontWeight: 500, fontSize: microSize, lineHeight: 1, letterSpacing: '0.14em', whiteSpace: 'pre'};
  const masked = (key: string, top: number, h: number, offset: number, content: React.ReactNode, style: React.CSSProperties): React.ReactNode => (
    <div key={key} style={{position: 'absolute', left: 0, top: Math.round(top), width: board.w, height: h, overflow: 'hidden'}}>
      <div style={{width: '100%', height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(${offset * 100}%)`, whiteSpace: 'pre', ...style}}>{content}</div>
    </div>
  );

  const textLayer = (color: string, key: string): React.ReactNode => (
    <div key={key} style={{position: 'absolute', inset: 0}}>
      {!hideMicro && (
        <>
          <div style={{...micro, left: board.w * 0.05, top: board.h * 0.014, color}}>{SILK_MICRO.top[0]}</div>
          <div style={{...micro, left: 0, width: board.w, top: board.h * 0.014, textAlign: 'center', color}}>{SILK_MICRO.top[1]}</div>
          <div style={{...micro, right: board.w * 0.05, top: board.h * 0.014, textAlign: 'right', color}}>{SILK_MICRO.top[2]}</div>
        </>
      )}
      {copy.map((text, i) => {
        const offset = silkLineOffset(t, i);
        if (offset === null) return null;
        return masked(`line${i}`, headBottom - (copy.length - i) * lineH, lineH, offset, text, {fontFamily: fontFamily('inter'), fontWeight: 800, fontSize: lineSize, lineHeight: 1, letterSpacing: '0.01em', color});
      })}
      {bodyOffset !== null &&
        bodyLines.map((text, i) => masked(`body${i}`, bodyTop + i * bodyLineH, bodyLineH, bodyOffset, text, {fontFamily: fontFamily('inter'), fontWeight: 500, fontSize: bodySize, letterSpacing: '0.16em', color}))}
    </div>
  );

  const px = photo ? {left: photo.x * board.w, top: photo.y * board.h, width: photo.w * board.w, height: photo.h * board.h} : null;
  const wordSize = Math.min(board.w * 0.34, (board.w * 0.86) / Math.max(2, word.length * 0.74));
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: SILK_COLORS.ground}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', backgroundColor: SILK_COLORS.ground}}>
        {px && (
          <div style={{position: 'absolute', left: px.left, top: px.top, width: px.width, height: px.height, overflow: 'hidden'}}>
            <PhotoFill src={imageSrc} ground="#9A9A9A" figure="#1E1E1E" sun="#E6E6E6" grayscale layer="ground" />
            {wordOffset !== null && (
              <div style={{position: 'absolute', left: 0, top: Math.round(px.height * 0.3), width: px.width, height: Math.round(wordSize * 1.05), overflow: 'hidden'}}>
                <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(${wordOffset * 100}%)`, fontFamily: fontFamily('inter'), fontWeight: 900, fontSize: wordSize, lineHeight: 1, letterSpacing: '-0.02em', color: SILK_COLORS.onPhoto, whiteSpace: 'pre'}}>{word}</div>
              </div>
            )}
            <PhotoFill src={imageSrc} ground="#9A9A9A" figure="#1E1E1E" sun="#E6E6E6" grayscale layer="figure" />
          </div>
        )}
        {textLayer(SILK_COLORS.ink, 'ink')}
        {px && (
          <div style={{position: 'absolute', inset: 0, clipPath: `inset(${px.top}px ${board.w - px.left - px.width}px ${board.h - px.top - px.height}px ${px.left}px)`}}>
            {textLayer(SILK_COLORS.onPhoto, 'onPhoto')}
          </div>
        )}
      </div>
    </div>
  );
};
