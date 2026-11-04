/**
 * One ducking language for generated beds. This file only EVALUATES the stored envelope.
 * PARITY: the envelope is built by server/src/stages/music/duckEnvelope.ts; keep the curve
 * math (regionDb, afterPhraseDb, duckDbAt) identical. server/src/stages/music/musicBed.test.ts checks they agree.
 * speechDb / pauseDb / openDb are gain dB applied to the bed file (the server computes them;
 * for the talking preset they already account for the voice and bed loudness).
 * Attack ends at the phrase onset minus leadSec (look-ahead; 0 on older blueprints). Interpolation is in dB.
 */

export type DuckPresetName = 'talking' | 'default' | 'legacy_brief';

export type BedLoudnessTrack = {stepSec: number; lufs: number[]};

export type DuckPhrase = {start: number; end: number};

export type DuckEnvelope = {
  preset: DuckPresetName;
  speechDb: number;
  pauseDb: number;
  openDb: number;
  attackSec: number;
  holdSec: number;
  releaseSec: number;
  /** Look-ahead: the attack ends this many seconds before the phrase onset. Absent (older blueprints) = 0, the old curve exactly. */
  leadSec?: number;
  /**
   * Loudness-aware ducking (Phase 3.1). Smoothed LUFS of the bed section that is actually playing, sampled every stepSec from video t=0 (after the placement
   * offset, the carved crossfade and the loop hand-off). Absent (older blueprints, beds without a loudness map) = no correction: the gains are the static ones.
   */
  bedLoudness?: BedLoudnessTrack;
  phrases: DuckPhrase[];
  durationSec: number;
  voLufs?: number;
  bedLufs?: number;
};

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

function afterPhraseDb(envelope: DuckEnvelope, gapSec: number | null): number {
  if (gapSec === null) return envelope.openDb;
  // talking: a gap shorter than 600 ms is not a pause; the bed stays under speech.
  if (envelope.preset === 'talking' && gapSec < DUCK_PAUSE_GAP_SEC) return envelope.speechDb;
  return envelope.pauseDb;
}

/** Gain from regions, hold, and release. Look-ahead attack is applied by duckDbAt. */
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

/** The static curve at a timeline second: regions, hold, release and the look-ahead attack, with no loudness correction. The carved crossfade reads this. */
export function duckBaseDbAt(envelope: DuckEnvelope, timeSec: number): number {
  const t = Math.min(Math.max(timeSec, 0), Math.max(envelope.durationSec, 0));
  // leadSec (absent on older blueprints = 0): the attack finishes this long BEFORE the word, so the dip is complete when the word starts.
  const lead = envelope.leadSec ?? 0;
  for (const phrase of envelope.phrases) {
    const attackEnd = phrase.start - lead;
    const attackStart = attackEnd - envelope.attackSec;
    if (t >= attackStart && t < attackEnd) {
      const from = regionDb(envelope, attackStart);
      return lerp(from, envelope.speechDb, (t - attackStart) / envelope.attackSec);
    }
    if (lead > 0 && t >= attackEnd && t < phrase.start) return envelope.speechDb;
  }
  return regionDb(envelope, t);
}


/** Never boost above the static gain by more than this: a near-silent intro is not pumped up. */
export const DUCK_LOUDNESS_MAX_BOOST_DB = 6;
/** The loudness the static gains assume for the bed (the postprocess target). */
export const DUCK_ASSUMED_BED_LUFS = -16;
const GAIN_FLOOR_DB = -40;

/** Linear interpolation of the loudness track at a video time (held at the ends). */
export function bedLoudnessAt(track: BedLoudnessTrack, timeSec: number): number {
  const {lufs, stepSec} = track;
  if (lufs.length === 0) return DUCK_ASSUMED_BED_LUFS;
  const position = Math.max(0, timeSec) / stepSec;
  const i = Math.floor(position);
  if (i >= lufs.length - 1) return lufs[lufs.length - 1]!;
  return lerp(lufs[i]!, lufs[i + 1]!, position - i);
}

/**
 * dB added to the static gain so the bed lands where the preset says whatever section of it is playing: (static assumed bed loudness) - (bed loudness now),
 * at most +DUCK_LOUDNESS_MAX_BOOST_DB. 0 for any envelope without a track, and for every preset except `talking`.
 */
export function loudnessCorrectionDb(envelope: DuckEnvelope, timeSec: number): number {
  const track = envelope.bedLoudness;
  if (!track || track.lufs.length === 0 || envelope.preset !== 'talking') return 0;
  return Math.min(DUCK_LOUDNESS_MAX_BOOST_DB, (envelope.bedLufs ?? DUCK_ASSUMED_BED_LUFS) - bedLoudnessAt(track, timeSec));
}

/**
 * dB at a timeline second: the static curve plus the loudness correction, clamped to [-40, 0]. Attack, hold, release and look-ahead are the static curve's.
 * With no loudness track this is exactly duckBaseDbAt (older blueprints are unchanged).
 */
export function duckDbAt(envelope: DuckEnvelope, timeSec: number): number {
  const base = duckBaseDbAt(envelope, timeSec);
  if (!envelope.bedLoudness) return base;
  const t = Math.min(Math.max(timeSec, 0), Math.max(envelope.durationSec, 0));
  return Math.min(0, Math.max(GAIN_FLOOR_DB, base + loudnessCorrectionDb(envelope, t)));
}

export function duckLinearGainAt(envelope: DuckEnvelope, timeSec: number): number {
  return 10 ** (duckDbAt(envelope, timeSec) / 20);
}
