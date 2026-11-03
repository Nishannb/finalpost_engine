import React from 'react';

import {CHAR_STAGGER_BASE_SEC, CHAR_STAGGER_MAX_CHARS, ENTER_EASE_OUT, MOVE_IN_OUT, bezierAt, itemReveal} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {TypeStage, fitFont, typePalette} from './typeShared';
import {useTemplateClock} from './useTemplateClock';

export type CharStaggerTypeProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** A very short phrase (<= 24 chars; longer is clipped here and REFUSED upstream by the binder / planner). */
  text?: string;
  accent?: string;
  ground?: string;
  ink?: string;
  durationInFrames?: number;
};

const DEFAULT_TEXT = 'Letter by letter';

/**
 * CLIP_37 TYPE CHAR STAGGER (WP54 / kinetic_text): <= 24 characters, each letter rises + resolves with a 20-80 ms stagger fitted so the whole group lands within 800 ms (char_stagger_fade). The letters never all move at
 * once; the final character takes the accent. Silent, owns the frame.
 */
export const CharStaggerType: React.FC<CharStaggerTypeProps> = ({width, height, text, accent, ground, ink, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(CHAR_STAGGER_BASE_SEC, durationInFrames);
  const pal = typePalette({accent, ground, ink});
  const chars = Array.from((text && text.trim() ? text.trim() : DEFAULT_TEXT).slice(0, CHAR_STAGGER_MAX_CHARS));
  const font = fitFont(chars.length, width * 0.84, height * 0.11);
  return (
    <TypeStage width={width} height={height} ground={pal.ground}>
      <div style={{fontSize: font, fontWeight: 800, letterSpacing: '-0.01em', whiteSpace: 'pre', lineHeight: 1.1}}>
        {chars.map((ch, i) => {
          const {enter, exit} = itemReveal(t, durSec, i, chars.length, 0.32);
          const e = bezierAt(ENTER_EASE_OUT, enter);
          const x = bezierAt(MOVE_IN_OUT, exit);
          return (
            <span key={i} style={{display: 'inline-block', color: i === chars.length - 1 ? pal.accent : pal.ink, opacity: Math.min(1, e * 1.4) * (1 - x), transform: `translateY(${(1 - e) * font * 0.45 - x * font * 0.2}px)`}}>
              {ch}
            </span>
          );
        })}
      </div>
    </TypeStage>
  );
};
