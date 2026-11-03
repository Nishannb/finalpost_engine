import type {TimeRange, WordToken} from '../../types/blueprint.ts';
import {energySpeechRegions, refineWordBounds, selectPausePolicy} from '../filters/speechActivity.ts';
import {decodeMonoPcm} from './deliveryAcoustics.ts';

const SAMPLE_RATE = 16_000;
const MIN_WORDS_FOR_REGION_CHECK = 6;

export type PreparedSpeechCuts = {
  words: WordToken[];
  speechRegions: TimeRange[] | null;
  pausePolicy?: {intentionalMaxSec: number; preservedSec: number; minGapSec: number};
  warning?: string;
};

/** Never throws: any failure returns the original words with speechRegions null so the legacy ASR-gap cutter runs. */
export async function prepareSpeechCuts(input: {
  audioPath: string;
  words: WordToken[];
  durationSec: number;
}): Promise<PreparedSpeechCuts> {
  const skip = (reason: string): PreparedSpeechCuts => ({
    words: input.words,
    speechRegions: null,
    warning: `vad_skipped:${reason}`,
  });
  try {
    const pcm = await decodeMonoPcm(input.audioPath);
    if (pcm.length === 0) return skip('empty_pcm');
    const regions = energySpeechRegions(pcm, SAMPLE_RATE, {words: input.words});
    if (input.words.length >= MIN_WORDS_FOR_REGION_CHECK && regions.length === 0) return skip('no_speech_regions');
    const words = refineWordBounds(input.words, regions);
    const {musicBed: _musicBed, ...pausePolicy} = selectPausePolicy({
      speech: regions,
      words,
      durationSec: input.durationSec,
    });
    return {words, speechRegions: regions, pausePolicy};
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error))
      .split('\n')[0]!
      .replace(/\/\S+/g, '')
      .replace(/[^\w ]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40);
    return skip(reason || 'error');
  }
}
