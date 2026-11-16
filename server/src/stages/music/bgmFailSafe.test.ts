/**
 * Phase SFX-3D: BGM fail-safes. A failed transcript is never "no speech", a failed voice measurement is never a voice level, and every failure
 * makes the bed quieter or silent, never louder. The envelopes are evaluated with the RENDERER's own curve (remotion/src/audio/duckEnvelope.ts),
 * and with the compiler (AudioDirector path) end to end. Offline.
 */
import {describe, expect, it} from 'vitest';

import {duckBaseDbAt as rendererDuckDbAt} from '../../../../remotion/src/audio/duckEnvelope';
import {compileAudioPlan, type CompileContext} from '../audioDirector/audioPlan/compile.ts';
import {exampleAssets, examplePlan, exampleSheet} from '../audioDirector/audioPlan/testFixtures.ts';
import type {EditEventSheet} from '../audioDirector/eventSheet/types.ts';
import {bedMuteReason, classifyBedLoudness, classifyTranscript, classifyVoiceLoudness, decideBedLevel, type TranscriptState, type VoiceLoudnessState} from './bgmFailSafe.ts';
import {buildDuckEnvelope, TALKING_OFFSETS_LU, VO_LUFS_ASSUMED, type DuckEnvelope} from './duckEnvelope.ts';

const WORDS = [{start: 0.5, end: 1.2}, {start: 1.3, end: 2.0}, {start: 4.0, end: 5.0}];
const QUIET_VOICE = -28.9;
const BED = -23;
/** Loudest the renderer ever plays this envelope (dB of bed gain), sampled every 10 ms over the video. */
const loudestDb = (envelope: DuckEnvelope, durationSec: number) => {
  let max = -Infinity;
  for (let t = 0; t <= durationSec; t += 0.01) max = Math.max(max, rendererDuckDbAt(envelope as never, t));
  return max;
};
const speechLevelDb = (voLufs: number) => voLufs + TALKING_OFFSETS_LU.speech - BED;

describe('transcript states (classifyTranscript)', () => {
  it('distinguishes speech, confirmed no speech, unavailable and untrusted', () => {
    expect(classifyTranscript({words: WORDS, analysis: 'succeeded'})).toEqual({status: 'speech'});
    expect(classifyTranscript({words: WORDS, analysis: 'unknown'})).toEqual({status: 'speech'});
    expect(classifyTranscript({words: [], analysis: 'succeeded'})).toEqual({status: 'confirmed_no_speech'});
    // the same empty list without a successful analysis is NOT "no speech"
    expect(classifyTranscript({words: [], analysis: 'unknown'})).toEqual({status: 'unavailable', reason: 'empty_without_confirmation'});
    expect(classifyTranscript({words: [], analysis: 'failed'})).toEqual({status: 'unavailable', reason: 'failed'});
    expect(classifyTranscript({words: WORDS, analysis: 'failed'})).toEqual({status: 'unavailable', reason: 'failed'});
    expect(classifyTranscript({words: undefined, analysis: 'succeeded'})).toEqual({status: 'unavailable', reason: 'missing'});
    expect(classifyTranscript({words: null, analysis: 'unknown'})).toEqual({status: 'unavailable', reason: 'missing'});
    expect(classifyTranscript({words: 'w0 w1', analysis: 'succeeded'})).toEqual({status: 'unavailable', reason: 'malformed'});
    expect(classifyTranscript({words: [{start: '0.5', end: 1}], analysis: 'succeeded'})).toEqual({status: 'unavailable', reason: 'malformed'});
    expect(classifyTranscript({words: [{start: 1, end: 0.5}], analysis: 'succeeded'}).status).toBe('untrusted');
    expect(classifyTranscript({words: [{start: Number.NaN, end: 1}], analysis: 'succeeded'}).status).toBe('untrusted');
    expect(classifyTranscript({words: [{start: 1, end: 9}], analysis: 'succeeded'}).status).toBe('untrusted');
    expect(classifyTranscript({words: [{start: 30, end: 31}], analysis: 'succeeded', durationSec: 10}).status).toBe('untrusted');
    // a word without an end time is tolerated (the duck drops that one word, as before)
    expect(classifyTranscript({words: [{start: 0.5, end: null}, {start: 1, end: 1.4}], analysis: 'unknown'})).toEqual({status: 'speech'});
  });
});

describe('voice loudness states (classifyVoiceLoudness)', () => {
  it('distinguishes measured, confirmed no voice, failed and invalid; absence must be established', () => {
    expect(classifyVoiceLoudness({measured: QUIET_VOICE, voiceTrack: 'present'})).toEqual({status: 'measured', lufs: QUIET_VOICE});
    expect(classifyVoiceLoudness({measured: QUIET_VOICE, voiceTrack: 'unknown'})).toEqual({status: 'measured', lufs: QUIET_VOICE});
    expect(classifyVoiceLoudness({measured: undefined, voiceTrack: 'absent'})).toEqual({status: 'confirmed_no_voice'});
    expect(classifyVoiceLoudness({measured: null, voiceTrack: 'present'})).toEqual({status: 'measurement_failed'});
    expect(classifyVoiceLoudness({measured: undefined, voiceTrack: 'unknown'})).toEqual({status: 'measurement_failed'});
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 3, -95, '-20']) expect(classifyVoiceLoudness({measured: bad, voiceTrack: 'present'}).status).toBe('invalid');
  });
});

describe('bed decisions (decideBedLevel): failures only ever make the bed quieter', () => {
  const decide = (transcript: TranscriptState, voice: VoiceLoudnessState) => decideBedLevel({transcript, voice, words: WORDS, durationSec: 8, preset: 'talking', bedLufs: BED});

  it('1. valid speech + measured voice = exactly the existing envelope', () => {
    const decision = decide({status: 'speech'}, {status: 'measured', lufs: QUIET_VOICE});
    expect(decision).toMatchObject({action: 'duck', basis: 'speech_and_measured_voice', voLufs: QUIET_VOICE});
    expect(decision.action === 'duck' && decision.envelope).toEqual(buildDuckEnvelope({words: WORDS, durationSec: 8, preset: 'talking', voLufs: QUIET_VOICE, bedLufs: BED}));
  });

  it('2. confirmed no speech keeps the existing no-speech behaviour (open level); a missing transcript does not', () => {
    const noSpeech = decide({status: 'confirmed_no_speech'}, {status: 'measured', lufs: QUIET_VOICE});
    expect(noSpeech).toMatchObject({action: 'duck', basis: 'confirmed_no_speech'});
    expect(noSpeech.action === 'duck' && noSpeech.envelope).toEqual(buildDuckEnvelope({words: [], durationSec: 8, preset: 'talking', voLufs: QUIET_VOICE, bedLufs: BED}));
    const missing = decide({status: 'unavailable', reason: 'empty_without_confirmation'}, {status: 'measured', lufs: QUIET_VOICE});
    expect(missing).toMatchObject({action: 'duck', basis: 'speech_timing_unknown_hold_speech_level'});
    expect(noSpeech.action === 'duck' && missing.action === 'duck' && loudestDb(missing.envelope, 8) < loudestDb(noSpeech.envelope, 8)).toBe(true);
  });

  it('3. a missing, failed, malformed or untrusted transcript never opens the bed: the renderer holds the SPEECH level for the whole video', () => {
    const states: TranscriptState[] = [
      {status: 'unavailable', reason: 'missing'},
      {status: 'unavailable', reason: 'failed'},
      {status: 'unavailable', reason: 'malformed'},
      {status: 'unavailable', reason: 'empty_without_confirmation'},
      {status: 'untrusted', reason: 'test'},
    ];
    // before SFX-3D: an empty word list gave the open level everywhere (speech level + 14 LU)
    const before = buildDuckEnvelope({words: [], durationSec: 8, preset: 'talking', voLufs: QUIET_VOICE, bedLufs: BED});
    expect(loudestDb(before, 8)).toBeCloseTo(QUIET_VOICE + TALKING_OFFSETS_LU.open - BED, 6);
    for (const transcript of states) {
      const decision = decide(transcript, {status: 'measured', lufs: QUIET_VOICE});
      expect(decision.action).toBe('duck');
      if (decision.action !== 'duck') continue;
      expect(loudestDb(decision.envelope, 8)).toBeCloseTo(speechLevelDb(QUIET_VOICE), 6);
      expect(rendererDuckDbAt(decision.envelope as never, 0)).toBeCloseTo(speechLevelDb(QUIET_VOICE), 6);
      expect(rendererDuckDbAt(decision.envelope as never, 7.99)).toBeCloseTo(speechLevelDb(QUIET_VOICE), 6);
    }
  });

  it('4. a valid voice measurement drives the level (the existing -18 LU rule, unchanged)', () => {
    for (const lufs of [-35, -28.9, -20, -14]) {
      const decision = decide({status: 'speech'}, {status: 'measured', lufs});
      expect(decision.action === 'duck' && decision.envelope.speechDb).toBeCloseTo(Math.min(0, Math.max(-40, speechLevelDb(lufs))), 6);
    }
  });

  it('5-6. a failed, missing or invalid voice measurement never uses -20 LUFS and never plays the bed at all', () => {
    const failures: VoiceLoudnessState[] = [{status: 'measurement_failed'}, {status: 'invalid', reason: 'NaN'}, {status: 'invalid', reason: 'out of range'}];
    const transcripts: TranscriptState[] = [{status: 'speech'}, {status: 'confirmed_no_speech'}, {status: 'unavailable', reason: 'failed'}, {status: 'untrusted', reason: 'x'}];
    for (const voice of failures) {
      for (const transcript of transcripts) {
        const decision = decide(transcript, voice);
        expect(decision).toMatchObject({action: 'mute', reason: 'voice_loudness_unknown'});
        expect(bedMuteReason(transcript, voice)).toBe('voice_loudness_unknown');
      }
    }
    // what the removed assumption would have done for this quiet speaker: the bed 8.9 dB louder than its measured-voice level
    const assumed = buildDuckEnvelope({words: WORDS, durationSec: 8, preset: 'talking', voLufs: VO_LUFS_ASSUMED, bedLufs: BED});
    expect(assumed.speechDb - speechLevelDb(QUIET_VOICE)).toBeCloseTo(8.9, 6);
  });

  it('7. an established absent voice track follows the no-voice policy; a failed measurement does not', () => {
    const noVoice = decide({status: 'confirmed_no_speech'}, {status: 'confirmed_no_voice'});
    expect(noVoice).toMatchObject({action: 'duck', basis: 'confirmed_no_voice', voLufs: VO_LUFS_ASSUMED});
    expect(decide({status: 'unavailable', reason: 'failed'}, {status: 'confirmed_no_voice'})).toMatchObject({action: 'duck', basis: 'confirmed_no_voice'});
    expect(decide({status: 'confirmed_no_speech'}, {status: 'measurement_failed'})).toMatchObject({action: 'mute', reason: 'voice_loudness_unknown'});
    // contradictions mute
    expect(decide({status: 'speech'}, {status: 'confirmed_no_voice'})).toMatchObject({action: 'mute', reason: 'voice_absent_but_speech_present'});
    expect(decide({status: 'untrusted', reason: 'x'}, {status: 'confirmed_no_voice'})).toMatchObject({action: 'mute', reason: 'voice_absent_but_untrusted_words'});
  });
});

describe('the AudioDirector compiler uses the fail-safes', () => {
  const sheet = exampleSheet();
  const plan = examplePlan(sheet, {policy: {onInvalidElement: 'drop_element', fallback: 'rules_pipeline'}});
  const ctx = (extra: Partial<CompileContext> = {}, on: EditEventSheet = sheet): CompileContext => ({sheet: on, assets: exampleAssets(), voLufs: -19, videoId: 'vid', ...extra});
  const compile = (extra: Partial<CompileContext> = {}, on: EditEventSheet = sheet) => {
    const result = compileAudioPlan(on === sheet ? plan : examplePlan(on, {policy: {onInvalidElement: 'drop_element', fallback: 'rules_pipeline'}}), ctx(extra, on));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.timeline;
  };
  const noWords: EditEventSheet = {...sheet, speech: {...sheet.speech, words: []}};

  it('valid inputs: the compiled duck is the existing envelope and no fail-safe warning is raised', () => {
    const timeline = compile();
    expect(timeline.voice).toEqual({voLufs: -19, source: 'measured'});
    expect(timeline.warnings.filter(w => w.startsWith('bgm_') || w.startsWith('voice_') || w.startsWith('transcript_'))).toEqual([]);
  });

  it('an empty transcript without a successful analysis holds the speech level; with a successful analysis it is the existing no-speech level', () => {
    const unknown = compile({}, noWords);
    expect(unknown.warnings).toContain('transcript_unavailable:empty_without_confirmation');
    expect(unknown.warnings).toContain('bgm_level_basis:speech_timing_unknown_hold_speech_level');
    const held = unknown.music!.duck;
    expect(loudestDb(held, sheet.durationSec)).toBeCloseTo(held.speechDb, 6);
    const confirmed = compile({speechAnalysis: 'succeeded'}, noWords);
    expect(confirmed.warnings).toContain('bgm_level_basis:confirmed_no_speech');
    expect(loudestDb(confirmed.music!.duck, sheet.durationSec)).toBeCloseTo(confirmed.music!.duck.openDb, 6);
    expect(compile({speechAnalysis: 'failed'}, noWords).warnings).toContain('transcript_unavailable:failed');
  });

  it('a missing or invalid voice level mutes the bed and drops the SFX; an established absent voice track does not', () => {
    for (const voLufs of [undefined, Number.NaN, 5, -120]) {
      const timeline = compile({voLufs});
      expect(timeline.music).toBeNull();
      expect(timeline.sfx).toEqual([]);
      expect(timeline.voice).toEqual({voLufs: null, source: 'unavailable'});
      expect(timeline.dropped.find(item => item.ref.startsWith('music:'))?.reason).toBe('bgm_muted_fail_safe:voice_loudness_unknown');
    }
    const noVoice = compile({voLufs: undefined, voiceTrack: 'absent', speechAnalysis: 'succeeded'}, noWords);
    expect(noVoice.voice).toEqual({voLufs: VO_LUFS_ASSUMED, source: 'no_voice_reference'});
    expect(noVoice.music).not.toBeNull();
    // the sheet's own probe result establishes absence too
    expect(compile({voLufs: undefined, speechAnalysis: 'succeeded'}, {...noWords, sourceHasAudio: false}).voice.source).toBe('no_voice_reference');
    // words present but no voice track: contradictory, muted
    expect(compile({voLufs: undefined, voiceTrack: 'absent'}).dropped.find(item => item.ref.startsWith('music:'))?.reason).toBe('bgm_muted_fail_safe:voice_absent_but_speech_present');
  });
});

describe('Phase SFX-3G: a bed of unknown loudness is withheld, never levelled on BED_LUFS_ASSUMED (-16)', () => {
  it('classifyBedLoudness: measured only for a finite number in -70..0', () => {
    expect(classifyBedLoudness(-23)).toEqual({status: 'measured', lufs: -23});
    expect(classifyBedLoudness(-70)).toEqual({status: 'measured', lufs: -70});
    expect(classifyBedLoudness(0)).toEqual({status: 'measured', lufs: 0});
    expect(classifyBedLoudness(undefined)).toEqual({status: 'missing'});
    expect(classifyBedLoudness(null)).toEqual({status: 'missing'});
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '-23', {}, [], true, 0.5, -70.1]) expect(classifyBedLoudness(bad).status).toBe('invalid');
  });

  it('decideBedLevel: talking and absolute presets withhold the bed; a voice failure keeps its own reason; a measured bed is unchanged', () => {
    const base = {transcript: {status: 'speech'} as TranscriptState, voice: {status: 'measured', lufs: QUIET_VOICE} as VoiceLoudnessState, words: WORDS, durationSec: 8};
    for (const bedLufs of [undefined, null, Number.NaN, 'x', 9]) {
      expect(decideBedLevel({...base, preset: 'talking', bedLufs})).toMatchObject({action: 'mute', reason: 'bed_loudness_unknown'});
      expect(decideBedLevel({...base, preset: 'default', bedLufs})).toMatchObject({action: 'mute', reason: 'bed_loudness_unknown'});
    }
    expect(decideBedLevel({...base, voice: {status: 'measurement_failed'}, preset: 'talking', bedLufs: undefined})).toMatchObject({action: 'mute', reason: 'voice_loudness_unknown'});
    const measured = decideBedLevel({...base, preset: 'talking', bedLufs: BED});
    expect(measured.action === 'duck' && measured.envelope).toEqual(buildDuckEnvelope({words: WORDS, durationSec: 8, preset: 'talking', voLufs: QUIET_VOICE, bedLufs: BED}));
  });

  it('the AudioDirector compiler drops (never rejects) a bed asset without a measured loudness, with the reason', () => {
    const sheet = exampleSheet();
    const assets = exampleAssets();
    const bed = [...assets.music.values()][0]!;
    const {integratedLufs: _measured, ...unmeasured} = bed;
    const strictPlan = examplePlan(sheet); // default policy rejects the plan on an element ERROR
    for (const asset of [unmeasured, {...bed, integratedLufs: Number.NaN}]) {
      const result = compileAudioPlan(strictPlan, {sheet, assets: {music: new Map([[bed.id, asset as typeof bed]])}, voLufs: -19, videoId: 'vid'});
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.timeline.music).toBeNull();
      expect(result.timeline.dropped.find(item => item.ref.startsWith('music:'))?.reason).toBe('bgm_muted_fail_safe:bed_loudness_unknown');
      expect(result.timeline.warnings).toContain('bgm_muted_fail_safe:bed_loudness_unknown');
    }
    const ok = compileAudioPlan(strictPlan, {sheet, assets, voLufs: -19, videoId: 'vid'});
    expect(ok.ok && ok.timeline.music?.duck.bedLufs).toBe(bed.integratedLufs);
  });
});
