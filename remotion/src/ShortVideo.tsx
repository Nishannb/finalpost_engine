/**
 * The composition every burn goes through.
 *
 * Layer order: composite/split plate → talking-head (optional media container,
 * behind-subject overlay, or inset scale reveal) → video B-roll → designed
 * overlays → motion graphics → semantic emphasis → transition wipes → hook →
 * captions (not scaled by inset_reveal).
 */

import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, Easing, useCurrentFrame, useVideoConfig} from 'remotion';

import type {ShortVideoProps, TimelineBlueprint, VisualOverlay} from './blueprintSchema';
import {BRollTrack} from './components/BRollTrack';
import {DepthOverlayTrack} from './components/DepthOverlayTrack';
import {InsetRevealTrack} from './components/InsetRevealTrack';
import {HookTitle} from './components/HookTitle';
import {DynamicCaptionRenderer} from './captions/DynamicCaptionRenderer';
import type {DynamicCaptionTemplateId} from './captions/types';
import {
  MediaContainerFrame,
  activeMediaContainerAt,
} from './components/MediaContainerTrack';
import {
  FrameInsetFrame,
  activeFrameInsetAt,
} from './components/FrameInsetTrack';
import {MotionGraphicTrack} from './components/MotionGraphicTrack';
import {SemanticEmphasisTrack} from './components/SemanticEmphasisTrack';
import {TransitionTrack} from './components/TransitionTrack';
import {VideoTrack} from './components/VideoTrack';
import {
  CompositePlate,
  VisualOverlayTrack,
  activeCompositeAt,
  activeCutoutAt,
  activeOverlayLayoutAt,
} from './components/VisualOverlayTrack';
import {ZoomFrame} from './components/ZoomFrame';
import {SfxTrack} from './components/SfxTrack';
import {SlideshowPlate, overlayHasSlideshow} from './components/SlideshowPlate';
import {resolveMediaSrc} from './lib/mediaSrc';
import {
  captionLayoutForInset,
  getInsetState,
} from './lib/insetRevealMotion';
import {activeInsetRevealAt} from './components/InsetRevealTrack';
import {SPLIT_ENTER_SEC, SPLIT_EXIT_SEC, splitExitStartsAt, splitPlaySec} from './lib/splitMotion';
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
  const cutout =
    !split && !composite && style.brollEnabled
      ? activeCutoutAt(overlays, timeSec)
      : undefined;
  const mediaContainer =
    !split && !composite && !cutout
      ? activeMediaContainerAt(blueprint.mediaContainers, timeSec)
      : undefined;
  const hookDurationSec = Math.max(1.2, blueprint.hookDurationSec || 3);
  const hookStartSec = Math.max(0, blueprint.hookStartSec || 0);
  const speakerSide = split?.speakerSide === 'top' ? 'top' : 'bottom';
  const motionGraphics = blueprint.motionGraphics ?? [];
  const semanticEmphasis = blueprint.semanticEmphasis ?? [];
  const frameInset = activeFrameInsetAt(blueprint.frameInsets, timeSec);
  const insetClip =
    !split && !composite && !cutout
      ? activeInsetRevealAt(blueprint.insetReveals, timeSec)
      : undefined;
  const insetState = insetClip
    ? getInsetState(
        timeSec - insetClip.start,
        insetClip.end - insetClip.start,
        insetClip.params,
      )
    : undefined;
  const captionLayout = captionLayoutForInset(
    insetClip && insetClip.params.captions.enabled ? insetState?.progress ?? 0 : 0,
    {
      position: blueprint.captionDirection?.position,
      bottomFrac:
        blueprint.captionDirection?.bottomFrac ?? style.captionBottomFrac,
    },
    insetClip?.params,
  );

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

  const picture = (
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
      ) : cutout ? (
        <CutoutStage
          overlay={cutout}
          speakerCutout={blueprint.speakerCutout}
          talkingHead={speaker}
          plateUrl={
            cutout.assetUrl ||
            (blueprint.brollClips ?? []).find(
              clip =>
                Boolean(clip.assetUrl) &&
                clip.start < cutout.end &&
                clip.end > cutout.start,
            )?.assetUrl
          }
          plateKind={
            cutout.assetUrl
              ? cutout.mediaKind
              : (blueprint.brollClips ?? []).some(
                    clip =>
                      Boolean(clip.assetUrl) &&
                      clip.start < cutout.end &&
                      clip.end > cutout.start,
                  )
                ? 'video'
                : cutout.mediaKind
          }
        />
      ) : (
        <InsetRevealTrack
          clips={blueprint.insetReveals ?? []}
          talkingHead={
            <DepthOverlayTrack
              clips={style.brollEnabled ? blueprint.depthOverlays ?? [] : []}
              talkingHead={containedSpeaker}
              speakerCutout={blueprint.speakerCutout}
              segments={segments}
              layoutStyle={style.layoutStyle}
              zoomTriggers={blueprint.zoomTriggers}
              zoomEnabled={style.zoomEnabled}
            />
          }
          design={blueprint.northStarDesign}
        />
      )}

      {style.brollEnabled && blueprint.brollClips.length > 0 && !split && !cutout ? (
        <BRollTrack clips={blueprint.brollClips} />
      ) : null}

      {style.brollEnabled && overlays.length > 0 ? (
        <VisualOverlayTrack
          overlays={overlays}
          language={blueprint.languageCode}
          design={blueprint.northStarDesign}
        />
      ) : null}

      {motionGraphics.length > 0 ? (
        <MotionGraphicTrack
          graphics={motionGraphics}
          language={blueprint.languageCode}
          design={blueprint.northStarDesign}
        />
      ) : null}

      {semanticEmphasis.length > 0 ? (
        <SemanticEmphasisTrack
          emphasis={semanticEmphasis}
          language={blueprint.languageCode}
          design={blueprint.northStarDesign}
        />
      ) : null}

      {style.brollEnabled && (blueprint.transitions ?? []).length > 0 ? (
        <TransitionTrack clips={blueprint.transitions} />
      ) : null}

      <SfxTrack hits={blueprint.audioDesign?.hits} />

      {blueprint.hookTitle ? (
        <Sequence
          from={secToFrame(hookStartSec, fps)}
          durationInFrames={Math.max(1, Math.round(hookDurationSec * fps))}>
          <HookTitle
            title={blueprint.hookTitle}
            durationSec={hookDurationSec}
            language={blueprint.languageCode}
            styleId={blueprint.hookStyle}
            anchor={blueprint.hookAnchor}
            design={blueprint.northStarDesign}
          />
        </Sequence>
      ) : null}

      <AbsoluteFill
        style={{
          bottom: 'auto',
          height: `${captionLayout.frameHeightFrac * 100}%`,
          overflow: 'hidden',
          pointerEvents: 'none',
          top: `${captionLayout.frameTopFrac * 100}%`,
        }}>
        <DynamicCaptionRenderer
          transcriptData={blueprint.captionWords}
          selectedTemplate={
            (style.captionTemplate ||
              blueprint.captionDirection?.template) as DynamicCaptionTemplateId
          }
          customizationOptions={{
            primaryColor: blueprint.captionDirection?.textColor,
            secondaryColor: blueprint.captionDirection?.highlightColor,
            fontSize: blueprint.captionDirection?.fontScale
              ? 34 * blueprint.captionDirection.fontScale
              : undefined,
          }}
          language={blueprint.languageCode}
          style={{
            ...style,
            captionBottomFrac: captionLayout.bottomFrac,
          }}
          direction={{
            ...blueprint.captionDirection,
            position: captionLayout.position,
            bottomFrac: captionLayout.bottomFrac,
          }}
          design={blueprint.northStarDesign}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );

  return frameInset ? (
    <FrameInsetFrame inset={frameInset}>{picture}</FrameInsetFrame>
  ) : (
    picture
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
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timeSec = frame / fps;
  const local = Math.max(0, timeSec - overlay.start);
  const enter = spring({
    frame: Math.round(local * fps),
    fps,
    config: {damping: 22, stiffness: 58, mass: 1.15},
    durationInFrames: Math.round(SPLIT_ENTER_SEC * fps),
  });
  const exitAt = splitExitStartsAt(overlay);
  const exit =
    local < exitAt
      ? 1
      : interpolate(local, [exitAt, exitAt + SPLIT_EXIT_SEC], [1, 0], {
          easing: Easing.inOut(Easing.cubic),
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const progress = Math.min(1, enter) * Math.max(0, exit);

  const seam = interpolate(progress, [0, 1], [
    speakerSide === 'top' ? height : 0,
    height * 0.5,
  ]);
  const feather = Math.max(40, height * 0.075);
  const topH = seam + feather * 0.55;
  const bottomTop = seam - feather * 0.55;
  const bottomH = height - bottomTop;
  const relatedShift = (1 - progress) * (speakerSide === 'top' ? height * 0.35 : -height * 0.35);

  const hasMedia = Boolean(overlay.assetUrl) || overlayHasSlideshow(overlay);
  if (!hasMedia) {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const related = (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform: `translateY(${relatedShift}px)`,
        opacity: progress,
      }}>
      {overlay.mediaKind === 'video' && overlay.assetUrl && !overlayHasSlideshow(overlay) ? (
        <SplitVideoPlate overlay={overlay} />
      ) : (
        <SlideshowPlate overlay={overlay} />
      )}
    </div>
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
          opacity: 0.85 * progress,
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 45%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)',
          filter: 'blur(10px)',
        }}
      />
    </AbsoluteFill>
  );
};

const splitVideoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: '50% 40%',
};

/** Slide in first; play the clip only after enter hits 100%; then slide off. */
const SplitVideoPlate: React.FC<{overlay: VisualOverlay}> = ({overlay}) => {
  const {fps} = useVideoConfig();
  const startFrame = secToFrame(overlay.start, fps);
  const enterFrames = Math.max(1, Math.round(SPLIT_ENTER_SEC * fps));
  const playFrames = Math.max(1, Math.round(splitPlaySec(overlay) * fps));
  const src = resolveMediaSrc(overlay.assetUrl);
  return (
    <AbsoluteFill>
      <Sequence from={startFrame} durationInFrames={enterFrames} layout="none">
        <OffthreadVideo src={src} startFrom={0} endAt={2} muted style={splitVideoStyle} />
      </Sequence>
      <Sequence from={startFrame + enterFrames} durationInFrames={playFrames} layout="none">
        <OffthreadVideo src={src} muted style={splitVideoStyle} />
      </Sequence>
    </AbsoluteFill>
  );
};

/**
 * Creator stands in front of B-roll / designed canvas. Keyed WebM when the
 * backdrop is plain; otherwise a soft occupancy crop of the talking-head.
 */
const CutoutStage: React.FC<{
  overlay: VisualOverlay;
  speakerCutout?: TimelineBlueprint['speakerCutout'];
  talkingHead: React.ReactNode;
  plateUrl?: string;
  plateKind?: VisualOverlay['mediaKind'];
}> = ({overlay, speakerCutout, talkingHead, plateUrl, plateKind}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const local = Math.max(0, frame / fps);
  const hold = Math.max(0.8, overlay.end - overlay.start);
  const enter = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 90, mass: 0.95},
    durationInFrames: Math.round(0.7 * fps),
  });
  const remaining = hold - local;
  const exit =
    remaining < 0.7
      ? interpolate(remaining, [0, 0.7], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const progress = Math.min(1, enter) * Math.max(0, exit);
  const keyedSrc = speakerCutout?.videoUrl
    ? resolveMediaSrc(speakerCutout.videoUrl)
    : '';
  const box = speakerCutout?.speaker ?? {x: 0.12, y: 0.22, w: 0.76, h: 0.7};
  const speakerWidth = width * Math.min(0.92, Math.max(0.62, box.w * 1.15));
  const speakerHeight = height * Math.min(0.72, Math.max(0.42, box.h * 0.95));

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{opacity: progress}}>
        {plateUrl ? (
          plateKind === 'video' ? (
            <OffthreadVideo
              src={resolveMediaSrc(plateUrl)}
              muted
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          ) : (
            <Img
              src={resolveMediaSrc(plateUrl)}
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          )
        ) : (
          <AbsoluteFill
            style={{
              background:
                overlay.accentColor ||
                'linear-gradient(180deg, #F8FAFC 0%, #E2E8F0 100%)',
            }}
          />
        )}
      </AbsoluteFill>
      {keyedSrc ? (
        <OffthreadVideo
          src={keyedSrc}
          muted
          transparent
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: progress,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            left: (width - speakerWidth) / 2,
            bottom: height * 0.02,
            width: speakerWidth,
            height: speakerHeight,
            overflow: 'hidden',
            opacity: progress,
            WebkitMaskImage:
              'radial-gradient(ellipse 72% 88% at 50% 62%, #000 46%, transparent 78%)',
            maskImage:
              'radial-gradient(ellipse 72% 88% at 50% 62%, #000 46%, transparent 78%)',
          }}>
          {talkingHead}
        </div>
      )}
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
