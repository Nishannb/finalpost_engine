/**
 * Local media probing and audio extraction.
 *
 * Sending the whole MP4 to Groq would be the naive path; extracting a 16 kHz
 * mono Opus track first cuts the upload from tens of MB to ~1 MB per 5 minutes,
 * which dominates end-to-end latency and keeps us under the provider's cap.
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';
import {stageLogger} from '../lib/logger.ts';

const log = stageLogger('media');

export type ProbeResult = {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new EngineError('upstream_timeout', `${bin} timed out`));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(
        new EngineError(
          'not_configured',
          `${bin} is not available on this host (${(error as Error).message})`,
        ),
      );
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({stdout, stderr});
        return;
      }
      reject(
        new EngineError('internal', `${bin} exited with code ${code}`, {
          stderr: stderr.slice(-500),
        }),
      );
    });
  });
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const {stdout} = await run(
    env.FFPROBE_PATH,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    30_000,
  );

  let parsed: {
    format?: {duration?: string};
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new EngineError('internal', 'ffprobe returned malformed JSON');
  }

  const streams = parsed.streams ?? [];
  const video = streams.find(s => s.codec_type === 'video');
  const hasAudio = streams.some(s => s.codec_type === 'audio');
  const durationSec = Number(
    parsed.format?.duration ?? video?.duration ?? 0,
  );

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new EngineError('source_unreachable', 'Could not read video duration');
  }

  return {
    durationSec,
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    hasAudio,
  };
}

/**
 * Downmix to speech-optimised mono Opus.
 *
 * 16 kHz is Whisper's native sample rate, so resampling here costs nothing in
 * accuracy while shrinking the payload by ~30x versus the source MP4.
 */
export async function extractSpeechAudio(
  inputPath: string,
  outputPath: string,
): Promise<{path: string; bytes: number}> {
  const started = Date.now();
  await run(
    env.FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libopus',
      '-b:a',
      '24k',
      '-application',
      'voip',
      outputPath,
    ],
    180_000,
  );

  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat || stat.size < 1) {
    throw new EngineError('no_speech_detected', 'No audio track could be extracted');
  }
  log.debug({bytes: stat.size, ms: Date.now() - started}, 'extracted speech audio');
  return {path: outputPath, bytes: stat.size};
}

/** Grab a JPEG still for Seedance / OpenRouter image references. */
export async function extractStillJpeg(
  inputPath: string,
  outputPath: string,
  atSec: number,
): Promise<string> {
  const t = Math.max(0, atSec);
  await run(
    env.FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      t.toFixed(2),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=720:-2:flags=lanczos',
      '-q:v',
      '3',
      outputPath,
    ],
    30_000,
  );
  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat || stat.size < 1) {
    throw new EngineError('internal', 'Could not extract a still frame');
  }
  return outputPath;
}

export type FramePalette = {
  luminance: number;
  r: number;
  g: number;
  b: number;
};

/**
 * Average a few 1x1 RGB samples so captions can contrast with the actual
 * talking-head (white wall vs teal wall vs dark room).
 */
export async function sampleFramePalette(
  inputPath: string,
  swatchPath: string,
  durationSec: number,
): Promise<FramePalette> {
  const times = [0.22, 0.5, 0.78].map(frac =>
    Math.max(0.35, Math.min(Math.max(0.5, durationSec - 0.4), durationSec * frac)),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  let counted = 0;
  for (const time of times) {
    try {
      await run(
        env.FFMPEG_PATH,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          time.toFixed(2),
          '-i',
          inputPath,
          '-frames:v',
          '1',
          '-vf',
          'scale=1:1:flags=area,format=rgb24',
          '-f',
          'rawvideo',
          swatchPath,
        ],
        20_000,
      );
      const buf = await fs.readFile(swatchPath);
      if (buf.length >= 3) {
        r += buf[0]!;
        g += buf[1]!;
        b += buf[2]!;
        counted += 1;
      }
    } catch {
      // One missed sample is fine; we still have the others.
    }
  }
  if (counted < 1) {
    return {luminance: 0.35, r: 0.35, g: 0.35, b: 0.35};
  }
  const rn = r / counted / 255;
  const gn = g / counted / 255;
  const bn = b / counted / 255;
  return {
    r: rn,
    g: gn,
    b: bn,
    luminance: 0.2126 * rn + 0.7152 * gn + 0.0722 * bn,
  };
}

/**
 * Apply a .cube 3D LUT after Remotion burn (ffmpeg lut3d).
 * Copies audio untouched; re-encodes video at short-form friendly settings.
 */
export async function applyCubeLut(input: {
  inputPath: string;
  outputPath: string;
  lutPath: string;
}): Promise<void> {
  const started = Date.now();
  // Escape path for ffmpeg filtergraph (Windows-hostile chars unlikely here).
  const lutEscaped = input.lutPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  await run(
    env.FFMPEG_PATH,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input.inputPath,
      '-vf',
      `lut3d='${lutEscaped}'`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      input.outputPath,
    ],
    10 * 60_000,
  );
  const stat = await fs.stat(input.outputPath).catch(() => null);
  if (!stat || stat.size < 1) {
    throw new EngineError('render_failed', 'Color grade produced an empty file');
  }
  log.info(
    {ms: Date.now() - started, lut: input.lutPath, bytes: stat.size},
    'applied cube LUT',
  );
}
