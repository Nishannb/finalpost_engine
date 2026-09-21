/**
 * Related stills cycling in one slot — overlay card or split half.
 * One image stays as a Ken Burns still; two or more crossfade.
 */

import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import type {VisualOverlay} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';

export function overlayHasSlideshow(overlay: VisualOverlay): boolean {
  if ((overlay.slides?.length ?? 0) >= 2) {
    return true;
  }
  return overlay.treatment === 'slideshow' && overlay.mediaKind !== 'video';
}

export const SlideshowPlate: React.FC<{
  overlay: VisualOverlay;
}> = ({overlay}) => {
  const slides =
    overlay.slides && overlay.slides.length > 0
      ? overlay.slides
      : overlay.assetUrl
        ? [
            {
              assetUrl: overlay.assetUrl,
              provider: overlay.provider,
              providerId: overlay.providerId,
              width: overlay.width,
              height: overlay.height,
              credit: overlay.credit,
              creditUrl: overlay.creditUrl,
            },
          ]
        : [];
  if (slides.length === 0) {
    return <AbsoluteFill style={{backgroundColor: '#111'}} />;
  }
  if (slides.length === 1) {
    return (
      <SlideFill
        src={slides[0]!.assetUrl}
        video={overlay.mediaKind === 'video'}
        kenBurns
      />
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: '#111'}}>
      {slides.map((slide, index) => (
        <SlideFrame
          key={`${slide.assetUrl}-${index}`}
          src={slide.assetUrl}
          index={index}
          total={slides.length}
        />
      ))}
    </AbsoluteFill>
  );
};

const SlideFrame: React.FC<{src: string; index: number; total: number}> = ({
  src,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const slot = durationInFrames / total;
  const fade = Math.max(4, Math.round(0.28 * fps));
  const start = Math.round(index * slot);
  const end = Math.round((index + 1) * slot);
  const first = index === 0;
  const last = index === total - 1;
  const opacity = interpolate(
    frame,
    [start, start + fade, Math.max(start + fade + 1, end - fade), end],
    [first ? 1 : 0, 1, 1, last ? 1 : 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return (
    <AbsoluteFill style={{opacity}}>
      <SlideFill src={src} kenBurns />
    </AbsoluteFill>
  );
};

const SlideFill: React.FC<{src: string; video?: boolean; kenBurns?: boolean}> = ({
  src,
  video,
  kenBurns,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const zoom = kenBurns
    ? interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.08], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: `scale(${zoom})`,
  };
  if (video) {
    return <OffthreadVideo src={resolveMediaSrc(src)} muted style={style} />;
  }
  return <Img src={resolveMediaSrc(src)} style={style} />;
};
