/**
 * Generated motion graphics in the timeline.
 *
 * full_screen / overlay / pip graphics are positioned layers above B-roll and
 * designed overlays, below emphasis, hook and captions. split_screen graphics
 * change the base layout (the talking head moves into the other half), so
 * ShortVideo mounts them through GeneratedSplitStage instead.
 */

import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig} from 'remotion';

import type {GeneratedGraphic} from '../blueprintSchema';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {framesBetween, secToFrame} from '../lib/timeline';
import {MotionProvider} from '../motion/context';
import {resolveTheme, type MotionTheme} from '../motion/theme';
import type {GraphicComponent} from './loader';
import {regionFor, safeAreaFor, type CaptionBand, type PixelRegion, type RegionSafeArea} from './placement';

/**
 * Props the editor always sets on a generated graphic (they win over
 * `graphic.props`). Region-relative: a graphic never knows whether it is
 * full-screen, half of a split, an overlay or a PiP. `content` and
 * `assets` arrive untouched from `graphic.props`.
 */
export type GeneratedGraphicRuntimeProps = {
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  /** Resolved theme: graphic.props.theme over the default theme. */
  theme: MotionTheme;
  /** Computed by the editor from captions and platform UI (px from the region edges). */
  safeArea: RegionSafeArea;
};

/**
 * WP54: a backend graphic (riso / anidoodle) that carries a rendered, SILENT mp4 in `props.assetUrl` plays that video full-region instead of its native fallback composition.
 * No assetUrl (or a non-video one) = the native composition draws, exactly as before. Pure helper so tests can pin the decision.
 */
export function backendVideoSrc(graphic: Pick<GeneratedGraphic, 'props'>): string | null {
  const props = graphic.props ?? {};
  const url = typeof props.assetUrl === 'string' ? props.assetUrl.trim() : '';
  if (!url || (props.backend !== 'riso' && props.backend !== 'anidoodle' && props.backend !== 'collage_gbro')) return null;
  return /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url) ? url : null;
}

const GraphicInRegion: React.FC<{
  graphic: GeneratedGraphic;
  Component: GraphicComponent;
  region: PixelRegion;
  captionBand: CaptionBand | null;
}> = ({graphic, Component, region, captionBand}) => {
  const {fps, height: canvasHeight} = useVideoConfig();
  const durationInFrames = framesBetween(graphic.start, graphic.end, fps);
  const videoSrc = backendVideoSrc(graphic);
  const runtime: GeneratedGraphicRuntimeProps = {
    width: region.width,
    height: region.height,
    durationInFrames,
    fps,
    theme: resolveTheme(graphic.props.theme as Partial<MotionTheme> | undefined),
    safeArea: safeAreaFor(region, canvasHeight, captionBand),
  };
  return (
    <Sequence
      from={secToFrame(graphic.start, fps)}
      durationInFrames={durationInFrames}
      name={`generated:${graphic.id}`}
      layout="none">
      <div
        style={{
          position: 'absolute',
          left: region.x,
          top: region.y,
          width: region.width,
          height: region.height,
          overflow: 'hidden',
        }}>
        <MotionProvider
          theme={runtime.theme}
          safeArea={runtime.safeArea}
          width={region.width}
          height={region.height}
          idScope={`g-${graphic.id}`}>
          {videoSrc ? (
            <OffthreadVideo src={resolveMediaSrc(videoSrc)} muted volume={0} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            /* Runtime props win so a graphic can never be told the wrong size. */
            <Component {...graphic.props} {...runtime} />
          )}
        </MotionProvider>
      </div>
    </Sequence>
  );
};

export const GeneratedGraphicTrack: React.FC<{
  graphics: GeneratedGraphic[];
  components: Record<string, GraphicComponent>;
  captionBand: CaptionBand | null;
}> = ({graphics, components, captionBand}) => {
  const {width, height} = useVideoConfig();
  const layered = graphics.filter(graphic => graphic.placement.mode !== 'split_screen');
  // Full-screen graphics sit beneath overlays/PiPs that share the window.
  const ordered = [
    ...layered.filter(graphic => graphic.placement.mode === 'full_screen'),
    ...layered.filter(graphic => graphic.placement.mode !== 'full_screen'),
  ];

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {ordered.map(graphic => {
        const Component = components[graphic.module.sha256];
        return Component ? (
          <GraphicInRegion
            key={graphic.id}
            graphic={graphic}
            Component={Component}
            region={regionFor(graphic.placement, width, height)}
            captionBand={captionBand}
          />
        ) : null;
      })}
    </AbsoluteFill>
  );
};

/**
 * Top/bottom split: the talking head fills one half (cover-cropped by the
 * existing VideoTrack), the graphic renders live in the other. Mounted by
 * ShortVideo only while the split is active.
 */
const SPEAKER_CARD_RADIUS = 44;

export const GeneratedSplitStage: React.FC<{
  graphic: GeneratedGraphic;
  Component: GraphicComponent | undefined;
  captionBand: CaptionBand | null;
  children: React.ReactNode;
}> = ({graphic, Component, captionBand, children}) => {
  const {width, height} = useVideoConfig();
  const graphicRegion = regionFor(graphic.placement, width, height);
  const speakerRegion =
    graphicRegion.y === 0
      ? {x: 0, y: graphicRegion.height, width, height: height - graphicRegion.height}
      : {x: 0, y: 0, width, height: graphicRegion.y};

  return (
    <AbsoluteFill style={{backgroundColor: '#000000'}}>
      <div
        style={{
          position: 'absolute',
          left: speakerRegion.x,
          top: speakerRegion.y,
          width: speakerRegion.width,
          height: speakerRegion.height,
          overflow: 'hidden',
          // WP9C: the talking-head half reads as a rounded card on the edge that meets the plate (top plate -> top corners round).
          ...(graphicRegion.y === 0
            ? {borderTopLeftRadius: SPEAKER_CARD_RADIUS, borderTopRightRadius: SPEAKER_CARD_RADIUS}
            : {borderBottomLeftRadius: SPEAKER_CARD_RADIUS, borderBottomRightRadius: SPEAKER_CARD_RADIUS}),
        }}>
        {children}
      </div>
      {Component ? (
        <GraphicInRegion graphic={graphic} Component={Component} region={graphicRegion} captionBand={captionBand} />
      ) : null}
    </AbsoluteFill>
  );
};
