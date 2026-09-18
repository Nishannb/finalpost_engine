/**
 * Designed graphics that sit around the speaker, never on their face:
 * corner stickers/PiP, top lockups, edge banners, chips, Ken Burns stills.
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import type {LanguageCode, VisualAnchor, VisualOverlay} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {framesBetween, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

const FADE_SEC = 0.22;
const FACE_SAFE_TOP = 0.055;

type VisualOverlayTrackProps = {
  overlays: VisualOverlay[];
  language: LanguageCode;
};

export const VisualOverlayTrack: React.FC<VisualOverlayTrackProps> = ({
  overlays,
  language,
}) => {
  const {fps} = useVideoConfig();
  const layered = overlays.filter(
    overlay => overlay.layout !== 'composite' && overlay.layout !== 'split',
  );

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {layered.map((overlay, index) => (
        <Sequence
          key={`${overlay.layout}-${overlay.providerId}-${index}`}
          from={secToFrame(overlay.start, fps)}
          durationInFrames={framesBetween(overlay.start, overlay.end, fps)}>
          <OverlayView overlay={overlay} language={language} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const CompositePlate: React.FC<{overlay: VisualOverlay}> = ({overlay}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const fadeFrames = Math.max(1, Math.round(FADE_SEC * fps));
  const opacity = interpolate(
    frame,
    [0, fadeFrames, Math.max(fadeFrames, durationInFrames - fadeFrames), durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill style={{opacity}}>
      <MediaFill overlay={overlay} blur />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '50%',
          overflow: 'hidden',
        }}>
        <MediaFill overlay={overlay} kenBurns />
      </div>
    </AbsoluteFill>
  );
};

export function activeOverlayLayoutAt(
  overlays: VisualOverlay[],
  layout: VisualOverlay['layout'],
  timeSec: number,
): VisualOverlay | undefined {
  return overlays.find(
    overlay =>
      overlay.layout === layout &&
      Boolean(overlay.assetUrl) &&
      timeSec >= overlay.start &&
      timeSec < overlay.end,
  );
}

export function activeCompositeAt(
  overlays: VisualOverlay[],
  timeSec: number,
): VisualOverlay | undefined {
  return activeOverlayLayoutAt(overlays, 'composite', timeSec);
}

const OverlayView: React.FC<{
  overlay: VisualOverlay;
  language: LanguageCode;
}> = ({overlay, language}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width, height} = useVideoConfig();
  const fadeFrames = Math.max(1, Math.round(FADE_SEC * fps));
  const opacity = interpolate(
    frame,
    [0, fadeFrames, Math.max(fadeFrames, durationInFrames - fadeFrames), durationInFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const pop = spring({
    frame,
    fps,
    config: {damping: 13, mass: 0.65, stiffness: 160},
  });

  if (overlay.layout === 'cutaway') {
    return (
      <AbsoluteFill style={{opacity}}>
        <MediaFill overlay={overlay} kenBurns />
      </AbsoluteFill>
    );
  }

  if (overlay.layout === 'lockup' || overlay.layout === 'stat') {
    if (overlay.textStyle === 'stack') {
      return (
        <PhraseStack
          overlay={overlay}
          language={language}
          opacity={opacity}
          pop={pop}
          width={width}
          height={height}
        />
      );
    }
    const atBottom = overlay.anchor === 'bottom';
    const color = overlay.accentColor || '#FFFFFF';
    const bar = overlay.textStyle !== 'outline';
    return (
      <AbsoluteFill style={{opacity, pointerEvents: 'none'}}>
        <div
          style={{
            position: 'absolute',
            left: width * 0.06,
            right: width * 0.06,
            top: atBottom ? undefined : height * 0.07,
            bottom: atBottom ? height * 0.28 : undefined,
            transform: `scale(${0.94 + pop * 0.06})`,
            backgroundColor: bar ? 'rgba(8,8,10,0.72)' : 'transparent',
            borderRadius: bar ? 18 : 0,
            padding: bar ? `${height * 0.016}px ${width * 0.035}px` : 0,
          }}>
          <div
            style={{
              fontFamily: fontFamilyFor(language, 'impact'),
              fontWeight: fontWeightFor(language, 'impact'),
              fontSize: Math.min(width * 0.062, 68),
              lineHeight: 1.05,
              color,
              textTransform: 'uppercase',
              letterSpacing: -0.6,
              textAlign: 'center',
              textShadow: bar
                ? 'none'
                : '0 2px 0 #111, 0 10px 22px rgba(0,0,0,0.55)',
            }}>
            {overlay.overlayText || overlay.keyword}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (overlay.layout === 'banner') {
    const atBottom = overlay.anchor === 'bottom' || overlay.anchor === 'bottom_left';
    const color = overlay.accentColor || '#FFFFFF';
    return (
      <AbsoluteFill style={{opacity}}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: atBottom ? undefined : 0,
            bottom: atBottom ? 0 : undefined,
            backgroundColor: 'rgba(8,8,10,0.82)',
            padding: `${height * 0.018}px ${width * 0.07}px`,
            transform: `translateY(${(1 - pop) * (atBottom ? 18 : -18)}px)`,
          }}>
          <div
            style={{
              fontFamily: fontFamilyFor(language, 'impact'),
              fontWeight: fontWeightFor(language, 'impact'),
              fontSize: width * 0.048,
              color,
              textTransform: 'uppercase',
              textAlign: 'center',
            }}>
            {overlay.overlayText || overlay.keyword}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (overlay.layout === 'chip') {
    return (
      <AbsoluteFill style={{opacity}}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: height * 0.3,
            transform: `translateX(-50%) scale(${0.9 + pop * 0.1})`,
            backgroundColor: 'rgba(28,28,30,0.82)',
            borderRadius: 999,
            padding: `${height * 0.01}px ${width * 0.045}px`,
          }}>
          <div
            style={{
              fontFamily: fontFamilyFor(language, 'sans'),
              fontWeight: 700,
              fontSize: width * 0.038,
              color: '#FFFFFF',
              textAlign: 'center',
            }}>
            {overlay.overlayText || overlay.keyword}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  const sticker = overlay.layout === 'sticker';
  const box = boxForAnchor(overlay.anchor, width, height, sticker);
  return (
    <AbsoluteFill style={{opacity}}>
      <div
        style={{
          position: 'absolute',
          ...box,
          transform: `rotate(${sticker ? -8 : 2}deg) scale(${0.9 + pop * 0.1})`,
          borderRadius: sticker ? 22 : 26,
          overflow: 'hidden',
          backgroundColor: sticker ? 'transparent' : '#111',
          border: sticker ? 'none' : '4px solid #FFFFFF',
          boxShadow: sticker ? '0 12px 28px rgba(0,0,0,0.28)' : '0 18px 40px rgba(0,0,0,0.4)',
        }}>
        {overlay.assetUrl ? <MediaFill overlay={overlay} /> : null}
      </div>
    </AbsoluteFill>
  );
};

function boxForAnchor(
  anchor: VisualAnchor,
  width: number,
  height: number,
  sticker: boolean,
): React.CSSProperties {
  const w = width * (sticker ? 0.22 : 0.3);
  const h = height * (sticker ? 0.14 : 0.18);
  const inset = width * 0.035;
  const top = height * FACE_SAFE_TOP;
  const bottom = height * 0.3;
  if (anchor === 'top_left' || anchor === 'top') {
    return {top, left: inset, width: w, height: h};
  }
  if (anchor === 'bottom_left') {
    return {bottom, left: inset, width: w, height: h};
  }
  if (anchor === 'bottom' || anchor === 'bottom_right') {
    return {bottom, right: inset, width: w, height: h};
  }
  return {top, right: inset, width: w, height: h};
}

function PhraseStack({
  overlay,
  language,
  opacity,
  pop,
  width,
  height,
}: {
  overlay: VisualOverlay;
  language: LanguageCode;
  opacity: number;
  pop: number;
  width: number;
  height: number;
}) {
  const leftSide = overlay.anchor.includes('left') || overlay.anchor === 'top';
  const lines = stackLines(overlay.overlayText || overlay.keyword);
  const color = overlay.accentColor || '#F7F1E1';
  const cardWidth = width * 0.24;
  return (
    <AbsoluteFill style={{opacity, pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          top: height * 0.1,
          left: leftSide ? width * 0.03 : undefined,
          right: leftSide ? undefined : width * 0.03,
          width: cardWidth,
          transform: `scale(${0.94 + pop * 0.06})`,
          backgroundColor: 'rgba(12,12,14,0.82)',
          borderRadius: 18,
          padding: `${height * 0.018}px ${width * 0.022}px`,
          borderLeft: '4px solid #E8C872',
          boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
        }}>
        {lines.map((line, index) => (
          <div
            key={`${line}-${index}`}
            style={{
              fontFamily: fontFamilyFor(language, index === 0 ? 'impact' : 'sans'),
              fontWeight: fontWeightFor(language, index === 0 ? 'impact' : 'sans'),
              fontSize:
                index === 0
                  ? Math.min(width * 0.038, 42)
                  : Math.min(width * 0.028, 30),
              lineHeight: 1.08,
              color: index === 0 ? color : 'rgba(247,241,225,0.82)',
              textTransform: 'uppercase',
              letterSpacing: index === 0 ? -0.3 : 1.2,
              textAlign: 'left',
              marginTop: index === 0 ? 0 : height * 0.006,
            }}>
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function stackLines(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const fromTo = cleaned.match(/^from\s+(.+?)\s+to\s+(.+)$/i);
  if (fromTo) {
    return [`From ${fromTo[1]}`, `to ${fromTo[2]}`];
  }
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length <= 2) {
    return [words.join(' ')];
  }
  if (words.length <= 4) {
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  const third = Math.ceil(words.length / 3);
  return [
    words.slice(0, third).join(' '),
    words.slice(third, third * 2).join(' '),
    words.slice(third * 2).join(' '),
  ];
}

const MediaFill: React.FC<{
  overlay: VisualOverlay;
  blur?: boolean;
  kenBurns?: boolean;
}> = ({overlay, blur, kenBurns}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const zoom = kenBurns
    ? interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.08], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: `scale(${zoom * (blur ? 1.12 : 1)})`,
    filter: blur ? 'blur(22px) saturate(1.15) brightness(0.55)' : undefined,
  };
  if (!overlay.assetUrl) {
    return <AbsoluteFill style={{backgroundColor: '#111'}} />;
  }
  if (overlay.mediaKind === 'video') {
    return (
      <OffthreadVideo src={resolveMediaSrc(overlay.assetUrl)} muted style={style} />
    );
  }
  return <Img src={resolveMediaSrc(overlay.assetUrl)} style={style} />;
};
