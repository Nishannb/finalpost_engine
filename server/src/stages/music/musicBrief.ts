/**
 * MusicBrief: the video described in musical terms. Pure and deterministic; no LLM, no I/O, no env.
 *
 * It reads only what the director already has when the music job starts (caption words, the content profile's mood and type, the duration,
 * the cuts known so far). Every rule lives in briefRules.json, which agents/music_specialist/prompts.py reads too.
 * The JSON is IMPORTED (not read with fs) so the production build emits it next to this file. tsc copies imported JSON only.
 *
 * Voice-first (docs/audio/VOICE_FIRST.md): a brief may change what plays and where it starts. It never changes a level.
 */

import {createHash} from 'node:crypto';

import rulesJson from './briefRules.json' with {type: 'json'};

export type MusicFamily = 'high-energy' | 'nostalgic' | 'calm' | 'tense' | 'neutral';
export type MusicArc = 'steady' | 'build' | 'hook-then-steady';
export type MusicEnergy = 'low' | 'medium' | 'high';

export type StyleRule = {
  family: MusicFamily;
  genre: string;
  moodWords: string[];
  instruments: string[];
  bpmRange: [number, number];
  mode: 'major' | 'minor';
  roots: string[];
};

export type BriefRules = {
  version: number;
  families: MusicFamily[];
  familyDefaultStyle: Record<MusicFamily, string>;
  styles: Record<string, StyleRule>;
  matrix: Record<string, Record<string, string>>;
  pace: {slowBelowWpm: number; fastAboveWpm: number; defaultWpm: number; pauseGapSec: number; cutsHighPerMin: number; cutsLowPerMin: number; minWordsForWpm: number};
  arc: {hookThenSteadyUnderSec: number; buildUpToSec: number; lyrics: Record<MusicArc, string>};
  hookAtSecDefault: number;
  supportTags: string[];
  maxCaptionTags: number;
};

export const BRIEF_RULES = rulesJson as unknown as BriefRules;
export const MUSIC_STYLES = Object.keys(BRIEF_RULES.styles);
export type MusicStyle = string;

export type MusicBrief = {
  style: MusicStyle;
  /** Pool fallback and legacy mood. */
  family: MusicFamily;
  bpm: number;
  key: string;
  speechWpm: number;
  cutsPerMin: number;
  energy: MusicEnergy;
  arc: MusicArc;
  hookAtSec: number;
  ctaAtSec: number | null;
  durationSec: number;
};

export type BriefInput = {
  videoId: string;
  captionWords: ReadonlyArray<{start: number; end: number}>;
  durationSec: number;
  /** contentProfile.mood (a VisualMood id such as warm_intimate). */
  visualMood?: string;
  /** contentProfile.contentType. */
  contentType?: string;
  /** Pool family to fall back to when mood or type is missing or unknown. */
  fallbackFamily?: MusicFamily;
  /** Cuts known when the brief is made (times in seconds, or just a count). */
  cutTimesSec?: ReadonlyArray<number>;
  cutCount?: number;
  hookAtSec?: number;
  ctaAtSec?: number | null;
  rules?: BriefRules;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const snap4 = (value: number) => Math.round(value / 4) * 4;

/** Words per minute of SPEECH time: pauses longer than rules.pace.pauseGapSec are not counted. Default pace when there are too few words. */
export function speechWpm(words: ReadonlyArray<{start: number; end: number}>, rules: BriefRules = BRIEF_RULES): number {
  const sorted = words.filter(word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start).sort((a, b) => a.start - b.start);
  if (sorted.length < rules.pace.minWordsForWpm) return rules.pace.defaultWpm;
  let speechSec = 0;
  sorted.forEach((word, index) => {
    speechSec += word.end - word.start;
    const next = sorted[index + 1];
    if (next) {
      const gap = next.start - word.end;
      if (gap > 0 && gap <= rules.pace.pauseGapSec) speechSec += gap;
    }
  });
  return speechSec > 0 ? Math.round((sorted.length / speechSec) * 60) : rules.pace.defaultWpm;
}

export function cutsPerMinute(input: {durationSec: number; cutTimesSec?: ReadonlyArray<number>; cutCount?: number}): number {
  const count = input.cutTimesSec ? input.cutTimesSec.length : input.cutCount ?? 0;
  return input.durationSec > 0 ? round1((count / input.durationSec) * 60) : 0;
}

export function energyOf(wpm: number, cutsPerMin: number, rules: BriefRules = BRIEF_RULES): MusicEnergy {
  if (wpm > rules.pace.fastAboveWpm || cutsPerMin > rules.pace.cutsHighPerMin) return 'high';
  if (wpm < rules.pace.slowBelowWpm && cutsPerMin < rules.pace.cutsLowPerMin) return 'low';
  return 'medium';
}

/**
 * Tempo from pace, inside the style's range. slow = low end, normal = middle, fast = high end. A high cut rate nudges up one band step
 * (low to middle, middle to high). The result is divisible by 4 and inside the range (range ends are divisible by 4).
 */
export function pickBpm(style: StyleRule, wpm: number, cutsPerMin: number, rules: BriefRules = BRIEF_RULES): number {
  const [lo, hi] = style.bpmRange;
  let band = wpm < rules.pace.slowBelowWpm ? 0 : wpm > rules.pace.fastAboveWpm ? 2 : 1;
  if (cutsPerMin > rules.pace.cutsHighPerMin) band = Math.min(2, band + 1);
  const raw = band === 0 ? lo : band === 2 ? hi : (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, snap4(raw)));
}

/** The style's preferred mode, with a root chosen from hash(videoId) across the style's roots: varied across videos, stable across re-renders. */
export function pickKey(style: StyleRule, videoId: string): string {
  const digest = createHash('sha256').update(`key|${videoId}`).digest();
  const root = style.roots[digest.readUInt32BE(0) % style.roots.length]!;
  return `${root} ${style.mode}`;
}

export function chooseArc(durationSec: number, energy: MusicEnergy, rules: BriefRules = BRIEF_RULES): MusicArc {
  if (durationSec < rules.arc.hookThenSteadyUnderSec) return 'hook-then-steady';
  if (durationSec <= rules.arc.buildUpToSec && energy !== 'low') return 'build';
  return 'steady';
}

/** The `settings.lyrics` string for an arc. Runware wants at least 10 characters. */
export function arcLyrics(arc: MusicArc, rules: BriefRules = BRIEF_RULES): string {
  return rules.arc.lyrics[arc];
}

/** matrix[mood][type], or the family default when either is missing or unknown. */
export function styleFor(input: {visualMood?: string; contentType?: string; fallbackFamily?: MusicFamily}, rules: BriefRules = BRIEF_RULES): {style: string; fromMatrix: boolean} {
  const hit = input.visualMood && input.contentType ? rules.matrix[input.visualMood]?.[input.contentType] : undefined;
  if (hit && rules.styles[hit]) return {style: hit, fromMatrix: true};
  return {style: rules.familyDefaultStyle[input.fallbackFamily ?? 'neutral'], fromMatrix: false};
}

export function buildMusicBrief(input: BriefInput): MusicBrief {
  const rules = input.rules ?? BRIEF_RULES;
  const durationSec = Math.max(0, input.durationSec);
  const wpm = speechWpm(input.captionWords, rules);
  const cuts = cutsPerMinute({durationSec, cutTimesSec: input.cutTimesSec, cutCount: input.cutCount});
  const energy = energyOf(wpm, cuts, rules);
  const {style} = styleFor(input, rules);
  const rule = rules.styles[style]!;
  return {
    style,
    family: rule.family,
    bpm: pickBpm(rule, wpm, cuts, rules),
    key: pickKey(rule, input.videoId),
    speechWpm: wpm,
    cutsPerMin: cuts,
    energy,
    arc: chooseArc(durationSec, energy, rules),
    hookAtSec: input.hookAtSec ?? rules.hookAtSecDefault,
    ctaAtSec: input.ctaAtSec ?? null,
    durationSec: round1(durationSec),
  };
}

/** The brief fields that change the audio. They are what the generation cache key and the pool key are built from (with the seed from hash(videoId)). */
export function briefAudioFields(brief: Pick<MusicBrief, 'style' | 'bpm' | 'key' | 'arc'>): {style: string; bpm: number; key: string; arc: MusicArc} {
  return {style: brief.style, bpm: brief.bpm, key: brief.key, arc: brief.arc};
}
