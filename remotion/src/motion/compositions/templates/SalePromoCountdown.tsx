import React from 'react';
import {Img} from 'remotion';

import {
  SALE_BACKDROP_BLUR_PX,
  SALE_BASE_SEC,
  SALE_BOARD_ASPECT,
  SALE_COLORS,
  SALE_DEFAULT_CTA,
  SALE_DEFAULT_FOOTER,
  SALE_DEFAULT_LINES,
  SALE_DEFAULT_TITLE,
  fitContain,
  saleFrame,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, mixHex, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type SalePromoCountdownProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Title card copy (demo "Sale: 30% Off" only when omitted). */
  titleCardText?: string;
  /** Two slide-up lines [line1, line2] (demo only when omitted). */
  lines?: [string, string];
  /** Glass CTA pill copy (demo "Start free trial" only when omitted). */
  cta?: string;
  /** Footer micro copy (demo only; live polish hides it with `hideFooter`). */
  footerLeft?: string;
  footerRight?: string;
  hideFooter?: boolean;
  /** The plate behind the type (default: a flat-colour warm stand-in). */
  imageSrc?: string;
  /** Edit palette: `ground` = title-card colour, `accent` = clock ring + CTA tint (demo navy / white are defaults only). */
  accent?: string;
  ground?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

/** Left edge of the copy block as a fraction of board width: starts just after the docked clock (x 25% + half its width). */
const SALE_DOCK_TEXT_LEFT = 0.3;

/** Clock ring (dotted circle + hands), drawn as SVG so it stays crisp when it shrinks. */
const ClockRing: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block'}} fill="none" stroke={color} strokeLinecap="round">
    <circle cx={12} cy={12} r={10} strokeDasharray="0.1 3.1" strokeWidth={2.6} />
    <path d="M12 6.5v5.8l3.6 2" strokeWidth={2} />
  </svg>
);

/** A masked slide-up: the line rises out of a clipping window (the mask is the window, no fade). */
const SlideUpLine: React.FC<{text: string; size: number; progress: number; color: string; weight: number}> = ({text, size, progress, color, weight}) => (
  <div style={{overflow: 'hidden', height: size * 1.18, lineHeight: `${size * 1.18}px`}}>
    <div style={{transform: `translateY(${(1 - progress) * 110}%)`, fontSize: size, fontWeight: weight, color, whiteSpace: 'nowrap', letterSpacing: '-0.015em'}}>{text}</div>
  </div>
);

/**
 * CLIP_23 SALE PROMO COUNTDOWN (WP51 Layer 2 / Batch B2): 4:5 board (letterboxed), 2.87 s, non-loop. A radial-dot title card (0-0.32 s) HARD-cuts to the plate; a dotted clock ring docks from the centre-right to the left of the copy (icon_dock, expo-out);
 * two lines slide up out of masks (masked_slide_up); a frosted-glass CTA pill (glass_pill; its backdrop-blur is the only blur here) fades + scales 0.9 -> 1. Silent. No dissolve, whip, glitch or bounce.
 * Demo copy is proof-shell only; live polish binds video copy + editPalette accent / ground and hides the demo footer.
 */
export const SalePromoCountdown: React.FC<SalePromoCountdownProps> = ({width, height, titleCardText, lines, cta, footerLeft, footerRight, hideFooter = false, imageSrc, accent, ground, durationInFrames}) => {
  const {t} = useTemplateClock(SALE_BASE_SEC, durationInFrames);
  const board = fitContain(SALE_BOARD_ASPECT, width, height);
  const frame = saleFrame(t);
  const cardColor = hexOr(ground) ?? SALE_COLORS.ground;
  const cardInk = readableInk(cardColor, SALE_COLORS.ink, '#0B0B0B');
  const ring = hexOr(accent) ?? SALE_COLORS.ink;
  const plateColor = hexOr(accent) && hexOr(ground) ? mixHex(hexOr(ground)!, hexOr(accent)!, 0.55) : SALE_COLORS.plate;
  const copy = lines && lines.length === 2 ? lines : [...SALE_DEFAULT_LINES];
  const title = titleCardText && titleCardText.trim() ? titleCardText.trim() : SALE_DEFAULT_TITLE;
  const ctaText = cta && cta.trim() ? cta.trim() : SALE_DEFAULT_CTA;
  const demoFooter = !hideFooter;
  const left = footerLeft ?? SALE_DEFAULT_FOOTER[0];
  const right = footerRight ?? SALE_DEFAULT_FOOTER[1];
  // type sits over the plate: white with a flat darkening scrim on a photo; a stand-in plate is mid-tone so white reads there too
  const textInk = '#FFFFFF';
  const lineSize = Math.min(board.w * 0.085, (board.w * 0.66) / (Math.max(8, ...copy.map(line => line.length)) * 0.58));
  const dockSize = frame.dock.w * board.w;
  const textLeft = SALE_DOCK_TEXT_LEFT * board.w;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000'}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden', fontFamily: fontFamily('inter')}}>
        {frame.titleCard ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: cardColor,
              backgroundImage: `radial-gradient(circle, ${mixHex(cardColor, cardInk, 0.16)} ${board.w * 0.0034}px, transparent ${board.w * 0.0038}px)`,
              backgroundSize: `${board.w * 0.04}px ${board.w * 0.04}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{fontSize: Math.min(board.w * 0.1, (board.w * 0.86) / Math.max(6, title.length * 0.6)), fontWeight: 800, color: cardInk, letterSpacing: '-0.02em', textAlign: 'center'}}>{title}</div>
          </div>
        ) : (
          <>
            {imageSrc ? (
              <>
                <Img src={imageSrc} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
                <div style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.32)'}} />
              </>
            ) : (
              <div style={{position: 'absolute', inset: 0, backgroundColor: plateColor, overflow: 'hidden'}}>
                <div style={{position: 'absolute', left: '-8%', top: '58%', width: '116%', height: '50%', backgroundColor: mixHex(plateColor, '#000000', 0.18), borderRadius: '50% 50% 0 0'}} />
                <div style={{position: 'absolute', left: '62%', top: '8%', width: '26%', aspectRatio: '1 / 1', borderRadius: '50%', backgroundColor: mixHex(plateColor, '#FFFFFF', 0.22)}} />
              </div>
            )}
            <div style={{position: 'absolute', left: frame.dock.x * board.w - dockSize / 2, top: frame.dock.y * board.h - dockSize / 2}}>
              <ClockRing size={dockSize} color={ring} />
            </div>
            <div style={{position: 'absolute', left: textLeft, top: board.h * 0.455, display: 'flex', flexDirection: 'column', gap: lineSize * 0.12}}>
              <SlideUpLine text={copy[0]!} size={lineSize} progress={frame.line1} color={textInk} weight={700} />
              <SlideUpLine text={copy[1]!} size={lineSize} progress={frame.line2} color={textInk} weight={800} />
            </div>
            <div
              style={{
                position: 'absolute',
                left: '50%',
                bottom: board.h * 0.14,
                transform: `translateX(-50%) scale(${frame.pill.scale})`,
                opacity: frame.pill.fade,
                padding: `${board.w * 0.026}px ${board.w * 0.07}px`,
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.22)',
                backdropFilter: `blur(${SALE_BACKDROP_BLUR_PX}px)`,
                WebkitBackdropFilter: `blur(${SALE_BACKDROP_BLUR_PX}px)`,
                border: `${Math.max(1, board.w * 0.0025)}px solid rgba(255,255,255,0.45)`,
                color: '#FFFFFF',
                fontSize: board.w * 0.036,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {ctaText}
            </div>
            {demoFooter && (
              <div style={{position: 'absolute', left: board.w * 0.05, right: board.w * 0.05, bottom: board.h * 0.04, display: 'flex', justifyContent: 'space-between', fontSize: board.w * 0.024, fontWeight: 600, color: '#FFFFFF'}}>
                <span>{left}</span>
                <span>{right}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
