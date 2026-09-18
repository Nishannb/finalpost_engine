/**
 * The composition every burn goes through.
 *
 * Layer order: composite/split plate → talking-head (optional media container) →
 * video B-roll → designed overlays → motion graphics → semantic emphasis →
 * transition wipes → hook → captions.
 */

import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';

import type {ShortVideoProps, VisualOverlay} from './blueprintSchema';
import {BRollTrack} from './components/BRollTrack';
import {HookTitle} from './components/HookTitle';
import {KineticCaptions} from './components/KineticCaptions';
import {
  MediaContainerFrame,
  activeMediaContainerAt,
} from './components/MediaContainerTrack';
import {MotionGraphicTrack} from './components/MotionGraphicTrack';
import {SemanticEmphasisTrack} from './components/SemanticEmphasisTrack';
import {TransitionTrack} from './components/TransitionTrack';
import {VideoTrack} from './components/VideoTrack';
import {
  CompositePlate,
  VisualOverlayTrack,
  activeCompositeAt,
  activeOverlayLayoutAt,
} from './components/VisualOverlayTrack';
import {ZoomFrame} from './components/ZoomFrame';
import {resolveMediaSrc} from './lib/mediaSrc';
import {framesBetween, resolveSegments, secToFrame} from './lib/timeline';

export const ShortVideo: React.FC<ShortVideoProps> = ({blueprint, style}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timeSec = frame / fps;
  const overlays = style.brollEnabled ? blueprint.visualOverlays ?? [] : [];
  const split = style.brollEnabled
    ? activeOverlayLayoutAt(overlays, 'split', timeSec)
    : undefined;
  const composite = split ? undefined : activeCompositeAt(overlays, timeSec);
  const mediaContainer =
    !split && !composite
      ? activeMediaContainerAt(blueprint.mediaContainers, timeSec)
      : undefined;
  const hookDurationSec = Math.max(1.2, blueprint.hookDurationSec || 3);
  const hookActive = Boolean(blueprint.hookTitle) && timeSec < hookDurationSec;
  const speakerSide = split?.speakerSide === 'top' ? 'top' : 'bottom';
  const motionGraphics = blueprint.motionGraphics ?? [];
  const semanticEmphasis = blueprint.semanticEmphasis ?? [];
  const bigMotionActive =
    motionGraphics.some(g => timeSec >= g.start && timeSec < g.end && g.role === 'primary') ||
    semanticEmphasis.some(e => timeSec >= e.start && timeSec < e.end && e.weight === 'primary');

  const segments = resolveSegments(blueprint.keepSegments, {
    trimEnabled: style.trimEnabled,
    sourceDurationSec: blueprint.sourceDurationSec,
  });

  // Keep the creator's face in the half-panel: bias toward the upper face band.
  const speakerObjectPosition =
    speakerSide === 'top' ? '50% 28%' : '50% 18%';

  const speaker = (
    <ZoomFrame triggers={blueprint.zoomTriggers} enabled={style.zoomEnabled}>
      <VideoTrack
        src={blueprint.videoUrl}
        segments={segments}
        layoutStyle={style.layoutStyle}
        objectPosition={split ? speakerObjectPosition : '50% 42%'}
      />
    </ZoomFrame>
  );

  const containedSpeaker = mediaContainer ? (
    <MediaContainerFrame
      container={mediaContainer}
      language={blueprint.languageCode}>
      {speaker}
    </MediaContainerFrame>
  ) : (
    speaker
  );

  return (
    <AbsoluteFill style={{backgroundColor: '#000000'}}>
      {style.brollEnabled ? <CompositeTrack overlays={overlays} /> : null}

      {split ? (
        <SplitStage overlay={split} height={height} speakerSide={speakerSide}>
          {speaker}
        </SplitStage>
      ) : composite ? (
        <div
          style={{
            position: 'absolute',
            left: width * 0.07,
            width: width * 0.86,
            bottom: height * 0.12,
            height: height * 0.4,
            borderRadius: 34,
            overflow: 'hidden',
            border: '3px solid rgba(255,255,255,0.38)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          }}>
          {speaker}
        </div>
      ) : (
        containedSpeaker
      )}

      {style.brollEnabled && blueprint.brollClips.length > 0 && !split ? (
        <BRollTrack clips={blueprint.brollClips} />
      ) : null}

      {style.brollEnabled && overlays.length > 0 ? (
        <VisualOverlayTrack
          overlays={overlays}
          language={blueprint.languageCode}
        />
      ) : null}

      {motionGraphics.length > 0 ? (
        <MotionGraphicTrack
          graphics={motionGraphics}
          language={blueprint.languageCode}
        />
      ) : null}

      {semanticEmphasis.length > 0 ? (
        <SemanticEmphasisTrack
          emphasis={semanticEmphasis}
          language={blueprint.languageCode}
        />
      ) : null}

      {style.brollEnabled && (blueprint.transitions ?? []).length > 0 ? (
        <TransitionTrack clips={blueprint.transitions} />
      ) : null}

      {blueprint.hookTitle ? (
        <HookTitle
          title={blueprint.hookTitle}
          durationSec={hookDurationSec}
          language={blueprint.languageCode}
          styleId={blueprint.hookStyle}
        />
      ) : null}

      {hookActive || bigMotionActive ? null : (
        <KineticCaptions
          words={blueprint.captionWords}
          style={style}
          language={blueprint.languageCode}
          direction={blueprint.captionDirection}
        />
      )}
    </AbsoluteFill>
  );
};

/**
 * Split: creator on top OR bottom (director/planner picks). Soft feather seam.
 * Creator half always frames the face — never chops the head at the cut.
 */
const SplitStage: React.FC<{
  overlay: VisualOverlay;
  height: number;
  speakerSide: 'top' | 'bottom';
  children: React.ReactNode;
}> = ({overlay, height, speakerSide, children}) => {
  const seam = height * 0.5;
  const feather = Math.max(40, height * 0.075);
  const topH = seam + feather * 0.55;
  const bottomTop = seam - feather * 0.55;
  const bottomH = height - bottomTop;

  if (overlay.mediaKind !== 'video' || !overlay.assetUrl) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const related = (
    <OffthreadVideo
      src={resolveMediaSrc(overlay.assetUrl)}
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: '50% 40%',
      }}
    />
  );

  const topMask = {
    WebkitMaskImage: `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
    maskImage: `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
  } as const;
  const bottomMask = {
    WebkitMaskImage: `linear-gradient(to top, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
    maskImage: `linear-gradient(to top, #000 0%, #000 calc(100% - ${feather}px), transparent 100%)`,
  } as const;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: topH,
          overflow: 'hidden',
          backgroundColor: '#111',
          ...topMask,
        }}>
        {speakerSide === 'top' ? children : related}
      </div>
      <div
        style={{
          position: 'absolute',
          top: bottomTop,
          left: 0,
          right: 0,
          height: bottomH,
          overflow: 'hidden',
          ...bottomMask,
        }}>
        {speakerSide === 'bottom' ? children : related}
      </div>
      <div
        style={{
          position: 'absolute',
          top: seam - feather * 0.5,
          left: 0,
          right: 0,
          height: feather,
          pointerEvents: 'none',
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 45%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)',
          filter: 'blur(10px)',
          opacity: 0.85,
        }}
      />
    </AbsoluteFill>
  );
};

const CompositeTrack: React.FC<{overlays: VisualOverlay[]}> = ({overlays}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill>
      {overlays
        .filter(overlay => overlay.layout === 'composite' && overlay.assetUrl)
        .map((overlay, index) => (
          <Sequence
            key={`composite-${overlay.providerId}-${index}`}
            from={secToFrame(overlay.start, fps)}
            durationInFrames={framesBetween(overlay.start, overlay.end, fps)}>
            <CompositePlate overlay={overlay} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};

export function durationInFramesFor(props: ShortVideoProps): number {
  const seconds = props.style.trimEnabled
    ? props.blueprint.outputDurationSec
    : props.blueprint.sourceDurationSec;
  return Math.max(1, Math.ceil(seconds * props.blueprint.fps));
}
