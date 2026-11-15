/**
 * Integrated loudness (LUFS) of the creator's speech audio, measured locally with ffmpeg's ebur128 filter (no Python, no network). Used to level the Match Cut shutter relative to the voice
 * (matchCutShutter.ts). The EBU R128 gates (absolute -70 LUFS, relative -10 LU) exclude the silences between phrases, so the figure is the speech loudness, not the file average.
 * Returns null when ffmpeg fails or reports nothing usable: the caller then drops the sound instead of guessing a level.
 */
import {execFile} from 'node:child_process';

export function parseIntegratedLufs(stderr: string): number | null {
  const summary = stderr.slice(Math.max(0, stderr.lastIndexOf('Integrated loudness')));
  const match = /I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(summary);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > -70 ? value : null;
}

export function measureVoiceLufs(audioPath: string, ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg', timeoutMs = 60_000): Promise<number | null> {
  return new Promise(resolve => {
    execFile(ffmpegBin, ['-hide_banner', '-nostats', '-i', audioPath, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], {timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024}, (error, _stdout, stderr) => {
      if (error) return resolve(null);
      resolve(parseIntegratedLufs(String(stderr)));
    });
  });
}
