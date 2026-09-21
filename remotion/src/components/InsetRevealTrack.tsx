/**
 * Inset Scale Reveal compositor.
 *
 * Layer order (bottom → top):
 * 1. Background (solid / gradient / looping graphic)
 * 2. Main video (transform-animated only — never re-encoded; audio continues)
 * 3. Optional motion-graphic in the revealed below-video zone
 *
 * Captions live on a sibling track in ShortVideo so they do not scale with
 * the video. Preview and export share this component.
 */

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, Video} from 'remotion';

import type {InsetRevealClip, NorthStarDesign} from '../blueprintSchema';
import {renderInsetGraphic} from '../insetReveal/templates';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {
  DEFAULT_INSET_REVEAL_PARAMS,
  getInsetState,
  graphicLocalProgress,
  videoBottomFrac,
} from '../lib/insetRevealMotion';

export function activeInsetRevealAt(
  clips: InsetRevealClip[] | undefined,
  timeSec: number,
): InsetRevealClip | undefined {
  if (!clips?.length) {
    return undefined;
  }
  return clips.find(clip => timeSec >= clip.start && timeSec < clip.end);
}

type InsetRevealTrackProps = {
  clips: InsetRevealClip[] | undefined;
  talkingHead: React.ReactNode;
  design?: NorthStarDesign;
};

export const InsetRevealTrack: React.FC<InsetRevealTrackProps> = ({
  clips,
  talkingHead,
  design,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timeSec = frame / fps;
  const clip = activeInsetRevealAt(clips, timeSec);
  if (!clip) {
    return <>{talkingHead}</>;
  }
  return (
    <InsetRevealComposite clip={clip} talkingHead={talkingHead} design={design} />
  );
};

const InsetRevealComposite: React.FC<{
  clip: InsetRevealClip;
  talkingHead: React.ReactNode;
  design?: NorthStarDesign;
}> = ({clip, talkingHead, design}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const params = clip.params ?? DEFAULT_INSET_REVEAL_PARAMS;
  const local = timeSec - clip.start;
  const state = getInsetState(local, clip.end - clip.start, params);
  const radius = state.cornerRadius * (width / 1080);
  const translateY = state.y * height;
  const accent = design?.primaryColor || '#FACC15';
  const ink = design?.inkColor || '#F8FAFC';
  const graphicProgress =
    params.variant === 'motion_graphic'
      ? graphicLocalProgress(local, clip.end - clip.start, params)
      : 0;
  const zoneTop = videoBottomFrac(params) * height;
  const zoneHeight = height - zoneTop;

  return (
    <AbsoluteFill>
      <div
        style={{
          height: '100%',
          left: 0,
          opacity: state.bgOpacity,
          position: 'absolute',
          top: 0,
          width: '100%',
        }}>
        <InsetBackground
          type={params.background.type}
          value={params.background.value}
          width={width}
          height={height}
        />
      </div>

      <div
        style={{
          borderRadius: radius,
          boxShadow:
            state.shadowOpacity > 0.01
              ? `0 ${Math.round(28 * state.shadowOpacity)}px ${Math.round(
                  70 * state.shadowOpacity,
                )}px rgba(0,0,0,${0.55 * state.shadowOpacity})`
              : 'none',
          height: '100%',
          overflow: 'hidden',
          position: 'absolute',
          transform: `translateY(${translateY}px) scale(${state.scale})`,
          transformOrigin: '50% 0%',
          width: '100%',
          willChange: 'transform',
        }}>
        {talkingHead}
      </div>

      {params.variant === 'motion_graphic' && graphicProgress > 0.01 ? (
        <div
          style={{
            height: zoneHeight,
            left: 0,
            paddingTop: Math.round(height * 0.02),
            pointerEvents: 'none',
            position: 'absolute',
            top: zoneTop,
            width: '100%',
          }}>
          {renderInsetGraphic(params.graphic?.templateId || 'keyword_title', {
            text: params.graphic?.text || '',
            data: params.graphic?.data,
            localTime: local,
            progress: graphicProgress,
            width,
            height: zoneHeight,
            accent,
            ink,
          })}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const InsetBackground: React.FC<{
  type: string;
  value: string;
  width: number;
  height: number;
}> = ({type, value, width, height}) => {
  if (type === 'loop' && /^(https?:|file:|\/)/i.test(value)) {
    return (
      <Video
        src={resolveMediaSrc(value)}
        muted
        loop
        style={{height: '100%', objectFit: 'cover', width: '100%'}}
      />
    );
  }
  if (type === 'gradient') {
    const [from, to] = value.split(',').map(part => part.trim());
    return (
      <div
        style={{
          background: `linear-gradient(180deg, ${from || '#111827'} 0%, ${to || '#020617'} 100%)`,
          height: '100%',
          width: '100%',
        }}
      />
    );
  }
  if (type === 'template' || type === 'loop') {
    const grid = value === 'grid_pulse';
    return (
      <div
        style={{
          backgroundColor: '#0B1220',
          backgroundImage: grid
            ? 'linear-gradient(rgba(250,204,21,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(250,204,21,0.12) 1px, transparent 1px)'
            : 'radial-gradient(circle at 20% 20%, rgba(56,189,248,0.28), transparent 42%), radial-gradient(circle at 80% 70%, rgba(244,114,182,0.22), transparent 38%)',
          backgroundSize: grid ? `${Math.max(28, width * 0.06)}px ${Math.max(28, width * 0.06)}px` : '100% 100%',
          height: '100%',
          width: '100%',
        }}
      />
    );
  }
  return (
    <div
      style={{
        backgroundColor: value || '#111827',
        height,
        width,
      }}
    />
  );
};
