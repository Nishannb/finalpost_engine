import React from 'react';

import {EXIT_EASE_IN, MOVE_IN_OUT, PLAYFUL_OVERSHOOT, bezierAt, eased, phase, priceCount} from '../../../lib/craftTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type PromoPriceDropProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Original price (grounded in the transcript / asset brief upstream — never invented). */
  was?: number;
  /** New price. */
  now?: number;
  /** Currency symbol placed before each figure ('' for none). */
  prefix?: string;
  /** Short label shown above (a spoken word like "today"); optional. */
  label?: string;
  accent?: string;
  ground?: string;
  ink?: string;
  durationInFrames?: number;
};

export const PRICE_DROP_BASE_SEC = 3.0;

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * CLIP_43 PROMO PRICE DROP (WP54 / counter): the was-price enters (ease-out), a strike line draws through it (moveInOut), the new price counts down from the was-price to the new figure (hero band) and lands with ONE overshoot accent.
 * Only grounded prices reach this comp (binder refuses otherwise). Silent, owns the frame.
 */
export const PromoPriceDrop: React.FC<PromoPriceDropProps> = ({width, height, was = 79, now = 47, prefix = '$', label, accent, ground, ink, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(PRICE_DROP_BASE_SEC, durationInFrames);
  const bg = hexOr(ground) ?? '#0B0B0B';
  const hot = hexOr(accent) ?? '#BFFF00';
  const fg = hexOr(ink) ?? readableInk(bg, '#FFFFFF', '#0B0B0B');
  const enter = eased(MOVE_IN_OUT, t, 0.1, 0.4);
  const strike = eased(MOVE_IN_OUT, t, 0.7, 0.4);
  const count = priceCount(eased(MOVE_IN_OUT, t, 1.0, 0.8), was, now);
  const land = bezierAt(PLAYFUL_OVERSHOOT, phase(t, 1.8, 0.45));
  const exit = eased(EXIT_EASE_IN, t, Math.max(2.2, durSec - 0.3), 0.28);
  const big = height * 0.14;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg, fontFamily: fontFamily('inter'), opacity: 1 - exit}}>
      <div style={{position: 'absolute', left: width * 0.08, top: height * 0.2, width: width * 0.84, display: 'flex', flexDirection: 'column', gap: big * 0.18}}>
        {label ? <div style={{fontSize: big * 0.32, fontWeight: 700, color: hot, opacity: enter, letterSpacing: '0.06em', textTransform: 'uppercase'}}>{label}</div> : null}
        <div style={{position: 'relative', alignSelf: 'flex-start', fontSize: big * 0.7, fontWeight: 700, color: fg, opacity: enter * 0.7, transform: `translateY(${(1 - enter) * 24}px)`}}>
          {prefix}
          {fmt(was)}
          <div style={{position: 'absolute', left: -big * 0.06, top: '54%', height: Math.max(5, big * 0.07), width: `${strike * 108}%`, backgroundColor: hot}} />
        </div>
        <div style={{fontSize: big * 1.35, fontWeight: 900, color: fg, lineHeight: 1, letterSpacing: '-0.03em', transform: `scale(${0.94 + 0.06 * land})`, transformOrigin: 'left center'}}>
          <span style={{color: hot}}>{prefix}</span>
          {fmt(count)}
        </div>
      </div>
    </div>
  );
};
