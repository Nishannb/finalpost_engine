/**
 * WP34: word-by-word ACCUMULATE captions (Metromedia grammar). The line is built in spoken order; every word enters with a 4-frame blur-fade (+ a non-overshooting scale-up); earlier words stay until
 * the line HARD-clears on the next cut. ~7 % of the composition height, centred at y 42-50 %, sentence case, white, soft shadow only: no pill, no stroke, no colour keyword highlight.
 * Numbers and the line/cut maths live in `lib/accumulateCaptions.ts` (pure, unit-tested); this file only draws them.
 *
 * Layout: every word of the line is laid out from the first frame (the unrevealed ones are transparent), so a word fading in never reflows the words already on screen (no jitter, and a wrapped line
 * wraps the same way the whole time). All timing is in FRAMES (`round(sec * fps)`, the same rounding the cut plan's frame conversion uses) so a clear lands on the exact cut frame.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {CaptionDirection, CaptionWord, LanguageCode, DesignTokens} from '../blueprintSchema';
import {
  ACCUMULATE,
  accumulateCenterYFrac,
  accumulateDisplayWords,
  accumulateFaceSafeShiftPx,
  accumulateFitFontPx,
  accumulateFontPx,
  accumulateMaxWords,
  accumulateWordState,
  groupAccumulateLines,
} from '../lib/accumulateCaptions';
import {captionMaxWidthFrac} from '../lib/captionRail';
import {fontFamilyFor} from '../styles/fonts';

type AccumulateCaptionsProps = {
  words: CaptionWord[];
  language: LanguageCode;
  direction?: CaptionDirection;
  design?: DesignTokens;
  fontFamily?: string;
  /** Keep the line's right edge at or before the platform button rail (blueprints with `legibility.captions` only). */
  railClear?: boolean;
};

export const AccumulateCaptions: React.FC<AccumulateCaptionsProps> = ({words, language, direction, design, fontFamily, railClear}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const maxWords = accumulateMaxWords(direction?.maxWords);
  const lines = React.useMemo(
    () => groupAccumulateLines(words, {maxWords, cutTimes: direction?.cutTimes}),
    [words, maxWords, direction?.cutTimes],
  );

  const line = lines.find(item => frame >= Math.round(item.start * fps) && frame < Math.round(item.clearAt * fps));
  if (!line) return null;

  const containerPx = width * captionMaxWidthFrac(ACCUMULATE.maxWidthFrac, Boolean(railClear));
  const display = accumulateDisplayWords(line.words, direction?.capsWords);
  const basePx = accumulateFontPx(height, direction?.sizePctFrameH);
  const fontSize = accumulateFitFontPx(basePx, Math.max(...display.map(text => text.length)), containerPx);
  const family = fontFamily || fontFamilyFor(language, 'sans', design);
  const faceSafe = direction?.faceSafeYFrac !== undefined && Number.isFinite(direction.faceSafeYFrac);

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: height * accumulateCenterYFrac(direction?.centerYFrac) + accumulateFaceSafeShiftPx(height, direction), // WP38: + 0 unless the direction carries faceSafeYFrac (classic talking-head polish)
          // WP38 face-safe: the FIRST row sits at the band y and a wrapped line grows DOWN, away from the face (a block centred on y would lift its first row onto the chin); WP34 centres the whole block
          transform: 'translate(-50%, -50%)',
          ...(faceSafe ? {transform: `translate(-50%, -${fontSize * 0.55}px)`} : {}),
          zIndex: 30,
          width: containerPx,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          columnGap: fontSize * 0.28,
          rowGap: fontSize * 0.06,
        }}>
        {line.words.map((word, index) => {
          const state = accumulateWordState(frame - Math.round(word.start * fps));
          return (
            <span
              key={`${word.start}-${index}`}
              data-accumulate-word={index}
              style={{
                display: 'inline-block',
                fontFamily: family,
                fontWeight: ACCUMULATE.fontWeight,
                fontSize,
                lineHeight: 1.1,
                color: ACCUMULATE.color,
                whiteSpace: 'pre',
                textShadow: `0 ${Math.round(fontSize * 0.03)}px ${ACCUMULATE.shadowBlurPx}px rgba(0,0,0,${ACCUMULATE.shadowOpacity})`,
                opacity: state.opacity,
                filter: state.blurPx > 0 ? `blur(${state.blurPx}px)` : undefined,
                transform: `scale(${state.scale})`,
                transformOrigin: 'center center',
              }}>
              {display[index]}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
