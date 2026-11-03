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
import {activeZoomAt, zoomStyleFor} from '../lib/timeline';

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
  const {fps, width, height} = useVideoConfig();
  const zoom = enabled ? activeZoomAt(triggers, frame / fps) : {scale: 1};
  const style = zoomStyleFor(zoom, width, height);

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill
        style={style}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
