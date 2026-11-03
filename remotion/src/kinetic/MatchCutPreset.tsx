/**
 * `type.matchCut`: the existing TypeTextMatchCut mounted by the kinetic compositor. Nothing about its look lives here: the solver hands over keyword / swapKeyword / phrase / before / after / variant (all
 * sliced from the transcript) and the window; the comp owns the grammar. Full frame, IN FRONT of the plate (KineticTrack's front mount); it never goes behind the matte.
 * The Sequence makes the comp's own clock start at the event's inFrame, so the hard cuts land where the solver said.
 */
import React from 'react';
import {Sequence, useVideoConfig} from 'remotion';

import {TypeTextMatchCut} from '../motion/compositions/templates/TextMatchCut';
import type {PresetProps} from './primitives';

export const TypeMatchCutPreset: React.FC<PresetProps> = ({event}) => {
  const {width, height} = useVideoConfig();
  const m = event.matchCut;
  if (!m) return null;
  const dur = Math.max(2, event.outFrame - event.inFrame);
  return (
    <Sequence from={event.inFrame} durationInFrames={dur} layout="none">
      <TypeTextMatchCut
        width={width}
        height={height}
        keyword={m.keyword}
        {...(m.swapKeyword ? {swapKeyword: m.swapKeyword} : {})}
        phrase={m.phrase}
        {...(m.before ? {before: m.before} : {})}
        {...(m.after ? {after: m.after} : {})}
        variant={m.variant}
        durationInFrames={dur}
      />
    </Sequence>
  );
};
