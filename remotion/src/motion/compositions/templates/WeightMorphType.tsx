import React from 'react';

import {MOVE_IN_OUT, WEIGHT_MORPH_BASE_SEC, eased, itemReveal, morphWeight, staggerStep} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {TypeStage, fitFont, typePalette} from './typeShared';
import {useTemplateClock} from './useTemplateClock';

export type WeightMorphTypeProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** A short emphatic phrase (1-5 words), spoken verbatim. */
  text?: string;
  accent?: string;
  ground?: string;
  ink?: string;
  durationInFrames?: number;
};

const DEFAULT_TEXT = 'Heavier as it lands';

/**
 * CLIP_38 TYPE WEIGHT MORPH (WP54 / kinetic_text): the phrase settles from Inter 400 up to 900 word by word (weight_axis_morph; static Inter weights step through 400..900 so no font download), tracking tightens as it
 * gains weight. The heaviest word takes the accent. Silent, owns the frame.
 */
export const WeightMorphType: React.FC<WeightMorphTypeProps> = ({width, height, text, accent, ground, ink, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(WEIGHT_MORPH_BASE_SEC, durationInFrames);
  const pal = typePalette({accent, ground, ink});
  const words = (text && text.trim() ? text.trim() : DEFAULT_TEXT).split(/\s+/).slice(0, 5);
  const font = fitFont(Math.max(...words.map(w => w.length)) + 1, width * 0.84 / 1.5, height * 0.1);
  const step = staggerStep(words.length) * 3;
  return (
    <TypeStage width={width} height={height} ground={pal.ground}>
      <div style={{display: 'flex', flexWrap: 'wrap', columnGap: font * 0.3, fontSize: font, lineHeight: 1.08}}>
        {words.map((word, i) => {
          const p = eased(MOVE_IN_OUT, t, 0.2 + i * step, 0.9);
          const {exit} = itemReveal(t, durSec, i, words.length);
          const weight = morphWeight(p);
          return (
            <span key={i} style={{display: 'inline-block', fontWeight: weight, letterSpacing: `${0.03 - p * 0.05}em`, color: i === words.length - 1 ? pal.accent : pal.ink, opacity: 1 - exit, transform: `translateY(${-exit * font * 0.3}px)`}}>
              {word}
            </span>
          );
        })}
      </div>
    </TypeStage>
  );
};
