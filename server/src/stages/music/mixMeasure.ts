import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {stageLogger} from '../../lib/logger.ts';
import {DUCK_PAUSE_GAP_SEC} from './duckEnvelope.ts';
import {mixMeasureEnabled, resolvePython} from './flags.ts';

const log = stageLogger('music');

export const MIX_PROBE_COMPOSITION = 'MusicMixProbe';

export type Window = [number, number];
export type MixWindows = {speech: Window[]; pause: Window[]};

type DuckLike = {phrases: Array<{start: number; end: number}>; durationSec: number};

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Speech windows are the duck phrases. Pause windows are the gaps between two phrases of at least 600 ms
 * (interior only: the open head and tail are not pauses). Both are clipped to the timeline.
 */
export function mixWindows(duck: DuckLike): MixWindows {
  const limit = Math.max(0, duck.durationSec);
  const phrases = [...duck.phrases].sort((a, b) => a.start - b.start);
  const speech: Window[] = [];
  const pause: Window[] = [];
  phrases.forEach((phrase, index) => {
    const start = Math.max(0, phrase.start);
    const end = Math.min(limit, phrase.end);
    if (end > start) speech.push([round3(start), round3(end)]);
    const next = phrases[index + 1];
    if (next && next.start - phrase.end >= DUCK_PAUSE_GAP_SEC - 1e-9) {
      const gapStart = Math.max(0, phrase.end);
      const gapEnd = Math.min(limit, next.start);
      if (gapEnd > gapStart) pause.push([round3(gapStart), round3(gapEnd)]);
    }
  });
  return {speech, pause};
}

export type MixProbeInput = {
  stem: 'bed' | 'vo';
  outPath: string;
  propsPath: string;
};

/** Pure: argv for one local probe render. Null when MUSIC_MIX_MEASURE is not on, so nothing is spawned. No Lambda flags. */
export function buildMixProbeArgv(input: MixProbeInput, env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (!mixMeasureEnabled(env)) return null;
  return ['remotion', 'render', 'src/index.ts', MIX_PROBE_COMPOSITION, input.outPath, '--codec=wav', `--props=${input.propsPath}`, '--concurrency=1', '--log=error'];
}

export type MixMeasured = {
  speechGapLu: number | null;
  pauseGapLu: number | null;
  voSpeechLufs: number | null;
  bedSpeechLufs: number | null;
  bedPauseLufs: number | null;
};

/** speechGapLu = VO speech LUFS − bed speech LUFS. pauseGapLu = VO speech LUFS − bed pause LUFS (the VO is silent in a pause). */
export function gapsFromMeasure(raw: {vo_speech_lufs?: number | null; bed_speech_lufs?: number | null; bed_pause_lufs?: number | null}): MixMeasured {
  const num = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const vo = num(raw.vo_speech_lufs);
  const bedSpeech = num(raw.bed_speech_lufs);
  const bedPause = num(raw.bed_pause_lufs);
  return {
    voSpeechLufs: vo,
    bedSpeechLufs: bedSpeech,
    bedPauseLufs: bedPause,
    speechGapLu: vo !== null && bedSpeech !== null ? round1(vo - bedSpeech) : null,
    pauseGapLu: vo !== null && bedPause !== null ? round1(vo - bedPause) : null,
  };
}

/** The measurer the render hook uses: pyloudnorm in agents/.venv, on two stem files and the windows. */
export function measureStems(input: {bedPath: string; voPath: string; windows: MixWindows; agentsDir: string}): Promise<MixMeasured> {
  return new Promise((resolve, reject) => {
    const python = resolvePython(input.agentsDir);
    const windowsFile = path.join(path.dirname(input.bedPath), `mix-windows-${process.pid}-${Date.now()}.json`);
    fs.writeFile(windowsFile, JSON.stringify(input.windows))
      .then(() => {
        execFile(
          python.command,
          ['-m', 'music_specialist.vo_lufs', '--mix', input.bedPath, input.voPath, windowsFile],
          {cwd: input.agentsDir, timeout: 120000, maxBuffer: 1 << 20},
          (error, stdout) => {
            void fs.rm(windowsFile, {force: true});
            if (error) return reject(error);
            try {
              resolve(gapsFromMeasure(JSON.parse(stdout)));
            } catch (parseError) {
              reject(parseError);
            }
          },
        );
      })
      .catch(reject);
  });
}

/** Integrated loudness and true peak of the audio of a rendered file (ffmpeg ebur128). */
export function measureFinalAudio(filePath: string, ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<{finalLufs: number | null; finalTruePeak: number | null}> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-nostats', '-hide_banner', '-i', filePath, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg ebur128 exited ${code}`));
      resolve(parseEbur128Summary(stderr));
    });
  });
}

export function parseEbur128Summary(stderr: string): {finalLufs: number | null; finalTruePeak: number | null} {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const grab = (pattern: RegExp) => {
    const match = summary.match(pattern);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  return {
    finalLufs: grab(/Integrated loudness:[\s\S]*?I:\s+(-?[\d.]+)\s+LUFS/),
    finalTruePeak: grab(/True peak:[\s\S]*?Peak:\s+(-?[\d.]+)\s+dBFS/),
  };
}

function runProbe(argv: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', argv, {cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`remotion probe exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

export type MixMeasureInput = {
  renderJobId: string;
  remotionRoot: string;
  agentsDir: string;
  finalPath: string;
  durationSec: number;
  videoUrl: string;
  keepSegments?: Array<{sourceStart: number; sourceEnd: number; outputStart: number}>;
  audioDesign?: {musicUrl?: string; duck?: DuckLike & Record<string, unknown>};
  blueprintId?: string;
};

/** Flag-gated. Never throws: a failed probe logs music.mix_measure_failed and the render carries on. */
export async function runMixMeasure(input: MixMeasureInput, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!mixMeasureEnabled(env)) return;
  const outDir = path.join(input.remotionRoot, 'out');
  const files: string[] = [];
  try {
    const duck = input.audioDesign?.duck;
    const bedUrl = input.audioDesign?.musicUrl;
    if (!duck || !bedUrl) return;
    const windows = mixWindows(duck);
    const stems = {bed: path.join(outDir, `${input.renderJobId}.mixprobe-bed.wav`), vo: path.join(outDir, `${input.renderJobId}.mixprobe-vo.wav`)};
    for (const stem of ['bed', 'vo'] as const) {
      const propsPath = path.join(outDir, `${input.renderJobId}.mixprobe-${stem}.json`);
      files.push(propsPath, stems[stem]);
      await fs.writeFile(
        propsPath,
        JSON.stringify({stem, bedUrl, voUrl: input.videoUrl, duck, durationSec: input.durationSec, ...(input.keepSegments?.length ? {voSegments: input.keepSegments} : {})}),
      );
      const argv = buildMixProbeArgv({stem, outPath: stems[stem], propsPath}, env);
      if (!argv) return;
      await runProbe(argv, input.remotionRoot, 240000);
    }
    const measured = await measureStems({bedPath: stems.bed, voPath: stems.vo, windows, agentsDir: input.agentsDir});
    const finalAudio = await measureFinalAudio(input.finalPath);
    log.info({blueprintId: input.blueprintId, ...measured, ...finalAudio, speechWindows: windows.speech.length, pauseWindows: windows.pause.length}, 'music.mix_measured');
  } catch (error) {
    log.warn({blueprintId: input.blueprintId, reason: error instanceof Error ? error.message.slice(0, 300) : 'mix_measure'}, 'music.mix_measure_failed');
  } finally {
    await Promise.all(files.map(file => fs.rm(file, {force: true}).catch(() => undefined)));
  }
}
