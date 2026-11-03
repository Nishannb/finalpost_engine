/**
 * WP26: scales the main footage while a `smash zoom` transition is open (see lib/smashPunch.ts). Sits OUTSIDE the per-segment sequences so `useCurrentFrame()` is the absolute output frame, like ZoomFrame.
 * `overflow: hidden` keeps the enlarged picture from bleeding over the overlays.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {TransitionClip} from '../blueprintSchema';
import {smashPunchForClips} from '../lib/smashPunch';

export const SmashPunch: React.FC<{clips: TransitionClip[] | undefined; enabled?: boolean; children: React.ReactNode}> = ({clips, enabled = true, children}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const punch = enabled && clips && clips.length > 0 ? smashPunchForClips(clips, frame, fps, durationInFrames) : null;
  if (!punch || punch.scale === 1) return <>{children}</>;
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: `scale(${punch.scale})`, transformOrigin: '50% 42%', ...(punch.blurPx > 0 ? {filter: `blur(${punch.blurPx}px)`} : {})}}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
