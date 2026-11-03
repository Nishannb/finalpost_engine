/**
 * WP27: optional music bed under the edit. Duck gain when speech is active (caption words).
 * Silent when no musicUrl — never invents a download.
 */

import React from 'react';
import {AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';

import {duckLinearGainAt, type DuckEnvelope} from '../audio/duckEnvelope';
import {resolveMediaSrc} from '../lib/mediaSrc';

export type MusicBedSpec = {
  musicUrl: string;
  /** Peak bed gain when no speech (default 0.18). */
  musicGain?: number;
  /** Floor gain while speech is on (default 0.04). */
  duckedGain?: number;
  ducking?: boolean;
  /** Generated beds: full bed played once (falls back to musicUrl). */
  musicFullUrl?: string;
  /** Generated beds: bar-aligned loop body. Absent → single looping musicUrl. */
  musicLoopUrl?: string;
  musicFullDurationSec?: number;
  musicSource?: 'licensed' | 'generated';
};

export type SpeechWindow = {start: number; end: number};

/** Timelines at or under this play the full bed once with no loop. Mirrors server/src/stages/music/loopBed.ts. */
export const LOOP_THRESHOLD_SEC = 58;

/** Pure form of the split rule. Mirrors server/src/stages/music/loopBed.ts. */
export function usesLoopBody(timelineSec: number, bed: MusicBedSpec): boolean {
  const split =
    bed.musicSource === 'generated' && Boolean(bed.musicLoopUrl) && (bed.musicFullDurationSec ?? 0) > 0;
  return split && timelineSec > LOOP_THRESHOLD_SEC;
}

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
  const {fps, durationInFrames} = useVideoConfig();
  // Composition frame, never the Sequence-local one, so the duck envelope does not restart.
  const globalFrame = useCurrentFrame();
  if (!bed?.musicUrl) return null;
  const musicGain = bed.musicGain ?? 0.18;
  const duckedGain = bed.duckedGain ?? 0.04;
  const ducking = bed.ducking !== false;
  const volumeAt = (frame: number) =>
    duck
      ? duckLinearGainAt(duck, frame / fps)
      : musicBedVolumeAt({frame, fps, speechWindows, ducking, musicGain, duckedGain});

  const split =
    bed.musicSource === 'generated' && bed.musicLoopUrl && bed.musicFullDurationSec && bed.musicFullDurationSec > 0;
  if (split) {
    const fullSrc = resolveMediaSrc(bed.musicFullUrl || bed.musicUrl);
    const timelineSec = durationInFrames / fps;
    const globalVolume = () => volumeAt(globalFrame);
    if (timelineSec <= LOOP_THRESHOLD_SEC) {
      return (
        <AbsoluteFill>
          <Audio src={fullSrc} volume={globalVolume} />
        </AbsoluteFill>
      );
    }
    const loopFrom = Math.max(0, Math.round((bed.musicFullDurationSec as number) * fps));
    return (
      <AbsoluteFill>
        <Audio src={fullSrc} volume={globalVolume} />
        {loopFrom < durationInFrames ? (
          <Sequence from={loopFrom} durationInFrames={durationInFrames - loopFrom}>
            <Audio
              src={resolveMediaSrc(bed.musicLoopUrl as string)}
              loop
              loopVolumeCurveBehavior="extend"
              volume={globalVolume}
            />
          </Sequence>
        ) : null}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <Audio
        src={resolveMediaSrc(bed.musicUrl)}
        loop
        {...(duck ? {loopVolumeCurveBehavior: 'extend' as const} : {})}
        volume={frame => volumeAt(frame)}
      />
    </AbsoluteFill>
  );
};
