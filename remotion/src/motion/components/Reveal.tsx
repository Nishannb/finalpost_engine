import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import {exitProgress, progress, springIn, type EaseName, type SpringPreset} from '../animation';

export type RevealEffect =
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'scale'
  | 'pop'
  | 'wipe-right'
  | 'wipe-left'
  | 'wipe-up'
  | 'wipe-down'
  | 'grow-x'
  | 'grow-y';

export type RevealProps = {
  /** One effect or several combined, e.g. ['fade', 'slide-up']. Default ['fade', 'slide-up']. */
  effect?: RevealEffect | RevealEffect[];
  /** Frames before the entrance starts (relative to the current Sequence). */
  delay?: number;
  /** Entrance length in frames (eased mode). Default 14. */
  duration?: number;
  easing?: EaseName;
  /** Use a spring instead of an eased tween. */
  spring?: SpringPreset;
  /** Slide distance in px. Default 48. */
  distance?: number;
  /** Fade out at the end of the current Sequence. true = 10 frames, or a frame count. */
  exit?: boolean | number;
  /** Override: drive the entrance yourself with a 0–1 value. */
  progress?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/**
 * Animates its children in (and optionally out). Pure wrapper: it does not
 * position anything, so put it inside a Box or give it `style`.
 */
export const Reveal: React.FC<RevealProps> = ({
  effect = ['fade', 'slide-up'],
  delay = 0,
  duration = 14,
  easing = 'out',
  spring,
  distance = 48,
  exit,
  progress: override,
  style,
  children,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const effects = Array.isArray(effect) ? effect : [effect];
  const t =
    override ?? (spring ? springIn(frame, fps, delay, spring) : progress(frame, delay, duration, easing));
  const out = exit ? exitProgress(frame, durationInFrames, exit === true ? 10 : exit) : 1;
  const clamped = Math.max(0, Math.min(1, t));

  let opacity = 1;
  let tx = 0;
  let ty = 0;
  let scaleX = 1;
  let scaleY = 1;
  let clipPath: string | undefined;
  let transformOrigin: string | undefined;
  for (const e of effects) {
    switch (e) {
      case 'fade':
        opacity *= clamped;
        break;
      case 'slide-up':
        ty += (1 - t) * distance;
        break;
      case 'slide-down':
        ty -= (1 - t) * distance;
        break;
      case 'slide-left':
        tx += (1 - t) * distance;
        break;
      case 'slide-right':
        tx -= (1 - t) * distance;
        break;
      case 'scale':
        scaleX *= 0.85 + 0.15 * t;
        scaleY *= 0.85 + 0.15 * t;
        break;
      case 'pop':
        scaleX *= Math.max(0, t);
        scaleY *= Math.max(0, t);
        break;
      case 'wipe-right':
        clipPath = `inset(0 ${(1 - clamped) * 100}% 0 0)`;
        break;
      case 'wipe-left':
        clipPath = `inset(0 0 0 ${(1 - clamped) * 100}%)`;
        break;
      case 'wipe-up':
        clipPath = `inset(${(1 - clamped) * 100}% 0 0 0)`;
        break;
      case 'wipe-down':
        clipPath = `inset(0 0 ${(1 - clamped) * 100}% 0)`;
        break;
      case 'grow-x':
        scaleX *= Math.max(0, t);
        transformOrigin = 'left center';
        break;
      case 'grow-y':
        scaleY *= Math.max(0, t);
        transformOrigin = 'center bottom';
        break;
    }
  }

  return (
    <div
      style={{
        ...style,
        opacity: opacity * out * (style?.opacity === undefined ? 1 : Number(style.opacity)),
        transform: `translate(${tx}px, ${ty}px) scale(${scaleX}, ${scaleY})${style?.transform ? ` ${style.transform}` : ''}`,
        transformOrigin: transformOrigin ?? style?.transformOrigin,
        clipPath,
      }}>
      {children}
    </div>
  );
};

export type StaggerProps = Omit<RevealProps, 'progress' | 'children'> & {
  /** Frames between consecutive children. Default 5. */
  each?: number;
  children: React.ReactNode;
};

/** Reveals each child in turn: child i starts at delay + i × each. */
export const Stagger: React.FC<StaggerProps> = ({each = 5, delay = 0, children, ...reveal}) => (
  <>
    {React.Children.toArray(children).map((child, i) => (
      <Reveal key={i} {...reveal} delay={delay + i * each}>
        {child}
      </Reveal>
    ))}
  </>
);

export type BoxProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/** Absolutely positioned container in region pixels. The basic layout unit. */
export const Box: React.FC<BoxProps> = ({x, y, width, height, style, children}) => (
  <div style={{position: 'absolute', left: x, top: y, width, height, ...style}}>{children}</div>
);
