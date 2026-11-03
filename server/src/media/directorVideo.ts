/**
 * Opt-in full-video input for the Gemini decision calls (Phase 34 experiment).
 *
 * Builds a compact proxy of the WHOLE source (every second of picture and the audio, downscaled and re-encoded) and returns it as an inline
 * `video/mp4` part, which the Gemini API accepts as a video input (it samples frames across the whole clip and reads the audio). Nothing is
 * uploaded anywhere: the bytes travel inside the model request only. Used only when a caller passes `directorVideoInput`; the default pipeline
 * never calls this.
 */

import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';

import {env} from '../config/env.ts';
import {EngineError} from '../lib/errors.ts';

/** Gemini's inline request limit is about 20 MB in total; the base64 text is a third larger than the file. */
export const DIRECTOR_VIDEO_MAX_BYTES = 12 * 1024 * 1024;

export type DirectorVideoPart = {mimeType: 'video/mp4'; data: string; bytes: number; width: number; height: number; fps: number; durationSec?: number};

export async function buildDirectorVideoPart(sourcePath: string, outputPath: string): Promise<DirectorVideoPart> {
  const width = 540;
  const height = 960;
  const fps = 12;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(env.FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '1', '-b:a', '48k', '-movflags', '+faststart', outputPath,
    ], {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))));
  });
  const bytes = (await fs.stat(outputPath)).size;
  if (bytes > DIRECTOR_VIDEO_MAX_BYTES) {
    throw new EngineError('broll_failed', `Director video proxy is ${bytes} bytes (limit ${DIRECTOR_VIDEO_MAX_BYTES}); it would not fit one inline Gemini request`);
  }
  return {mimeType: 'video/mp4', data: (await fs.readFile(outputPath)).toString('base64'), bytes, width, height, fps};
}
