import React from 'react';
import {Composition} from 'remotion';

import {shortVideoPropsSchema, type ShortVideoProps} from './blueprintSchema';
import {
  GeneratedGraphicPreview,
  generatedGraphicPreviewSchema,
  type GeneratedGraphicPreviewProps,
} from './generated/GeneratedGraphicPreview';
import {ShortVideo, durationInFramesFor} from './ShortVideo';
import sampleProps from '../props/sample.json';
import storyboardData from './kinetic/storyboard.spec.json';
import {
  KineticEdit,
  KineticStoryboard,
  kineticEditSchema,
  kineticStoryboardSchema,
  type KineticEditProps,
  type KineticStoryboardProps,
} from './kinetic/KineticComps';
import type {RenderSpec} from './kinetic/spec';

/**
 * Fallback props only matter in Remotion Studio; every real render passes a
 * blueprint through `inputProps`, and `calculateMetadata` re-derives duration
 * and canvas size from that payload.
 */
const defaultProps = sampleProps as unknown as ShortVideoProps;

/** Studio placeholder; the motion worker always passes a real graphic. */
const previewDefaults: GeneratedGraphicPreviewProps = {
  graphic: {
    id: 'preview',
    start: 0,
    end: 3,
    placement: {mode: 'full_screen'},
    module: {url: 'staticFile:mg-fixture-modules/preview.js', sha256: '0'.repeat(64)},
    props: {},
  },
  captionBottomFrac: 0.16,
};

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="ShortVideo"
    component={ShortVideo}
    schema={shortVideoPropsSchema}
    defaultProps={defaultProps}
    durationInFrames={durationInFramesFor(defaultProps)}
    fps={defaultProps.blueprint.fps}
    width={defaultProps.blueprint.width}
    height={defaultProps.blueprint.height}
    calculateMetadata={({props}) => ({
      durationInFrames: durationInFramesFor(props),
      fps: props.blueprint.fps,
      width: props.blueprint.width,
      height: props.blueprint.height,
    })}
  />
  <Composition
    id="GeneratedGraphicPreview"
    component={GeneratedGraphicPreview}
    schema={generatedGraphicPreviewSchema}
    defaultProps={previewDefaults}
    durationInFrames={90}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={({props}: {props: GeneratedGraphicPreviewProps}) => ({
      durationInFrames: Math.max(1, Math.round((props.graphic.end - props.graphic.start) * 30)),
    })}
  />
  <Composition
    id="KineticStoryboard"
    component={KineticStoryboard}
    schema={kineticStoryboardSchema}
    defaultProps={storyboardData as unknown as KineticStoryboardProps}
    durationInFrames={(storyboardData as unknown as {spec: RenderSpec}).spec.durationInFrames}
    fps={(storyboardData as unknown as {spec: RenderSpec}).spec.fps}
    width={(storyboardData as unknown as {spec: RenderSpec}).spec.width}
    height={(storyboardData as unknown as {spec: RenderSpec}).spec.height}
    calculateMetadata={({props}: {props: KineticStoryboardProps}) => ({durationInFrames: Math.max(1, props.spec.durationInFrames), fps: props.spec.fps, width: props.spec.width, height: props.spec.height})}
  />
  <Composition
    id="KineticEdit"
    component={KineticEdit}
    schema={kineticEditSchema}
    defaultProps={{spec: (storyboardData as unknown as {spec: RenderSpec}).spec, plateColor: '#1b1f27'} as KineticEditProps}
    durationInFrames={(storyboardData as unknown as {spec: RenderSpec}).spec.durationInFrames}
    fps={(storyboardData as unknown as {spec: RenderSpec}).spec.fps}
    width={(storyboardData as unknown as {spec: RenderSpec}).spec.width}
    height={(storyboardData as unknown as {spec: RenderSpec}).spec.height}
    calculateMetadata={({props}: {props: KineticEditProps}) => ({durationInFrames: Math.max(1, props.spec.durationInFrames), fps: props.spec.fps, width: props.spec.width, height: props.spec.height})}
  />
  </>
);
