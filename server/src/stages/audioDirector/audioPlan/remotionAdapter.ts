/**
 * Execution boundary: AudioTimeline -> blueprint.audioDesign, the contract the renderer plays
 * (remotion/src/components/MusicBedTrack.tsx, remotion/src/components/SfxTrack.tsx, mounted in ShortVideo.tsx). Nothing calls this from production.
 *
 * Music lowers to the existing placed-bed fields (offset, end, end fade, loop, duck, carved twin). Phase 1.4 adds `audioDesign.musicTimeline`
 * (remotion/src/audio/musicTimeline.ts) for what those fields cannot say:
 *   late entry      musicTimeline.startFrame > 0
 *   fade-in         musicTimeline.automation
 *   section levels  musicTimeline.automation
 * `musicTimeline` is written ONLY when one of these is used, so a timeline that needs none of them lowers to exactly the Phase 1.3 fields and plays
 * through MusicBedTrack's existing branch.
 *
 * WIRING (see PHASE_1_4_IMPLEMENTATION_REPORT.md): MusicBedTrack reads the timeline from its `timeline` prop. ShortVideo.tsx, which builds the
 * MusicBedTrack props, is one of the protected pre-existing modified files and does not pass it yet. Until that one line is approved and added,
 * a lowered `musicTimeline` is carried on the blueprint but not played.
 *
 * SFX: one <Audio> per hit (start frame round(at * fps), flat volume, length durationSec, a built-in kind or a `src` file). Always lower.
 */

import type {AudioDesign} from '../../../types/blueprint.ts';
import type {AudioTimeline} from './timeline.ts';

/** Server-side copy of remotion/src/audio/musicTimeline.ts MusicTimelineSpec (the server cannot import Remotion code; parity-tested). */
export type MusicTimelineSpec = {version: 1; startFrame: number; automation: Array<{timeSec: number; gain: number}>};

/** The lowered audioDesign: the existing server type plus the optional timeline the Remotion schema of this phase adds. */
export type LoweredAudioDesign = AudioDesign & {musicTimeline?: MusicTimelineSpec};

export type UnsupportedFeature = {feature: 'invalid_music_timeline'; detail: string};

export type LoweringResult =
  | {ok: true; audioDesign: LoweredAudioDesign; usesMusicTimeline: boolean}
  | {ok: false; unsupported: UnsupportedFeature[]};

/** The renderer's hit kinds (remotion/src/blueprintSchema.ts audioDesign.hits[].kind). A file hit still needs one; `src` decides what plays. */
const FILE_HIT_KIND = 'hit' as const;

/** The timeline part the renderer needs beyond the placed-bed fields, or null when none is needed. */
export function musicTimelineFor(timeline: AudioTimeline): MusicTimelineSpec | null {
  const music = timeline.music;
  if (!music) return null;
  if (music.startFrame === 0 && music.automation.length === 0) return null;
  return {version: 1, startFrame: music.startFrame, automation: music.automation.map(keyframe => ({timeSec: keyframe.timeSec, gain: keyframe.gain}))};
}

/**
 * What the renderer would refuse. The compiler never produces these; the check exists so the adapter can never hand the renderer data its validator
 * (remotion/src/audio/musicTimeline.ts checkMusicTimeline) rejects, which would silence the bed.
 */
export function unsupportedFeatures(timeline: AudioTimeline): UnsupportedFeature[] {
  const spec = musicTimelineFor(timeline);
  if (!spec) return [];
  const out: UnsupportedFeature[] = [];
  if (!Number.isInteger(spec.startFrame) || spec.startFrame < 0) out.push({feature: 'invalid_music_timeline', detail: `startFrame ${spec.startFrame}`});
  spec.automation.forEach((keyframe, index) => {
    if (!Number.isFinite(keyframe.timeSec) || keyframe.timeSec < 0) out.push({feature: 'invalid_music_timeline', detail: `automation[${index}].timeSec ${keyframe.timeSec}`});
    if (!(keyframe.gain >= 0 && keyframe.gain <= 1)) out.push({feature: 'invalid_music_timeline', detail: `automation[${index}].gain ${keyframe.gain}`});
    if (index > 0 && keyframe.timeSec <= spec.automation[index - 1]!.timeSec) out.push({feature: 'invalid_music_timeline', detail: `automation[${index}] is not after the previous keyframe`});
  });
  return out;
}

export function toRemotionAudioDesign(timeline: AudioTimeline): LoweringResult {
  const unsupported = unsupportedFeatures(timeline);
  if (unsupported.length > 0) return {ok: false, unsupported};
  const hits = timeline.sfx.map(sfx => ({
    at: sfx.startSec,
    kind: sfx.builtin ?? FILE_HIT_KIND,
    volume: sfx.volume,
    reason: `audio_plan:${sfx.id}`,
    ...(sfx.src ? {src: sfx.src} : {}),
    durationSec: sfx.durationSec,
    // Phase SFX-3D: lets the renderer compensate a mono source's upmix (remotion/src/lib/sfxPlaybackVolume.ts). Omitted when unknown.
    ...(sfx.sourceChannels !== undefined ? {sourceChannels: sfx.sourceChannels} : {}),
  }));
  const base: LoweredAudioDesign = {ducking: true, sfx: [], hits};
  const music = timeline.music;
  if (!music) return {ok: true, audioDesign: base, usesMusicTimeline: false};
  const musicTimeline = musicTimelineFor(timeline);
  return {
    ok: true,
    usesMusicTimeline: musicTimeline !== null,
    audioDesign: {
      ...base,
      musicUrl: music.url,
      musicSource: music.source,
      musicFullUrl: music.fullUrl,
      musicFullDurationSec: music.fullDurationSec,
      ...(music.loopUrl ? {musicLoopUrl: music.loopUrl} : {}),
      ...(music.carvedUrl ? {musicCarvedUrl: music.carvedUrl} : {}),
      ...(music.bpm !== null ? {musicBpm: music.bpm} : {}),
      // Placed-bed fields: any of these present selects MusicBedTrack's placed branch (or, with a timeline, the timeline branch).
      musicStartOffsetSec: music.sourceOffsetSec,
      musicEndSec: music.endSec,
      musicEndFadeSec: music.endFadeSec,
      musicEndType: music.endType,
      ...(music.loopFromSec !== null ? {musicLoopFromSec: music.loopFromSec} : {}),
      ...(music.placement.score !== null ? {musicPlacementScore: music.placement.score} : {}),
      duck: music.duck,
      ...(timeline.voice.voLufs !== null ? {voLufs: timeline.voice.voLufs} : {}),
      ...(musicTimeline ? {musicTimeline} : {}),
      // Phase SFX-3H: a generated bed's duck uses its measured integrated loudness (the compiler only builds one from a measured value, SFX-3G);
      // recorded as provenance so the render boundary (stages/render/renderSafety.ts) can trust it.
      ...(music.source === 'generated' && typeof music.duck.bedLufs === 'number' && Number.isFinite(music.duck.bedLufs)
        ? {musicProvenance: {source: 'generated' as const, bedLoudness: {status: 'measured' as const, lufs: music.duck.bedLufs}}}
        : {}),
    },
  };
}
