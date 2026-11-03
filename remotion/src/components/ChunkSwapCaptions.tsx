/**
 * WP41: Skill B (Explainer) CHUNK-SWAP captions. One 1-3 word chunk is on screen; the next chunk REPLACES it on its first word (hard swap: no accumulate, no karaoke fill, no blur-fade). White fill, THICK black
 * stroke (paint-order: stroke fill), soft shadow, heavy geometric sans, lowercase. Vertical position follows the active explainer layout (`direction.yTrack`: B seam 50 %, A / C / D 75 %).
 * The numbers and the chunking live in `lib/chunkSwapCaptions.ts` (pure, unit-tested); this file only draws them. Selected by `direction.mode === 'chunk_swap'`; Skill A (accumulate) is a different mode.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {CaptionDirection, CaptionWord, DesignTokens, LanguageCode} from '../blueprintSchema';
import {captionMaxWidthFrac} from '../lib/captionRail';
import {
  CHUNK_SWAP,
  chunkDisplayText,
  chunkFitFontPx,
  chunkFontPx,
  chunkMaxWords,
  chunkPopState,
  chunkYFracAt,
  groupChunks,
} from '../lib/chunkSwapCaptions';
import {fontFamilyFor, poppinsFontFamily} from '../styles/fonts';

type ChunkSwapCaptionsProps = {
  words: CaptionWord[];
  language: LanguageCode;
  direction?: CaptionDirection;
  design?: DesignTokens;
  fontFamily?: string;
  /** Keep the chunk's right edge at or before the platform button rail (blueprints with `legibility.captions` only). */
  railClear?: boolean;
};

/** The stateless painter: also used by the offline proof, which feeds it a chunk and a y directly. */
export const ChunkSwapText: React.FC<{text: string; fontSize: number; containerPx: number; frameSinceStart: number; centerY: number; fontFamily: string; zIndex?: number}> = ({
  text,
  fontSize,
  containerPx,
  frameSinceStart,
  centerY,
  fontFamily,
  zIndex = 30,
}) => {
  const pop = chunkPopState(frameSinceStart);
  return (
    <div
      data-chunk-swap="true"
      style={{
        position: 'absolute',
        left: '50%',
        top: centerY,
        transform: `translate(-50%, -50%) scale(${pop.scale})`,
        transformOrigin: 'center center',
        zIndex,
        width: containerPx,
        textAlign: 'center',
        fontFamily,
        fontWeight: CHUNK_SWAP.fontWeight,
        fontSize,
        lineHeight: 1.08,
        color: CHUNK_SWAP.color,
        // thick black outline OUTSIDE the glyph (stroke is painted first, the white fill covers its inner half) + a soft shadow
        WebkitTextStroke: `${(fontSize * CHUNK_SWAP.strokeWidthEm).toFixed(2)}px ${CHUNK_SWAP.strokeColor}`,
        paintOrder: 'stroke fill',
        textShadow: `0 ${Math.round(fontSize * 0.06)}px ${CHUNK_SWAP.shadowBlurPx}px rgba(0,0,0,${CHUNK_SWAP.shadowOpacity})`,
        opacity: pop.opacity,
        letterSpacing: '0em',
        wordSpacing: '0.1em', // the thick stroke eats the gap between words
        whiteSpace: 'normal',
      }}>
      {text}
    </div>
  );
};

export const ChunkSwapCaptions: React.FC<ChunkSwapCaptionsProps> = ({words, language, direction, design, fontFamily, railClear}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const maxWords = chunkMaxWords(direction?.maxWords);
  const chunks = React.useMemo(() => groupChunks(words, {maxWords, cutTimes: direction?.cutTimes}), [words, maxWords, direction?.cutTimes]);

  const chunk = chunks.find(item => frame >= Math.round(item.start * fps) && frame < Math.round(item.clearAt * fps));
  if (!chunk) return null;

  const containerPx = width * captionMaxWidthFrac(CHUNK_SWAP.maxWidthFrac, Boolean(railClear));
  const text = chunkDisplayText(chunk.words, direction?.capsWords);
  const basePx = chunkFontPx(height, direction?.sizePctFrameH);
  const fontSize = chunkFitFontPx(basePx, text, containerPx);
  const family = fontFamily || (language === 'en' ? poppinsFontFamily() : fontFamilyFor(language, 'sans', design));
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <ChunkSwapText
        text={text}
        fontSize={fontSize}
        containerPx={containerPx}
        frameSinceStart={frame - Math.round(chunk.start * fps)}
        centerY={height * chunkYFracAt(direction?.yTrack, chunk.start)}
        fontFamily={family}
      />
    </AbsoluteFill>
  );
};
