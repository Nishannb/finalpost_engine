/**
 * Kinetic caption layer.
 *
 * Word timings come from the blueprint, so the spoken word pops on its onset.
 * Placement follows the director's caption position (bottom, lower third,
 * center, or top). Active-word treatment follows the director's animation.
 * Highlight draws a gold shine box over the spoken word.
 */

import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

import type {
  CaptionDirection,
  CaptionWord,
  LanguageCode,
  NorthStarDesign,
  RenderStyle,
} from '../blueprintSchema';
import {activeLineAt, groupCaptionLines} from '../lib/timeline';
import {
  captionTemplateFor,
  scaleFromPreview,
  type CaptionTemplate,
} from '../styles/captionTemplates';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

type KineticCaptionsProps = {
  words: CaptionWord[];
  style: RenderStyle;
  language: LanguageCode;
  direction?: CaptionDirection;
  design?: NorthStarDesign;
  fontFamily?: string;
};

export const KineticCaptions: React.FC<KineticCaptionsProps> = ({
  words,
  style,
  language,
  direction,
  design,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const template = captionTemplateFor(
    style.captionTemplate || direction?.template || 'classic',
  );
  const merged = {
    ...template,
    uppercase: direction?.uppercase ?? template.uppercase,
    animation: mapCaptionAnimation(direction?.animation) || template.animation,
    primaryColor: direction?.textColor ?? template.primaryColor,
    highlightColor: direction?.highlightColor ?? template.highlightColor,
    backgroundColor: direction?.boxColor ?? template.backgroundColor,
  };
  const centerMode = direction?.position === 'center';
  const bottomFrac = captionBottomFor(
    direction?.position,
    direction?.bottomFrac ?? style.captionBottomFrac,
  );

  const lines = React.useMemo(
    () =>
      groupCaptionLines(words, {
        maxWords:
          design?.contentType === 'story' || design?.contentType === 'testimonial'
            ? 4
            : 3,
      }),
    [words, design?.contentType],
  );
  const timeSec = frame / fps;
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }

  const fontSize = scaleFromPreview(template.fontSizePt, width) * (direction?.fontScale || 1);
  const outlineWidth = scaleFromPreview(Math.min(template.outlineWidthPt, 3.5), width);
  const topMode = direction?.position === 'top';

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          ...(centerMode
            ? {top: '50%', transform: 'translate(-50%, -50%)'}
            : topMode
              ? {
                  top: height * Math.min(0.22, direction?.bottomFrac ?? 0.12),
                  transform: 'translateX(-50%)',
                }
              : {
                  bottom: height * bottomFrac,
                  transform: 'translateX(-50%)',
                }),
          left: `${style.captionCenterXFrac * 100}%`,
          zIndex: 30,
          width: width * template.maxWidthFrac,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'flex-end',
          gap: fontSize * 0.18,
          ...(merged.backgroundColor && merged.animation !== 'highlight'
            ? {
                backgroundColor: merged.backgroundColor,
                borderRadius: fontSize * 0.35,
                padding: `${fontSize * 0.24}px ${fontSize * 0.42}px`,
                width: 'auto',
                maxWidth: width * template.maxWidthFrac,
              }
            : {}),
        }}>
        {line.words.map((word, index) => (
          <CaptionWordView
            key={`${word.start}-${index}`}
            word={word}
            template={merged}
            language={language}
            timeSec={timeSec}
            fps={fps}
            fontSize={fontSize}
            outlineWidth={outlineWidth}
            design={design}
            fontFamily={fontFamily}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

type CaptionWordViewProps = {
  word: CaptionWord;
  template: CaptionTemplate;
  language: LanguageCode;
  timeSec: number;
  fps: number;
  fontSize: number;
  outlineWidth: number;
  design?: NorthStarDesign;
  fontFamily?: string;
};

const CaptionWordView: React.FC<CaptionWordViewProps> = ({
  word,
  template,
  language,
  timeSec,
  fps,
  fontSize,
  outlineWidth,
  design,
  fontFamily,
}) => {
  const isActive = timeSec >= word.start && timeSec <= word.end;
  const isPast = timeSec > word.end;
  const sinceOnset = Math.max(0, timeSec - word.start) * fps;
  const entrance = spring({
    frame: sinceOnset,
    fps,
    config: {damping: 11, mass: 0.42, stiffness: 240},
    durationInFrames: Math.round(fps * 0.26),
  });
  const useShine = template.animation === 'highlight';
  const pop = isActive
    ? 1 + entrance * (template.animation === 'bounce' ? 0.22 : 0.1)
    : 1;
  const lift = isActive && template.animation === 'bounce' ? entrance * fontSize * 0.14 : 0;
  const shineTravel =
    useShine && isActive
      ? interpolate(timeSec, [word.start, Math.min(word.end, word.start + 0.42)], [-20, 108], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : -20;
  const karaokeFill = isActive
    ? interpolate(timeSec, [word.start, word.end], [0, 100], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : isPast
      ? 100
      : 0;

  const text = template.uppercase ? word.text.toUpperCase() : word.text;
  const color = isActive ? template.highlightColor : template.primaryColor;
  const padX = useShine ? fontSize * 0.32 : fontSize * 0.16;
  const padY = useShine ? fontSize * 0.16 : fontSize * 0.08;
  const useKaraokeFill = template.animation === 'karaoke';

  const textStyle: React.CSSProperties = {
    fontFamily: fontFamily || fontFamilyFor(language, template.weight, design),
    fontWeight: fontWeightFor(language, template.weight, design),
    fontSize,
    lineHeight: 1.05,
    letterSpacing:
      design?.motionPreset === 'editorial' ? -fontSize * 0.012 : fontSize * 0.005,
    whiteSpace: 'pre',
    display: 'inline-block',
    position: 'relative',
    zIndex: 1,
    opacity: isActive ? 1 : isPast ? 0.94 : 0.78,
  };
  if (useKaraokeFill) {
    textStyle.backgroundImage = `linear-gradient(90deg, ${template.highlightColor} ${karaokeFill}%, ${template.primaryColor} ${karaokeFill}%)`;
    textStyle.WebkitBackgroundClip = 'text';
    textStyle.backgroundClip = 'text';
    textStyle.WebkitTextFillColor = 'transparent';
  } else if (useShine) {
    textStyle.color = isActive ? template.highlightColor : template.primaryColor;
    textStyle.textShadow = isActive
      ? `0 0 ${fontSize * 0.2}px ${hexToRgba(template.highlightColor, 0.8)}`
      : `0 ${fontSize * 0.04}px ${fontSize * 0.08}px rgba(0,0,0,0.4)`;
  } else {
    textStyle.color = color;
    if (outlineWidth > 0) {
      textStyle.WebkitTextStroke = `${outlineWidth}px ${template.outlineColor}`;
      textStyle.paintOrder = 'stroke fill';
      textStyle.textShadow = isActive
        ? `0 0 ${fontSize * 0.22}px ${hexToRgba(template.highlightColor, 0.55)}, 0 ${outlineWidth * 0.4}px ${outlineWidth * 0.8}px rgba(0,0,0,0.45)`
        : `0 ${outlineWidth * 0.4}px ${outlineWidth * 0.8}px rgba(0,0,0,0.4)`;
    }
  }

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: `translateY(${-lift}px) scale(${pop})`,
        transformOrigin: 'center bottom',
        padding: `${padY}px ${padX}px`,
      }}>
      {useShine && isActive ? (
        <>
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: fontSize * 0.32,
              backgroundColor: 'rgba(8, 8, 10, 0.88)',
              border: `${Math.max(2, fontSize * 0.04)}px solid ${hexToRgba(template.highlightColor, 0.98)}`,
              boxShadow: `0 0 ${fontSize * 0.38}px ${hexToRgba(template.highlightColor, 0.9)}, 0 0 ${fontSize * 0.85}px ${hexToRgba(template.highlightColor, 0.45)}, inset 0 0 ${fontSize * 0.28}px ${hexToRgba(template.highlightColor, 0.38)}`,
              pointerEvents: 'none',
            }}
          />
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: fontSize * 0.32,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}>
            <span
              style={{
                position: 'absolute',
                top: '-30%',
                bottom: '-30%',
                width: '48%',
                left: `${shineTravel}%`,
                background:
                  'linear-gradient(105deg, transparent 8%, rgba(255,255,255,0.55) 36%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.4) 64%, transparent 88%)',
                mixBlendMode: 'screen',
                opacity: 0.95,
              }}
            />
          </span>
        </>
      ) : null}
      <span style={textStyle}>{text}</span>
    </span>
  );
};

function mapCaptionAnimation(
  animation: CaptionDirection['animation'],
): CaptionTemplate['animation'] | undefined {
  if (!animation) {
    return undefined;
  }
  if (animation === 'pop' || animation === 'type') {
    return 'scale';
  }
  return animation;
}

function captionBottomFor(
  position: CaptionDirection['position'] | undefined,
  requested: number | undefined,
): number {
  if (position === 'center') {
    return Math.max(0.38, Math.min(0.58, requested ?? 0.48));
  }
  if (position === 'lower_third') {
    return Math.max(0.2, Math.min(0.34, requested ?? 0.26));
  }
  if (position === 'top') {
    return Math.max(0.08, Math.min(0.22, requested ?? 0.12));
  }
  return Math.max(0.08, Math.min(0.22, requested ?? 0.14));
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) {
    return `rgba(255, 225, 74, ${alpha})`;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Exported for the sample props / studio previews. */
export function captionLineCount(words: CaptionWord[]): number {
  return groupCaptionLines(words).length;
}
