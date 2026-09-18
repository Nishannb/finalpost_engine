import React from 'react';
import {Composition} from 'remotion';

import {shortVideoPropsSchema, type ShortVideoProps} from './blueprintSchema';
import {ShortVideo, durationInFramesFor} from './ShortVideo';
import sampleProps from '../props/sample.json';

/**
 * Fallback props only matter in Remotion Studio; every real render passes a
 * blueprint through `inputProps`, and `calculateMetadata` re-derives duration
 * and canvas size from that payload.
 */
const defaultProps = sampleProps as unknown as ShortVideoProps;

export const RemotionRoot: React.FC = () => (
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
);
