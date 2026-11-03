/**
 * A transparent talking-head cutout as an INDEPENDENT layer.
 *
 * Plays an alpha video (e.g. the silent VP9 yuva420p WebM from the RVM matting job) inside a placement box given in fractions of the frame.
 * It knows nothing about captions, kinetic templates, keep segments or any edit style: whatever is drawn BEFORE it (footage, a colour, a graphic, big type)
 * stays visible wherever the person's alpha is 0, and the person occludes it wherever alpha is 1.
 *
 * There is deliberately NO background colour on this layer: a black (or any) fill would hide everything beneath it and would make a failed matte look like a success.
 * The video starts at the frame where the component is mounted (wrap it in a <Sequence> to time it); `src` may be an https URL, a `/prefetch/...` path or `staticFile:<path>`
 * (the same forms `resolveMediaSrc` accepts for production media).
 */
import React from 'react';
import {OffthreadVideo} from 'remotion';

import {resolveMediaSrc} from '../lib/mediaSrc';

/** A box in fractions of the frame: x, y = top-left, w, h = size. */
export type CutoutBox = {x: number; y: number; w: number; h: number};

export const FULL_FRAME_BOX: CutoutBox = {x: 0, y: 0, w: 1, h: 1};

type Props = {
  src: string;
  /** Placement box in fractions of the frame; defaults to the full frame. */
  box?: CutoutBox;
};

export const TransparentCutout: React.FC<Props> = ({src, box = FULL_FRAME_BOX}) => (
  <div
    style={{
      position: 'absolute',
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.w * 100}%`,
      height: `${box.h * 100}%`,
      pointerEvents: 'none',
    }}>
    <OffthreadVideo
      src={resolveMediaSrc(src)}
      transparent
      muted
      style={{width: '100%', height: '100%', objectFit: 'contain'}}
    />
  </div>
);
