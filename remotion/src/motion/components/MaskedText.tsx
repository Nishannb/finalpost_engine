import React from 'react';
import {useCurrentFrame} from 'remotion';

import {progress, type EaseName} from '../animation';
import {regionClipPath, revealClipPath, type ClipRegion, type MaskRevealKind} from '../masks';

/**
 * Shape clipping for text and graphics. None of this is subject-aware: it hides parts of a layer inside a region you describe. Behind-the-speaker
 * text is a separate compositor feature that needs a real foreground matte (see masks.ts `decideTextBehindSubject`).
 */

export type ClipWindowProps = {
  /** The window (px, in this component's own box). Children are visible only inside it. */
  region: ClipRegion;
  /** Size of the box the children are laid out in. */
  width: number;
  height: number;
  /** Optional fill painted inside the window behind the children (a panel). */
  fill?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/** Text (or any child) clipped inside a shape: whatever leaves the window is hidden, so text can slide through it. */
export const ClipWindow: React.FC<ClipWindowProps> = ({region, width, height, fill, style, children}) => (
  <div style={{position: 'relative', width, height, ...style}}>
    {fill ? <div style={{position: 'absolute', inset: 0, background: fill, clipPath: regionClipPath(region)}} /> : null}
    <div style={{position: 'absolute', inset: 0, clipPath: regionClipPath(region)}}>{children}</div>
  </div>
);

export type MaskRevealProps = {
  kind?: MaskRevealKind;
  width: number;
  height: number;
  /** Frames before the reveal starts. */
  delay?: number;
  /** Reveal length in frames. Default 18. */
  duration?: number;
  easing?: EaseName;
  /** Override: drive the reveal with a 0-1 value. */
  progress?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/** Reveals its children through an animated clip region (wipe, slit, iris). At the end nothing is clipped. */
export const MaskReveal: React.FC<MaskRevealProps> = ({kind = 'wipe-right', width, height, delay = 0, duration = 18, easing = 'inOut', progress: override, style, children}) => {
  const frame = useCurrentFrame();
  const t = override ?? progress(frame - delay, 0, duration, easing);
  return <div style={{position: 'relative', width, height, clipPath: revealClipPath(kind, t, width, height), ...style}}>{children}</div>;
};

export type LayeredTextProps = {
  width: number;
  height: number;
  /** Behind the text (a panel, gradient, shape). */
  background?: React.ReactNode;
  /** The text. */
  text: React.ReactNode;
  /** In FRONT of the text. Only the part inside `foregroundRegion` is shown, so a shape can overlap part of the text and read as depth. */
  foreground?: React.ReactNode;
  foregroundRegion?: ClipRegion;
  style?: React.CSSProperties;
};

/**
 * background / text / foreground in one box. The foreground overlaps the text only where `foregroundRegion` allows, which gives the "text tucked
 * behind a shape" look from plain layering. It is NOT depth-aware: the foreground is an authored shape, not the speaker.
 */
export const LayeredText: React.FC<LayeredTextProps> = ({width, height, background, text, foreground, foregroundRegion, style}) => (
  <div style={{position: 'relative', width, height, ...style}}>
    <div style={{position: 'absolute', inset: 0}}>{background}</div>
    <div style={{position: 'absolute', inset: 0}}>{text}</div>
    {foreground ? (
      <div style={{position: 'absolute', inset: 0, clipPath: foregroundRegion ? regionClipPath(foregroundRegion) : undefined}}>{foreground}</div>
    ) : null}
  </div>
);
