import React from 'react';

import {PHOTO_STACK_COLORS, PHOTO_STACK_TONES, STACK_REVEAL_BASE_SEC, STACK_REVEAL_RECTS, stackRevealHeight, stackRevealOpacity} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type PhotoStackRevealProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Two or three landscape stills (top to bottom); a missing one is a flat-colour silhouette stand-in. */
  imageUrls?: string[];
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

/**
 * CLIP_18 PHOTO STACK REVEAL (WP50 Layer 2 / Part 4): #FDFDFD, 9:16, 2.42 s. Three landscape cards in a column. Starts blank (no payoff flash) ->
 * mask_reveal_y (each card opens downward from its top edge, ease-out 0.5 s, stagger 0 / 0 / 0.15 s) -> hold. The pixels are ANCHORED (cropped, never scaled). Rectangular photos. Silent.
 */
export const PhotoStackReveal: React.FC<PhotoStackRevealProps> = ({width, height, imageUrls, durationInFrames}) => {
  const {t} = useTemplateClock(STACK_REVEAL_BASE_SEC, durationInFrames);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: PHOTO_STACK_COLORS.ground}}>
      {STACK_REVEAL_RECTS.map((rect, i) => {
        const tone = PHOTO_STACK_TONES[i % PHOTO_STACK_TONES.length]!;
        const src = imageUrls && imageUrls.length > 0 ? imageUrls[i % imageUrls.length] : undefined;
        const shown = stackRevealHeight(t, i);
        return (
          <div
            key={`photo${i}`}
            style={{
              position: 'absolute',
              left: Math.round(rect.x * width),
              top: Math.round(rect.y * height),
              width: Math.round(rect.w * width),
              height: Math.round(rect.h * height),
              overflow: 'hidden',
              opacity: stackRevealOpacity(t, i),
              clipPath: `inset(0 0 ${(1 - shown) * 100}% 0)`,
            }}
          >
            <PhotoFill src={src} ground={tone.ground} figure={tone.figure} sun={tone.sun} />
          </div>
        );
      })}
    </div>
  );
};
