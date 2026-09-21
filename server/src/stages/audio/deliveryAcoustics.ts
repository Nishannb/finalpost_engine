/**
 * Local, deterministic speech analysis. No external model calls.
 *
 * FFmpeg decodes mono PCM; TypeScript computes short-time RMS and an
 * autocorrelation F0 estimate. Results are stored in the cached blueprint.
 */

import {spawn} from 'node:child_process';

import {env} from '../../config/env.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {
  AcousticSentence,
  LoudnessStats,
} from '../../lib/deliveryShaping.ts';

const log = stageLogger('delivery-acoustics');
const SAMPLE_RATE = 16_000;

export async function analyzeDeliveryAcoustics(input: {
  sourcePath: string;
  sentences: Array<{start: number; end: number}>;
  words: Array<{start: number; end: number}>;
}): Promise<{sentences: AcousticSentence[]; loudness: LoudnessStats}> {
  const started = Date.now();
  const [pcm, loudness] = await Promise.all([
    decodePcm(input.sourcePath),
    measureLoudness(input.sourcePath),
  ]);
  const sentences = input.sentences.map((sentence, sentenceIndex) => {
    const from = Math.max(0, Math.floor(sentence.start * SAMPLE_RATE));
    const to = Math.min(pcm.length, Math.ceil(sentence.end * SAMPLE_RATE));
    const samples = pcm.subarray(from, to);
    const frames = frameFeatures(samples);
    const pitch = frames.map(frame => frame.pitchHz).filter(value => value > 0);
    const energies = frames.map(frame => frame.energyDb).filter(Number.isFinite);
    const sentenceWords = input.words.filter(
      word => word.end > sentence.start && word.start < sentence.end,
    );
    const duration = Math.max(0.1, sentence.end - sentence.start);
    const wordsPerSec = sentenceWords.length / duration;
    const next = input.sentences[sentenceIndex + 1];
    const naturalPauseAfterMs = next
      ? Math.max(0, (next.start - sentence.end) * 1_000)
      : 0;
    const pitchVariance = variance(pitch);
    const energyVariance = variance(energies);
    const rateSteadiness = 1 - clamp(Math.abs(wordsPerSec - 2.6) / 3, 0, 1);
    const lowPitchVariation = 1 - clamp(pitchVariance / 850, 0, 1);
    const lowEnergyVariation = 1 - clamp(energyVariance / 18, 0, 1);
    return {
      sentenceIndex,
      start: round(sentence.start),
      end: round(sentence.end),
      pitchMeanHz: round(mean(pitch), 2),
      pitchVariance: round(pitchVariance, 2),
      energyMeanDb: round(mean(energies, -60), 2),
      energyVariance: round(energyVariance, 2),
      wordsPerSec: round(wordsPerSec, 3),
      monotonyScore: round(
        clamp(
          lowPitchVariation * 0.45 +
            lowEnergyVariation * 0.4 +
            rateSteadiness * 0.15,
          0,
          1,
        ),
        3,
      ),
      naturalPauseAfterMs: Math.round(naturalPauseAfterMs),
    };
  });
  log.info(
    {
      ms: Date.now() - started,
      sentences: sentences.length,
      meanMonotony: round(mean(sentences.map(item => item.monotonyScore)), 3),
      loudness,
    },
    'delivery acoustic analysis complete',
  );
  return {sentences, loudness};
}

async function decodePcm(path: string): Promise<Float32Array> {
  const bytes = await runBuffer(env.FFMPEG_PATH, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-f',
    'f32le',
    'pipe:1',
  ]);
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

export async function measureLoudness(path: string): Promise<LoudnessStats> {
  const stderr = await runText(env.FFMPEG_PATH, [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-vn',
    '-af',
    'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
    '-f',
    'null',
    '-',
  ]);
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) {
    return {integratedLufs: -24, truePeakDbtp: -3};
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      input_i?: string;
      input_tp?: string;
    };
    return {
      integratedLufs: finite(Number(parsed.input_i), -24),
      truePeakDbtp: finite(Number(parsed.input_tp), -3),
    };
  } catch {
    return {integratedLufs: -24, truePeakDbtp: -3};
  }
}

function frameFeatures(samples: Float32Array): Array<{
  energyDb: number;
  pitchHz: number;
}> {
  const frameSize = Math.round(SAMPLE_RATE * 0.03);
  const hop = Math.round(SAMPLE_RATE * 0.015);
  const out: Array<{energyDb: number; pitchHz: number}> = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hop) {
    const frame = samples.subarray(offset, offset + frameSize);
    let energy = 0;
    for (const sample of frame) {
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / frame.length);
    const energyDb = 20 * Math.log10(Math.max(1e-8, rms));
    out.push({
      energyDb,
      pitchHz: energyDb > -48 ? estimatePitch(frame) : 0,
    });
  }
  return out;
}

function estimatePitch(frame: Float32Array): number {
  const minLag = Math.floor(SAMPLE_RATE / 350);
  const maxLag = Math.ceil(SAMPLE_RATE / 70);
  let bestLag = 0;
  let best = 0;
  let zero = 0;
  for (const sample of frame) {
    zero += sample * sample;
  }
  if (zero < 1e-6) {
    return 0;
  }
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    let norm = 0;
    for (let index = 0; index < frame.length - lag; index += 1) {
      corr += frame[index]! * frame[index + lag]!;
      norm += frame[index + lag]! * frame[index + lag]!;
    }
    const normalized = corr / Math.sqrt(Math.max(1e-9, zero * norm));
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }
  return best >= 0.32 && bestLag > 0 ? SAMPLE_RATE / bestLag : 0;
}

function runBuffer(bin: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', code =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg PCM analysis failed (${code}): ${stderr.slice(-500)}`)),
    );
  });
}

function runText(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', code =>
      code === 0
        ? resolve(stderr)
        : reject(new Error(`ffmpeg loudness analysis failed (${code})`)),
    );
  });
}

function mean(values: number[], fallback = 0): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function variance(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return mean(values.map(value => (value - average) ** 2));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
