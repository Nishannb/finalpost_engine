import React from 'react';

import {LINE_MASK_BASE_SEC, itemReveal} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {TypeStage, fitFont, typePalette} from './typeShared';
import {useTemplateClock} from './useTemplateClock';

export type LineMaskRevealProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** 1-3 short lines, spoken verbatim. */
  lines?: string[];
  accent?: string;
  ground?: string;
  ink?: string;
  durationInFrames?: number;
};

const DEFAULT_LINES = ['One line', 'at a time'];

/**
 * CLIP_36 TYPE LINE MASK (WP54 / kinetic_text): each line rises out of a hard-edged mask (line_mask_rise) with a 100 ms-ish stagger; an accent rule draws under the last line. Exit is the reverse mask, faster. Silent, owns the frame.
 */
export const LineMaskReveal: React.FC<LineMaskRevealProps> = ({width, height, lines, accent, ground, ink, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(LINE_MASK_BASE_SEC, durationInFrames);
  const pal = typePalette({accent, ground, ink});
  const copy = (lines && lines.length > 0 ? lines : DEFAULT_LINES).slice(0, 3);
  const font = fitFont(Math.max(...copy.map(l => l.length)), width * 0.84, height * 0.085);
  const last = itemReveal(t, durSec, copy.length, copy.length + 1);
  return (
    <TypeStage width={width} height={height} ground={pal.ground}>
      {copy.map((line, i) => {
        const {enter, exit} = itemReveal(t, durSec, i, Math.max(2, copy.length) * 2, 0.45);
        return (
          <div key={i} style={{overflow: 'hidden', height: font * 1.12}}>
            <div style={{fontSize: font, fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.02em', color: i === copy.length - 1 ? pal.accent : pal.ink, whiteSpace: 'nowrap', transform: `translateY(${(1 - enter) * 105 - exit * 105}%)`}}>{line}</div>
          </div>
        );
      })}
      <div style={{marginTop: font * 0.3, height: Math.max(4, font * 0.06), width: `${last.enter * 36 * (1 - last.exit)}%`, backgroundColor: pal.accent}} />
    </TypeStage>
  );
};
