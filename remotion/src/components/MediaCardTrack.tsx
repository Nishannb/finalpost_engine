/**
 * Designed media cards — the motion-graphics layer for photos, screenshots,
 * and inset clips. Assets spring in as rounded cards with a light shadow and
 * optional glow; treatments add scroll, suspense blur, or document focus.
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {VisualAnchor, VisualOverlay} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {SlideshowPlate, overlayHasSlideshow} from './SlideshowPlate';

export const MediaCardView: React.FC<{overlay: VisualOverlay}> = ({overlay}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width, height} = useVideoConfig();
  const staggerDelay = Math.round(Math.max(0, overlay.staggerIndex ?? 0) * 0.1 * fps);
  const local = Math.max(0, frame - staggerDelay);
  const enterFrames = Math.round(0.58 * fps);
  const exitFrames = Math.round(0.42 * fps);
  const exitStart = Math.max(enterFrames + 4, durationInFrames - exitFrames);

  const enter = spring({
    frame: local,
    fps,
    config: {damping: 18, stiffness: 110, mass: 0.75},
    durationInFrames: enterFrames,
  });
  const exit =
    frame >= exitStart
      ? 1 -
        spring({
          frame: frame - exitStart,
          fps,
          config: {damping: 18, stiffness: 120, mass: 0.8},
          durationInFrames: exitFrames,
        })
      : 1;

  const mid = durationInFrames * 0.45;
  const lift = interpolate(frame, [mid - 6, mid, mid + 10], [0, 1, 0.35], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const treatment = overlay.treatment || 'card';
  const opacity = Math.min(1, enter) * Math.max(0, exit);
  const scale = (0.86 + enter * 0.14) * (1 + lift * 0.035);
  const slide = slideFromAnchor(overlay.anchor, enter, width, height);
  const box = cardBox(
    overlay.anchor,
    width,
    height,
    treatment,
    overlay.visualWeight === 'hero',
  );
  const radius = overlay.cornerRadius ?? 28;
  const glow = overlay.glow !== false;
  const accent = overlay.accentColor || '#FDE68A';

  let blurPx = 0;
  if (treatment === 'suspense') {
    const revealAt = durationInFrames * 0.62;
    blurPx = interpolate(frame, [0, revealAt, revealAt + enterFrames], [16, 16, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  const shadowSpread = 18 + lift * 14;
  const shadowAlpha = 0.22 + lift * 0.08;
  const glowAlpha = glow ? 0.28 + lift * 0.12 : 0;

  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity}}>
      <div
        style={{
          position: 'absolute',
          ...box,
          transform: `translate(${slide.x}px, ${slide.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          borderRadius: radius,
          boxShadow: [
            `0 ${12 + lift * 10}px ${shadowSpread}px rgba(0,0,0,${shadowAlpha})`,
            glow ? `0 0 ${22 + lift * 10}px ${hexToRgba(accent, glowAlpha)}` : '',
          ]
            .filter(Boolean)
            .join(', '),
        }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: radius,
            overflow: 'hidden',
            backgroundColor: '#0B0B0F',
          }}>
          <CardMedia overlay={overlay} blurPx={blurPx} />
          {treatment === 'focus' && overlay.focusRegion ? (
            <FocusHighlight region={overlay.focusRegion} frame={frame} fps={fps} accent={accent} />
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CardMedia: React.FC<{overlay: VisualOverlay; blurPx: number}> = ({
  overlay,
  blurPx,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const treatment = overlay.treatment || 'card';
  const pan =
    treatment === 'scroll' || overlay.scrollAxis === 'y' || overlay.scrollAxis === 'x'
      ? interpolate(frame, [0, Math.max(1, durationInFrames)], [8, 88], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 50;
  const axis = overlay.scrollAxis === 'x' ? 'x' : 'y';
  const objectPosition =
    treatment === 'scroll' || overlay.scrollAxis === 'y' || overlay.scrollAxis === 'x'
      ? axis === 'x'
        ? `${pan}% 50%`
        : `50% ${pan}%`
      : '50% 50%';
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition,
    filter: blurPx > 0.4 ? `blur(${blurPx}px)` : undefined,
    transform: blurPx > 0.4 ? 'scale(1.08)' : undefined,
  };
  if (!overlay.assetUrl && !overlayHasSlideshow(overlay)) {
    return <div style={{...style, backgroundColor: '#111'}} />;
  }
  if (overlayHasSlideshow(overlay)) {
    return <SlideshowPlate overlay={overlay} />;
  }
  if (overlay.mediaKind === 'video') {
    return <OffthreadVideo src={resolveMediaSrc(overlay.assetUrl)} muted style={style} />;
  }
  return <Img src={resolveMediaSrc(overlay.assetUrl)} style={style} />;
};

const FocusHighlight: React.FC<{
  region: NonNullable<VisualOverlay['focusRegion']>;
  frame: number;
  fps: number;
  accent: string;
}> = ({region, frame, fps, accent}) => {
  const wipe = interpolate(frame, [0, Math.round(0.55 * fps)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const left = `${clamp01(region.x) * 100}%`;
  const top = `${clamp01(region.y) * 100}%`;
  const width = `${clamp01(region.w) * 100}%`;
  const height = `${clamp01(region.h) * 100}%`;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: `rgba(8,8,10,${0.32 * wipe})`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          overflow: 'hidden',
          pointerEvents: 'none',
          borderRadius: 4,
        }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${wipe * 100}%`,
            backgroundColor: hexToRgba(accent, 0.55),
            mixBlendMode: 'multiply',
          }}
        />
      </div>
    </>
  );
};

function cardBox(
  anchor: VisualAnchor,
  width: number,
  height: number,
  treatment: string,
  hero = false,
): React.CSSProperties {
  const tall = treatment === 'scroll' || treatment === 'focus';
  const slideshow = treatment === 'slideshow';
  const w = width * (hero ? 0.7 : slideshow ? 0.42 : tall ? 0.38 : 0.34);
  const h = height * (hero ? 0.52 : slideshow ? 0.28 : tall ? 0.26 : 0.2);
  const inset = width * 0.045;
  const top = height * (hero ? 0.08 : 0.07);
  const bottom = height * 0.24;
  if (anchor === 'top_left') {
    return {top, left: inset, width: w, height: h};
  }
  if (anchor === 'top' || anchor === 'top_right') {
    return {top, right: inset, width: w, height: h};
  }
  if (anchor === 'bottom_left') {
    return {bottom, left: inset, width: w, height: h};
  }
  return {bottom, right: inset, width: w, height: h};
}

function slideFromAnchor(
  anchor: VisualAnchor,
  enter: number,
  width: number,
  height: number,
): {x: number; y: number} {
  const t = 1 - enter;
  if (anchor === 'top' || anchor === 'top_left' || anchor === 'top_right') {
    return {x: 0, y: -height * 0.16 * t};
  }
  if (anchor === 'bottom_left' || anchor === 'bottom') {
    return {x: -width * 0.12 * t, y: height * 0.14 * t};
  }
  if (anchor === 'bottom_right') {
    return {x: width * 0.12 * t, y: height * 0.14 * t};
  }
  return {x: width * 0.16 * t, y: 0};
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) {
    return `rgba(253, 230, 138, ${alpha})`;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
