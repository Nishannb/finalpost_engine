import React from 'react';

import {
  HERITAGE_BASE_SEC,
  HERITAGE_COLORS,
  HERITAGE_DEFAULT_LINES,
  HERITAGE_DEFAULT_MARK,
  HERITAGE_MICRO,
  HERITAGE_THUMB,
  fitContain,
  heritageFlash,
  heritageLineOffset,
  heritageMarkerStage,
  heritagePhotoRect,
  mix,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type HeritageDevotionPosterProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The portrait (default: a warm flat-colour silhouette stand-in). */
  imageSrc?: string;
  /** The headline lines (2-6; default WHERE / HERITAGE / & / DEVOTION / MEETS / ELEGANCE): the first half sits above the portrait, the rest below. */
  lines?: string[];
  /** The small mark above the portrait (default A°). Live polish passes a video-bound mark. */
  brandMark?: string;
  /** Hide the PARIS / MILAN / ACME / PR23 micro chrome (live polish). */
  hideMicro?: boolean;
  /** WP49: edit-palette ground / ink / accent (proof shell defaults only when unset). */
  ground?: string;
  ink?: string;
  accent?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 4 / 5;
const MARKER = 0.012;

/**
 * CLIP_13 HERITAGE DEVOTION POSTER (WP48 Layer 2 / layout C1): #FFFFFF, 4:5 artboard, 6.90 s loop.
 * Opens on hard_cut_fullbleed (photo + micro only — the capture start frame) -> scale_thumb_expand (expo-out shrink to the thumb) ->
 * corner_marker_converge (four black squares ~1.2% W land on the thumb, then open out around the headline block) -> line_mask_reveal (six lines rise through a mask, 70 ms stagger) -> text_marquee_y (up-out-and-in) ->
 * long finished-poster hold -> hard cut full bleed (== t 0). Demo micro/lines are proof-shell only; live polish binds video copy and may set hideMicro.
 * LAYOUT RULE: the photo is the BOTTOM layer and every piece of text is above it, drawn in ink and again in white clipped to the photo, so a headline can never be hidden by the photo;
 * the headline lines sit in their own zones above / below the thumb. microtext_frame never animates. Silent. No blur, glitch, glow or cross-fade; the photo is a plain rectangle.
 */
export const HeritageDevotionPoster: React.FC<HeritageDevotionPosterProps> = ({width, height, imageSrc, lines, brandMark, hideMicro = false, ground, ink, accent, durationInFrames}) => {
  const {t} = useTemplateClock(HERITAGE_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const copy = lines && lines.length >= 2 ? lines : [...HERITAGE_DEFAULT_LINES];
  const mark = brandMark && brandMark.trim() ? brandMark.trim() : HERITAGE_DEFAULT_MARK;
  const groundColor = ground && /^#[0-9a-fA-F]{6}$/.test(ground) ? ground : HERITAGE_COLORS.ground;
  const inkColor = ink && /^#[0-9a-fA-F]{6}$/.test(ink) ? ink : HERITAGE_COLORS.ink;
  const markerColor = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : inkColor;
  const photo = heritagePhotoRect(t);
  const flash = heritageFlash(t);
  const stage = heritageMarkerStage(t);

  const above = Math.ceil(copy.length / 2);
  const lineH = board.h * 0.046;
  const lineSize = lineH * 0.82;
  const microSize = board.w * 0.0205;
  const thumbTop = HERITAGE_THUMB.y * board.h;
  const thumbBottom = (HERITAGE_THUMB.y + HERITAGE_THUMB.h) * board.h;
  const markSize = board.w * 0.035;
  const aboveBottom = thumbTop - markSize * 2.2;
  const belowTop = thumbBottom + board.h * 0.025;

  const micro: React.CSSProperties = {position: 'absolute', fontFamily: fontFamily('space_grotesk'), fontWeight: 500, fontSize: microSize, lineHeight: 1, letterSpacing: '0.14em', whiteSpace: 'pre'};
  const masked = (key: string, top: number, offset: number, content: React.ReactNode, style: React.CSSProperties): React.ReactNode => (
    <div key={key} style={{position: 'absolute', left: 0, top: Math.round(top), width: board.w, height: lineH, overflow: 'hidden'}}>
      <div style={{width: '100%', height: lineH, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(${offset * 100}%)`, whiteSpace: 'pre', ...style}}>{content}</div>
    </div>
  );

  const textLayer = (color: string, key: string): React.ReactNode => {
    const headStyle: React.CSSProperties = {fontFamily: fontFamily('inter'), fontWeight: 800, fontSize: lineSize, lineHeight: 1, letterSpacing: '0.02em', color};
    const lineAt = (text: string, i: number): React.ReactNode => {
      const offset = heritageLineOffset(t, i);
      if (offset === null) return null;
      const top = i < above ? aboveBottom - (above - i) * lineH : belowTop + (i - above) * lineH;
      return masked(`line${i}`, top, offset, text, headStyle);
    };
    const markOffset = heritageLineOffset(t, 0);
    return (
      <div key={key} style={{position: 'absolute', inset: 0}}>
        {!hideMicro && (
          <>
            <div style={{...micro, left: board.w * 0.05, top: board.h * 0.03, color}}>{HERITAGE_MICRO.top[0]}</div>
            <div style={{...micro, left: 0, width: board.w, top: board.h * 0.03, textAlign: 'center', color}}>{HERITAGE_MICRO.top[1]}</div>
            <div style={{...micro, right: board.w * 0.05, top: board.h * 0.03, textAlign: 'right', color}}>{HERITAGE_MICRO.top[2]}</div>
            <div style={{...micro, left: 0, width: board.w, bottom: board.h * 0.03, textAlign: 'center', color}}>{HERITAGE_MICRO.bottom}</div>
          </>
        )}
        {markOffset !== null && masked('mark', aboveBottom + (markSize * 2.2 - lineH) / 2 - board.h * 0.004, markOffset, mark, {fontFamily: fontFamily('inter'), fontWeight: 700, fontSize: markSize, color})}
        {copy.map(lineAt)}
      </div>
    );
  };

  // Four black squares: board corners (0) -> thumb corners (1) -> corners of the headline block (2).
  const markerBox = (stageValue: number): {l: number; t: number; r: number; b: number} => {
    const outer = {l: board.w * 0.03, t: board.h * 0.075, r: board.w * 0.97, b: board.h * 0.925};
    const thumb = {l: HERITAGE_THUMB.x * board.w, t: thumbTop, r: (HERITAGE_THUMB.x + HERITAGE_THUMB.w) * board.w, b: thumbBottom};
    const block = {l: board.w * 0.2, t: board.h * 0.06, r: board.w * 0.8, b: board.h * 0.74};
    const from = stageValue < 1 ? outer : thumb;
    const to = stageValue < 1 ? thumb : block;
    const p = stageValue < 1 ? stageValue : stageValue - 1;
    return {l: mix(from.l, to.l, p), t: mix(from.t, to.t, p), r: mix(from.r, to.r, p), b: mix(from.b, to.b, p)};
  };
  const markerSide = board.w * MARKER;
  const corners = stage === null ? [] : (() => {
    const box = markerBox(stage);
    return [
      [box.l, box.t],
      [box.r, box.t],
      [box.l, box.b],
      [box.r, box.b],
    ] as const;
  })();

  const px = {left: photo.x * board.w, top: photo.y * board.h, width: photo.w * board.w, height: photo.h * board.h};
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: groundColor}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', backgroundColor: groundColor}}>
        <div style={{position: 'absolute', left: px.left, top: px.top, width: px.width, height: px.height, overflow: 'hidden'}}>
          <PhotoFill src={imageSrc} ground="#D8B99A" figure="#3A2A24" sun="#B8452A" />
        </div>
        {textLayer(inkColor, 'ink')}
        <div style={{position: 'absolute', inset: 0, clipPath: `inset(${px.top}px ${board.w - px.left - px.width}px ${board.h - px.top - px.height}px ${px.left}px)`}}>
          {textLayer(HERITAGE_COLORS.onPhoto, 'onPhoto')}
        </div>
        {!flash &&
          corners.map(([x, y], i) => (
            <div key={`corner${i}`} style={{position: 'absolute', left: Math.round(x - markerSide / 2), top: Math.round(y - markerSide / 2), width: markerSide, height: markerSide, backgroundColor: markerColor}} />
          ))}
      </div>
    </div>
  );
};
