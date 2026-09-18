/**
 * Animated media containerization: full-bleed → inset/card/rounded window
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

import type {LanguageCode, MediaContainerMoment} from '../blueprintSchema';
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
    4,
    Math.round(Math.max(0.25, container.transitionSec || 0.55) * fps),
  );
  const exitStart = Math.max(
    transitionFrames + 2,
    durationInFrames - transitionFrames,
  );

  const enter = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 140, mass: 0.85},
    durationInFrames: transitionFrames,
  });
  const exit =
    frame >= exitStart
      ? 1 -
        spring({
          frame: frame - exitStart,
          fps,
          config: {damping: 20, stiffness: 160, mass: 0.8},
          durationInFrames: transitionFrames,
        })
      : 1;

  const progress = Math.min(1, enter) * Math.max(0, exit);
  const targetScale = Math.min(0.92, Math.max(0.55, container.scale || 0.78));
  const scale = interpolate(progress, [0, 1], [1, targetScale]);
  const radius = interpolate(
    progress,
    [0, 1],
    [0, Math.max(12, container.cornerRadius || 36)],
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

  const canvasColor = container.canvasColor || '#FFFFFF';
  const title = (container.canvasTitle || '').trim();
  const titleColor = container.canvasTitleColor || '#0F172A';
  const padX = container.mode === 'card' ? width * 0.08 : width * 0.06;
  const padTop = title ? height * 0.14 : height * 0.06;
  const padBottom = height * 0.08;

  return (
    <AbsoluteFill style={{backgroundColor: canvasColor}}>
      <AbsoluteFill
        style={{
          opacity: canvasOpacity,
          backgroundColor: canvasColor,
        }}
      />
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: height * 0.045,
            left: padX,
            right: padX,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            textAlign: 'center',
            zIndex: 2,
          }}>
          <div
            style={{
              color: titleColor,
              fontSize: Math.round(width * 0.072),
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
          left: padX,
          right: padX,
          top: padTop,
          bottom: padBottom,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: `scale(${scale})`,
            borderRadius: radius,
            overflow: 'hidden',
            boxShadow:
              progress > 0.2
                ? `0 ${24 * progress}px ${60 * progress}px rgba(0,0,0,${0.35 * progress})`
                : 'none',
            border:
              container.mode === 'rounded_window'
                ? `${Math.max(2, 3 * progress)}px solid rgba(255,255,255,${0.5 * progress})`
                : undefined,
          }}>
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
