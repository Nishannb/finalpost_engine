/**
 * AudioTimeline v1: the compiled, exact soundtrack. Produced only by compile.ts; nothing here is authored by a model.
 * All times are OUTPUT seconds (the Event Sheet's clock) with the frame the renderer will use (secToFrame = round(sec * fps)).
 *
 * Music gain at time t (linear, what the renderer multiplies the bed by):
 *   0 outside [startSec, endSec)
 *   duckLinearGainAt(duck, t)              voice-relative ducking (stages/music/duckEnvelope.ts, the renderer's own curve)
 *   x endFadeGainAt(t)                     the placed bed's end fade (mirrors remotion/src/audio/placementGain.ts)
 *   x automationGainAt(t)                  fade-in and section levels (piecewise linear keyframes, every value in [0, 1])
 * Automation can only lower the bed: it never exceeds 1, so the voice-first ceilings of the duck envelope always hold.
 */

import {duckLinearGainAt, type DuckEnvelope} from '../../music/duckEnvelope.ts';

export const AUDIO_TIMELINE_VERSION = 1 as const;

export type GainKeyframe = {timeSec: number; gain: number};

export type TimelineSection = {fromSec: number; toSec: number; energy: 'low' | 'medium' | 'high'; level: 'full' | 'reduced' | 'quiet' | 'out'; gain: number};

export type TimelineMusic = {
  assetId: string;
  source: 'licensed' | 'generated';
  url: string;
  fullUrl: string;
  loopUrl: string | null;
  carvedUrl: string | null;
  fullDurationSec: number;
  bpm: number | null;
  /** Video time the bed enters, and its frame. */
  startSec: number;
  startFrame: number;
  /** Video time the bed is silent from (after its end fade). */
  endSec: number;
  endFadeSec: number;
  endType: 'button' | 'hold-fade';
  /** Seconds into the bed heard at `startSec` (a bed downbeat when the bed has metadata). */
  sourceOffsetSec: number;
  /** Video time the loop body takes over (a bar line), or null. */
  loopFromSec: number | null;
  fadeInSec: number;
  sections: TimelineSection[];
  /** Fade-in and section levels as linear-gain keyframes in video time. Empty = constant 1. */
  automation: GainKeyframe[];
  duck: DuckEnvelope;
  bedLufs: number | null;
  /** From the existing placement (stages/music/placement.ts). */
  placement: {reason: string; score: number | null; startsOnDownbeat: boolean; liftAtVideoSec: number | null; liftErrBeats: number | null};
};

export type TimelineSfx = {
  /** The plan cue id. */
  id: string;
  assetRef: string;
  /** Renderer source: a built-in kind (staticFile) or a catalogue file path under the public dir. */
  builtin: 'whoosh' | 'hit' | 'pop' | null;
  src: string | null;
  startSec: number;
  startFrame: number;
  durationSec: number;
  /** Linear volume the renderer applies (SfxTrack `volume`). */
  volume: number;
  /** Phase SFX-3D: channels of the source file when known (built-ins: 1). The renderer compensates a mono source's -3.01 dB upmix, so `volume` is what plays. */
  sourceChannels?: 1 | 2;
  /** Where the sound peaks relative to the measured voice (LU). The number that proves the voice-first rule. */
  peakVsVoiceLu: number;
  clampedToVoiceCeiling: boolean;
  anchor: {ref: string; at: string; timeSec: number; source: string};
  alignment: {mode: 'transient' | 'start'; transientOffsetSec: number; transientSource: string; frameErrorMs: number};
  trimmedAtCompositionEnd: boolean;
  /** Phase SFX-2: present only under the plan's `sfxTiming` (speech_safe): the family window used and how far the sound was moved from its anchor. */
  placement?: {
    policy: 'speech_safe' | 'speech_hybrid' | 'speech_pause_preonset';
    family: string;
    level: 'subtle' | 'normal' | 'featured';
    /** Frame the legacy rule would have used (transient on the anchor); `startFrame` above is the final frame. */
    originalStartFrame: number;
    shiftFrames: number;
    shiftSec: number;
    speechMarginSec: number;
    /** The measured file duration the decision used (no truncation under these policies). */
    audibleDurationSec: number;
    /** True only for a speech_hybrid short subtle transient placed under speech. */
    overlapsSpeech: boolean;
    /** speech_pause_preonset only: which tier placed it (speech_clear, acoustic_pause or pre_onset). */
    tier?: 'speech_clear' | 'acoustic_pause' | 'pre_onset' | 'onset_accent';
  };
};

export type DroppedElement = {ref: string; reason: string; detail: string};

export type AudioTimeline = {
  version: typeof AUDIO_TIMELINE_VERSION;
  planHash: string;
  timingHash: string;
  visualContentHash: string;
  eventSheetVersion: number;
  fps: number;
  durationSec: number;
  durationFrames: number;
  /** Phase SFX-3D: never an assumed level. 'no_voice_reference' = the voice track is established as absent (the existing reference level is used); 'unavailable' = measurement failed or invalid. */
  voice: {voLufs: number; source: 'measured' | 'no_voice_reference'} | {voLufs: null; source: 'unavailable'};
  music: TimelineMusic | null;
  sfx: TimelineSfx[];
  dropped: DroppedElement[];
  warnings: string[];
};

/** remotion/src/audio/placementGain.ts placementGainAt, for the timeline's own evaluation (parity-tested against the renderer). */
export function endFadeGainAt(timeSec: number, endSec: number, fadeSec: number): number {
  const fade = Math.max(0.001, fadeSec);
  if (timeSec >= endSec) return 0;
  const fadeStart = endSec - fade;
  if (timeSec <= fadeStart) return 1;
  return Math.min(1, Math.max(0, (endSec - timeSec) / fade));
}

/** Piecewise-linear evaluation of keyframes (held flat before the first and after the last). Empty = 1. */
export function automationGainAt(keyframes: readonly GainKeyframe[], timeSec: number): number {
  if (keyframes.length === 0) return 1;
  if (timeSec <= keyframes[0]!.timeSec) return keyframes[0]!.gain;
  for (let i = 1; i < keyframes.length; i += 1) {
    const b = keyframes[i]!;
    if (timeSec <= b.timeSec) {
      const a = keyframes[i - 1]!;
      const span = b.timeSec - a.timeSec;
      return span <= 0 ? b.gain : a.gain + ((b.gain - a.gain) * (timeSec - a.timeSec)) / span;
    }
  }
  return keyframes[keyframes.length - 1]!.gain;
}

/** The bed's linear gain at a video second, as the timeline defines it. */
export function musicGainAt(music: TimelineMusic, timeSec: number): number {
  if (timeSec < music.startSec || timeSec >= music.endSec) return 0;
  return duckLinearGainAt(music.duck, timeSec) * endFadeGainAt(timeSec, music.endSec, music.endFadeSec) * automationGainAt(music.automation, timeSec);
}
