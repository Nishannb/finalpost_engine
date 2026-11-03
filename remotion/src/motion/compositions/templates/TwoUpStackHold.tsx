import React from 'react';

import {PHOTO_STACK_COLORS, PHOTO_STACK_TONES, TWO_UP_BASE_SEC, TWO_UP_RECTS, twoUpExit} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type TwoUpStackHoldProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Two stills (top, bottom); a missing one is a flat-colour silhouette stand-in. */
  imageUrls?: string[];
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

/**
 * CLIP_19 TWO-UP STACK HOLD (WP50 Layer 2 / Part 4): #FDFDFD, 9:16, 2.0 s. two_up_stack_inset hold, then slide_apart_x:
 * the top card exits left and the bottom card exits right. Silent. No blur, glow or cross-fade.
 */
export const TwoUpStackHold: React.FC<TwoUpStackHoldProps> = ({width, height, imageUrls, durationInFrames}) => {
  const {t} = useTemplateClock(TWO_UP_BASE_SEC, durationInFrames);
  const exit = twoUpExit(t);
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: PHOTO_STACK_COLORS.ground}}>
      {TWO_UP_RECTS.map((rect, i) => {
        const tone = PHOTO_STACK_TONES[i % PHOTO_STACK_TONES.length]!;
        const src = imageUrls && imageUrls.length > 0 ? imageUrls[i % imageUrls.length] : undefined;
        const slideX = (i === 0 ? -1 : 1) * exit * width;
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
              transform: `translateX(${slideX}px)`,
            }}
          >
            <PhotoFill src={src} ground={tone.ground} figure={tone.figure} sun={tone.sun} />
          </div>
        );
      })}
    </div>
  );
};
