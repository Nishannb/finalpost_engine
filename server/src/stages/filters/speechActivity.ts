/**
 * Local speech-activity detection used to sharpen ASR word bounds and gate silence cuts.
 *
 * - VAD is local adaptive energy on the existing 16 kHz PCM decode (the delivery-acoustics path). No extra ASR, no LLM, no GPU.
 * - Silero/WhisperX are not wired: WhisperX is an unimplemented stub, and a neural VAD would add a native runtime. `energySpeechRegions` is the backend; a future backend only
 *   needs to return SpeechRegion[].
 * - Cost: one ffmpeg decode of the already-extracted speech.ogg. Memory is about 4 bytes x 16000 x seconds (a 5 min clip is ~19 MB) and is discarded after regions are built.
 * - Failure returns speechRegions null and the old ASR-gap cutter runs.
 */

import type {WordToken} from '../../types/blueprint.ts';
import {isFillerToken} from './autoTrim.ts';

export type SpeechRegion = {start: number; end: number};
type Span = {start: number; end: number};

const FRAME_SEC = 0.02;
const HOP_SEC = 0.01;
const RELATIVE_SPEECH_DB = 15;
/** Keep the relative branch from swallowing a noisy floor that sits close to speech level. */
const MIN_ABOVE_FLOOR_DB = 6;
const ONSET_FRAMES = 2;
const HANGOVER_FRAMES = 8;
const MERGE_GAP_SEC = 0.08;
const MIN_REGION_SEC = 0.04;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

export function energySpeechRegions(
  pcm: Float32Array,
  sampleRate: number,
  options: {words?: Span[]; marginDb?: number; absoluteFloorDb?: number} = {},
): SpeechRegion[] {
  const frameLen = Math.max(1, Math.round(FRAME_SEC * sampleRate));
  const hopLen = Math.max(1, Math.round(HOP_SEC * sampleRate));
  if (pcm.length < frameLen) return [];
  const marginDb = options.marginDb ?? 10;
  const floorDb = options.absoluteFloorDb ?? -46;
  const count = Math.floor((pcm.length - frameLen) / hopLen) + 1;

  const db = new Float64Array(count);
  let anyFinite = false;
  for (let f = 0; f < count; f += 1) {
    const from = f * hopLen;
    let sum = 0;
    for (let i = from; i < from + frameLen; i += 1) {
      const v = pcm[i]!;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / frameLen);
    db[f] = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
    if (Number.isFinite(db[f]!)) anyFinite = true;
  }
  if (!anyFinite) return [];

  const inWord = new Uint8Array(count);
  for (const w of options.words ?? []) {
    const first = Math.max(0, Math.floor((w.start - FRAME_SEC) / HOP_SEC));
    const lastF = Math.min(count - 1, Math.ceil(w.end / HOP_SEC));
    for (let f = first; f <= lastF; f += 1) {
      const t = f * HOP_SEC;
      if (t < w.end && t + FRAME_SEC > w.start) inWord[f] = 1;
    }
  }

  const all: number[] = [];
  const spoken: number[] = [];
  const unspoken: number[] = [];
  for (let f = 0; f < count; f += 1) {
    const v = db[f]!;
    if (!Number.isFinite(v)) continue;
    all.push(v);
    (inWord[f] ? spoken : unspoken).push(v);
  }
  all.sort((a, b) => a - b);
  spoken.sort((a, b) => a - b);
  unspoken.sort((a, b) => a - b);
  const speechLevel = spoken.length >= 3 ? percentile(spoken, 0.5) : percentile(all, 0.75);
  const noiseFloor = unspoken.length >= 3 ? percentile(unspoken, 0.2) : percentile(all, 0.2);
  // Clamp only when speech clearly sits above the floor; a steady bed (speech ~ floor) keeps the plain relative rule.
  const relativeThreshold =
    speechLevel - noiseFloor >= MIN_ABOVE_FLOOR_DB
      ? Math.max(speechLevel - RELATIVE_SPEECH_DB, noiseFloor + MIN_ABOVE_FLOOR_DB)
      : speechLevel - RELATIVE_SPEECH_DB;
  const floorThreshold = Math.max(noiseFloor + marginDb, floorDb);

  const isSpeech = (f: number): boolean => {
    const v = db[f]!;
    return Number.isFinite(v) && (v >= relativeThreshold || v >= floorThreshold);
  };

  const raw: SpeechRegion[] = [];
  let runStart = -1; // first frame of the current speech run
  let lastSpeech = -1;
  let speechStreak = 0;
  let silenceStreak = 0;
  let open = false;
  for (let f = 0; f < count; f += 1) {
    if (isSpeech(f)) {
      silenceStreak = 0;
      speechStreak += 1;
      if (!open) {
        if (speechStreak === 1) runStart = f;
        if (speechStreak >= ONSET_FRAMES) open = true;
      }
      if (open) lastSpeech = f;
    } else {
      speechStreak = 0;
      if (open) {
        silenceStreak += 1;
        if (silenceStreak >= HANGOVER_FRAMES) {
          raw.push({start: runStart * HOP_SEC, end: lastSpeech * HOP_SEC + FRAME_SEC});
          open = false;
          silenceStreak = 0;
        }
      }
    }
  }
  if (open) raw.push({start: runStart * HOP_SEC, end: lastSpeech * HOP_SEC + FRAME_SEC});

  const merged: SpeechRegion[] = [];
  for (const r of raw) {
    const prev = merged.at(-1);
    if (prev && r.start - prev.end < MERGE_GAP_SEC) prev.end = Math.max(prev.end, r.end);
    else merged.push({...r});
  }
  return merged.filter(r => r.end - r.start >= MIN_REGION_SEC);
}

export function refineWordBounds(words: WordToken[], speech: SpeechRegion[], snapWindowSec = 0.12): WordToken[] {
  const out: WordToken[] = [];
  const nearest = (target: number, edges: number[]): number | null => {
    let best: number | null = null;
    for (const e of edges) {
      if (Math.abs(e - target) <= snapWindowSec && (best === null || Math.abs(e - target) < Math.abs(best - target))) best = e;
    }
    return best;
  };
  const starts = speech.map(r => r.start);
  const ends = speech.map(r => r.end);

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    const prevEnd = i > 0 ? out[i - 1]!.end : 0;
    const nextStart = i < words.length - 1 ? words[i + 1]!.start : Number.POSITIVE_INFINITY;
    const mid = (w.start + w.end) / 2;
    const lo = Math.min(prevEnd, w.start);
    const hi = Math.max(nextStart, w.end);
    let start = w.start;
    let end = w.end;

    if (isFillerToken(w.text)) {
      const overlapping = speech.filter(r => r.start < w.end && r.end > w.start);
      if (overlapping.length > 0) {
        const ovStart = Math.max(w.start, Math.min(...overlapping.map(r => r.start)));
        const ovEnd = Math.min(w.end, Math.max(...overlapping.map(r => r.end)));
        if (ovEnd > ovStart) {
          start = Math.max(lo, w.start - snapWindowSec, ovStart - 0.015);
          end = Math.min(hi, w.end + snapWindowSec, ovEnd + 0.015);
        }
      }
    } else {
      const s = nearest(w.start, starts);
      if (s !== null) start = Math.min(Math.max(s, lo), mid);
      const e = nearest(w.end, ends);
      if (e !== null) end = Math.max(Math.min(e, hi), mid);
    }
    if (!(end > start)) {
      start = w.start;
      end = w.end;
    }
    out.push({...w, start, end});
  }
  return out;
}

export function selectPausePolicy(input: {speech: SpeechRegion[]; words: Span[]; durationSec: number}): {
  intentionalMaxSec: number;
  preservedSec: number;
  minGapSec: number;
  musicBed: boolean;
} {
  const duration = Math.max(input.durationSec, 0.1);
  const wordsPerSec = input.words.length / duration;
  const union = (spans: Span[]): number => {
    let total = 0;
    let curEnd = Number.NEGATIVE_INFINITY;
    let curStart = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      if (s.start > curEnd) {
        if (curEnd > curStart) total += curEnd - curStart;
        curStart = s.start;
        curEnd = s.end;
      } else curEnd = Math.max(curEnd, s.end);
    }
    if (curEnd > curStart) total += curEnd - curStart;
    return total;
  };
  const speechCoverage = union(input.speech) / duration;
  const wordCoverage = union(input.words) / duration;
  if (speechCoverage > 0.85 && wordCoverage < 0.55) {
    return {intentionalMaxSec: 0.9, preservedSec: 0.35, minGapSec: 0.9, musicBed: true};
  }
  if (wordsPerSec > 3.2) return {intentionalMaxSec: 0.5, preservedSec: 0.12, minGapSec: 0.45, musicBed: false};
  if (wordsPerSec < 1.8) return {intentionalMaxSec: 0.85, preservedSec: 0.28, minGapSec: 0.55, musicBed: false};
  return {intentionalMaxSec: 0.65, preservedSec: 0.2, minGapSec: 0.4, musicBed: false};
}
