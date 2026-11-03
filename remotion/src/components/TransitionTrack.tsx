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
import {proceduralLayer, proceduralStyleOf} from '../lib/proceduralTransition';
import {drawableTransitions} from '../lib/timeline';

type TransitionTrackProps = {
  clips: TransitionClip[];
};

export const TransitionTrack: React.FC<TransitionTrackProps> = ({clips}) => {
  const {fps, durationInFrames} = useVideoConfig();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {drawableTransitions(clips, fps, durationInFrames).map(({clip, from, durationInFrames: length}, index) => (
        <Sequence key={`${clip.providerId}-${index}`} from={from} durationInFrames={length}>
          <TransitionTake clip={clip} />
        </Sequence>
      ))}
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
  // WP12C: procedural styles draw themselves from the keyword (no asset): flash / dip, whip smear, grade flip; a hard cut draws nothing.
  const procedural = clip.assetUrl ? null : proceduralStyleOf(clip.keyword);
  if (procedural) return <ProceduralTake style={procedural} frame={frame} durationInFrames={durationInFrames} />;
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

const ProceduralTake: React.FC<{style: NonNullable<ReturnType<typeof proceduralStyleOf>>; frame: number; durationInFrames: number}> = ({style, frame, durationInFrames}) => {
  const layer = proceduralLayer(style, frame, durationInFrames);
  if (layer.kind === 'none') return null;
  if (layer.kind === 'flash') return <AbsoluteFill style={{backgroundColor: layer.color, opacity: layer.opacity}} />;
  if (layer.kind === 'whip') {
    // the bright lead edge sits on the side the smear travels toward
    const angle = layer.direction === 1 ? 90 : 270;
    return (
      <AbsoluteFill
        style={{
          opacity: layer.opacity,
          backdropFilter: `blur(${layer.blurPx}px)`,
          WebkitBackdropFilter: `blur(${layer.blurPx}px)`,
          backgroundImage: `linear-gradient(${angle}deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 35%, rgba(255,255,255,0.22) 65%, rgba(255,255,255,0) 100%)`,
          transform: `translateX(${layer.streakX}px) scaleX(1.12)`,
        }}
      />
    );
  }
  if (layer.kind === 'smash') {
    // smash zoom (WP24): a white blowout closes in from the edges toward a clear centre (the punch), over a light whole-frame wash that peaks with it. No transform and no scaled backdrop (that doubled the picture).
    const clearStop = Math.max(22, 78 - (layer.ringScale - 1) * 120);
    return (
      <AbsoluteFill
        style={{
          backdropFilter: `blur(${layer.blurPx}px)`,
          WebkitBackdropFilter: `blur(${layer.blurPx}px)`,
          backgroundColor: `rgba(255,255,255,${Math.round(layer.edgeOpacity * 0.3 * 1000) / 1000})`,
          backgroundImage: `radial-gradient(ellipse 75% 62% at 50% 50%, rgba(255,255,255,0) ${clearStop}%, rgba(255,255,255,${layer.edgeOpacity}) 100%)`,
        }}
      />
    );
  }
  if (layer.kind === 'dissolve') {
    return (
      <AbsoluteFill
        style={{
          backdropFilter: `blur(${layer.blurPx}px)`,
          WebkitBackdropFilter: `blur(${layer.blurPx}px)`,
          backgroundColor: `rgba(255,255,255,${layer.veilOpacity})`,
        }}
      />
    );
  }
  return <AbsoluteFill style={{backdropFilter: `grayscale(${layer.grayscale}) contrast(${layer.contrast})`, WebkitBackdropFilter: `grayscale(${layer.grayscale}) contrast(${layer.contrast})`}} />;
};
