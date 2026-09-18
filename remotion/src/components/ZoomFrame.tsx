/**
 * Camera punch-in wrapper.
 *
 * Lives outside the per-segment sequences so `useCurrentFrame()` is the absolute
 * output frame; the zoom windows in the blueprint are already in output time.
 * `overflow: hidden` keeps the scaled frame from bleeding over the captions.
 */

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {ZoomTrigger} from '../blueprintSchema';
import {zoomScaleAt} from '../lib/timeline';

type ZoomFrameProps = {
  triggers: ZoomTrigger[];
  enabled: boolean;
  children: React.ReactNode;
};

export const ZoomFrame: React.FC<ZoomFrameProps> = ({
  triggers,
  enabled,
  children,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = enabled ? zoomScaleAt(triggers, frame / fps) : 1;

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          transformOrigin: '50% 32%',
        }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
