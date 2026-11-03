/**
 * Builds the ducking envelope stored on AudioDesign.
 * PARITY: the curve is evaluated again in remotion/src/audio/duckEnvelope.ts.
 * The two files must stay in step; server/src/stages/music/musicBed.test.ts checks they agree.
 *
 * speechDb / pauseDb / openDb are GAIN dB applied to the bed file. Remotion only evaluates them.
 *  - default / legacy_brief: absolute gains, for a bed normalized to −16 LUFS.
 *  - talking: computed here as clamp((voLufs + offsetLu) − bedLufs, −40, 0), so the bed
 *    sits a fixed number of LU under the measured voice.
 * Attack ends at the phrase onset (look-ahead). Interpolation is in dB.
 */

export type DuckPresetName = 'talking' | 'default' | 'legacy_brief';

export type DuckPhrase = {start: number; end: number};

export type DuckEnvelope = {
  preset: DuckPresetName;
  speechDb: number;
  pauseDb: number;
  openDb: number;
  attackSec: number;
  holdSec: number;
  releaseSec: number;
  phrases: DuckPhrase[];
  durationSec: number;
  /** talking only: the loudness the gains were derived from (for the music.mix_check log). */
  voLufs?: number;
  bedLufs?: number;
};

/** talking preset: LU under the voice. */
export const TALKING_OFFSETS_LU = {speech: -18, pause: -9, open: -4} as const;
export const VO_LUFS_ASSUMED = -20;
export const BED_LUFS_ASSUMED = -16;
export const DUCK_MIN_GAIN_DB = -40;

export const clampGainDb = (value: number) => Math.min(0, Math.max(DUCK_MIN_GAIN_DB, value));

export const DUCK_PRESETS: Record<Exclude<DuckPresetName, 'talking'>, {speechDb: number; pauseDb: number; openDb: number}> = {
  default: {speechDb: -13, pauseDb: -7, openDb: -4},
  legacy_brief: {speechDb: -22, pauseDb: -12, openDb: -12},
};

export const DUCK_ATTACK_SEC = 0.08;
export const DUCK_HOLD_SEC = 0.15;
export const DUCK_RELEASE_SEC = 0.45;
export const DUCK_MERGE_GAP_SEC = 0.35;
export const DUCK_PAUSE_GAP_SEC = 0.6;

const lerp = (a: number, b: number, u: number) => a + (b - a) * Math.min(1, Math.max(0, u));

export function mergeSpeechPhrases(words: ReadonlyArray<{start: number; end: number}>): DuckPhrase[] {
  const sorted = words.filter(word => word.end > word.start).sort((a, b) => a.start - b.start);
  const phrases: DuckPhrase[] = [];
  for (const word of sorted) {
    const last = phrases[phrases.length - 1];
    if (last && word.start - last.end < DUCK_MERGE_GAP_SEC) last.end = Math.max(last.end, word.end);
    else phrases.push({start: word.start, end: word.end});
  }
  return phrases;
}

export function buildDuckEnvelope(input: {
  words: ReadonlyArray<{start: number; end: number}>;
  durationSec: number;
  preset?: DuckPresetName;
  /** talking: speech-gated integrated loudness of the creator audio. */
  voLufs?: number;
  /** talking: integrated loudness of the bed file. Default −16 (the postprocess target). */
  bedLufs?: number;
}): DuckEnvelope {
  const preset = input.preset ?? 'talking';
  const voLufs = input.voLufs ?? VO_LUFS_ASSUMED;
  const bedLufs = input.bedLufs ?? BED_LUFS_ASSUMED;
  const gains = preset === 'talking'
    ? {
        speechDb: clampGainDb(voLufs + TALKING_OFFSETS_LU.speech - bedLufs),
        pauseDb: clampGainDb(voLufs + TALKING_OFFSETS_LU.pause - bedLufs),
        openDb: clampGainDb(voLufs + TALKING_OFFSETS_LU.open - bedLufs),
      }
    : DUCK_PRESETS[preset];
  return {
    preset,
    ...gains,
    ...(preset === 'talking' ? {voLufs, bedLufs} : {}),
    attackSec: DUCK_ATTACK_SEC,
    holdSec: DUCK_HOLD_SEC,
    releaseSec: DUCK_RELEASE_SEC,
    phrases: mergeSpeechPhrases(input.words),
    durationSec: Math.max(0, input.durationSec),
  };
}

function afterPhraseDb(envelope: DuckEnvelope, gapSec: number | null): number {
  if (gapSec === null) return envelope.openDb;
  // talking: a gap shorter than 600 ms is not a pause; the bed stays under speech.
  if (envelope.preset === 'talking' && gapSec < DUCK_PAUSE_GAP_SEC) return envelope.speechDb;
  return envelope.pauseDb;
}

function regionDb(envelope: DuckEnvelope, timeSec: number): number {
  const {phrases, speechDb, holdSec, releaseSec} = envelope;
  if (phrases.length === 0) return envelope.openDb;
  const first = phrases[0]!;
  const last = phrases[phrases.length - 1]!;
  if (timeSec < first.start) return envelope.openDb;

  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = phrases[i]!;
    const next = phrases[i + 1];
    if (timeSec >= phrase.start && timeSec < phrase.end + holdSec) return speechDb;
    const releaseStart = phrase.end + holdSec;
    const releaseEnd = releaseStart + releaseSec;
    if (timeSec >= releaseStart && timeSec < releaseEnd) {
      const gap = next ? next.start - phrase.end : null;
      return lerp(speechDb, afterPhraseDb(envelope, gap), (timeSec - releaseStart) / releaseSec);
    }
    if (next && timeSec >= phrase.end && timeSec < next.start) return afterPhraseDb(envelope, next.start - phrase.end);
  }
  if (timeSec >= last.end) return envelope.openDb;
  return speechDb;
}

/** dB at a timeline second. The attack is a straight ramp that ends on the word. */
export function duckDbAt(envelope: DuckEnvelope, timeSec: number): number {
  const t = Math.min(Math.max(timeSec, 0), Math.max(envelope.durationSec, 0));
  for (const phrase of envelope.phrases) {
    const attackStart = phrase.start - envelope.attackSec;
    if (t >= attackStart && t < phrase.start) {
      const from = regionDb(envelope, attackStart);
      return lerp(from, envelope.speechDb, (t - attackStart) / envelope.attackSec);
    }
  }
  return regionDb(envelope, t);
}

export function duckLinearGainAt(envelope: DuckEnvelope, timeSec: number): number {
  return 10 ** (duckDbAt(envelope, timeSec) / 20);
}
