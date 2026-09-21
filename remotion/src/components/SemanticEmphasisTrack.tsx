/**
 * Speech-synced semantic visual weight — counters, type reveals, punches.
 * Occupancy locks these to a corner; they never sit on the speaker.
 */

import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {
  LanguageCode,
  NorthStarDesign,
  SemanticEmphasis,
  VisualAnchor,
} from '../blueprintSchema';
import {framesBetween, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

type SemanticEmphasisTrackProps = {
  emphasis: SemanticEmphasis[];
  language: LanguageCode;
  design?: NorthStarDesign;
};

export const SemanticEmphasisTrack: React.FC<SemanticEmphasisTrackProps> = ({
  emphasis,
  language,
  design,
}) => {
  const {fps} = useVideoConfig();
  if (!emphasis.length) {
    return null;
  }

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {emphasis.map((item, index) => (
        <Sequence
          key={`em-${item.start}-${index}`}
          from={secToFrame(item.start, fps)}
          durationInFrames={framesBetween(item.start, item.end, fps)}>
          <EmphasisView item={item} language={language} design={design} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const EmphasisView: React.FC<{
  item: SemanticEmphasis;
  language: LanguageCode;
  design?: NorthStarDesign;
}> = ({item, language, design}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: {damping: 16, stiffness: 120, mass: 0.7},
    durationInFrames: Math.round(0.82 * fps),
  });
  const exitFrames = Math.round(0.28 * fps);
  const exitStart = Math.max(8, durationInFrames - exitFrames);
  const exit =
    frame >= exitStart
      ? 1 -
        interpolate(frame - exitStart, [0, exitFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const isPrimary = item.weight === 'primary';
  const isCount = item.treatment === 'count' && item.countTo != null;
  const fadeIn = isCount
    ? interpolate(frame, [0, Math.round(0.12 * fps)], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : enter;
  const opacity = fadeIn * exit;
  const fontSize = Math.round(
    width * (isCount ? 0.11 : isPrimary ? 0.055 : 0.042),
  );
  const settle = spring({
    frame,
    fps,
    config: {damping: 16, stiffness: 115, mass: 0.7},
    durationInFrames: Math.round(0.7 * fps),
  });
  const counted = isCount ? fastCount(item, frame, fps) : null;
  const scale = counted
    ? counted.scale
    : item.treatment === 'pop'
      ? 0.75 + enter * 0.35
      : item.treatment === 'scale'
        ? 0.88 + settle * 0.16
        : 1;
  const label = counted
    ? counted.label
    : item.treatment === 'type_reveal'
      ? typeReveal(item.text, enter)
      : item.text;
  const color = item.textColor || (item.treatment === 'color' ? item.accentColor : '#FFFFFF');
  const pos = slotStyle(item.anchor || 'top_right', width, height);

  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          position: 'absolute',
          ...pos,
          transform: `scale(${scale})`,
          maxWidth: width * 0.46,
        }}>
        {item.treatment === 'type_reveal' ? (
          <TypeHighlight
            text={item.text}
            revealed={label}
            accent={item.accentColor}
            progress={enter}
            language={language}
            fontSize={fontSize}
          />
        ) : (
          <div style={{display: 'inline-flex', flexDirection: 'column', gap: 8}}>
            <span
              style={{
                color,
                fontSize,
                fontWeight: fontWeightFor(language, 'impact', design),
                fontFamily: fontFamilyFor(language, 'impact', design),
                fontStyle: 'italic',
                letterSpacing: -1.2,
                lineHeight: 1,
                textAlign: 'left',
                textShadow: '0 2px 0 rgba(0,0,0,0.85), 0 6px 22px rgba(0,0,0,0.45)',
              }}>
              {label}
            </span>
            {item.treatment === 'underline' ? (
              <div
                style={{
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: item.accentColor,
                  transform: `scaleX(${enter})`,
                  transformOrigin: 'left center',
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

const TypeHighlight: React.FC<{
  text: string;
  revealed: string;
  accent: string;
  progress: number;
  language: LanguageCode;
  fontSize: number;
}> = ({text, revealed, accent, progress, language, fontSize}) => {
  return (
    <div style={{position: 'relative', display: 'inline-block'}}>
      <div
        style={{
          position: 'absolute',
          left: -8,
          top: '8%',
          bottom: '4%',
          width: `${progress * 100}%`,
          backgroundColor: accent,
          borderRadius: 8,
          zIndex: 0,
        }}
      />
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          color: '#0F172A',
          fontSize,
          fontWeight: fontWeightFor(language, 'impact'),
          fontFamily: fontFamilyFor(language, 'impact'),
          fontStyle: 'italic',
          letterSpacing: -1.1,
          lineHeight: 1.05,
        }}>
        {revealed}
        <span style={{opacity: 0}}>{text.slice(revealed.length)}</span>
      </span>
    </div>
  );
};

/** Race from ~70% of the target, then a small scale punch on the land. */
function fastCount(
  item: SemanticEmphasis,
  frame: number,
  fps: number,
): {label: string; scale: number} {
  const from = item.countFrom ?? 0;
  const to = item.countTo ?? 0;
  const countFrames = Math.max(5, Math.round(0.48 * fps));
  const t = interpolate(frame, [0, countFrames], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const value = from + (to - from) * t;
  const punch = spring({
    frame: Math.max(0, frame - countFrames),
    fps,
    config: {damping: 11, stiffness: 210, mass: 0.5},
    durationInFrames: Math.round(0.28 * fps),
  });
  return {
    label: formatCount(item, value),
    scale: frame >= countFrames ? 1 + punch * 0.14 : 0.94 + t * 0.04,
  };
}

function formatCount(item: SemanticEmphasis, value: number): string {
  const integerTarget = item.countTo != null && Number.isInteger(item.countTo);
  const rounded =
    integerTarget || (item.countTo != null && item.countTo >= 20)
      ? Math.round(value)
      : Math.round(value * 10) / 10;
  const suffix = item.countSuffix || '';
  const currency = suffix.match(/^([$€£])(.*)$/);
  if (currency) {
    return `${currency[1]}${rounded}${currency[2]}`;
  }
  return `${rounded}${suffix}`;
}

function typeReveal(text: string, progress: number): string {
  const count = Math.max(0, Math.round(text.length * progress));
  return text.slice(0, count);
}

function slotStyle(
  anchor: VisualAnchor,
  width: number,
  height: number,
): React.CSSProperties {
  const pad = width * 0.05;
  const top = height * 0.09;
  const bottom = height * 0.26;
  if (anchor === 'top_left') {
    return {top, left: pad};
  }
  if (anchor === 'top_right' || anchor === 'top') {
    return {top, right: pad};
  }
  if (anchor === 'bottom_left') {
    return {bottom, left: pad};
  }
  return {bottom, right: pad};
}
