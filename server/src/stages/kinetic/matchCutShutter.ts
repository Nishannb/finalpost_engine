/**
 * MATCH CUT SHUTTER (V1): the camera-shutter treatment of the existing Match Cut, and its synchronized sound.
 *
 * Eligibility is NOT decided here: stages/kinetic/matchCut.ts still owns it (four legal moments, one per plan, 20 s apart). This module only
 *   1. marks the already-accepted type.matchCut events `shutter: true` (the compositor then cuts on the click grid and adds directional motion blur), and
 *   2. places `remotion/public/sfx/matchcut.mp3` at each such event's FIRST FRAME, so every Match Cut has its sound and nothing else does.
 *
 * The asset (supplied, never edited): 1.09 s, mono, 48 kHz, 11 shutter clicks 100 ms apart. Measured with ffmpeg on the decoded file (scripts in docs/mobile-integration):
 *   click k attack (>= 10 % of peak) at 15 + 100 k ms, peak at 55 + 100 k ms, k = 0..10; last click peak 1055 ms.
 * One scene per click; cut k is at frame round(k * 100 ms * fps) (remotion/src/lib/textMatchCut.ts shutterCutFrame), computed from absolute time so it never drifts (24 fps: 100 ms = 2.4 frames).
 * LATENCY: measured in a rendered 24 fps MP4 (render with the hit minus render without it, so exactly what the shutter contributed to the mix), the sound arrives MATCHCUT_RENDER_LATENCY_SEC after the frame
 * it is placed on: the MP3's 23 ms encoder priming plus what the renderer's decode / mix adds. The hit is therefore placed `shutterLeadFrames(fps)` whole frames EARLIER (the renderer places audio on whole frames only),
 * so the click lands on its cut instead of about 1.7 frames after it. The number is re-measured in the proof report, never assumed.
 *
 * Voice first (docs/audio/VOICE_FIRST.md): the hit is leveled from a measured voice loudness at the SFX policy offset (default -10 LU, never closer than -6 LU), and is DROPPED when
 * the voice cannot be measured. A match cut deliberately covers the keyword's onset (the cut lands 2 frames before the word), so the report carries the overlap count and the level offset.
 */
import {catalogVolume, sfxVoiceOffsetLu} from '../../lib/sfxCatalog.ts';
import type {RenderSpec} from './schema.ts';

export const MATCHCUT_AUDIO = {
  /** Remotion `staticFile` reference of the supplied asset (remotion/public/sfx/matchcut.mp3). */
  src: 'staticFile:sfx/matchcut.mp3',
  durationSec: 1.09,
  channels: 1 as const,
  clickCount: 11,
  clickPeriodSec: 0.1,
  /** first click: attack (10 % of peak) and peak, seconds into the decoded file */
  firstClickOnsetSec: 0.015,
  firstClickPeakSec: 0.055,
} as const;

export const MATCHCUT_HIT_REASON = 'match_cut_shutter';

/** Measured start error of the sound in a rendered MP4 (envelope cross-correlation, 24 fps proof render): +43.3 ms. Includes the MP3's 23 ms priming. */
export const MATCHCUT_RENDER_LATENCY_SEC = 0.043;
/** Whole frames the sound is started early to cancel that latency (the renderer places audio on whole frames). 24 fps: 1, 30 fps: 1, 60 fps: 3. */
export const shutterLeadFrames = (fps: number): number => Math.round(MATCHCUT_RENDER_LATENCY_SEC * fps);

export type ShutterHit = {at: number; kind: 'hit'; volume: number; reason: string; src: string; durationSec: number; sourceChannels: 1};

const isMatchCut = (e: {presetResolved: string}) => e.presetResolved === 'type.matchCut';

/** The spec with every accepted type.matchCut event marked for the shutter treatment. Nothing else in the spec changes. */
export function applyMatchCutShutter(spec: RenderSpec): RenderSpec {
  if (!spec.events.some(e => isMatchCut(e) && e.matchCut)) return spec;
  return {...spec, events: spec.events.map(e => (isMatchCut(e) && e.matchCut ? {...e, matchCut: {...e.matchCut, shutter: true}} : e))};
}

/**
 * How many times the 1.09 s sound must start to cover a visual of `visualSec`, and where. The start of repeat r is computed from the ABSOLUTE time `at + r * durationSec`
 * (rounded to a frame by the renderer), never from the previous repeat's rounded start, so frame rounding cannot accumulate: the error of any repeat is at most half a frame.
 */
export function shutterRepeatStarts(atSec: number, visualSec: number): number[] {
  const repeats = Math.max(1, Math.ceil((visualSec - 1e-6) / MATCHCUT_AUDIO.durationSec));
  return Array.from({length: repeats}, (_, r) => Math.round((atSec + r * MATCHCUT_AUDIO.durationSec) * 1e6) / 1e6);
}

/** Length of the cut-and-motion burst of the shutter treatment: the last click's cut plus the entry motion that follows it (the landing then holds still). */
export const shutterBurstSec = (entrySec = 0.05): number => (MATCHCUT_AUDIO.clickCount - 1) * MATCHCUT_AUDIO.clickPeriodSec + entrySec;

/** Is `startSec` inside a spoken word, or within SPEECH_GUARD_SEC before one starts? */
export const SPEECH_GUARD_SEC = 0.12;
export const speechConflict = (startSec: number, wordSpansSec: ReadonlyArray<readonly [number, number]>): boolean =>
  wordSpansSec.some(([from, to]) => startSec >= from - SPEECH_GUARD_SEC - 1e-9 && startSec <= to + 1e-9);

export type ShutterAudioReport = {
  matchCuts: number;
  hits: number;
  /** the loudest shutter peak relative to the voice, LU. Must be <= -6 (voice-first). Null when no hit was placed. */
  peakVsVoiceLu: number | null;
  /** hits that start over speech (always 0 now: such a sound is omitted, see `omittedForSpeech`) */
  hitsOverWordOnset: number;
  /** Match Cuts whose shutter sound was OMITTED because it would start inside a spoken word or within 120 ms before one. The visual Match Cut stays. */
  omittedForSpeech: number;
  voLufs: number | null;
  dropped: 'voice_loudness_unknown' | null;
};

/**
 * One sound per Match Cut event, at the event's first frame minus the measured render latency in whole frames (spec time = output time). `voLufs` null = the voice was not measured: no hit (silent shutter is better than an unleveled one).
 */
export function matchCutShutterHits(spec: RenderSpec, opts: {voLufs: number | null; wordOnsetsSec: readonly number[]; /** spoken words as [start, end] seconds on the output timeline; when given, the speech-protection rule applies */ wordSpansSec?: ReadonlyArray<readonly [number, number]>; offsetLu?: number; gainDb?: number}): {hits: ShutterHit[]; report: ShutterAudioReport} {
  const events = spec.events.filter(e => isMatchCut(e) && e.matchCut?.shutter);
  const report: ShutterAudioReport = {matchCuts: events.length, hits: 0, peakVsVoiceLu: null, hitsOverWordOnset: 0, omittedForSpeech: 0, voLufs: opts.voLufs, dropped: null};
  if (events.length === 0) return {hits: [], report};
  if (opts.voLufs === null || !Number.isFinite(opts.voLufs)) return {hits: [], report: {...report, dropped: 'voice_loudness_unknown'}};
  const offsetLu = opts.offsetLu ?? sfxVoiceOffsetLu();
  const level = catalogVolume(opts.voLufs, offsetLu, opts.gainDb ?? 0);
  const hits: ShutterHit[] = [];
  for (const e of events) {
    const at = Math.max(0, e.inFrame - shutterLeadFrames(spec.fps)) / spec.fps;
    // the visual burst never outlasts the 1.09 s sound by design (11 cuts x 100 ms); repeats exist for a longer treatment (same rule, no drift)
    for (const start of shutterRepeatStarts(at, shutterBurstSec())) {
      // Speech protection (V1 correction): the sound never starts inside a spoken word or within 120 ms BEFORE one (the existing rule already forbids 120 ms after an onset, and an onset-to-end span covers that).
      // The visual is not moved to fit the sound, and the sound is not moved against its cuts (that would desynchronize the clicks): when speech is in the way the sound is omitted and the Match Cut stays.
      if (opts.wordSpansSec && speechConflict(start, opts.wordSpansSec)) { report.omittedForSpeech += 1; continue; }
      hits.push({at: start, kind: 'hit', volume: level.volume, reason: MATCHCUT_HIT_REASON, src: MATCHCUT_AUDIO.src, durationSec: MATCHCUT_AUDIO.durationSec, sourceChannels: 1});
      if (opts.wordOnsetsSec.some(w => w >= start && w < start + 0.12)) report.hitsOverWordOnset += 1;
    }
  }
  report.hits = hits.length;
  report.peakVsVoiceLu = hits.length > 0 ? Math.round((level.peakDbfs - opts.voLufs) * 100) / 100 : null;
  return {hits, report};
}
