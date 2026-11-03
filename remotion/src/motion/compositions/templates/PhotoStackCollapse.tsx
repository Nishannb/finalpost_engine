import React from 'react';

import {PHOTO_STACK_COLORS, PHOTO_STACK_TONES, STACK_COLLAPSE_BASE_SEC, STACK_COLLAPSE_RECTS, stackCollapseHeight} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type PhotoStackCollapseProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Two stills (hero on top, card below); a missing one is a flat-colour silhouette stand-in. */
  imageUrls?: string[];
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

/**
 * CLIP_17 PHOTO STACK COLLAPSE (WP50 Layer 2 / Part 4 clip 13): #FDFDFD, 9:16, 1.37 s loop. A hero photo (full width, top half) over a narrower card; hold, then stack_collapse_y: each photo's visible height
 * closes to a hairline through a clip mask (ease-in, 0.45 s). The pixels are ANCHORED (cropped, never scaled). Rectangular photos. Silent. No cross-fade, blur, bounce or glow.
 */
export const PhotoStackCollapse: React.FC<PhotoStackCollapseProps> = ({width, height, imageUrls, durationInFrames}) => {
  const {t} = useTemplateClock(STACK_COLLAPSE_BASE_SEC, durationInFrames);
  const k = stackCollapseHeight(t);
  const inset = ((1 - k) / 2) * 100;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: PHOTO_STACK_COLORS.ground}}>
      {STACK_COLLAPSE_RECTS.map((rect, i) => {
        const tone = PHOTO_STACK_TONES[i % PHOTO_STACK_TONES.length]!;
        const src = imageUrls && imageUrls.length > 0 ? imageUrls[i % imageUrls.length] : undefined;
        return (
          <div
            key={`photo${i}`}
            style={{position: 'absolute', left: Math.round(rect.x * width), top: Math.round(rect.y * height), width: Math.round(rect.w * width), height: Math.round(rect.h * height), overflow: 'hidden', clipPath: `inset(${inset}% 0 ${inset}% 0)`}}
          >
            <PhotoFill src={src} ground={tone.ground} figure={tone.figure} sun={tone.sun} />
          </div>
        );
      })}
    </div>
  );
};
