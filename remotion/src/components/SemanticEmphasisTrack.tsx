/**
 * Speech-synced semantic visual weight — oversized / highlighted claim words.
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

import type {LanguageCode, SemanticEmphasis} from '../blueprintSchema';
import {framesBetween, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

type SemanticEmphasisTrackProps = {
  emphasis: SemanticEmphasis[];
  language: LanguageCode;
};

export const SemanticEmphasisTrack: React.FC<SemanticEmphasisTrackProps> = ({
  emphasis,
  language,
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
          <EmphasisView item={item} language={language} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const EmphasisView: React.FC<{
  item: SemanticEmphasis;
  language: LanguageCode;
}> = ({item, language}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: {damping: 12, stiffness: 180, mass: 0.6},
    durationInFrames: Math.round(0.35 * fps),
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
  const opacity = enter * exit;
  const isPrimary = item.weight === 'primary';
  const fontSize = Math.round(
    width * (isPrimary ? 0.16 : 0.1) *
      (item.treatment === 'scale' || item.treatment === 'pop' ? 1 : 0.85),
  );
  const scale =
    item.treatment === 'pop'
      ? 0.75 + enter * 0.35
      : item.treatment === 'scale'
        ? 0.85 + enter * 0.2
        : 1;

  const color =
    item.treatment === 'color' ? item.accentColor : '#FFFFFF';

  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          position: 'absolute',
          left: width * 0.06,
          right: width * 0.06,
          top: height * (isPrimary ? 0.34 : 0.4),
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          transform: `scale(${scale})`,
        }}>
        {item.treatment === 'highlight_shape' ? (
          <div
            style={{
              backgroundColor: item.accentColor,
              borderRadius: 16,
              padding: '10px 20px',
            }}>
            <span
              style={{
                color: '#0F172A',
                fontSize,
                fontWeight: fontWeightFor(language, 'impact'),
                fontFamily: fontFamilyFor(language, 'impact'),
                fontStyle: 'italic',
                letterSpacing: -1.5,
                lineHeight: 1,
              }}>
              {item.text}
            </span>
          </div>
        ) : (
          <div style={{display: 'inline-flex', flexDirection: 'column', gap: 8}}>
            <span
              style={{
                color,
                fontSize,
                fontWeight: fontWeightFor(language, 'impact'),
                fontFamily: fontFamilyFor(language, 'impact'),
                fontStyle: 'italic',
                letterSpacing: -1.8,
                lineHeight: 1,
                textAlign: 'center',
                textShadow: '0 3px 22px rgba(0,0,0,0.5)',
              }}>
              {item.text}
            </span>
            {item.treatment === 'underline' ? (
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: item.accentColor,
                  transform: `scaleX(${enter})`,
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
