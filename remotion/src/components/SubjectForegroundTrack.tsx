/**
 * WP55 phase 2: the presenter drawn IN FRONT of kinetic environmental type (type_environmental_hero, host-composited mode).
 *
 * Layer order inside ShortVideo: footage -> ... -> generated graphics (the type) -> THIS (person-only alpha video) -> emphasis / transitions / hook / captions. It plays the matte through the same cut-aware
 * `VideoTrack` + keep `segments` + `ZoomFrame` as the classic speaker and TextBehindSubjectTrack, so cuts, trims and punch-ins stay in sync with the footage. It draws nothing outside `spans` (output
 * seconds) and nothing without a video: the server drops the hero itself when the foreground is unavailable, so type is never left over the presenter's face.
 */
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';

import type {KeepSegment, LayoutStyle, ZoomTrigger} from '../blueprintSchema';
import {VideoTrack} from './VideoTrack';
import {ZoomFrame} from './ZoomFrame';

export type SubjectForeground = {videoUrl: string; spans: Array<{start: number; end: number}>};

export function activeForegroundSpanAt(foreground: SubjectForeground | undefined, timeSec: number): {start: number; end: number} | undefined {
  if (!foreground?.videoUrl.trim()) return undefined;
  return foreground.spans.find(span => timeSec >= span.start && timeSec < span.end);
}

type Props = {
  foreground?: SubjectForeground;
  segments: KeepSegment[];
  layoutStyle: LayoutStyle;
  zoomTriggers: ZoomTrigger[];
  zoomEnabled: boolean;
};

export const SubjectForegroundTrack: React.FC<Props> = ({foreground, segments, layoutStyle, zoomTriggers, zoomEnabled}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!foreground || !activeForegroundSpanAt(foreground, frame / fps)) return null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <ZoomFrame triggers={zoomTriggers} enabled={zoomEnabled}>
        <VideoTrack src={foreground.videoUrl} segments={segments} layoutStyle={layoutStyle} transparent muted />
      </ZoomFrame>
    </AbsoluteFill>
  );
};
