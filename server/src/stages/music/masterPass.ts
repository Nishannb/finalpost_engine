import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {measureFinalAudio} from './mixMeasure.ts';

export const MASTER_TARGET = {I: -14, TP: -1, LRA: 11} as const;

export type LoudnormMeasure = {inputI: number; inputTp: number; inputLra: number; inputThresh: number};
export type MasterPassResult = {beforeLufs: number | null; beforeTruePeak: number | null; afterLufs: number | null; afterTruePeak: number | null};

/** Parses the JSON block loudnorm prints (print_format=json) at the end of stderr. */
export function parseLoudnormJson(stderr: string): LoudnormMeasure {
  const end = stderr.lastIndexOf('}');
  const start = end < 0 ? -1 : stderr.lastIndexOf('{', end);
  if (start < 0 || end < start) throw new Error('loudnorm json not found');
  const raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const num = (key: string) => {
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) throw new Error(`loudnorm ${key} not finite`);
    return value;
  };
  return {inputI: num('input_i'), inputTp: num('input_tp'), inputLra: num('input_lra'), inputThresh: num('input_thresh')};
}

const base = `loudnorm=I=${MASTER_TARGET.I}:TP=${MASTER_TARGET.TP}:LRA=${MASTER_TARGET.LRA}`;

export function buildPass1Filter(): string {
  return `${base}:print_format=json`;
}

export function buildPass2Filter(m: LoudnormMeasure): string {
  return `${base}:measured_I=${m.inputI}:measured_TP=${m.inputTp}:measured_LRA=${m.inputLra}:measured_thresh=${m.inputThresh}:linear=true`;
}

function runFfmpeg(args: string[], ffmpegBin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-200_000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/**
 * Two-pass loudnorm on the audio of `filePath`, video stream copied. The file is replaced only after pass 2 exits 0;
 * on any failure the original stays in place and an Error is thrown.
 */
export async function masterPass(filePath: string, ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<MasterPassResult> {
  const tmp = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.master-${process.pid}-${Date.now()}.mp4`);
  try {
    const before = await measureFinalAudio(filePath, ffmpegBin);
    const stderr1 = await runFfmpeg(['-nostats', '-hide_banner', '-i', filePath, '-vn', '-af', buildPass1Filter(), '-f', 'null', '-'], ffmpegBin);
    const measured = parseLoudnormJson(stderr1);
    await runFfmpeg(
      ['-nostats', '-hide_banner', '-y', '-i', filePath, '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-af', buildPass2Filter(measured), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp],
      ffmpegBin,
    );
    await fs.rename(tmp, filePath);
    const after = await measureFinalAudio(filePath, ffmpegBin);
    return {beforeLufs: before.finalLufs, beforeTruePeak: before.finalTruePeak, afterLufs: after.finalLufs, afterTruePeak: after.finalTruePeak};
  } catch (error) {
    await fs.rm(tmp, {force: true}).catch(() => undefined);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
