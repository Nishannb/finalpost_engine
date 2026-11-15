/**
 * Measures the creator's voice activity in the OUTPUT timeline (local ffmpeg decode; no network, no model). The pure analysis is
 * audioPlan/voiceActivity.ts; this file only decodes the source audio and maps it through the edit's kept segments.
 */
import {execFile} from 'node:child_process';

import {VOICE_ACTIVITY, voiceActivityFromFrames, type VoiceActivityMap} from '../audioPlan/voiceActivity.ts';

export type KeepSegment = {sourceStart: number; sourceEnd: number; outputStart: number};

const SAMPLE_RATE = 16000;

/** Source-domain frame levels (dBFS) from mono 16-bit PCM. */
export function frameLevelsDb(pcm: Int16Array, sampleRate = SAMPLE_RATE, frameSec = VOICE_ACTIVITY.frameSec): Float64Array {
  const hop = Math.round(sampleRate * frameSec);
  const frames = Math.floor(pcm.length / hop);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 1) {
      const v = pcm[i]! / 32768;
      sum += v * v;
    }
    out[f] = 20 * Math.log10(Math.sqrt(sum / hop) + 1e-9);
  }
  return out;
}

/** Output-domain frame levels: each output frame takes the source frame its centre maps to; frames outside every kept segment are NaN (never silent). */
export function mapFramesToOutput(sourceDb: Float64Array, segments: readonly KeepSegment[], outputDurationSec: number, frameSec = VOICE_ACTIVITY.frameSec): number[] {
  const count = Math.max(0, Math.floor(outputDurationSec / frameSec + 1e-6));
  const out: number[] = new Array(count).fill(Number.NaN);
  for (let k = 0; k < count; k += 1) {
    const t = (k + 0.5) * frameSec;
    const segment = segments.find(item => t >= item.outputStart - 1e-9 && t < item.outputStart + (item.sourceEnd - item.sourceStart));
    if (!segment) continue;
    const index = Math.floor((segment.sourceStart + (t - segment.outputStart)) / frameSec);
    if (index >= 0 && index < sourceDb.length) out[k] = sourceDb[index]!;
  }
  return out;
}

/** Null on any decode failure or when no speech/silence contrast exists (callers then allow speech-clear placements only). */
export async function measureVoiceActivity(input: {audioPath: string; segments: readonly KeepSegment[]; outputDurationSec: number; ffmpegBin?: string}): Promise<VoiceActivityMap | null> {
  try {
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        input.ffmpegBin ?? (process.env.FFMPEG_PATH || 'ffmpeg'),
        ['-v', 'error', '-i', input.audioPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'],
        {encoding: 'buffer', maxBuffer: 512 * 1024 * 1024},
        (error, stdout) => (error ? reject(error) : resolve(stdout as Buffer)),
      );
    });
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    return voiceActivityFromFrames(mapFramesToOutput(frameLevelsDb(samples), input.segments, input.outputDurationSec));
  } catch {
    return null;
  }
}
