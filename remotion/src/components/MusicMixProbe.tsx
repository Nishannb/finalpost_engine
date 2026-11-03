/**
 * Measurement-only composition (never part of a delivered video). Rendered locally with --codec=wav.
 * stem "bed": only MusicBedTrack with the stored duck envelope. stem "vo": only the dialogue audio at gain 1.
 */

import React from 'react';
import {AbsoluteFill, Audio, Sequence} from 'remotion';
import {z} from 'zod';

import type {DuckEnvelope} from '../audio/duckEnvelope';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {MusicBedTrack} from './MusicBedTrack';

export const MIX_PROBE_FPS = 30;

export const musicMixProbeSchema = z.object({
  stem: z.enum(['bed', 'vo']),
  bedUrl: z.string(),
  voUrl: z.string(),
  duck: z.any().nullable().optional(),
  durationSec: z.number().positive(),
  /** Optional keep segments so a trimmed render's dialogue lands on the output timeline. */
  voSegments: z
    .array(z.object({sourceStart: z.number(), sourceEnd: z.number(), outputStart: z.number()}))
    .optional(),
});

export type MusicMixProbeProps = z.infer<typeof musicMixProbeSchema>;

export const mixProbeFrames = (durationSec: number) => Math.max(1, Math.ceil(durationSec * MIX_PROBE_FPS));

export const MusicMixProbe: React.FC<MusicMixProbeProps> = ({stem, bedUrl, voUrl, duck, voSegments}) => {
  if (stem === 'bed') {
    return (
      <AbsoluteFill>
        <MusicBedTrack bed={{musicUrl: bedUrl}} duck={(duck ?? null) as DuckEnvelope | null} />
      </AbsoluteFill>
    );
  }
  const src = resolveMediaSrc(voUrl);
  if (voSegments && voSegments.length > 0) {
    return (
      <AbsoluteFill>
        {voSegments.map((segment, index) => (
          <Sequence
            key={index}
            from={Math.round(segment.outputStart * MIX_PROBE_FPS)}
            durationInFrames={Math.max(1, Math.round((segment.sourceEnd - segment.sourceStart) * MIX_PROBE_FPS))}
          >
            <Audio src={src} startFrom={Math.round(segment.sourceStart * MIX_PROBE_FPS)} volume={1} />
          </Sequence>
        ))}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <Audio src={src} volume={1} />
    </AbsoluteFill>
  );
};
