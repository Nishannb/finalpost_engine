/**
 * Opening hook title — distinct visual treatments (director-chosen hookStyle).
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {HookStyle, LanguageCode} from '../blueprintSchema';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

type HookTitleProps = {
  title: string;
  subtitle?: string;
  durationSec: number;
  language: LanguageCode;
  styleId?: HookStyle;
};

export const HookTitle: React.FC<HookTitleProps> = ({
  title,
  subtitle,
  durationSec,
  language,
  styleId = 'impact',
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const holdFrames = Math.min(
    durationInFrames,
    Math.max(1, Math.round(Math.max(1.2, durationSec) * fps)),
  );
  if (!title.trim() || frame >= holdFrames) {
    return null;
  }

  const enter = spring({
    frame,
    fps,
    config: {damping: 14, mass: 0.7, stiffness: 140},
  });
  const fadeOut = interpolate(
    frame,
    [Math.max(0, holdFrames - Math.round(0.35 * fps)), holdFrames],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const scale = 0.86 + enter * 0.14;
  const lines = splitHookLines(title);
  const accent = accentFor(styleId);
  const titleSize = Math.round(
    width *
      (styleId === 'minimal'
        ? 0.068
        : styleId === 'poster'
          ? 0.1
          : styleId === 'duo'
            ? 0.078
            : 0.09),
  );

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {needsScrim(styleId) ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              styleId === 'boxed' || styleId === 'poster'
                ? 'linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.32) 48%, rgba(0,0,0,0) 70%)'
                : 'linear-gradient(180deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.16) 40%, rgba(0,0,0,0) 62%)',
            opacity: fadeOut,
          }}
        />
      ) : null}

      <div
        style={{
          position: 'absolute',
          top: height * (styleId === 'bar' || styleId === 'underline' ? 0.09 : 0.12),
          left: width * (styleId === 'rail' || styleId === 'stack' ? 0.1 : 0.08),
          right: width * 0.08,
          opacity: fadeOut,
          transform: `scale(${scale})`,
          transformOrigin: styleId === 'rail' || styleId === 'stack' ? '0% 0%' : '50% 0%',
          display: 'flex',
          flexDirection: styleId === 'rail' || styleId === 'stack' ? 'row' : 'column',
          alignItems:
            styleId === 'rail' || styleId === 'stack'
              ? 'stretch'
              : styleId === 'minimal' || styleId === 'outline'
                ? 'flex-start'
                : 'center',
          gap: height * 0.016,
        }}>
        {styleId === 'rail' || styleId === 'stack' ? (
          <div
            style={{
              width: Math.max(5, width * 0.01),
              borderRadius: 4,
              backgroundColor: accent,
              marginRight: width * 0.035,
              alignSelf: 'stretch',
              minHeight: titleSize * (lines.length > 1 ? 2.1 : 1.15),
            }}
          />
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems:
              styleId === 'rail' || styleId === 'stack' || styleId === 'minimal'
                ? 'flex-start'
                : 'center',
            gap: height * 0.01,
            maxWidth: width * 0.82,
          }}>
          {styleId === 'bar' ? (
            <div
              style={{
                width: width * 0.26,
                height: 5,
                borderRadius: 8,
                backgroundColor: accent,
                marginBottom: height * 0.008,
              }}
            />
          ) : null}

          <div
            style={{
              fontFamily: fontFamilyFor(
                language,
                styleId === 'minimal' ? 'sans' : 'impact',
              ),
              fontWeight: fontWeightFor(
                language,
                styleId === 'minimal' ? 'sans' : 'impact',
              ),
              fontSize: titleSize,
              lineHeight: styleId === 'duo' || styleId === 'rail' ? 1.02 : 0.95,
              textAlign:
                styleId === 'rail' || styleId === 'stack' || styleId === 'minimal'
                  ? 'left'
                  : 'center',
              color: styleId === 'outline' ? accent : '#FFFFFF',
              textTransform: styleId === 'minimal' ? 'none' : 'uppercase',
              letterSpacing: styleId === 'minimal' ? 0.3 : -1.1,
              padding:
                styleId === 'boxed'
                  ? `${height * 0.02}px ${width * 0.05}px`
                  : styleId === 'poster'
                    ? `${height * 0.022}px ${width * 0.055}px`
                    : undefined,
              backgroundColor:
                styleId === 'boxed'
                  ? 'rgba(10,10,12,0.86)'
                  : styleId === 'poster'
                    ? 'rgba(8,8,10,0.72)'
                    : 'transparent',
              borderRadius: styleId === 'boxed' || styleId === 'poster' ? 20 : 0,
              border:
                styleId === 'poster'
                  ? `2px solid ${accent}`
                  : styleId === 'outline'
                    ? `3px solid ${accent}`
                    : undefined,
              textShadow:
                styleId === 'boxed'
                  ? 'none'
                  : '0 3px 0 #111, 0 14px 28px rgba(0,0,0,0.55), 0 0 18px rgba(0,0,0,0.4)',
            }}>
            {styleId === 'duo' || styleId === 'rail' || styleId === 'stack' ? (
              <>
                <div>{lines[0]}</div>
                {lines[1] ? (
                  <div
                    style={{
                      opacity: 0.94,
                      fontSize: styleId === 'duo' ? '0.78em' : '0.86em',
                      color: styleId === 'duo' ? accent : '#FFFFFF',
                      marginTop: height * 0.006,
                    }}>
                    {lines[1]}
                  </div>
                ) : null}
              </>
            ) : (
              title
            )}
          </div>

          {styleId === 'underline' ? (
            <div
              style={{
                width: Math.min(width * 0.55, title.length * titleSize * 0.42),
                height: 6,
                borderRadius: 99,
                backgroundColor: accent,
                marginTop: height * 0.004,
              }}
            />
          ) : null}

          {subtitle?.trim() ? (
            <div
              style={{
                fontFamily: fontFamilyFor(language, 'sans'),
                fontWeight: fontWeightFor(language, 'sans'),
                fontSize: Math.round(width * 0.036),
                textAlign:
                  styleId === 'rail' || styleId === 'stack' ? 'left' : 'center',
                color: accent,
                textTransform: 'uppercase',
                letterSpacing: 1.4,
                textShadow: '0 2px 10px rgba(0,0,0,0.65)',
              }}>
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

function needsScrim(styleId: HookStyle): boolean {
  return styleId !== 'minimal' && styleId !== 'outline' && styleId !== 'underline';
}

function accentFor(styleId: HookStyle): string {
  if (styleId === 'bar' || styleId === 'minimal') {
    return '#F7F1E1';
  }
  if (styleId === 'outline' || styleId === 'duo') {
    return '#FFE14A';
  }
  if (styleId === 'poster') {
    return '#E8C872';
  }
  return '#FFE14A';
}

function splitHookLines(title: string): [string, string?] {
  const words = title.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= 2) {
    return [title];
  }
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}
