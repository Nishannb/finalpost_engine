/**
 * Graphic-backed motion typography — stylish titles/callouts with entrances.
 * Shape adapts to text; appearance is parameterized, not templated.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {LanguageCode, MotionGraphic} from '../blueprintSchema';
import {framesBetween, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

type MotionGraphicTrackProps = {
  graphics: MotionGraphic[];
  language: LanguageCode;
};

export const MotionGraphicTrack: React.FC<MotionGraphicTrackProps> = ({
  graphics,
  language,
}) => {
  const {fps} = useVideoConfig();
  if (!graphics.length) {
    return null;
  }

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {graphics.map((graphic, index) => (
        <Sequence
          key={`mg-${graphic.start}-${index}`}
          from={secToFrame(graphic.start, fps)}
          durationInFrames={framesBetween(graphic.start, graphic.end, fps)}>
          <MotionGraphicView graphic={graphic} language={language} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const MotionGraphicView: React.FC<{
  graphic: MotionGraphic;
  language: LanguageCode;
}> = ({graphic, language}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const enterFrames = Math.round(0.45 * fps);
  const exitFrames = Math.round(0.32 * fps);
  const exitStart = Math.max(enterFrames + 2, durationInFrames - exitFrames);

  const enter = spring({
    frame,
    fps,
    config: {damping: 14, stiffness: 160, mass: 0.7},
    durationInFrames: enterFrames,
  });

  let exitT = 1;
  if (frame >= exitStart) {
    const local = frame - exitStart;
    if (graphic.exit === 'spring_out') {
      exitT =
        1 -
        spring({
          frame: local,
          fps,
          config: {damping: 16, stiffness: 180, mass: 0.7},
          durationInFrames: exitFrames,
        });
    } else if (graphic.exit === 'slide_away') {
      exitT = 1 - interpolate(local, [0, exitFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    } else {
      exitT = 1 - interpolate(local, [0, exitFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }
  }

  const opacity = Math.min(1, enter) * Math.max(0, exitT);
  const {tx, ty, scale, blur} = entranceTransform(
    graphic.entrance,
    enter,
    exitT,
    width,
  );

  const baseSize =
    graphic.role === 'primary'
      ? width * 0.11
      : graphic.role === 'secondary'
        ? width * 0.07
        : width * 0.055;
  const fontSize = Math.round(baseSize * Math.max(0.6, graphic.fontScale || 1));
  const pos = anchorStyle(graphic.anchor, width, height);
  const words = graphic.text.trim().split(/\s+/).filter(Boolean);

  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          position: 'absolute',
          ...pos,
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
          maxWidth: width * 0.88,
          alignItems: pos.alignItems,
        }}>
        <ShapeBehind
          shape={graphic.shape}
          accent={graphic.accentColor}
          progress={enter}>
          {graphic.entrance === 'type_stagger' ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent:
                  graphic.anchor.includes('left')
                    ? 'flex-start'
                    : graphic.anchor.includes('right')
                      ? 'flex-end'
                      : 'center',
              }}>
              {words.map((word, i) => {
                const wordEnter = spring({
                  frame: Math.max(0, frame - i * 3),
                  fps,
                  config: {damping: 14, stiffness: 170, mass: 0.65},
                  durationInFrames: enterFrames,
                });
                return (
                  <span
                    key={`${word}-${i}`}
                    style={{
                      ...textStyle(graphic, language, fontSize),
                      opacity: wordEnter,
                      transform: `translateY(${(1 - wordEnter) * 18}px)`,
                    }}>
                    {word}
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={textStyle(graphic, language, fontSize)}>
              {graphic.text}
            </div>
          )}
        </ShapeBehind>
      </div>
    </AbsoluteFill>
  );
};

function textStyle(
  graphic: MotionGraphic,
  language: LanguageCode,
  fontSize: number,
): React.CSSProperties {
  return {
    color: graphic.textColor || '#FFFFFF',
    fontSize,
    fontWeight: fontWeightFor(language, graphic.role === 'accent' ? 'sans' : 'impact'),
    fontFamily: fontFamilyFor(language, graphic.role === 'accent' ? 'sans' : 'impact'),
    fontStyle: graphic.italic ? 'italic' : 'normal',
    letterSpacing: graphic.role === 'primary' ? -1.2 : -0.4,
    lineHeight: 1.05,
    textAlign: 'center',
    textShadow:
      graphic.shape === 'none'
        ? '0 2px 18px rgba(0,0,0,0.45)'
        : '0 1px 8px rgba(0,0,0,0.25)',
  };
}

function ShapeBehind({
  shape,
  accent,
  progress,
  children,
}: {
  shape: MotionGraphic['shape'];
  accent: string;
  progress: number;
  children: React.ReactNode;
}) {
  const shapeScale = interpolate(progress, [0, 1], [0.85, 1]);
  if (shape === 'none') {
    return <>{children}</>;
  }
  if (shape === 'underline') {
    return (
      <div style={{display: 'inline-flex', flexDirection: 'column', gap: 6}}>
        {children}
        <div
          style={{
            height: 5,
            borderRadius: 999,
            backgroundColor: accent,
            transform: `scaleX(${shapeScale})`,
            transformOrigin: 'center',
            opacity: progress,
          }}
        />
      </div>
    );
  }
  if (shape === 'pill') {
    return (
      <div
        style={{
          backgroundColor: accent,
          borderRadius: 999,
          padding: '10px 22px',
          transform: `scale(${shapeScale})`,
        }}>
        {children}
      </div>
    );
  }
  if (shape === 'bar') {
    return (
      <div
        style={{
          backgroundColor: accent,
          borderRadius: 10,
          padding: '12px 18px',
          transform: `scale(${shapeScale})`,
        }}>
        {children}
      </div>
    );
  }
  if (shape === 'block') {
    return (
      <div style={{position: 'relative', display: 'inline-block'}}>
        <div
          style={{
            position: 'absolute',
            inset: '12% -6% -8% -6%',
            backgroundColor: accent,
            opacity: 0.92,
            transform: `scaleX(${shapeScale})`,
            zIndex: 0,
          }}
        />
        <div style={{position: 'relative', zIndex: 1}}>{children}</div>
      </div>
    );
  }
  // outline_box
  return (
    <div
      style={{
        border: `3px solid ${accent}`,
        borderRadius: 14,
        padding: '12px 18px',
        transform: `scale(${shapeScale})`,
        backgroundColor: 'rgba(0,0,0,0.28)',
      }}>
      {children}
    </div>
  );
}

function entranceTransform(
  entrance: MotionGraphic['entrance'],
  enter: number,
  exitT: number,
  width: number,
): {tx: number; ty: number; scale: number; blur: number} {
  const t = enter * exitT;
  switch (entrance) {
    case 'slide_left':
      return {tx: (1 - enter) * -width * 0.25, ty: 0, scale: 1, blur: 0};
    case 'slide_right':
      return {tx: (1 - enter) * width * 0.25, ty: 0, scale: 1, blur: 0};
    case 'scale_pop':
      return {tx: 0, ty: 0, scale: 0.7 + 0.3 * t, blur: 0};
    case 'fade_blur':
      return {tx: 0, ty: (1 - enter) * 12, scale: 1, blur: (1 - enter) * 10};
    case 'mask_wipe':
      return {tx: 0, ty: (1 - enter) * 30, scale: 0.95 + 0.05 * t, blur: 0};
    case 'type_stagger':
      return {tx: 0, ty: 0, scale: 1, blur: 0};
    case 'spring_up':
    default:
      return {tx: 0, ty: (1 - enter) * 40, scale: 0.92 + 0.08 * t, blur: 0};
  }
}

function anchorStyle(
  anchor: MotionGraphic['anchor'],
  width: number,
  height: number,
): React.CSSProperties {
  const pad = width * 0.06;
  const base: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };
  switch (anchor) {
    case 'top':
      return {...base, top: height * 0.1, left: pad, right: pad};
    case 'top_left':
      return {
        ...base,
        top: height * 0.12,
        left: pad,
        alignItems: 'flex-start',
        maxWidth: width * 0.55,
      };
    case 'top_right':
      return {
        ...base,
        top: height * 0.12,
        right: pad,
        alignItems: 'flex-end',
        maxWidth: width * 0.55,
      };
    case 'bottom':
      return {...base, bottom: height * 0.22, left: pad, right: pad};
    case 'bottom_left':
      return {
        ...base,
        bottom: height * 0.24,
        left: pad,
        alignItems: 'flex-start',
        maxWidth: width * 0.55,
      };
    case 'bottom_right':
      return {
        ...base,
        bottom: height * 0.24,
        right: pad,
        alignItems: 'flex-end',
        maxWidth: width * 0.55,
      };
    case 'center':
    default:
      return {
        ...base,
        top: height * 0.38,
        left: pad,
        right: pad,
      };
  }
}
