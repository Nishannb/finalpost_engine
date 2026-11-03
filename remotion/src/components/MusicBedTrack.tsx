/**
 * WP27: optional music bed under the edit. Duck gain when speech is active (caption words).
 * Silent when no musicUrl — never invents a download.
 */

import React from 'react';
import {AbsoluteFill, Audio, useVideoConfig} from 'remotion';

import {duckLinearGainAt, type DuckEnvelope} from '../audio/duckEnvelope';
import {resolveMediaSrc} from '../lib/mediaSrc';

export type MusicBedSpec = {
  musicUrl: string;
  /** Peak bed gain when no speech (default 0.18). */
  musicGain?: number;
  /** Floor gain while speech is on (default 0.04). */
  duckedGain?: number;
  ducking?: boolean;
};

export type SpeechWindow = {start: number; end: number};

const speechAt = (windows: readonly SpeechWindow[], timeSec: number) =>
  windows.some(window => timeSec >= window.start && timeSec < window.end);

export function musicBedVolumeAt(input: {
  frame: number;
  fps: number;
  speechWindows: readonly SpeechWindow[];
  ducking: boolean;
  musicGain: number;
  duckedGain: number;
}): number {
  if (!input.ducking) return input.musicGain;
  const timeSec = input.frame / Math.max(1, input.fps);
  return speechAt(input.speechWindows, timeSec) ? input.duckedGain : input.musicGain;
}

export const MusicBedTrack: React.FC<{
  bed?: MusicBedSpec | null;
  /** Output-time speech spans (from caption words). */
  speechWindows?: readonly SpeechWindow[];
  /** Generated beds. Absent → the legacy square gate, unchanged. */
  duck?: DuckEnvelope | null;
}> = ({bed, speechWindows = [], duck = null}) => {
  const {fps} = useVideoConfig();
  if (!bed?.musicUrl) return null;
  const musicGain = bed.musicGain ?? 0.18;
  const duckedGain = bed.duckedGain ?? 0.04;
  const ducking = bed.ducking !== false;
  return (
    <AbsoluteFill>
      <Audio
        src={resolveMediaSrc(bed.musicUrl)}
        loop
        {...(duck ? {loopVolumeCurveBehavior: 'extend' as const} : {})}
        volume={frame =>
          duck
            ? duckLinearGainAt(duck, frame / fps)
            : musicBedVolumeAt({frame, fps, speechWindows, ducking, musicGain, duckedGain})
        }
      />
    </AbsoluteFill>
  );
};
