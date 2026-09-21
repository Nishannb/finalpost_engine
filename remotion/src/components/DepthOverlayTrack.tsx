/**
 * Behind-subject overlay compositor.
 *
 * Layer order (bottom → top):
 * 1. Base talking-head (full frame; visible below the overlay band)
 * 2. Overlay asset in the upper band (slides in, full opacity)
 * 3. Speaker in front — keyed WebM alpha only.
 *
 * No mask means this track is a no-op. Occupancy ellipses are not masks.
 * Legality must have refused the clip already; this is the last closed gate.
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {DepthOverlayClip, KeepSegment, LayoutStyle, ZoomTrigger} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {
  DEFAULT_DEPTH_OVERLAY_PARAMS,
  getOverlayTransform,
} from '../lib/depthOverlayMotion';
import {
  keyedCutoutIsUsable,
  resolveSubjectMask,
  type SubjectMaskContext,
  type SubjectMaskProvider,
} from '../lib/subjectMask';
import {framesBetween, secToFrame} from '../lib/timeline';
import {VideoTrack} from './VideoTrack';
import {ZoomFrame} from './ZoomFrame';

export function activeDepthOverlayAt(
  clips: DepthOverlayClip[] | undefined,
  timeSec: number,
): DepthOverlayClip | undefined {
  if (!clips?.length) {
    return undefined;
  }
  return clips.find(clip => timeSec >= clip.start && timeSec < clip.end);
}

type DepthOverlayTrackProps = {
  clips: DepthOverlayClip[] | undefined;
  talkingHead: React.ReactNode;
  speakerCutout?: SubjectMaskContext['speakerCutout'];
  alphaVideoUrl?: string;
  maskProviders?: SubjectMaskProvider[];
  segments: KeepSegment[];
  layoutStyle: LayoutStyle;
  zoomTriggers: ZoomTrigger[];
  zoomEnabled: boolean;
};

export const DepthOverlayTrack: React.FC<DepthOverlayTrackProps> = ({
  clips,
  talkingHead,
  speakerCutout,
  alphaVideoUrl,
  maskProviders,
  segments,
  layoutStyle,
  zoomTriggers,
  zoomEnabled,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timeSec = frame / fps;
  const clip = activeDepthOverlayAt(clips, timeSec);
  if (!clip) {
    return <>{talkingHead}</>;
  }
  return (
    <DepthOverlayComposite
      clip={clip}
      talkingHead={talkingHead}
      speakerCutout={speakerCutout}
      alphaVideoUrl={alphaVideoUrl}
      maskProviders={maskProviders}
      segments={segments}
      layoutStyle={layoutStyle}
      zoomTriggers={zoomTriggers}
      zoomEnabled={zoomEnabled}
    />
  );
};

const DepthOverlayComposite: React.FC<{
  clip: DepthOverlayClip;
  talkingHead: React.ReactNode;
  speakerCutout?: SubjectMaskContext['speakerCutout'];
  alphaVideoUrl?: string;
  maskProviders?: SubjectMaskProvider[];
  segments: KeepSegment[];
  layoutStyle: LayoutStyle;
  zoomTriggers: ZoomTrigger[];
  zoomEnabled: boolean;
}> = ({
  clip,
  talkingHead,
  speakerCutout,
  alphaVideoUrl,
  maskProviders,
  segments,
  layoutStyle,
  zoomTriggers,
  zoomEnabled,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const local = frame / fps - clip.start;
  const hold = Math.max(0.2, clip.end - clip.start);
  const params = clip.params ?? DEFAULT_DEPTH_OVERLAY_PARAMS;
  const transform = getOverlayTransform(local, hold, params);
  const mask = resolveSubjectMask({speakerCutout, alphaVideoUrl}, maskProviders);
  if (mask.kind !== 'alpha_video' || !keyedCutoutIsUsable(speakerCutout)) {
    return <>{talkingHead}</>;
  }

  const bandTop = height * params.region.y;
  const bandHeight = height * params.region.height;
  const offscreen =
    params.animation.direction === 'down'
      ? bandTop + bandHeight
      : Math.max(bandHeight, height - bandTop);
  const translateY = transform.y * offscreen;
  const featherPct = Math.round(params.edgeMask.feather * 100);
  const objectFit = params.region.fit === 'fit' ? 'contain' : 'cover';
  const src = resolveMediaSrc(clip.assetUrl);
  const from = secToFrame(clip.start, fps);
  const holdFrames = framesBetween(clip.start, clip.end, fps);
  const sourceFrames = Math.max(1, Math.round(Math.max(clip.durationSec ?? 2, 0.4) * fps));
  const overlay = (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: bandTop,
        width,
        height: bandHeight,
        opacity: transform.opacity,
        transform: `translateY(${translateY}px)`,
        overflow: 'hidden',
        borderRadius: params.edgeMask.rounded ? Math.round(width * 0.04) : 0,
        WebkitMaskImage: `linear-gradient(to bottom, #000 0%, #000 ${100 - featherPct}%, transparent 100%)`,
        maskImage: `linear-gradient(to bottom, #000 0%, #000 ${100 - featherPct}%, transparent 100%)`,
        pointerEvents: 'none',
      }}>
      {clip.mediaKind === 'video' ? (
        <Sequence from={from} durationInFrames={holdFrames} layout="none">
          <Loop durationInFrames={sourceFrames} layout="none">
            <OffthreadVideo
              src={src}
              muted
              style={{width: '100%', height: '100%', objectFit}}
            />
          </Loop>
        </Sequence>
      ) : (
        <Img src={src} style={{width: '100%', height: '100%', objectFit}} />
      )}
    </div>
  );

  const speakerFront = (
    <ZoomFrame triggers={zoomTriggers} enabled={zoomEnabled}>
      <VideoTrack
        src={mask.videoUrl}
        segments={segments}
        layoutStyle={layoutStyle}
        transparent
        muted
      />
    </ZoomFrame>
  );

  return (
    <AbsoluteFill>
      {talkingHead}
      {overlay}
      {speakerFront}
    </AbsoluteFill>
  );
};
