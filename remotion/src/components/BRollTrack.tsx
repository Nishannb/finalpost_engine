/**
 * B-roll overlay track.
 *
 * Cutaways sit above the speaker and below the captions, so the words stay
 * readable through the overlay. Clips are muted (the speaker keeps talking) and
 * cross-faded so a 2.5 s insert does not read as a hard glitch.
 */

import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import type {BRollClip} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {framesBetween, secToFrame} from '../lib/timeline';

const FADE_SEC = 0.25;

type BRollTrackProps = {
  clips: BRollClip[];
  showCredit?: boolean;
};

export const BRollTrack: React.FC<BRollTrackProps> = ({clips, showCredit}) => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill>
      {clips.filter(clip => clip.assetUrl).map((clip, index) => (
        <Sequence
          key={`${clip.providerId}-${index}`}
          from={secToFrame(clip.start, fps)}
          durationInFrames={framesBetween(clip.start, clip.end, fps)}>
          <BRollClipView clip={clip} showCredit={showCredit ?? false} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const BRollClipView: React.FC<{clip: BRollClip; showCredit: boolean}> = ({
  clip,
  showCredit,
}) => {
  const frame = useCurrentFrame();
  // Inside a Sequence these are the clip's own frame count and local frame.
  const {fps, durationInFrames, width} = useVideoConfig();
  const fadeFrames = Math.max(1, Math.round(FADE_SEC * fps));
  const opacity = interpolate(
    frame,
    [
      0,
      fadeFrames,
      Math.max(fadeFrames, durationInFrames - fadeFrames),
      durationInFrames,
    ],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill style={{opacity}}>
      <OffthreadVideo
        src={resolveMediaSrc(clip.assetUrl)}
        muted
        style={{width: '100%', height: '100%', objectFit: 'cover'}}
      />
      {showCredit ? (
        <div
          style={{
            position: 'absolute',
            bottom: width * 0.02,
            right: width * 0.03,
            color: 'rgba(255,255,255,0.72)',
            fontSize: width * 0.018,
            textShadow: '0 1px 3px rgba(0,0,0,0.6)',
          }}>
          {`${clip.credit} / Pexels`}
        </div>
      ) : null}
      {/* Slight top scrim so white stock footage never washes out the captions. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 35%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
