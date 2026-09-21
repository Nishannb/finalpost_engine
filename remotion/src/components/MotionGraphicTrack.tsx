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

import type {
  LanguageCode,
  MotionGraphic,
  NorthStarDesign,
} from '../blueprintSchema';
import {framesBetween, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

type MotionGraphicTrackProps = {
  graphics: MotionGraphic[];
  language: LanguageCode;
  design?: NorthStarDesign;
};

export const MotionGraphicTrack: React.FC<MotionGraphicTrackProps> = ({
  graphics,
  language,
  design,
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
          <MotionGraphicView graphic={graphic} language={language} design={design} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const MotionGraphicView: React.FC<{
  graphic: MotionGraphic;
  language: LanguageCode;
  design?: NorthStarDesign;
}> = ({graphic, language, design}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const enterFrames = Math.round(
    (!design
      ? 1.05
      : design.motionPreset === 'kinetic'
        ? 0.58
        : design.motionPreset === 'editorial'
          ? 1.25
          : 0.88) * fps,
  );
  const exitFrames = Math.round(
    (!design ? 0.78 : design.motionPreset === 'editorial' ? 0.95 : 0.62) * fps,
  );
  const exitStart = Math.max(enterFrames + 2, durationInFrames - exitFrames);

  const enter = spring({
    frame,
    fps,
    config:
      design?.motionPreset === 'kinetic'
        ? {damping: 12, stiffness: 210, mass: 0.55}
        : design?.motionPreset === 'editorial'
          ? {damping: 26, stiffness: 52, mass: 1.1}
          : design
            ? {damping: 18, stiffness: 120, mass: 0.8}
            : {damping: 16, stiffness: 140, mass: 0.72},
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
          config: {damping: 18, stiffness: 115, mass: 0.8},
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
  const {tx, ty, scale, blur, rotate} = entranceTransform(
    graphic.entrance,
    enter,
    exitT,
    width,
  );
  const kinetic = !design || design.motionPreset === 'kinetic';
  const idle =
    frame > enterFrames && frame < exitStart
      ? 1 + Math.sin((frame / fps) * Math.PI * (kinetic ? 3.4 : 1.8)) * (kinetic ? 0.028 : 0.01)
      : 1;
  const wobble =
    kinetic && frame > enterFrames && frame < exitStart
      ? Math.sin((frame / fps) * Math.PI * 2.2) * 1.4
      : 0;

  const baseSize =
    graphic.role === 'primary'
      ? width * 0.058
      : graphic.role === 'secondary'
        ? width * 0.046
        : width * 0.04;
  const fontSize = Math.round(baseSize * Math.max(0.6, graphic.fontScale || 1));
  const pos = anchorStyle(graphic.anchor, width, height);
  const words = graphic.text.trim().split(/\s+/).filter(Boolean);

  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          position: 'absolute',
          ...pos,
          transform: `translate(${tx}px, ${ty}px) scale(${scale * idle}) rotate(${rotate + wobble}deg)`,
          filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
          maxWidth: width * 0.88,
          alignItems: pos.alignItems,
          clipPath:
            graphic.entrance === 'mask_wipe'
              ? `inset(0 ${Math.max(0, (1 - enter) * 100)}% 0 0)`
              : undefined,
        }}>
        <ShapeBehind
          shape={graphic.shape}
          accent={graphic.accentColor}
          progress={enter}
          kinetic={kinetic}
          frame={frame}
          fps={fps}>
          {graphic.entrance === 'highlight_type' ? (
            <HighlightType
              graphic={graphic}
              language={language}
              fontSize={fontSize}
              progress={enter}
              design={design}
            />
          ) : graphic.entrance === 'type_stagger' ? (
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
                  frame: Math.max(0, frame - i * (kinetic ? 2 : 3)),
                  fps,
                  config: {damping: 11, stiffness: 220, mass: 0.5},
                  durationInFrames: enterFrames,
                });
                return (
                  <span
                    key={`${word}-${i}`}
                    style={{
                      ...textStyle(graphic, language, fontSize, design),
                      opacity: wordEnter,
                      display: 'inline-block',
                      transform: `translateY(${(1 - wordEnter) * 22}px) rotate(${(1 - wordEnter) * -8}deg) scale(${0.82 + 0.18 * wordEnter})`,
                    }}>
                    {word}
                  </span>
                );
              })}
            </div>
          ) : (
            <div style={textStyle(graphic, language, fontSize, design)}>
              {graphic.text}
            </div>
          )}
        </ShapeBehind>
      </div>
    </AbsoluteFill>
  );
};

function HighlightType({
  graphic,
  language,
  fontSize,
  progress,
  design,
}: {
  graphic: MotionGraphic;
  language: LanguageCode;
  fontSize: number;
  progress: number;
  design?: NorthStarDesign;
}) {
  const text = graphic.text;
  const count = Math.max(0, Math.round(text.length * progress));
  const typed = text.slice(0, count);
  return (
    <div style={{position: 'relative', display: 'inline-block'}}>
      <div
        style={{
          position: 'absolute',
          left: -10,
          top: '10%',
          bottom: '6%',
          width: `${progress * 100}%`,
          backgroundColor: graphic.accentColor,
          borderRadius: 8,
          zIndex: 0,
        }}
      />
      <div
        style={{
          ...textStyle(graphic, language, fontSize, design),
          position: 'relative',
          zIndex: 1,
          color: '#0F172A',
          textShadow: 'none',
        }}>
        {typed}
        <span
          style={{
            opacity: progress < 1 && Math.floor(progress * 12) % 2 === 0 ? 1 : 0,
            color: graphic.accentColor,
          }}>
          |
        </span>
        <span style={{opacity: 0}}>{text.slice(typed.length)}</span>
      </div>
    </div>
  );
}

function textStyle(
  graphic: MotionGraphic,
  language: LanguageCode,
  fontSize: number,
  design?: NorthStarDesign,
): React.CSSProperties {
  return {
    color: graphic.textColor || '#FFFFFF',
    fontSize,
    fontWeight: fontWeightFor(
      language,
      graphic.role === 'accent' ? 'sans' : 'impact',
      design,
    ),
    fontFamily: fontFamilyFor(
      language,
      graphic.role === 'accent' ? 'sans' : 'impact',
      design,
    ),
    fontStyle: graphic.italic ? 'italic' : 'normal',
    letterSpacing:
      design?.motionPreset === 'editorial'
        ? -0.6
        : graphic.role === 'primary'
          ? -1.2
          : -0.4,
    lineHeight: 1.05,
    textAlign:
      design?.motionPreset === 'editorial' ? 'left' : 'center',
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
  kinetic,
  frame,
  fps,
  children,
}: {
  shape: MotionGraphic['shape'];
  accent: string;
  progress: number;
  kinetic: boolean;
  frame: number;
  fps: number;
  children: React.ReactNode;
}) {
  const shapeScale = interpolate(progress, [0, 1], [0.72, 1]);
  const pulse =
    kinetic && progress > 0.85
      ? 1 + Math.sin((frame / fps) * Math.PI * 4) * 0.04
      : 1;
  if (shape === 'none') {
    return <>{children}</>;
  }
  if (shape === 'underline') {
    return (
      <div style={{display: 'inline-flex', flexDirection: 'column', gap: 6}}>
        {children}
        <div
          style={{
            height: kinetic ? 7 : 5,
            borderRadius: 999,
            backgroundColor: accent,
            transform: `scaleX(${shapeScale * pulse})`,
            transformOrigin: 'left center',
            opacity: progress,
            boxShadow: kinetic ? `0 0 18px ${accent}` : undefined,
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
          transform: `scale(${shapeScale * pulse})`,
          boxShadow: kinetic ? `0 10px 28px rgba(0,0,0,0.28)` : undefined,
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
          transform: `scale(${shapeScale}) skewX(${(1 - progress) * -8}deg)`,
          boxShadow: kinetic ? `0 12px 30px rgba(0,0,0,0.3)` : undefined,
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
            inset: '12% -8% -10% -8%',
            backgroundColor: accent,
            opacity: 0.94,
            transform: `scaleX(${shapeScale}) rotate(${(1 - progress) * -3}deg)`,
            transformOrigin: 'left center',
            zIndex: 0,
            boxShadow: kinetic ? `0 0 24px ${accent}` : undefined,
          }}
        />
        <div style={{position: 'relative', zIndex: 1}}>{children}</div>
      </div>
    );
  }
  if (shape === 'bubble') {
    return (
      <div
        style={{
          backgroundColor: accent,
          borderRadius: 28,
          borderBottomLeftRadius: 6,
          padding: '14px 22px',
          transform: `scale(${shapeScale * pulse})`,
          boxShadow: '0 14px 32px rgba(0,0,0,0.32)',
        }}>
        {children}
      </div>
    );
  }
  // outline_box
  return (
    <div
      style={{
        border: `${kinetic ? 4 : 3}px solid ${accent}`,
        borderRadius: 14,
        padding: '12px 18px',
        transform: `scale(${shapeScale * pulse})`,
        backgroundColor: 'rgba(0,0,0,0.34)',
        boxShadow: kinetic ? `0 0 0 6px rgba(255,255,255,0.08)` : undefined,
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
): {tx: number; ty: number; scale: number; blur: number; rotate: number} {
  const t = enter * exitT;
  switch (entrance) {
    case 'slide_left':
      return {tx: (1 - enter) * -width * 0.32, ty: 0, scale: 1, blur: 0, rotate: (1 - enter) * -6};
    case 'slide_right':
      return {tx: (1 - enter) * width * 0.32, ty: 0, scale: 1, blur: 0, rotate: (1 - enter) * 6};
    case 'scale_pop':
      return {tx: 0, ty: 0, scale: 0.42 + 0.58 * t, blur: 0, rotate: (1 - enter) * 8};
    case 'fade_blur':
      return {tx: 0, ty: (1 - enter) * 16, scale: 1, blur: (1 - enter) * 12, rotate: 0};
    case 'mask_wipe':
      return {tx: (1 - enter) * 24, ty: 0, scale: 0.96 + 0.04 * t, blur: 0, rotate: 0};
    case 'highlight_type':
      return {tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0};
    case 'slide_from_edge':
      return {tx: (1 - enter) * width * 0.28, ty: (1 - enter) * -28, scale: 1, blur: 0, rotate: (1 - enter) * 10};
    case 'type_stagger':
      return {tx: 0, ty: 0, scale: 0.96 + 0.04 * t, blur: 0, rotate: 0};
    case 'spring_up':
    default:
      return {tx: 0, ty: (1 - enter) * 56, scale: 0.84 + 0.16 * t, blur: 0, rotate: (1 - enter) * -4};
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
      return {...base, top: height * 0.08, left: pad, maxWidth: width * 0.42, alignItems: 'flex-start'};
    case 'top_left':
      return {
        ...base,
        top: height * 0.08,
        left: pad,
        alignItems: 'flex-start',
        maxWidth: width * 0.42,
      };
    case 'top_right':
      return {
        ...base,
        top: height * 0.08,
        right: pad,
        alignItems: 'flex-end',
        maxWidth: width * 0.42,
      };
    case 'bottom':
      return {...base, bottom: height * 0.24, left: pad, maxWidth: width * 0.42, alignItems: 'flex-start'};
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
