/**
 * Animated media containerization: full-bleed → inset/card/PiP corner
 * while revealing a canvas. Layout itself is the animatable property.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {
  LanguageCode,
  MediaContainerMoment,
  VisualAnchor,
} from '../blueprintSchema';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

export function activeMediaContainerAt(
  containers: MediaContainerMoment[] | undefined,
  timeSec: number,
): MediaContainerMoment | undefined {
  if (!containers?.length) {
    return undefined;
  }
  return containers.find(
    container => timeSec >= container.start && timeSec < container.end,
  );
}

type MediaContainerFrameProps = {
  container: MediaContainerMoment;
  language: LanguageCode;
  children: React.ReactNode;
};

export const MediaContainerFrame: React.FC<MediaContainerFrameProps> = ({
  container,
  language,
  children,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const transitionFrames = Math.max(
    12,
    Math.round(Math.max(0.85, container.transitionSec || 1) * fps),
  );
  const exitStart = Math.max(
    transitionFrames + 2,
    durationInFrames - transitionFrames,
  );

  const enter = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 95, mass: 0.95},
    durationInFrames: transitionFrames,
  });
  const exit =
    frame >= exitStart
      ? 1 -
        spring({
          frame: frame - exitStart,
          fps,
          config: {damping: 18, stiffness: 100, mass: 0.9},
          durationInFrames: transitionFrames,
        })
      : 1;

  const progress = Math.min(1, enter) * Math.max(0, exit);
  const from = {left: 0, top: 0, width, height, radius: 0};
  const to =
    container.mode === 'pip_corner'
      ? pipBox(container.pipAnchor || 'bottom_right', width, height, container.scale)
      : insetBox(container, width, height);
  const left = interpolate(progress, [0, 1], [from.left, to.left]);
  const top = interpolate(progress, [0, 1], [from.top, to.top]);
  const boxW = interpolate(progress, [0, 1], [from.width, to.width]);
  const boxH = interpolate(progress, [0, 1], [from.height, to.height]);
  const radius = interpolate(
    progress,
    [0, 1],
    [0, Math.max(12, container.cornerRadius || 28)],
  );
  const canvasOpacity = interpolate(progress, [0, 1], [0, 1]);
  const titleOpacity = interpolate(progress, [0.35, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const titleY = interpolate(progress, [0.35, 1], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const canvasColor = container.canvasColor || '#111418';
  const title = (container.canvasTitle || '').trim();
  const titleColor = container.canvasTitleColor || '#0F172A';
  const isPip = container.mode === 'pip_corner';

  return (
    <AbsoluteFill style={{backgroundColor: canvasColor}}>
      <AbsoluteFill
        style={{
          opacity: canvasOpacity,
          backgroundColor: canvasColor,
        }}
      />
      {title && !isPip ? (
        <div
          style={{
            position: 'absolute',
            top: height * 0.045,
            left: width * 0.08,
            right: width * 0.08,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            textAlign: 'center',
            zIndex: 2,
          }}>
          <div
            style={{
              color: titleColor,
              fontSize: Math.round(width * 0.078),
              fontWeight: fontWeightFor(language, 'impact'),
              fontFamily: fontFamilyFor(language, 'impact'),
              fontStyle: 'italic',
              letterSpacing: -0.5,
              lineHeight: 1.1,
            }}>
            {title}
          </div>
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: boxW,
          height: boxH,
          borderRadius: radius,
          overflow: 'hidden',
          boxShadow:
            progress > 0.15
              ? `0 ${22 * progress}px ${52 * progress}px rgba(0,0,0,${0.38 * progress})`
              : 'none',
          border:
            container.mode === 'rounded_window' || isPip
              ? `${Math.max(2, 3 * progress)}px solid rgba(255,255,255,${0.55 * progress})`
              : undefined,
          zIndex: 1,
        }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

function insetBox(
  container: MediaContainerMoment,
  width: number,
  height: number,
): {left: number; top: number; width: number; height: number} {
  const scale = Math.min(0.78, Math.max(0.52, container.scale || 0.62));
  const padX = container.mode === 'card' ? width * 0.08 : width * 0.06;
  const title = (container.canvasTitle || '').trim();
  const padTop = title ? height * 0.14 : height * 0.06;
  const padBottom = height * 0.08;
  const innerW = (width - padX * 2) * scale;
  const innerH = (height - padTop - padBottom) * scale;
  return {
    left: (width - innerW) / 2,
    top: padTop + (height - padTop - padBottom - innerH) / 2,
    width: innerW,
    height: innerH,
  };
}

function pipBox(
  anchor: VisualAnchor,
  width: number,
  height: number,
  scale?: number,
): {left: number; top: number; width: number; height: number} {
  const w = width * Math.min(0.3, Math.max(0.22, scale || 0.26));
  const h = height * 0.24;
  const inset = width * 0.04;
  const captionClearance = height * 0.3;
  const topGap = height * 0.08;
  const right = width - w - inset;
  const left = inset;
  const lowerTop = height - h - captionClearance;
  if (anchor === 'top_left') {
    return {left, top: topGap, width: w, height: h};
  }
  if (anchor === 'top_right' || anchor === 'top') {
    return {left: right, top: topGap, width: w, height: h};
  }
  if (anchor === 'bottom_left') {
    return {left, top: lowerTop, width: w, height: h};
  }
  return {left: right, top: lowerTop, width: w, height: h};
}
