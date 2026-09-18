/**
 * Short stock wipes (light leak, film burn, ink, smoke) played over a cut
 * so a B-roll or split change does not read as a slideshow dissolve.
 */

import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {TransitionClip} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {framesBetween, secToFrame} from '../lib/timeline';

type TransitionTrackProps = {
  clips: TransitionClip[];
};

export const TransitionTrack: React.FC<TransitionTrackProps> = ({clips}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {clips.filter(clip => clip.assetUrl).map((clip, index) => {
        const start = Math.max(0, clip.at - clip.duration * 0.35);
        return (
          <Sequence
            key={`${clip.providerId}-${index}`}
            from={secToFrame(start, fps)}
            durationInFrames={framesBetween(start, start + clip.duration, fps)}>
            <TransitionTake clip={clip} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const TransitionTake: React.FC<{clip: TransitionClip}> = ({clip}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, width, height} = useVideoConfig();
  const opacity = interpolate(
    frame,
    [0, 2, Math.max(3, durationInFrames - 3), durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const flash = interpolate(frame, [0, Math.max(1, durationInFrames / 2), durationInFrames], [0.15, 0.85, 0.1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{opacity, mixBlendMode: clip.blend}}>
      {clip.assetUrl ? (
        <OffthreadVideo
          src={resolveMediaSrc(clip.assetUrl)}
          muted
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      ) : (
        <div
          style={{
            width,
            height,
            background: `linear-gradient(115deg, rgba(255,236,200,${flash}) 0%, rgba(255,120,40,${flash * 0.65}) 42%, rgba(255,255,255,0) 78%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
