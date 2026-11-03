/** S1: ingest + shot boundaries. Source fps is kept (rational + float); every boundary is an integer frame. PySceneDetect when installed, else a single shot. */
import {execFile} from 'node:child_process';
import {readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import type {KineticShot} from './schema.ts';

const run = promisify(execFile);

export type VideoMeta = {width: number; height: number; fpsRational: string; fps: number; durationSec: number; totalFrames: number};

export function parseRational(r: string): number {
  const [n, d] = r.split('/').map(Number);
  return d ? n! / d : n!;
}

export async function probeVideo(file: string, ffprobe = process.env.FFPROBE_PATH || 'ffprobe'): Promise<VideoMeta> {
  const {stdout} = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,nb_read_packets,duration:format=duration', '-of', 'json', file], {maxBuffer: 1 << 20});
  const j = JSON.parse(stdout) as {streams?: Array<{width: number; height: number; r_frame_rate: string; avg_frame_rate: string; nb_read_packets?: string; duration?: string}>; format?: {duration?: string}};
  const s = j.streams?.[0];
  if (!s) throw new Error(`no video stream in ${file}`);
  const fpsRational = s.avg_frame_rate && s.avg_frame_rate !== '0/0' ? s.avg_frame_rate : s.r_frame_rate;
  const fps = parseRational(fpsRational);
  const durationSec = Number(s.duration ?? j.format?.duration ?? 0);
  const totalFrames = Number(s.nb_read_packets) || Math.round(durationSec * fps);
  return {width: s.width, height: s.height, fpsRational, fps, durationSec, totalFrames};
}

export type ShotDetector = (video: string, meta: VideoMeta) => Promise<number[]>;

/** PySceneDetect CLI when on PATH: returns the cut FRAMES (start of every shot after the first). Throws when unavailable. */
export const pySceneDetect: ShotDetector = async (video, meta) => {
  const out = path.join(os.tmpdir(), `kin-scenes-${process.pid}-${Date.now()}`);
  try {
    await run('scenedetect', ['-i', video, '-o', out, 'detect-content', 'list-scenes', '-n'], {maxBuffer: 1 << 22});
    const csvName = (await import('node:fs/promises')).readdir(out).then(f => f.find(x => x.endsWith('-Scenes.csv')));
    const name = await csvName;
    if (!name) return [];
    const rows = (await readFile(path.join(out, name), 'utf8')).split('\n').slice(2).filter(Boolean);
    return rows.map(r => Number(r.split(',')[1])).filter(f => Number.isInteger(f) && f > 1 && f < meta.totalFrames).map(f => f - 1);
  } finally {
    await rm(out, {recursive: true, force: true});
  }
};

export async function detectShots(video: string, meta: VideoMeta, detector: ShotDetector | null = pySceneDetect): Promise<{shots: KineticShot[]; source: string}> {
  let cuts: number[] = [];
  let source = 'single-shot';
  if (detector) {
    try { cuts = [...new Set(await detector(video, meta))].filter(f => f > 0 && f < meta.totalFrames).sort((a, b) => a - b); if (cuts.length) source = 'pyscenedetect'; else source = 'pyscenedetect:no-cuts'; } catch { source = 'single-shot:pyscenedetect-unavailable'; }
  }
  const bounds = [0, ...cuts, meta.totalFrames];
  const shots = bounds.slice(0, -1).map((start, i) => ({id: `shot-${i}`, startFrame: start, endFrame: bounds[i + 1]!}));
  return {shots, source};
}
