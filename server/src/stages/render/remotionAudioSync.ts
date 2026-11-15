/**
 * Post-integration fix: Remotion's local render output carries its audio LATE by a fixed amount. Measured with click tracks through `remotion render ... ShortVideo` (Remotion
 * 4.0.524): every click lands exactly 2048 samples (42.67 ms at 48 kHz) after its source position, for an AAC source AND for a lossless PCM source, and the output audio is
 * 2048 samples longer than the source. It is the output audio path, not source decoding. Together with the denoiser's latency this put the speech ~68 ms behind the picture in
 * the 2.mp4 integration render.
 *
 * Correction: drop exactly that many leading samples (no padding: the extra samples are the surplus), video stream copied. Local renders only: the Lambda path was not
 * measured and is left unchanged. REMOTION_AUDIO_LATENCY_SAMPLES overrides the measured value (0 disables the correction); a Remotion upgrade must be re-measured
 * (remotionAudioSync.render.test.ts, opt-in RENDER_TESTS=1).
 */
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';

import {env} from '../../config/env.ts';
import {audioSampleRate} from '../../media/ffmpeg.ts';

/** Measured output latency of Remotion 4.0.524 local renders, in samples at 48 kHz. */
export const REMOTION_OUTPUT_AUDIO_LATENCY_SAMPLES_48K = 2048;

/** Samples to drop at `sampleRate` (the measured latency scaled from 48 kHz), or the override. */
export function remotionLatencySamples(sampleRate: number, override: string | undefined = process.env.REMOTION_AUDIO_LATENCY_SAMPLES): number {
  const raw = (override ?? '').trim();
  if (raw !== '') {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return Math.round((REMOTION_OUTPUT_AUDIO_LATENCY_SAMPLES_48K * sampleRate) / 48000);
}

/** The ffmpeg audio filter that removes `samples` leading samples. */
export function latencyTrimFilter(samples: number): string {
  return `atrim=start_sample=${samples},asetpts=PTS-STARTPTS`;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.FFMPEG_PATH, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))));
  });
}

/**
 * Removes the Remotion output latency from `filePath` in place (video copied, audio re-encoded AAC 192k at its own rate). Returns what was done; never throws for a file
 * without audio (nothing to correct). A failure leaves the original file untouched (the caller logs it; the render is not failed for it).
 */
export async function correctRemotionAudioLatency(filePath: string): Promise<{applied: boolean; samples: number; sampleRate: number | null}> {
  const sampleRate = await audioSampleRate(filePath).catch(() => null);
  if (!sampleRate) return {applied: false, samples: 0, sampleRate: null};
  const samples = remotionLatencySamples(sampleRate);
  if (samples <= 0) return {applied: false, samples: 0, sampleRate};
  const tmp = `${filePath}.sync.mp4`;
  try {
    await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', latencyTrimFilter(samples), '-c:a', 'aac', '-b:a', '192k', '-ar', String(sampleRate), '-movflags', '+faststart', tmp]);
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, {force: true});
    throw error;
  }
  return {applied: true, samples, sampleRate};
}
