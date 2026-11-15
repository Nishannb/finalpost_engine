/**
 * Optional music timeline (AI Music Director, Phase 1.4). Pure: no React, no Remotion imports.
 *
 * Data-gated: it is read only when `audioDesign.musicTimeline` is present, which only the AudioTimeline adapter
 * (server/src/stages/audioDirector/audioPlan/remotionAdapter.ts) writes. Every existing blueprint lacks it, and MusicBedTrack then takes its
 * existing branches unchanged.
 *
 * It adds exactly two things to a placed bed; everything else keeps its existing field and meaning:
 *   startFrame   the composition frame the bed enters (late entry). The bed file position heard there is `musicStartOffsetSec`.
 *   automation   linear gain keyframes in VIDEO seconds (fade-in, section levels). Every gain is in [0, 1]: it can only lower the bed.
 * Conventions are the existing ones: placement in whole composition frames, gains evaluated at `frame / fps` seconds (as the duck envelope and
 * placementGainAt already are).
 *
 * Gain of the bed at composition frame f (t = f / fps):
 *   0                                              f < startFrame
 *   duck(t) x placementGainAt(t, end, fade) x automation(t)   otherwise
 * where duck(t) is the existing envelope (or the legacy gate without one) and placementGainAt is the existing end fade. Each factor is applied once.
 */

export const MUSIC_TIMELINE_VERSION = 1 as const;

export type MusicTimelineKeyframe = {timeSec: number; gain: number};

export type MusicTimelineSpec = {
  version: typeof MUSIC_TIMELINE_VERSION;
  /** Composition frame the bed enters. 0 = from the first frame. */
  startFrame: number;
  /** Strictly increasing timeSec, gains in [0, 1]. Empty = constant 1. Held flat before the first and after the last keyframe. */
  automation: MusicTimelineKeyframe[];
};

export type MusicTimelineCheck = {ok: true; spec: MusicTimelineSpec} | {ok: false; reason: string};

/** Validates untrusted data. An invalid timeline is never "repaired": MusicBedTrack then draws no bed (silence is the voice-first failure mode). */
export function checkMusicTimeline(raw: unknown): MusicTimelineCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {ok: false, reason: 'not an object'};
  const value = raw as {version?: unknown; startFrame?: unknown; automation?: unknown};
  if (value.version !== MUSIC_TIMELINE_VERSION) return {ok: false, reason: `unsupported version ${String(value.version)}`};
  if (typeof value.startFrame !== 'number' || !Number.isInteger(value.startFrame) || value.startFrame < 0) return {ok: false, reason: 'startFrame must be an integer >= 0'};
  if (!Array.isArray(value.automation)) return {ok: false, reason: 'automation must be an array'};
  let previous = Number.NEGATIVE_INFINITY;
  for (const [index, keyframe] of value.automation.entries()) {
    const k = keyframe as {timeSec?: unknown; gain?: unknown};
    if (typeof k?.timeSec !== 'number' || !Number.isFinite(k.timeSec) || k.timeSec < 0) return {ok: false, reason: `automation[${index}].timeSec must be a finite number >= 0`};
    if (typeof k.gain !== 'number' || !Number.isFinite(k.gain) || k.gain < 0 || k.gain > 1) return {ok: false, reason: `automation[${index}].gain must be in [0, 1]`};
    if (k.timeSec <= previous) return {ok: false, reason: `automation[${index}] is not after the previous keyframe`};
    previous = k.timeSec;
  }
  return {ok: true, spec: {version: MUSIC_TIMELINE_VERSION, startFrame: value.startFrame, automation: value.automation as MusicTimelineKeyframe[]}};
}

/** Piecewise-linear automation gain at a video second. */
export function automationGainAt(automation: readonly MusicTimelineKeyframe[], timeSec: number): number {
  if (automation.length === 0) return 1;
  if (timeSec <= automation[0]!.timeSec) return automation[0]!.gain;
  for (let i = 1; i < automation.length; i += 1) {
    const b = automation[i]!;
    if (timeSec <= b.timeSec) {
      const a = automation[i - 1]!;
      return a.gain + ((b.gain - a.gain) * (timeSec - a.timeSec)) / (b.timeSec - a.timeSec);
    }
  }
  return automation[automation.length - 1]!.gain;
}

/**
 * Which <Audio> clips the timeline branch mounts, in composition frames. Pure, so the frame arithmetic is tested without React.
 *  head   the full bed from `startFrame`, read from `startFromFrames` (the existing offset rule: round(musicStartOffsetSec * fps)), until the loop
 *         hand-off or the composition end.
 *  loop   the loop body from the hand-off frame (the existing rule: max(1, round(musicLoopFromSec * fps))), never before the head starts.
 */
export type MusicTimelineClips = {
  head: {from: number; durationInFrames: number; startFromFrames: number} | null;
  loop: {from: number; durationInFrames: number} | null;
};

export function musicTimelineClips(input: {
  spec: MusicTimelineSpec;
  fps: number;
  durationInFrames: number;
  musicStartOffsetSec: number | undefined;
  musicLoopFromSec: number | undefined;
  hasLoopFile: boolean;
}): MusicTimelineClips {
  const {spec, fps, durationInFrames} = input;
  if (spec.startFrame >= durationInFrames) return {head: null, loop: null};
  const startFromFrames = Math.max(0, Math.round((input.musicStartOffsetSec ?? 0) * fps));
  const loopFrom = input.musicLoopFromSec !== undefined && input.hasLoopFile ? Math.max(spec.startFrame + 1, Math.max(1, Math.round(input.musicLoopFromSec * fps))) : null;
  const headEnd = loopFrom !== null ? Math.min(loopFrom, durationInFrames) : durationInFrames;
  return {
    head: {from: spec.startFrame, durationInFrames: Math.max(1, headEnd - spec.startFrame), startFromFrames},
    loop: loopFrom !== null && loopFrom < durationInFrames ? {from: loopFrom, durationInFrames: durationInFrames - loopFrom} : null,
  };
}

/**
 * The bed's gain at a composition frame. `baseGainAt` is the existing per-time gain (the duck envelope, or the legacy gate) and `endGainAt` the existing
 * end fade (placementGainAt); MusicBedTrack passes its own functions, so no curve is re-implemented here.
 */
export function musicTimelineGainAt(input: {
  spec: MusicTimelineSpec;
  frame: number;
  fps: number;
  baseGainAt: (timeSec: number) => number;
  endGainAt: (timeSec: number) => number;
}): number {
  if (input.frame < input.spec.startFrame) return 0;
  const t = input.frame / input.fps;
  return input.baseGainAt(t) * input.endGainAt(t) * automationGainAt(input.spec.automation, t);
}
