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

import type {
  LanguageCode,
  NorthStarDesign,
  VisualAnchor,
  VisualOverlay,
} from '../blueprintSchema';
import {MediaCardView} from './MediaCardTrack';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {framesBetween, secToFrame} from '../lib/timeline';
import {fontFamilyFor, fontWeightFor} from '../styles/fonts';

const FADE_SEC = 0.42;

type VisualOverlayTrackProps = {
  overlays: VisualOverlay[];
  language: LanguageCode;
  design?: NorthStarDesign;
};

export const VisualOverlayTrack: React.FC<VisualOverlayTrackProps> = ({
  overlays,
  language,
  design,
}) => {
  const {fps} = useVideoConfig();
  const layered = overlays.filter(
    overlay =>
      overlay.layout !== 'composite' &&
      overlay.layout !== 'split' &&
      overlay.layout !== 'cutout',
  );

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {layered.map((overlay, index) => (
        <Sequence
          key={`${overlay.layout}-${overlay.providerId}-${index}`}
          from={secToFrame(overlay.start, fps)}
          durationInFrames={framesBetween(overlay.start, overlay.end, fps)}>
          <OverlayView overlay={overlay} language={language} design={design} />
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

export function activeCutoutAt(
  overlays: VisualOverlay[],
  timeSec: number,
): VisualOverlay | undefined {
  return overlays.find(
    overlay =>
      overlay.layout === 'cutout' &&
      timeSec >= overlay.start &&
      timeSec < overlay.end,
  );
}

const OverlayView: React.FC<{
  overlay: VisualOverlay;
  language: LanguageCode;
  design?: NorthStarDesign;
}> = ({overlay, language, design}) => {
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
    config: {damping: 20, mass: 1.05, stiffness: 72},
  });

  if (overlay.layout === 'cutaway') {
    return (
      <AbsoluteFill style={{opacity}}>
        <MediaFill overlay={overlay} kenBurns />
      </AbsoluteFill>
    );
  }

  if (overlay.layout === 'lockup' || overlay.layout === 'stat') {
    return (
      <PhraseStack
        overlay={overlay}
        language={language}
        opacity={opacity}
        pop={pop}
        width={width}
        height={height}
        design={design}
      />
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
            backgroundColor: design ? `${design.surfaceColor}ED` : 'rgba(8,8,10,0.82)',
            padding: `${height * 0.018}px ${width * 0.07}px`,
            transform: `translateY(${(1 - pop) * (atBottom ? 18 : -18)}px)`,
          }}>
          <div
            style={{
              fontFamily: fontFamilyFor(language, 'impact', design),
              fontWeight: fontWeightFor(language, 'impact', design),
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

  if (overlay.layout === 'bubble') {
    return (
      <ChatBubbleStack
        overlay={overlay}
        language={language}
        opacity={opacity}
        pop={pop}
        width={width}
        height={height}
      />
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
            backgroundColor: design ? `${design.surfaceColor}ED` : 'rgba(28,28,30,0.82)',
            borderRadius: 999,
            padding: `${height * 0.01}px ${width * 0.045}px`,
          }}>
          <div
            style={{
              fontFamily: fontFamilyFor(language, 'sans', design),
              fontWeight: 700,
              fontSize: width * 0.038,
              color: design?.inkColor ?? '#FFFFFF',
              textAlign: 'center',
            }}>
            {overlay.overlayText || overlay.keyword}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (overlay.layout === 'pip' || overlay.layout === 'sticker' || overlay.layout === 'card') {
    return <MediaCardView overlay={overlay} />;
  }

  return null;
};

function PhraseStack({
  overlay,
  language,
  opacity,
  pop,
  width,
  height,
  design,
}: {
  overlay: VisualOverlay;
  language: LanguageCode;
  opacity: number;
  pop: number;
  width: number;
  height: number;
  design?: NorthStarDesign;
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
          backgroundColor: design ? `${design.surfaceColor}ED` : 'rgba(12,12,14,0.82)',
          borderRadius: design?.cornerRadius ?? 18,
          padding: `${height * 0.018}px ${width * 0.022}px`,
          borderLeft: `4px solid ${design?.primaryColor ?? '#E8C872'}`,
          boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
        }}>
        {lines.map((line, index) => (
          <div
            key={`${line}-${index}`}
            style={{
              fontFamily: fontFamilyFor(
                language,
                index === 0 ? 'impact' : 'sans',
                design,
              ),
              fontWeight: fontWeightFor(
                language,
                index === 0 ? 'impact' : 'sans',
                design,
              ),
              fontSize:
                index === 0
                  ? Math.min(width * 0.038, 42)
                  : Math.min(width * 0.028, 30),
              lineHeight: 1.08,
              color:
                index === 0
                  ? color
                  : design?.inkColor ?? 'rgba(247,241,225,0.82)',
              textTransform:
                design?.motionPreset === 'editorial' ? 'none' : 'uppercase',
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

function ChatBubbleStack({
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
  const lines = bubbleLines(overlay.overlayText || overlay.keyword);
  const leftSide = overlay.anchor.includes('left') || overlay.anchor === 'top';
  const palettes = [
    {bg: '#F8FAFC', fg: '#0F172A'},
    {bg: 'linear-gradient(135deg, #FCE7F3 0%, #E0F2FE 100%)', fg: '#1E293B'},
    {bg: '#FFFFFF', fg: '#111827'},
  ];
  return (
    <AbsoluteFill style={{opacity, pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          top: overlay.anchor.includes('bottom') ? undefined : height * 0.08,
          bottom: overlay.anchor.includes('bottom') ? height * 0.28 : undefined,
          left: leftSide ? width * 0.05 : undefined,
          right: leftSide ? undefined : width * 0.05,
          width: width * 0.58,
          display: 'flex',
          flexDirection: 'column',
          gap: height * 0.012,
          transform: `translateY(${(1 - pop) * 16}px) scale(${0.94 + pop * 0.06})`,
        }}>
        {lines.map((line, index) => {
          const palette = palettes[index % palettes.length]!;
          const confirmed = /confirm|order|sent|qty|total/i.test(line);
          return (
            <div
              key={`${line}-${index}`}
              style={{
                alignSelf: index % 2 === 0 ? 'flex-start' : 'flex-end',
                maxWidth: '100%',
                background: confirmed ? '#FFFFFF' : palette.bg,
                color: palette.fg,
                borderRadius: confirmed ? 18 : 22,
                padding: `${height * 0.012}px ${width * 0.04}px`,
                boxShadow: '0 10px 28px rgba(15,23,42,0.16)',
                border: confirmed ? '1px solid rgba(15,23,42,0.08)' : 'none',
                fontFamily: fontFamilyFor(language, 'sans'),
                fontWeight: 650,
                fontSize: Math.min(width * 0.034, 34),
                lineHeight: 1.25,
              }}>
              {confirmed ? (
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4}}>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      backgroundColor: '#22C55E',
                      color: '#FFFFFF',
                      fontSize: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    ✓
                  </span>
                  <span style={{fontSize: Math.min(width * 0.026, 26), color: '#64748B'}}>
                    Order
                  </span>
                </div>
              ) : null}
              {line}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function bubbleLines(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return [];
  }
  const parts = cleaned
    .split(/\s*\|\s*|\s*[•·]\s*|\n+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 3);
  }
  return stackLines(cleaned).slice(0, 3);
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
