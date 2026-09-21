/**
 * Optional SFX hits from the north-star audio plan.
 */

import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';

import {framesBetween, secToFrame} from '../lib/timeline';

const FILES: Record<string, string> = {
  whoosh: 'sfx/whoosh.wav',
  hit: 'sfx/hit.wav',
  pop: 'sfx/pop.wav',
};

export type SfxHit = {
  at: number;
  kind: string;
  volume?: number;
};

export const SfxTrack: React.FC<{hits?: SfxHit[]}> = ({hits}) => {
  const {fps} = useVideoConfig();
  if (!hits?.length) {
    return null;
  }
  return (
    <AbsoluteFill>
      {hits.map((hit, index) => {
        const src = FILES[hit.kind];
        if (!src) {
          return null;
        }
        return (
          <Sequence
            key={`sfx-${hit.kind}-${hit.at}-${index}`}
            from={secToFrame(Math.max(0, hit.at), fps)}
            durationInFrames={Math.max(1, framesBetween(0, 0.45, fps))}>
            <Audio src={staticFile(src)} volume={hit.volume ?? 0.12} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
