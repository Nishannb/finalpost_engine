import React from 'react';

import {
  TRACKING_BASE_SEC,
  TRACKING_CARD_INSET,
  TRACKING_COLORS,
  TRACKING_DEFAULT_LINES,
  fitContain,
  trackingLineFrame,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, mixHex, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type TrackingCollapseHeadlineProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Two to four short lines, drawn ALL CAPS (demo greeting only when omitted). */
  lines?: string[];
  /** Card gradient start (default #2B9BFF; live = edit-palette accent). */
  accent?: string;
  /** Page colour behind the card (default #EEEEF0). */
  ground?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

/**
 * CLIP_25 TRACKING-COLLAPSE HEADLINE (WP51 Layer 2 / Batch B4): 1:1 board (letterboxed), 1.21 s. A rounded gradient card on a pale page; ALL-CAPS lines type in (67 ms/char) while each line's tracking collapses 0.7 em -> 0 (280 ms)
 * and the line slides from a 12% indent to the left edge (letter_typing_tracking). Leading 0.92. Silent. No cursor, no per-letter bounce, no blur.
 */
export const TrackingCollapseHeadline: React.FC<TrackingCollapseHeadlineProps> = ({width, height, lines, accent, ground, durationInFrames}) => {
  const {t} = useTemplateClock(TRACKING_BASE_SEC, durationInFrames);
  const side = Math.min(width, height);
  const boardX = (width - side) / 2;
  const boardY = (height - side) / 2;
  const copy = (lines && lines.length >= 2 ? lines.slice(0, 4) : [...TRACKING_DEFAULT_LINES]).map(line => line.toUpperCase());
  const page = hexOr(ground) ?? TRACKING_COLORS.page;
  const from = hexOr(accent) ?? TRACKING_COLORS.cardFrom;
  const to = hexOr(accent) ? mixHex(from, '#FFFFFF', 0.45) : TRACKING_COLORS.cardTo;
  const ink = readableInk(from, TRACKING_COLORS.ink, '#0B0B0B');
  const cardX = side * TRACKING_CARD_INSET.x;
  const cardY = side * TRACKING_CARD_INSET.y;
  const cardW = side - 2 * cardX;
  const cardH = side - 2 * cardY;
  const pad = cardW * 0.05;
  const innerW = cardW - 2 * pad;
  const longest = Math.max(6, ...copy.map(line => Array.from(line).length));
  // 7.5% of the artboard height, shrunk only when the longest line (0.68 em per cap) would not fit the card
  const font = Math.min(side * 0.075, innerW / (longest * 0.68 + 0.1));

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000'}}>
      <div style={{position: 'absolute', left: boardX, top: boardY, width: side, height: side, overflow: 'hidden', backgroundColor: page}}>
        <div
          style={{
            position: 'absolute',
            left: cardX,
            top: cardY,
            width: cardW,
            height: cardH,
            borderRadius: side * 0.03,
            overflow: 'hidden',
            backgroundImage: `linear-gradient(160deg, ${from}, ${to})`,
            fontFamily: fontFamily('inter'),
          }}
        >
          <div style={{position: 'absolute', left: pad, top: (cardH - copy.length * font * 0.92) / 2, width: innerW, display: 'flex', flexDirection: 'column'}}>
            {copy.map((line, i) => {
              const chars = Array.from(line);
              const frame = trackingLineFrame(t, i, chars.length);
              return (
                <div key={i} style={{height: font * 0.92, lineHeight: `${font * 0.92}px`, fontSize: font, fontWeight: 800, color: ink, whiteSpace: 'pre', transform: `translateX(${frame.indent * innerW}px)`, letterSpacing: `${frame.trackingEm}em`}}>
                  {chars.slice(0, frame.typed).join('')}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
