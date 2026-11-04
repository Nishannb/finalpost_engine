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
