import type {AudioDesign} from '../../types/blueprint.ts';
import {carvedTwinEnabled, masterPassEnabled} from './flags.ts';
import {mixCheckFor} from './mixCheck.ts';
import type {MasterPassResult} from './masterPass.ts';

/** How the bed was obtained, saved on the blueprint at analyze time so a later render (local or Lambda) can summarize it. */
export type MusicProvenance = NonNullable<AudioDesign['musicProvenance']>;

export type MusicSummary = {
  source: 'licensed' | 'generated' | 'pool' | 'none';
  mood: string | null;
  costUsd: number;
  voLufs: number | null;
  intendedSpeechGapLu: number | null;
  intendedPauseGapLu: number | null;
  carvedApplied: boolean;
  masterApplied: boolean;
  finalLufs: number | null;
  finalTruePeak: number | null;
  sfxHits: {catalog: number; builtIn: number};
  fallbackReason: string | null;
  /** Phase 3. Null on a blueprint without a brief or placement (MUSIC_PERSONALIZE=0, or saved before it). */
  style: string | null;
  bedStyle: string | null;
  family: string | null;
  bpm: number | null;
  key: string | null;
  speechWpm: number | null;
  arc: string | null;
  /** Where the bed itself lifts, measured (bed seconds), and where that lands on the video. */
  measuredLiftSec: number | null;
  liftAtVideoSec: number | null;
  hookAtSec: number | null;
  startOffsetSec: number | null;
  startsOnDownbeat: boolean | null;
  placementScore: number | null;
  endType: 'button' | 'hold-fade' | null;
  fallbackTier: string | null;
  sfxSnapped: number | null;
  sfxDropped: number | null;
  /** Phase 3.1: the duck follows the loudness of the bed section playing (true), or assumes -16 LUFS everywhere (false: an older bed or personalisation off). */
  loudnessAware: boolean;
  /** Lowest and highest dB the loudness-aware duck added to the static gain. Null when not loudness-aware. */
  loudnessCorrectionDb: {minDb: number; maxDb: number} | null;
};

/**
 * Pure: the one line the human checks after each edit. `master` is the master pass result when one ran (its afterLufs / afterTruePeak
 * are the final numbers); without it the final loudness is unknown and stays null.
 */
export function buildMusicSummary(input: {
  audioDesign: AudioDesign | undefined;
  master?: MasterPassResult | null;
  masterRequested?: boolean;
  env?: NodeJS.ProcessEnv;
}): MusicSummary {
  const audio = input.audioDesign;
  const provenance = audio?.musicProvenance;
  const hasBed = Boolean(audio?.musicUrl);
  const source: MusicSummary['source'] = !hasBed ? 'none' : (provenance?.source ?? (audio?.musicSource === 'licensed' ? 'licensed' : 'generated'));
  const mix = mixCheckFor(audio);
  const hits = audio?.hits ?? [];
  const fromCatalog = hits.filter(hit => typeof hit.src === 'string' && hit.src.length > 0).length;
  return {
    source,
    mood: audio?.musicMood ?? provenance?.mood ?? null,
    costUsd: provenance?.costUsd ?? 0,
    voLufs: mix?.voLufs ?? audio?.voLufs ?? null,
    intendedSpeechGapLu: mix?.speechGapLu ?? null,
    intendedPauseGapLu: mix?.pauseGapLu ?? null,
    carvedApplied: Boolean(audio?.musicCarvedUrl) && carvedTwinEnabled(input.env ?? process.env),
    masterApplied: Boolean(input.master),
    finalLufs: input.master?.afterLufs ?? null,
    finalTruePeak: input.master?.afterTruePeak ?? null,
    sfxHits: {catalog: fromCatalog, builtIn: hits.length - fromCatalog},
    style: provenance?.brief?.style ?? null,
    bedStyle: provenance?.bedStyle ?? null,
    family: provenance?.brief?.family ?? null,
    bpm: provenance?.brief?.bpm ?? null,
    key: provenance?.brief?.key ?? null,
    speechWpm: provenance?.brief?.speechWpm ?? null,
    arc: provenance?.brief?.arc ?? null,
    measuredLiftSec: provenance?.bedMeasuredLiftSec ?? null,
    liftAtVideoSec: provenance?.liftAtVideoSec ?? null,
    hookAtSec: provenance?.brief?.hookAtSec ?? null,
    startOffsetSec: audio?.musicStartOffsetSec ?? null,
    startsOnDownbeat: provenance?.startsOnDownbeat ?? null,
    placementScore: audio?.musicPlacementScore ?? null,
    endType: audio?.musicEndType ?? null,
    fallbackTier: provenance?.fallbackTier ?? null,
    sfxSnapped: provenance?.sfxSnapped ?? null,
    sfxDropped: provenance?.sfxDropped ?? null,
    loudnessAware: Boolean(audio?.duck?.bedLoudness),
    loudnessCorrectionDb: provenance?.loudnessDuck ?? null,
    fallbackReason: provenance?.fallbackReason ?? (source === 'none' ? 'no_bed' : null) ?? (input.masterRequested && !input.master && masterPassEnabled(input.env ?? process.env) ? 'master_not_applied' : null),
  };
}

/** Never throws, never fails a render. */
export function logMusicSummary(
  log: {info: (obj: object, msg: string) => void},
  input: {renderJobId: string; blueprintId?: string; where: 'local' | 'lambda'; audioDesign: AudioDesign | undefined; master?: MasterPassResult | null},
): void {
  try {
    log.info(
      {renderJobId: input.renderJobId, blueprintId: input.blueprintId, where: input.where, ...buildMusicSummary({audioDesign: input.audioDesign, master: input.master, masterRequested: true})},
      'music.summary',
    );
  } catch {
    // ignore
  }
}
