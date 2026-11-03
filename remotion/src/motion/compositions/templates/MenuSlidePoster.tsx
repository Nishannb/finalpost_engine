import React from 'react';
import {Img} from 'remotion';

import {MENU_BASE_SEC, MENU_COLORS, MENU_DEFAULT_SLIDES, MENU_FOOTER, MENU_SLIDE_COUNT, fitContain, menuLayerPositions, type MenuStandIn} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type MenuSlide = {
  /** Two headline lines (ALL CAPS is applied by the comp). */
  headline: [string, string];
  /** A cut-out photo (transparent PNG) of the item; without it a flat vector stand-in is drawn (none on the end card). */
  photoSrc?: string;
};

export type MenuSlidePosterProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** 2-4 slides (default: BACON CLUB / HAM & GREENS / GRILL CHEESE / ACME BAKERY end card). Fewer than four repeat in order. */
  slides?: MenuSlide[];
  /** Hide hours/address footer microtext (live polish). */
  hideFooter?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const ARTBOARD_ASPECT = 1;
/** Headline widening: ultra-extended black grotesque from the bundled Inter Black. */
const EXTEND_X = 1.3;
const LINE_ADVANCE = 0.62;

/** Flat vector food cut-outs (stand-ins for the photographed item; solid fills only). */
const StandIn: React.FC<{kind: Exclude<MenuStandIn, 'none'>; w: number; h: number}> = ({kind, w, h}) => (
  <svg width={w} height={h} viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet" style={{display: 'block'}}>
    {kind === 'club' && (
      <>
        <rect x={8} y={50} width={84} height={18} rx={9} fill="#E2B26B" />
        <rect x={6} y={44} width={88} height={7} rx={3.5} fill="#5FAE45" />
        <rect x={10} y={37} width={80} height={8} rx={4} fill="#D9402B" />
        <rect x={8} y={30} width={84} height={8} rx={4} fill="#8B3A22" />
        <rect x={12} y={24} width={76} height={7} rx={3.5} fill="#F3D27A" />
        <path d="M6 24 C6 4 94 4 94 24 Z" fill="#E9BE7C" />
        {[24, 40, 56, 72].map(x => (
          <ellipse key={x} cx={x} cy={14} rx={3} ry={1.6} fill="#FFF3D6" />
        ))}
      </>
    )}
    {kind === 'greens' && (
      <>
        <ellipse cx={50} cy={58} rx={46} ry={16} fill="#F2F2F2" />
        {[[24, 44], [40, 38], [58, 40], [74, 46], [50, 48]].map(([cx, cy], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={16} ry={9} fill={i % 2 === 0 ? '#4FA64A' : '#74C060'} transform={`rotate(${(i - 2) * 14} ${cx} ${cy})`} />
        ))}
        <rect x={30} y={44} width={40} height={14} rx={7} fill="#F2A3A0" />
        <rect x={38} y={36} width={26} height={12} rx={6} fill="#F7B8B2" />
      </>
    )}
    {kind === 'grill' && (
      <>
        <path d="M6 62 L52 12 L94 62 Z" fill="#E8A93F" />
        <path d="M18 62 L52 26 L82 62 Z" fill="#F6D24C" />
        <path d="M6 62 L94 62 L94 70 L6 70 Z" fill="#C9822B" />
        <path d="M30 62 L52 38 L70 62 Z" fill="#E8A93F" />
      </>
    )}
  </svg>
);

/**
 * CLIP_11 MENU SLIDE POSTER (WP47 Layer 2): a 1:1 royal-blue (#0A1186) poster, 6.80 s loop, four slides on a 1.70 s beat (0.85 s slide + 0.85 s hold). slide_carousel: each slide pushes the previous one out to the left with an
 * ease-in-out whose last 0.25 s is a slight settle; the photo cut-out leads the headline by 0.10 s and the second headline line lags the first by 0.08 s (parallax). Ultra-extended black ALL-CAPS headlines (two lines),
 * the cut-out overlaps the lower ~30 % of the second line (z above the text); the end card (ACME / BAKERY) has no photo and a centred headline. microtext_frame: the footer (hours left, address right) never moves.
 * The clip opens mid-slide of the first item and the loop point is a hard cut back into it. Silent. No blur, glow or cross-fade.
 */
export const MenuSlidePoster: React.FC<MenuSlidePosterProps> = ({width, height, slides, hideFooter = false, durationInFrames}) => {
  const {t} = useTemplateClock(MENU_BASE_SEC, durationInFrames);
  const board = fitContain(ARTBOARD_ASPECT, width, height);
  const source: MenuSlide[] = slides && slides.length >= 2 ? slides : MENU_DEFAULT_SLIDES.map(slide => ({headline: [slide.headline[0], slide.headline[1]] as [string, string]}));
  const custom = Boolean(slides && slides.length >= 2);
  const count = Math.min(MENU_SLIDE_COUNT, source.length);
  const pos = menuLayerPositions(t);

  const longest = Math.max(...source.slice(0, MENU_SLIDE_COUNT).flatMap(slide => slide.headline.map(line => line.length)), 1);
  const fontSize = Math.round(Math.min(board.h * 0.15, (board.w * 0.9) / (longest * LINE_ADVANCE * EXTEND_X)));
  const lineGap = fontSize * 0.92;
  const capH = fontSize * 0.72;
  const photoW = board.w * 0.65;
  const footerSize = Math.round(board.h * MENU_FOOTER.size);
  const micro: React.CSSProperties = {fontFamily: fontFamily('inter'), fontWeight: 500, fontSize: footerSize, lineHeight: 1.25, letterSpacing: '0.06em', color: MENU_COLORS.ink, whiteSpace: 'pre', textTransform: 'uppercase'};

  const layers: React.ReactNode[] = [];
  for (let k = -1; k <= MENU_SLIDE_COUNT - 1; k++) {
    const index = ((k % MENU_SLIDE_COUNT) + MENU_SLIDE_COUNT) % MENU_SLIDE_COUNT;
    const slide = custom ? source[index % count]! : source[index]!;
    // Live/custom slides never draw bacon-club food stand-ins — photo or headline-only.
    const standIn: MenuStandIn = custom ? 'none' : MENU_DEFAULT_SLIDES[index]!.standIn;
    const hasPhoto = Boolean(slide.photoSrc) || standIn !== 'none';
    const x = (p: number) => (k - p) * board.w;
    // headline: centred block on the end card (no photo), upper block above the cut-out otherwise
    const line1Cy = hasPhoto ? board.h * 0.27 : board.h * 0.5 - lineGap / 2;
    const line2Cy = line1Cy + lineGap;
    const photoTop = line2Cy + capH / 2 - capH * 0.3;
    const photoH = Math.max(40, board.h * 0.85 - photoTop);
    const line = (text: string, cy: number, p: number, key: string) =>
      Math.abs(k - p) < 1.2 ? (
        <div key={key} style={{position: 'absolute', left: x(p), top: Math.round(cy - fontSize / 2), width: board.w, height: fontSize, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fontFamily('inter'), fontWeight: 900, fontSize, lineHeight: 1, letterSpacing: '-0.01em', color: MENU_COLORS.ink, whiteSpace: 'pre', transform: `scaleX(${EXTEND_X})`, transformOrigin: '50% 50%'}}>
          {text.toUpperCase()}
        </div>
      ) : null;
    layers.push(line(slide.headline[0], line1Cy, pos.line1, `a${k}`), line(slide.headline[1], line2Cy, pos.line2, `b${k}`));
    if (hasPhoto && Math.abs(k - pos.photo) < 1.2) {
      layers.push(
        <div key={`p${k}`} style={{position: 'absolute', left: x(pos.photo) + (board.w - photoW) / 2, top: Math.round(photoTop), width: Math.round(photoW), height: Math.round(photoH)}}>
          {slide.photoSrc ? <Img src={slide.photoSrc} style={{width: '100%', height: '100%', objectFit: 'contain'}} /> : <StandIn kind={standIn as Exclude<MenuStandIn, 'none'>} w={Math.round(photoW)} h={Math.round(photoH)} />}
        </div>,
      );
    }
  }
  // z order: headlines were pushed first within each slide and its photo after, so a photo sits above its own headline; later slides sit above earlier ones

  const footerTop = Math.round(board.h * MENU_FOOTER.baseline);
  const sideInset = Math.round(board.w * 0.06);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: MENU_COLORS.ground}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden'}}>
        {layers}
        {!hideFooter && (
          <>
            <div style={{...micro, position: 'absolute', left: sideInset, top: footerTop, transform: 'translateY(-100%)'}}>{MENU_FOOTER.left.join('\n')}</div>
            <div style={{...micro, position: 'absolute', right: sideInset, top: footerTop, transform: 'translateY(-100%)', textAlign: 'right'}}>{MENU_FOOTER.right.join('\n')}</div>
          </>
        )}
      </div>
    </div>
  );
};
