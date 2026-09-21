/**
 * Shrinks the whole picture to reveal a thick colored margin, then restores
 * with the same smooth motion. How far it retracts is director-chosen.
 */

import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {FrameInset} from '../blueprintSchema';

export function activeFrameInsetAt(
  insets: FrameInset[] | undefined,
  timeSec: number,
): FrameInset | undefined {
  if (!insets?.length) {
    return undefined;
  }
  return insets.find(inset => timeSec >= inset.start && timeSec < inset.end);
}

export const FrameInsetFrame: React.FC<{
  inset: FrameInset;
  children: React.ReactNode;
}> = ({inset, children}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const local = Math.max(0, timeSec - inset.start);
  const hold = Math.max(0.8, inset.end - inset.start);
  const enterSec = Math.max(0.55, inset.transitionSec || 0.9);
  const exitSec = Math.max(0.75, (inset.transitionSec || 0.9) * 1.1);
  const stillSec = Math.max(0.4, hold - enterSec - exitSec);
  const exitAt = enterSec + stillSec;

  const enter = spring({
    frame: Math.round(local * fps),
    fps,
    config: {damping: 20, stiffness: 70, mass: 1.05},
    durationInFrames: Math.round(enterSec * fps),
  });
  const exit =
    local < exitAt
      ? 1
      : interpolate(local, [exitAt, exitAt + exitSec], [1, 0], {
          easing: Easing.inOut(Easing.cubic),
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const progress = Math.min(1, enter) * Math.max(0, exit);
  const scale = interpolate(progress, [0, 1], [1, clampScale(inset.scale)]);
  const radius = interpolate(progress, [0, 1], [0, Math.max(0, inset.cornerRadius ?? 18)]);
  const boxW = width * scale;
  const boxH = height * scale;

  return (
    <AbsoluteFill style={{backgroundColor: inset.marginColor || '#000000'}}>
      <div
        style={{
          position: 'absolute',
          left: (width - boxW) / 2,
          top: (height - boxH) / 2,
          width: boxW,
          height: boxH,
          borderRadius: radius,
          overflow: 'hidden',
          boxShadow:
            progress > 0.12
              ? `0 ${18 * progress}px ${40 * progress}px rgba(0,0,0,${0.28 * progress})`
              : 'none',
        }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

function clampScale(raw?: number): number {
  const scale = Number(raw);
  if (!Number.isFinite(scale)) {
    return 0.86;
  }
  return Math.min(0.94, Math.max(0.7, scale));
}
