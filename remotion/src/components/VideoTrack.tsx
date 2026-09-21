/**
 * Base video track: silence-trimmed source, laid out fullscreen or as a stacked
 * podcast split.
 *
 * Each surviving blueprint segment becomes one `Sequence` whose `OffthreadVideo`
 * is trimmed to that slice of the file. Concatenating sequences is what makes the
 * cuts happen — no re-encode pass, and the audio follows the video automatically.
 */

import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig} from 'remotion';

import type {KeepSegment, LayoutStyle} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {framesBetween, secToFrame} from '../lib/timeline';

type VideoTrackProps = {
  src: string;
  segments: KeepSegment[];
  layoutStyle: LayoutStyle;
  objectPosition?: string;
  transparent?: boolean;
  muted?: boolean;
};

export const VideoTrack: React.FC<VideoTrackProps> = ({
  src,
  segments,
  layoutStyle,
  objectPosition = '50% 50%',
  transparent = false,
  muted = false,
}) => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: '#000000'}}>
      {segments.map((segment, index) => {
        const trimBefore = secToFrame(segment.sourceStart, fps);
        const trimAfter = secToFrame(segment.sourceEnd, fps);
        return (
          <Sequence
            key={`${segment.sourceStart}-${index}`}
            from={secToFrame(segment.outputStart, fps)}
            durationInFrames={framesBetween(
              segment.sourceStart,
              segment.sourceEnd,
              fps,
            )}>
            {layoutStyle === 'podcastSplit' ? (
              <PodcastSplitLayout
                src={src}
                trimBefore={trimBefore}
                trimAfter={trimAfter}
                transparent={transparent}
                muted={muted}
              />
            ) : (
              <FullscreenLayout
                src={src}
                trimBefore={trimBefore}
                trimAfter={trimAfter}
                objectPosition={objectPosition}
                transparent={transparent}
                muted={muted}
              />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

type LayerProps = {
  src: string;
  trimBefore: number;
  trimAfter: number;
  objectPosition?: string;
  transparent?: boolean;
  muted?: boolean;
};

const FullscreenLayout: React.FC<LayerProps> = ({
  src,
  trimBefore,
  trimAfter,
  objectPosition = '50% 50%',
  transparent = false,
  muted = false,
}) => (
  <AbsoluteFill>
    <OffthreadVideo
      src={resolveMediaSrc(src)}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      muted={muted}
      transparent={transparent}
      style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition}}
    />
  </AbsoluteFill>
);

/**
 * Stacked split for two-up recordings.
 *
 * The same file is layered twice and each copy is cropped to one speaker: the
 * top tile keeps the left third of the frame, the bottom tile the right third.
 * Only the top copy carries audio so the dialogue is not doubled.
 */
const PodcastSplitLayout: React.FC<LayerProps> = ({
  src,
  trimBefore,
  trimAfter,
  transparent = false,
  muted = false,
}) => (
  <AbsoluteFill>
    <div style={{position: 'absolute', inset: 0, height: '50%', overflow: 'hidden'}}>
      <OffthreadVideo
        src={resolveMediaSrc(src)}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        muted={muted}
        transparent={transparent}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: '28% 50%',
        }}
      />
    </div>
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        height: '50%',
        overflow: 'hidden',
      }}>
      <OffthreadVideo
        src={resolveMediaSrc(src)}
        muted
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: '72% 50%',
        }}
      />
    </div>
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        height: 4,
        marginTop: -2,
        backgroundColor: 'rgba(0,0,0,0.85)',
      }}
    />
  </AbsoluteFill>
);
