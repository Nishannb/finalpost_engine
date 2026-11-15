/**
 * Groq pre-compaction (GROQ_PRECOMPACT, default off).
 *
 * Groq bills per audio minute, and talking-head clips carry long dead air. Before Stage A uploads speech.ogg we build a second file, speech.groq.ogg, in which every silence
 * longer than MAX_GAP_SEC is shortened to KEEP_GAP_SEC. Groq transcribes that shorter file; every word time is then mapped back to the original clock with a sample-exact time
 * map, so everything after Stage A (trim, captions, b-roll, music, render) sees the same timeline as before. speech.ogg and the video are never touched.
 *
 * - Speech detection reuses the local energy VAD (stages/filters/speechActivity.ts energySpeechRegions) on the same 16 kHz decode (stages/audio/deliveryAcoustics.ts
 *   decodeMonoPcm), with a more permissive floor than the cut path: missing quiet speech costs words, keeping a little noise only costs a few billed seconds.
 * - Nothing is filtered or gated: kept audio is copied sample for sample; only a 5 ms fade at each seam avoids a click.
 * - Silence is shortened by keeping original audio on both sides of a cut (KEEP_GAP_SEC / 2 each), so no synthetic silence is inserted and every kept piece is contiguous source.
 * - Any doubt (no speech found, too little speech, saving too small, ffmpeg error, encoded length off) returns `applied: false` and the caller uploads speech.ogg exactly as today.
 */

import fs from 'node:fs/promises';

import {env} from '../../config/env.ts';
import {stageLogger} from '../../lib/logger.ts';
import {observe} from '../../lib/runObserver.ts';
import {encodeSpeechPcm} from '../../media/ffmpeg.ts';
import type {LanguageCode, WordToken} from '../../types/blueprint.ts';
import {decodeMonoPcm} from '../audio/deliveryAcoustics.ts';
import {energySpeechRegions, type SpeechRegion} from '../filters/speechActivity.ts';
import {GROQ_USD_PER_AUDIO_HOUR, transcribeAudio, type TranscriptionResult} from './groqTranscribe.ts';

const log = stageLogger('stage-a-precompact');

export const PRECOMPACT_SAMPLE_RATE = 16_000;

export type CompactionOptions = {
  /** Audio kept on each side of every detected speech region. */
  padSec: number;
  /** Silences (after padding) longer than this are shortened. Shorter gaps are left exactly as they are. */
  maxGapSec: number;
  /** What a shortened silence becomes: half kept after the speech before it, half before the speech after it. */
  keepGapSec: number;
};

export const DEFAULT_COMPACTION: CompactionOptions = {padSec: 0.2, maxGapSec: 0.8, keepGapSec: 0.3};

/** Skip compaction unless it saves at least this much (seconds and fraction): a near-continuous clip or a music bed is uploaded as is. */
const MIN_SAVED_SEC = 1;
const MIN_SAVED_FRAC = 0.05;
/** Too little detected speech means the detector is not trustworthy on this clip (silence-only, or speech far below the floor). */
const MIN_SPEECH_SEC = 0.5;
const MIN_SPEECH_COVERAGE = 0.1;
/** Encoded file length must match the planned length to within this, or the time map would be wrong. */
const MAX_ENCODE_DRIFT_SEC = 0.05;
const SEAM_FADE_SEC = 0.005;
/** VAD settings for compaction only: permissive, so quiet speech is kept. */
const VAD_MARGIN_DB = 8;
const VAD_ABSOLUTE_FLOOR_DB = -60;

/**
 * Cache-key part for compacted uploads. The compacted bytes already differ from speech.ogg, but this also keeps a compacted-clock result from ever being read as an
 * original-clock one. Bump on any change to the plan or the mapping.
 */
export function precompactCacheVariant(options: CompactionOptions = DEFAULT_COMPACTION): string {
  return `precompact-v1;pad=${options.padSec};gap=${options.maxGapSec};keep=${options.keepGapSec}`;
}

/** One kept piece: source samples [srcStart, srcEnd) sit at compacted samples [dstStart, dstStart + (srcEnd - srcStart)). Integers, so no drift. */
export type TimeMapSegment = {srcStart: number; srcEnd: number; dstStart: number};

export type TimeMap = {
  sampleRate: number;
  sourceSamples: number;
  compactSamples: number;
  segments: TimeMapSegment[];
};

/** Kept source ranges, in samples. Pure; deterministic for a given input. */
export function planCompaction(
  regions: SpeechRegion[],
  totalSamples: number,
  sampleRate: number,
  options: CompactionOptions = DEFAULT_COMPACTION,
): Array<[number, number]> {
  if (totalSamples <= 0) return [];
  const pad = Math.round(options.padSec * sampleRate);
  const maxGap = Math.round(options.maxGapSec * sampleRate);
  const half = Math.round((options.keepGapSec * sampleRate) / 2);

  const padded = regions
    .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map(r => [Math.max(0, Math.floor(r.start * sampleRate) - pad), Math.min(totalSamples, Math.ceil(r.end * sampleRate) + pad)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  if (padded.length === 0) return [[0, totalSamples]];

  // Merge overlapping and touching regions, and any whose gap is short enough to keep.
  const speech: Array<[number, number]> = [];
  for (const r of padded) {
    const prev = speech.at(-1);
    if (prev && r[0] - prev[1] <= maxGap) prev[1] = Math.max(prev[1], r[1]);
    else speech.push([r[0], r[1]]);
  }

  // Each kept range runs from (speech start, minus up to `half` of the silence before it) to (speech end, plus up to `half` of the silence after it).
  // A silence at or under maxGap was already merged above, so every remaining gap is cut; the leading and trailing gaps are cut only if they are long.
  const keep: Array<[number, number]> = [];
  for (let i = 0; i < speech.length; i += 1) {
    const [s, e] = speech[i]!;
    const start = i === 0 ? (s > maxGap ? s - half : 0) : s - half;
    const trailing = totalSamples - e;
    const end = i === speech.length - 1 ? (trailing > maxGap ? e + half : totalSamples) : e + half;
    const prevEnd = keep.at(-1)?.[1] ?? 0;
    const from = Math.max(0, prevEnd, start);
    const to = Math.min(totalSamples, end);
    if (to > from) keep.push([from, to]);
  }
  return keep;
}

export function buildTimeMap(keep: Array<[number, number]>, sourceSamples: number, sampleRate: number): TimeMap {
  const segments: TimeMapSegment[] = [];
  let dst = 0;
  for (const [s, e] of keep) {
    if (e <= s) continue;
    segments.push({srcStart: s, srcEnd: e, dstStart: dst});
    dst += e - s;
  }
  return {sampleRate, sourceSamples, compactSamples: dst, segments};
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Index of the segment holding compacted time t. At a seam, a start belongs to the later segment and an end to the earlier one. */
function segmentIndexAt(map: TimeMap, tSamples: number, side: 'start' | 'end'): number {
  const segs = map.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const midStart = segs[mid]!.dstStart;
    if (side === 'start' ? midStart <= tSamples : midStart < tSamples) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Source time (seconds) for compacted time t (seconds), clamped to [0, source duration]. */
export function mapCompactTime(map: TimeMap, tSec: number, side: 'start' | 'end' = 'start'): number {
  const sourceSec = map.sourceSamples / map.sampleRate;
  if (map.segments.length === 0 || !Number.isFinite(tSec)) return Math.min(Math.max(0, Number.isFinite(tSec) ? tSec : 0), sourceSec);
  const t = tSec * map.sampleRate;
  const seg = map.segments[segmentIndexAt(map, t, side)]!;
  const src = seg.srcStart + Math.max(0, t - seg.dstStart);
  return round6(Math.min(Math.max(0, src / map.sampleRate), sourceSec));
}

/**
 * Map Groq words (compacted clock) back to the source clock. Order is kept, starts never go backwards, end >= start, all within [0, source duration].
 * A word that straddles a seam is kept on the side holding most of it and clipped at that side's edge, so it never spans removed silence.
 */
export function mapWordsToSource(words: WordToken[], map: TimeMap): WordToken[] {
  const sr = map.sampleRate;
  const sourceSec = map.sourceSamples / sr;
  const out: WordToken[] = [];
  for (const w of words) {
    let start = mapCompactTime(map, w.start, 'start');
    let end = mapCompactTime(map, Math.max(w.start, w.end), 'end');
    if (map.segments.length > 0) {
      const a = segmentIndexAt(map, w.start * sr, 'start');
      const b = segmentIndexAt(map, Math.max(w.start, w.end) * sr, 'end');
      if (b > a) {
        const segA = map.segments[a]!;
        const segB = map.segments[b]!;
        const inA = segA.dstStart + (segA.srcEnd - segA.srcStart) - w.start * sr;
        const inB = w.end * sr - segB.dstStart;
        if (inA >= inB) end = round6(segA.srcEnd / sr);
        else start = round6(segB.srcStart / sr);
      }
    }
    const prev = out.at(-1);
    if (prev && start < prev.start) start = prev.start;
    start = Math.min(Math.max(0, start), sourceSec);
    end = Math.min(Math.max(start, end), sourceSec);
    out.push({...w, start, end});
  }
  return out;
}

export type CompactionStats = {
  originalSec: number;
  compactSec: number;
  /** Source time outside detected speech regions (before padding). */
  originalSilenceSec: number;
  removedSec: number;
  reductionPct: number;
  speechRegions: number;
  keptSegments: number;
};

export type CompactionResult =
  | {applied: true; path: string; bytes: number; map: TimeMap; stats: CompactionStats}
  | {applied: false; reason: string; stats?: CompactionStats};

const unionSec = (regions: SpeechRegion[]): number => {
  let total = 0;
  let curS = 0;
  let curE = Number.NEGATIVE_INFINITY;
  for (const r of [...regions].sort((a, b) => a.start - b.start)) {
    if (r.start > curE) {
      if (curE > curS) total += curE - curS;
      curS = r.start;
      curE = r.end;
    } else curE = Math.max(curE, r.end);
  }
  if (curE > curS) total += curE - curS;
  return total;
};

/** Copy the kept ranges of `pcm` into one buffer, with a short fade on each side of every seam. */
export function assembleCompactPcm(pcm: Float32Array, map: TimeMap): Float32Array {
  const out = new Float32Array(map.compactSamples);
  const fade = Math.max(1, Math.round(SEAM_FADE_SEC * map.sampleRate));
  map.segments.forEach((seg, i) => {
    out.set(pcm.subarray(seg.srcStart, seg.srcEnd), seg.dstStart);
    const len = seg.srcEnd - seg.srcStart;
    const n = Math.min(fade, Math.floor(len / 2));
    if (i > 0) for (let k = 0; k < n; k += 1) out[seg.dstStart + k]! *= k / n;
    if (i < map.segments.length - 1) for (let k = 0; k < n; k += 1) out[seg.dstStart + len - 1 - k]! *= k / n;
  });
  return out;
}

const SEED_FRAME_SEC = 0.02;
const SEED_HOP_SEC = 0.01;
/** Frames within this of the clip's loud level (95th percentile) seed the speech-level estimate. */
const SEED_BELOW_P95_DB = 20;
/** A clip whose loud and quiet frames differ by less than this is flat (silence, steady music or noise): no seed. */
const SEED_MIN_SPREAD_DB = 10;

/**
 * Before ASR there are no words to tell energySpeechRegions where speech is, and without them it reads the speech level from the 75th-percentile frame. When speech covers
 * under ~25% of the clip (exactly the clips with the most silence to remove) that percentile is noise and the whole clip reads as speech. The loudest frames stand in for the
 * words here: they only set the speech/noise level estimate; detection itself is unchanged. A flat clip gets no seed and the default estimate.
 */
export function loudSeedSpans(pcm: Float32Array, sampleRate: number): Array<{start: number; end: number}> {
  const frame = Math.max(1, Math.round(SEED_FRAME_SEC * sampleRate));
  const hop = Math.max(1, Math.round(SEED_HOP_SEC * sampleRate));
  if (pcm.length < frame) return [];
  const count = Math.floor((pcm.length - frame) / hop) + 1;
  const db = new Float64Array(count);
  const finiteDb: number[] = [];
  for (let f = 0; f < count; f += 1) {
    let sum = 0;
    for (let i = f * hop; i < f * hop + frame; i += 1) sum += pcm[i]! * pcm[i]!;
    const rms = Math.sqrt(sum / frame);
    db[f] = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
    if (Number.isFinite(db[f]!)) finiteDb.push(db[f]!);
  }
  if (finiteDb.length < 10) return [];
  finiteDb.sort((a, b) => a - b);
  const pct = (p: number) => finiteDb[Math.min(finiteDb.length - 1, Math.round((finiteDb.length - 1) * p))]!;
  const p95 = pct(0.95);
  if (p95 - pct(0.1) < SEED_MIN_SPREAD_DB) return [];
  const cut = p95 - SEED_BELOW_P95_DB;
  const spans: Array<{start: number; end: number}> = [];
  for (let f = 0; f < count; f += 1) {
    if (!(db[f]! >= cut)) continue;
    const start = (f * hop) / sampleRate;
    const end = (f * hop + frame) / sampleRate;
    const prev = spans.at(-1);
    if (prev && start <= prev.end) prev.end = end;
    else spans.push({start, end});
  }
  return spans;
}

export type CompactionDeps = {
  decode?: (path: string) => Promise<Float32Array>;
  encode?: typeof encodeSpeechPcm;
};

/** Build speech.groq.ogg from speech.ogg. Never throws and never writes `audioPath`; `applied: false` means "upload the original". */
export async function compactSpeechAudio(
  input: {audioPath: string; outputPath: string; options?: CompactionOptions},
  deps: CompactionDeps = {},
): Promise<CompactionResult> {
  const options = input.options ?? DEFAULT_COMPACTION;
  const decode = deps.decode ?? decodeMonoPcm;
  const encode = deps.encode ?? encodeSpeechPcm;
  const sr = PRECOMPACT_SAMPLE_RATE;
  if (input.outputPath === input.audioPath) return {applied: false, reason: 'output_is_input'};
  const rawPath = `${input.outputPath}.f32`;
  try {
    const pcm = await decode(input.audioPath);
    if (pcm.length === 0) return {applied: false, reason: 'empty_pcm'};
    const originalSec = pcm.length / sr;
    const regions = energySpeechRegions(pcm, sr, {words: loudSeedSpans(pcm, sr), marginDb: VAD_MARGIN_DB, absoluteFloorDb: VAD_ABSOLUTE_FLOOR_DB});
    const speechSec = unionSec(regions);
    const map = buildTimeMap(planCompaction(regions, pcm.length, sr, options), pcm.length, sr);
    const compactSec = map.compactSamples / sr;
    const stats: CompactionStats = {
      originalSec: round6(originalSec),
      compactSec: round6(compactSec),
      originalSilenceSec: round6(Math.max(0, originalSec - speechSec)),
      removedSec: round6(originalSec - compactSec),
      reductionPct: Math.round(((originalSec - compactSec) / originalSec) * 1000) / 10,
      speechRegions: regions.length,
      keptSegments: map.segments.length,
    };
    if (regions.length === 0) return {applied: false, reason: 'no_speech_regions', stats};
    if (speechSec < MIN_SPEECH_SEC || speechSec / originalSec < MIN_SPEECH_COVERAGE) return {applied: false, reason: 'speech_coverage_low', stats};
    if (originalSec - compactSec < MIN_SAVED_SEC || (originalSec - compactSec) / originalSec < MIN_SAVED_FRAC) {
      return {applied: false, reason: 'saving_too_small', stats};
    }

    const compact = assembleCompactPcm(pcm, map);
    await fs.writeFile(rawPath, Buffer.from(compact.buffer, compact.byteOffset, compact.byteLength));
    const encoded = await encode({rawPath, sampleRate: sr, outputPath: input.outputPath});
    const check = await decode(encoded.path);
    if (Math.abs(check.length - map.compactSamples) / sr > MAX_ENCODE_DRIFT_SEC) {
      return {applied: false, reason: 'encoded_length_mismatch', stats};
    }
    return {applied: true, path: encoded.path, bytes: encoded.bytes, map, stats};
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error))
      .split('\n')[0]!
      .replace(/\/\S+/g, '')
      .replace(/[^\w ]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40);
    return {applied: false, reason: `error:${reason || 'unknown'}`};
  } finally {
    await fs.rm(rawPath, {force: true}).catch(() => undefined);
  }
}

type TranscribeInput = {
  audioPath: string;
  audioBytes: number;
  languageCode: LanguageCode | 'auto';
  durationSec: number;
  cacheDir?: string;
};

/**
 * Stage A entry for the pipeline. Flag off: exactly `transcribeAudio(input)`. Flag on: compact, transcribe the compacted file, map words back to the source clock.
 * The returned result has the usual shape and source-clock words; `estimatedCostUsd` reflects the billed (compacted) minutes.
 */
export async function transcribeWithPrecompact(
  input: TranscribeInput & {compactPath: string},
  deps: CompactionDeps & {enabled?: boolean; transcribe?: typeof transcribeAudio} = {},
): Promise<TranscriptionResult> {
  const transcribe = deps.transcribe ?? transcribeAudio;
  const {compactPath, ...base} = input;
  if (!(deps.enabled ?? env.GROQ_PRECOMPACT)) return transcribe(base);

  const compaction = await compactSpeechAudio({audioPath: input.audioPath, outputPath: compactPath}, deps);
  const event = {
    applied: compaction.applied,
    fallback: !compaction.applied,
    reason: compaction.applied ? null : compaction.reason,
    ...(compaction.stats ?? {}),
  };
  log.info(event, compaction.applied ? 'groq precompact applied' : 'groq precompact skipped; uploading original audio');
  observe(() => ({type: 'transcription_precompact', ...event}));
  if (!compaction.applied) return transcribe(base);

  const compactSec = compaction.map.compactSamples / compaction.map.sampleRate;
  const result = await transcribe({
    ...base,
    audioPath: compaction.path,
    audioBytes: compaction.bytes,
    durationSec: compactSec,
    cacheVariant: precompactCacheVariant(),
  });
  const billedSec = result.audioDurationSec || compactSec;
  return {
    ...result,
    words: mapWordsToSource(result.words, compaction.map),
    audioDurationSec: compaction.map.sourceSamples / compaction.map.sampleRate,
    estimatedCostUsd: (billedSec / 3600) * GROQ_USD_PER_AUDIO_HOUR,
  };
}
