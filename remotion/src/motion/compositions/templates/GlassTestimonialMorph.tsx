import React from 'react';
import {Img} from 'remotion';

import {
  GLASS_BACKDROP_BLUR_PX,
  GLASS_BASE_SEC,
  GLASS_CARD_RADIUS,
  GLASS_CARD_RECT,
  GLASS_DEFAULT_AUTHOR,
  GLASS_DEFAULT_QUOTE,
  GLASS_DEFAULT_ROLE,
  GLASS_DEFAULT_WORDMARK,
  fitContain,
  glassFrame,
  mix,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type GlassTestimonialMorphProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The warm lifestyle plate behind the glass (default: a flat-colour stand-in scene). */
  imageSrc?: string;
  /** The testimonial (default: the demo quote + author + role; when a quote is passed the demo author / role / brand are NOT drawn). */
  quote?: string;
  author?: string;
  role?: string;
  /** The brand wordmark top-left (default "Mango" in the demo only). */
  wordmark?: string;
  /** WP49: edit-palette accent / ground (heart + wordmark; margin bars). */
  accent?: string;
  ground?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const BOARD_ASPECT = 16 / 10;
const INK = '#1B1410';
const BARS = '#0E0C0B';

/** A flat-colour warm scene: sand wall, terracotta arch, olive plant, a cream table. Gives the glass real shapes to frost. */
const StandInPlate: React.FC = () => (
  <div style={{position: 'absolute', inset: 0, backgroundColor: '#E8D2B0', overflow: 'hidden'}}>
    <div style={{position: 'absolute', left: '58%', top: '-6%', width: '36%', height: '76%', borderRadius: '50% 50% 0 0', backgroundColor: '#C8643C'}} />
    <div style={{position: 'absolute', left: '66%', top: '14%', width: '20%', height: '56%', borderRadius: '50% 50% 0 0', backgroundColor: '#F2E3C6'}} />
    <div style={{position: 'absolute', left: '4%', top: '10%', width: '18%', aspectRatio: '1 / 1', borderRadius: '50%', backgroundColor: '#8A9A5B'}} />
    <div style={{position: 'absolute', left: '0%', top: '72%', width: '100%', height: '28%', backgroundColor: '#B98B5E'}} />
    <div style={{position: 'absolute', left: '40%', top: '60%', width: '30%', height: '18%', backgroundColor: '#F4EBDD'}} />
    <div style={{position: 'absolute', left: '12%', top: '48%', width: '10%', height: '26%', backgroundColor: '#5E6B3A'}} />
  </div>
);

const Heart: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block'}}>
    <path d="M12 21 L3.6 12.6 A5.2 5.2 0 0 1 12 6.2 A5.2 5.2 0 0 1 20.4 12.6 Z" fill={color} />
  </svg>
);

/**
 * CLIP_15 GLASS TESTIMONIAL MORPH (WP48 Layer 2 / layout C3): 16:10 frame (letterboxed in a portrait canvas), 3.93 s loop. A frosted card (white 15%, backdrop-blur 24 px, radius 14% of its height) sits over a warm lifestyle plate.
 * glass_card_morph: opens mid-morph (content already blurred, no icons — the capture start frame) -> snap to ~2x in 150 ms -> settle to 1x (400 ms expo-out) -> text blurs in from 12 px (500 ms) -> avatar + heart fade -> long readable hold (end).
 * Demo Mango / quote / author are proof-shell only; live polish binds video copy. The ONLY blurs: the card's own backdrop-filter (frosted glass) and the content blur-in that the move defines. No glow, shadow or cross-fade; the prototype's cursor / handles are stripped. Silent.
 */
export const GlassTestimonialMorph: React.FC<GlassTestimonialMorphProps> = ({width, height, imageSrc, quote, author, role, wordmark, accent, ground, durationInFrames}) => {
  const {t} = useTemplateClock(GLASS_BASE_SEC, durationInFrames);
  const board = fitContain(BOARD_ASPECT, width, height);
  const demo = !quote || !quote.trim();
  const text = demo ? GLASS_DEFAULT_QUOTE : quote!.trim();
  const name = demo ? GLASS_DEFAULT_AUTHOR : author?.trim() || '';
  const title = demo ? GLASS_DEFAULT_ROLE : role?.trim() || '';
  const brand = wordmark && wordmark.trim() ? wordmark.trim() : demo ? GLASS_DEFAULT_WORDMARK : '';
  const frame = glassFrame(t);
  const accentColor = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : INK;
  const barColor = ground && /^#[0-9a-fA-F]{6}$/.test(ground) ? ground : BARS;

  const cw = GLASS_CARD_RECT.w * board.w;
  const ch = GLASS_CARD_RECT.h * board.h;
  const homeX = (GLASS_CARD_RECT.x + GLASS_CARD_RECT.w / 2) * board.w;
  const homeY = (GLASS_CARD_RECT.y + GLASS_CARD_RECT.h / 2) * board.h;
  const cx = mix(homeX, board.w / 2, frame.centre);
  const cy = mix(homeY, board.h / 2, frame.centre);
  const pad = cw * 0.06;
  // biggest size whose wrapped quote (~0.55 em per glyph, 1.22 line height) fits the upper 55% of the card
  const quoteSize = Math.min(ch * 0.15, Math.sqrt((ch * 0.55 * (cw - 2 * pad)) / (text.length * 0.55 * 1.22)));
  const avatar = ch * 0.17;
  const initial = (name || brand || '·').charAt(0).toUpperCase();

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: barColor}}>
      <div style={{position: 'absolute', left: board.x, top: board.y, width: board.w, height: board.h, overflow: 'hidden'}}>
        {imageSrc ? <Img src={imageSrc} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} /> : <StandInPlate />}
        {brand && (
          <div style={{position: 'absolute', left: board.w * 0.05, top: board.h * 0.07, display: 'flex', alignItems: 'center', gap: board.w * 0.01}}>
            <div style={{width: board.w * 0.032, height: board.w * 0.032, borderRadius: '50%', backgroundColor: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <div style={{width: '38%', height: '38%', borderRadius: '50%', backgroundColor: '#F4EBDD'}} />
            </div>
            <div style={{fontFamily: fontFamily('inter'), fontWeight: 700, fontSize: board.w * 0.03, lineHeight: 1, letterSpacing: '-0.01em', color: INK}}>{brand}</div>
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: Math.round(cx - cw / 2),
            top: Math.round(cy - ch / 2),
            width: Math.round(cw),
            height: Math.round(ch),
            borderRadius: ch * GLASS_CARD_RADIUS,
            backgroundColor: 'rgba(255,255,255,0.15)',
            backdropFilter: `blur(${GLASS_BACKDROP_BLUR_PX}px)`,
            WebkitBackdropFilter: `blur(${GLASS_BACKDROP_BLUR_PX}px)`,
            border: '1px solid rgba(255,255,255,0.28)',
            transform: `scale(${frame.scale})`,
            transformOrigin: '50% 50%',
            overflow: 'hidden',
          }}
        >
          <div style={{position: 'absolute', inset: 0, padding: pad, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', filter: frame.contentBlurPx > 0.05 ? `blur(${frame.contentBlurPx.toFixed(2)}px)` : undefined}}>
            <div style={{fontFamily: fontFamily('inter'), fontWeight: 600, fontSize: quoteSize, lineHeight: 1.22, letterSpacing: '-0.01em', color: INK}}>{text}</div>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: avatar * 0.4}}>
                <div style={{width: avatar, height: avatar, borderRadius: '50%', backgroundColor: INK, color: '#F4EBDD', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fontFamily('inter'), fontWeight: 700, fontSize: avatar * 0.46, opacity: frame.iconOpacity}}>{initial}</div>
                {(name || title) && (
                  <div style={{display: 'flex', flexDirection: 'column', gap: avatar * 0.12}}>
                    {name && <div style={{fontFamily: fontFamily('inter'), fontWeight: 700, fontSize: avatar * 0.4, lineHeight: 1, color: INK}}>{name}</div>}
                    {title && <div style={{fontFamily: fontFamily('inter'), fontWeight: 500, fontSize: avatar * 0.32, lineHeight: 1, color: INK}}>{title}</div>}
                  </div>
                )}
              </div>
              <div style={{opacity: frame.iconOpacity}}>
                <Heart size={avatar * 0.8} color={accentColor} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
