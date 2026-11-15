/**
 * Phase SFX-3E: the production audio safety decisions, called by pipeline/analyzeVideo.ts. Kept here (not inline in the pipeline) so the exact
 * functions the pipeline runs are tested without the paid or networked stages around them.
 *
 *   1. productionTranscriptState   what the pipeline knows about speech (never turns an empty or failed transcript into "no speech").
 *   2. voiceTrackFromProbe          the probe's audio-stream answer; a missing answer is 'unknown', never 'absent'.
 *   3. productionGeneratedBed       the generated bed's duck (or mute), through music/bgmFailSafe.ts decideBedLevel. No assumed voice level.
 *   4. levelProductionSfx           voice-relative SFX levels (the human catalogue) only from a measured voice; otherwise the SFX are dropped.
 *   5. resolveHitChannels           sourceChannels on each hit, only when the file's channel count is actually known (built-ins: measured;
 *                                   catalogue files: probed). The renderer (remotion/src/lib/sfxPlaybackVolume.ts) is the ONE place that compensates.
 *
 * Unchanged: the -18 / -9 / -4 LU offsets, the duck curve, SFX selection, timing, masks, spacing, caps, fixed built-in volumes and catalogue levels.
 */

import {execFile} from 'node:child_process';
import path from 'node:path';

import {applyCatalogToHits, SFX_STATIC_PREFIX, sfxLibraryDir, type SfxEntry} from '../../lib/sfxCatalog.ts';
import type {AudioDesign} from '../../types/blueprint.ts';
import {BUILTIN_SFX} from '../audioDirector/audioPlan/assets.ts';
import {classifyBedLoudness, classifyTranscript, classifyVoiceLoudness, decideBedLevel, voiceReferenceLufs, type TranscriptState, type VoiceLoudnessState} from './bgmFailSafe.ts';
import {bgmOffsets, type BgmPolicyName} from './bgmPolicy.ts';
import type {DuckEnvelope, DuckPresetName} from './duckEnvelope.ts';

export type ProductionHit = NonNullable<AudioDesign['hits']>[number];
export type VoiceTrack = 'present' | 'absent' | 'unknown';

/** The probe's answer. Only an explicit `false` establishes that the source has no audio; a missing answer proves nothing. */
export function voiceTrackFromProbe(hasAudio: boolean | null | undefined): VoiceTrack {
  if (hasAudio === true) return 'present';
  if (hasAudio === false) return 'absent';
  return 'unknown';
}

/**
 * The pipeline's speech state. `transcriptionSucceeded` is false when the transcription step failed. A successful transcription that returned
 * ZERO words is the only confirmed "no speech"; caption words that end up empty after editing (trim, romanisation) while the transcription had
 * words are NOT a confirmation, so they classify as unavailable.
 */
export function productionTranscriptState(input: {transcriptionSucceeded: boolean; rawWordCount: number; captionWords: unknown; durationSec: number}): TranscriptState {
  const analysis = !input.transcriptionSucceeded ? 'failed' : input.rawWordCount === 0 ? 'succeeded' : 'unknown';
  return classifyTranscript({words: input.captionWords, analysis, durationSec: input.durationSec});
}

export type ProductionBedResult =
  | {action: 'attach'; duck: DuckEnvelope; voLufs: number | undefined; basis: string; voice: VoiceLoudnessState | null; warnings: string[]; bedLoudness: {status: 'measured'; lufs: number}}
  | {action: 'mute'; reason: string; voice: VoiceLoudnessState | null; warnings: string[]};

/**
 * The generated bed's level. `measuredVoLufs`: the measurement result (null = it failed or returned nothing); only consulted for the voice-relative
 * `talking` preset. An absolute preset ('default' / 'legacy_brief') never needs the voice and is not measured.
 */
export function productionGeneratedBed(input: {
  preset: DuckPresetName;
  transcript: TranscriptState;
  sourceHasAudio: boolean | null | undefined;
  measuredVoLufs: number | null | undefined;
  words: ReadonlyArray<{start: number; end: number}>;
  durationSec: number;
  /** The music plan's integratedLufs as received (any value). Only a measured, valid number lets the bed through (SFX-3G). */
  bedLufs?: unknown;
  releaseSec?: number;
  /** The generated-BGM level policy (stages/music/bgmPolicy.ts). Absent = v1_talking (-18 / -9 / -4), unchanged. analyzeVideo passes resolveBgmPolicy(). */
  policy?: BgmPolicyName;
}): ProductionBedResult {
  const warnings: string[] = [];
  const {transcript} = input;
  if (transcript.status === 'unavailable' || transcript.status === 'untrusted') warnings.push(`music:transcript_${transcript.status}:${transcript.reason}`);
  const talking = input.preset === 'talking';
  const voice = talking ? classifyVoiceLoudness({measured: input.measuredVoLufs, voiceTrack: voiceTrackFromProbe(input.sourceHasAudio)}) : null;
  if (voice && (voice.status === 'measurement_failed' || voice.status === 'invalid')) warnings.push(`music:voice_loudness_${voice.status}`);
  // Phase SFX-3G: a generated bed without a valid measured loudness is withheld (never levelled as if it were BED_LUFS_ASSUMED = -16).
  const bedLoudness = classifyBedLoudness(input.bedLufs);
  if (bedLoudness.status !== 'measured') warnings.push(`music:bed_loudness_${bedLoudness.status}`);
  const decision = decideBedLevel({
    transcript,
    // An absolute preset never consults the voice (decideBedLevel returns before reading it).
    voice: voice ?? {status: 'measurement_failed'},
    words: input.words,
    durationSec: input.durationSec,
    preset: input.preset,
    bedLufs: input.bedLufs,
    ...(input.releaseSec !== undefined ? {releaseSec: input.releaseSec} : {}),
    ...(input.policy && input.policy !== 'v1_talking' ? {offsets: bgmOffsets(input.policy)} : {}),
  });
  if (decision.action === 'mute') {
    warnings.push(`music:bed_muted_fail_safe:${decision.reason}`);
    return {action: 'mute', reason: decision.reason, voice, warnings};
  }
  if (decision.basis !== 'speech_and_measured_voice' && decision.basis !== 'absolute_preset_speech') warnings.push(`music:bed_level_basis:${decision.basis}`);
  // Only reached with a measured bed (SFX-3G); recorded as provenance so the render boundary can trust it (SFX-3H).
  return {action: 'attach', duck: decision.envelope, voLufs: decision.voLufs ?? undefined, basis: decision.basis, voice, warnings, bedLoudness: {status: 'measured', lufs: (bedLoudness as {lufs: number}).lufs}};
}

/**
 * Voice-relative SFX levels. The human catalogue (lib/sfxCatalog.ts) levels a hit against the voice; that needs a MEASURED voice (or an established
 * absent voice track, the existing reference). Built-in hits keep their fixed volumes (they never used the voice).
 *   - voice measurement failed or invalid (the bed was muted for it): every SFX is dropped.
 *   - catalogue in use and no measured voice yet: the voice is measured now; if that fails, every SFX is dropped.
 */
export async function levelProductionSfx(input: {
  hits: readonly ProductionHit[];
  catalogEntries: readonly SfxEntry[];
  videoId: string;
  offsetLu: number;
  wordOnsetsSec: readonly number[];
  /** From the bed step; null = not measured (no generated `talking` bed). */
  voice: VoiceLoudnessState | null;
  voiceTrack: VoiceTrack;
  measureVoice: () => Promise<number | null>;
}): Promise<{hits: ProductionHit[]; voice: VoiceLoudnessState | null; warnings: string[]; catalogStats: ReturnType<typeof applyCatalogToHits>['stats'] | null}> {
  const unknown = (voice: VoiceLoudnessState | null) => voice !== null && (voice.status === 'measurement_failed' || voice.status === 'invalid');
  if (input.hits.length === 0) return {hits: [], voice: input.voice, warnings: [], catalogStats: null};
  if (unknown(input.voice)) return {hits: [], voice: input.voice, warnings: [`sfx:dropped_voice_loudness_unknown:${input.hits.length}`], catalogStats: null};
  if (input.catalogEntries.length === 0) return {hits: [...input.hits], voice: input.voice, warnings: [], catalogStats: null};
  const voice = input.voice ?? classifyVoiceLoudness({measured: await input.measureVoice(), voiceTrack: input.voiceTrack});
  const reference = voiceReferenceLufs(voice);
  if (!reference) return {hits: [], voice, warnings: [`sfx:dropped_voice_loudness_unknown:${input.hits.length}`], catalogStats: null};
  const applied = applyCatalogToHits(input.hits, {entries: input.catalogEntries, videoId: input.videoId, voLufs: reference.voLufs, offsetLu: input.offsetLu, wordOnsetsSec: input.wordOnsetsSec});
  return {hits: applied.hits as ProductionHit[], voice, warnings: reference.source === 'no_voice_reference' ? ['sfx:levels_no_voice_reference'] : [], catalogStats: applied.stats};
}

/** The library file behind a catalogue hit's `src`, or null for anything else (a channel count is never guessed from a name). */
export function catalogFileForSrc(src: string, libraryDir: string = sfxLibraryDir()): string | null {
  const prefix = `staticFile:${SFX_STATIC_PREFIX}`;
  if (!src.startsWith(prefix)) return null;
  const rel = src.slice(prefix.length);
  if (rel.length === 0 || rel.includes('..') || path.isAbsolute(rel)) return null;
  return path.join(libraryDir, rel);
}

/** Channel count of a local audio file (ffprobe, local only); null when it cannot be read. */
export function probeAudioChannels(filePath: string, ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe'): Promise<number | null> {
  return new Promise(resolve => {
    execFile(ffprobeBin, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', filePath], {timeout: 15000}, (error, stdout) => {
      if (error) return resolve(null);
      const value = Number.parseInt(String(stdout).trim(), 10);
      resolve(Number.isFinite(value) && value > 0 ? value : null);
    });
  });
}

/**
 * Sets `sourceChannels` (1 or 2) on every hit whose file's channel count is known, and leaves it off otherwise:
 *   - built-in hit (no src): BUILTIN_SFX[kind].channels, measured from the file (audioPlan/assets.test.ts re-measures it);
 *   - catalogue hit: the library file, probed;
 *   - any other src, an unreadable file, or a count other than 1 / 2: no field (no compensation).
 * Volumes are never changed: compensation happens once, in the renderer. A hit that already carries a field keeps it.
 */
export async function resolveHitChannels(hits: readonly ProductionHit[], probe: (filePath: string) => Promise<number | null> = probeAudioChannels, libraryDir: string = sfxLibraryDir()): Promise<ProductionHit[]> {
  const files = new Map<string, number | null>();
  for (const hit of hits) {
    const file = hit.src ? catalogFileForSrc(hit.src, libraryDir) : null;
    if (file && !files.has(file)) files.set(file, await probe(file));
  }
  return hits.map(hit => {
    if (hit.sourceChannels !== undefined) return hit;
    let channels: number | null | undefined;
    if (!hit.src) channels = BUILTIN_SFX[hit.kind]?.channels;
    else {
      const file = catalogFileForSrc(hit.src, libraryDir);
      channels = file ? files.get(file) : null;
    }
    return channels === 1 || channels === 2 ? {...hit, sourceChannels: channels} : hit;
  });
}
