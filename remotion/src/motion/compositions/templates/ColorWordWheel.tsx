import React from 'react';

import {
  WHEEL_BASE_SEC,
  WHEEL_DEFAULT_COLORS,
  WHEEL_DEFAULT_WORDS,
  WHEEL_LANDING_SEC,
  WHEEL_VISIBLE,
  wheelColorIndex,
  wheelPosition,
  wheelRowOpacity,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type ColorWordWheelProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The wheel's rows, top to bottom (3+; demo colour names only when omitted). */
  words?: string[];
  /** Background colour per landing (hex; demo yellow / green / black / grey only when omitted; live = edit palette). */
  colors?: string[];
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const SQUARE = 1;

/**
 * CLIP_24 COLOUR WORD WHEEL (WP51 Layer 2 / Batch B3): 1:1 board (letterboxed), 4.38 s loop. A vertical wheel of ExtraBold words: the selected row is white, neighbours sit at 0.25 / 0.15 opacity (about six rows visible, top / bottom fade mask).
 * Every ~1.4 s the wheel scrolls one row (220 ms ease-out, word_wheel) and the background HARD-cuts to the next colour on the landing (hard_color_cut) - no cross-fade, no blur, no bounce. Silent.
 */
export const ColorWordWheel: React.FC<ColorWordWheelProps> = ({width, height, words, colors, durationInFrames}) => {
  const {t} = useTemplateClock(WHEEL_BASE_SEC, durationInFrames);
  const side = Math.min(width, height * SQUARE);
  const boardX = (width - side) / 2;
  const boardY = (height - side) / 2;
  const rows = words && words.length >= 3 ? words : [...WHEEL_DEFAULT_WORDS];
  const palette = (colors ?? []).map(hexOr).filter((c): c is string => c !== undefined);
  const bgList = palette.length >= 2 ? palette : [...WHEEL_DEFAULT_COLORS];
  // demo: start on "Yellow" (row 2); a live list starts on its first row and makes up to three scrolls
  const start = words && words.length >= 3 ? 0 : 2;
  const steps = Math.min(WHEEL_LANDING_SEC.length - 1, rows.length - 1 - start);
  const pos = wheelPosition(t, start, steps);
  const bg = bgList[wheelColorIndex(t, steps + 1) % bgList.length]!;
  const font = side * 0.09;
  const pitch = font * 1.28;

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000'}}>
      <div
        style={{
          position: 'absolute',
          left: boardX,
          top: boardY,
          width: side,
          height: side,
          overflow: 'hidden',
          backgroundColor: bg,
          fontFamily: fontFamily('inter'),
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)',
          }}
        >
        {rows.map((word, i) => {
          const d = i - pos;
          if (Math.abs(d) > WHEEL_VISIBLE / 2) return null;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: side / 2 + d * pitch - font / 2,
                height: font,
                lineHeight: `${font}px`,
                textAlign: 'center',
                fontSize: font,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#FFFFFF',
                opacity: wheelRowOpacity(d),
                whiteSpace: 'nowrap',
              }}
            >
              {word}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
};
