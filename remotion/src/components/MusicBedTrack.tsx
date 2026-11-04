/**
 * WP27: optional music bed under the edit. Duck gain when speech is active (caption words).
 * Silent when no musicUrl — never invents a download.
 */

import React from 'react';
import {AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';

import {duckDbAt, duckLinearGainAt, type DuckEnvelope} from '../audio/duckEnvelope';
import {placementGainAt} from '../audio/placementGain';
import {resolveMediaSrc} from '../lib/mediaSrc';

/**
 * Full bed (0) ↔ VO-carved bed (1) from the stored duck envelope.
 * PARITY: identical to server/src/stages/music/carvedMix.ts (tested there). Pause and open → 0, speech → 1.
 */
export function carvedMix(duckDb: number, speechDb: number, openDb: number, pauseDb?: number): number {
  const ref = pauseDb ?? openDb;
  const span = ref - speechDb;
  if (!(span > 0)) return duckDb <= speechDb ? 1 : 0;
  return Math.min(1, Math.max(0, (ref - duckDb) / span));
}

export function carvedGains(mix: number): {full: number; carved: number} {
  const m = Math.min(1, Math.max(0, mix));
  return {full: Math.cos((m * Math.PI) / 2), carved: Math.sin((m * Math.PI) / 2)};
}

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
  /** VO-carved twin of the full bed. Absent → single-file playback. Set only when MUSIC_CARVED_TWIN is on. */
  musicCarvedUrl?: string;
  musicSource?: 'licensed' | 'generated';
  /**
   * Placement (MUSIC_PERSONALIZE, new blueprints only). Seconds into the bed that play at video frame 0 (a bed downbeat); video time the music is silent from;
   * its fade; video time the loop body takes over (a bar line). Any of these present = the placed branch. None is a gain.
   */
  musicStartOffsetSec?: number;
  musicEndSec?: number;
  musicEndFadeSec?: number;
  musicLoopFromSec?: number;
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

  // Placed bed (Phase 3): start offset on a downbeat, an end fade, a bar-aligned loop hand-off. The duck envelope stays in VIDEO time and decides the level;
  // the end fade can only lower it. Blueprints without placement fields never reach this branch, so they render exactly as before.
  if (bed.musicStartOffsetSec !== undefined || bed.musicEndSec !== undefined) {
    const offsetFrames = Math.max(0, Math.round((bed.musicStartOffsetSec ?? 0) * fps));
    const timeSec = globalFrame / fps;
    const base = volumeAt(globalFrame) * placementGainAt(timeSec, bed.musicEndSec, bed.musicEndFadeSec);
    const carvedSrc = bed.musicCarvedUrl && duck ? resolveMediaSrc(bed.musicCarvedUrl) : null;
    const gains = carvedSrc && duck ? carvedGains(carvedMix(duckDbAt(duck, timeSec), duck.speechDb, duck.openDb, duck.pauseDb)) : {full: 1, carved: 0};
    const loopFrom = bed.musicLoopFromSec !== undefined && bed.musicLoopUrl ? Math.max(1, Math.round(bed.musicLoopFromSec * fps)) : null;
    const headFrames = loopFrom !== null ? Math.min(loopFrom, durationInFrames) : durationInFrames;
    return (
      <AbsoluteFill>
        <Sequence from={0} durationInFrames={Math.max(1, headFrames)}>
          <Audio src={resolveMediaSrc(bed.musicFullUrl || bed.musicUrl)} startFrom={offsetFrames} volume={() => base * gains.full} />
          {carvedSrc ? <Audio src={carvedSrc} startFrom={offsetFrames} volume={() => base * gains.carved} /> : null}
        </Sequence>
        {loopFrom !== null && loopFrom < durationInFrames ? (
          <Sequence from={loopFrom} durationInFrames={durationInFrames - loopFrom}>
            <Audio src={resolveMediaSrc(bed.musicLoopUrl as string)} loop loopVolumeCurveBehavior="extend" volume={() => base} />
          </Sequence>
        ) : null}
      </AbsoluteFill>
    );
  }

  const split =
    bed.musicSource === 'generated' && bed.musicLoopUrl && bed.musicFullDurationSec && bed.musicFullDurationSec > 0;
  if (split) {
    const fullSrc = resolveMediaSrc(bed.musicFullUrl || bed.musicUrl);
    const timelineSec = durationInFrames / fps;
    const globalVolume = () => volumeAt(globalFrame);
    // Carved twin: only the full bed has a carved file, so the loop body stays uncarved.
    if (bed.musicCarvedUrl && duck) {
      const mix = carvedMix(duckDbAt(duck, globalFrame / fps), duck.speechDb, duck.openDb, duck.pauseDb);
      const gains = carvedGains(mix);
      const base = volumeAt(globalFrame);
      const twin = (
        <>
          <Audio src={fullSrc} volume={base * gains.full} />
          <Audio src={resolveMediaSrc(bed.musicCarvedUrl)} volume={base * gains.carved} />
        </>
      );
      if (timelineSec <= LOOP_THRESHOLD_SEC) return <AbsoluteFill>{twin}</AbsoluteFill>;
      const loopFromTwin = Math.max(0, Math.round((bed.musicFullDurationSec as number) * fps));
      return (
        <AbsoluteFill>
          {twin}
          {loopFromTwin < durationInFrames ? (
            <Sequence from={loopFromTwin} durationInFrames={durationInFrames - loopFromTwin}>
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

  if (bed.musicCarvedUrl && duck) {
    // Non-split path (pool hits, beds without a loop body): crossfade full and carved twins.
    const gainsAt = (frame: number) => {
      const mix = carvedMix(duckDbAt(duck, frame / fps), duck.speechDb, duck.openDb, duck.pauseDb);
      return carvedGains(mix);
    };
    return (
      <AbsoluteFill>
        <Audio
          src={resolveMediaSrc(bed.musicUrl)}
          loop
          loopVolumeCurveBehavior="extend"
          volume={(frame: number) => volumeAt(frame) * gainsAt(frame).full}
        />
        <Audio
          src={resolveMediaSrc(bed.musicCarvedUrl)}
          loop
          loopVolumeCurveBehavior="extend"
          volume={(frame: number) => volumeAt(frame) * gainsAt(frame).carved}
        />
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
