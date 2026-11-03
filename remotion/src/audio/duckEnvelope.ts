/**
 * One ducking language for generated beds. This file only EVALUATES the stored envelope.
 * PARITY: the envelope is built by server/src/stages/music/duckEnvelope.ts; keep the curve
 * math (regionDb, afterPhraseDb, duckDbAt) identical. server/src/stages/music/musicBed.test.ts checks they agree.
 * speechDb / pauseDb / openDb are gain dB applied to the bed file (the server computes them;
 * for the talking preset they already account for the voice and bed loudness).
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
