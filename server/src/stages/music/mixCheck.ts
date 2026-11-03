import type {AudioDesign} from '../../types/blueprint.ts';

/**
 * LU between the voice and the bed, from what was measured and applied (not from a mixed file,
 * where the voice contaminates the bed measurement). Null when the numbers are not there.
 */
export function mixCheckFor(audio: AudioDesign | undefined): {speechGapLu: number; pauseGapLu: number; voLufs: number; bedLufs: number} | null {
  const duck = audio?.duck;
  if (!audio || audio.musicSource !== 'generated' || !duck) return null;
  const voLufs = audio.voLufs ?? duck.voLufs;
  const bedLufs = duck.bedLufs ?? -16;
  if (voLufs === undefined) return null;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    voLufs,
    bedLufs,
    speechGapLu: round(voLufs - (bedLufs + duck.speechDb)),
    pauseGapLu: round(voLufs - (bedLufs + duck.pauseDb)),
  };
}

/** Informational only: logs how far under the voice the generated bed sits. Never throws, never fails a render. */
export function logMixCheck(log: {info: (obj: object, msg: string) => void}, blueprint: {blueprintId?: string; audioDesign?: AudioDesign}): void {
  try {
    const mix = mixCheckFor(blueprint.audioDesign);
    if (mix) log.info({blueprintId: blueprint.blueprintId, ...mix}, 'music.mix_check');
  } catch {
    // ignore
  }
}
