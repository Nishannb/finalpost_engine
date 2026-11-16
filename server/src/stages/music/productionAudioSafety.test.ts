/**
 * Phase SFX-3E: the production audio path. These are the functions pipeline/analyzeVideo.ts now calls for the generated bed and the SFX (a source
 * check below pins that it calls them, and that the assumed voice level is gone). The full analyzeVideo run needs transcription, the Director and
 * storage, so it is not run here. Envelopes are evaluated with the RENDERER's curve. Local ffmpeg/ffprobe only, temporary files in the OS temp dir.
 */
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, describe, expect, it} from 'vitest';

import {duckBaseDbAt as rendererDuckDbAt} from '../../../../remotion/src/audio/duckEnvelope';
import {sfxPlaybackVolume} from '../../../../remotion/src/lib/sfxPlaybackVolume';
import {applyCatalogToHits, SFX_CUES, type SfxEntry} from '../../lib/sfxCatalog.ts';
import {audioCatalog} from '../audioDirector/audioPlan/assets.ts';
import {compileAudioPlan} from '../audioDirector/audioPlan/compile.ts';
import {toRemotionAudioDesign} from '../audioDirector/audioPlan/remotionAdapter.ts';
import {exampleAssets, examplePlan, exampleSheet} from '../audioDirector/audioPlan/testFixtures.ts';
import {buildDuckEnvelope, TALKING_OFFSETS_LU, type DuckEnvelope} from './duckEnvelope.ts';
import {catalogFileForSrc, levelProductionSfx, probeAudioChannels, productionGeneratedBed, productionTranscriptState, resolveHitChannels, voiceTrackFromProbe, type ProductionHit} from './productionAudioSafety.ts';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.resolve(SRC_ROOT, '../..');
const WORDS = [{text: 'a', start: 0.5, end: 1.2}, {text: 'b', start: 1.3, end: 2.0}, {text: 'c', start: 4.0, end: 5.0}];
const DURATION = 8;
const QUIET = -28.9;
const BED = -23;
const RELEASE = 0.3;
const loudestDb = (envelope: DuckEnvelope) => {
  let max = -Infinity;
  for (let t = 0; t <= DURATION; t += 0.01) max = Math.max(max, rendererDuckDbAt(envelope as never, t));
  return max;
};
const speechDb = (voLufs: number) => voLufs + TALKING_OFFSETS_LU.speech - BED;
/** The exact call analyzeVideo made before SFX-3E for a valid transcript and measurement. */
const previousDuck = (voLufs: number | undefined, preset: 'talking' | 'default' = 'talking') => buildDuckEnvelope({words: WORDS, durationSec: DURATION, preset, voLufs, bedLufs: BED, releaseSec: RELEASE});
const bed = (over: Partial<Parameters<typeof productionGeneratedBed>[0]> = {}) =>
  productionGeneratedBed({
    preset: 'talking',
    transcript: productionTranscriptState({transcriptionSucceeded: true, rawWordCount: WORDS.length, captionWords: WORDS, durationSec: DURATION}),
    sourceHasAudio: true,
    measuredVoLufs: QUIET,
    words: WORDS,
    durationSec: DURATION,
    bedLufs: BED,
    releaseSec: RELEASE,
    ...over,
  });

describe('production transcript state (analyzeVideo -> productionTranscriptState)', () => {
  it('a raw transcription with zero words is the only confirmed "no speech"; empty caption words after editing are not', () => {
    expect(productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 3, captionWords: WORDS, durationSec: DURATION})).toEqual({status: 'speech'});
    expect(productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 0, captionWords: [], durationSec: DURATION})).toEqual({status: 'confirmed_no_speech'});
    expect(productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 12, captionWords: [], durationSec: DURATION})).toEqual({status: 'unavailable', reason: 'empty_without_confirmation'});
    expect(productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 3, captionWords: undefined, durationSec: DURATION})).toEqual({status: 'unavailable', reason: 'missing'});
    expect(productionTranscriptState({transcriptionSucceeded: false, rawWordCount: 0, captionWords: [], durationSec: DURATION})).toEqual({status: 'unavailable', reason: 'failed'});
    expect(productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 1, captionWords: [{start: 'x', end: 1}], durationSec: DURATION})).toEqual({status: 'unavailable', reason: 'malformed'});
    expect(productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 1, captionWords: [{start: 2, end: 1}], durationSec: DURATION}).status).toBe('untrusted');
  });

  it('a missing probe answer is not proof that the voice is absent', () => {
    expect(voiceTrackFromProbe(true)).toBe('present');
    expect(voiceTrackFromProbe(false)).toBe('absent');
    expect(voiceTrackFromProbe(undefined)).toBe('unknown');
    expect(voiceTrackFromProbe(null)).toBe('unknown');
  });
});

describe('production generated bed (analyzeVideo -> productionGeneratedBed)', () => {
  it('1. speech + measured voice: exactly the envelope analyzeVideo built before SFX-3E, with no warning', () => {
    const result = bed();
    expect(result).toMatchObject({action: 'attach', basis: 'speech_and_measured_voice', voLufs: QUIET, warnings: []});
    expect(result.action === 'attach' && result.duck).toEqual(previousDuck(QUIET));
  });

  it('1b. an absolute preset needs no voice and keeps its previous envelope', () => {
    const result = bed({preset: 'default', measuredVoLufs: undefined});
    expect(result).toMatchObject({action: 'attach', basis: 'absolute_preset_speech', voLufs: undefined});
    expect(result.action === 'attach' && result.duck).toEqual(previousDuck(undefined, 'default'));
  });

  it('2. confirmed no speech follows the existing no-speech behaviour (open level)', () => {
    const result = bed({transcript: productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 0, captionWords: [], durationSec: DURATION}), words: []});
    expect(result).toMatchObject({action: 'attach', basis: 'confirmed_no_speech'});
    expect(result.action === 'attach' && result.duck).toEqual(buildDuckEnvelope({words: [], durationSec: DURATION, preset: 'talking', voLufs: QUIET, bedLufs: BED, releaseSec: RELEASE}));
  });

  it('3-4. a missing, failed, malformed or untrusted transcript never opens the bed (held at the speech level, renderer curve)', () => {
    const before = buildDuckEnvelope({words: [], durationSec: DURATION, preset: 'talking', voLufs: QUIET, bedLufs: BED, releaseSec: RELEASE});
    expect(loudestDb(before) - speechDb(QUIET)).toBeCloseTo(14, 6); // what an empty word list used to do
    for (const [succeeded, raw, captions] of [[true, 5, []], [true, 5, undefined], [false, 0, []], [true, 1, [{start: 'x', end: 1}]], [true, 1, [{start: 2, end: 1}]]] as const) {
      const transcript = productionTranscriptState({transcriptionSucceeded: succeeded, rawWordCount: raw, captionWords: captions, durationSec: DURATION});
      for (const preset of ['talking', 'default'] as const) {
        const result = bed({transcript, preset, words: [], measuredVoLufs: preset === 'talking' ? QUIET : undefined});
        expect(result.action).toBe('attach');
        if (result.action !== 'attach') continue;
        expect(loudestDb(result.duck)).toBeCloseTo(result.duck.speechDb, 6);
        expect(loudestDb(result.duck)).toBeLessThan(result.duck.openDb);
        expect(result.warnings.some(w => w.startsWith('music:transcript_'))).toBe(true);
      }
    }
  });

  it('5-6. a failed or invalid voice measurement mutes the bed; no -20 LUFS, never louder', () => {
    for (const measuredVoLufs of [null, undefined, Number.NaN, 5, -120]) {
      const result = bed({measuredVoLufs});
      expect(result).toMatchObject({action: 'mute', reason: 'voice_loudness_unknown'});
      expect(result.warnings).toContain('music:bed_muted_fail_safe:voice_loudness_unknown');
      expect(JSON.stringify(result)).not.toContain('-20');
    }
  });

  it('7. an established absent voice is the no-voice reference; an unknown probe with a failed measurement is not', () => {
    const transcript = productionTranscriptState({transcriptionSucceeded: true, rawWordCount: 0, captionWords: [], durationSec: DURATION});
    expect(bed({sourceHasAudio: false, measuredVoLufs: null, transcript, words: []})).toMatchObject({action: 'attach', basis: 'confirmed_no_voice'});
    expect(bed({sourceHasAudio: undefined, measuredVoLufs: null, transcript, words: []})).toMatchObject({action: 'mute', reason: 'voice_loudness_unknown'});
    expect(bed({sourceHasAudio: false, measuredVoLufs: null})).toMatchObject({action: 'mute', reason: 'voice_absent_but_speech_present'});
  });

  it('Phase SFX-3G: a bed without a valid measured loudness is withheld (before SFX-3G this test asserted it was only reported and levelled on -16)', () => {
    for (const [bedLufs, status] of [[undefined, 'missing'], [null, 'missing'], [Number.NaN, 'invalid'], [Number.POSITIVE_INFINITY, 'invalid'], ['-23', 'invalid'], [{lufs: -23}, 'invalid'], [3, 'invalid'], [-90, 'invalid']] as const) {
      for (const preset of ['talking', 'default'] as const) {
        const result = bed({bedLufs, preset, measuredVoLufs: preset === 'talking' ? QUIET : undefined});
        expect(result).toMatchObject({action: 'mute', reason: 'bed_loudness_unknown'});
        expect(result.warnings).toEqual(expect.arrayContaining([`music:bed_loudness_${status}`, 'music:bed_muted_fail_safe:bed_loudness_unknown']));
        expect(JSON.stringify(result)).not.toContain('-16');
      }
    }
    // the voice failure keeps its own reason (and drops the SFX) when both are unknown
    expect(bed({bedLufs: undefined, measuredVoLufs: null})).toMatchObject({action: 'mute', reason: 'voice_loudness_unknown'});
    // a measured bed: unchanged (the exact pre-SFX-3G envelope), also at the range bounds
    for (const lufs of [BED, -70, 0, -12.5]) {
      const result = bed({bedLufs: lufs});
      expect(result.action === 'attach' && result.duck).toEqual(buildDuckEnvelope({words: WORDS, durationSec: DURATION, preset: 'talking', voLufs: QUIET, bedLufs: lufs, releaseSec: RELEASE}));
    }
  });
});

describe('production SFX levels (analyzeVideo -> levelProductionSfx)', () => {
  const entries: SfxEntry[] = [{fileName: 'zip.wav', duration: 0.3, tobeused: [...SFX_CUES], gainDb: 0}];
  const hits: ProductionHit[] = [{at: 2.5, kind: 'whoosh', volume: 0.1, reason: 'transition_whip'}, {at: 6, kind: 'hit', volume: 0.12, reason: 'graphic_full_screen'}];
  const base = {hits, catalogEntries: entries, videoId: 'v', offsetLu: -10, wordOnsetsSec: [0.5, 1.3, 4.0], voiceTrack: 'present' as const};
  const never = async () => {
    throw new Error('the voice must not be measured here');
  };

  it('8. unknown voice loudness drops every SFX, with a reason; no level is computed from a guessed voice', async () => {
    const failed = await levelProductionSfx({...base, voice: {status: 'measurement_failed'}, measureVoice: never});
    expect(failed).toMatchObject({hits: [], warnings: ['sfx:dropped_voice_loudness_unknown:2'], catalogStats: null});
    const invalid = await levelProductionSfx({...base, voice: {status: 'invalid', reason: 'NaN'}, measureVoice: never});
    expect(invalid.hits).toEqual([]);
    // catalogue in use, no generated bed measured the voice: measured now; a failed measurement drops the SFX
    let calls = 0;
    const unmeasured = await levelProductionSfx({...base, voice: null, measureVoice: async () => (calls++, null)});
    expect(calls).toBe(1);
    expect(unmeasured.hits).toEqual([]);
    expect(unmeasured.warnings).toEqual(['sfx:dropped_voice_loudness_unknown:2']);
  });

  it('a measured voice gives exactly the previous catalogue levels; built-ins without a catalogue keep their fixed volumes untouched', async () => {
    const measured = await levelProductionSfx({...base, voice: {status: 'measured', lufs: QUIET}, measureVoice: never});
    expect(measured.hits).toEqual(applyCatalogToHits(hits, {entries, videoId: 'v', voLufs: QUIET, offsetLu: -10, wordOnsetsSec: [0.5, 1.3, 4.0]}).hits);
    const lateMeasure = await levelProductionSfx({...base, voice: null, measureVoice: async () => QUIET});
    expect(lateMeasure.hits).toEqual(measured.hits);
    const fixed = await levelProductionSfx({...base, catalogEntries: [], voice: null, measureVoice: never});
    expect(fixed.hits).toEqual(hits);
  });
});

describe('legacy SFX channel metadata (analyzeVideo -> resolveHitChannels)', () => {
  const library = mkdtempSync(path.join(os.tmpdir(), 'sfx3e-library-'));
  afterAll(() => rmSync(library, {recursive: true, force: true}));
  const ffmpeg = (args: string[]) => {
    const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
    if (result.status !== 0) throw new Error(String(result.stderr));
  };
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=2000:duration=0.2', '-ac', '1', path.join(library, 'tick_mono.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=2000:duration=0.2', '-ac', '2', path.join(library, 'tick_stereo.wav')]);
  const src = (file: string) => `staticFile:sfx-library/${file}`;

  it('9-11. built-ins are mono (measured), library files are probed (mono 1, stereo 2), anything unknown gets no field; volumes never change', async () => {
    const input: ProductionHit[] = [
      {at: 1, kind: 'hit', volume: 0.12},
      {at: 2, kind: 'whoosh', volume: 0.1},
      {at: 3, kind: 'pop', volume: 0.09},
      {at: 4, kind: 'hit', volume: 0.05, src: src('tick_mono.wav')},
      {at: 5, kind: 'hit', volume: 0.05, src: src('tick_stereo.wav')},
      {at: 6, kind: 'hit', volume: 0.05, src: src('missing.wav')},
      {at: 7, kind: 'hit', volume: 0.05, src: 'staticFile:elsewhere/x.wav'},
      {at: 8, kind: 'hit', volume: 0.05, src: src('../escape.wav')},
    ];
    const out = await resolveHitChannels(input, probeAudioChannels, library);
    expect(out.map(hit => hit.sourceChannels)).toEqual([1, 1, 1, 1, 2, undefined, undefined, undefined]);
    expect(out.map(hit => hit.volume)).toEqual(input.map(hit => hit.volume));
    expect(catalogFileForSrc(src('a/b.wav'), library)).toBe(path.join(library, 'a/b.wav'));
    expect(catalogFileForSrc(src('../x.wav'), library)).toBeNull();
    // a hit that already carries the field is left alone
    expect((await resolveHitChannels([{at: 1, kind: 'hit', volume: 0.1, sourceChannels: 2}], probeAudioChannels, library))[0]!.sourceChannels).toBe(2);
  });

  it('12. AudioDirector and legacy hits carry the same contract, and the renderer compensates each mono hit exactly once', async () => {
    const sheet = exampleSheet();
    const compiled = compileAudioPlan(examplePlan(sheet, {music: null, sfx: [{id: 'b', anchor: {kind: 'event', eventId: 'cut@4000', at: 'impact'}, sound: {kind: 'builtin', name: 'hit'}, level: 'subtle'}], policy: {onInvalidElement: 'drop_element', fallback: 'rules_pipeline'}}), {sheet, assets: audioCatalog([...exampleAssets().music.values()], []), voLufs: -19, videoId: 'v'});
    if (!compiled.ok) throw new Error('compile failed');
    const lowered = toRemotionAudioDesign(compiled.timeline);
    if (!lowered.ok) throw new Error('lowering failed');
    const directorHit = lowered.audioDesign.hits![0]!;
    const [legacyHit] = await resolveHitChannels([{at: directorHit.at, kind: 'hit', volume: directorHit.volume}], probeAudioChannels, library);
    expect(directorHit.sourceChannels).toBe(1);
    expect(legacyHit!.sourceChannels).toBe(1);
    // the pipeline never touches the volume; the renderer applies sqrt(2) once, identically for both
    expect(legacyHit!.volume).toBe(directorHit.volume);
    expect(sfxPlaybackVolume(legacyHit!)).toBeCloseTo(directorHit.volume! * Math.SQRT2, 12);
    expect(sfxPlaybackVolume(legacyHit!)).toBe(sfxPlaybackVolume(directorHit));
    // a second pass is a no-op (no double stamping, no double compensation)
    const again = await resolveHitChannels([legacyHit!], probeAudioChannels, library);
    expect(again[0]).toEqual(legacyHit);
  });
});

describe('analyzeVideo uses these functions (source pin)', () => {
  const source = readFileSync(path.join(SRC_ROOT, 'pipeline/analyzeVideo.ts'), 'utf8');
  it('the bed and the SFX go through the SFX-3E functions, and the assumed voice level is gone', () => {
    expect(source).not.toMatch(/VO_LUFS_ASSUMED/);
    expect(source).not.toMatch(/applyCatalogToHits\(/);
    expect(source).toMatch(/productionGeneratedBed\(\{/);
    expect(source).toMatch(/productionTranscriptState\(\{transcriptionSucceeded: true, rawWordCount: transcription\.words\.length, captionWords/);
    expect(source).toMatch(/sourceHasAudio: originalProbe\.hasAudio/);
    expect(source).toMatch(/levelProductionSfx\(\{/);
    expect(source).toMatch(/hits: await resolveHitChannels\(leveled\.hits\)/);
    expect(source).toMatch(/if \(bed\.action === 'mute'\) \{[\s\S]{0,200}resolved = null;/);
    // the only buildDuckEnvelope use left is the type of the decided envelope
    expect([...source.matchAll(/buildDuckEnvelope\(/g)]).toHaveLength(0);
  });
  it('no other production module assumes a voice level', () => {
    const offenders = spawnSync('grep', ['-rln', '--exclude=*.test.ts', 'VO_LUFS_ASSUMED', path.join(SRC_ROOT, 'pipeline'), path.join(SRC_ROOT, 'scripts'), path.join(SRC_ROOT, 'stages/render'), path.join(SRC_ROOT, 'lib')]);
    expect(String(offenders.stdout).trim()).toBe('');
    expect(REPO.length).toBeGreaterThan(0);
  });
});
