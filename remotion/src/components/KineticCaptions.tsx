/**
 * Kinetic caption layer.
 *
 * Word timings come straight from the blueprint, so the active-word emphasis is
 * frame-accurate rather than interpolated. Each template maps to one of five
 * animations; adding a preset means adding a row to `captionTemplates.ts`, not a
 * new component.
 *
 * Placement follows the AI director: template, box vs outline, and
 * top / center / lower_third / bottom.
 */

import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

import type {
  CaptionDirection,
  CaptionWord,
  LanguageCode,
  RenderStyle,
} from '../blueprintSchema';
import {activeLineAt, groupCaptionLines, type CaptionLine} from '../lib/timeline';
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
};

export const KineticCaptions: React.FC<KineticCaptionsProps> = ({
  words,
  style,
  language,
  direction,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const template = captionTemplateFor(
    direction?.template || style.captionTemplate || 'hormozi',
  );
  const primaryColor = direction?.textColor ?? template.primaryColor;
  const highlightColor = direction?.highlightColor ?? template.highlightColor;
  // Director null = outline-only. Fall back to template pill only when no direction.
  const backgroundColor =
    direction != null ? direction.boxColor : template.backgroundColor;
  const position = direction?.position ?? 'bottom';
  const bottomFrac = direction?.bottomFrac ?? style.captionBottomFrac;

  const lines = React.useMemo(() => groupCaptionLines(words), [words]);
  const timeSec = frame / fps;
  const line = activeLineAt(lines, timeSec);
  if (!line) {
    return null;
  }

  const fontSize = scaleFromPreview(template.fontSizePt, width);
  const outlineWidth = scaleFromPreview(template.outlineWidthPt, width);
  const placement = placementStyle({
    position,
    bottomFrac,
    height,
    centerXFrac: style.captionCenterXFrac,
  });

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          ...placement,
          width: width * template.maxWidthFrac,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'flex-end',
          gap: fontSize * 0.22,
          ...(backgroundColor
            ? {
                backgroundColor,
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
            line={line}
            template={{
              ...template,
              primaryColor,
              highlightColor,
              backgroundColor,
            }}
            language={language}
            timeSec={timeSec}
            fps={fps}
            fontSize={fontSize}
            outlineWidth={outlineWidth}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

function placementStyle(input: {
  position: CaptionDirection['position'] | 'bottom';
  bottomFrac: number;
  height: number;
  centerXFrac: number;
}): React.CSSProperties {
  const left = `${input.centerXFrac * 100}%`;
  if (input.position === 'top') {
    return {
      top: input.height * 0.1,
      left,
      transform: 'translateX(-50%)',
    };
  }
  if (input.position === 'center') {
    return {
      top: '50%',
      left,
      transform: 'translate(-50%, -50%)',
    };
  }
  // bottom + lower_third use bottomFrac from the director
  return {
    bottom: input.height * input.bottomFrac,
    left,
    transform: 'translateX(-50%)',
  };
}

type CaptionWordViewProps = {
  word: CaptionWord;
  line: CaptionLine;
  template: CaptionTemplate;
  language: LanguageCode;
  timeSec: number;
  fps: number;
  fontSize: number;
  outlineWidth: number;
};

const CaptionWordView: React.FC<CaptionWordViewProps> = ({
  word,
  line,
  template,
  language,
  timeSec,
  fps,
  fontSize,
  outlineWidth,
}) => {
  const isActive = timeSec >= word.start && timeSec <= word.end;
  // Spring is driven off the word's own onset so every word animates identically
  // regardless of where it sits in the line.
  const sinceOnset = Math.max(0, timeSec - word.start) * fps;
  const entrance = spring({
    frame: sinceOnset,
    fps,
    config: {damping: 14, mass: 0.5, stiffness: 180},
    durationInFrames: Math.round(fps * 0.4),
  });

  const text = template.uppercase ? word.text.toUpperCase() : word.text;
  const base: React.CSSProperties = {
    fontFamily: fontFamilyFor(language, template.weight),
    fontWeight: fontWeightFor(language, template.weight),
    fontSize,
    lineHeight: 1.05,
    color: template.primaryColor,
    letterSpacing: fontSize * 0.005,
    whiteSpace: 'pre',
    display: 'inline-block',
    ...(outlineWidth > 0
      ? {
          WebkitTextStroke: `${outlineWidth}px ${template.outlineColor}`,
          paintOrder: 'stroke fill',
          textShadow: `0 ${outlineWidth * 0.5}px ${outlineWidth}px rgba(0,0,0,0.45)`,
        }
      : {}),
  };

  switch (template.animation) {
    case 'karaoke': {
      // Fill sweeps across the active word; already-spoken words stay filled.
      const progress = isActive
        ? interpolate(timeSec, [word.start, word.end], [0, 100], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        : timeSec > word.end
          ? 100
          : 0;
      return (
        <span
          style={{
            ...base,
            backgroundImage: `linear-gradient(90deg, ${template.highlightColor} ${progress}%, ${template.primaryColor} ${progress}%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
          {text}
        </span>
      );
    }
    case 'bounce': {
      const lift = isActive ? entrance * fontSize * 0.18 : 0;
      return (
        <span
          style={{
            ...base,
            color: isActive ? template.highlightColor : template.primaryColor,
            transform: `translateY(${-lift}px)`,
          }}>
          {text}
        </span>
      );
    }
    case 'scale': {
      const scale = isActive ? 1 + entrance * 0.12 : 1;
      return (
        <span
          style={{
            ...base,
            color: isActive ? template.highlightColor : template.primaryColor,
            opacity: isActive ? 1 : 0.82,
            transform: `scale(${scale})`,
          }}>
          {text}
        </span>
      );
    }
    case 'box': {
      return (
        <span
          style={{
            ...base,
            color: isActive ? template.highlightColor : template.primaryColor,
            opacity: isActive ? 1 : 0.68,
          }}>
          {text}
        </span>
      );
    }
    case 'highlight':
    default: {
      const pop = isActive ? 1 + entrance * 0.08 : 1;
      const isPast = timeSec > word.end;
      return (
        <span
          style={{
            ...base,
            color: isActive ? template.highlightColor : template.primaryColor,
            opacity: isPast || isActive ? 1 : 0.9,
            transform: `scale(${pop})`,
          }}>
          {text}
        </span>
      );
    }
  }
};

/** Exported for the sample props / studio previews. */
export function captionLineCount(words: CaptionWord[]): number {
  return groupCaptionLines(words).length;
}
