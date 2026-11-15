/**
 * Phase SFX-3D: BGM fail-safes. Pure; no I/O.
 *
 * Two inputs decide how loud the bed may be under a talking video: WHERE the speech is (the transcript) and HOW LOUD the voice is (the measured
 * speech-gated LUFS). Before this module, a missing transcript arrived as an empty word list, which buildDuckEnvelope turns into zero phrases, which
 * the renderer plays at the OPEN level for the whole video (the loudest designed state); and a failed voice measurement was replaced by the assumed
 * -20 LUFS (VO_LUFS_ASSUMED), which sets the bed too loud for any quieter speaker. Both failures made the music LOUDER.
 *
 * Here every input has an explicit state, a failure is never read as "no speech" or as a voice level, and the decision only ever falls toward
 * quieter music:
 *
 *   voice \ transcript      speech                confirmed_no_speech        unavailable / untrusted
 *   measured                duck (existing)       no-speech policy (open)    hold at the SPEECH level for the whole video
 *   confirmed_no_voice      mute (inconsistent)   no-voice policy            no-voice policy (no voice to protect) / mute if untrusted words
 *   failed / invalid        mute                  mute                       mute
 *
 * The existing levels (TALKING_OFFSETS_LU -18 / -9 / -4) and the duck curve are unchanged; nothing here makes the bed louder than the existing
 * envelope would for the same valid inputs.
 */

import {buildDuckEnvelope, VO_LUFS_ASSUMED, type DuckEnvelope, type DuckPresetName} from './duckEnvelope.ts';

/** A word longer than this is not trusted as one word (alignment drift). Same value as audioDirector/audioPlan/sfxSafety.ts MAX_PLAUSIBLE_WORD_SEC. */
export const MAX_PLAUSIBLE_WORD_SEC = 3;
/** Plausible speech-gated loudness of a real voice track. Outside this range a "measurement" is treated as invalid, never as a voice level. */
export const VOICE_LUFS_RANGE = Object.freeze({min: -70, max: 0});

/**
 * Phase SFX-3G: a bed's integrated loudness is usable only when it is a finite number in this range (the same plausibility bound as a voice).
 * Not a loudness target: anything outside it is a broken measurement, never a level to duck against.
 */
export const BED_LUFS_RANGE = VOICE_LUFS_RANGE;

export type BedLoudnessState = {status: 'measured'; lufs: number} | {status: 'missing'} | {status: 'invalid'; reason: string};

/** The bed's measured integrated loudness. Missing or invalid is NEVER replaced by BED_LUFS_ASSUMED (-16): the bed is withheld instead. */
export function classifyBedLoudness(value: unknown): BedLoudnessState {
  if (value === undefined || value === null) return {status: 'missing'};
  if (typeof value !== 'number' || !Number.isFinite(value)) return {status: 'invalid', reason: `not a finite number: ${String(value)}`};
  if (value < BED_LUFS_RANGE.min || value > BED_LUFS_RANGE.max) return {status: 'invalid', reason: `${value} LUFS is outside ${BED_LUFS_RANGE.min}..${BED_LUFS_RANGE.max}`};
  return {status: 'measured', lufs: value};
}

export type TranscriptState =
  | {status: 'speech'}
  | {status: 'confirmed_no_speech'}
  | {status: 'unavailable'; reason: 'missing' | 'failed' | 'malformed' | 'empty_without_confirmation'}
  | {status: 'untrusted'; reason: string};

export type VoiceLoudnessState =
  | {status: 'measured'; lufs: number}
  | {status: 'confirmed_no_voice'}
  | {status: 'measurement_failed'}
  | {status: 'invalid'; reason: string};

type WordLike = {start: number; end: number | null};

/**
 * `analysis`: what the transcription step reported. 'succeeded' is the only state in which an empty word list means "no speech".
 * 'unknown' (the caller cannot say) never confirms absence.
 */
export function classifyTranscript(input: {words: unknown; analysis: 'succeeded' | 'failed' | 'unknown'; durationSec?: number}): TranscriptState {
  if (input.analysis === 'failed') return {status: 'unavailable', reason: 'failed'};
  if (input.words === undefined || input.words === null) return {status: 'unavailable', reason: 'missing'};
  if (!Array.isArray(input.words)) return {status: 'unavailable', reason: 'malformed'};
  const words = input.words as unknown[];
  if (words.length === 0) return input.analysis === 'succeeded' ? {status: 'confirmed_no_speech'} : {status: 'unavailable', reason: 'empty_without_confirmation'};
  for (const word of words) {
    if (typeof word !== 'object' || word === null) return {status: 'unavailable', reason: 'malformed'};
    const {start, end} = word as {start?: unknown; end?: unknown};
    if (typeof start !== 'number' || (end !== null && typeof end !== 'number')) return {status: 'unavailable', reason: 'malformed'};
  }
  const typed = words as WordLike[];
  for (let i = 0; i < typed.length; i += 1) {
    const {start, end} = typed[i]!;
    if (!Number.isFinite(start) || start < 0) return {status: 'untrusted', reason: `word ${i}: start ${start}`};
    // A word without an end time is tolerated (the duck drops that one word, as before); an end that is present must be valid.
    if (end === null) continue;
    if (!Number.isFinite(end) || end <= start) return {status: 'untrusted', reason: `word ${i}: end ${end} for start ${start}`};
    if (end - start > MAX_PLAUSIBLE_WORD_SEC) return {status: 'untrusted', reason: `word ${i}: ${Math.round((end - start) * 100) / 100}s is longer than ${MAX_PLAUSIBLE_WORD_SEC}s`};
    if (input.durationSec !== undefined && start > input.durationSec + 0.5) return {status: 'untrusted', reason: `word ${i}: starts at ${start}s, after the ${input.durationSec}s video`};
  }
  return {status: 'speech'};
}

/**
 * `voiceTrack`: 'absent' only when the absence is established (e.g. the probe found no audio stream). 'unknown' never confirms absence.
 * `measured`: the speech-gated LUFS, or null/undefined when the measurement did not produce a value.
 */
export function classifyVoiceLoudness(input: {measured: unknown; voiceTrack: 'present' | 'absent' | 'unknown'}): VoiceLoudnessState {
  if (input.voiceTrack === 'absent') return {status: 'confirmed_no_voice'};
  if (input.measured === undefined || input.measured === null) return {status: 'measurement_failed'};
  if (typeof input.measured !== 'number' || !Number.isFinite(input.measured)) return {status: 'invalid', reason: `not a finite number: ${String(input.measured)}`};
  if (input.measured < VOICE_LUFS_RANGE.min || input.measured > VOICE_LUFS_RANGE.max) return {status: 'invalid', reason: `${input.measured} LUFS is outside ${VOICE_LUFS_RANGE.min}..${VOICE_LUFS_RANGE.max}`};
  return {status: 'measured', lufs: input.measured};
}

export type BedDecision =
  /** Valid speech and a measured voice: the existing envelope, unchanged. */
  | {action: 'duck'; basis: 'speech_and_measured_voice'; voLufs: number; envelope: DuckEnvelope}
  /** Analysis succeeded and found no speech: the existing no-speech behaviour (no phrases, the open level relative to the measured voice). */
  | {action: 'duck'; basis: 'confirmed_no_speech'; voLufs: number; envelope: DuckEnvelope}
  /** No voice track (established): nothing to protect; the existing reference level is used as the absolute reference, as before. */
  | {action: 'duck'; basis: 'confirmed_no_voice'; voLufs: number; envelope: DuckEnvelope}
  /** Voice measured but speech timing unknown: the bed is held at the SPEECH level for the whole video (never pause or open). */
  | {action: 'duck'; basis: 'speech_timing_unknown_hold_speech_level'; voLufs: number; envelope: DuckEnvelope; transcript: TranscriptState}
  /**
   * Phase SFX-3E: an absolute preset ('default' / 'legacy_brief': fixed gains, no voice involved). The voice is not consulted; the transcript rule
   * still applies (speech: the existing envelope; confirmed no speech: no phrases; unavailable or untrusted: held at the preset's speech gain).
   */
  | {action: 'duck'; basis: 'absolute_preset_speech' | 'absolute_preset_no_speech' | 'absolute_preset_speech_timing_unknown_hold_speech_level'; voLufs: null; envelope: DuckEnvelope}
  /** The bed cannot be levelled safely: no music. */
  | {action: 'mute'; reason: 'voice_loudness_unknown' | 'voice_absent_but_speech_present' | 'voice_absent_but_untrusted_words' | 'bed_loudness_unknown'; voice: VoiceLoudnessState; transcript: TranscriptState; bed?: BedLoudnessState};

export type BedDecisionInput = {
  transcript: TranscriptState;
  voice: VoiceLoudnessState;
  /** Output-time words; used only when transcript.status is 'speech'. */
  words: ReadonlyArray<{start: number; end: number}>;
  durationSec: number;
  preset?: DuckPresetName;
  /**
   * The bed's measured integrated loudness. Phase SFX-3G: REQUIRED in effect: missing, null, non-finite, non-numeric or out-of-range withholds
   * the bed (mute 'bed_loudness_unknown'); it is never replaced by BED_LUFS_ASSUMED.
   */
  bedLufs?: unknown;
  /** Voice-relative offsets (LU) for the talking preset. Absent = TALKING_OFFSETS_LU (-18 / -9 / -4), exactly as before. */
  offsets?: {speech: number; pause: number; open: number};
  holdSec?: number;
  releaseSec?: number;
  leadSec?: number;
};

export type BedMuteReason = Extract<BedDecision, {action: 'mute'}>['reason'];

/** The mute rule alone (it never depends on the bed asset): null = the bed can be levelled safely. */
export function bedMuteReason(transcript: TranscriptState, voice: VoiceLoudnessState): BedMuteReason | null {
  if (voice.status === 'measurement_failed' || voice.status === 'invalid') return 'voice_loudness_unknown';
  if (voice.status === 'confirmed_no_voice' && transcript.status === 'speech') return 'voice_absent_but_speech_present';
  if (voice.status === 'confirmed_no_voice' && transcript.status === 'untrusted') return 'voice_absent_but_untrusted_words';
  return null;
}

/** The reference level for voice-relative SFX and bed levels, or null when the voice level is unknown (then nothing voice-relative may be levelled). */
export function voiceReferenceLufs(voice: VoiceLoudnessState): {voLufs: number; source: 'measured' | 'no_voice_reference'} | null {
  if (voice.status === 'measured') return {voLufs: voice.lufs, source: 'measured'};
  if (voice.status === 'confirmed_no_voice') return {voLufs: VO_LUFS_ASSUMED, source: 'no_voice_reference'};
  return null;
}

export function decideBedLevel(input: BedDecisionInput): BedDecision {
  const {transcript, voice} = input;
  const bed = classifyBedLoudness(input.bedLufs);
  const options = {
    durationSec: input.durationSec,
    ...(input.preset !== undefined ? {preset: input.preset} : {}),
    ...(bed.status === 'measured' ? {bedLufs: bed.lufs} : {}),
    ...(input.offsets ? {speechOffsetLu: input.offsets.speech, pauseOffsetLu: input.offsets.pause, openOffsetLu: input.offsets.open} : {}),
    ...(input.holdSec !== undefined ? {holdSec: input.holdSec} : {}),
    ...(input.releaseSec !== undefined ? {releaseSec: input.releaseSec} : {}),
    ...(input.leadSec !== undefined ? {leadSec: input.leadSec} : {}),
  };
  const holdWholeVideo = [{start: 0, end: Math.max(input.durationSec, 1e-3)}];
  // Phase SFX-3G: a bed of unknown loudness is withheld (after the voice rules, so a voice failure keeps its own reason and drops the SFX).
  const bedUnknown = bed.status !== 'measured';
  if ((input.preset ?? 'talking') !== 'talking') {
    if (bedUnknown) return {action: 'mute', reason: 'bed_loudness_unknown', voice, transcript, bed};
    if (transcript.status === 'speech') return {action: 'duck', basis: 'absolute_preset_speech', voLufs: null, envelope: buildDuckEnvelope({...options, words: input.words})};
    if (transcript.status === 'confirmed_no_speech') return {action: 'duck', basis: 'absolute_preset_no_speech', voLufs: null, envelope: buildDuckEnvelope({...options, words: []})};
    return {action: 'duck', basis: 'absolute_preset_speech_timing_unknown_hold_speech_level', voLufs: null, envelope: buildDuckEnvelope({...options, words: holdWholeVideo})};
  }
  const mute = bedMuteReason(transcript, voice);
  if (mute) return {action: 'mute', reason: mute, voice, transcript};
  if (bedUnknown) return {action: 'mute', reason: 'bed_loudness_unknown', voice, transcript, bed};
  if (voice.status === 'confirmed_no_voice') {
    return {action: 'duck', basis: 'confirmed_no_voice', voLufs: VO_LUFS_ASSUMED, envelope: buildDuckEnvelope({...options, words: [], voLufs: VO_LUFS_ASSUMED})};
  }
  const voLufs = (voice as Extract<VoiceLoudnessState, {status: 'measured'}>).lufs;
  if (transcript.status === 'speech') return {action: 'duck', basis: 'speech_and_measured_voice', voLufs, envelope: buildDuckEnvelope({...options, words: input.words, voLufs})};
  if (transcript.status === 'confirmed_no_speech') return {action: 'duck', basis: 'confirmed_no_speech', voLufs, envelope: buildDuckEnvelope({...options, words: [], voLufs})};
  // Unknown speech timing: one phrase over the whole video. The renderer (remotion/src/audio/duckEnvelope.ts regionDb) then plays the speech level
  // from 0 to the end; it never reaches the pause or open level, so the bed is never louder than it would be under speech.
  const envelope = buildDuckEnvelope({...options, words: holdWholeVideo, voLufs});
  return {action: 'duck', basis: 'speech_timing_unknown_hold_speech_level', voLufs, envelope, transcript};
}
