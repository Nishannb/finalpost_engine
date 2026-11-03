import React from 'react';

import {WORD_REVEAL_BASE_SEC, itemReveal} from '../../../lib/craftTiming';
import type {SafeArea} from '../../layout';
import {TypeStage, fitFont, typePalette} from './typeShared';
import {useTemplateClock} from './useTemplateClock';

export type WordRevealTypeProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** One short emphatic phrase, spoken verbatim (2-8 words). Demo phrase only when omitted. */
  text?: string;
  accent?: string;
  ground?: string;
  ink?: string;
  durationInFrames?: number;
};

const DEFAULT_TEXT = 'Words land one at a time';

/**
 * CLIP_35 TYPE WORD REVEAL (WP54 / kinetic_text, from iart-ai kinetic-typography): each word rises out of its own mask (word_stagger_reveal), ease-out enter, 20-80 ms stagger, the LAST word takes the accent, group exits ease-in.
 * Silent. Owns the frame (captions muted). Hard ground, no blur / glow / bounce.
 */
export const WordRevealType: React.FC<WordRevealTypeProps> = ({width, height, text, accent, ground, ink, durationInFrames}) => {
  const {t, durSec} = useTemplateClock(WORD_REVEAL_BASE_SEC, durationInFrames);
  const pal = typePalette({accent, ground, ink});
  const words = (text && text.trim() ? text.trim() : DEFAULT_TEXT).split(/\s+/).slice(0, 8);
  const boxW = width * 0.84;
  const font = fitFont(Math.max(...words.map(w => w.length)) + 2, boxW / 1.6, height * 0.095);
  const rule = itemReveal(t, durSec, words.length, words.length + 1);
  return (
    <TypeStage width={width} height={height} ground={pal.ground}>
      <div style={{display: 'flex', flexWrap: 'wrap', columnGap: font * 0.28, rowGap: font * 0.04, fontSize: font, fontWeight: 800, lineHeight: 1.04, letterSpacing: '-0.02em'}}>
        {words.map((word, i) => {
          const {enter, exit} = itemReveal(t, durSec, i, words.length);
          const rise = (1 - enter) * 110 + exit * -110;
          return (
            <span key={i} style={{display: 'inline-block', overflow: 'hidden', paddingBottom: font * 0.12, marginBottom: -font * 0.12}}>
              <span style={{display: 'inline-block', color: i === words.length - 1 ? pal.accent : pal.ink, transform: `translateY(${rise}%)`}}>{word}</span>
            </span>
          );
        })}
      </div>
      <div style={{marginTop: font * 0.4, height: Math.max(4, font * 0.07), width: `${rule.enter * 28 * (1 - rule.exit)}%`, backgroundColor: pal.accent}} />
    </TypeStage>
  );
};
